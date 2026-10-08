// Dados do Mic que as duas telas (conversa e relatório) leem do catálogo e do estado: o assistente
// atual (TIE.assist), modos, missões e frases de pronúncia (TIE.data.MAGGIE) e as sessões.
import { DEFAULT_ASSISTANT, PLAN_FEATURES } from '@tie/shared/constants';
import type { AssistantPublic, Catalog, MicModeCard, Mission } from '@tie/shared/content/schema';
import type { AwardResult } from '@tie/shared/contracts/game';
import { meApi } from '@tie/shared/contracts/me';
import { assistantOf, assistantThe, assistantTheCap, getAssistant } from '@tie/shared/domain/assist';
import { dayStats, level, POINTS } from '@tie/shared/domain/game';
import type { MicSession, TieState } from '@tie/shared/state';
import { call } from '../../api';
import { playAward } from '../../store/award';
import { levels, today } from '../../store/game';
import { set, state } from '../../store/state';

/** TIE.assist.cur() / get(k): o assistente escolhido (ou o primeiro, a Maggie). */
export function assistant(c: Catalog, k?: string | null): AssistantPublic {
  return getAssistant(c.assistants, k ?? state.value.profile?.assistant ?? DEFAULT_ASSISTANT);
}

/** "a Maggie" / "A Maggie" / "da Maggie" (TIE.assist.the / The / of). */
export const the = assistantThe;
export const The = assistantTheCap;
export const of = assistantOf;

export const modeCard = (c: Catalog, k: string): MicModeCard | undefined => c.mic.modes.find((m) => m.k === k);
export const mission = (c: Catalog, k: string | null | undefined): Mission | undefined =>
  c.mic.missions.find((m) => m.k === k) ?? c.mic.missions[0];

/** Título da conversa: "No check-in do aeroporto" na missão, senão o nome do modo. */
export function sessionTitle(c: Catalog, mode: string, missionKey: string | null | undefined): string {
  if (mode === 'missao') return mission(c, missionKey)?.t ?? '';
  return modeCard(c, mode)?.t ?? '';
}

/** Extras liberados que o plano pode usar (premium só com o recurso premium_extras). */
export function usableExtras(c: Catalog, s: TieState) {
  const premiumOk = !!s.plan?.features[PLAN_FEATURES.premiumExtras];
  return c.extras.filter((x) => !x.locked && (premiumOk || !x.premium));
}

/** fmt(): segundos → "m:ss". */
export function fmt(t: number): string {
  const n = Math.max(0, Math.floor(t || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** uid() do protótipo. */
export const uid = (): string => Math.random().toString(36).slice(2, 9);

/** Sessões feitas sem servidor (sem conexão ao começar) têm id local e relatório do modo demo. */
export const LOCAL_PREFIX = 'local-';
export const isLocalSession = (id: string): boolean => id.startsWith(LOCAL_PREFIX);

/** Guarda (ou atualiza) uma sessão no estado, a mais nova primeiro, no máximo 12. */
export function putSession(sess: MicSession): void {
  set((s) => ({
    maggie: { ...s.maggie, sessions: [sess, ...s.maggie.sessions.filter((x) => x.id !== sess.id)].slice(0, 12) },
  }));
}

/**
 * Pontos de maggie_session que o /end devolveu, por sessão (0: o servidor não deu o prêmio, por
 * ser curta demais, ter menos de duas falas ou passar do limite do dia).
 */
const sessionAwards = new Map<string, number>();

export function noteSessionAward(id: string, award: AwardResult | null | undefined): void {
  sessionAwards.set(id, award?.awarded ? award.points : 0);
}

/** Fala guardada de uma tentativa de pronúncia em que nada foi ouvido (não conta como fala). */
const SILENT = '(silêncio)';

/**
 * Os pontos da conversa para o relatório: o que o /end respondeu quando a sessão acabou de ser
 * encerrada aqui; para uma sessão aberta depois (histórico, recarga), as mesmas regras do servidor
 * (15 s de conversa e duas falas suas). Sessão só do cliente não pontua.
 */
export function sessionPoints(sess: MicSession): number {
  const known = sessionAwards.get(sess.id);
  if (known !== undefined) return known;
  if (isLocalSession(sess.id)) return 0;
  const spoke = sess.turns.filter((t) => t.who === 'me' && t.en.trim() && t.en !== SILENT).length;
  return spoke >= 2 && sess.secs >= 15 ? POINTS.maggie_session : 0;
}

/** Atualiza só o relatório de uma sessão que já está no estado. */
export function setSessionReport(id: string, report: MicSession['report']): void {
  set((s) => ({
    maggie: { ...s.maggie, sessions: s.maggie.sessions.map((x) => (x.id === id ? { ...x, report } : x)) },
  }));
}

/**
 * Uma tentativa de pronúncia dentro de uma sessão do Mic é pontuada pelo servidor (maggie_turn) sem
 * devolver o prêmio na resposta. Aqui o resumo do jogo é relido e, se os pontos subiram, os mesmos
 * efeitos do game.award() tocam (+N pontos, nível, meta, medalhas) com 15 s para a missão do Mic.
 */
export async function syncAwardFromServer(sec: number): Promise<void> {
  const before = state.value.game;
  try {
    const sum = await call(meApi.summary);
    const after = state.value.game;
    // Outro prêmio chegou enquanto isso: o total do servidor já está na tela.
    if (after.points !== before.points) return;
    const delta = sum.points - before.points;
    if (delta <= 0) return;
    const day = dayStats(before, today(state.value.tz));
    const a: AwardResult = {
      awarded: true,
      kind: 'maggie_turn',
      points: delta,
      total: sum.points,
      dayPoints: sum.goal.done,
      levelUp: sum.level.n > level(before.points, levels.value).n ? { n: sum.level.n, name: sum.level.name } : null,
      goalHit: sum.goal.hit && !day.goal,
      newBadges: sum.badges
        .filter((b) => b.has && !before.badges.includes(b.id))
        .map(({ id, t, s, icon }) => ({ id, t, s, icon })),
      missionsDone: sum.missions.filter((m) => m.done && !day.missions[m.k]).map((m) => m.k),
    };
    playAward(a, { sec });
  } catch {
    // Sem resumo: os pontos aparecem no próximo carregamento.
  }
}
