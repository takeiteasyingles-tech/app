// Text + audio lip sync for the 3D Mic avatar. The reply text becomes visemes (rule-based English
// spelling → mouth shapes), timed over the voiced parts of the decoded TTS audio: every pause of the
// audio falls between words (after punctuation when possible), and the energy scales the jaw.
// Needs only what the Mic already has: the text and the audio. Optional per-word times (from the TTS
// or an ASR) are used as a hint for which pause each word falls in.

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

export const MORPHS = [
  'mouthRound',
  'mouthWide',
  'mouthPress',
  'mouthFunnel',
  'lowerLipF',
  'upperLipUp',
  'lowerLipDown',
] as const;
export type MouthMorph = (typeof MORPHS)[number];

export type Shape = { jaw: number } & Partial<Record<MouthMorph, number>>;
export type Sample = { jaw: number; v: Viseme } & Record<MouthMorph, number>;
export interface Key {
  t: number;
  v: Viseme;
}
export interface WordTime {
  s: number;
  e: number;
}

const VOWELS = new Set<Viseme>(['aa', 'E', 'I', 'O', 'U', 'RR']);
const COST: Partial<Record<Viseme, number>> = { aa: 2, E: 2, I: 1.8, O: 2, U: 1.8, RR: 1.6, PP: 1.3, FF: 1.2, HH: 0.6 };
const cost = (v: Viseme): number => COST[v] ?? 1;

/** Viseme → jaw opening (0..1 of the avatar's max) and mouth morphs. Vowels open, consonants nearly close. */
export const SHAPES: Readonly<Record<Viseme, Shape>> = {
  sil: { jaw: 0 },
  aa: { jaw: 0.9, mouthWide: 0.1, lowerLipDown: 0.45, upperLipUp: 0.25 },
  E: { jaw: 0.6, mouthWide: 0.6, lowerLipDown: 0.2, upperLipUp: 0.15 },
  I: { jaw: 0.35, mouthWide: 0.9, upperLipUp: 0.3 },
  O: { jaw: 0.65, mouthRound: 0.8, lowerLipDown: 0.2 },
  U: { jaw: 0.25, mouthRound: 1, mouthFunnel: 0.4 },
  RR: { jaw: 0.3, mouthRound: 0.55, mouthFunnel: 0.25 },
  PP: { jaw: 0, mouthPress: 1 },
  FF: { jaw: 0.1, lowerLipF: 1, upperLipUp: 0.4 },
  TH: { jaw: 0.15, mouthWide: 0.25, upperLipUp: 0.25 },
  DD: { jaw: 0.15, mouthWide: 0.2, upperLipUp: 0.2 },
  kk: { jaw: 0.2, mouthWide: 0.1 },
  CH: { jaw: 0.12, mouthFunnel: 1, upperLipUp: 0.3 },
  SS: { jaw: 0.05, mouthWide: 0.45, upperLipUp: 0.4 },
  HH: { jaw: 0.3 },
};

const MULTI: readonly (readonly [string, readonly Viseme[]])[] = [
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
const SINGLE: Readonly<Record<string, Viseme>> = {
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

/** One English word → its viseme sequence (spelling rules; good enough for mouth shapes). */
export function wordVisemes(raw: string): Viseme[] {
  let w = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length > 2 && w.endsWith('e') && !/[aeiouy]e$/.test(w)) w = w.slice(0, -1); // silent final e
  const out: Viseme[] = [];
  for (let i = 0; i < w.length; ) {
    const m = MULTI.find(([p]) => w.startsWith(p, i));
    if (m) {
      out.push(...m[1]);
      i += m[0].length;
      continue;
    }
    const c = w[i] as string;
    const next = w[i + 1];
    if (c === next && !'aeiou'.includes(c)) {
      i++; // double consonant
      continue;
    }
    if (c === 'c') out.push(next && 'eiy'.includes(next) ? 'SS' : 'kk');
    else if (c === 'x') out.push('kk', 'SS');
    else if (c === 'u') out.push(i === w.length - 1 || next === 'e' ? 'U' : 'aa');
    else {
      const v = SINGLE[c];
      if (v) out.push(v);
    }
    i++;
  }
  return out.filter((v, k) => k === 0 || v !== out[k - 1]);
}

/** Normalised loudness of the low-passed (vowel band) signal, 100 frames per second, 0..1. */
export function envelope(buffer: { sampleRate: number; getChannelData(c: number): Float32Array }): Float32Array {
  const x = buffer.getChannelData(0);
  const fs = buffer.sampleRate;
  const hop = Math.round(fs / 100);
  const win = Math.round(fs * 0.03);
  const a = 1 - Math.exp((-2 * Math.PI * 1000) / fs);
  const lp = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * ((x[i] as number) - y);
    lp[i] = y;
  }
  const n = Math.floor(x.length / hop);
  const raw = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    const i0 = k * hop;
    const i1 = Math.min(x.length, i0 + win);
    for (let i = i0; i < i1; i++) s += (lp[i] as number) ** 2;
    raw[k] = Math.sqrt(s / Math.max(1, i1 - i0));
  }
  const p95 = [...raw].sort((p, q) => p - q)[Math.floor(n * 0.95)] || 1;
  return raw.map((r) => Math.min(1, r / p95));
}

/** Voiced stretches of the envelope, in seconds; short gaps merge, breaths (< 0.12 s) drop. */
function islands(env: Float32Array, thr = 0.07, mergeGap = 7, minLen = 12): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let k = 0; k <= env.length; k++) {
    const on = k < env.length && (env[k] as number) > thr;
    if (on && s < 0) s = k;
    if (!on && s >= 0) {
      out.push([s, k]);
      s = -1;
    }
  }
  const merged: [number, number][] = [];
  for (const it of out) {
    const last = merged[merged.length - 1];
    if (last && it[0] - last[1] < mergeGap) last[1] = it[1];
    else merged.push([it[0], it[1]]);
  }
  return merged.filter(([a, b]) => b - a >= minLen).map(([a, b]) => [a / 100, b / 100]);
}

interface Word {
  vis: Viseme[];
  cost: number;
  punct: number;
  time?: WordTime;
}

/** Viseme keys [{t, v}] (seconds), with 'sil' around every phrase. */
export function timeline(text: string, env: Float32Array, times: readonly WordTime[] | null = null): Key[] {
  const all = text.split(/\s+/).filter(Boolean);
  const hints = times && times.length === all.length ? times : null;
  const words: Word[] = all
    .map((raw, i) => {
      const vis = wordVisemes(raw);
      const punct = /(\.\.\.|[.!?…])["')]*$/.test(raw) ? 1 : /[,;:]["')]*$/.test(raw) ? 0.7 : 0;
      const w: Word = { vis, cost: vis.reduce((s, v) => s + cost(v), 0) || 1, punct };
      const time = hints?.[i];
      if (time) w.time = time;
      return w;
    })
    .filter((w) => w.vis.length);
  const phrases: [number, number][] = [];
  for (const [a, b] of islands(env)) {
    const last = phrases[phrases.length - 1];
    if (last && a - last[1] < 0.14) last[1] = b;
    else phrases.push([a, b]);
  }
  const N = words.length;
  if (!phrases.length || !N) return [];
  while (phrases.length > N) {
    // never more phrases than words: merge across the shortest pause
    let k = 0;
    for (let i = 1; i < phrases.length - 1; i++) {
      const gi = (phrases[i + 1] as [number, number])[0] - (phrases[i] as [number, number])[1];
      const gk = (phrases[k + 1] as [number, number])[0] - (phrases[k] as [number, number])[1];
      if (gi < gk) k = i;
    }
    phrases.splice(k, 2, [(phrases[k] as [number, number])[0], (phrases[k + 1] as [number, number])[1]]);
  }
  const M = phrases.length;
  // Split the words over the phrases (DP): pauses should fall after punctuation, each phrase's share of
  // the text should match its share of the voiced time, and words should sit near their hinted times.
  const totalCost = words.reduce((s, w) => s + w.cost, 0);
  const durs = phrases.map(([a, b]) => b - a);
  const totalDur = durs.reduce((s, d) => s + d, 0);
  const pre = [0];
  for (const w of words) pre.push((pre[pre.length - 1] as number) + w.cost);
  const hint = phrases.map(([a, b]) => {
    const acc = [0];
    words.forEach((w, i) => {
      const c = w.time ? (w.time.s + w.time.e) / 2 : 0;
      acc.push((acc[i] as number) + (w.time ? Math.max(0, a - 0.15 - c, c - b - 0.15) : 0));
    });
    return acc;
  });
  const at = (arr: number[], i: number) => arr[i] as number;
  const fit = (p: number, i: number, j: number) =>
    Math.abs((at(pre, j + 1) - at(pre, i)) / totalCost - (durs[p] as number) / totalDur) +
    0.5 * (at(hint[p] as number[], j + 1) - at(hint[p] as number[], i));
  const punctOf = (k: number) => (words[k - 1] as Word).punct;
  // score[p][k]: best split with k words placed after phrase p; a phrase may take none (laugh, breath).
  const SKIP = 0.8;
  const score = Array.from({ length: M }, () => new Float64Array(N + 1).fill(-Infinity));
  const back = Array.from({ length: M }, () => new Int32Array(N + 1).fill(-1));
  const s0 = score[0] as Float64Array;
  s0[0] = -SKIP - (3 * (durs[0] as number)) / totalDur;
  for (let k = 1; k <= N; k++) s0[k] = -3 * fit(0, 0, k - 1) + (M > 1 ? punctOf(k) : 0);
  for (let p = 1; p < M; p++) {
    const prev = score[p - 1] as Float64Array;
    const cur = score[p] as Float64Array;
    const bk = back[p] as Int32Array;
    for (let k = 0; k <= N; k++) {
      if ((prev[k] as number) > -Infinity) {
        cur[k] = (prev[k] as number) - SKIP - (3 * (durs[p] as number)) / totalDur;
        bk[k] = k;
      }
      for (let i = 0; i < k; i++) {
        if (prev[i] === -Infinity) continue;
        const s = (prev[i] as number) - 3 * fit(p, i, k - 1) + (p < M - 1 ? punctOf(k) : 0);
        if (s > (cur[k] as number)) {
          cur[k] = s;
          bk[k] = i;
        }
      }
    }
  }
  const ends = new Array<number>(M);
  let k = N;
  for (let p = M - 1; p >= 0; p--) {
    ends[p] = k;
    if (p > 0) k = (back[p] as Int32Array)[k] as number;
  }
  const keys: Key[] = [];
  let wi = 0;
  phrases.forEach(([a, b], p) => {
    const ws = words.slice(wi, ends[p]);
    wi = ends[p] as number;
    if (!ws.length) {
      // sound without words (laugh, breath): the mouth opens with the energy
      if (b - a > 0.2) keys.push({ t: a - 0.06, v: 'sil' }, { t: (a + b) / 2, v: 'HH' }, { t: b + 0.07, v: 'sil' });
      return;
    }
    const vis = ws.flatMap((w) => w.vis);
    const c = vis.reduce((s, v) => s + cost(v), 0);
    keys.push({ t: Math.max(0, a - 0.06), v: 'sil' });
    let t = a;
    for (const v of vis) {
      const d = (cost(v) / c) * (b - a);
      keys.push({ t: t + d * (VOWELS.has(v) ? 0.5 : 0.4), v });
      t += d;
    }
    keys.push({ t: b + 0.07, v: 'sil' });
  });
  return keys;
}

const REST: Sample = {
  jaw: 0,
  v: 'sil',
  ...(Object.fromEntries(MORPHS.map((m) => [m, 0])) as Record<MouthMorph, number>),
};
const ease = (x: number) => x * x * (3 - 2 * x);

/** Mouth at time t: a smooth blend of the two surrounding keys. Always returns every morph. */
export function sample(keys: readonly Key[], t: number): Sample {
  const first = keys[0];
  if (!first || t <= first.t) return REST;
  const i = keys.findIndex((k) => k.t > t);
  if (i < 0) return REST;
  const a = keys[i - 1] as Key;
  const b = keys[i] as Key;
  const f = ease((t - a.t) / Math.max(1e-3, b.t - a.t));
  const A = SHAPES[a.v];
  const B = SHAPES[b.v];
  const out = { jaw: A.jaw + (B.jaw - A.jaw) * f, v: f < 0.5 ? a.v : b.v } as Sample;
  for (const m of MORPHS) out[m] = (A[m] ?? 0) + ((B[m] ?? 0) - (A[m] ?? 0)) * f;
  return out;
}
