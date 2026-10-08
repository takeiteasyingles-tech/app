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
import { ADD_ROW, BELL_TILE, Block, Cta, Field, OptChips, OptIcon } from './ui';
import { Voz } from './Voz';
import './cadastro.css';

/** An empty date input shows dd/mm/aaaa in the placeholder colour of .input, not as a typed value. */
const EMPTY_DATE = { color: '#8D93A3', fontWeight: '500' };

const LIMIT_MSG = (max: number) => `Até ${max}. Desmarque um para trocar.`;

/**
 * The body takes the free height, so the CTA row (a white bar docked at the foot, cadastro.css) always
 * rests at the bottom of the screen: the step starts under the progress header, and the bar closes the
 * page like the header opens it.
 */
const SCROLL_FLEX = { display: 'flex', flexDirection: 'column' };
const BODY_FILL = { flex: '1 0 auto' };
/**
 * Desktop: the header's row is the content column's width (684px, like the title and the options),
 * with the close/back button hanging in the margin to its left, so the step label and the progress bar
 * start on the same line as everything below them.
 */
const HEAD_ROW_DESK = { maxWidth: '684px', minHeight: '44px', position: 'relative' };
const HEAD_BTN_DESK = { position: 'absolute', left: '-54px', top: '50%', transform: 'translateY(-50%)' };

/** Chips as grid cells: radio and label start at the cell's left edge, so the radios line up in a column. */
const CHIP_CELL = { justifyContent: 'flex-start', padding: '0 14px' };
/** Desktop: wide grid cells keep radio and label together in the middle of the pill. */
const CHIP_MID = { justifyContent: 'center', padding: '0 12px' };
/** Phone: a set of short chips in two equal columns, so none is left alone on the last row. */
const PAIRS_PHONE = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' };
/** Desktop: eight short chips as two rows of four. */
const FOURS_DESK = { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' };
/**
 * Desktop: a set of three longer options on one row, each chip as wide as its own label (they grow to
 * fill the row), so the longest one is not squeezed into a third of it.
 */
const ROW_DESK = { gap: '6px', flexWrap: 'nowrap' };
const CHIP_GROW = { flex: '1 1 auto', justifyContent: 'center', padding: '0 9px', fontSize: '.92rem', gap: '7px' };
/** Phone: one option per row, every pill the full width (no half pills beside a whole one). */
const LIST_PHONE = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' };

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
      {creating ? null : <AccountDone email={f.email} />}
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
      ) : null}
      <p class="xs" style={LEGAL}>
        {creating ? 'Ao continuar você aceita os ' : 'Você aceitou os '}
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

/** The terms in a readable slate at .875rem, flowing as one paragraph without short orphan lines. */
const LEGAL = { fontSize: '.875rem', color: '#3C4357', textWrap: 'pretty', lineHeight: '1.5' };

const DONE_CARD = {
  '--gap': '12px',
  padding: '12px 14px',
  background: 'var(--greenT)',
  borderColor: 'transparent',
  alignItems: 'center',
};
const DONE_ICON = {
  width: '30px',
  height: '30px',
  flex: 'none',
  borderRadius: '50%',
  background: 'var(--green)',
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
/**
 * The e-mail under "Conta criada", beside the check (a two-line summary); a very long address breaks
 * after the "@" (the <wbr>), never inside the name or the domain.
 */
const DONE_EMAIL = {
  color: 'var(--navy)',
  fontWeight: '700',
  fontSize: '.86rem',
  lineHeight: '1.35',
  overflowWrap: 'break-word',
};

/** The step's title while the account already exists (the catalog's "Primeiro, a sua conta." asks for one). */
const CONTA_DONE = {
  h: 'Agora, sobre você.',
  s: 'Sua conta já está criada. Confira o nome e a data de nascimento.',
};
/** The account's e-mail field itself: read-only and visually hidden (the text above shows it). */
const SR_ONLY = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  border: '0',
  whiteSpace: 'nowrap',
};

/**
 * Signed in (the account was created on an earlier visit): a green "Conta criada" summary with the
 * e-mail replaces the e-mail and password fields, which can no longer change here. The password is
 * never kept on the device, so it is not shown at all.
 */
function AccountDone({ email }: { email: string }) {
  const at = email.indexOf('@');
  return (
    <div class="card row" style={DONE_CARD}>
      <span style={DONE_ICON} aria-hidden="true">
        <Icon name="check" size={18} />
      </span>
      <div class="grow" style={{ minWidth: '0', position: 'relative' }}>
        <div class="sm" style={{ fontWeight: '800', color: 'var(--green)', lineHeight: '1.3' }}>
          Conta criada com o e-mail
        </div>
        <div style={DONE_EMAIL}>
          {at > 0 ? (
            <>
              {email.slice(0, at + 1)}
              <wbr />
              {email.slice(at + 1)}
            </>
          ) : (
            email
          )}
        </div>
        <input
          id="onb-email"
          type="email"
          value={email}
          aria-label="E-mail da conta"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          style={SR_ONLY}
        />
      </div>
    </div>
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

/**
 * The empty check circle: a thick white ring over a frosted white disc with a dark halo, so it stands
 * out on a dark photo (Novelas, Business) as clearly as on a bright one (Artes, Viagens).
 */
const FMT_CK_OFF = {
  boxShadow: '0 0 0 1px rgba(10,30,63,.35), 0 2px 8px rgba(0,0,0,.55)',
  background: 'rgba(255,255,255,.3)',
  borderWidth: '3px',
};

function Gostos({ d, O, desk }: { d: Draft; O: O; desk: boolean }) {
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
          style={desk ? (O.themes.length % 4 === 0 ? FOURS_DESK : undefined) : PAIRS_PHONE}
          chipStyle={desk ? (O.themes.length % 4 !== 0 ? undefined : CHIP_MID) : CHIP_CELL}
          onPick={(t) => patchDraft({ themes: toggled(d.themes, t) ?? d.themes })}
        />
      </Block>
    </>
  );
}

/** Desktop: a little more room at the right edge of the 2-column cards for the longest label. */
const TRAVA_DESK = { minHeight: '64px', gap: '12px', paddingRight: '20px' };
const TRAVA_LABEL_DESK = { fontSize: '.98rem' };

function Trava({ d, O, desk }: { d: Draft; O: O; desk: boolean }) {
  const pick = (k: string) => {
    const diffs = toggled(d.diffs, k) ?? d.diffs;
    patchDraft({ diffs, mainDiff: diffs.includes(d.mainDiff) ? d.mainDiff : (diffs[0] ?? '') });
  };
  const mine = d.diffs.flatMap((k) => O.diffs.filter((x) => x.k === k));
  const n = d.diffs.length;
  return (
    <>
      {/* As in Objetivo and Estilo: says why Continuar waits while nothing is marked. */}
      <div class="sm" style={{ fontWeight: '700', marginBottom: '12px' }}>
        {n ? `${n} ${n === 1 ? 'escolhido' : 'escolhidos'}` : 'Marque pelo menos um para continuar'}
      </div>
      <div class="stack" style={desk ? CARDS_DESK : { '--gap': '10px' }}>
        {O.diffs.map((x) => {
          const on = d.diffs.includes(x.k);
          return (
            <button
              type="button"
              key={x.k}
              class={`optcard${on ? ' on' : ''}`}
              aria-pressed={on}
              style={desk ? TRAVA_DESK : { minHeight: '60px' }}
              onClick={activator(undefined, () => pick(x.k))}
            >
              <span class="ico">
                <OptIcon name={x.icon ?? ''} />
              </span>
              <span class="h3 grow" style={desk ? TRAVA_LABEL_DESK : undefined}>
                {x.t}
              </span>
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
 * Phone: the six options as three rows of two compact tiles, a small icon beside a one-line label (as
 * on desktop), so the grid stays short and even "Vendo vídeos" has room on both sides.
 */
const STYLE_GRID_PHONE = { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' };
const STYLE_CARD_PHONE = { gap: '10px', padding: '8px 10px', minHeight: '56px', borderRadius: '14px' };
const STYLE_ICO_PHONE = { width: '36px', height: '36px', borderRadius: '10px' };
const STYLE_LABEL_PHONE = { fontSize: '.95rem', lineHeight: '1.2', whiteSpace: 'nowrap' };
/** Desktop: icon beside the label, as the other steps' option cards. */
const STYLE_CARD_DESK = { gap: '12px', padding: '12px 14px', minHeight: '64px' };
const STYLE_LABEL_DESK = { fontSize: '1rem' };

function Estilo({ d, O, desk }: { d: Draft; O: O; desk: boolean }) {
  const n = d.styles.length;
  return (
    <>
      {/* Like the Objetivo counter: says why Continuar waits while no card is marked (the chips
          below come preselected and do not count). */}
      <div class="sm" style={{ fontWeight: '700', marginBottom: '12px' }}>
        {n ? `${n} ${n === 1 ? 'escolhido' : 'escolhidos'}` : 'Marque pelo menos um para continuar'}
      </div>
      <div class="grid3" style={desk ? undefined : STYLE_GRID_PHONE}>
        {O.styles.map((x) => (
          <button
            type="button"
            key={x.k}
            class={`optcard${d.styles.includes(x.k) ? ' on' : ''}`}
            aria-pressed={d.styles.includes(x.k)}
            style={desk ? STYLE_CARD_DESK : STYLE_CARD_PHONE}
            onClick={activator(undefined, () => patchDraft({ styles: toggled(d.styles, x.k) ?? d.styles }))}
          >
            <span class="ico" style={desk ? undefined : STYLE_ICO_PHONE}>
              <OptIcon name={x.icon ?? ''} size={desk ? 22 : 20} />
            </span>
            <span class="h3" style={desk ? STYLE_LABEL_DESK : STYLE_LABEL_PHONE}>
              {x.t}
            </span>
          </button>
        ))}
      </div>
      {/* Desktop: each set of three options on one row, every chip as wide as its label. Phone: one
          option per row, every pill the full width, the radios in one column. */}
      <Block title="Você rende mais…">
        <OptChips
          list={O.company}
          sel={d.company}
          single
          style={desk ? (O.company.length === 3 ? ROW_DESK : undefined) : LIST_PHONE}
          chipStyle={desk ? (O.company.length === 3 ? CHIP_GROW : undefined) : CHIP_CELL}
          onPick={(k) => patchDraft({ company: k })}
        />
      </Block>
      <Block title="Quando você erra, prefere que a Maggie…">
        <OptChips
          list={O.feedback}
          sel={d.feedback}
          single
          style={desk ? (O.feedback.length === 3 ? ROW_DESK : undefined) : LIST_PHONE}
          chipStyle={desk ? (O.feedback.length === 3 ? CHIP_GROW : undefined) : CHIP_CELL}
          onPick={(k) => patchDraft({ feedback: k })}
        />
      </Block>
    </>
  );
}

/** Desktop: the 7 days span the column as 48px-tall tiles (squares would be 92px in a 720px body). */
const DAY_DESK = { aspectRatio: 'auto', height: '48px' };
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
          chipStyle={O.minutes.length !== 4 ? undefined : desk ? CHIP_MID : CHIP_CELL}
          onPick={(k) => patchDraft({ minutes: k })}
        />
      </Block>
      <Block title="Lembretes" sub="Escolha o horário. Você pode ter mais de um.">
        <div class="stack" style={{ '--gap': '10px' }}>
          {R.length ? (
            R.map((t, i) => (
              <div key={i} class="row" style={{ '--gap': '10px' }}>
                <Icon name="bell" size={20} extra={{ style: BELL_TILE }} />
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
            <button type="button" class="btn light compact" style={ADD_ROW} onClick={activator(undefined, add)}>
              <Icon name="plus" size={18} />
              <span>{R.length ? 'Adicionar outro lembrete' : 'Adicionar lembrete'}</span>
            </button>
          ) : null}
        </div>
      </Block>
      <WeekSummary days={days} minutes={d.minutes} reminders={R} />
    </>
  );
}

const SUM_CARD = { '--gap': '12px', padding: '14px 16px' };
const SUM_ICON = { ...BELL_TILE, background: 'var(--orangeT)', color: 'var(--orange)' };

/** What the choices add up to, live: the week's minutes and when the reminders ring. */
function WeekSummary({ days, minutes, reminders }: { days: number; minutes: number; reminders: readonly string[] }) {
  const times = reminders.filter((t) => /^\d\d:\d\d$/.test(t)).sort();
  const when = times.length
    ? ` · ${times.length === 1 ? 'lembrete às' : 'lembretes às'} ${times.slice(0, -1).join(', ')}${times.length > 1 ? ' e ' : ''}${times[times.length - 1]}`
    : '';
  return (
    <div class="card row mt24 onb-sum" style={SUM_CARD} aria-live="polite">
      <Icon name="target" size={20} extra={{ style: SUM_ICON }} />
      <div class="grow">
        <div class="h3">{days ? `${days * minutes} min de inglês por semana` : 'Marque pelo menos um dia'}</div>
        <div class="sm">{`${days} ${days === 1 ? 'dia' : 'dias'} × ${minutes} min${when}`}</div>
      </div>
    </div>
  );
}

function StepBody({ k, d, c, desk }: { k: string; d: Draft; c: Catalog; desk: boolean }) {
  const O = c.onboarding;
  if (k === 'objetivo') return <Objetivo d={d} O={O} desk={desk} />;
  if (k === 'gostos') return <Gostos d={d} O={O} desk={desk} />;
  if (k === 'trava') return <Trava d={d} O={O} desk={desk} />;
  if (k === 'estilo') return <Estilo d={d} O={O} desk={desk} />;
  if (k === 'ritmo') return <Ritmo d={d} O={O} desk={desk} />;
  if (k === 'voz') return <Voz desk={desk} />;
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
    <div class="scroll" data-u1="onb" style={SCROLL_FLEX}>
      <div class="wiz-head">
        <div class="row" style={desk ? { '--gap': '10px', ...HEAD_ROW_DESK } : { '--gap': '10px' }}>
          {n > 1 ? (
            <button
              type="button"
              class="iconbtn"
              aria-label="Voltar"
              style={desk ? HEAD_BTN_DESK : undefined}
              onClick={activator(undefined, () => goStep(Math.max(1, n - 1)))}
            >
              <Icon name="back" size={20} />
            </button>
          ) : (
            <button
              type="button"
              class="iconbtn"
              aria-label="Sair"
              style={desk ? HEAD_BTN_DESK : undefined}
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
      <div class="wiz-body" style={BODY_FILL}>
        <div class="stack" style={{ '--gap': '6px', marginBottom: '18px' }}>
          <h1 class="h1">{k === 'conta' && signedIn ? CONTA_DONE.h : st?.h}</h1>
          <p class="p muted">{k === 'conta' && signedIn ? CONTA_DONE.s : st?.s}</p>
        </div>
        {body}
      </div>
      <div class="wiz-foot">{foot}</div>
      {k === 'conta' && isLegalDoc(q.doc) ? <LegalSheet path="cadastro/1" doc={q.doc} /> : null}
    </div>
  );
}
