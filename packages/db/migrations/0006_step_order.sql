-- 0006_step_order.sql (spec 05 "Step order")
-- Episode steps 1-3 move from the prototype's intro → song → e-book to song → e-book → intro, and the
-- intro now opens "O episódio". Steps 4-10 keep their numbers. On a fresh database the tables are
-- still empty here (the seed writes the new order); on a live one, republish the content afterwards
-- so catalog.json carries the new step rows.

-- Content: renumber the three rows through an offset (n is the primary key), then move the group
-- labels: "ABERTURA" from the intro (now 3) to the song (now 1), "O EPISÓDIO" from Take a Look (4) to
-- the intro (3).
UPDATE steps SET n = n + 100 WHERE n IN (1, 2, 3);
UPDATE steps SET n = 3 WHERE n = 101;
UPDATE steps SET n = 1 WHERE n = 102;
UPDATE steps SET n = 2 WHERE n = 103;
UPDATE steps SET group_label = (SELECT group_label FROM steps WHERE n = 3) WHERE n = 1;
UPDATE steps SET group_label = (SELECT group_label FROM steps WHERE n = 4) WHERE n = 3;
UPDATE steps SET group_label = NULL WHERE n = 4;

-- Progress: completed media keep their meaning (the intro ended: 1 → 3; the song ended: 2 → 1; the
-- e-book is not a media step and has no rows).
UPDATE step_completions SET step = step + 100 WHERE step IN (1, 2);
UPDATE step_completions SET step = 3 WHERE step = 101;
UPDATE step_completions SET step = 1 WHERE step = 102;

-- Unfinished episodes still in the opening: on the old song (2) → back to the song (1); on the old
-- e-book (3, song heard) → the e-book (2). Done episodes and anyone at step 4 or later are unaffected.
UPDATE episode_progress SET furthest_step = furthest_step - 1 WHERE done_at IS NULL AND furthest_step IN (2, 3);
