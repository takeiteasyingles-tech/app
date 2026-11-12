-- 0015_character_voices_default.sql (spec 05 "Character voices by default")
-- The characters speak with their own voices (/api/tts: the cloned ElevenLabs voice of Configurações →
-- Vozes, else the Workers AI one) unless the learner turns "Voz dos personagens" off in Você. It was
-- off by default, so every line fell back to the browser's synthetic voice. New rows are inserted with
-- hd = 1 (routes/auth.ts, routes/me.ts); existing learners get it turned on once, here.

UPDATE user_settings SET hd = 1 WHERE hd = 0;
