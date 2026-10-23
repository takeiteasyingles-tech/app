-- Episodes own their book, extra and test. Keep existing book content and learner records when
-- splitting books previously shared by two or more episodes. No published R2 snapshot is rewritten.
ALTER TABLE episodes ADD COLUMN extra_id TEXT REFERENCES extras(id);
ALTER TABLE ebooks ADD COLUMN test_enabled INTEGER NOT NULL DEFAULT 1 CHECK(test_enabled IN (0,1));
ALTER TABLE ebooks ADD COLUMN test_required_episodes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ebooks ADD COLUMN test_min_completed INTEGER CHECK(test_min_completed > 0);

-- BEGIN EPISODE MATERIALS (also used after a local seed)
-- Retain the old unlock rule of a shared assessment until an editor explicitly changes it.
UPDATE ebooks SET test_required_episodes=(SELECT json_group_array(num) FROM episodes WHERE ebook_num=ebooks.num)
WHERE test_required_episodes='[]' AND (SELECT COUNT(*) FROM episodes WHERE ebook_num=ebooks.num)>1;

CREATE TABLE _episode_books AS
SELECT e.num AS ep, e.ebook_num AS old_book,
  (SELECT COALESCE(MAX(num),0) FROM ebooks) + ROW_NUMBER() OVER (ORDER BY e.num) AS new_book
FROM episodes e WHERE e.ebook_num IS NULL OR NOT EXISTS(SELECT 1 FROM ebooks b WHERE b.num=e.ebook_num)
  OR e.num <> (SELECT MIN(p.num) FROM episodes p WHERE p.ebook_num=e.ebook_num);

INSERT INTO ebooks(num,title,eps_label,scope,five,real,lead,chat,extras_cards,pdf_media,pass_score,updated_at,test_enabled,test_required_episodes,test_min_completed)
SELECT m.new_book,COALESCE(b.title,e.title),'Episódio '||e.num,b.scope,
  COALESCE(b.five,'[]'),COALESCE(b.real,'[]'),COALESCE(b.lead,'[]'),COALESCE(b.chat,'[]'),
  COALESCE(b.extras_cards,'[]'),b.pdf_media,COALESCE(b.pass_score,0),e.updated_at,
  COALESCE(b.test_enabled,1),COALESCE(b.test_required_episodes,'[]'),b.test_min_completed
FROM _episode_books m JOIN episodes e ON e.num=m.ep LEFT JOIN ebooks b ON b.num=m.old_book;

INSERT INTO ebook_test_questions(id,ebook_num,part_idx,part_title,n,q,rev,ep_num,step,opts,answer_idx,accept,show,audio)
SELECT 'episode-'||m.ep||'-'||t.id,m.new_book,t.part_idx,t.part_title,t.n,t.q,t.rev,t.ep_num,t.step,
  t.opts,t.answer_idx,t.accept,t.show,t.audio
FROM _episode_books m JOIN ebook_test_questions t ON t.ebook_num=m.old_book;

INSERT INTO user_ebooks(user_id,ebook_num,downloaded_at)
SELECT u.user_id,m.new_book,u.downloaded_at FROM _episode_books m JOIN user_ebooks u ON u.ebook_num=m.old_book;
INSERT INTO ebook_test_results(user_id,ebook_num,score,passed,submitted_at)
SELECT u.user_id,m.new_book,u.score,u.passed,u.submitted_at FROM _episode_books m JOIN ebook_test_results u ON u.ebook_num=m.old_book;
INSERT INTO ebook_test_answers(user_id,question_id,choice_idx,text_value,correct,updated_at)
SELECT a.user_id,'episode-'||m.ep||'-'||a.question_id,a.choice_idx,a.text_value,a.correct,a.updated_at
FROM _episode_books m JOIN ebook_test_questions t ON t.ebook_num=m.old_book
JOIN ebook_test_answers a ON a.question_id=t.id;

UPDATE episodes SET ebook_num=(SELECT new_book FROM _episode_books WHERE ep=episodes.num)
WHERE num IN(SELECT ep FROM _episode_books);
DROP TABLE _episode_books;

-- Unconfigured extras stay in draft: staff can fill or replace them inside the episode.
INSERT OR IGNORE INTO extras(id,title,format,genres,themes,cast_list,lines,vocab,sort,status)
SELECT 'episode-'||num||'-extra', 'Extra · '||title,'series','[]','[]','[]','[]','[]',num,'draft' FROM episodes;
UPDATE episodes SET extra_id='episode-'||num||'-extra' WHERE extra_id IS NULL;
