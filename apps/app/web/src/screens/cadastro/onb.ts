// Onboarding (prototipo/js/screens/cadastro.js) helpers: validation, the step list and how the
// answers persist. The prototype saved draft.* to localStorage on every tap; here every change lands
// in state.draft at once and is sent with PUT /api/me/profile (debounced, in order), and moving
// between steps also records onbStep so a reload resumes where the person stopped.
import { LIMITS } from '@tie/shared/constants';
import type { OnbStep } from '@tie/shared/content/schema';
import { meApi, type ProfilePatch } from '@tie/shared/contracts/me';
import type { Draft } from '@tie/shared/state';
import { toast } from '@tie/ui';
import { call, errorMessage } from '../../api';
import { go } from '../../router';
import { catalog, set, state } from '../../store';
import { emailOk } from '../entrada/session';

/** ONB.STEPS as the prototype ships them: step 1 shows before sign-up, when the catalog is not loaded yet. */
export const STEPS_FALLBACK: readonly OnbStep[] = [
  { k: 'conta', t: 'Sua conta', h: 'Primeiro, a sua conta.', s: 'Leva um minuto. Depois é só com a gente.' },
  {
    k: 'objetivo',
    t: 'Objetivo',
    h: 'Qual uso você vai fazer do inglês?',
    s: 'Escolha até 3. O plano da semana é calculado a partir daqui.',
    skip: true,
  },
  { k: 'gostos', t: 'Gostos', h: 'Do que você gosta?', s: 'É daqui que sai a sua prateleira no EXTRA.', skip: true },
  {
    k: 'trava',
    t: 'Dificuldades',
    h: 'O que mais te trava hoje?',
    s: 'Marque tudo o que pesa. Depois escolha o que trava mais.',
    skip: true,
  },
  {
    k: 'estilo',
    t: 'Jeito de aprender',
    h: 'Como você aprende melhor?',
    s: 'O app dá mais espaço para o que funciona com você.',
    skip: true,
  },
  { k: 'ritmo', t: 'Meta', h: 'Defina sua meta.', s: 'Dias, minutos e horário.' },
  {
    k: 'voz',
    t: 'Teste de voz',
    h: 'Diga oi para a Maggie.',
    s: 'Um teste rápido para calibrar a sua pronúncia. Dá para pular.',
  },
];

export const steps = (): readonly OnbStep[] => {
  const list = catalog.value?.onboarding.steps;
  return list?.length ? list : STEPS_FALLBACK;
};

/** Accessible names of the `.days` buttons (the visible labels are the ambiguous D S T Q Q S S). */
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;
export const weekdayName = (i: number): string => WEEKDAYS[i] ?? `Dia ${i + 1}`;

/** Local date YYYY-MM-DD (TIE.u.today). */
export function todayIso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Age from a YYYY-MM-DD birth date, or null when it is not one. */
export function ageOf(birth: string | null | undefined, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth || '');
  if (!m) return null;
  let a = now.getFullYear() - Number(m[1]);
  const mm = now.getMonth() + 1;
  if (mm < Number(m[2]) || (mm === Number(m[2]) && now.getDate() < Number(m[3]))) a--;
  return a;
}

/** AGES band key for an age ('' when unknown). */
export const ageBand = (a: number | null): string =>
  a == null ? '' : a < 18 ? '-18' : a < 25 ? '18-24' : a < 35 ? '25-34' : a < 45 ? '35-44' : a < 60 ? '45-59' : '60+';

export const firstName = (full: string): string => (full || '').trim().split(/\s+/)[0] || '';

export interface AccountForm {
  fullName: string;
  name: string;
  birth: string;
  email: string;
  pass: string;
}

export type AccountErrors = Partial<Record<keyof AccountForm, string>>;

/**
 * accountErrors(): the prototype's messages. Fills `name` from the first name when it is blank (the
 * returned form carries it). The password is only checked when the account is being created.
 */
export function accountErrors(
  f: AccountForm,
  creating: boolean,
  now: Date = new Date(),
): { errors: AccountErrors; form: AccountForm } {
  const e: AccountErrors = {};
  const form = { ...f };
  const a = ageOf(form.birth, now);
  if (form.fullName.trim().split(/\s+/).length < 2) e.fullName = 'Digite o nome e o sobrenome.';
  if (!form.name.trim() && !e.fullName) form.name = firstName(form.fullName);
  if (form.name.trim().length < 2) e.name = 'Diga como quer ser chamado.';
  if (a == null || a < 5 || a > 110) e.birth = 'Confira a data de nascimento.';
  if (!emailOk(form.email.trim())) e.email = 'Confira o e-mail.';
  if (creating && form.pass.length < LIMITS.passwordMin)
    e.pass = `A senha precisa de pelo menos ${LIMITS.passwordMin} caracteres.`;
  return { errors: e, form };
}

/** valid(n): what a step needs before Continuar. */
export function stepValid(k: string, d: Draft): boolean {
  if (k === 'objetivo') return d.goals.length > 0;
  if (k === 'gostos') return d.formats.length > 0;
  if (k === 'trava') return d.diffs.length > 0;
  if (k === 'estilo') return d.styles.length > 0;
  if (k === 'ritmo') return d.days.length > 0;
  return true;
}

/** tg(): toggles `k` in a copy of `arr`; null when `max` is reached (nothing changes). */
export function toggled<T>(arr: readonly T[], k: T, max?: number): T[] | null {
  const i = arr.indexOf(k);
  if (i >= 0) return arr.filter((_, j) => j !== i);
  if (!max || arr.length < max) return [...arr, k];
  return null;
}

/** Suggested time for a new reminder: the first of these not in the list yet. */
export function nextReminder(list: readonly string[]): string {
  return ['07:00', '12:30', '20:00', '09:00', '18:00', '22:00'].find((t) => !list.includes(t)) || '12:00';
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Reminders the server accepts (HH:MM, at most remindersMax); half-typed times are left out. */
export const cleanReminders = (list: readonly string[]): string[] =>
  list.filter((t) => HHMM.test(t)).slice(0, LIMITS.remindersMax);

// ---------- Persistence ----------

let pending: ProfilePatch = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<unknown> = Promise.resolve();

function toPatch(p: Partial<Draft>): ProfilePatch {
  const { email: _email, reminders, ...rest } = p;
  const out: ProfilePatch = { ...rest };
  if (reminders) out.reminders = cleanReminders(reminders);
  return out;
}

/**
 * Sends what changed (plus `extra`) now, after any request already in flight. Resolves false on
 * failure (toasted): the answers that did not land go back into `pending`, under anything newer the
 * person changed meanwhile, so the next flush (a tap, a step change, Começar o curso) sends them again
 * instead of completing the profile with older answers.
 */
export function flushDraft(extra: ProfilePatch = {}): Promise<boolean> {
  clearTimeout(timer);
  const body: ProfilePatch = { ...pending, ...extra };
  pending = {};
  if (!Object.keys(body).length || !state.value.user) return Promise.resolve(true);
  const run = chain.then(() =>
    call(meApi.profile, { body }).then(
      () => true,
      (err: unknown) => {
        pending = { ...body, ...pending };
        toast(errorMessage(err));
        return false;
      },
    ),
  );
  chain = run;
  return run;
}

/**
 * Before POST /api/me/profile/complete: waits for the sends already in flight (a failed one puts its
 * answers back in `pending`), then sends everything still pending. True when the server has them all.
 */
export async function flushAllDraft(): Promise<boolean> {
  await chain;
  return flushDraft();
}

/** Sign-out / account switch: answers of the previous session must not reach the next one. */
export function resetDraftQueue(): void {
  clearTimeout(timer);
  pending = {};
}

/** draft.* = …; store.save(): local at once, persisted shortly after (signed in only). */
export function patchDraft(p: Partial<Draft>): void {
  set((s) => ({ draft: { ...s.draft, ...p } }));
  if (!state.value.user) return;
  Object.assign(pending, toPatch(p));
  clearTimeout(timer);
  timer = setTimeout(() => void flushDraft(), 700);
}

/** go(n): onbStep = n, saved with the pending answers, then the route. */
export function goStep(n: number): void {
  set({ onbStep: n });
  void flushDraft({ onbStep: n });
  go(`cadastro/${n}`);
}
