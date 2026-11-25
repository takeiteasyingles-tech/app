-- 0019_assistant_avatar.sql (spec 05 "Mic avatar per assistant")
-- What the Mic stage shows for each assistant, edited in admin → Assistentes → Avatar no Mic:
--   NULL                                              the assistant's own 3D model or video clips;
--   {"kind":"assistia","slug":"…"}                    the Assistia embed (face and voice; our tutor writes);
--   {"kind":"elevenlabs","agentId":"agent_…","modes":[…]}  an ElevenLabs agent holds the conversation
--                                                     in those Mic modes (tie-app hands out signed URLs).
-- Margaret already had the Assistia embed in production (hardcoded in the client until now), so she
-- keeps it as data.

ALTER TABLE assistants ADD COLUMN avatar TEXT;

UPDATE assistants SET avatar = '{"kind":"assistia","slug":"marguert"}' WHERE key = 'margaret' AND avatar IS NULL;

INSERT INTO audit_log(at, actor_user_id, actor_role, action, target_type, target_id, ip_hash, ua, diff)
  SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL, 'system', 'content.assistants.update', 'assistant', 'margaret',
    NULL, 'migration 0019', '{"avatar":{"kind":"assistia","slug":"marguert"}}'
  WHERE EXISTS (SELECT 1 FROM assistants WHERE key = 'margaret');
