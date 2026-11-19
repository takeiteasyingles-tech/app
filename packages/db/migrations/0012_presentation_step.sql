-- Reconstructed on 2026-11-19 from the production D1 schema (sqlite_master) after the local history was lost.
-- Production already applied this file by name; it only runs on fresh databases.
-- Data-only in production: it moved the episode presentation ("In this episode") to step 1. The original
-- statements (including any step_completions / episode_progress renumbering) were not recoverable; the
-- final step rows are written by 0013 below. On a fresh database the steps table is still empty here.
SELECT 1;
