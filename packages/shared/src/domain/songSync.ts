// PROD: timed song lyrics. LyricLine.t (seconds) lets the player follow the recording; the admin's
// song lyrics tool builds or times lyrics from the ASR word timestamps of the song.

/** A recognised word with its start/end in seconds; `seg` = the ASR segment it came from. */
export interface SongWord {
  w: string;
  s: number;
  e?: number;
  seg?: number;
}

type TimedWord = SongWord & { e: number };

const round1 = (x: number) => Math.round(x * 10) / 10;
const isTime = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Lowercased, accent-free word tokens (apostrophes kept inside words) for matching lyrics to audio. */
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
 * Start time of every line, or null when no line has one. Lines without a time are spread evenly
 * between their timed neighbours (after the last timed line, up to `duration`).
 */
export function lineTimes(lyrics: readonly { t?: number }[], duration: number): number[] | null {
  const n = lyrics.length;
  const known = lyrics.map((l) => (isTime(l.t) ? l.t : null));
  if (!n || known.every((x) => x === null)) return null;
  const out: number[] = new Array(n).fill(0);
  let prevI = -1;
  let prevT = 0;
  for (let i = 0; i <= n; i++) {
    const k = i < n ? (known[i] ?? null) : null;
    if (i < n && k === null) continue;
    const endT = k !== null ? k : Math.max(prevT, duration > 0 ? duration : prevT + 3 * (i - prevI));
    const run = i - prevI;
    for (let j = prevI + 1; j < i; j++) out[j] = prevT + ((endT - prevT) * (j - prevI)) / run;
    if (k !== null) {
      out[i] = k;
      prevI = i;
      prevT = k;
    }
  }
  return out;
}

/**
 * The line to highlight at `time` (seconds). Follows the line times when any line has one (`lead`
 * seconds early), else the prototype's proportional highlight.
 */
export function activeLine(lyrics: readonly { t?: number }[], time: number, duration: number, lead = 0.25): number {
  const n = lyrics.length;
  if (!n) return 0;
  const times = lineTimes(lyrics, duration);
  if (!times) return Math.min(n - 1, Math.max(0, Math.floor((time / (duration || 1)) * n)));
  let at = 0;
  for (let i = 0; i < n && (times[i] as number) <= time + lead; i++) at = i;
  return at;
}

/**
 * Index of the first timed line that starts before the previous timed line (the editor flags it),
 * or -1 when the times only go forward.
 */
export function firstOutOfOrder(lyrics: readonly { t?: unknown }[]): number {
  let prev = -1;
  for (let i = 0; i < lyrics.length; i++) {
    const t = lyrics[i]?.t;
    if (!isTime(t)) continue;
    if (t < prev) return i;
    prev = t;
  }
  return -1;
}

/** Whisper's usual hallucinations on music (credits, "thanks for watching"). */
const HALLUCINATION = /^(thanks? (you )?for watching|please subscribe|subtitles? by|legendas? (por|pela)|amara\.org)/i;

/** Drops untimed words, bracketed/parenthesised noise ("[Music]", "(laughs)") and pure symbols (♪). */
function cleanWords(words: readonly SongWord[]): TimedWord[] {
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

function lineText(ws: readonly SongWord[]): string {
  const s = ws
    .map((x) => x.w)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface WordsToLinesOptions {
  /** Silence (s) that starts a new line. */
  pause?: number;
  maxWords?: number;
}

/**
 * Groups recognised words into lyric lines: a new line on a new ASR segment, a pause, a sentence end
 * (3+ words), a comma (5+ words) or `maxWords`. Each line starts at its first word.
 */
export function wordsToLines(words: readonly SongWord[], opts: WordsToLinesOptions = {}): { en: string; t: number }[] {
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
    .map((line) => ({ en: lineText(line), t: round1((line[0] as TimedWord).s) }))
    .filter((l) => songTokens(l.en).length > 0 && !HALLUCINATION.test(l.en));
}

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

/** Same word, ignoring apostrophes; words of 4+ letters may differ by one edit. */
function sameWord(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a === b || a.replace(/'/g, '') === b.replace(/'/g, '')) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return editDist(a, b) <= 1;
}

/** Alignment table size cap (lyric tokens × heard tokens); beyond it the lines are spread evenly. */
const MAX_CELLS = 4_000_000;

/**
 * Times typed lyric lines against the recognised words (edit-distance alignment of the tokens). A line
 * is `heard` when enough of its words matched in order; the others get interpolated times.
 */
export function alignLyricTimes(
  lines: readonly string[],
  words: readonly SongWord[],
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

  // D = edit distance; back = 1 diagonal, 2 up (skip a lyric token), 3 left (skip a heard token).
  const cols = b + 1;
  const D = new Int32Array((a + 1) * cols);
  const back = new Uint8Array((a + 1) * cols);
  for (let i = 1; i <= a; i++) {
    D[i * cols] = i;
    back[i * cols] = 2;
  }
  for (let i = 1; i <= a; i++) {
    const li = L[i - 1]?.tok;
    for (let j = 1; j <= b; j++) {
      const diag = (D[(i - 1) * cols + j - 1] as number) + (sameWord(li, W[j - 1]?.tok) ? 0 : 1);
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
  // The lyrics may cover only part of the recording: end at the best column of the last row.
  let j = 0;
  for (let k = 1; k <= b; k++) if ((D[a * cols + k] as number) < (D[a * cols + j] as number)) j = k;
  let i = a;
  const matchOf: (number | null)[] = new Array(a).fill(null);
  while (i > 0) {
    const dir = j === 0 ? 2 : back[i * cols + j];
    if (dir === 1) {
      if (sameWord(L[i - 1]?.tok, W[j - 1]?.tok)) matchOf[i - 1] = j - 1;
      i--;
      j--;
    } else if (dir === 2) i--;
    else j--;
  }

  const tokCount: number[] = new Array(n).fill(0);
  const hits: number[] = new Array(n).fill(0);
  const first: (number | null)[] = new Array(n).fill(null);
  L.forEach((x, k) => {
    tokCount[x.line] = (tokCount[x.line] as number) + 1;
    const m = matchOf[k];
    if (m === null || m === undefined) return;
    hits[x.line] = (hits[x.line] as number) + 1;
    if (first[x.line] === null) {
      // The line starts about 0.3 s per word before its first matched word.
      first[x.line] = Math.max(0, (W[m]?.s as number) - 0.3 * x.pos);
    }
  });
  const known: { t?: number }[] = lines.map((_, li) => {
    const need = (tokCount[li] as number) >= 3 ? 2 : 1;
    const f = first[li];
    return (hits[li] as number) >= need && f !== null && f !== undefined ? { t: f } : {};
  });
  // Keep the times increasing: a line heard earlier than its predecessor is treated as unheard.
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

/** Words never chosen as the karaoke gap when the line has a better one. */
const STOP = new Set(
  "a an the and or but so to of in on at for with from by is are am was were be been i you he she it we they me him her us them my your his its our their i'm you're it's that's this that oh yeah hey la na".split(
    ' ',
  ),
);

const TRIM_WORD = /^[^A-Za-z0-9À-ÿ']+|[^A-Za-z0-9À-ÿ']+$/g;

/** The gap word as written in the line (punctuation trimmed), or null when `gap` is not one of its words. */
export function gapIn(en: string, gap: string | null | undefined): string | null {
  const want = songTokens(String(gap ?? ''));
  if (want.length !== 1) return null;
  for (const raw of String(en).split(/\s+/)) {
    const tok = songTokens(raw);
    if (tok.length === 1 && tok[0] === want[0]) return raw.replace(TRIM_WORD, '');
  }
  return null;
}

/** A karaoke gap for a line: its longest non-stop word (the last one on a tie). */
export function pickGap(en: string): string {
  let best = '';
  let bestLen = -1;
  for (const raw of String(en).split(/\s+/)) {
    const w = raw.replace(TRIM_WORD, '');
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
