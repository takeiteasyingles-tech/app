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
import { activator, Btn, Icon, uiConfig } from '@tie/ui';
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
const SCENE = 'Você toca a campainha da casa dos Woods, em Beacon. Margaret Woods abre a porta. Ela não conhece você.';
const MISSION = 'cumprimentar, dizer o seu nome, responder quando ela perguntar como você está, e se despedir.';
/** quiz_hit scope of the right answers: `lead-eb{n}:{turn}`, once per turn a day. */
const scopeOf = (ebook: number) => `lead-eb${ebook}`;

function fresh(eb: Ebook): LeadState {
  const first = eb.lead[0]?.m ?? { en: '', pt: '' };
  return { msgs: [{ who: 'her', en: first.en, pt: first.pt }], turn: 0, fix: [], typing: false, done: false };
}

/**
 * Margaret's bubbles on a phone: as wide as the answer rows under them (a bubble of arbitrary width
 * did not line up with anything), with the speech-bubble corner kept.
 */
const HER_BUB = { border: '1.5px solid var(--line)', width: '100%', maxWidth: '100%' };
/** In the desktop chat panel (a white card) her bubbles sit on cream instead. */
const HER_BUB_PANEL = {
  ...HER_BUB,
  background: '#fff',
  padding: '14px 18px',
};
/** Desktop: the talk sits on a soft surface that fills the panel down to the answers (a chat window). */
const TALK_AREA = { flex: '1', background: '#FBF7EE', borderRadius: '16px', padding: '14px' };
const ME_BUB_PANEL = { padding: '14px 18px' };
/**
 * The option letters on a soft blue square in dark blue: visible on the white rows (tie.css's cream
 * barely showed) without the weight of solid navy squares beside the answer text.
 */
const OPT_KEY = { background: 'var(--blueT)', color: 'var(--blueD)' };

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
    <div class="card navy stack" style={{ '--gap': '10px', padding: desk ? '20px' : '16px' }}>
      {/* Desktop: the scene opens the chat panel; this card keeps the mission and the progress. */}
      <div class="lbl" style={{ color: 'var(--onNavy)' }}>
        {desk ? 'Sua missão' : 'A cena'}
      </div>
      {desk ? null : (
        <p class="p" style={{ lineHeight: '1.55', margin: '0' }}>
          {SCENE}
        </p>
      )}
      <p class={desk ? 'p' : 'sm'} style={{ margin: '0', lineHeight: '1.55' }}>
        {desk ? MISSION.charAt(0).toUpperCase() + MISSION.slice(1) : `Sua missão: ${MISSION}`}
      </p>
      <div class="row mt4" style={{ '--gap': '10px' }}>
        {/* One segment per line of hers (a plain track read as a dull grey bar on the navy card):
            answered ones filled orange, the one being answered an empty segment with a bright ring
            (a filled one read as already answered beside "0 de 5"), the rest a faint outline. */}
        <div
          class="row grow"
          role="progressbar"
          aria-label="Falas respondidas"
          aria-valuemin={0}
          aria-valuemax={turns}
          aria-valuenow={answered}
          style={{ '--gap': '5px' }}
        >
          {eb.lead.map((_, i) => (
            <span
              key={i}
              style={{
                flex: '1 1 0',
                height: '8px',
                borderRadius: '999px',
                background: i < answered ? 'var(--orange)' : 'transparent',
                boxShadow:
                  i < answered
                    ? 'none'
                    : i === answered && !L.done
                      ? 'inset 0 0 0 2px #fff'
                      : 'inset 0 0 0 1.5px rgba(255,255,255,.4)',
              }}
            />
          ))}
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
              gap: '12px',
              width: '100%',
              padding: '0 16px 0 8px',
              textAlign: 'left',
              // Round pills with a "repeat" mark, not the lettered square rows of the answers: these
              // ask her to say her line again (she does, slower).
              background: '#fff',
              borderColor: 'var(--line2)',
            }}
            onClick={activator(undefined, () => askHelp(h.en))}
          >
            <span
              aria-hidden="true"
              style={{
                width: '30px',
                height: '30px',
                flex: 'none',
                borderRadius: '50%',
                background: 'var(--blueT)',
                color: 'var(--blueD)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="repeat" size={17} />
            </span>
            <b class="grow" style={{ whiteSpace: 'nowrap' }}>
              {h.en}
            </b>
            <span class="sm" style={{ textAlign: 'right', fontWeight: '600', lineHeight: '1.3' }}>
              {h.pt}
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  // Desktop: the stage direction opens the panel as a left-aligned note (an orange rule on its edge),
  // and the talk follows right under it, then the answers: no gap anywhere in the panel.
  const chat = (
    <div class="stack" style={{ '--gap': '10px' }}>
      {desk ? (
        <div
          class="stack"
          style={{
            '--gap': '4px',
            padding: '12px 16px',
            borderRadius: '0 14px 14px 0',
            borderLeft: '4px solid var(--orange)',
            background: 'var(--orangeT)',
          }}
        >
          <span class="lbl or">A cena</span>
          <span class="p" style={{ lineHeight: '1.55', color: 'var(--navy)', fontWeight: '500' }}>
            {SCENE}
          </span>
        </div>
      ) : null}
      {L.msgs.map((m, i) => (
        <Bubble key={i} m={m} panel={desk} />
      ))}
      {L.typing ? (
        <div class="thinking" style={desk ? { background: '#fff' } : { border: '1.5px solid var(--line)' }}>
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
            <span class="key" style={OPT_KEY}>
              {String.fromCharCode(65 + i)}
            </span>
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

  // The same scene, spoken for real: the Mic mission it prepares for (both layouts; on a phone it
  // closes the page, under the help phrases).
  const micCard = L.done ? null : (
    <div class="card stack" style={{ '--gap': '8px', padding: '16px' }}>
      <div class="lbl">Falando de verdade</div>
      <p class="sm" style={{ margin: '0' }}>
        {`Depois do roteiro, faça a mesma cena por voz com ${the}, no Mic.`}
      </p>
      <div>
        <Btn label="Treinar no Mic" kind="ghost compact" go="maggie?modo=missao&m=gente" icon="mic" />
      </div>
    </div>
  );
  if (desk) {
    // Desktop: the conversation is a chat panel (scene note and talk at the top, the answers at its
    // foot), the mission, the help phrases and the Mic card in a sticky side column.
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '24px', alignItems: 'start' }}>
        {/* At least as tall as the screen under the head, the answers kept at its foot like a chat
            window (a short panel left a large empty band below both columns). */}
        <div
          class="card stack"
          style={{ '--gap': '16px', padding: '20px', minHeight: 'max(520px, calc(100dvh - 150px))' }}
        >
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
          <div style={TALK_AREA}>{chat}</div>
          <div class="stack" style={{ '--gap': '14px' }}>
            {options}
            {end}
          </div>
        </div>
        <div class="stack" style={{ '--gap': '14px', position: 'sticky', top: '16px' }}>
          {scene}
          {helpBox}
          {micCard}
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
      {micCard}
    </>
  );
}
