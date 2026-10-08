// #/perfil "Você": port of TIE.screens.perfil (prototipo/js/screens/conta.js). Tastes and difficulties
// stay editable and the app reorganizes at once. PROD (spec 01 §12): the photo goes to R2 + moderation,
// the plan card shows the real plan and AI minutes, and "Apagar dados" became "Zerar progresso" and
// "Excluir minha conta" (LGPD), both confirmed.
// Same sections and markup as the prototype; on mobile a sticky row of shortcuts jumps between the
// groups of the long page, and on desktop the assistant row and the tip span the width and the cards
// sit in two level-ending columns (photo, rhythm, settings and account on the left, level and tastes on
// the right) with Sair below, instead of one 4000px column next to an empty side.
import { LIMITS } from '@tie/shared/constants';
import type { Catalog } from '@tie/shared/content/schema';
import { assistantThe, getAssistant } from '@tie/shared/domain/assist';
import { goalTarget } from '@tie/shared/domain/game';
import { levelInfo, reminders as sortedReminders } from '@tie/shared/domain/personalize';
import type { MicSession, Profile, Settings, TieState } from '@tie/shared/state';
import { AssistPicker, activator, Btn, Icon, Toggle, toast } from '@tie/ui';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { aiOnline } from '../../core/aiClient';
import { synth } from '../../core/sound';
import { say } from '../../core/speech';
import { type ScreenProps, useChrome } from '../../frame';
import { layoutOf } from '../../shell';
import { catalog, catalogImage, patchSettings, state } from '../../store';
import { LiveGamebar, LiveLevelPill, UserPicture } from '../../ui-blocks/chrome';
import { nextReminder, toggled, weekdayName } from '../cadastro/onb';
import { OptChips, Sec } from '../cadastro/ui';
import { logout } from '../entrada/session';
import { AccountActions } from './Account';
import { clearPhoto, uploadPhoto } from './photo';
import { saveProfile, saveProfileSoon } from './save';

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

const JUMP_BAR = {
  position: 'sticky',
  top: '0',
  zIndex: '4',
  display: 'flex',
  gap: '6px',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  margin: '0 -18px',
  padding: '8px 18px',
  background: 'linear-gradient(var(--cream) 80%, rgba(248,245,235,0))',
};
/** The five shortcuts share the phone's width (all of "Conta" visible at 375px); they scroll past that. */
const JUMP_CHIP = {
  flex: '1 1 auto',
  justifyContent: 'center',
  whiteSpace: 'nowrap',
  minHeight: '38px',
  padding: '0 8px',
  fontSize: '.86rem',
};

/** Desktop: two columns of cards under the full-width header; both columns end on the same line. */
const COLS = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' };
const COL = { '--gap': '14px' };
/** The last card of a desktop column takes the rest of its height, so the two columns finish level. */
const FILL = { flex: '1 0 auto', display: 'grid' };
/** A horizontal scroller whose cut-off edge fades out while there is more to the right. */
const FADE = {
  maskImage: 'linear-gradient(to right, #000 calc(100% - 36px), transparent)',
  WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 36px), transparent)',
};

/** Wraps a row that scrolls sideways (the assistant cards): the right edge fades until the end is reached. */
function FadeRow({ children }: { children: ComponentChildren }) {
  const [end, setEnd] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const check = () => {
    const el = ref.current?.firstElementChild;
    if (el instanceof HTMLElement) setEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  };
  useLayoutEffect(() => {
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return (
    <div ref={ref} style={end ? undefined : FADE} onScrollCapture={check}>
      {children}
    </div>
  );
}
/** Desktop: the day squares keep a comfortable size instead of filling the card's width. */
const DAYS_DESK = { maxWidth: '420px' };

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

function JumpNav() {
  return (
    <nav aria-label="Seções do perfil" style={JUMP_BAR}>
      {JUMPS.map(([t, id]) => (
        <button key={id} type="button" class="chip" style={JUMP_CHIP} onClick={activator(undefined, () => jump(id))}>
          {t}
        </button>
      ))}
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
          <Icon name="bell" size={20} extra={{ style: { color: 'var(--blue)', flex: 'none' } }} />
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
          style={{ alignSelf: 'flex-start' }}
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
  return (
    <Sec title="Plano" id="pf-plano">
      <div class="listrow">
        <div class="grow">
          <div class="h3">Plano {s.plan?.name ?? 'Padrão'}</div>
          <div class="sm">{`${limitMin} min de conversa no Mic por mês · ${used} usados`}</div>
        </div>
        <span class="pill bl">{`${left} min livres`}</span>
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
  const genreList = p.formats
    .flatMap((f) => O.genres[f] ?? [])
    .filter((g, i, a) => a.findIndex((x) => x.k === g.k) === i);
  const reminders = p.reminders ?? sortedReminders(p);
  const sessions = s.maggie.sessions.slice(0, 4);
  const mine = p.diffs.flatMap((k) => O.diffs.filter((x) => x.k === k));
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
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        {AVATARS.map((i) => (
          <button
            type="button"
            key={i}
            class={`avpick${!p.photo && (p.avatar || 1) === i ? ' on' : ''}`}
            aria-label={`Avatar ${i}`}
            aria-pressed={!p.photo && (p.avatar || 1) === i}
            onClick={activator(undefined, () => {
              void saveProfile({ avatar: i });
              void clearPhoto();
            })}
          >
            <img src={catalogImage(`avatar/user-${i}`)} alt="" />
          </button>
        ))}
      </div>
      <label class="btn light compact" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
        <Icon name="plus" size={18} />
        <span>{p.photo ? 'Trocar a minha foto' : 'Enviar a minha foto'}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          hidden
          onChange={(e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            input.value = '';
            if (file) void uploadPhoto(file);
          }}
        />
      </label>
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
      <FadeRow>
        <AssistPicker
          list={c.assistants}
          cur={cur.k}
          onPick={(k) => {
            const a = getAssistant(c.assistants, k);
            void saveProfile({ assistant: a.k });
            void say(a.hello.en, { who: a.name });
          }}
        />
      </FadeRow>
    </Sec>
  );

  const tip = (
    <div class="fb tip">
      <b>O app se reorganiza na hora.</b> Mude um gosto ou uma dificuldade e veja Hoje, o EXTRA e as missões do Mic
      mudarem.
    </div>
  );

  const tastes = (
    <>
      <Sec title="Seu nível" id="pf-nivel">
        <OptChips
          list={O.levels}
          sel={p.level}
          single
          onPick={(k) => void saveProfile({ level: k }, 'Nível atualizado.')}
        />
      </Sec>
      <Sec title="O que você busca" sub="Até 3. Define as missões do Mic.">
        <OptChips list={O.goals} sel={p.goals} onPick={(k) => tg('goals', k, LIMITS.goalsMax)} />
      </Sec>
      <Sec title="Formatos que você curte" sub="Define a sua prateleira no EXTRA.">
        <OptChips
          list={O.formats}
          sel={p.formats}
          onPick={(k) => tg('formats', k, undefined, 'Prateleira do EXTRA reorganizada.')}
        />
      </Sec>
      {genreList.length ? (
        <Sec title="Gêneros">
          <OptChips list={genreList} sel={p.genres} onPick={(k) => tg('genres', k)} />
        </Sec>
      ) : null}
      <Sec title="Fora da tela">
        <OptChips list={O.themes} sel={p.themes} onPick={(k) => tg('themes', k)} />
      </Sec>

      <Sec title="O que trava">
        <OptChips
          list={O.diffs}
          sel={p.diffs}
          onPick={(k) => {
            const diffs = toggled(p.diffs, k) ?? p.diffs;
            void saveProfile({ diffs, mainDiff: diffs.includes(p.mainDiff) ? p.mainDiff : (diffs[0] ?? '') });
          }}
        />
        {p.diffs.length > 1 ? (
          <>
            <div class="lbl mt8">O que trava mais · vira o foco da semana</div>
            <OptChips
              list={mine}
              sel={p.mainDiff}
              single
              onPick={(k) => void saveProfile({ mainDiff: k }, 'Foco da semana atualizado.')}
            />
          </>
        ) : null}
      </Sec>
    </>
  );

  const learning = (
    <Sec title="Jeito de aprender">
      <OptChips list={O.styles} sel={p.styles} onPick={(k) => tg('styles', k)} />
      <div class="lbl mt8">Quando erra, {assistantThe(cur)}…</div>
      <OptChips list={O.feedback} sel={p.feedback} single onPick={(k) => void saveProfile({ feedback: k })} />
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
    <Sec title="Do zero ao B2">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: '5px' }}>
        {LADDER.map((cefr, i) => (
          <div key={cefr} class="stack tc" style={{ '--gap': '5px', alignItems: 'center' }}>
            <div
              style={{
                width: '100%',
                height: '46px',
                borderRadius: '6px',
                background:
                  i === rung
                    ? 'linear-gradient(to top,var(--blue) 22%,var(--line) 22%)'
                    : i < rung
                      ? 'var(--blue)'
                      : 'var(--line)',
              }}
            />
            <span class="xs" style={{ fontWeight: '800' }}>
              {cefr}
            </span>
          </div>
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
  const account = <AccountActions desk={desk} onLogout={onLogout} />;

  if (desk) {
    return (
      <div class="wrap stack" style={{ '--wrap': '1120px', '--gap': '14px', paddingTop: '16px' }}>
        {head}
        {/* The assistant row needs the full width: in a column its fifth card would be cut off. */}
        {assistant}
        {tip}
        <div style={COLS}>
          <div class="stack" style={COL}>
            {photo}
            {ladder}
            {rhythm}
            {mic}
            {prefs}
            <Plan s={s} />
            <div style={FILL}>{account}</div>
          </div>
          <div class="stack" style={COL}>
            {tastes}
            <div style={FILL}>{learning}</div>
          </div>
        </div>
        {/* Sair closes the page under both columns, a regular-size button rather than a full-width bar. */}
        <div class="row">
          <Btn label="Sair" kind="ghost" icon="logout" onClick={onLogout} />
        </div>
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
      {tastes}
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
  return <div class="scroll">{p && c ? <Body s={s} p={p} c={c} desk={desk} /> : null}</div>;
}
