-- 0016_episode_voices.sql (spec 05 "Lesson voices")
-- Each lesson (episode) can pick the ElevenLabs voices its audio is read with: the narration (vocabulary,
-- Mic phrases, Take Away, exercises) and each character of the dialogue. JSON EpisodeVoices
-- {"narrator": "<voice id>", "cast": {"Zach": "<voice id>"}}; anything left out uses the course voice
-- (Configurações → Vozes). Published with the episode (ep/{n}.json), read by /api/tts.

ALTER TABLE episodes ADD COLUMN voices TEXT NOT NULL DEFAULT '{}';
