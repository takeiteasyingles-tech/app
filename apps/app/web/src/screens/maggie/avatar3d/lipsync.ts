// PROD: lip sync for the 3D avatar (no three.js here, so it is testable on its own). A line's text
// becomes visemes (letters and digraphs → mouth shapes), timed either by the TTS word spans
// (X-TTS-Words) or, without them, by aligning the words to the voiced segments of the audio's energy
// envelope. The renderer samples the keys every frame: blend-shape weights plus lip-bone offsets.

/** Visemes (Oculus/ARKit-style names). */
export type Viseme =
  | 'sil'
  | 'aa'
  | 'E'
  | 'I'
  | 'O'
  | 'U'
  | 'RR'
  | 'PP'
  | 'FF'
  | 'TH'
  | 'DD'
  | 'kk'
  | 'CH'
  | 'SS'
  | 'HH';

/** Mouth blend shapes of the model, driven by the visemes. */
export const MOUTH_SHAPES = [
  'mouthRound',
  'mouthWide',
  'mouthPress',
  'mouthFunnel',
  'lowerLipF',
  'upperLipUp',
  'lowerLipDown',
] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];

/** Open vowels: their peak comes later in the slot (50% instead of 40%). */
const OPEN = new Set<Viseme>(['aa', 'E', 'I', 'O', 'U', 'RR']);

/** Relative duration of each viseme inside a word. */
const WEIGHT: Partial<Record<Viseme, number>> = {
  aa: 2,
  E: 2,
  I: 1.8,
  O: 2,
  U: 1.8,
  RR: 1.6,
  PP: 1.3,
  FF: 1.2,
  HH: 0.6,
};
const weight = (v: Viseme): number => WEIGHT[v] ?? 1;

export type Pose = { jaw: number } & Partial<Record<MouthShape, number>>;

/** Jaw opening and blend-shape weights of each viseme. */
export const VISEME_POSE: Readonly<Record<Viseme, Pose>> = {
  sil: { jaw: 0 },
  aa: { jaw: 0.7, mouthWide: 0.34, upperLipUp: 0.26, lowerLipDown: 0.26 },
  E: { jaw: 0.53, mouthWide: 0.55, upperLipUp: 0.18, lowerLipDown: 0.17 },
  I: { jaw: 0.35, mouthWide: 0.59, upperLipUp: 0.27, lowerLipDown: 0.23 },
  O: { jaw: 0.65, mouthRound: 0.34, mouthWide: 0.39, upperLipUp: 0.22, lowerLipDown: 0.27 },
  U: { jaw: 0.46, mouthRound: 0.69, mouthFunnel: 0.2, upperLipUp: 0.14, lowerLipDown: 0.23 },
  RR: { jaw: 0.37, mouthRound: 0.3 },
  PP: { jaw: 0, mouthPress: 0.73, lowerLipF: 0.3 },
  FF: { jaw: 0.28, mouthWide: 0.2, lowerLipF: 0.64, upperLipUp: 0.38 },
  TH: { jaw: 0.31, mouthWide: 0.39, upperLipUp: 0.29 },
  DD: { jaw: 0.5, mouthWide: 0.49, upperLipUp: 0.42, lowerLipDown: 0.29 },
  kk: { jaw: 0.41, mouthWide: 0.13, upperLipUp: 0.18 },
  CH: { jaw: 0.12, mouthFunnel: 1, upperLipUp: 0.3 },
  SS: { jaw: 0.21, mouthWide: 0.59, upperLipUp: 0.52 },
  HH: { jaw: 0.6, mouthWide: 0.33, lowerLipDown: 0.13 },
};

/** Lip bones of the rig; the last one (chin) also carries the jaw when the rig has them. */
export const LIP_BONES = [
  'lipCorner.L',
  'lipUp.L',
  'lipUp',
  'lipUp.R',
  'lipCorner.R',
  'lipLow.L',
  'lipLow.C',
  'lipLow.R',
  'chin',
] as const;

type Offsets = readonly (readonly [number, number])[];
const ZERO: Offsets = LIP_BONES.map(() => [0, 0] as const);

/** Per viseme, [x, y] offset of each LIP_BONES bone in millimetres (head space; +y is down). */
export const LIP_OFFSETS: Readonly<Record<Viseme, Offsets>> = {
  sil: ZERO,
  aa: [
    [-1.8, 0.1],
    [-2, -3.4],
    [0, -3.6],
    [1.2, -3.4],
    [2, -0.1],
    [-1.9, 6.6],
    [-0.1, 7.5],
    [1.4, 6.9],
    [-0.1, 4.6],
  ],
  E: [
    [-2.6, -4.7],
    [-1.4, -4.3],
    [-0.1, -4.3],
    [1.1, -4.3],
    [2, -3.9],
    [-2, 3.1],
    [-0.3, 5.3],
    [0.7, 3.6],
    [-0.5, -0.3],
  ],
  I: [
    [-6.3, -0.2],
    [-2.9, -3.4],
    [-0.1, -3.8],
    [2.3, -3.3],
    [3.5, 0.1],
    [-3.9, 10.3],
    [-0.4, 12.9],
    [2, 10.7],
    [-0.8, 6.7],
  ],
  O: [
    [1.3, 2.8],
    [0, 0],
    [-0.1, -2.4],
    [-0.5, 0.6],
    [-0.6, 2.7],
    [-0.8, 4.8],
    [-0.3, 6.6],
    [-0.7, 4.8],
    [-0.9, 2.6],
  ],
  U: [
    [4.4, 2.6],
    [0.5, -1.2],
    [-0.5, -2.6],
    [-0.9, -1.3],
    [-2.6, 3.5],
    [0.1, 6.2],
    [-0.4, 7.8],
    [-0.5, 7],
    [-1, 8],
  ],
  RR: [
    [1.5, -0.2],
    [-0.1, -2.8],
    [-0.4, -3.2],
    [-0.3, -2.9],
    [-0.7, -0.2],
    [-0.6, 4],
    [-0.4, 5.7],
    [-0.2, 3.6],
    [-0.4, 1.3],
  ],
  PP: ZERO,
  FF: [
    [-0.1, 1.1],
    [-1.5, -5.4],
    [-0.2, -6.8],
    [0.8, -4.9],
    [0.4, 2.3],
    [-1.4, 1.1],
    [-0.1, 0.6],
    [0.6, 1.7],
    [0.8, 4.2],
  ],
  TH: [
    [-3.5, -2.1],
    [-1.6, -5.5],
    [-0.4, -6.3],
    [1.7, -5.1],
    [1.9, -1.1],
    [-2.9, 10.9],
    [-1, 14.6],
    [0.5, 11.1],
    [-1, 8],
  ],
  DD: [
    [-3.3, -0.8],
    [-2, -4.3],
    [0, -4.9],
    [2.1, -4.3],
    [3, -1.1],
    [-2.3, 6.3],
    [-0.3, 7.8],
    [2, 5.9],
    [-0.4, 4.2],
  ],
  kk: [
    [-4.7, -2.8],
    [-2.3, -3.4],
    [-0.2, -3.9],
    [0.6, -3],
    [1.6, -1.3],
    [-3.5, 4.8],
    [-0.5, 5.6],
    [1, 4.4],
    [-0.8, 1],
  ],
  CH: [
    [4.2, 3],
    [0.1, -2.8],
    [-0.4, -4.1],
    [1.8, -2.6],
    [1.6, 3.5],
    [-0.7, 5.7],
    [-0.5, 5.9],
    [0.9, 5.8],
    [-0.1, 4.7],
  ],
  SS: [
    [4.2, 3],
    [0.1, -2.8],
    [-0.4, -4.1],
    [1.8, -2.6],
    [1.6, 3.5],
    [-0.7, 5.7],
    [-0.5, 5.9],
    [0.9, 5.8],
    [-0.1, 4.7],
  ],
  HH: [
    [-2.2, -6.8],
    [-1.1, -4.4],
    [0.6, -3.7],
    [1.7, -4.9],
    [2.8, -6.6],
    [-1.3, -5.3],
    [0.5, -5.3],
    [1.5, -6.2],
    [0.9, -11.5],
  ],
};

/** Spellings read before single letters, longest first where they overlap. */
const DIGRAPHS: readonly (readonly [string, readonly Viseme[]])[] = [
  ['tion', ['CH', 'aa', 'DD']],
  ['sion', ['CH', 'aa', 'DD']],
  ['igh', ['aa', 'I']],
  ['tch', ['CH']],
  ['ch', ['CH']],
  ['sh', ['CH']],
  ['th', ['TH']],
  ['ph', ['FF']],
  ['wh', ['U']],
  ['ck', ['kk']],
  ['ng', ['kk']],
  ['qu', ['kk', 'U']],
  ['ee', ['I']],
  ['ea', ['I']],
  ['ie', ['I']],
  ['ay', ['E', 'I']],
  ['ai', ['E', 'I']],
  ['ei', ['E', 'I']],
  ['oy', ['O', 'I']],
  ['oi', ['O', 'I']],
  ['oo', ['U']],
  ['ou', ['U']],
  ['ow', ['O', 'U']],
  ['oa', ['O']],
  ['au', ['O']],
  ['aw', ['O']],
  ['ew', ['U']],
  ['er', ['RR']],
  ['ir', ['RR']],
  ['ur', ['RR']],
  ['or', ['O', 'RR']],
  ['ar', ['aa', 'RR']],
];

const LETTERS: Readonly<Record<string, Viseme>> = {
  a: 'aa',
  e: 'E',
  i: 'I',
  o: 'O',
  w: 'U',
  r: 'RR',
  l: 'DD',
  t: 'DD',
  d: 'DD',
  n: 'DD',
  s: 'SS',
  z: 'SS',
  k: 'kk',
  g: 'kk',
  q: 'kk',
  j: 'CH',
  p: 'PP',
  b: 'PP',
  m: 'PP',
  f: 'FF',
  v: 'FF',
  h: 'HH',
  y: 'I',
};

/** A word's visemes from its spelling (silent final e dropped, doubled consonants once, no repeats). */
export function wordVisemes(word: string): Viseme[] {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length > 2 && w.endsWith('e') && !/[aeiouy]e$/.test(w)) w = w.slice(0, -1);
  const out: Viseme[] = [];
  for (let i = 0; i < w.length; ) {
    const dg = DIGRAPHS.find(([sp]) => w.startsWith(sp, i));
    if (dg) {
      out.push(...dg[1]);
      i += dg[0].length;
      continue;
    }
    const ch = w[i] as string;
    const next = w[i + 1];
    if (ch === next && !'aeiou'.includes(ch)) {
      i++;
      continue;
    }
    if (ch === 'c') out.push(next && 'eiy'.includes(next) ? 'SS' : 'kk');
    else if (ch === 'x') out.push('kk', 'SS');
    else if (ch === 'u') out.push(i === w.length - 1 || next === 'e' ? 'U' : 'aa');
    else {
      const v = LETTERS[ch];
      if (v) out.push(v);
    }
    i++;
  }
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

/**
 * Energy envelope of the audio: one value per 10 ms (30 ms window) of the 1 kHz low-passed signal,
 * normalized to its 95th percentile (0..1).
 */
export function envelope(audio: AudioBuffer): Float32Array {
  const data = audio.getChannelData(0);
  const rate = audio.sampleRate;
  const hop = Math.round(rate / 100);
  const win = Math.round(rate * 0.03);
  const k = 1 - Math.exp((-2 * Math.PI * 1000) / rate);
  const low = new Float32Array(data.length);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += k * ((data[i] ?? 0) - y);
    low[i] = y;
  }
  const n = Math.floor(data.length / hop);
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    const a = f * hop;
    const b = Math.min(data.length, a + win);
    for (let i = a; i < b; i++) sum += (low[i] ?? 0) ** 2;
    env[f] = Math.sqrt(sum / Math.max(1, b - a));
  }
  const ref = [...env].sort((a, b) => a - b)[Math.floor(n * 0.95)] || 1;
  return env.map((v) => Math.min(1, v / ref));
}

/**
 * Voiced segments [start, end] in seconds: frames above `threshold`, gaps shorter than `mergeGap`
 * frames merged, segments shorter than `minLen` frames dropped.
 */
export function voicedSegments(
  env: ArrayLike<number>,
  threshold = 0.07,
  mergeGap = 7,
  minLen = 12,
): [number, number][] {
  const raw: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= env.length; i++) {
    const on = i < env.length && (env[i] ?? 0) > threshold;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      raw.push([start, i]);
      start = -1;
    }
  }
  const merged: [number, number][] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && seg[0] - last[1] < mergeGap) last[1] = seg[1];
    else merged.push([seg[0], seg[1]]);
  }
  return merged.filter(([a, b]) => b - a >= minLen).map(([a, b]) => [a / 100, b / 100]);
}

/** A viseme key: the mouth reaches viseme `v` at time `t` (seconds into the audio). */
export interface VisemeKey {
  t: number;
  v: Viseme;
}

/** A word's start/end in seconds (X-TTS-Words). */
export interface WordTime {
  s: number;
  e: number;
}

/** Keys from the TTS word timings: each word's visemes spread over its span, rests between words. */
function keysFromWordTimes(words: readonly string[], times: readonly WordTime[]): VisemeKey[] {
  const keys: VisemeKey[] = [];
  let lastEnd = -1;
  words.forEach((word, i) => {
    const vis = wordVisemes(word);
    const time = times[i];
    if (!vis.length || !time) return;
    if (lastEnd < 0 || time.s - lastEnd > 0.14) {
      if (lastEnd >= 0) keys.push({ t: lastEnd + 0.07, v: 'sil' });
      keys.push({ t: Math.max(0, time.s - 0.06, lastEnd + 0.08), v: 'sil' });
    }
    const span = Math.max(0.06, time.e - time.s);
    const total = vis.reduce((a, v) => a + weight(v), 0);
    let at = time.s;
    for (const v of vis) {
      const d = (weight(v) / total) * span;
      keys.push({ t: at + d * (OPEN.has(v) ? 0.5 : 0.4), v });
      at += d;
    }
    lastEnd = Math.max(lastEnd, time.e);
  });
  if (lastEnd >= 0) keys.push({ t: lastEnd + 0.07, v: 'sil' });
  const out: VisemeKey[] = [];
  for (const k of keys) {
    const prev = out[out.length - 1];
    if (!prev || k.t > prev.t + 1e-3) out.push(k);
  }
  return out;
}

interface WordInfo {
  vis: Viseme[];
  cost: number;
  /** 1 after a sentence end, .7 after a comma: a good place for a pause. */
  punct: number;
  time?: WordTime;
}

/**
 * Viseme keys for a spoken line. With one timing per word, the keys follow them. Otherwise the words
 * are aligned to the audio's voiced segments by dynamic programming: each segment takes a run of
 * words whose share of the line's length matches the segment's share of the voiced time, pauses
 * prefer punctuation, and any partial word timings pull words toward their own segment.
 */
export function visemeKeys(
  text: string,
  env: ArrayLike<number>,
  times: readonly WordTime[] | null = null,
): VisemeKey[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (times && times.length === tokens.length && tokens.length) {
    const keys = keysFromWordTimes(tokens, times);
    if (keys.length) return keys;
  }
  const timed = times && times.length === tokens.length ? times : null;
  const words: WordInfo[] = tokens
    .map((w, i) => {
      const vis = wordVisemes(w);
      const punct = /(\.\.\.|[.!?…])["')]*$/.test(w) ? 1 : /[,;:]["')]*$/.test(w) ? 0.7 : 0;
      const info: WordInfo = { vis, cost: vis.reduce((a, v) => a + weight(v), 0) || 1, punct };
      const t = timed?.[i];
      if (t) info.time = t;
      return info;
    })
    .filter((w) => w.vis.length);

  const segs: [number, number][] = [];
  for (const [a, b] of voicedSegments(env)) {
    const last = segs[segs.length - 1];
    if (last && a - last[1] < 0.14) last[1] = b;
    else segs.push([a, b]);
  }
  const W = words.length;
  if (!segs.length || !W) return [];
  // More segments than words: merge the pair with the smallest gap until they fit.
  while (segs.length > W) {
    let best = 0;
    for (let i = 1; i < segs.length - 1; i++) {
      const gap = (segs[i + 1] as [number, number])[0] - (segs[i] as [number, number])[1];
      const bestGap = (segs[best + 1] as [number, number])[0] - (segs[best] as [number, number])[1];
      if (gap < bestGap) best = i;
    }
    const a = segs[best] as [number, number];
    const b = segs[best + 1] as [number, number];
    segs.splice(best, 2, [a[0], b[1]]);
  }

  const S = segs.length;
  const totalCost = words.reduce((a, w) => a + w.cost, 0);
  const durs = segs.map(([a, b]) => b - a);
  const totalDur = durs.reduce((a, d) => a + d, 0);
  const costPrefix = [0];
  for (const w of words) costPrefix.push((costPrefix[costPrefix.length - 1] as number) + w.cost);
  // Per segment, prefix sums of how far each word's own timing is from the segment.
  const offPrefix = segs.map(([a, b]) => {
    const acc = [0];
    words.forEach((w, i) => {
      const mid = w.time ? (w.time.s + w.time.e) / 2 : 0;
      acc.push((acc[i] as number) + (w.time ? Math.max(0, a - 0.15 - mid, mid - b - 0.15) : 0));
    });
    return acc;
  });
  const at = (arr: readonly number[], i: number) => arr[i] as number;
  /** Mismatch of segment s taking words [from, to]. */
  const cost = (s: number, from: number, to: number) =>
    Math.abs((at(costPrefix, to + 1) - at(costPrefix, from)) / totalCost - (durs[s] as number) / totalDur) +
    0.5 * (at(offPrefix[s] as number[], to + 1) - at(offPrefix[s] as number[], from));
  const punctAt = (end: number) => (words[end - 1] as WordInfo).punct;

  const score = Array.from({ length: S }, () => new Float64Array(W + 1).fill(-Infinity));
  const back = Array.from({ length: S }, () => new Int32Array(W + 1).fill(-1));
  const first = score[0] as Float64Array;
  first[0] = -0.8 - (3 * (durs[0] as number)) / totalDur;
  for (let j = 1; j <= W; j++) first[j] = -3 * cost(0, 0, j - 1) + (S > 1 ? punctAt(j) : 0);
  for (let s = 1; s < S; s++) {
    const prev = score[s - 1] as Float64Array;
    const cur = score[s] as Float64Array;
    const bk = back[s] as Int32Array;
    for (let j = 0; j <= W; j++) {
      // An empty segment (breath, noise).
      if (prev[j] !== -Infinity) {
        cur[j] = (prev[j] as number) - 0.8 - (3 * (durs[s] as number)) / totalDur;
        bk[j] = j;
      }
      for (let i = 0; i < j; i++) {
        if (prev[i] === -Infinity) continue;
        const v = (prev[i] as number) - 3 * cost(s, i, j - 1) + (s < S - 1 ? punctAt(j) : 0);
        if (v > (cur[j] as number)) {
          cur[j] = v;
          bk[j] = i;
        }
      }
    }
  }
  const ends: number[] = Array(S);
  let j = W;
  for (let s = S - 1; s >= 0; s--) {
    ends[s] = j;
    if (s > 0) j = (back[s] as Int32Array)[j] as number;
  }

  const keys: VisemeKey[] = [];
  let from = 0;
  segs.forEach(([a, b], s) => {
    const group = words.slice(from, ends[s]);
    from = ends[s] as number;
    if (!group.length) {
      // Voice with no words: a breath.
      if (b - a > 0.2) keys.push({ t: a - 0.06, v: 'sil' }, { t: (a + b) / 2, v: 'HH' }, { t: b + 0.07, v: 'sil' });
      return;
    }
    const vis = group.flatMap((w) => w.vis);
    const total = vis.reduce((acc, v) => acc + weight(v), 0);
    keys.push({ t: Math.max(0, a - 0.06), v: 'sil' });
    let t = a;
    for (const v of vis) {
      const d = (weight(v) / total) * (b - a);
      keys.push({ t: t + d * (OPEN.has(v) ? 0.5 : 0.4), v });
      t += d;
    }
    keys.push({ t: b + 0.07, v: 'sil' });
  });
  return keys;
}

export type MouthPose = { jaw: number; v: Viseme } & Record<MouthShape, number>;

const REST: MouthPose = {
  jaw: 0,
  v: 'sil',
  ...(Object.fromEntries(MOUTH_SHAPES.map((k) => [k, 0])) as Record<MouthShape, number>),
};
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Mouth pose at time t: smoothstep between the surrounding keys. */
export function poseAt(keys: readonly VisemeKey[], t: number): MouthPose {
  const head = keys[0];
  if (!head || t <= head.t) return REST;
  const i = keys.findIndex((k) => k.t > t);
  if (i < 0) return REST;
  const a = keys[i - 1] as VisemeKey;
  const b = keys[i] as VisemeKey;
  const x = smooth((t - a.t) / Math.max(1e-3, b.t - a.t));
  const pa = VISEME_POSE[a.v];
  const pb = VISEME_POSE[b.v];
  const out = { jaw: pa.jaw + (pb.jaw - pa.jaw) * x, v: x < 0.5 ? a.v : b.v } as MouthPose;
  for (const k of MOUTH_SHAPES) out[k] = (pa[k] ?? 0) + ((pb[k] ?? 0) - (pa[k] ?? 0)) * x;
  return out;
}

/** How far ahead rounding is anticipated (lips round before the vowel sounds). */
const ROUND_LOOKAHEAD = 0.09;

/** poseAt with coarticulation: rounding and funnelling start ahead of the vowel. */
export function poseWithLookahead(keys: readonly VisemeKey[], t: number): MouthPose {
  const now = { ...poseAt(keys, t) };
  const ahead = poseAt(keys, t + ROUND_LOOKAHEAD);
  now.mouthRound = Math.max(now.mouthRound, 0.6 * ahead.mouthRound);
  now.mouthFunnel = Math.max(now.mouthFunnel, 0.6 * ahead.mouthFunnel);
  return now;
}

/** Lip-bone offsets (mm) at time t, interpolated like poseAt. */
export function lipOffsetsAt(keys: readonly VisemeKey[], t: number): [number, number][] {
  const zero = () => LIP_BONES.map(() => [0, 0] as [number, number]);
  const head = keys[0];
  if (!head || t <= head.t) return zero();
  const i = keys.findIndex((k) => k.t > t);
  if (i < 0) return zero();
  const a = keys[i - 1] as VisemeKey;
  const b = keys[i] as VisemeKey;
  const x = smooth((t - a.t) / Math.max(1e-3, b.t - a.t));
  const oa = LIP_OFFSETS[a.v];
  const ob = LIP_OFFSETS[b.v];
  return LIP_BONES.map((_, n) => {
    const p = oa[n] as readonly [number, number];
    const q = ob[n] as readonly [number, number];
    return [p[0] + (q[0] - p[0]) * x, p[1] + (q[1] - p[1]) * x];
  });
}
