import { z } from 'zod';
import { endpoint } from './http';

// Episode editor → 1 · Música (tie-admin, permission content.edit, PROD): lyrics timed from the song.
// The browser decodes the recording (WAV, MP3…) and sends it as 16 kHz mono PCM WAV; the Worker
// transcribes it with Workers AI Whisper (word timestamps) and either
//   - generate: turns the words into lyric lines, translated to pt-BR with a karaoke gap by the tutor
//     model, each with its start time `t`; or
//   - align: keeps the lyrics already typed (sent as `lines`) and only finds when each line starts.
// Nothing is saved: the editor puts the result in its draft for staff to review and save. Without the
// AI binding (local dev), with ai.enabled off or when Whisper fails, the answer is source 'demo': align
// spreads the lines evenly over the song and generate returns no lines.

/** 16 kHz × 16 bit mono = 32 KB/s: 24 MB holds a 12-minute song. */
export const SONG_AUDIO_MAX_BYTES = 24 * 1024 * 1024;
export const SONG_MAX_SECONDS = 12 * 60;
export const SONG_LINES_MAX = 200;

export const SongLyricsMode = z.enum(['generate', 'align']);
export type SongLyricsMode = z.infer<typeof SongLyricsMode>;

const LineIn = z.strictObject({
  en: z.string().trim().min(1).max(300),
  pt: z.string().max(300).optional(),
  gap: z.string().max(80).optional(),
});

/** The multipart text fields ("mode", "title", "lines" as JSON), validated after parsing. */
export const SongLyricsFields = z
  .strictObject({
    mode: SongLyricsMode,
    /** Song title: context for the transcription and the translation. */
    title: z.string().trim().max(200).optional(),
    /** align: the typed lyrics, in order. */
    lines: z.array(LineIn).max(SONG_LINES_MAX).optional(),
  })
  .refine((v) => v.mode !== 'align' || (v.lines?.length ?? 0) > 0, {
    message: 'Para sincronizar, a letra precisa ter pelo menos 1 linha.',
    path: ['lines'],
  });
export type SongLyricsFields = z.infer<typeof SongLyricsFields>;

export const SongLyricLine = z.object({
  en: z.string(),
  pt: z.string(),
  gap: z.string().optional(),
  /** Start in the recording, seconds. */
  t: z.number().min(0),
  /** True when the time came from the words heard; false when interpolated or spread evenly. */
  heard: z.boolean(),
});
export type SongLyricLine = z.infer<typeof SongLyricLine>;

export const SongLyricsRes = z.object({
  mode: SongLyricsMode,
  source: z.enum(['ia', 'demo']),
  /** Model(s) used (ia) or why the demo path ran. */
  detail: z.string(),
  /** Length of the audio received, seconds. */
  duration: z.number(),
  /** generate: the new lyrics; align: the lines sent, in the same order, with their times. */
  lines: z.array(SongLyricLine),
  /** generate: false when the translation (and gaps) came from the fallback, so pt is empty. */
  translated: z.boolean(),
});
export type SongLyricsRes = z.infer<typeof SongLyricsRes>;

export const adminSongLyricsApi = {
  /**
   * Multipart: field "audio" (16 kHz mono PCM WAV), field "mode", optional "title" and, for align,
   * "lines" (JSON array of {en, pt?, gap?}).
   */
  run: endpoint({
    method: 'POST',
    path: '/admin-api/ai/song-lyrics',
    access: 'staff',
    perm: 'content.edit',
    multipart: { field: 'audio', maxBytes: SONG_AUDIO_MAX_BYTES, mime: ['audio/wav'] },
    res: SongLyricsRes,
    rateLimit: 'RL_AI',
  }),
} as const;
