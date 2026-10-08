// Episode player (#/episodio/:ep/:step?), port of prototipo/js/screens/player.js: head with the
// 10-step bar, the episode map (bottom sheet on mobile, 300px aside on desktop), the step body and
// the foot whose Next is gated by the shared need(). Progress is server-authoritative: media endings
// post step-ok, Next posts advance (the server re-runs need(); a refusal rolls prog back and the
// route falls back to the last reached step), exercises and Mic scores are graded/recorded by the
// server, and its award results play the prototype's toasts, sfx and confetti.

import { signal } from '@preact/signals';
import type { Catalog, Episode } from '@tie/shared/content/schema';
import { ebookApi } from '@tie/shared/contracts/ebook';
import type { MicScoreSource } from '@tie/shared/contracts/progress';
import { gate } from '@tie/shared/domain/gating';
import { defaults } from '@tie/shared/domain/personalize';
import { stepKey, type TieState } from '@tie/shared/state';
import { confetti, Icon, Segs, toast, uiConfig } from '@tie/ui';
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { pronounce } from '../../core/aiClient';
import { sfx, synth } from '../../core/sound';
import { speech } from '../../core/speech';
import { Overlay, type ScreenProps, useChrome } from '../../frame';
import { go, replace, route } from '../../router';
import { layoutOf } from '../../shell';
import {
  advanceStep,
  answerExercise,
  catalog,
  catalogImage,
  finishEpisode,
  loadCatalog,
  loadEpisode,
  markStep,
  saveMicScore,
  send,
  state,
  useContent,
} from '../../store';
import {
  fresh,
  heard,
  lyricRows,
  type MicFeedback,
  type PState,
  pad2,
  remember,
  type StepActions,
  type StepCtx,
  stepAudio,
  type Tap,
} from './model';
import { renderStep } from './steps';
import './player.css';

/** Episodes already loaded this page: a step change (a new route) renders at once, without a blank frame. */
const loaded = new Map<number, Episode>();

/**
 * The player's progress writes (step-ok, advance, episode-done) go out one after the other, so a Next
 * pressed right after a media ending reaches the server after that step's step-ok, never before it.
 */
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = writes.then(fn, fn);
  writes = p.catch(() => undefined);
  return p;
}

/**
 * Writes waiting in serial() have not applied their optimistic patch yet (send() applies it when the
 * request starts). Until they settle, the player overlays them on the store, so a Next pressed while
 * an earlier write is in flight is not bounced back by the "step > prog" redirect and a media ending
 * unlocks Next at once. On settle the overlay entry goes away: the store then holds the confirmed
 * value (or the queued-offline optimistic one), or the rolled-back one after a refusal.
 */
const pend = signal<{ prog: Readonly<Record<string, number>>; ok: Readonly<Record<string, true>> }>({
  prog: {},
  ok: {},
});

/** The store as the player sees it: confirmed state plus the writes still waiting in serial(). */
function view(s: TieState): TieState {
  const p = pend.value;
  const progKeys = Object.keys(p.prog);
  const okKeys = Object.keys(p.ok);
  if (!progKeys.length && !okKeys.length) return s;
  const prog: Record<string, number> = { ...s.prog };
  for (const k of progKeys) prog[k] = Math.max(prog[k] || 1, p.prog[k] ?? 1);
  return { ...s, prog, stepOk: okKeys.length ? { ...s.stepOk, ...p.ok } : s.stepOk };
}

/** Runs a serialized write with its overlay entry in place until the request settles. */
function pending<T>(entry: { prog?: [string, number]; ok?: string }, fn: () => Promise<T>): Promise<T> {
  const cur = pend.value;
  pend.value = {
    prog: entry.prog ? { ...cur.prog, [entry.prog[0]]: entry.prog[1] } : cur.prog,
    ok: entry.ok ? { ...cur.ok, [entry.ok]: true } : cur.ok,
  };
  const clear = () => {
    const now = pend.value;
    const prog = { ...now.prog };
    const ok = { ...now.ok };
    // A later advance of the same episode replaced this entry: it clears its own.
    if (entry.prog && prog[entry.prog[0]] === entry.prog[1]) delete prog[entry.prog[0]];
    if (entry.ok) delete ok[entry.ok];
    pend.value = { prog, ok };
  };
  const p = serial(fn);
  p.then(clear, clear);
  return p;
}

const tap: Tap = (fn) => (ev) => {
  ev.preventDefault();
  uiConfig.sfx('tick');
  fn();
};

/** stopAll(): every sound of the step stops (on step change, on leave, on pause). */
function stopAll(P: PState): void {
  if (P.audio) {
    P.audio.pause();
    P.audio = null;
  }
  synth.stop();
  speech.stop();
  P.playing = false;
  clearInterval(P.timer);
  P.tk++;
}

/** Saves the e-book PDF the server returned (production has the real file; the prototype faked it). */
function savePdf(url: string, n: number): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = `take-it-easy-ebook-${pad2(n)}.pdf`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function Player({ params }: ScreenProps) {
  const num = Number(params.ep);
  const { data, error } = useContent(
    () =>
      loadEpisode(num).then((e) => {
        loaded.set(num, e);
        return e;
      }),
    [num],
  );
  const Ep = data ?? loaded.get(num) ?? null;
  const cat = catalog.value;
  useEffect(() => {
    if (!catalog.value) void loadCatalog().catch(() => {});
  }, []);

  const s = view(state.value);
  const prog = s.prog[num] || 1;
  const step = Number(params.step) || (prog >= 10 ? 1 : prog);
  // Unknown episode → trilha. No shortcut: a link to a step ahead lands on the last reached step.
  const redirect =
    !Number.isInteger(num) || (error && !Ep) ? 'trilha' : Ep && step > prog ? `episodio/${num}/${prog}` : '';
  useLayoutEffect(() => {
    if (redirect) replace(redirect);
  }, [redirect]);

  if (redirect || !Ep || !cat) return null;
  return <PlayerView key={`${num}-${step}`} Ep={Ep} cat={cat} step={step} />;
}

function PlayerView({ Ep, cat, step }: { Ep: Episode; cat: Catalog; step: number }) {
  const s = view(state.value);
  const [, setTick] = useState(0);
  const re = () => setTick((n) => n + 1);
  const ref = useRef<PState | null>(null);
  ref.current ??= fresh(Ep.num, step, s);
  const P = ref.current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const toTop = useRef(false);
  const desk = layoutOf(s) === 'desktop';
  const STEPS = cat.steps;
  const cur = STEPS[step - 1];

  useChrome({ title: `Ep. ${Ep.num} · ${cur?.name ?? ''}` });

  // leave(): stop every sound, drop a recording in progress; trans/speed carry over to the next step.
  useEffect(
    () => () => {
      P.dead = true;
      P.cancelRec?.();
      stopAll(P);
      const r = route.value;
      remember(P, r.name === 'player' && Number(r.params.ep) === P.ep);
    },
    [],
  );

  // Auto-scroll: the line being spoken (step 5) or sung (2 and 10) stays in the middle of the screen.
  useEffect(() => {
    if (!P.playing || ![2, 5, 10].includes(step)) return;
    const at = step === 5 ? P.line : (lyricRows(Ep.lyrics).of[P.line] ?? P.line);
    document.getElementById(`${step === 5 ? 'dl' : 'ly'}${at}`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  }, [P.line, P.playing]);

  useLayoutEffect(() => {
    if (toTop.current && scrollRef.current) scrollRef.current.scrollTop = 0;
    toTop.current = false;
  });

  // The map sheet is a modal: focus moves to its Fechar button, Escape closes it, Tab stays inside,
  // and closing gives focus back to the control that opened it (the prototype had none of this).
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetClose = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!P.sheet) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetClose.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        P.sheet = false;
        re();
        return;
      }
      if (ev.key !== 'Tab' || !sheetRef.current) return;
      const els = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = els[0];
      const last = els[els.length - 1];
      if (!first || !last) return;
      const at = document.activeElement;
      const inside = at instanceof Node && sheetRef.current.contains(at);
      if (!inside || (ev.shiftKey && at === first) || (!ev.shiftKey && at === last)) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!P.dead && opener?.isConnected) opener.focus();
    };
  }, [P.sheet]);

  // The intro/song duration shows before the first play ("0:00 / 0:58", not the prototype's "0:00 / —"):
  // only the file's metadata is fetched.
  useEffect(() => {
    const src = stepAudio(Ep, step);
    if (!src) return;
    const probe = new Audio();
    probe.preload = 'metadata';
    const onMeta = () => {
      if (P.dead || P.aD || !Number.isFinite(probe.duration) || probe.duration <= 0) return;
      P.aD = probe.duration;
      re();
    };
    probe.addEventListener('loadedmetadata', onMeta);
    probe.src = src;
    return () => {
      probe.removeEventListener('loadedmetadata', onMeta);
      probe.removeAttribute('src');
      probe.load();
    };
  }, []);

  /** mark(n): the step's media or dialogue finished (step 10 also earns `song` on the server). */
  const mark = (n: number) => {
    const key = stepKey(Ep.num, n);
    if (P.dead || view(state.value).stepOk[key]) return;
    sfx.ok();
    // Next unlocks now (overlay), even while an earlier write is still in flight.
    void pending({ ok: key }, () => markStep(Ep.num, n));
  };

  /** setStep(n, award): advancing past prog asks the server (need() + `step` award + unlocked cards). */
  const setStep = (n: number, award = false) => {
    // The new prog is in place before go(): the next route renders as reached, not redirected back.
    if (award && n > (view(state.value).prog[Ep.num] || 1)) {
      void pending({ prog: [String(Ep.num), n] }, () => advanceStep(Ep.num, n));
    }
    go(`episodio/${Ep.num}/${n}`);
  };

  const close = () => {
    stopAll(P);
    re();
    go('inicio');
  };

  const next = () => {
    if (gate(Ep, view(state.value), step) || P.finishing) return;
    if (step === 10) {
      // The done screen opens only once the server has recorded the episode (or queued it offline):
      // a refusal keeps the student here, with the server's message toasted by send().
      stopAll(P);
      P.finishing = true;
      re();
      void serial(() => finishEpisode(Ep.num)).then((r) => {
        if (P.dead) return;
        P.finishing = false;
        if (r || state.value.epsDone[Ep.num]) {
          confetti();
          go(`concluido/${Ep.num}`);
        } else re();
      });
      return;
    }
    setStep(step + 1, true);
  };

  function speakFrom(i: number, tk: number): void {
    if (P.dead || tk !== P.tk) return;
    const len = Ep.dialog.length;
    if (!P.playing || i >= len) {
      if (P.playing && i >= len) mark(5);
      P.playing = false;
      re();
      return;
    }
    P.line = i;
    re();
    const d = Ep.dialog[i];
    if (!d || d.stage) {
      setTimeout(() => speakFrom(i + 1, tk), 900);
      return;
    }
    void speech.say(d.en, { who: d.who, rate: P.speed }).then(() => {
      if (!P.dead && P.playing && P.tk === tk && P.line === i) setTimeout(() => speakFrom(i + 1, tk), 250);
    });
  }

  const play = () => {
    const src = stepAudio(Ep, step);
    if (P.playing) {
      stopAll(P);
      re();
      return;
    }
    const len = Ep.lyrics.length;
    if (src) {
      const a = new Audio(src);
      P.audio = a;
      a.addEventListener('timeupdate', () => {
        if (P.dead || P.audio !== a) return;
        P.aT = a.currentTime;
        P.aD = Number.isFinite(a.duration) ? a.duration : 0;
        if ((step === 2 || step === 10) && len) {
          P.line = Math.min(len - 1, Math.floor((P.aT / (P.aD || 1)) * len));
        }
        re();
      });
      a.addEventListener('ended', () => {
        if (P.dead || P.audio !== a) return;
        P.playing = false;
        P.audio = null;
        mark(step);
        re();
      });
      // Resume where the pause left it; from the start once it played to the end.
      if (P.aD && P.aT > 0 && P.aT < P.aD - 0.5) a.currentTime = P.aT;
      else {
        P.aT = 0;
        P.line = 0;
      }
      a.play().catch(() => {
        if (P.dead || P.audio !== a) return;
        P.audio = null;
        P.playing = false;
        re();
        toast('O navegador bloqueou o áudio. Toque de novo.');
      });
      P.playing = true;
      re();
      return;
    }
    if (step === 2 || step === 10) {
      // No recording: synthesized backing track, the lyrics move on every 2.6 s.
      P.playing = true;
      if (P.line >= len - 1) P.line = 0;
      synth.play({ bpm: 104, key: Ep.num * 2 });
      P.timer = setInterval(() => {
        if (P.dead) return;
        if (P.line >= len - 1) {
          stopAll(P);
          mark(step);
        } else P.line++;
        re();
      }, 2600);
      re();
      return;
    }
    if (step === 1) {
      // No intro recording: a 15 s jingle.
      P.playing = true;
      const tk = P.tk;
      synth.play({ bpm: 112, key: 3 });
      setTimeout(() => {
        if (!P.dead && P.playing && P.tk === tk) {
          stopAll(P);
          mark(1);
          re();
        }
      }, 15000);
      re();
      return;
    }
    if (step === 5) {
      P.playing = true;
      re();
      speakFrom(P.line, P.tk);
    }
  };

  const line = (i: number) => {
    const d = Ep.dialog[i];
    if (!d) return;
    P.line = i;
    if (P.playing) {
      P.tk++;
      speech.stop();
      speakFrom(i, P.tk);
      return;
    }
    re();
    if (!d.stage) void speech.say(d.en, { who: d.who, rate: P.speed });
  };

  const record = async () => {
    const idx = P.micIdx;
    const m = Ep.mic[idx];
    if (!m) return;
    if (P.mic === 'rec') {
      P.stopper?.();
      return;
    }
    // A second tap while the first recording is still being set up (the mic permission prompt) is
    // ignored: it would start a second recorder and orphan the first one.
    if (P.mic === 'busy' || P.arming) return;
    let rec: Awaited<ReturnType<typeof speech.record>> | null = null;
    let lis: { stop(): void } | null = null;
    let said = '';
    if (speech.canRecord) {
      P.arming = true;
      try {
        rec = await speech.record({ maxMs: 7000 });
      } catch {
        rec = null;
      } finally {
        P.arming = false;
      }
    }
    if (P.dead || P.micIdx !== idx) {
      void rec?.stop();
      return;
    }
    sfx.rec();
    P.mic = 'rec';
    P.fb = null;
    re();
    if (rec && speech.canListen) {
      lis = speech.listen({
        onInterim: (t) => {
          said = t;
        },
        onFinal: (t) => {
          said = t;
        },
      });
    }
    P.cancelRec = () => {
      lis?.stop();
      void rec?.stop();
    };
    const stopper = async () => {
      P.stopper = null;
      P.cancelRec = null;
      if (P.dead) return;
      lis?.stop();
      P.mic = 'busy';
      re();
      let fb: MicFeedback;
      let source: MicScoreSource = 'script';
      let attempt: string | undefined;
      if (rec) {
        const out = await rec.stop();
        const r = await pronounce(out.b64, m.en, { heard: said, phraseId: m.id });
        fb = r;
        source = r.source === 'ia' && r.attempt ? 'ia' : 'demo';
        attempt = source === 'ia' ? r.attempt : undefined;
      } else {
        // No microphone: the phrase's scripted result.
        fb = { score: m.result, praise_pt: m.fb, issues: [] };
      }
      if (P.dead) return;
      if (P.micIdx === idx) {
        P.fb = fb;
        P.mic = 'done';
        re();
      }
      void saveMicScore(m.id, fb.score, source, attempt).then((r) => {
        // Refused by the server (e.g. an expired attempt token): the score rolled back, so the card
        // stops showing the unconfirmed result. A queued save keeps its optimistic score and its card.
        if (r || P.dead || P.fb !== fb || state.value.scores[m.id] === fb.score) return;
        P.fb = null;
        P.mic = 'idle';
        re();
      });
    };
    P.stopper = () => void stopper();
    const mine = P.stopper;
    setTimeout(
      () => {
        if (!P.dead && P.mic === 'rec' && P.stopper === mine) mine();
      },
      rec ? 5500 : 2000,
    );
  };

  const micPick = (i: number) => {
    if (P.mic === 'rec') {
      P.cancelRec?.();
      P.cancelRec = null;
      P.stopper = null;
    }
    P.micIdx = i;
    P.mic = 'idle';
    P.fb = null;
    re();
  };

  const download = async () => {
    if (P.dl !== 'idle') return;
    P.dl = 'busy';
    re();
    const n = Ep.ebook;
    const again = !!state.value.ebooks[String(n)];
    const r = await send(
      ebookApi.download,
      { params: { n } },
      { apply: (_res, st) => ({ ebooks: { ...st.ebooks, [String(n)]: true } }) },
    );
    if (P.dead) return;
    P.dl = 'idle';
    if (r) {
      if (r.pdf) savePdf(r.pdf, n);
      else if (again) toast('O PDF deste e-book ainda não está disponível. O conteúdo está no app.');
      if (!again) sfx.ok();
    }
    re();
  };

  const exGo = (d: number) => {
    const ex = Ep.ex;
    const itIdx = P.itIdx ?? 0;
    const items = ex[P.exIdx]?.items.length ?? 0;
    if (d > 0) {
      if (itIdx < items - 1) P.itIdx = itIdx + 1;
      else if (P.exIdx < ex.length - 1) {
        P.exIdx++;
        P.itIdx = 0;
      }
    } else if (itIdx > 0) P.itIdx = itIdx - 1;
    else if (P.exIdx > 0) {
      P.exIdx--;
      P.itIdx = (ex[P.exIdx]?.items.length ?? 1) - 1;
    }
    speech.stop();
    toTop.current = true;
    re();
  };

  const exPick = (x: number) => {
    const ex = Ep.ex[x];
    if (!ex) return;
    const ans = state.value.exAns;
    const j = ex.items.findIndex((it) => ans[it.id] == null);
    P.exIdx = x;
    P.itIdx = j < 0 ? 0 : j;
    speech.stop();
    toTop.current = true;
    re();
  };

  const exAudio = () => {
    const ex = Ep.ex[P.exIdx];
    if (!ex) return;
    if (ex.audio === 'song' && Ep.songAudio) {
      P.audio?.pause();
      P.audio = new Audio(Ep.songAudio);
      P.audio.play().catch(() => {});
      return;
    }
    const it = ex.items[P.itIdx || 0];
    if (it) void speech.say(it.say || it.q.replace(/[“”]/g, ''), { rate: 0.9 });
  };

  const actions: StepActions = {
    play,
    trans: () => {
      P.trans = !P.trans;
      re();
    },
    speed: (v) => {
      P.speed = v;
      re();
    },
    line,
    micPick,
    record: () => void record(),
    showScore: () => {
      P.showScore = true;
      re();
    },
    download: () => void download(),
    ebookOpen: () => {
      stopAll(P);
      go(`ebook/${Ep.ebook}`);
    },
    vidStart: (v) => {
      P.vid = true;
      re();
      v?.play().catch(() => {
        toast('O navegador bloqueou o vídeo. Toque de novo.');
      });
    },
    vidMeta: (d) => {
      if (P.dead || !Number.isFinite(d) || d <= 0 || P.vD === d) return;
      P.vD = d;
      re();
    },
    ex: (itemId, choice) => void answerExercise(itemId, choice),
    exGo,
    exPick,
    exAudio,
    say: (t) => void speech.say(t),
    sayMark: (t) => {
      void speech.say(t);
      heard.add(t);
      re();
    },
    next,
  };

  const ctx: StepCtx = {
    Ep,
    cat,
    s,
    P,
    step,
    desk,
    training: s.profile ? defaults(s.profile).training : false,
    homeBg: catalogImage('bg/home') ?? '',
    a: actions,
    tap,
  };
  const part = renderStep(ctx, () => {
    mark(4);
    re();
  });

  const prog = s.prog[Ep.num] || step;
  const sheet = () => {
    P.sheet = !P.sheet;
    re();
  };
  const goStep = (n: number) => {
    P.sheet = false;
    setStep(n);
  };

  /**
   * The episode map. The status ("Feito" / "+10") sits on the step name's line and "Você está aqui"
   * under the subtitle, so the subtitle keeps the row's full width: beside it (the prototype) they
   * squeezed the subtitles onto 2-3 lines in the 300px aside.
   */
  const stepList = () => {
    const max = s.prog[Ep.num] || 1;
    return STEPS.map((x) => {
      const now = x.n === step;
      const reached = x.n <= max;
      const done = reached && !now;
      const side = now ? '' : done ? 'Feito' : '+10';
      return (
        <Fragment key={x.n}>
          {x.group ? (
            <div class="lbl" style={{ padding: '14px 4px 6px' }}>
              {x.group}
            </div>
          ) : null}
          <button
            type="button"
            class={`steprow ${now ? 'now' : done ? 'done' : reached ? '' : 'locked'}`}
            disabled={!reached}
            aria-current={now ? 'step' : undefined}
            onClick={reached ? tap(() => goStep(x.n)) : undefined}
          >
            <span class="n">{done ? <Icon name="check" size={14} /> : x.n}</span>
            <span class="grow" style={{ minWidth: '0' }}>
              <span class="pl-sth">
                <span class="h3" style={{ fontSize: '1rem' }}>
                  {x.name}
                </span>
                {side ? (
                  <span
                    class="xs"
                    style={{ fontWeight: '800', flex: 'none', color: done ? 'var(--green)' : 'var(--muted)' }}
                  >
                    {side}
                  </span>
                ) : null}
              </span>
              <span class="sm" style={{ display: 'block' }}>
                {x.pt}
              </span>
              {now ? (
                <span class="xs pl-here" style={{ display: 'block', fontWeight: '800', color: 'var(--orange)' }}>
                  Você está aqui
                </span>
              ) : null}
            </span>
          </button>
        </Fragment>
      );
    });
  };

  const lock = gate(Ep, s, step);
  const nx = STEPS[step];
  const head = (
    <div class="player-head">
      <div class="row" style={{ '--gap': '10px' }}>
        <button type="button" class="iconbtn" onClick={tap(close)} aria-label="Fechar">
          <Icon name="close" size={20} />
        </button>
        <div class="grow tc">
          <div class="lbl" style={{ fontSize: '.72rem' }}>
            {`Episódio ${Ep.num} · etapa ${step} de 10`}
          </div>
          <div class="h3">{Ep.title}</div>
        </div>
        <button type="button" class="iconbtn" onClick={tap(sheet)} aria-label="Mapa">
          <Icon name="list" size={20} />
        </button>
      </div>
      <button
        type="button"
        onClick={tap(sheet)}
        class="stack"
        style={{ '--gap': '8px', textAlign: 'left', width: '100%' }}
      >
        <Segs cur={step} reached={prog} total={STEPS.length} />
        <span class="row base" style={{ '--gap': '8px' }}>
          <span class="num" style={{ color: 'var(--orange)' }}>
            {pad2(step)}
          </span>
          <span class="h3">{cur?.name}</span>
          <span class="sm grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cur?.pt}
          </span>
          <span class="xs" style={{ fontWeight: '800', color: 'var(--blue)' }}>
            Mapa
          </span>
        </span>
      </button>
    </div>
  );
  const foot = (
    <div class="player-foot">
      <button
        type="button"
        class="btn prev"
        onClick={step > 1 ? tap(() => setStep(step - 1)) : undefined}
        aria-label="Anterior"
        disabled={step <= 1}
      >
        <Icon name="back" size={22} />
      </button>
      <button
        type="button"
        class="btn next"
        disabled={!!lock || P.finishing}
        aria-busy={P.finishing || undefined}
        onClick={lock || P.finishing ? undefined : tap(next)}
      >
        <span style={{ minWidth: '0' }}>
          <span class="kicker">
            {lock ||
              (step === 10
                ? P.finishing
                  ? 'Concluindo…'
                  : 'Última etapa · +40 pontos'
                : `Próxima · ${pad2(step + 1)} · +10`)}
          </span>
          <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {step === 10 ? 'Concluir episódio' : nx?.name}
          </span>
        </span>
        <Icon name={lock ? 'lock' : 'next'} size={22} />
      </button>
    </div>
  );
  const main = (
    <>
      {head}
      {part.dock ? <div class="player-dock">{part.dock}</div> : null}
      <div class="scroll" id="pl-scroll" ref={scrollRef}>
        <div class="wrap" style={{ '--wrap': '760px', paddingTop: '16px' }}>
          <div class={`stack enter pl-body pl-s${step}`} style={{ '--gap': '16px' }}>
            {part.body}
          </div>
        </div>
      </div>
      {foot}
    </>
  );

  return (
    <>
      {desk ? (
        <div class="pl-scr" style={{ display: 'flex', flex: '1', minHeight: '0' }}>
          <aside
            class="pl-side"
            style={{
              width: '300px',
              flex: 'none',
              background: '#fff',
              borderRight: '1.5px solid var(--line)',
              padding: '18px 16px',
              overflowY: 'auto',
            }}
          >
            <button type="button" class="btn link" onClick={tap(close)} style={{ justifyContent: 'flex-start' }}>
              <Icon name="back" size={18} />
              <span>Voltar para Hoje</span>
            </button>
            <div class="lbl mt8">E-book {Ep.ebook}</div>
            <div class="h2 mt4">Episódio {pad2(Ep.num)}</div>
            <p class="sm mt8">{Ep.scope}</p>
            <div class="mt12">{stepList()}</div>
          </aside>
          <div class="view">{main}</div>
        </div>
      ) : (
        // display: contents: the head, dock, scroll and foot stay flex items of the view, as before.
        <div class="pl-scr" style={{ display: 'contents' }}>
          {main}
        </div>
      )}
      {P.sheet ? (
        <Overlay>
          <div class="overlay">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim mirrors the close button for pointer users */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the sheet's close button is the keyboard path */}
            <div class="scrim" onClick={tap(sheet)} />
            <div class="sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label={`Mapa do episódio ${Ep.num}`}>
              <div class="grab" />
              <div class="row between top">
                <div>
                  <div class="lbl">Mapa do episódio {Ep.num}</div>
                  <div class="h2 mt4">{Ep.title}</div>
                </div>
                <button type="button" class="iconbtn" ref={sheetClose} onClick={tap(sheet)} aria-label="Fechar">
                  <Icon name="close" size={18} />
                </button>
              </div>
              <div class="mt8">{stepList()}</div>
            </div>
          </div>
        </Overlay>
      ) : null}
    </>
  );
}
