// Synthetic prototype-shaped profiles and states shared by the parity tests.
import { type Rng, seededRng } from '../../src/demo/rng';
import type { Any } from './prototype';

const base = {
  fullName: 'Teste da Silva',
  birth: '1990-05-01',
  company: 'desafio',
  days: [1, 2, 3, 4, 5],
  avatar: 1,
  photo: null,
  voice: null,
  history: [],
  fails: [],
};

export const PROFILES: Any[] = [
  {
    ...base,
    name: 'Ana',
    level: 'basico',
    age: '25-34',
    occup: 'trabalho',
    area: 'tech',
    goals: ['series', 'viagem'],
    deadline: '6m',
    formats: ['series', 'animes'],
    genres: ['comedia', 'shonen'],
    themes: ['comida'],
    diffs: ['listening', 'speaking'],
    mainDiff: 'listening',
    styles: ['vendo', 'ouvindo'],
    feedback: 'direto',
    minutes: 20,
    reminders: ['20:00', '07:30'],
    motives: ['carreira', 'sonho'],
    why: 'Quero viajar sem medo.',
    assistant: 'margaret',
  },
  {
    ...base,
    name: 'Bia',
    level: 'zero',
    age: '',
    occup: '',
    area: '',
    goals: [],
    deadline: '',
    formats: [],
    genres: [],
    themes: [],
    diffs: [],
    mainDiff: '',
    styles: [],
    feedback: 'suave',
    minutes: 10,
    reminders: [],
    motives: [],
    why: '',
    assistant: 'robert',
  },
  {
    ...base,
    name: 'Caio',
    level: 'avancar',
    age: '18-24',
    occup: 'estudo',
    area: '',
    goals: ['musica', 'games', 'provas'],
    deadline: '3m',
    formats: ['musica', 'games', 'viagens', 'business'],
    genres: ['rock', 'rpg', 'anos80', 'praia', 'esporte'],
    themes: ['tecnologia', 'negocios'],
    diffs: ['pron', 'shy', 'time'],
    mainDiff: 'shy',
    styles: ['falando', 'lendo'],
    feedback: 'depois',
    minutes: 50,
    reminders: ['21:15'],
    motives: ['curiosidade'],
    why: 'Jogar online.',
    assistant: 'zach',
  },
  {
    ...base,
    name: 'Duda',
    level: 'meviro',
    age: '45-59',
    occup: 'empresa',
    area: 'financas',
    goals: ['carreira', 'morar', 'gente'],
    deadline: '1a',
    formats: ['novelas', 'filmes', 'artes'],
    genres: ['romance', 'suspense', 'pintura'],
    themes: ['moda', 'viagem', 'pets'],
    diffs: ['grammar', 'vocab', 'writing'],
    mainDiff: 'writing',
    feedback: 'direto',
    minutes: 30,
    reminders: ['07:00', '12:30', '19:00'],
    why: '',
    assistant: 'barbara',
  },
  {
    ...base,
    name: 'Edu',
    level: 'nope',
    age: 'x',
    occup: 'zzz',
    area: 'outra',
    goals: ['unknownGoal'],
    deadline: 'calma',
    formats: ['xyz'],
    genres: ['abc'],
    themes: ['qq'],
    diffs: ['foo'],
    mainDiff: 'foo',
    styles: ['vendo'],
    feedback: 'zzz',
    minutes: 40,
    reminders: [],
    motives: ['familia'],
    why: 'Porque sim',
    assistant: 'nobody',
  },
  {
    ...base,
    name: 'Fê',
    level: 'basico',
    age: '-18',
    occup: 'estudo',
    area: '',
    goals: ['series'],
    deadline: 'calma',
    formats: ['animes', 'series', 'filmes'],
    genres: ['fantasia', 'terror', 'slice', 'documentario'],
    themes: ['esportes', 'saude'],
    diffs: ['vocab', 'time'],
    mainDiff: '',
    styles: ['jogando', 'vendo', 'falando'],
    feedback: 'suave',
    minutes: 20,
    reminders: ['06:05'],
    motives: [],
    why: '',
    assistant: 'rebecca',
  },
];

export const clone = <T>(x: T): T => structuredClone(x);

const int = (rng: Rng, n: number) => Math.floor(rng() * n);

/** A random prototype game state (log kinds, streak, points, daily goals). */
export function randomGame(rng: Rng, today: string): Any {
  const kinds = [
    'step',
    'episode',
    'maggie_turn',
    'mic_good',
    'mic_try',
    'extra',
    'dub',
    'card',
    'test_pass',
    'song',
    'word',
  ];
  const log: Any[] = [];
  const n = int(rng, 40);
  for (let i = 0; i < n; i++) {
    const k = kinds[int(rng, kinds.length)] as string;
    const reps = k === 'card' || k === 'maggie_turn' ? 1 + int(rng, 12) : 1;
    for (let r = 0; r < reps; r++) log.push({ k, t: 1_700_000_000_000 + i, p: 5 });
  }
  const daily: Any = {};
  const days = int(rng, 9);
  for (let i = 0; i < days; i++) {
    daily[`2026-08-${String(10 + i).padStart(2, '0')}`] = {
      points: int(rng, 200),
      steps: int(rng, 3),
      cards: int(rng, 8),
      maggieSec: int(rng, 300),
      extras: int(rng, 2),
      mic: int(rng, 4),
      goal: rng() < 0.6,
      missions: {},
    };
  }
  if (rng() < 0.7) {
    daily[today] = {
      points: int(rng, 120),
      steps: int(rng, 3),
      cards: [0, 2, 5, 7][int(rng, 4)],
      maggieSec: [0, 60, 120, 400][int(rng, 4)],
      extras: int(rng, 2),
      mic: int(rng, 3),
      goal: rng() < 0.4,
      missions: {},
    };
  }
  return {
    points: int(rng, 1200),
    streak: int(rng, 10),
    lastDay: '',
    daily,
    badges: rng() < 0.3 ? ['first-step'] : [],
    log,
  };
}

/** A random prototype course state for the scripted episodes. */
export function randomCourse(rng: Rng, eps: number[]): Any {
  const s: Any = { prog: {}, epsDone: {}, ebooks: {}, stepOk: {}, extras: { seen: {}, dubs: {}, best: 0, lastId: '' } };
  for (const n of eps) {
    if (rng() < 0.3) s.epsDone[n] = true;
    if (rng() < 0.7) s.prog[n] = 1 + int(rng, 10);
  }
  if (rng() < 0.5) s.ebooks[1] = true;
  return s;
}

export const rngFor = (seed: number) => seededRng(seed);
