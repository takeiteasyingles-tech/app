import type { PronounceIssue, PronounceResult } from '../contracts/ai';
import { norm } from '../domain/norm';
import { praiseFor } from './demoPronounce';
import { pronWatch } from './pronWatch';

// Deterministic pronunciation score for /api/pronounce: word-level Levenshtein between the
// target sentence and the Whisper transcript, after the same normalization as norm().

const NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/** Lowercase words without punctuation or accents; contractions folded; 0–20 spelled out. */
export function alignTokens(s: unknown): string[] {
  return norm(
    String(s || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, ''),
  )
    .split(' ')
    .map((w) => w.replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, ''))
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? (NUMBERS[Number(w)] ?? w) : w));
}

export type AlignOp =
  | { op: 'ok'; target: string; heard: string }
  | { op: 'sub'; target: string; heard: string }
  | { op: 'del'; target: string }
  | { op: 'ins'; heard: string };

export interface Alignment {
  target: string[];
  heard: string[];
  /** Word edits (substitutions + deletions + insertions). */
  distance: number;
  /** 10 × (1 − distance / target words), rounded and clamped to 0..10. */
  score: number;
  ops: AlignOp[];
  /** Target words that were not heard as such, in order. */
  missed: string[];
}

export function align(target: string, heard: string): Alignment {
  const T = alignTokens(target);
  const H = alignTokens(heard);
  const n = T.length;
  const m = H.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = 0; i <= n; i++) dp[i * w] = i;
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = T[i - 1] === H[j - 1] ? 0 : 1;
      dp[i * w + j] = Math.min(
        (dp[(i - 1) * w + j] ?? 0) + 1,
        (dp[i * w + j - 1] ?? 0) + 1,
        (dp[(i - 1) * w + j - 1] ?? 0) + cost,
      );
    }
  }
  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = dp[i * w + j] ?? 0;
    const t = T[i - 1] ?? '';
    const h = H[j - 1] ?? '';
    if (i > 0 && j > 0 && here === (dp[(i - 1) * w + j - 1] ?? 0) + (t === h ? 0 : 1)) {
      ops.push({ op: t === h ? 'ok' : 'sub', target: t, heard: h });
      i--;
      j--;
    } else if (i > 0 && here === (dp[(i - 1) * w + j] ?? 0) + 1) {
      ops.push({ op: 'del', target: t });
      i--;
    } else {
      ops.push({ op: 'ins', heard: h });
      j--;
    }
  }
  ops.reverse();
  const distance = dp[n * w + m] ?? 0;
  const score = n === 0 ? (m === 0 ? 10 : 0) : Math.max(0, Math.min(10, Math.round(10 * (1 - distance / n))));
  const missed = ops.flatMap((o) => (o.op === 'sub' || o.op === 'del' ? [o.target] : []));
  return { target: T, heard: H, distance, score, ops, missed };
}

/** PronounceResult from a transcript: align() for the score, pronWatch() for the tips. */
export function scorePronunciation(target: string, heard: string): PronounceResult {
  const a = align(target, heard);
  const unique = (list: string[]) => [...new Set(list)];
  const issues: PronounceIssue[] = unique(a.missed.length ? a.missed : a.target)
    .slice(0, 2)
    .map((w) => {
      const p = pronWatch(w)[0];
      return {
        word: w,
        issue_pt: a.missed.includes(w)
          ? 'Não deu para entender esta palavra.'
          : 'Ponto de atenção para quem fala português.',
        tip_pt: p ? p.tip_pt : 'Fale mais devagar e marque a sílaba forte.',
      };
    });
  return {
    score: a.score,
    heard: String(heard || '').trim(),
    issues: a.score >= 9 ? [] : issues,
    praise_pt: praiseFor(a.score),
    source: 'ia',
  };
}
