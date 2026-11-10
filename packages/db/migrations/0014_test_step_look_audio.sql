-- 0014_test_step_look_audio.sql (spec 05 "Step order", "Take a Look")
-- Step 1 is named "In this episode"; a tenth step, Take the Test (the episode test, the questions of the
-- episode's hidden e-book row), closes the episode after the sing-along (9). Steps 1-9 keep their
-- numbers, so no progress row moves: a learner who finished the sing-along before this migration
-- finished the episode then (done_at) and stays done. Take a Look gains a context audio.
-- Republish the content afterwards so catalog.json carries the ten step rows.

UPDATE steps SET name = 'In this episode' WHERE n = 1;
INSERT OR IGNORE INTO steps(n, name, pt, group_label) VALUES(10, 'Take the Test', 'teste do episódio', NULL);

ALTER TABLE episodes ADD COLUMN look_media TEXT REFERENCES media(id);
