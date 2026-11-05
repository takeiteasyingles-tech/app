// Song lyrics ↔ recording timing (PROD; spec 05 "Accepted production deviations"). The prototype moved the
// lyric highlight proportionally (time / duration × lines). A lyric line may now carry `t`, its start
// in seconds in the episode recording: the student player follows those times, and tie-admin fills them
// from the audio (Whisper word timestamps), either by transcribing a new song into lines or by aligning
// the lyrics already typed. Pure: shared by the student player, the admin worker and the tests.

/** A transcribed word: text as heard, start and end in seconds, and the ASR segment it came from. */
export interface TimedWord {
  w: string;
  s: number;
  e: number;
  seg?: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const isTime = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/**
 * Lowercase word tokens for matching sung text: accents and curly quotes folded, punctuation dropped,
 * inner apostrophes kept ("i'm", "don't").
 */
export function songTokens(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/**
 * Times of every line, `t` where it is set and interpolated elsewhere: between the known neighbours, from
 * 0 before the first known time and up to `duration` after the last one. Null when no line has a time
 * (the player then keeps the prototype's proportional highlight).
 */
export function lineTimes(lyrics: readonly { t?: number | null }[], duration: number): number[] | null {
  const n = lyrics.length;
  const known = lyrics.map((l) => (isTime(l.t) ? (l.t as number) : null));
  if (!n || known.every((x) => x === null)) return null;
  const out: number[] = new Array(n).fill(0);
  let prevI = -1;
  let prevT = 0;
  for (let i = 0; i <= n; i++) {
    const k = i < n ? known[i] : null;
    if (i < n && k === null) continue;
    // Fill the run (prevI, i) between prevT and the next known time (or the end of the song).
    const endT = i < n ? (k as number) : Math.max(prevT, duration > 0 ? duration : prevT + 3 * (i - prevI));
    const run = i - prevI;
    for (let j = prevI + 1; j < i; j++) out[j] = prevT + ((endT - prevT) * (j - prevI)) / run;
    if (i < n) {
      out[i] = k as number;
      prevI = i;
      prevT = k as number;
    }
  }
  return out;
}

/**
 * Index of the lyric line being sung at `at` seconds. With line times it is the last line that has
 * started (`lead` seconds early, so the eye gets there with the voice); without them the prototype's
 * proportional rule.
 */
export function lyricLineAt(
  lyrics: readonly { t?: number | null }[],
  at: number,
  duration: number,
  lead = 0.25,
): number {
  const n = lyrics.length;
  if (!n) return 0;
  const times = lineTimes(lyrics, duration);
  if (!times) return Math.min(n - 1, Math.max(0, Math.floor((at / (duration || 1)) * n)));
  let i = 0;
  for (let k = 0; k < n; k++) {
    if ((times[k] as number) <= at + lead) i = k;
    else break;
  }
  return i;
}

/** Index of the first line whose time goes backwards (lines must follow the song), or -1. */
export function lyricTimesOutOfOrder(lyrics: readonly { t?: number | null }[]): number {
  let last = -1;
  for (let i = 0; i < lyrics.length; i++) {
    const t = lyrics[i]?.t;
    if (!isTime(t)) continue;
    if (t < last) return i;
    last = t;
  }
  return -1;
}

// ---------- Generate: transcript words → lyric lines ----------

/** Lines ASR models invent over instrumental parts ("Thanks for watching!", subtitle credits). */
const HALLUCINATION = /^(thanks? (you )?for watching|please subscribe|subtitles? by|legendas? (por|pela)|amara\.org)/i;

/** Drops sound tags ("[Music]", "(upbeat music)", "♪") from transcript words. */
function cleanWords(words: readonly TimedWord[]): TimedWord[] {
  const out: TimedWord[] = [];
  let depth = 0;
  for (const x of words) {
    const raw = String(x.w ?? '').trim();
    if (!raw || !isTime(x.s)) continue;
    const opens = (raw.match(/[[(]/g) ?? []).length;
    const closes = (raw.match(/[\])]/g) ?? []).length;
    const inside = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    if (inside) continue;
    const w = raw.replace(/[♪♫*]/g, '').trim();
    if (!/[a-z0-9]/i.test(w)) continue;
    out.push({ ...x, w, e: isTime(x.e) ? Math.max(x.e, x.s) : x.s });
  }
  return out;
}

function lineText(ws: readonly TimedWord[]): string {
  const s = ws
    .map((x) => x.w)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Groups transcript words into lyric lines with their start time: a new line at each ASR segment, after
 * a sung pause (`pause` s), after . ! ? once the line has 3 words ("Hi! Hi! Good morning!" stays one
 * line), after a comma once the line is long, or at `maxWords`.
 */
export function wordsToLines(
  words: readonly TimedWord[],
  opts: { pause?: number; maxWords?: number } = {},
): { en: string; t: number }[] {
  const pause = opts.pause ?? 0.6;
  const maxWords = opts.maxWords ?? 9;
  const ws = cleanWords(words);
  const lines: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  for (const x of ws) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const brk =
        (x.seg !== undefined && prev.seg !== undefined && x.seg !== prev.seg) ||
        x.s - prev.e >= pause ||
        (/[.!?]["')]?$/.test(prev.w) && cur.length >= 3) ||
        (/,$/.test(prev.w) && cur.length >= 5) ||
        cur.length >= maxWords;
      if (brk) {
        lines.push(cur);
        cur = [];
      }
    }
    cur.push(x);
  }
  if (cur.length) lines.push(cur);
  return lines
    .map((ws) => ({ en: lineText(ws), t: round1((ws[0] as TimedWord).s) }))
    .filter((l) => songTokens(l.en).length > 0 && !HALLUCINATION.test(l.en));
}

// ---------- Align: typed lyrics + transcript words → line times ----------

function editDist(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n] as number;
}

/** Same sung word: apostrophes aside ("im"/"i'm"), with one slip allowed on longer words ("colour"/"color"). */
function sameWord(a: string, b: string): boolean {
  if (a === b || a.replace(/'/g, '') === b.replace(/'/g, '')) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return editDist(a, b) <= 1;
}

/** Largest alignment table (lyric tokens × heard tokens) worth computing; songs are far below it. */
const MAX_CELLS = 4_000_000;

/**
 * Start time of each typed lyric line in the recording. The lyric tokens are aligned to the heard words
 * (edit distance, free skips of what was heard before the first and after the last lyric word: spoken
 * intros, ad-libs); a line that matched enough of its words starts at its first matched word, earlier by
 * the words sung before it; the other lines are interpolated. `heard[i]` tells which lines came from the
 * recording. With nothing usable heard, the lines are spread evenly over the song.
 */
export function alignLyricTimes(
  lines: readonly string[],
  words: readonly TimedWord[],
  duration: number,
): { t: number[]; heard: boolean[] } {
  const n = lines.length;
  const heard: boolean[] = new Array(n).fill(false);
  if (!n) return { t: [], heard };
  const L: { tok: string; line: number; pos: number }[] = [];
  lines.forEach((text, line) => {
    songTokens(text).forEach((tok, pos) => {
      L.push({ tok, line, pos });
    });
  });
  const W: { tok: string; s: number }[] = [];
  for (const x of cleanWords(words)) for (const tok of songTokens(x.w)) W.push({ tok, s: x.s });
  const end = duration > 0 ? duration : (W[W.length - 1]?.s ?? 0) + 3;
  const even = () => {
    const from = W[0]?.s ?? 0;
    const span = Math.max(1, end - from);
    return { t: lines.map((_, i) => round1(from + (span * i) / n)), heard };
  };
  const a = L.length;
  const b = W.length;
  if (!a || !b || (a + 1) * (b + 1) > MAX_CELLS) return even();

  // D[i][j]: cost of aligning L[0..i) with W[0..j); skipping heard words before the lyrics is free.
  const cols = b + 1;
  const D = new Int32Array((a + 1) * cols);
  const back = new Uint8Array((a + 1) * cols); // 1 diag, 2 skip lyric token, 3 skip heard word
  for (let i = 1; i <= a; i++) {
    D[i * cols] = i;
    back[i * cols] = 2;
  }
  for (let i = 1; i <= a; i++) {
    const li = L[i - 1]?.tok as string;
    for (let j = 1; j <= b; j++) {
      const diag = (D[(i - 1) * cols + j - 1] as number) + (sameWord(li, W[j - 1]?.tok as string) ? 0 : 1);
      const up = (D[(i - 1) * cols + j] as number) + 1;
      const left = (D[i * cols + j - 1] as number) + 1;
      let best = diag;
      let dir = 1;
      if (up < best) {
        best = up;
        dir = 2;
      }
      if (left < best) {
        best = left;
        dir = 3;
      }
      D[i * cols + j] = best;
      back[i * cols + j] = dir;
    }
  }
  // Heard words after the last lyric word are free too: end at the best column of the last row.
  let j = 0;
  for (let k = 1; k <= b; k++) if ((D[a * cols + k] as number) < (D[a * cols + j] as number)) j = k;
  let i = a;
  const matchOf: (number | null)[] = new Array(a).fill(null);
  while (i > 0) {
    const dir = j === 0 ? 2 : (back[i * cols + j] as number);
    if (dir === 1) {
      if (sameWord(L[i - 1]?.tok as string, W[j - 1]?.tok as string)) matchOf[i - 1] = j - 1;
      i--;
      j--;
    } else if (dir === 2) i--;
    else j--;
  }

  const tokCount = new Array(n).fill(0);
  const hits = new Array(n).fill(0);
  const first: (number | null)[] = new Array(n).fill(null);
  L.forEach((x, k) => {
    tokCount[x.line]++;
    const m = matchOf[k];
    if (m === null || m === undefined) return;
    hits[x.line]++;
    if (first[x.line] === null) {
      // ~0.3 s per word sung before the first one recognised.
      first[x.line] = Math.max(0, (W[m]?.s as number) - 0.3 * x.pos);
    }
  });
  const known: { t?: number }[] = lines.map((_, li) => {
    const need = tokCount[li] >= 3 ? 2 : 1;
    const f = first[li];
    return hits[li] >= need && f !== null && f !== undefined ? { t: f } : {};
  });
  // Keep the timeline moving forward: a heard line earlier than the one before it is dropped.
  let last = -1;
  for (let li = 0; li < n; li++) {
    const t = known[li]?.t;
    if (t === undefined) continue;
    if (t < last) {
      known[li] = {};
      continue;
    }
    last = t;
    heard[li] = true;
  }
  if (!heard.some(Boolean)) return even();
  const times = lineTimes(known, end) as number[];
  return { t: times.map(round1), heard };
}

// ---------- Gaps ----------

const STOP = new Set(
  "a an the and or but so to of in on at for with from by is are am was were be been i you he she it we they me him her us them my your his its our their i'm you're it's that's this that oh yeah hey la na".split(
    ' ',
  ),
);

/** The word of `en` that matches `gap` (any case), as written in the line without punctuation, or null. */
export function gapIn(en: string, gap: string | null | undefined): string | null {
  const want = songTokens(String(gap ?? ''));
  if (want.length !== 1) return null;
  for (const raw of String(en).split(/\s+/)) {
    const tok = songTokens(raw);
    if (tok.length === 1 && tok[0] === want[0]) return raw.replace(/^[^A-Za-z0-9À-ÿ']+|[^A-Za-z0-9À-ÿ']+$/g, '');
  }
  return null;
}

/** A karaoke gap when none was chosen: the longest meaningful word of the line (the last one on a tie). */
export function pickGap(en: string): string {
  let best = '';
  let bestLen = -1;
  for (const raw of String(en).split(/\s+/)) {
    const w = raw.replace(/^[^A-Za-z0-9À-ÿ']+|[^A-Za-z0-9À-ÿ']+$/g, '');
    const tok = songTokens(w)[0];
    if (!tok) continue;
    const score = (STOP.has(tok) ? 0 : 100) + tok.length;
    if (score >= bestLen) {
      best = w;
      bestLen = score;
    }
  }
  return best;
}
