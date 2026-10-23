import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { testGate } from '../src/domain/testGate';

it('unlocks after the configured number of complete episodes, without counting partial or unrelated episodes', () => {
  expect(testGate([1], { '1': true, '7': true }, [1, 2, 3], 2).unlocked).toBe(false);
  expect(testGate([1], { '1': true, '2': true }, [1, 2, 3], 2)).toMatchObject({ unlocked: true, remaining: 0 });
  expect(testGate([1], { '1': true }, [], null).unlocked).toBe(true);
  expect(testGate([1], { '1': true }, [], null, false).unlocked).toBe(false);
  expect(testGate([], {}).unlocked).toBe(false);
  expect(testGate([1, 2], { '1': true }, [], null, true, [1]).unlocked).toBe(true);
  expect(testGate([1], { '1': true, '2': true }, [1, 2], 2, true, [1]).unlocked).toBe(false);
});

it('splits shared books while retaining downloads, answers and results, and creates draft extras', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    const folder = new URL('../../db/migrations/', import.meta.url);
    const files = readdirSync(folder)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files.filter((f) => !f.startsWith('0009'))) db.exec(readFileSync(new URL(file, folder), 'utf8'));
    db.exec(`INSERT INTO users(id,email,created_at) VALUES('learner','learner@test.local',1);
      INSERT INTO seasons(n,title) VALUES(1,'Temporada');
      INSERT INTO ebooks(num,title,updated_at) VALUES(1,'Livro compartilhado',1);
      INSERT INTO episodes(num,title,season_n,ebook_num,updated_at) VALUES(1,'Primeiro',1,1,1),(2,'Segundo',1,1,1),(3,'Terceiro',1,NULL,1);
      INSERT INTO ebook_test_questions(id,ebook_num,part_idx,part_title,n,q,opts,answer_idx) VALUES('q1',1,0,'Parte',1,'Hello?','["Oi","Tchau"]',0);
      INSERT INTO user_ebooks VALUES('learner',1,123);
      INSERT INTO ebook_test_answers VALUES('learner','q1',0,NULL,1,456);
      INSERT INTO ebook_test_results VALUES('learner',1,1,1,789);`);
    const sql = readFileSync(new URL('0009_episode_materials.sql', folder), 'utf8');
    db.exec(sql);
    const eps = db.prepare('SELECT num,ebook_num,extra_id FROM episodes ORDER BY num').all();
    expect(new Set(eps.map((e) => e.ebook_num)).size).toBe(3);
    expect(
      db.prepare('SELECT test_required_episodes FROM ebooks WHERE num=?').get(eps[1]?.ebook_num as number),
    ).toMatchObject({ test_required_episodes: '[1,2]' });
    expect(
      db.prepare('SELECT downloaded_at FROM user_ebooks WHERE ebook_num=?').get(eps[1]?.ebook_num as number),
    ).toMatchObject({ downloaded_at: 123 });
    expect(
      db.prepare("SELECT correct,updated_at FROM ebook_test_answers WHERE question_id='episode-2-q1'").get(),
    ).toMatchObject({ correct: 1, updated_at: 456 });
    expect(
      db
        .prepare('SELECT passed,submitted_at FROM ebook_test_results WHERE ebook_num=?')
        .get(eps[1]?.ebook_num as number),
    ).toMatchObject({ passed: 1, submitted_at: 789 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM extras WHERE status='draft'").get()).toMatchObject({ n: 3 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // Reusing the provisioning part for local seed is safe and preserves existing ownership.
    db.exec(`-- BEGIN EPISODE MATERIALS${sql.split('-- BEGIN EPISODE MATERIALS')[1]}`);
    expect(db.prepare('SELECT num,ebook_num,extra_id FROM episodes ORDER BY num').all()).toEqual(eps);
  } finally {
    db.close();
  }
});
