// EXTRA scene player (TIE.screens.extraPlay): the still scene "played" line by line with each
// character's voice, subtitles EN / EN+PT / off, tappable words (sheet → Revisão card, +word), dub
// mode (the learner records the dub character's lines → /api/pronounce → /api/extras/:id/dub) and
// the end card (finishScene → /api/extras/:id/seen, `extra` once). Desktop: scene + controls | script.

import { DEFAULT_ASSISTANT } from '@tie/shared/constants';
import type { Extra, ExtraLine } from '@tie/shared/content/schema';
import type { PronounceResult } from '@tie/shared/contracts/ai';
import { assistantThe, getAssistant } from '@tie/shared/domain/assist';
import { defaults } from '@tie/shared/domain/personalize';
import { ApiError } from '@tie/shared/errors';
import { activator, Btn, Icon, Topbar } from '@tie/ui';
import { Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { pronounce } from '../../core/aiClient';
import { sfx } from '../../core/sound';
import * as speech from '../../core/speech';
import { Overlay, type ScreenProps, useChrome } from '../../frame';
import { replace } from '../../router';
import { addCards, markExtraSeen, saveDub } from '../../store/actions';
import { showToast } from '../../store/award';
import { loadExtra, useContent } from '../../store/content';
import { state } from '../../store/state';
import { AiBadge } from '../../ui-blocks/chrome';
import { allExtrasNow, isDesktop, loadAllExtras, pts, useCatalog, useRerender } from './data';
import { LoadFailed, OnNavy } from './parts';

type Subs = 'en' | 'both' | 'off';
type DubState = '' | 'rec' | 'busy' | 'done';

interface WordSheet {
  w: string;
  meaning: string;
  line: ExtraLine;
}

/** The prototype's V. */
interface VState {
  id: string;
  line: number;
  playing: boolean;
  subs: Subs;
  dub: boolean;
  dubState: DubState;
  word: WordSheet | null;
  saved: number;
  end: boolean;
  fb: PronounceResult | null;
  awarded: boolean;
  t?: ReturnType<typeof setTimeout>;
  stopper?: (() => Promise<void>) | null;
  /** Releases the microphone without scoring (leaving mid-take). */
  abort?: (() => void) | null;
}

const vfresh = (id: string, dub: boolean): VState => {
  const p = state.value.profile;
  return {
    id,
    line: 0,
    playing: false,
    subs: p ? defaults(p).subs : 'both',
    dub,
    dubState: '',
    word: null,
    saved: 0,
    end: false,
    fb: null,
    awarded: false,
  };
};

const WAVE_BARS = Array.from({ length: 14 }, (_, i) => i);
const SUBS: readonly (readonly [Subs, string])[] = [
  ['en', 'EN'],
  ['both', 'EN+PT'],
  ['off', 'Sem'],
];

/** data-act click: tick sfx, then the handler. */
const act = (fn: () => void) => activator(undefined, fn);

export default function ExtraPlay({ params, q }: ScreenProps) {
  // Full screen like the prototype (no tab bar / side nav: the registry's chrome).
  useChrome({ title: 'Assistindo' });
  const id = params.id ?? '';
  const { c, failed, retry } = useCatalog();
  const meta = c?.extras.find((e) => e.id === id) ?? null;
  const full = useContent(
    () => (meta && !meta.locked ? loadExtra(id) : Promise.resolve(null)),
    [id, !!meta, meta?.locked],
  );
  // Locked, unknown, or a premium title the plan does not open (403 plan_required): the title page
  // says why, so send the learner there instead of the generic load error.
  const planLocked = full.error instanceof ApiError && full.error.code === 'plan_required';
  const gone = (!!c && (!meta || meta.locked)) || planLocked;
  useEffect(() => {
    if (gone) replace(`extra/${id}`);
  }, [gone, id]);
  const x = full.data;
  const vre = useRerender();
  const ref = useRef<VState | null>(null);
  if (!ref.current || ref.current.id !== id) ref.current = vfresh(id, q.dub === '1');
  const V = ref.current;
  const alive = useRef(true);

  // The word sheet looks the word up in every extra's vocab.
  useEffect(() => {
    void loadAllExtras().catch(() => {});
  }, []);

  // leave(): stop the voice, the timers and any recording.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const v = ref.current;
      speech.stop();
      if (v) {
        v.playing = false;
        clearTimeout(v.t);
        v.abort?.();
      }
    };
  }, []);

  // after(): while playing, keep the current line of the script in view.
  useEffect(() => {
    if (!V.playing) return;
    document.getElementById(`vl${V.line}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [V.line, V.playing]);

  // Escape closes the word sheet.
  const sheetOpen = !!V.word;
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !ref.current?.word) return;
      ref.current.word = null;
      vre();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  if (gone) return <OnNavy cls="x-play" />;
  if (failed || (full.error && !x)) {
    return (
      <OnNavy>
        <Topbar back={`extra/${id}`} />
        <div class="scroll">
          <LoadFailed onRetry={retry} />
        </div>
      </OnNavy>
    );
  }
  if (!c || !meta || !x?.lines.length) return <OnNavy />;

  const lines = x.lines;
  const L = (lines[V.line] ?? lines[0]) as ExtraLine;
  const mine = V.dub && L.who === x.dub;
  const desk = isDesktop();

  // ---------- actions (TIE.act.v*) ----------
  const vstop = () => {
    speech.stop();
    V.playing = false;
    clearTimeout(V.t);
  };
  const finishScene = () => {
    V.playing = false;
    V.end = true;
    if (!V.awarded) {
      V.awarded = true;
      void markExtraSeen(x.id);
    }
    vre();
  };
  const vplayFrom = (i: number) => {
    if (!alive.current || !V.playing) return;
    if (i >= lines.length) return finishScene();
    V.line = i;
    V.dubState = '';
    V.fb = null;
    const Li = lines[i] as ExtraLine;
    if (V.dub && Li.who === x.dub) {
      V.playing = false;
      return vre();
    }
    vre();
    void speech.say(Li.en, { who: Li.who }).then(() => {
      if (alive.current && V.playing && V.line === i) V.t = setTimeout(() => vplayFrom(i + 1), 350);
    });
  };
  const vPlay = () => {
    if (V.playing) {
      vstop();
      return vre();
    }
    if (V.end) {
      V.end = false;
      V.line = 0;
    }
    V.playing = true;
    vplayFrom(V.line);
  };
  const vLine = (i: number) => {
    vstop();
    V.end = false;
    V.line = i;
    V.dubState = '';
    V.fb = null;
    vre();
    const Li = lines[i] as ExtraLine;
    if (!(V.dub && Li.who === x.dub)) void speech.say(Li.en, { who: Li.who });
  };
  const vNext = () => {
    const was = V.playing || V.dubState === 'done';
    vstop();
    if (V.line >= lines.length - 1) return finishScene();
    V.line++;
    V.dubState = '';
    V.fb = null;
    if (was) {
      V.playing = true;
      vplayFrom(V.line);
    } else vre();
  };
  const vPrev = () => {
    vstop();
    V.end = false;
    V.line = Math.max(0, V.line - 1);
    V.dubState = '';
    V.fb = null;
    vre();
  };
  const vRepeat = () => {
    vstop();
    vre();
    void speech.say(L.en, { who: L.who, rate: 0.75 });
  };
  const vSubs = (k: Subs) => {
    V.subs = k;
    vre();
  };
  const vDubMode = () => {
    V.dub = !V.dub;
    V.dubState = '';
    V.fb = null;
    vre();
  };
  const vRewind = () => {
    vstop();
    ref.current = vfresh(id, V.dub);
    vre();
  };
  const vDub = async () => {
    const lineIdx = V.line;
    const target = (lines[lineIdx] as ExtraLine).en;
    if (V.dubState === 'rec') {
      void V.stopper?.();
      return;
    }
    if (V.dubState === 'busy') return;
    let rec: Awaited<ReturnType<typeof speech.record>> | null = null;
    let heard = '';
    let lis: { stop(): void } | null = null;
    if (speech.canRecord) {
      try {
        rec = await speech.record({ maxMs: 7000 });
      } catch {
        rec = null;
      }
    }
    if (!alive.current || ref.current !== V) {
      void rec?.stop();
      return;
    }
    if (!rec) showToast('Sem microfone: a nota fica estimada.');
    sfx.rec();
    V.dubState = 'rec';
    V.fb = null;
    vre();
    if (rec && speech.canListen) {
      lis = speech.listen({
        onInterim: (t) => {
          heard = t;
        },
        onFinal: (t) => {
          heard = t;
        },
      });
    }
    V.abort = () => {
      lis?.stop();
      void rec?.stop();
    };
    V.stopper = async () => {
      V.stopper = null;
      V.abort = null;
      lis?.stop();
      V.dubState = 'busy';
      vre();
      const out = rec ? await rec.stop() : { b64: '' };
      const r = await pronounce(out.b64, target, {
        heard: heard || (rec ? '' : target),
        phraseId: `${x.id}:${lineIdx}`,
      });
      if (!alive.current || ref.current !== V) return;
      V.fb = r;
      V.dubState = 'done';
      vre();
      const source = !rec ? 'script' : r.source === 'ia' && r.attempt ? 'ia' : 'demo';
      void saveDub(x.id, lineIdx, r.score, source, source === 'ia' ? r.attempt : undefined);
    };
    setTimeout(
      () => {
        if (alive.current && V.dubState === 'rec') void V.stopper?.();
      },
      rec ? 5000 : 1600,
    );
  };
  const word = (w: string) => {
    const clean = w.replace(/[.,!?;:“”"…]/g, '');
    const key = clean.toLowerCase().replace(/’/g, "'");
    const all = x.vocab.concat(...allExtrasNow().map((e: Extra) => e.vocab));
    const hit = all.find(
      (v) => v.en.toLowerCase().split(/\s+/).includes(key) || v.en.toLowerCase() === clean.toLowerCase(),
    );
    vstop();
    V.word = { w: clean, meaning: hit ? `${hit.en} = ${hit.pt}` : '', line: L };
    vre();
  };
  const wordClose = () => {
    V.word = null;
    vre();
  };
  const wordSave = () => {
    const w = V.word;
    if (!w) return;
    V.word = null;
    vre();
    void addCards([{ en: w.line.en, pt: w.line.pt, scene: `${x.title} · ${w.line.who}` }], 'extra').then((r) => {
      if (!r) return;
      if (r.added) {
        if (ref.current === V) {
          V.saved++;
          vre();
        }
        showToast(`Levei para a Revisão: “${w.line.en}”`);
      } else showToast('Essa fala já está na sua Revisão.');
    });
  };
  const say = (t: string) => void speech.say(t);

  // ---------- view ----------
  const aThe = assistantThe(getAssistant(c.assistants, state.value.profile?.assistant || DEFAULT_ASSISTANT));
  const words = L.en.split(/(\s+)/).map((w, i) =>
    /\s+/.test(w) ? (
      w
    ) : (
      // The prototype's tappable .w spans, reachable from the keyboard too (Tab, then Enter / Space).
      // biome-ignore lint/a11y/useSemanticElements: an inline span keeps the subtitle's box-decoration wrapping (tie.css).
      <span
        key={i}
        class="w"
        role="button"
        tabIndex={0}
        onClick={act(() => word(w))}
        onKeyDown={(ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          act(() => word(w))?.(ev as unknown as MouseEvent);
        }}
      >
        {w}
      </span>
    ),
  );

  let subtitle = null;
  if (!V.end) {
    if (mine && V.dubState !== 'done') {
      subtitle = (
        <div class="sub">
          <span class="mute">
            <Icon name="mic" size={16} extra={{ style: { verticalAlign: '-3px' } }} />
            {` Sua vez, ${x.dub}`}
          </span>
          <span class="en">{L.en}</span>
        </div>
      );
    } else if (V.subs !== 'off') {
      subtitle = (
        <div class="sub">
          <span class="who">{L.who.toUpperCase()}</span>
          <span class="en">{words}</span>
          {V.subs === 'both' ? <span class="ptl">{L.pt}</span> : null}
        </div>
      );
    }
  }

  const scene = (
    <div class="scene">
      <div class={`img${V.playing ? '' : ' paused'}`} style={{ backgroundImage: `url(${x.scene ?? ''})` }} />
      <span class="tag pill" style={{ background: 'rgba(10,30,63,.7)', color: '#fff' }}>
        {V.dub ? (
          <>
            <Icon name="mic" size={12} /> Dublagem
          </>
        ) : (
          x.ep
        )}
      </span>
      {/* Phones: the demo badge rides on the scene, so the bar keeps room for "kind · episode". */}
      {desk ? null : (
        <span class="x-aib">
          <AiBadge />
        </span>
      )}
      {subtitle}
    </div>
  );

  const fb = V.fb;
  const dubPanel =
    mine && !V.end ? (
      <div class="card paper stack pop" style={{ '--gap': '10px' }}>
        <div class="lbl or">{`Sua vez · a fala é do ${x.dub}`}</div>
        <div class="h2">{L.en}</div>
        <div class="sm">{L.pt}</div>
        {V.dubState === 'rec' ? (
          <div class="waves rec">
            {WAVE_BARS.map((i) => (
              <i key={i} style={{ height: `${14 + ((i * 11) % 30)}px`, animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : null}
        {fb ? (
          <div class={`fb ${fb.score >= 8 ? 'ok' : 'fix'}`}>
            <b>{`${fb.score}/10.`}</b> {fb.praise_pt}
            {(fb.issues || []).map((it, i) => (
              <Fragment key={i}>
                {' '}
                <b>{`${it.word}:`}</b> {it.tip_pt}
              </Fragment>
            ))}
          </div>
        ) : null}
        <div class="row wrapx" style={{ '--gap': '8px' }}>
          {V.dubState === 'done' ? (
            <>
              <Btn label="Seguir a cena" onClick={vNext} iconR="next" kind="compact" />
              <Btn label="Dublar de novo" onClick={() => void vDub()} kind="ghost compact" />
            </>
          ) : (
            <>
              <Btn
                label={V.dubState === 'rec' ? 'Parar' : V.dubState === 'busy' ? 'Avaliando…' : 'Gravar a fala'}
                onClick={() => void vDub()}
                icon={V.dubState === 'rec' ? 'stop' : 'mic'}
                kind="compact"
              />
              <Btn label="Ouvir antes" onClick={() => say(L.en)} kind="ghost compact" icon="speaker" />
              <Btn label="Pular" onClick={vNext} kind="link" />
            </>
          )}
        </div>
      </div>
    ) : null;

  const dubAvg = state.value.extras.dubs[x.id];
  const endCard = V.end ? (
    <div class="card paper stack pop" style={{ '--gap': '12px' }}>
      <div class="lbl or">Fim da cena</div>
      <div class="h2">
        {`Você viu ${lines.length} falas${
          V.saved ? ` e levou ${V.saved}${V.saved > 1 ? ' palavras' : ' palavra'} para a Revisão` : ''
        }.`}
      </div>
      {V.dub ? <p class="p">{`Média na dublagem: ${dubAvg || '—'}/10.`}</p> : null}
      <div class="stack" style={{ '--gap': '8px' }}>
        <Btn label={`Contar para ${aThe} o que aconteceu`} go={`maggie?modo=extra&x=${x.id}`} icon="mic" cls="block" />
        <Btn label="Desafio com estas falas" kind="navy" go={`extra/desafio?x=${x.id}`} icon="game" cls="block" />
        <Btn label="Assistir de novo" kind="ghost" onClick={vRewind} cls="block" />
      </div>
    </div>
  ) : null;

  const script = (
    <div class="lines">
      {lines.map((l, i) => {
        const dubLine = V.dub && l.who === x.dub;
        return (
          <button
            type="button"
            key={i}
            class={`line${i === V.line ? ' on' : ''}${dubLine ? ' dub' : ''}`}
            id={`vl${i}`}
            onClick={act(() => vLine(i))}
          >
            <div class="who">{`${l.who.toUpperCase()}${dubLine ? ' · VOCÊ' : ''}`}</div>
            <div class="en">{l.en}</div>
            {V.subs === 'both' ? <div class="pt">{l.pt}</div> : null}
          </button>
        );
      })}
    </div>
  );

  const controls = (
    <>
      <div class="controls">
        <button type="button" class="iconbtn" aria-label="Anterior" onClick={act(vPrev)}>
          <Icon name="back" size={20} />
        </button>
        <button type="button" class="playbtn" aria-label={V.playing ? 'Pausar' : 'Assistir'} onClick={act(vPlay)}>
          <Icon name={V.playing ? 'pause' : 'play'} size={24} />
        </button>
        <button type="button" class="iconbtn" aria-label="Próxima" onClick={act(vNext)}>
          <Icon name="next" size={20} />
        </button>
        <button
          type="button"
          class="iconbtn"
          aria-label="Repetir devagar"
          title="Repetir em 0,75×"
          onClick={act(vRepeat)}
        >
          <Icon name="repeat" size={20} />
        </button>
        <span class="grow" />
        <span class="xs x-count">{V.end ? 'Fim da cena' : `Fala ${V.line + 1} de ${lines.length}`}</span>
      </div>
      <div class="segs" aria-hidden="true">
        {lines.map((_, i) => (
          <i key={i} class={V.end || i < V.line ? 'done' : i === V.line ? 'now' : ''} />
        ))}
      </div>
      <div class="controls x-tools">
        <div class="seg">
          {SUBS.map(([k, l]) => (
            <button type="button" key={k} class={V.subs === k ? 'on' : ''} onClick={act(() => vSubs(k))}>
              {l}
            </button>
          ))}
        </div>
        {x.dub ? (
          <button type="button" class={`chip${V.dub ? ' on' : ''}`} aria-pressed={V.dub} onClick={act(vDubMode)}>
            <span class="ck">{V.dub ? <Icon name="check" size={12} /> : null}</span>
            {`Dublar o ${x.dub}`}
          </button>
        ) : null}
      </div>
      <div class="xs x-hint">
        <Icon name="cc" size={16} />
        Toque numa palavra da legenda para salvar.
      </div>
    </>
  );

  // Desktop: the scene's words under the player (the prototype left that column empty).
  const vocabCard = x.vocab.length ? (
    <div class="card x-vocab">
      <div class="lbl">Vocabulário da cena</div>
      <div class="stack mt8" style={{ '--gap': '0' }}>
        {x.vocab.map((v) => (
          <div key={v.en} class="listrow">
            <button
              type="button"
              class="en grow row"
              style={{ textAlign: 'left', color: '#fff', '--gap': '10px' }}
              aria-label={`Ouvir: ${v.en}`}
              onClick={act(() => say(v.en))}
            >
              <span class="sayico">
                <Icon name="speaker" size={16} />
              </span>
              {v.en}
            </button>
            <span style={{ color: 'var(--onNavy)' }}>{v.pt}</span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const ws = V.word;
  return (
    <OnNavy cls="x-play" w={1100}>
      <Topbar back={`extra/${x.id}`} kicker={`${x.kind} · ${x.ep}`} title={x.title} right={desk ? <AiBadge /> : null} />
      <div class="scroll">
        <div class="wrap" style={{ '--wrap': '1100px' }}>
          {desk ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)',
                gap: '28px',
                alignItems: 'start',
              }}
            >
              <div class="stack" style={{ '--gap': '14px' }}>
                {scene}
                {controls}
                {dubPanel}
                {endCard}
                {vocabCard}
              </div>
              <div class="stack" style={{ '--gap': '8px' }}>
                <div class="lbl">Roteiro da cena</div>
                {script}
              </div>
            </div>
          ) : (
            <div class="stack" style={{ '--gap': '14px' }}>
              {scene}
              {controls}
              {dubPanel}
              {endCard}
              <div class="lbl mt8">Roteiro da cena</div>
              {script}
            </div>
          )}
        </div>
      </div>
      {ws ? (
        <Overlay>
          <div class="overlay">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the scrim closes the sheet like the prototype; "Fechar" is the keyboard path. */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: same markup as the prototype's .scrim. */}
            <div class="scrim" onClick={act(wordClose)} />
            <div class="sheet">
              <div class="grab" />
              <div class="row between">
                <div class="h1">{ws.w}</div>
                <button type="button" class="iconbtn" aria-label="Ouvir" onClick={act(() => say(ws.w))}>
                  <Icon name="speaker" size={20} />
                </button>
              </div>
              {ws.meaning ? <div class="h3 mt8">{ws.meaning}</div> : null}
              <div class="card soft mt12">
                <div class="en">{ws.line.en}</div>
                <div class="pt mt4">{ws.line.pt}</div>
              </div>
              <div class="stack mt16" style={{ '--gap': '8px' }}>
                <Btn
                  label={`Levar para a Revisão · +${pts(c, 'word', 3)}`}
                  onClick={wordSave}
                  icon="plus"
                  cls="block"
                />
                <Btn label="Fechar" kind="ghost" onClick={wordClose} cls="block" />
              </div>
            </div>
          </div>
        </Overlay>
      ) : null}
    </OnNavy>
  );
}
