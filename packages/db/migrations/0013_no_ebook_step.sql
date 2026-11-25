-- 0013_no_ebook_step.sql (spec 05 "Step order", "No e-book")
-- The e-book leaves the course: the episode has 9 steps, Apresentação (1), song (2), Take a Look (3) …
-- Take Action (8) and the sing-along (9). The e-book step (3 after 0012) is removed and steps 4-10 become
-- 3-9. E-book data (ebooks, ebook_downloads, test questions, answers, results) is kept, only unused.
-- Run after 0012. On a live database, republish the content afterwards so catalog.json carries the
-- new step rows. Award keys (`step:{ep}:{n}`) are not rewritten: a learner mid-episode may not be
-- paid again for a step number already paid under the old numbering.

-- Content: drop the e-book row, shift 4-10 down (through an offset: n is the primary key).
DELETE FROM steps WHERE n = 3;
UPDATE steps SET n = n + 100 WHERE n BETWEEN 4 AND 10;
UPDATE steps SET n = n - 101 WHERE n BETWEEN 104 AND 110;

-- Progress: completed media steps keep their meaning (the e-book had no rows).
DELETE FROM step_completions WHERE step = 3;
UPDATE step_completions SET step = step + 100 WHERE step BETWEEN 4 AND 10;
UPDATE step_completions SET step = step - 101 WHERE step BETWEEN 104 AND 110;

-- Furthest step: on the e-book (3) → Take a Look (3), unchanged; 4-10 → 3-9. A done episode keeps
-- done_at and reads as the last step.
UPDATE episode_progress SET furthest_step = furthest_step - 1 WHERE furthest_step BETWEEN 4 AND 10;
