-- Reconstructed on 2026-11-19 from the production D1 schema (sqlite_master) after the local history was lost.
-- Production already applied this file by name; it only runs on fresh databases.
-- Data-only in production: it removed the e-book step from the episode track. The original renumbering of
-- user progress was not recoverable. Below: the final step rows as they are in production (2026-11-19).
-- On a fresh database these rows are written by the seed instead; INSERT OR REPLACE keeps both paths equal.
INSERT OR REPLACE INTO steps(n, name, pt, group_label) VALUES
  (1, 'In this episode', 'conheça o episódio', 'ABERTURA'),
  (2, 'Take the Mic', 'música · 1ª passada', NULL),
  (3, 'Take a Look', 'dê uma olhada', 'O EPISÓDIO'),
  (4, 'Take It In', 'absorva', NULL),
  (5, 'Take the Mic', 'pegue o microfone', NULL),
  (6, 'Take a Lesson', 'tenha uma aula', NULL),
  (7, 'Take Away', 'leve com você', NULL),
  (8, 'Take Action', 'mãos à obra', NULL),
  (9, 'Take the Mic', 'música · cante junto', 'FECHAMENTO'),
  (10, 'Take the Test', 'teste do episódio', NULL);
