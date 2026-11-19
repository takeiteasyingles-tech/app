-- Reconstructed on 2026-11-19 from the production D1 schema (sqlite_master) after the local history was lost.
-- Production already applied this file by name; it only runs on fresh databases.
ALTER TABLE mic_phrases ADD COLUMN who TEXT CHECK (who IS NULL OR length(who) <= 40);
