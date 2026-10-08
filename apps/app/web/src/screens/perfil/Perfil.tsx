// #/perfil "Você": port of TIE.screens.perfil (prototipo/js/screens/conta.js). Tastes and difficulties
// stay editable and the app reorganizes at once. PROD (spec 01 §12): the photo goes to R2 + moderation,
// the plan card shows the real plan and AI minutes, and "Apagar dados" became "Zerar progresso" and
// "Excluir minha conta" (LGPD), both confirmed.
// Same sections and markup as the prototype; on mobile a sticky section bar (which lights the group
// being read) jumps between the groups of the long page and the five assistants share one row; on
// desktop the assistant row and the tip span the width, the cards sit in rows of two height-matched
// cells (you on the left, your tastes on the right) and one full-width "Conta e dados" card closes the
// page with Sair, instead of one 4000px column next to an empty side.
import { LIMITS } from '@tie/shared/constants';
import type { AssistantPublic, Catalog } from '@tie/shared/content/schema';
import { assistantThe, getAssistant } from '@tie/shared/domain/assist';
import { goalTarget } from '@tie/shared/domain/game';
import { levelInfo, reminders as sortedReminders } from '@tie/shared/domain/personalize';
import type { MicSession, Profile, Settings, TieState } from '@tie/shared/state';
import { AssistThumb, activator, Icon, Toggle, toast } from '@tie/ui';
import { type ComponentChildren, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { aiOnline } from '../../core/aiClient';
import { synth } from '../../core/sound';
import { say } from '../../core/speech';
import { type ScreenProps, useChrome } from '../../frame';
import { layoutOf } from '../../shell';
import { catalog, catalogImage, patchSettings, state } from '../../store';
import { LiveGamebar, LiveLevelPill, UserPicture } from '../../ui-blocks/chrome';
import { nextReminder, toggled, weekdayName } from '../cadastro/onb';
import { ADD_ROW, BELL_TILE, OptChips, Sec } from '../cadastro/ui';
import { logout } from '../entrada/session';
import { AccountActions } from './Account';
import { clearPhoto, uploadPhoto } from './photo';
import { saveProfile, saveProfileSoon } from './save';
import './perfil.css';

const LADDER = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+'];
const AVATARS = [1, 2, 3, 4, 5, 6];
const TEXT_SIZES: readonly (readonly [Settings['ts'], string])[] = [
  [1, 'A'],
  [1.12, 'A+'],
  [1.25, 'A++'],
];

const TEXT_SIZE_NAMES: Record<string, string> = {
  A: 'A (texto normal)',
  'A+': 'A+ (texto grande)',
  'A++': 'A++ (texto maior)',
};

/** Mobile shortcuts: label and the id of the first card of each group. */
const JUMPS: readonly (readonly [string, string])[] = [
  ['Foto', 'pf-foto'],
  ['Gostos', 'pf-nivel'],
  ['Ritmo', 'pf-ritmo'],
  ['Ajustes', 'pf-prefs'],
  ['Conta', 'pf-plano'],
];

/** The sticky strip: the cream page shows through below the bar while cards scroll under it. */
const JUMP_BAR = {
  position: 'sticky',
  top: '0',
  zIndex: '4',
  margin: '0 -18px',
  padding: '8px 18px 10px',
  background: 'linear-gradient(var(--cream) 78%, rgba(248,245,235,0))',
};
/** One white segmented bar, inset from both gutters like the cards, with five equal segments. */
const JUMP_TRACK = {
  display: 'flex',
  gap: '2px',
  padding: '4px',
  background: '#fff',
  border: '1.5px solid var(--line)',
  borderRadius: '999px',
  boxShadow: '0 6px 16px -12px rgba(15,42,85,.45)',
};
const JUMP_BTN = {
  flex: '1 1 0',
  minWidth: '0',
  minHeight: '38px',
  padding: '0 4px',
  borderRadius: '999px',
  fontWeight: '800',
  fontSize: '.84rem',
  whiteSpace: 'nowrap',
  color: 'var(--muted)',
};
const JUMP_BTN_ON = { ...JUMP_BTN, background: 'var(--navy)', color: '#fff' };

/**
 * Desktop: the cards in rows of two cells of matching height (each cell one card or a short stack of
 * related ones, the last stretched to the row), so every row's cards start and end on the same lines
 * instead of two free columns whose cards end at staggered heights.
 */
const ROW2 = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px', alignItems: 'stretch' };
const CELL = { '--gap': '14px' };
const CELL_FILL = { flex: '1 1 auto', display: 'grid' };
/** Desktop assistant cards share the row's width instead of stopping at 136px each. */
const ASSIST_DESK = { flex: '1 1 0', maxWidth: 'none' };
/**
 * Phone: the five assistants in one row (no card cut off at the edge, nothing to scroll sideways):
 * face and name only, the chosen one's tag written under the row.
 */
const ASSIST_PHONE = { flex: '1 1 0', minWidth: '0', maxWidth: 'none', gap: '6px' };
const ASSIST_ROW_PHONE = { gap: '4px', overflow: 'visible', padding: '6px 4px 2px' };
const ASSIST_IMG_PHONE = { width: '52px', height: '52px' };
const ASSIST_NAME_PHONE = { fontSize: '.84rem' };
/**
 * Chips a step more compact than the onboarding's (the profile shows every set at once): 40px targets,
 * labels at the onboarding's reading size.
 */
const CHIP_SM_PHONE = { minHeight: '40px', padding: '0 12px', fontSize: '.9rem' };
const CHIP_SM_DESK = { minHeight: '40px', padding: '0 14px', fontSize: '.92rem', gap: '8px' };
/**
 * Phone: a chip set as two equal columns, radios lined up at each cell's left edge; a label too long
 * for half the width takes the whole row (dense packing keeps the grid free of holes).
 */
const GRID2_PHONE = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridAutoFlow: 'row dense' };
const CELL_PHONE = { ...CHIP_SM_PHONE, justifyContent: 'flex-start' };
const CELL_WIDE_PHONE = { ...CELL_PHONE, gridColumn: '1 / -1' };
const SHORT_LABEL = 11;
const cellPhone = (x: { t: string }) => (x.t.length > SHORT_LABEL ? CELL_WIDE_PHONE : CELL_PHONE);
/** A single choice among long options (level, feedback): one full-width pill per row. */
const LIST1 = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' };
const CELL_DESK = { ...CHIP_SM_DESK, justifyContent: 'flex-start' };
/** A small heading over each format's genres. */
const GROUP_T = { fontWeight: '800', color: 'var(--navy)' };
/** Phone: the six avatars in one row (about 45px each) instead of four and two. */
const AVATARS_PHONE = { display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '6px' };
const AVPICK_PHONE = { width: '100%', height: 'auto', aspectRatio: '1' };
/** The tip as a quiet white panel with a bulb, instead of cream text floating on the cream page. */
const TIP = {
  display: 'flex',
  gap: '12px',
  alignItems: 'flex-start',
  background: '#fff',
  border: '1.5px solid var(--line)',
  padding: '14px 16px',
  fontSize: '.92rem',
};
const TIP_ICON = {
  width: '32px',
  height: '32px',
  flex: 'none',
  borderRadius: '50%',
  background: 'var(--goldT)',
  color: '#8A5F00',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
/** Desktop: the day squares keep a comfortable size instead of filling the card's width. */
const DAYS_DESK = { maxWidth: '420px' };

const hasClips = (a: AssistantPublic): boolean => Object.values(a.clips ?? {}).some(Boolean);

/**
 * The assistant radiogroup (same markup as @tie/ui AssistPicker) with cards that share the row: on
 * desktop full cards with the tag; on a phone face and name, the tag going into each card's name.
 */
function AssistRow({
  list,
  cur,
  onPick,
  desk,
}: {
  list: readonly AssistantPublic[];
  cur: string;
  onPick: (k: string) => void;
  desk: boolean;
}) {
  return (
    <div class="assist-row" role="radiogroup" aria-label="Seu assistente" style={desk ? undefined : ASSIST_ROW_PHONE}>
      {list.map((a) => (
        // biome-ignore lint/a11y/useSemanticElements: the prototype's radiogroup of buttons; tie.css styles .assist buttons.
        <button
          type="button"
          key={a.k}
          class={`assist${a.k === cur ? ' on' : ''}`}
          role="radio"
          aria-checked={a.k === cur ? 'true' : 'false'}
          aria-label={desk ? undefined : `${a.name}, ${a.tag}`}
          style={desk ? ASSIST_DESK : ASSIST_PHONE}
          onClick={activator(undefined, () => onPick(a.k))}
        >
          {!desk && hasClips(a) && a.thumb ? (
            <img src={a.thumb} alt="" style={ASSIST_IMG_PHONE} />
          ) : (
            <AssistThumb a={a} size={desk ? 60 : 52} />
          )}
          <b style={desk ? undefined : ASSIST_NAME_PHONE}>{a.name}</b>
          {desk ? <span>{a.tag}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** One desktop cell: its cards stacked, the last one stretched to the row's height. */
function Cell({ items }: { items: readonly ComponentChildren[] }) {
  const last = items[items.length - 1];
  return (
    <div class="stack" style={CELL}>
      {items.slice(0, -1).map((x, i) => (
        <Fragment key={i}>{x}</Fragment>
      ))}
      {last ? <div style={CELL_FILL}>{last}</div> : null}
    </div>
  );
}

/** A desktop row: two height-matched cells, or one card across the width. */
type DeskRow = { pair: [ComponentChildren[], ComponentChildren[]] } | { full: ComponentChildren };

type ToggleKey = 'sound' | 'fx' | 'hd' | 'slow' | 'remind';

const limitToast = (max: number) => toast(`Até ${max}. Desmarque um para trocar.`);

function setToggle(st: Settings, k: ToggleKey) {
  if (k === 'hd' && !st.hd && !aiOnline.value) {
    toast('A voz HD precisa da IA ligada. Tente de novo mais tarde.');
    return;
  }
  const on = !st[k];
  if (k === 'sound' && !on) synth.stop();
  void patchSettings({ [k]: on }).catch(() => {});
}

function jump(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/** The group being read: the last shortcut whose first card has reached the bar. */
function useCurrentJump(ref: { current: HTMLElement | null }): string {
  const [cur, setCur] = useState(JUMPS[0]?.[1] ?? '');
  useEffect(() => {
    const nav = ref.current;
    const sc = nav?.closest('.scroll');
    if (!nav || !sc) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const line = nav.getBoundingClientRect().bottom + 24;
      let on = JUMPS[0]?.[1] ?? '';
      for (const [, id] of JUMPS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) on = id;
      }
      // At the very end of the page the last group is the one being read.
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) on = JUMPS[JUMPS.length - 1]?.[1] ?? on;
      setCur(on);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      sc.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return cur;
}

function JumpNav() {
  const ref = useRef<HTMLElement>(null);
  const cur = useCurrentJump(ref);
  return (
    <nav aria-label="Seções do perfil" style={JUMP_BAR} ref={ref}>
      <div style={JUMP_TRACK}>
        {JUMPS.map(([t, id]) => (
          <button
            key={id}
            type="button"
            style={cur === id ? JUMP_BTN_ON : JUMP_BTN}
            aria-current={cur === id ? 'true' : undefined}
            onClick={activator(undefined, () => jump(id))}
          >
            {t}
          </button>
        ))}
      </div>
    </nav>
  );
}

function Setting({ t, sub, on, onClick }: { t: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <div class="listrow">
      <div class="grow">
        <div class="h3">{t}</div>
        <div class="sm">{sub}</div>
      </div>
      <Toggle on={on} label={t} onClick={onClick} />
    </div>
  );
}

function Reminders({ p, max }: { p: Profile; max: number }) {
  const R = p.reminders;
  return (
    <div class="stack" style={{ '--gap': '8px' }}>
      {R.map((t, i) => (
        <div key={i} class="row" style={{ '--gap': '10px' }}>
          <Icon name="bell" size={20} extra={{ style: BELL_TILE }} />
          <input
            class="input grow"
            id={`pf-rem${i}`}
            type="time"
            value={t}
            aria-label={`Horário do lembrete ${i + 1}`}
            onInput={(e) => {
              const v = e.currentTarget.value;
              const next = R.map((x, j) => (j === i ? v : x));
              if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) saveProfileSoon('reminders', next);
            }}
          />
          <button
            type="button"
            class="iconbtn"
            aria-label={`Remover lembrete ${i + 1}`}
            onClick={activator(undefined, () => void saveProfile({ reminders: R.filter((_, j) => j !== i) }))}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
      {R.length ? null : <div class="sm">Sem lembrete.</div>}
      {R.length < max ? (
        <button
          type="button"
          class="btn light compact"
          style={ADD_ROW}
          onClick={activator(undefined, () => void saveProfile({ reminders: [...R, nextReminder(R)] }))}
        >
          <Icon name="plus" size={18} />
          <span>Adicionar lembrete</span>
        </button>
      ) : null}
    </div>
  );
}

function sessionTitle(c: Catalog, x: MicSession): string {
  if (x.mode === 'missao') return c.mic.missions.find((m) => m.k === x.mission)?.t ?? 'Missão';
  return c.mic.modes.find((m) => m.k === x.mode)?.t ?? 'Conversa';
}

function MicSessions({ c, list }: { c: Catalog; list: readonly MicSession[] }) {
  return (
    <Sec title="Conversas no Mic">
      {list.map((x) => (
        <a key={x.id} class="listrow" href={`#/maggie/relatorio/${x.id}`} style={{ color: 'inherit' }}>
          <span class="iconbtn" style={{ border: '0', background: 'var(--cream)' }}>
            <Icon name="mic" size={18} />
          </span>
          <div class="grow">
            <div class="h3">{sessionTitle(c, x)}</div>
            <div class="sm">
              {`${new Date(x.at).toLocaleDateString('pt-BR')} · ${x.turns.filter((t) => t.who === 'me').length} falas`}
            </div>
          </div>
          <Icon name="next" size={18} />
        </a>
      ))}
    </Sec>
  );
}

function Plan({ s }: { s: TieState }) {
  const limitMin = Math.round((s.plan?.aiMinutesMonth ?? s.maggie.limitSec / 60) || 0);
  const used = Math.max(0, Math.round((s.maggie.limitSec - s.maggie.secLeft) / 60));
  const left = Math.max(0, Math.round(s.maggie.secLeft / 60));
  const pct = limitMin ? Math.min(100, Math.round((used / limitMin) * 100)) : 0;
  return (
    <Sec title="Plano" id="pf-plano">
      <div class="listrow">
        <div class="grow">
          <div class="h3">Plano {s.plan?.name ?? 'Padrão'}</div>
          <div class="sm">{`${limitMin} min de conversa no Mic por mês · ${used} usados`}</div>
        </div>
        <span class="pill bl">{`${left} min livres`}</span>
      </div>
      {/* The month's Mic minutes at a glance (used of the plan's total). */}
      <div
        class="bar"
        role="progressbar"
        aria-label="Minutos de conversa usados neste mês"
        aria-valuemin={0}
        aria-valuemax={limitMin}
        aria-valuenow={Math.min(used, limitMin)}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
    </Sec>
  );
}

function Body({ s, p, c, desk }: { s: TieState; p: Profile; c: Catalog; desk: boolean }) {
  const O = c.onboarding;
  const st = s.settings;
  const lv = levelInfo(O.levels, p);
  // The rung of the level's CEFR (A1+ is the 2nd), so the ladder agrees with the header pill.
  const cefrIdx = LADDER.indexOf(lv.cefr);
  const rung = cefrIdx >= 0 ? cefrIdx : lv.season - 1;
  const cur = getAssistant(c.assistants, p.assistant);
  // Chip clouds: free-flowing on desktop, a two-column grid on a phone; long single choices as a list.
  const cloud = desk ? { chipStyle: CHIP_SM_DESK } : { style: GRID2_PHONE, chipStyle: cellPhone };
  const list1 = { style: LIST1, chipStyle: desk ? CELL_DESK : CELL_PHONE };
  // The genres under the format they belong to (a genre two formats share shows once, under the first).
  const seen = new Set<string>();
  const genreGroups = p.formats
    .map((f) => ({
      f,
      t: O.formats.find((x) => x.k === f)?.t ?? f,
      list: (O.genres[f] ?? []).filter((g) => !seen.has(g.k) && !!seen.add(g.k)),
    }))
    .filter((g) => g.list.length);
  const reminders = p.reminders ?? sortedReminders(p);
  const sessions = s.maggie.sessions.slice(0, 4);
  const mine = p.diffs.flatMap((k) => O.diffs.filter((x) => x.k === k));
  const fileRef = useRef<HTMLInputElement>(null);
  const pickAssistant = (k: string) => {
    const a = getAssistant(c.assistants, k);
    void saveProfile({ assistant: a.k });
    void say(a.hello.en, { who: a.name });
  };
  const tg = (key: 'goals' | 'formats' | 'genres' | 'themes' | 'styles', k: string, max?: number, msg?: string) => {
    const next = toggled(p[key], k, max);
    if (!next) {
      if (max) limitToast(max);
      return;
    }
    void saveProfile({ [key]: next }, msg);
  };

  const head = (
    <>
      <div class="card navy row" style={{ '--gap': '14px' }}>
        <UserPicture size={72} />
        <div class="grow">
          <div class="h1" style={{ color: '#fff' }}>
            {p.name}
          </div>
          <div class="xs mt4" style={{ color: 'var(--onNavy)' }}>
            {s.user?.email ?? ''}
          </div>
          <div class="row mt8 wrapx" style={{ '--gap': '6px' }}>
            <LiveLevelPill />
            <span class="pill" style={{ background: 'var(--navy2)', color: '#fff' }}>
              {`${lv.cefr} · Temporada ${lv.season}`}
            </span>
          </div>
        </div>
      </div>
      <LiveGamebar />
    </>
  );

  const photo = (
    <Sec
      title="Sua foto"
      id="pf-foto"
      sub="Escolha um avatar ou envie uma foto. A foto é privada e passa por uma revisão da equipe."
    >
      <div class="row wrapx" style={desk ? { '--gap': '8px' } : AVATARS_PHONE}>
        {AVATARS.map((i) => (
          <button
            type="button"
            key={i}
            class={`avpick${!p.photo && (p.avatar || 1) === i ? ' on' : ''}`}
            aria-label={`Avatar ${i}`}
            aria-pressed={!p.photo && (p.avatar || 1) === i}
            style={desk ? undefined : AVPICK_PHONE}
            onClick={activator(undefined, () => {
              void saveProfile({ avatar: i });
              void clearPhoto();
            })}
          >
            <img src={catalogImage(`avatar/user-${i}`)} alt="" />
          </button>
        ))}
      </div>
      {/* A real button (keyboard and screen readers reach it) that opens the hidden file input; the
          prototype's <label> around a hidden input had no Tab stop. */}
      <button
        type="button"
        class="btn light compact"
        style={{ alignSelf: 'flex-start' }}
        onClick={activator(undefined, () => fileRef.current?.click())}
      >
        <Icon name="plus" size={18} />
        <span>{p.photo ? 'Trocar a minha foto' : 'Enviar a minha foto'}</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        hidden
        tabIndex={-1}
        aria-label="Escolher a foto"
        onChange={(e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          input.value = '';
          if (file) void uploadPhoto(file);
        }}
      />
      {p.photo ? (
        <button
          type="button"
          class="btn link"
          style={{ alignSelf: 'flex-start' }}
          onClick={activator(undefined, () => void clearPhoto())}
        >
          Usar um avatar em vez da foto
        </button>
      ) : null}
    </Sec>
  );

  const assistant = (
    <Sec title="Seu assistente no Mic" sub="Quem conversa com você: cada personagem tem voz e jeito de falar próprios.">
      <AssistRow list={c.assistants} cur={cur.k} onPick={pickAssistant} desk={desk} />
      {desk ? null : (
        <div class="sm">
          <b style={{ color: 'var(--navy)' }}>{cur.name}</b> · {cur.tag}
        </div>
      )}
    </Sec>
  );

  const tip = (
    <div class="fb tip" style={TIP}>
      <span style={TIP_ICON} aria-hidden="true">
        <Icon name="bulb" size={18} />
      </span>
      <span>
        <b>O app se reorganiza na hora.</b> Mude um gosto ou uma dificuldade e veja Hoje, o EXTRA e as missões do Mic
        mudarem.
      </span>
    </div>
  );

  const level = (
    <Sec title="Seu nível" id="pf-nivel">
      <OptChips
        {...list1}
        list={O.levels}
        sel={p.level}
        single
        onPick={(k) => void saveProfile({ level: k }, 'Nível atualizado.')}
      />
    </Sec>
  );

  const goals = (
    <Sec title="O que você busca" sub="Até 3. Define as missões do Mic.">
      <OptChips {...cloud} list={O.goals} sel={p.goals} onPick={(k) => tg('goals', k, LIMITS.goalsMax)} />
    </Sec>
  );
  const formats = (
    <Sec title="Formatos que você curte" sub="Define a sua prateleira no EXTRA.">
      <OptChips
        {...cloud}
        list={O.formats}
        sel={p.formats}
        onPick={(k) => tg('formats', k, undefined, 'Prateleira do EXTRA reorganizada.')}
      />
    </Sec>
  );
  // One small cluster per chosen format instead of one long cloud of every genre.
  const genres = genreGroups.length ? (
    <Sec title="Gêneros" sub="Separados pelo formato que você marcou.">
      <div class="stack pf-genres" style={{ '--gap': '12px', '--cols': String(Math.min(3, genreGroups.length)) }}>
        {genreGroups.map((g) => (
          <div key={g.f} class="stack" style={{ '--gap': '6px' }}>
            <div class="xs" style={GROUP_T}>
              {g.t}
            </div>
            <OptChips {...cloud} list={g.list} sel={p.genres} onPick={(k) => tg('genres', k)} />
          </div>
        ))}
      </div>
    </Sec>
  ) : null;
  const themes = (
    <Sec title="Fora da tela">
      <OptChips {...cloud} list={O.themes} sel={p.themes} onPick={(k) => tg('themes', k)} />
    </Sec>
  );
  const diffs = (
    <Sec title="O que trava">
      <OptChips
        {...cloud}
        list={O.diffs}
        sel={p.diffs}
        onPick={(k) => {
          const diffs = toggled(p.diffs, k) ?? p.diffs;
          void saveProfile({ diffs, mainDiff: diffs.includes(p.mainDiff) ? p.mainDiff : (diffs[0] ?? '') });
        }}
      />
      {p.diffs.length > 1 ? (
        <div class="stack pf-focus pf-foot mt8" style={{ '--gap': '8px' }}>
          <div class="lbl">O que trava mais · vira o foco da semana</div>
          <OptChips
            {...cloud}
            list={mine}
            sel={p.mainDiff}
            single
            onPick={(k) => void saveProfile({ mainDiff: k }, 'Foco da semana atualizado.')}
          />
        </div>
      ) : null}
    </Sec>
  );

  const learning = (
    <Sec title="Jeito de aprender">
      <OptChips {...cloud} list={O.styles} sel={p.styles} onPick={(k) => tg('styles', k)} />
      <div class="lbl mt8">Quando erra, {assistantThe(cur)}…</div>
      <OptChips
        {...(desk ? cloud : list1)}
        list={O.feedback}
        sel={p.feedback}
        single
        onPick={(k) => void saveProfile({ feedback: k })}
      />
    </Sec>
  );

  const rhythm = (
    <Sec title="Ritmo" id="pf-ritmo">
      <div class="days" style={desk ? DAYS_DESK : undefined}>
        {O.days.map((l, i) => (
          <button
            type="button"
            key={i}
            class={p.days.includes(i) ? 'on' : ''}
            aria-label={weekdayName(i)}
            aria-pressed={p.days.includes(i)}
            title={weekdayName(i)}
            onClick={activator(
              undefined,
              () => void saveProfile({ days: (toggled(p.days, i) ?? p.days).slice().sort((x, y) => x - y) }),
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div class="lbl mt8">Minutos por dia · meta de {goalTarget(p)} pontos</div>
      <OptChips
        {...cloud}
        list={O.minutes}
        sel={p.minutes}
        single
        onPick={(k) => void saveProfile({ minutes: k }, `Meta diária: ${goalTarget({ minutes: k })} pontos.`)}
      />
      <div class="lbl mt8">Lembretes</div>
      <Reminders p={{ ...p, reminders }} max={O.remindMax} />
    </Sec>
  );

  const ladder = (
    <Sec
      title="Do zero ao B2"
      sub={`Você está no ${lv.cefr}, na temporada ${lv.season}. Cada temporada sobe um degrau.`}
    >
      {/* One rung per CEFR step: the bar over its name (perfil.css lays them out as two grid rows, the
          bars taking whatever height the card has). */}
      <div class="pf-ladder" role="img" aria-label={`Nível ${lv.cefr} de ${LADDER.length} degraus, do A1 ao B2+`}>
        {LADDER.map((cefr, i) => (
          <Fragment key={cefr}>
            <i class={i === rung ? 'now' : i < rung ? 'done' : ''} />
            <span class={i === rung ? 'now' : ''}>{cefr}</span>
          </Fragment>
        ))}
      </div>
    </Sec>
  );

  const mic = sessions.length ? <MicSessions c={c} list={sessions} /> : null;

  const prefs = (
    <Sec title="Leitura, som e efeitos" id="pf-prefs">
      <div class="listrow">
        <div class="grow">
          <div class="h3">Tamanho do texto</div>
          <div class="sm">Vale para o app inteiro</div>
        </div>
        <div class="seg">
          {TEXT_SIZES.map(([v, l]) => (
            <button
              type="button"
              key={v}
              class={st.ts === v ? 'on' : ''}
              aria-pressed={st.ts === v}
              aria-label={TEXT_SIZE_NAMES[l] ?? l}
              onClick={activator(undefined, () => void patchSettings({ ts: v }).catch(() => {}))}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <Setting
        t="Sons"
        sub="Cliques, acertos e trilha das músicas"
        on={st.sound}
        onClick={() => setToggle(st, 'sound')}
      />
      <Setting
        t="Confete e animações"
        sub="Comemorações de meta e nível"
        on={st.fx}
        onClick={() => setToggle(st, 'fx')}
      />
      <Setting
        t="Voz HD dos personagens"
        sub={aiOnline.value ? 'Voz natural gerada pela IA.' : 'Disponível quando a IA estiver ligada'}
        on={st.hd}
        onClick={() => setToggle(st, 'hd')}
      />
      <Setting
        t="Começar em 0,75×"
        sub="Velocidade inicial do diálogo"
        on={st.slow}
        onClick={() => setToggle(st, 'slow')}
      />
      <Setting
        t="Lembrete de episódio"
        sub="Quando o próximo liberar"
        on={st.remind}
        onClick={() => setToggle(st, 'remind')}
      />
    </Sec>
  );

  const onLogout = () => void logout();
  const account = <AccountActions desk={desk} email={s.user?.email ?? ''} onLogout={onLogout} />;

  if (desk) {
    const rowsDesk: DeskRow[] = [
      { pair: [[photo], [ladder]] },
      { pair: [[level], [goals]] },
      { pair: [[formats], [themes]] },
      { full: genres },
      { pair: [[rhythm], [diffs]] },
      { pair: [[prefs], [learning, mic]] },
      { full: <Plan s={s} /> },
    ];
    return (
      <div
        class="wrap stack"
        style={{ '--wrap': '1120px', '--gap': '14px', paddingTop: '16px', paddingBottom: '28px' }}
      >
        {head}
        {/* The assistant row needs the full width: in a column its fifth card would be cut off. */}
        {assistant}
        {tip}
        {/* Rows of two cells paired by height (cards of similar size side by side, each row's cards
            ending on one line; the ladder's bars and the weekly focus take up any difference), and the
            genres, one column per format, across the whole width. */}
        {rowsDesk.map((row, i) =>
          'full' in row ? (
            row.full ? (
              <Fragment key={i}>{row.full}</Fragment>
            ) : null
          ) : (
            <div key={i} style={ROW2}>
              <Cell items={row.pair[0].filter(Boolean)} />
              <Cell items={row.pair[1].filter(Boolean)} />
            </div>
          ),
        )}
        {/* One full-width card closes the page: the data actions and Sair, with the e-mail in use. */}
        {account}
      </div>
    );
  }
  return (
    <div class="wrap stack" style={{ '--wrap': '760px', '--gap': '14px', paddingTop: '16px' }}>
      {head}
      <JumpNav />
      {photo}
      {assistant}
      {tip}
      {level}
      {goals}
      {formats}
      {genres}
      {themes}
      {diffs}
      {learning}
      {rhythm}
      {ladder}
      {mic}
      {prefs}
      <Plan s={s} />
      {account}
    </div>
  );
}

export default function Perfil(_props: ScreenProps) {
  useChrome({ title: 'Você' });
  const s = state.value;
  const p = s.profile;
  const c = catalog.value;
  const desk = layoutOf(s) === 'desktop';
  return (
    <div class="scroll" data-u1="pf">
      {p && c ? <Body s={s} p={p} c={c} desk={desk} /> : null}
    </div>
  );
}
