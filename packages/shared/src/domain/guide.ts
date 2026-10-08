import type { Step } from '../content/schema';
import type { TieState } from '../state';
import { getAssistant } from './assist';
import { dayStats } from './game';
import {
  buildPersonalization,
  type FocusOut,
  type PersonalizeContent,
  type PersonalizeProfile,
  type RankableAlbum,
  type RankableExtra,
} from './personalize';

// prototipo/js/core/guide.js: profile + progress → a short ordered plan for today ("agora você faz X").

export interface CurrentEpisode {
  num: number;
  /** Furthest step reached (1 when not started). */
  step: number;
  started: boolean;
  allDone: boolean;
}

/**
 * Current episode: the first one, in course order, not done yet. Only scripted (published)
 * episodes count; `episodes` lists their numbers.
 */
export function current(s: Pick<TieState, 'epsDone' | 'prog'>, episodes: readonly number[]): CurrentEpisode {
  const order = [...episodes].sort((a, b) => a - b);
  const num = order.find((n) => !s.epsDone[n]) || order[order.length - 1];
  if (num === undefined) throw new Error('no published episodes');
  return { num, step: s.prog[num] || 1, started: !!s.prog[num], allDone: order.every((n) => s.epsDone[n]) };
}

export type DayPlanTaskKind = 'ep' | 'cards' | 'maggie' | 'extra';

export interface DayPlanTask {
  k: DayPlanTaskKind;
  t: string;
  sub: string;
  /** Minutes. */
  min: number;
  /** Hash route without "#/". */
  go: string;
  icon: string;
  pts: number;
  done: boolean;
  img?: string | null;
}

export interface DayPlan {
  tasks: DayPlanTask[];
  now: DayPlanTask | null;
  /** Total minutes. */
  total: number;
  focus: FocusOut;
  allDone: boolean;
}

export type GuideExtra = RankableExtra & { title: string; dur: string; scene: string | null };

export interface DayPlanInput<X extends GuideExtra, A extends RankableAlbum> {
  state: Pick<TieState, 'epsDone' | 'prog' | 'due' | 'extras' | 'game'> & { profile: PersonalizeProfile };
  content: PersonalizeContent<X, A> & { steps: readonly Step[]; episodes: readonly number[] };
  /** Local date (user tz) whose counters mark tasks as done. */
  today: string;
  /** Background of the episode card (the prototype used bg/home.webp). */
  epImg?: string | null;
}

export function plan<X extends GuideExtra, A extends RankableAlbum>(i: DayPlanInput<X, A>): DayPlan {
  const s = i.state;
  const p = s.profile;
  const P = buildPersonalization(p, i.content);
  const d = dayStats(s.game, i.today);
  const cur = current(s, i.content.episodes);
  const step = i.content.steps[cur.step - 1];
  if (!step) throw new Error(`unknown step ${cur.step}`);
  const tasks: DayPlanTask[] = [];
  tasks.push({
    k: 'ep',
    t: `Episódio ${cur.num} · ${step.name}`,
    sub: `Etapa ${cur.step} de 10 · ${step.pt}`,
    min: 8,
    go: `episodio/${cur.num}`,
    icon: 'play',
    pts: 10,
    done: d.steps >= 1,
    img: i.epImg ?? null,
  });
  if (s.due > 0) {
    tasks.push({
      k: 'cards',
      t: `Rebobinar ${Math.min(s.due, 5)} cartões`,
      sub: 'Palavras dos episódios e dos Extras',
      min: 3,
      go: 'revisao',
      icon: 'review',
      pts: 10,
      done: d.cards >= 5,
    });
  }
  const m = P.missions[0];
  if (m) {
    tasks.push({
      k: 'maggie',
      t: `${getAssistant(i.content.assistants, p.assistant).name} · ${m.t}`,
      sub: m.goal,
      min: 5,
      go: `maggie?modo=missao&m=${m.k}`,
      icon: 'mic',
      pts: 30,
      done: d.maggieSec >= 120,
    });
  }
  const x = P.extras.find((e) => !e.locked && !s.extras.seen[e.id]) || P.extras[0];
  if (p.minutes >= 20 && x) {
    tasks.push({
      k: 'extra',
      t: `EXTRA · ${x.title}`,
      sub: `${x.why} · ${x.dur}`,
      min: 8,
      go: `extra/${x.id}/assistir`,
      icon: 'tv',
      pts: 20,
      done: !!s.extras.seen[x.id],
      img: x.scene,
    });
  }
  // Order by learning style.
  const st = p.styles || [];
  const w = (t: DayPlanTask) =>
    (t.k === 'ep' ? -10 : 0) +
    (t.k === 'maggie' && st.includes('falando') ? -2 : 0) +
    (t.k === 'extra' && st.includes('vendo') ? -1 : 0) +
    (t.k === 'cards' && st.includes('lendo') ? -1 : 0);
  tasks.sort((a, b) => w(a) - w(b));
  const now = tasks.find((t) => !t.done) || null;
  const total = tasks.reduce((a, t) => a + t.min, 0);
  return { tasks, now, total, focus: P.focus, allDone: !now };
}
