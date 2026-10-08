// #/cadastro/:step: port of prototipo/js/screens/cadastro.js, the 7-step onboarding. PROD (spec 01 §2):
// step 1 creates the account (signup + Turnstile, terms accepted with their version, the password never
// stored client-side); later steps persist through PUT /api/me/profile; onbFinish is
// POST /api/me/profile/complete (reminders sorted, settings.slow, streak touched on the server).
import { LIMITS } from '@tie/shared/constants';
import type { Catalog, OnboardingLists } from '@tie/shared/content/schema';
import { authApi } from '@tie/shared/contracts/auth';
import { meApi } from '@tie/shared/contracts/me';
import { ApiError } from '@tie/shared/errors';
import type { Draft } from '@tie/shared/state';
import { activator, Btn, confetti, Icon, toast } from '@tie/ui';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { refreshState } from '../../core/outbox';
import { type ScreenProps, useChrome } from '../../frame';
import { replace } from '../../router';
import { layoutOf } from '../../shell';
import { catalog, set, state } from '../../store';
import { PassInput } from '../entrada/Entrar';
import { isLegalDoc, LegalLink, LegalSheet } from '../entrada/legal';
import { afterAuth, issuePaths, logout } from '../entrada/session';
import { authConfig, TURNSTILE_ERROR, useTurnstile } from '../entrada/turnstile';
import {
  type AccountErrors,
  type AccountForm,
  accountErrors,
  flushAllDraft,
  flushDraft,
  goStep,
  nextReminder,
  patchDraft,
  resetDraftQueue,
  steps,
  stepValid,
  todayIso,
  toggled,
  weekdayName,
} from './onb';
import { Block, Cta, Field, OptChips, OptIcon } from './ui';
import { Voz } from './Voz';

/** An empty date input shows dd/mm/aaaa in the placeholder colour of .input, not as a typed value. */
const EMPTY_DATE = { color: '#8D93A3', fontWeight: '500' };

const LIMIT_MSG = (max: number) => `Até ${max}. Desmarque um para trocar.`;

/** Desktop: room under the CTA row, so it does not sit on the bottom edge of the window. */
const FOOT_DESK = { paddingBottom: '28px' };

type O = OnboardingLists;

// ---------- Step 1: conta ----------

function Conta({
  f,
  setF,
  err,
  creating,
  onNext,
  turnstileRef,
  warm,
}: {
  f: AccountForm;
  setF: (p: Partial<AccountForm>) => void;
  err: AccountErrors;
  creating: boolean;
  onNext: () => void;
  turnstileRef: { current: HTMLDivElement | null };
  warm: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div class="stack" style={{ '--gap': '14px' }} onFocusIn={creating ? warm : undefined}>
      <Field label="Nome completo" err={err.fullName}>
        <input
          class="input"
          id="onb-fullname"
          autocomplete="name"
          placeholder="Seu nome e sobrenome"
          value={f.fullName}
          maxLength={LIMITS.fullNameMax}
          onInput={(e) => setF({ fullName: e.currentTarget.value })}
        />
      </Field>
      <Field label="Como você quer ser chamado" err={err.name}>
        <input
          class="input"
          id="onb-name"
          autocomplete="nickname"
          placeholder="Ex.: Ana"
          value={f.name}
          maxLength={LIMITS.nameMax}
          onInput={(e) => setF({ name: e.currentTarget.value })}
        />
      </Field>
      <Field label="Data de nascimento" err={err.birth}>
        <input
          class="input"
          id="onb-birth"
          type="date"
          autocomplete="bday"
          min="1910-01-01"
          max={todayIso()}
          value={f.birth}
          style={f.birth ? undefined : EMPTY_DATE}
          onInput={(e) => setF({ birth: e.currentTarget.value })}
        />
      </Field>
      {creating ? (
        <>
          <Field label="E-mail" err={err.email}>
            <input
              class="input"
              id="onb-email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="voce@email.com"
              value={f.email}
              maxLength={LIMITS.emailMax}
              onInput={(e) => setF({ email: e.currentTarget.value })}
            />
          </Field>
          <Field label="Senha" err={err.pass}>
            <PassInput
              id="onb-pass"
              value={f.pass}
              show={show}
              onShow={() => setShow(!show)}
              onInput={(v) => setF({ pass: v })}
              onEnterKey={onNext}
              autocomplete="new-password"
            />
          </Field>
          <div ref={turnstileRef} style={{ display: 'contents' }} />
        </>
      ) : (
        <>
          {/* The account exists: e-mail and password are shown locked (muted, with a padlock), not as
              editable fields; the password is never kept on the device, so it is not shown at all. */}
          <Field label="E-mail">
            <LockedInput id="onb-email" type="email" value={f.email} />
          </Field>
          <Field label="Senha">
            <LockedInput id="onb-pass" type="password" value="" placeholder="Senha já criada" />
          </Field>
        </>
      )}
      <p class="xs">
        {creating ? 'Ao continuar você aceita os ' : 'A sua conta já está criada. Você aceitou os '}
        <LegalLink path="cadastro/1" doc="termos">
          Termos de Uso
        </LegalLink>{' '}
        e a{' '}
        <LegalLink path="cadastro/1" doc="privacidade">
          Política de Privacidade
        </LegalLink>
        . O primeiro episódio é grátis para sempre.
      </p>
    </div>
  );
}

/** Locked: a darker beige fill and a dashed border, so it reads as fixed next to the white editable fields. */
const LOCKED = {
  background: '#EDE7D6',
  borderStyle: 'dashed',
  borderColor: '#BFB59B',
  color: 'var(--muted)',
  fontSize: '.95rem',
  paddingRight: '48px',
  textOverflow: 'ellipsis',
  cursor: 'default',
};
const LOCK_ICON = {
  position: 'absolute',
  right: '4px',
  top: '4px',
  width: '44px',
  height: '44px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--navy)',
  pointerEvents: 'none',
};

/** A read-only field of the existing account, in the `.input-wrap` of the password field. */
function LockedInput({
  id,
  type,
  value,
  placeholder,
}: {
  id: string;
  type: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <span class="input-wrap">
      <input
        class="input"
        id={id}
        type={type}
        value={value}
        title={value || undefined}
        placeholder={placeholder}
        readOnly
        style={LOCKED}
      />
      <span style={LOCK_ICON} title="Já faz parte da sua conta">
        <Icon name="lock" size={18} />
      </span>
    </span>
  );
}

// ---------- Steps 2–6 ----------

/** Desktop: the option cards in two columns, so the step fits the screen with its CTA. */
const CARDS_DESK = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' };

function Objetivo({ d, O, desk }: { d: Draft; O: O; desk: boolean }) {
  const pick = (k: string) => {
    const next = toggled(d.goals, k, LIMITS.goalsMax);
    if (!next) toast(LIMIT_MSG(LIMITS.goalsMax));
    else patchDraft({ goals: next });
  };
  return (
    <>
      <div class="sm" style={{ fontWeight: '700' }}>
        {d.goals.length} de 3 escolhidos
      </div>
      <div class="stack mt12" style={desk ? CARDS_DESK : { '--gap': '10px' }}>
        {O.goals.map((g) => {
          const on = d.goals.includes(g.k);
          return (
            <button
              type="button"
              key={g.k}
              class={`optcard${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={activator(undefined, () => pick(g.k))}
            >
              <span class="ico">
                <OptIcon name={g.icon ?? ''} />
              </span>
              <span class="grow">
                <span class="h3" style={{ display: 'block' }}>
                  {g.t}
                </span>
                <span class="sm">{g.s}</span>
              </span>
              {on ? <Icon name="check" size={22} extra={{ style: { color: 'var(--orange)' } }} /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

const genreKeys = (O: O, f: string): string[] => (O.genres[f] ?? []).map((g) => g.k);

/** The empty check circle gets a shadow, so it stays visible on dark photos. */
const FMT_CK_OFF = {
  boxShadow: '0 0 0 3px rgba(10,30,63,.28), 0 1px 6px rgba(0,0,0,.5)',
  background: 'rgba(10,30,63,.72)',
};

function Gostos({ d, O }: { d: Draft; O: O }) {
  const fmt = (k: string) => {
    const formats = toggled(d.formats, k) ?? d.formats;
    let genres = d.genres;
    if (!formats.includes(k)) {
      const own = genreKeys(O, k);
      const others = formats.flatMap((f) => genreKeys(O, f));
      genres = genres.filter((g) => !own.includes(g) || others.includes(g));
    }
    patchDraft({ formats, genres });
  };
  return (
    <>
      <div class="fmt-grid">
        {O.formats.map((f) => {
          const on = d.formats.includes(f.k);
          return (
            <button
              type="button"
              key={f.k}
              class={`fmt${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={activator(undefined, () => fmt(f.k))}
            >
              <img src={f.img} alt="" />
              <span>{f.t}</span>
              <i class="ck" style={on ? undefined : FMT_CK_OFF}>
                {on ? <Icon name="check" size={16} /> : null}
              </i>
            </button>
          );
        })}
      </div>
      {d.formats.map((k) => {
        const f = O.formats.find((x) => x.k === k);
        if (!f) return null;
        return (
          <Block key={k} title={`Em ${f.t.toLowerCase()}, o que você curte?`}>
            <OptChips
              list={O.genres[k] ?? []}
              sel={d.genres}
              onPick={(g) => patchDraft({ genres: toggled(d.genres, g) ?? d.genres })}
            />
          </Block>
        );
      })}
      <Block title="E fora da tela?">
        <OptChips
          list={O.themes}
          sel={d.themes}
          onPick={(t) => patchDraft({ themes: toggled(d.themes, t) ?? d.themes })}
        />
      </Block>
    </>
  );
}

function Trava({ d, O, desk }: { d: Draft; O: O; desk: boolean }) {
  const pick = (k: string) => {
    const diffs = toggled(d.diffs, k) ?? d.diffs;
    patchDraft({ diffs, mainDiff: diffs.includes(d.mainDiff) ? d.mainDiff : (diffs[0] ?? '') });
  };
  const mine = d.diffs.flatMap((k) => O.diffs.filter((x) => x.k === k));
  return (
    <>
      <div class="stack" style={desk ? CARDS_DESK : { '--gap': '10px' }}>
        {O.diffs.map((x) => {
          const on = d.diffs.includes(x.k);
          return (
            <button
              type="button"
              key={x.k}
              class={`optcard${on ? ' on' : ''}`}
              aria-pressed={on}
              style={{ minHeight: '60px' }}
              onClick={activator(undefined, () => pick(x.k))}
            >
              <span class="ico">
                <OptIcon name={x.icon ?? ''} />
              </span>
              <span class="h3 grow">{x.t}</span>
              {on ? <Icon name="check" size={22} extra={{ style: { color: 'var(--orange)' } }} /> : null}
            </button>
          );
        })}
      </div>
      {d.diffs.length > 1 ? (
        <div class="card or mt16 stack" style={{ '--gap': '10px' }}>
          <div class="lbl or">Qual trava mais?</div>
          <OptChips
            list={mine}
            sel={d.mainDiff || d.diffs[0] || ''}
            single
            onPick={(k) => patchDraft({ mainDiff: k })}
          />
          <p class="xs">Vira o foco da semana na tela Hoje.</p>
        </div>
      ) : null}
    </>
  );
}

/**
 * The labels share a two-line box, top-aligned, so when "Vendo vídeos" wraps on a phone its first line
 * stays level with "Ouvindo" and "Falando", and every card of the row keeps the same height.
 */
const STYLE_LABEL = {
  fontSize: '.95rem',
  lineHeight: '1.2',
  minHeight: '2.4em',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
};

function Estilo({ d, O }: { d: Draft; O: O }) {
  const n = d.styles.length;
  return (
    <>
      {/* Like the Objetivo counter: says why Continuar waits while no card is marked (the chips
          below come preselected and do not count). */}
      <div class="sm" style={{ fontWeight: '700', marginBottom: '12px' }}>
        {n ? `${n} ${n === 1 ? 'escolhido' : 'escolhidos'}` : 'Marque pelo menos um para continuar'}
      </div>
      <div class="grid3">
        {O.styles.map((x) => (
          <button
            type="button"
            key={x.k}
            class={`optcard${d.styles.includes(x.k) ? ' on' : ''}`}
            aria-pressed={d.styles.includes(x.k)}
            style={{ flexDirection: 'column', textAlign: 'center', gap: '8px', padding: '14px 8px' }}
            onClick={activator(undefined, () => patchDraft({ styles: toggled(d.styles, x.k) ?? d.styles }))}
          >
            <span class="ico">
              <OptIcon name={x.icon ?? ''} />
            </span>
            <span class="h3" style={STYLE_LABEL}>
              {x.t}
            </span>
          </button>
        ))}
      </div>
      <Block title="Você rende mais…">
        <OptChips list={O.company} sel={d.company} single onPick={(k) => patchDraft({ company: k })} />
      </Block>
      <Block title="Quando você erra, prefere que a Maggie…">
        <OptChips list={O.feedback} sel={d.feedback} single onPick={(k) => patchDraft({ feedback: k })} />
      </Block>
    </>
  );
}

/** Desktop: the 7 days span the column as 56px-tall tiles (squares would be 92px in a 720px body). */
const DAY_DESK = { aspectRatio: 'auto', height: '56px' };
/** Desktop: the four minute options as equal columns, in line with the days above. */
const MINUTES_DESK = { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' };
/** Phone: the four minute options as a 2×2 grid instead of three in a row and "50 min" alone below. */
const MINUTES_PHONE = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' };

function Ritmo({ d, O, desk }: { d: Draft; O: O; desk: boolean }) {
  const R = d.reminders;
  const max = O.remindMax;
  const days = d.days.length;
  const add = () => {
    if (R.length >= max) return;
    patchDraft({ reminders: [...R, nextReminder(R)] });
    requestAnimationFrame(() => document.getElementById(`onb-rem${R.length}`)?.focus());
  };
  const setRem = (i: number, v: string) => patchDraft({ reminders: R.map((t, j) => (j === i ? v : t)) });
  return (
    <>
      <Block
        title="Dias da semana"
        sub={`${days} dias por semana · ${days >= 5 ? 'ritmo da série' : days >= 3 ? 'ritmo tranquilo' : 'ritmo leve'}`}
      >
        <div class="days">
          {O.days.map((l, i) => (
            <button
              type="button"
              key={i}
              class={d.days.includes(i) ? 'on' : ''}
              style={desk ? DAY_DESK : undefined}
              aria-label={weekdayName(i)}
              aria-pressed={d.days.includes(i)}
              onClick={activator(undefined, () =>
                patchDraft({ days: (toggled(d.days, i) ?? d.days).slice().sort((x, y) => x - y) }),
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </Block>
      <Block title="Minutos por dia">
        <OptChips
          list={O.minutes}
          sel={d.minutes}
          single
          style={O.minutes.length !== 4 ? undefined : desk ? MINUTES_DESK : MINUTES_PHONE}
          onPick={(k) => patchDraft({ minutes: k })}
        />
      </Block>
      <Block title="Lembretes" sub="Escolha o horário. Você pode ter mais de um.">
        <div class="stack" style={{ '--gap': '10px' }}>
          {R.length ? (
            R.map((t, i) => (
              <div key={i} class="row" style={{ '--gap': '10px' }}>
                <Icon name="bell" size={22} extra={{ style: { color: 'var(--blue)', flex: 'none' } }} />
                <input
                  class="input grow"
                  id={`onb-rem${i}`}
                  type="time"
                  value={t}
                  aria-label={`Horário do lembrete ${i + 1}`}
                  onInput={(e) => setRem(i, e.currentTarget.value)}
                />
                <button
                  type="button"
                  class="iconbtn"
                  aria-label={`Remover lembrete ${i + 1}`}
                  onClick={activator(undefined, () => patchDraft({ reminders: R.filter((_, j) => j !== i) }))}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            ))
          ) : (
            <div class="sm">Sem lembrete. Dá para adicionar agora ou depois, no seu perfil.</div>
          )}
          {R.length < max ? (
            <button
              type="button"
              class="btn light compact"
              style={{ alignSelf: 'flex-start' }}
              onClick={activator(undefined, add)}
            >
              <Icon name="plus" size={18} />
              <span>{R.length ? 'Adicionar outro lembrete' : 'Adicionar lembrete'}</span>
            </button>
          ) : null}
        </div>
      </Block>
    </>
  );
}

function StepBody({ k, d, c, desk }: { k: string; d: Draft; c: Catalog; desk: boolean }) {
  const O = c.onboarding;
  if (k === 'objetivo') return <Objetivo d={d} O={O} desk={desk} />;
  if (k === 'gostos') return <Gostos d={d} O={O} />;
  if (k === 'trava') return <Trava d={d} O={O} desk={desk} />;
  if (k === 'estilo') return <Estilo d={d} O={O} />;
  if (k === 'ritmo') return <Ritmo d={d} O={O} desk={desk} />;
  if (k === 'voz') return <Voz />;
  return null;
}

// ---------- Wizard ----------

const SIGNUP_FIELDS: Record<string, keyof AccountForm> = {
  fullName: 'fullName',
  name: 'name',
  birth: 'birth',
  email: 'email',
  password: 'pass',
};
const FIELD_MSG: Record<keyof AccountForm, string> = {
  fullName: 'Digite o nome e o sobrenome.',
  name: 'Diga como quer ser chamado.',
  birth: 'Confira a data de nascimento.',
  email: 'Confira o e-mail.',
  pass: `A senha precisa de pelo menos ${LIMITS.passwordMin} caracteres.`,
};

export default function Cadastro({ params, q }: ScreenProps) {
  useChrome({ title: 'Cadastro' });
  const s = state.value;
  const c = catalog.value;
  const list = steps();
  const N = list.length;
  const n = Math.min(N, Math.max(1, Number(params.step) || 1));
  const st = list[n - 1] ?? list[0];
  const k = st?.k ?? 'conta';
  const d = s.draft;
  const signedIn = !!s.user;
  const last = n === N;
  const ok = stepValid(k, d);
  const desk = layoutOf(s) === 'desktop';

  // Signed in (account already created): the step shows what the account holds, not empty fields.
  const [form, setForm] = useState<AccountForm>(() => ({
    fullName: d.fullName || s.user?.fullName || '',
    name: d.name || s.user?.name || '',
    birth: d.birth,
    email: s.user?.email ?? d.email,
    pass: '',
  }));
  const u = s.user;
  useEffect(() => {
    if (!u) return;
    setForm((f) => ({
      ...f,
      fullName: f.fullName || d.fullName || u.fullName,
      name: f.name || d.name || u.name,
      birth: f.birth || d.birth,
      email: u.email,
    }));
  }, [u?.id]);
  const [err, setErr] = useState<AccountErrors>({});
  const [busy, setBusy] = useState(false);
  const ts = useTurnstile('signup');

  // Steps after the account need a session: signed out, the wizard starts at the account.
  useLayoutEffect(() => {
    if (!signedIn && n > 1) replace('cadastro/1');
  }, [signedIn, n]);
  useEffect(() => () => void flushDraft(), []);

  const setF = (p: Partial<AccountForm>) => setForm((f) => ({ ...f, ...p }));

  const submitAccount = async () => {
    const { errors, form: f } = accountErrors(form, !signedIn);
    setForm(f);
    setErr(errors);
    if (Object.keys(errors).length) return;
    const fields = { fullName: f.fullName.trim(), name: f.name.trim(), birth: f.birth };
    if (signedIn) {
      patchDraft(fields);
      goStep(2);
      return;
    }
    setBusy(true);
    try {
      const [cfg, turnstileToken] = await Promise.all([authConfig(), ts.token()]);
      await call(authApi.signup, {
        body: {
          ...fields,
          email: f.email.trim(),
          password: f.pass,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
          termsVersion: cfg.termsVersion,
          acceptTerms: true,
          turnstileToken,
        },
      });
      setForm((x) => ({ ...x, pass: '' }));
      await afterAuth();
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiError && x.code === 'email_taken') {
        setErr({ email: x.message });
        return;
      }
      const paths = issuePaths(x);
      const fieldErr: AccountErrors = {};
      for (const [p, field] of Object.entries(SIGNUP_FIELDS)) if (paths[p]) fieldErr[field] = FIELD_MSG[field];
      if (Object.keys(fieldErr).length) setErr(fieldErr);
      else toast(x instanceof Error && x.message === TURNSTILE_ERROR ? TURNSTILE_ERROR : errorMessage(x));
    } finally {
      ts.reset();
    }
  };

  const next = () => {
    if (busy) return;
    if (k === 'conta') {
      void submitAccount();
      return;
    }
    if (!stepValid(k, d)) return;
    if (k === 'trava' && !d.mainDiff) patchDraft({ mainDiff: d.diffs[0] ?? '' });
    goStep(n + 1);
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    // The last answers must reach the server before the profile is completed with them.
    if (!(await flushAllDraft())) {
      setBusy(false);
      return;
    }
    try {
      const r = await call(meApi.profileComplete);
      set((x) => ({
        profile: r.profile,
        settings: { ...r.settings, phone: false },
        onbStep: N,
        user: x.user ? { ...x.user, name: r.profile.name, fullName: r.profile.fullName } : x.user,
      }));
      confetti();
      toast(`Tudo pronto. Bem-vindo a Beacon, ${r.profile.name}.`);
      replace('inicio');
      void refreshState();
    } catch (x) {
      toast(errorMessage(x));
      setBusy(false);
    }
  };

  const foot = last ? (
    d.voice ? (
      <Btn label="Começar o curso" cls="grow" iconR="play" dis={busy} onClick={() => void finish()} />
    ) : (
      <Btn label="Pular por enquanto" kind="ghost" cls="grow" dis={busy} onClick={() => void finish()} />
    )
  ) : (
    <>
      {st?.skip ? <Btn label="Pular" kind="ghost" onClick={() => goStep(Math.min(N, n + 1))} /> : null}
      <Cta
        label={busy ? 'Criando a sua conta…' : 'Continuar'}
        cls="grow"
        iconR="next"
        dis={(!ok && n !== 1) || busy}
        onClick={next}
      />
    </>
  );

  const body =
    k === 'conta' ? (
      <Conta f={form} setF={setF} err={err} creating={!signedIn} onNext={next} turnstileRef={ts.ref} warm={ts.warm} />
    ) : c && signedIn ? (
      <StepBody k={k} d={d} c={c} desk={desk} />
    ) : null;

  return (
    <div class="scroll">
      <div class="wiz-head">
        <div class="row" style={{ '--gap': '10px' }}>
          {n > 1 ? (
            <button
              type="button"
              class="iconbtn"
              aria-label="Voltar"
              onClick={activator(undefined, () => goStep(Math.max(1, n - 1)))}
            >
              <Icon name="back" size={20} />
            </button>
          ) : (
            <button
              type="button"
              class="iconbtn"
              aria-label="Sair"
              onClick={activator(
                signedIn ? undefined : 'entrar',
                signedIn ? () => void logout().then((out) => out && resetDraftQueue()) : undefined,
              )}
            >
              <Icon name="close" size={20} />
            </button>
          )}
          <div class="grow">
            <div class="lbl">
              Etapa {n} de {N} · {st?.t}
            </div>
            <div class="steps mt8">
              {list.map((_, i) => (
                <i key={i} class={i + 1 < n ? 'done' : i + 1 === n ? 'now' : ''} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div class="wiz-body">
        <div class="stack" style={{ '--gap': '6px', marginBottom: '18px' }}>
          <h1 class="h1">{st?.h}</h1>
          <p class="p muted">{st?.s}</p>
        </div>
        {body}
      </div>
      <div class="wiz-foot" style={desk ? FOOT_DESK : undefined}>
        {foot}
      </div>
      {k === 'conta' && isLegalDoc(q.doc) ? <LegalSheet path="cadastro/1" doc={q.doc} /> : null}
    </div>
  );
}
