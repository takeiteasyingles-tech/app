// Take the Lead: the scripted branching chat with Margaret (leadReset / leadSend / leadHelp in
// prototipo/js/screens/curso.js). Ephemeral: it starts over every time the screen is opened.
// A right option earns the prototype's +5 (server-side, as a daily quiz hit per turn); a wrong one
// adds a fix to the end card and plays the soft sfx. Margaret answers after a 900 ms typing pause.
//
// DEVIATION (anti-farming, intentional): the prototype awarded maggie_turn on every right answer;
// here a right answer is a soft quiz_hit keyed `lead-eb{n}:{turn}`, so it pays once per turn per day
// and does not count toward the Mic medals (maggie_turn is reserved for real Mic conversations).
//
// Beyond the prototype: Margaret's bubbles carry an avatar, the scene card shows how many lines are
// answered, the options use the lettered .opt rows of the exercises, the help phrases are even
// one-line rows, and on desktop the scene and the help phrases move to a sticky side column.
import type { Ebook } from '@tie/shared/content/schema';
import { assistantThe, getAssistant } from '@tie/shared/domain/assist';
import { activator, Btn, uiConfig } from '@tie/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { say } from '../../core/speech';
import { catalog, gameEvent, state } from '../../store';
import { sub } from './common';

interface Msg {
  who: 'her' | 'me';
  en: string;
  pt: string;
}

interface LeadState {
  msgs: Msg[];
  turn: number;
  fix: string[];
  typing: boolean;
  done: boolean;
}

/** The scene's speaker (her voice profile is Maggie's: aka Margaret). */
const HER = 'Margaret';
/** quiz_hit scope of the right answers: `lead-eb{n}:{turn}`, once per turn a day. */
const scopeOf = (ebook: number) => `lead-eb${ebook}`;

function fresh(eb: Ebook): LeadState {
  const first = eb.lead[0]?.m ?? { en: '', pt: '' };
  return { msgs: [{ who: 'her', en: first.en, pt: first.pt }], turn: 0, fix: [], typing: false, done: false };
}

/** Margaret's bubbles: a real speech card (wide enough to read as the scene's lead), not a tag. */
const HER_BUB = { border: '1.5px solid var(--line)', minWidth: 'min(100%, 300px)', width: 'fit-content' };
/** In the desktop chat panel (a white card) her bubbles sit on cream instead. */
const HER_BUB_PANEL = {
  ...HER_BUB,
  background: 'var(--cream)',
  border: '0',
  minWidth: 'min(100%, 380px)',
  padding: '14px 18px',
};
const ME_BUB_PANEL = { padding: '14px 18px' };
/**
 * Desktop chat panel height: the screen under the page head (wrap padding 22 + 44, head ~56, gap 14),
 * capped so a tall screen does not get an empty panel, and never below what a turn needs.
 */
const PANEL_MIN_H = 'clamp(520px, calc(100dvh - 136px), 800px)';

function Bubble({ m, panel = false }: { m: Msg; panel?: boolean }) {
  const me = m.who === 'me';
  return (
    <div
      class={`bub ${me ? 'me' : 'her'}`}
      style={me ? (panel ? ME_BUB_PANEL : undefined) : panel ? HER_BUB_PANEL : HER_BUB}
    >
      {/* The desktop panel names her in its own header; on a phone each bubble carries her name. */}
      {me || panel ? null : (
        <div class="row" style={{ '--gap': '8px', marginBottom: '6px' }}>
          <span class="av-ini" aria-hidden="true" style={{ '--s': '26px', background: 'var(--orange)' }}>
            {HER.charAt(0)}
          </span>
          <span class="xs" style={{ fontWeight: '800', color: 'var(--navy)' }}>
            {`${HER} Woods`}
          </span>
        </div>
      )}
      <div class="en" style={{ fontSize: panel ? '1.18rem' : me ? undefined : '1.08rem' }}>
        {m.en}
      </div>
      <div class="pt" style={me ? { color: '#E7ECF7' } : undefined}>
        {m.pt}
      </div>
    </div>
  );
}

export function Lead({ eb, desk = false }: { eb: Ebook; desk?: boolean }) {
  const name = state.value.profile?.name ?? '';
  const c = catalog.value;
  const help = c?.mic.help ?? [];
  const the = c?.assistants.length
    ? assistantThe(getAssistant(c.assistants, state.value.profile?.assistant))
    : 'a Maggie';
  const [L, setL] = useState<LeadState>(() => fresh(eb));
  // Pending typing timers belong to one conversation: a reset (or leaving) drops them.
  const gen = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      gen.current++;
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );
  const later = (ms: number, fn: () => void) => {
    const g = gen.current;
    timers.current.push(
      setTimeout(() => {
        if (gen.current === g) fn();
      }, ms),
    );
  };

  const reset = () => {
    gen.current++;
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    setL(fresh(eb));
  };

  const send = (i: number) => {
    const turn = eb.lead[L.turn];
    const o = turn?.opts[i];
    if (!turn || !o || L.typing || L.done) return;
    const msgs: Msg[] = [...L.msgs, { who: 'me', en: sub(o.en, name), pt: sub(o.pt, name) }];
    const fix = o.fix ? [...L.fix, sub(o.fix, name)] : L.fix;
    if (o.fix) uiConfig.sfx('soft');
    else void gameEvent('quiz_hit', `${scopeOf(eb.num)}:${L.turn}`);
    if (L.turn >= eb.lead.length - 1) {
      setL({ ...L, msgs, fix, done: true });
      return;
    }
    const next = L.turn + 1;
    setL({ ...L, msgs, fix, typing: true });
    later(900, () => {
      const m = eb.lead[next]?.m;
      if (!m) return;
      setL((cur) => ({ ...cur, turn: next, typing: false, msgs: [...cur.msgs, { who: 'her', en: m.en, pt: m.pt }] }));
      void say(m.en, { who: HER });
    });
  };

  const askHelp = (en: string) => {
    const h = help.find((x) => x.en === en);
    const cur = eb.lead[L.turn]?.m;
    if (!h || !cur || L.typing || L.done) return;
    setL({ ...L, typing: true, msgs: [...L.msgs, { who: 'me', en: h.en, pt: h.pt }] });
    later(800, () => {
      setL((s) => ({
        ...s,
        typing: false,
        msgs: [...s.msgs, { who: 'her', en: cur.en, pt: `(de novo, mais devagar) ${cur.pt}` }],
      }));
      void say(cur.en, { rate: 0.75, who: HER });
    });
  };

  const turn = eb.lead[L.turn];
  const turns = eb.lead.length;
  // Lines answered so far (Margaret's next line moves the count on).
  const answered = L.done ? turns : Math.min(turns, L.turn);
  const open = !L.done && !L.typing && !!turn;

  const scene = (
    <div class="card navy stack" style={{ '--gap': '8px', padding: '16px' }}>
      <div class="lbl" style={{ color: 'var(--onNavy)' }}>
        A cena
      </div>
      <p class="p">
        Você toca a campainha da casa dos Woods, em Beacon. Margaret Woods abre a porta. Ela não conhece você.
      </p>
      <p class="sm" style={{ margin: '0' }}>
        Sua missão: cumprimentar, dizer o seu nome, responder quando ela perguntar como você está, e se despedir.
      </p>
      <div class="row mt4" style={{ '--gap': '10px' }}>
        {/* An orange fill on a lighter track: tie.css's blue on navy3 barely showed on the navy card. */}
        <div class="bar or grow" style={{ background: 'rgba(255,255,255,.3)' }}>
          <i style={{ width: `${turns ? Math.round((answered / turns) * 100) : 0}%` }} />
        </div>
        <span class="xs" style={{ fontWeight: '800', color: '#fff', whiteSpace: 'nowrap' }}>
          {`${answered} de ${turns} falas`}
        </span>
      </div>
    </div>
  );

  const helpBox = open ? (
    <div class="stack" style={{ '--gap': '8px' }}>
      <div class="lbl">Frases de socorro</div>
      {/* One even row per phrase, the phrase on the left and its meaning on the right: every phrase
          stays on one line (three tiles side by side wrapped some of them on a phone). */}
      <div class="stack" style={{ '--gap': '6px' }}>
        {help.map((h) => (
          <button
            key={h.en}
            type="button"
            class="chip"
            style={{
              justifyContent: 'space-between',
              gap: '12px',
              width: '100%',
              padding: '0 16px',
              borderRadius: '14px',
              textAlign: 'left',
              // A tint, not the white of the answers above: these ask for help, they do not answer.
              background: 'var(--blueT)',
              borderColor: 'transparent',
            }}
            onClick={activator(undefined, () => askHelp(h.en))}
          >
            <b style={{ whiteSpace: 'nowrap' }}>{h.en}</b>
            <span class="xs" style={{ textAlign: 'right' }}>
              {h.pt}
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const chat = (
    <div class="stack" style={{ '--gap': '10px' }}>
      {L.msgs.map((m, i) => (
        <Bubble key={i} m={m} panel={desk} />
      ))}
      {L.typing ? (
        <div class="thinking" style={desk ? { background: 'var(--cream)' } : { border: '1.5px solid var(--line)' }}>
          <i />
          <i />
          <i />
        </div>
      ) : null}
    </div>
  );

  const options =
    open && turn ? (
      <div class="stack" style={{ '--gap': '8px' }}>
        <div class="lbl">Responda em voz alta ou toque</div>
        {turn.opts.map((o, i) => (
          <button key={`${L.turn}-${i}`} type="button" class="opt" onClick={activator(undefined, () => send(i))}>
            <span class="key">{String.fromCharCode(65 + i)}</span>
            <span class="grow">
              <span class="en" style={{ display: 'block', fontSize: '1.02rem' }}>
                {sub(o.en, name)}
              </span>
              <span class="sm" style={{ display: 'block', fontWeight: '500' }}>
                {sub(o.pt, name)}
              </span>
            </span>
          </button>
        ))}
      </div>
    ) : null;

  const end = L.done ? (
    <div class="card hi stack pop" style={{ '--gap': '12px' }}>
      <div class="lbl or">Devolutiva</div>
      <div class="h2">Missão cumprida.</div>
      {L.fix.length ? (
        L.fix.slice(0, 3).map((t, i) => (
          <div key={i} class="fb fix">
            {t}
          </div>
        ))
      ) : (
        <div class="fb ok">Nenhum ajuste desta vez. Você cumprimentou, disse o seu nome, respondeu e se despediu.</div>
      )}
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        <Btn label="Conversar de novo" kind="ghost compact" onClick={reset} />
        <Btn label={`Fazer ao vivo com ${the}`} kind="compact" go="maggie?modo=missao&m=gente" icon="mic" />
      </div>
    </div>
  ) : null;

  if (desk) {
    // Desktop: the conversation is a chat panel as tall as the screen allows (a chat window, not a
    // short card over an empty main), the answers at its foot, the scene and the help phrases in a
    // side column beside it.
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '24px', alignItems: 'start' }}>
        <div class="card stack" style={{ '--gap': '16px', padding: '20px', minHeight: PANEL_MIN_H }}>
          <div class="row" style={{ '--gap': '10px' }}>
            <span class="av-ini" aria-hidden="true" style={{ '--s': '36px', background: 'var(--orange)' }}>
              {HER.charAt(0)}
            </span>
            <span>
              <span class="h3" style={{ display: 'block' }}>{`${HER} Woods`}</span>
              <span class="xs">Na porta da casa dos Woods, em Beacon</span>
            </span>
          </div>
          <div style={{ height: '1.5px', background: 'var(--line)' }} />
          {chat}
          <div class="stack" style={{ '--gap': '14px', marginTop: 'auto', paddingTop: '4px' }}>
            {options}
            {end}
          </div>
        </div>
        <div class="stack" style={{ '--gap': '14px', position: 'sticky', top: '16px' }}>
          {scene}
          {helpBox}
        </div>
      </div>
    );
  }
  return (
    <>
      {scene}
      {chat}
      {options}
      {helpBox}
      {end}
    </>
  );
}
