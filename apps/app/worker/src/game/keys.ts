// Award keys for the client-attested events of POST /api/game/event (spec 04 §2 "Award keys").
// The client sends only a suffix; the server owns the prefix, the date and the normalization.
import { ApiError, type GameEventBody, norm } from '@tie/shared';
import { localDate, one } from '@tie/worker-core';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const QUIZ_RE = /^([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64})$/;
/** Take the Lead's scope (`lead-eb{n}:{turn}`): the turn must be one of that e-book's scripted turns. */
const LEAD_RE = /^lead-eb(\d{1,4})$/;
/** Longest norm()ed word or phrase accepted as a `word:` key. */
const WORD_MAX = 120;

function invalid(field: string, message: string): ApiError {
  return new ApiError('validation_failed', undefined, {
    issues: [{ path: field, code: 'custom', message }],
  });
}

/**
 * Builds the full award key for a soft event:
 * - song → `song:{ep}` or `song:{trackId}`; the episode must be published or the album track must exist.
 * - quiz_hit → `quiz:{scope}:{q}:{date}`, date in the user's timezone (one hit per question a day);
 *   a Take the Lead scope (`lead-eb{n}`) only accepts 0 ≤ q < that e-book's number of turns.
 * - word → `word:{norm(word)}`.
 */
export async function softAwardKey(
  db: D1Database,
  body: GameEventBody,
  tz: string,
  now: number = Date.now(),
): Promise<string> {
  const raw = body.key.trim();
  switch (body.kind) {
    case 'song': {
      if (!ID_RE.test(raw)) throw invalid('key', 'song key must be an episode number or a track id');
      const known = /^\d+$/.test(raw)
        ? await one(db, "SELECT 1 AS ok FROM episodes WHERE num = ? AND status = 'published'", Number(raw))
        : await one(db, 'SELECT 1 AS ok FROM album_tracks WHERE id = ?', raw);
      if (!known) throw new ApiError('not_found');
      return `song:${/^\d+$/.test(raw) ? Number(raw) : raw}`;
    }
    case 'quiz_hit': {
      const m = QUIZ_RE.exec(raw);
      if (!m) throw invalid('key', 'quiz key must look like {scope}:{question}');
      const lead = LEAD_RE.exec(m[1] ?? '');
      if (lead) {
        // Only the e-book's real turns pay (forged turn numbers would farm the daily quiz cap).
        const turn = /^\d{1,4}$/.test(m[2] ?? '') ? Number(m[2]) : -1;
        const row = await one<{ turns: number }>(
          db,
          'SELECT json_array_length(lead) AS turns FROM ebooks WHERE num = ?',
          Number(lead[1]),
        );
        if (!row || turn < 0 || turn >= row.turns) throw invalid('key', 'unknown Take the Lead turn');
      }
      return `quiz:${m[1]}:${m[2]}:${localDate(now, tz)}`;
    }
    case 'word': {
      const w = norm(raw);
      if (!w || w.length > WORD_MAX) throw invalid('key', 'word key must be a word or short phrase');
      return `word:${w}`;
    }
  }
}
