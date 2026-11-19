import { z } from 'zod';
import { endpoint } from './http';

// Episode editor → Música (tie-admin): lyrics from the song recording. `generate` transcribes the song
// (ASR word timestamps → lines, domain/songSync.ts wordsToLines), then translates the lines and picks
// their gaps; `align` times the typed lyrics against the words heard (alignLyricTimes). Without AI the
// route answers source 'demo' (align spreads the lines evenly; generate returns no lines).

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

/** The multipart fields besides the audio ("lines" arrives as a JSON string). */
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
