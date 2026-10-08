import type { BadgeDef, PointKind } from '../content/schema';
import type { BadgeRule, DailyMission, GameSummary, LevelInfo } from '../contracts/game';
import { type DailyStats, emptyDaily, type GameState, type Profile } from '../state';
import { type AssistantRef, assistantThe } from './assist';

// prototipo/js/core/game.js as pure functions. The prototype's award() mutated the store; in
// production the Worker's game engine owns the ledger and calls these for levels, goals,
// missions and badges. Vocabulary follows the brand book: pontos, sequência, meta, medalha.

export const POINTS: Readonly<Record<PointKind, number>> = {
  step: 10,
  episode: 40,
  ex_right: 5,
  mic_try: 5,
  mic_good: 15,
  song: 10,
  maggie_turn: 5,
  maggie_session: 30,
  extra: 20,
  dub: 10,
  card: 2,
  quiz_hit: 5,
  test_pass: 50,
  mission: 15,
  word: 3,
};

/** [minimum points, name]. */
export const LEVELS: readonly (readonly [number, string])[] = [
  [0, 'Iniciante'],
  [100, 'Curioso'],
  [250, 'Aprendiz'],
  [500, 'Explorador'],
  [900, 'Conversador'],
  [1400, 'Viajante'],
  [2000, 'Anfitrião'],
  [2800, 'Narrador'],
  [3800, 'Mestre de Beacon'],
  [5000, 'Lenda de Beacon'],
];

export type Badge = BadgeDef & { rule: BadgeRule };

/** The 14 prototype BADGES, with their test() functions rewritten as JSON rules (badges.rule). */
export const BADGES: readonly Badge[] = [
  {
    id: 'first-step',
    t: 'Primeiro passo',
    s: 'Concluiu uma etapa',
    icon: 'flag',
    rule: { type: 'count', kind: 'step', min: 1 },
  },
  {
    id: 'first-episode',
    t: 'Episódio inteiro',
    s: 'Fechou um episódio',
    icon: 'check',
    rule: { type: 'count', kind: 'episode', min: 1 },
  },
  {
    id: 'first-talk',
    t: 'Quebrou o gelo',
    s: 'Primeira conversa no Mic',
    icon: 'mic',
    rule: { type: 'count', kind: 'maggie_turn', min: 1 },
  },
  {
    id: 'talk-10',
    t: 'Papo bom',
    s: '10 falas no Mic',
    icon: 'chat',
    rule: { type: 'count', kind: 'maggie_turn', min: 10 },
  },
  {
    id: 'mic-8',
    t: 'Voz clara',
    s: 'Nota 8 ou mais na pronúncia',
    icon: 'wave',
    rule: { type: 'count', kind: 'mic_good', min: 1 },
  },
  {
    id: 'cinema',
    t: 'Sessão pipoca',
    s: 'Viu um Extra até o fim',
    icon: 'tv',
    rule: { type: 'count', kind: 'extra', min: 1 },
  },
  { id: 'dub', t: 'Dublador', s: 'Dublou um personagem', icon: 'star', rule: { type: 'count', kind: 'dub', min: 1 } },
  {
    id: 'cards-20',
    t: 'Memória em dia',
    s: '20 cartões revisados',
    icon: 'cards',
    rule: { type: 'count', kind: 'card', min: 20 },
  },
  { id: 'streak-3', t: '3 dias seguidos', s: 'Sequência de 3 dias', icon: 'fire', rule: { type: 'streak', min: 3 } },
  { id: 'streak-7', t: 'Uma semana', s: 'Sequência de 7 dias', icon: 'fire', rule: { type: 'streak', min: 7 } },
  { id: 'pts-500', t: 'Explorador', s: '500 pontos', icon: 'coin', rule: { type: 'points', min: 500 } },
  {
    id: 'test',
    t: 'Passou no teste',
    s: 'Nota de corte no episode test',
    icon: 'trophy',
    rule: { type: 'count', kind: 'test_pass', min: 1 },
  },
  {
    id: 'song',
    t: 'Cantou junto',
    s: 'Terminou um karaokê',
    icon: 'music',
    rule: { type: 'count', kind: 'song', min: 1 },
  },
  { id: 'goal-5', t: 'Meta em dia', s: 'Bateu a meta 5 vezes', icon: 'target', rule: { type: 'goal_days', min: 5 } },
];

/** Level for a point total: {n (1-based), name, from, next, pct}. */
export function level(points: number, levels: readonly (readonly [number, string])[] = LEVELS): LevelInfo {
  let i = levels.findIndex((l, j) => points < l[0] && j > 0);
  if (i === -1) i = levels.length;
  const cur = levels[i - 1] ?? levels[0];
  if (!cur) throw new Error('levels list is empty');
  const next = levels[i];
  return {
    n: i,
    name: cur[1],
    from: cur[0],
    next: next ? next[0] : null,
    pct: next ? Math.round(((points - cur[0]) / (next[0] - cur[0])) * 100) : 100,
  };
}

/** Daily goal in points: 5 per planned minute, at least 50. */
export function goalTarget(p: Pick<Profile, 'minutes'> | null | undefined): number {
  return Math.max(50, Math.round((p?.minutes || 20) * 5));
}

/** Today's counters (game.daily[today]), or an empty day. Does not mutate. */
export function dayStats(g: Pick<GameState, 'daily'>, today: string): DailyStats {
  return g.daily[today] ?? emptyDaily();
}

/** touch(): streak +1 when the last active day was yesterday, else back to 1. */
export function touchStreak(
  g: Pick<GameState, 'streak' | 'lastDay'>,
  today: string,
  yesterday: string,
): Pick<GameState, 'streak' | 'lastDay'> {
  if (g.lastDay === today) return { streak: g.streak, lastDay: g.lastDay };
  return { streak: g.lastDay === yesterday ? (g.streak || 0) + 1 : 1, lastDay: today };
}

export interface MissionsInput {
  daily: DailyStats;
  /** Cards due now (state.due). */
  due: number;
  styles: readonly string[] | undefined;
  /** guide.current().num */
  currentEp: number;
  assistant: AssistantRef;
  /** Day of the month in the user's timezone (the prototype alternated extra/maggie on it). */
  dayOfMonth: number;
}

/** Missões do dia: always one step; cards only when there is a deck; then Extra and/or Mic. */
export function dailyMissions(i: MissionsInput): DailyMission[] {
  const d = i.daily;
  const list: DailyMission[] = [
    { k: 'step', t: 'Fazer 1 etapa do episódio', go: `episodio/${i.currentEp}`, done: d.steps >= 1 },
  ];
  // A new account with no cards swaps the cards mission for the other two.
  if (i.due > 0 || d.cards > 0)
    list.push({ k: 'cards', t: 'Revisar 5 cartões', go: 'revisao', done: d.cards >= 5 || i.due === 0 });
  const extra: DailyMission = { k: 'extra', t: 'Ver um Extra até o fim', go: 'extra', done: d.extras >= 1 };
  const maggie: DailyMission = {
    k: 'maggie',
    t: `2 minutos com ${assistantThe(i.assistant)}`,
    go: 'maggie',
    done: d.maggieSec >= 120,
  };
  if (list.length < 2) list.push(extra, maggie);
  else list.push((i.styles || []).includes('vendo') || i.dayOfMonth % 2 === 0 ? extra : maggie);
  return list;
}

/** What badge rules are evaluated against. */
export interface BadgeStats {
  /** Ledger rows per kind. */
  counts: Partial<Record<PointKind, number>>;
  streak: number;
  points: number;
  /** Days with the daily goal hit. */
  goalDays: number;
}

export function badgeEarned(rule: BadgeRule, st: BadgeStats): boolean {
  switch (rule.type) {
    case 'count':
      return (st.counts[rule.kind] ?? 0) >= rule.min;
    case 'streak':
      return st.streak >= rule.min;
    case 'points':
      return st.points >= rule.min;
    case 'goal_days':
      return st.goalDays >= rule.min;
  }
}

/** Badge stats from a prototype-shaped game state (log + daily). */
export function badgeStatsFromGame(g: Pick<GameState, 'log' | 'streak' | 'points' | 'daily'>): BadgeStats {
  const counts: Partial<Record<PointKind, number>> = {};
  for (const l of g.log) {
    const k = l.k as PointKind;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return {
    counts,
    streak: g.streak,
    points: g.points,
    goalDays: Object.values(g.daily).filter((d) => d.goal).length,
  };
}

/** Badges earned now that the user does not have yet, in catalog order. */
export function newBadges<B extends { id: string; rule: BadgeRule }>(
  badges: readonly B[],
  owned: readonly string[],
  st: BadgeStats,
): B[] {
  return badges.filter((b) => !owned.includes(b.id) && badgeEarned(b.rule, st));
}

export interface SummaryInput extends Omit<MissionsInput, 'daily'> {
  game: Pick<GameState, 'points' | 'streak' | 'daily' | 'badges'>;
  profile: Pick<Profile, 'minutes'> | null;
  today: string;
  badges?: readonly BadgeDef[];
}

/** game.summary(): header numbers, goal ring, medals and today's missions. */
export function gameSummary(i: SummaryInput): GameSummary {
  const g = i.game;
  const d = dayStats(g, i.today);
  const target = goalTarget(i.profile);
  return {
    points: g.points,
    level: level(g.points),
    streak: g.streak || 1,
    goal: { target, done: d.points, pct: Math.min(100, Math.round((d.points / target) * 100)), hit: d.goal },
    daily: d,
    badges: (i.badges ?? BADGES).map(({ id, t, s, icon }) => ({ id, t, s, icon, has: g.badges.includes(id) })),
    missions: dailyMissions({ ...i, daily: d }),
  };
}
