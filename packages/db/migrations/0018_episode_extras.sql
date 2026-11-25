-- 0018_episode_extras.sql (spec 05 "Take Some Extras at the end of every episode")
-- The e-book extras (Take Five, Take the Lead, Take it for Real, Take It Out) come back at the end of
-- every episode, on its Concluído screen. Each episode's hidden e-book row says which ones it offers
-- (ebooks.extras_on, all by default) and holds their content. To start, every row whose extras are
-- empty gets e-book 1's (the prototype's), so all episodes offer the same until the admin edits or
-- switches them off (admin: episode → Take Some Extras).

ALTER TABLE ebooks ADD COLUMN extras_on TEXT NOT NULL DEFAULT '["five","lead","real","out"]';

UPDATE ebooks SET five = (SELECT five FROM ebooks WHERE num = 1)
  WHERE num <> 1 AND five = '[]' AND EXISTS (SELECT 1 FROM ebooks WHERE num = 1);
UPDATE ebooks SET real = (SELECT real FROM ebooks WHERE num = 1)
  WHERE num <> 1 AND real = '[]' AND EXISTS (SELECT 1 FROM ebooks WHERE num = 1);
UPDATE ebooks SET lead = (SELECT lead FROM ebooks WHERE num = 1)
  WHERE num <> 1 AND lead = '[]' AND EXISTS (SELECT 1 FROM ebooks WHERE num = 1);
UPDATE ebooks SET chat = (SELECT chat FROM ebooks WHERE num = 1)
  WHERE num <> 1 AND chat = '[]' AND EXISTS (SELECT 1 FROM ebooks WHERE num = 1);
UPDATE ebooks SET extras_cards = (SELECT extras_cards FROM ebooks WHERE num = 1)
  WHERE num <> 1 AND extras_cards = '[]' AND EXISTS (SELECT 1 FROM ebooks WHERE num = 1);

-- The copy is recorded like any content change (no staff actor: a migration did it).
INSERT INTO audit_log(at, actor_user_id, actor_role, action, target_type, target_id, ip_hash, ua, diff)
  VALUES(CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL, 'system', 'content.ebooks.copy_extras', 'ebook', 'all', NULL,
    'migration 0018', '{"from":1,"fields":["five","real","lead","chat","extras_cards"],"extrasOn":["five","lead","real","out"]}');
