// Demo drafter for the season test (spec 07, feature B): when Workers AI is unavailable (local dev, no
// binding, a failed call or an answer that does not fit the contract), tie-admin drafts questions from
// the season's published episodes instead: their Take a Look words (`visual`) and Take Away
// expressions (`awayExp`). Deterministic for a given seed. Drafts are only proposals: staff review and
// approve them before learners see anything.
import { norm } from '../domain/norm';
import { type Rng, seededRng } from './rng';

export interface DraftSourceEpisode {
  num: number;
  title: string;
  visual: readonly { en: string; pt: string }[];
  awayExp: readonly { en: string; pt: string }[];
}

/** One drafted question, in the admin's create shape (SeasonTestQuestionFields without sort). */
export interface DraftQuestion {
  partTitle: string;
  q: string;
  opts: string[] | null;
  answerIdx: number | null;
  accept: string[] | null;
  show: string | null;
  audio: string | null;
  rev: string | null;
  epNum: number | null;
}

export interface DemoDraftInput {
  episodes: readonly DraftSourceEpisode[];
  count: number;
  /** Question texts already in the season (any status): not repeated. */
  existing?: readonly string[];
  /** Forces every question into this part. */
  partTitle?: string;
  seed?: number;
}

export const DEMO_DRAFT_PARTS = {
  vocab: 'Vocabulário',
  expressions: 'Expressões',
  listening: 'Escuta',
} as const;

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Up to 4 options: the right one and distinct distractors, shuffled; null when there are < 2. */
function options(right: string, pool: readonly string[], rng: Rng): { opts: string[]; answerIdx: number } | null {
  const key = norm(right);
  const seen = new Set([key]);
  const wrong: string[] = [];
  for (const p of shuffle(pool, rng)) {
    const k = norm(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    wrong.push(p);
    if (wrong.length === 3) break;
  }
  if (!wrong.length) return null;
  const opts = shuffle([right, ...wrong], rng);
  return { opts, answerIdx: opts.indexOf(right) };
}

/** Drafts up to `count` questions (fewer when the episodes do not have enough material). */
export function demoSeasonTestDraft(input: DemoDraftInput): DraftQuestion[] {
  const rng = seededRng(input.seed ?? 1);
  const existing = new Set((input.existing ?? []).map((q) => norm(q)));
  const words = input.episodes.flatMap((e) =>
    e.visual.filter((w) => clean(w.en) && clean(w.pt)).map((w) => ({ ep: e.num, en: clean(w.en), pt: clean(w.pt) })),
  );
  const exps = input.episodes.flatMap((e) =>
    e.awayExp.filter((x) => clean(x.en) && clean(x.pt)).map((x) => ({ ep: e.num, en: clean(x.en), pt: clean(x.pt) })),
  );
  const ptWords = words.map((w) => w.pt);
  const ptExps = exps.map((x) => x.pt);
  const enExps = exps.map((x) => x.en);

  // Four kinds of question, taken in turn so a draft mixes them.
  const makers: (() => DraftQuestion | null)[] = [];
  for (const w of shuffle(words, rng)) {
    makers.push(() => {
      const o = options(w.pt, ptWords, rng);
      return o
        ? {
            partTitle: DEMO_DRAFT_PARTS.vocab,
            q: `O que significa "${w.en}"?`,
            ...o,
            accept: null,
            show: w.pt,
            audio: null,
            rev: `Ep. ${w.ep} · Take a Look`,
            epNum: w.ep,
          }
        : null;
    });
    makers.push(() => ({
      partTitle: DEMO_DRAFT_PARTS.vocab,
      q: `Escreva em inglês: "${w.pt}"`,
      opts: null,
      answerIdx: null,
      accept: [norm(w.en)],
      show: w.en,
      audio: null,
      rev: `Ep. ${w.ep} · Take a Look`,
      epNum: w.ep,
    }));
  }
  for (const x of shuffle(exps, rng)) {
    makers.push(() => {
      const o = options(x.pt, ptExps, rng);
      return o
        ? {
            partTitle: DEMO_DRAFT_PARTS.expressions,
            q: `Qual é o sentido de "${x.en}"?`,
            ...o,
            accept: null,
            show: x.pt,
            audio: null,
            rev: `Ep. ${x.ep} · Take Away`,
            epNum: x.ep,
          }
        : null;
    });
    makers.push(() => {
      const o = options(x.en, enExps, rng);
      return o
        ? {
            partTitle: DEMO_DRAFT_PARTS.listening,
            q: 'Ouça o áudio e escolha o que foi dito.',
            ...o,
            accept: null,
            show: x.en,
            audio: x.en,
            rev: `Ep. ${x.ep} · Take Away`,
            epNum: x.ep,
          }
        : null;
    });
  }

  const out: DraftQuestion[] = [];
  const used = new Set<string>();
  for (const make of shuffle(makers, rng)) {
    if (out.length >= input.count) break;
    const q = make();
    if (!q) continue;
    // Listening questions share one prompt: dedupe them by their audio instead.
    const key = norm(q.audio ? `${q.q} ${q.audio}` : q.q);
    if (used.has(key) || (!q.audio && existing.has(norm(q.q)))) continue;
    used.add(key);
    out.push(input.partTitle ? { ...q, partTitle: input.partTitle } : q);
  }
  // Grouped by part (vocabulary, expressions, listening), the order the test shows them in.
  const order: string[] = Object.values(DEMO_DRAFT_PARTS);
  return out.sort((a, b) => order.indexOf(a.partTitle) - order.indexOf(b.partTitle));
}
