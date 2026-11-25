-- 0017_mic_phrase_speaker.sql (spec 05 "Take the Mic in the characters' voices")
-- Who says a Take the Mic phrase ("Quem fala"), so the learner hears it in that character's voice.
-- NULL = automatic: the character the phrase names ("I'm Margaret") or who says it in Take It In,
-- else the narration (domain/micSpeaker.ts, applied when the episode is published).

ALTER TABLE mic_phrases ADD COLUMN who TEXT CHECK (who IS NULL OR length(who) <= 40);
