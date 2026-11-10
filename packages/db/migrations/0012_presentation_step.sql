-- 0012_presentation_step.sql (spec 05 "Step order")
-- The episode now opens with the Apresentação (the intro step, redesigned: audio, animated orb and the
-- episode text), then the song's first pass and the e-book: steps 1-3 go from song → e-book → intro
-- (0006) back to the prototype's intro → song → e-book. Steps 4-10 keep their numbers. On a live
-- database, republish the content afterwards so catalog.json carries the new step rows.
-- (0011 is reserved for step feedback, which may be applied after this one.)

-- Content: renumber the three rows through an offset (n is the primary key): intro 3 → 1, song 1 → 2,
-- e-book 2 → 3. The intro becomes "Apresentação" and opens the episode (ABERTURA); "O EPISÓDIO"
-- moves back to Take a Look (4).
UPDATE steps SET n = n + 100 WHERE n IN (1, 2, 3);
UPDATE steps SET n = 1 WHERE n = 103;
UPDATE steps SET n = 2 WHERE n = 101;
UPDATE steps SET n = 3 WHERE n = 102;
UPDATE steps SET group_label = (SELECT group_label FROM steps WHERE n = 1) WHERE n = 4;
UPDATE steps SET group_label = (SELECT group_label FROM steps WHERE n = 2) WHERE n = 1;
UPDATE steps SET group_label = NULL WHERE n IN (2, 3);
UPDATE steps SET name = 'Apresentação', pt = 'conheça o episódio' WHERE n = 1;

-- Progress: completed media keep their meaning (the intro ended: 3 → 1; the song ended: 1 → 2; the
-- e-book is not a media step and has no rows).
UPDATE step_completions SET step = step + 100 WHERE step IN (1, 3);
UPDATE step_completions SET step = 2 WHERE step = 101;
UPDATE step_completions SET step = 1 WHERE step = 103;

-- Unfinished episodes still in the opening: on the song (1) → the Apresentação (1), unchanged; on the
-- e-book (2, song heard) → the e-book (3); on the intro (3, e-book downloaded) → the e-book (3), which
-- lets them go on at once. Done episodes and anyone at step 4 or later are unaffected.
UPDATE episode_progress SET furthest_step = 3 WHERE done_at IS NULL AND furthest_step = 2;
