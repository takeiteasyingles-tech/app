// Step 7 "voz" (cadastro.js B.voz, onbHear, onbRecord): the assistant on the avatar stage asks for
// "Hi, I'm {name}."; the recording (core speech.record, 16 kHz WAV) is scored by /api/pronounce,
// with the browser recognizer's transcript feeding the demo score when the AI is off.
import { DEFAULT_ASSISTANT } from '@tie/shared/constants';
import { getAssistant } from '@tie/shared/domain/assist';
import type { VoiceTest } from '@tie/shared/state';
import { activator, Icon, toast } from '@tie/ui';
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { aiOnline, pronounce } from '../../core/aiClient';
import { sfx } from '../../core/sound';
import { canListen, canRecord, listen, record, say, stop as stopSpeech } from '../../core/speech';
import { catalog, catalogImage, state } from '../../store';
import { AvatarVideo } from './AvatarVideo';
import { patchDraft } from './onb';

type Phase = 'idle' | 'rec' | 'busy';
const BARS = Array.from({ length: 18 }, (_, i) => i);
/**
 * Resting shape of the 18 meter bars: a soft waveform instead of tie.css's flat 10% line, which left
 * the 56px meter reading as an empty band in the card. The live levels replace it while recording.
 */
const REST = BARS.map(
  (i) => `${Math.round(16 + 50 * Math.sin((i / 17) * Math.PI) ** 2 * (0.55 + 0.45 * Math.cos(i * 1.7) ** 2))}%`,
);
/** The resting bars in a soft tint of the mic button's orange, so the meter belongs to the mic. */
const REST_BG = '#F6B394';
/** Desktop: the meter at the width of the phrase, so its 18 bars stay slim instead of 32px blocks. */
const VU_DESK = { width: '100%', maxWidth: '360px' };
const VU = { width: '100%' };
/**
 * Desktop: the assistant and the practice card side by side (a portrait stage that matches the card's
 * height), so the whole step, CTA included, fits the first screen and the captions sit under her face.
 */
const LAYOUT_DESK = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '16px',
  alignItems: 'stretch',
};
/**
 * Desktop: the stage is a column, the picture taking the height the subtitle bar leaves (the video
 * box in the flow instead of over the whole stage).
 */
const STAGE_DESK = {
  aspectRatio: 'auto',
  height: '100%',
  minHeight: '380px',
  display: 'flex',
  flexDirection: 'column',
};
const VIDEO_DESK = { position: 'relative', inset: 'auto', flex: '1 1 auto', minHeight: '0' };
const NOTE_DESK = { gridColumn: '1 / -1' };
/** The name pill: white text (tie.css leaves it navy on navy) and a bright, haloed "online" dot. */
const STATUS_DESK = { color: '#fff', top: '14px', left: '14px', paddingLeft: '11px' };
const STATUS = { color: '#fff', paddingLeft: '11px' };
const DOT = { background: '#3DD68C', boxShadow: '0 0 0 2px rgba(61,214,140,.28)', flex: 'none' };
/**
 * The captions as a navy subtitle bar under the picture instead of over it (on the overlay they
 * covered her chest and the cup, and the small boxes cramped the Portuguese line). On a phone the
 * stage keeps a 10:7 picture through its top padding, the bar flows below it, and the video is held
 * to the picture area, so neither crops nor covers the other.
 */
const STAGE_PHONE = {
  aspectRatio: 'auto',
  display: 'flex',
  flexDirection: 'column',
  paddingTop: '70%',
};
const CAPTION_BAR = {
  position: 'relative',
  left: 'auto',
  right: 'auto',
  bottom: 'auto',
  background: 'var(--navyD)',
  padding: '10px 16px 12px',
};
/** Desktop: the bar after the picture in the stage's column (the markup keeps the prototype's order). */
const CAPTION_BAR_DESK = { ...CAPTION_BAR, order: '2', padding: '12px 18px 14px' };
const CAPTION_EN = { background: 'transparent', padding: '0', fontSize: '1rem' };
const CAPTION_PT = { background: 'transparent', padding: '0', color: '#C9D3E8', textWrap: 'balance' };
const VIDEO_PHONE = { inset: '0 0 auto 0', aspectRatio: '10 / 7' };
/** The tip's last words held together, so the line never ends on a lone "Nada" or "de". */
const TIP_TEXT = { textAlign: 'left', width: '100%', textWrap: 'pretty' };
/** Phone: the privacy note a step closer to the card it explains. */
const NOTE_PHONE = { marginTop: '-4px' };

export function Voz({ desk = false }: { desk?: boolean }) {
  const d = state.value.draft;
  const name = d.name || 'Ana';
  const res = d.voice;
  const target = `Hi, I’m ${name}.`;
  const [phase, setPhase] = useState<Phase>('idle');
  const [talking, setTalking] = useState(false);
  const vu = useRef<HTMLDivElement>(null);
  const run = useRef({
    alive: true,
    stopper: null as null | (() => Promise<void>),
    discard: null as null | (() => void),
  });
  const c = catalog.value;
  const a = c ? getAssistant(c.assistants, DEFAULT_ASSISTANT) : undefined;
  const listening = phase === 'rec';

  useEffect(
    () => () => {
      run.current.alive = false;
      run.current.discard?.();
      stopSpeech();
    },
    [],
  );

  const meter = (v: number) => {
    const bars = vu.current?.children;
    if (!bars) return;
    for (let i = 0; i < bars.length; i++) {
      const el = bars[i] as HTMLElement;
      const h = Math.max(0.08, v * (0.55 + 0.45 * Math.sin((i + performance.now() / 90) * 0.9) ** 2));
      el.style.height = `${Math.round(h * 100)}%`;
      el.style.background = '';
      el.className = h > 0.7 ? 'hot' : h > 0.35 ? 'mid' : '';
    }
  };
  const meterReset = () => {
    const bars = Array.from(vu.current?.children ?? []) as HTMLElement[];
    bars.forEach((el, i) => {
      el.style.height = REST[i] ?? '';
      el.style.background = REST_BG;
      el.className = '';
    });
  };

  const hear = () => {
    setTalking(true);
    void say(`Hi, ${name}. Can you say this for me? Hi, I’m ${name}.`).then(
      () => run.current.alive && setTalking(false),
    );
  };

  const rec = async () => {
    const R = run.current;
    if (phase === 'rec') {
      void R.stopper?.();
      return;
    }
    if (phase === 'busy') return;
    if (!canRecord) {
      toast('Este navegador não grava áudio. Pule esta etapa ou use o Chrome.');
      return;
    }
    stopSpeech();
    setTalking(false);
    let handle: Awaited<ReturnType<typeof record>>;
    let heard = '';
    let lis: { stop(): void } | null = null;
    try {
      handle = await record({ maxMs: 5000, onLevel: meter });
    } catch {
      toast('Não deu para usar o microfone. Confira a permissão do navegador.');
      return;
    }
    if (!R.alive) {
      void handle.stop();
      return;
    }
    sfx.rec();
    if (canListen)
      lis = listen({
        onInterim: (t) => {
          heard = t;
        },
        onFinal: (t) => {
          heard = t;
        },
      });
    setPhase('rec');
    let timer: ReturnType<typeof setTimeout> | undefined;
    R.discard = () => {
      clearTimeout(timer);
      lis?.stop();
      void handle.stop();
    };
    R.stopper = async () => {
      R.stopper = null;
      R.discard = null;
      clearTimeout(timer);
      lis?.stop();
      setPhase('busy');
      meterReset();
      let r: Awaited<ReturnType<typeof pronounce>>;
      try {
        const out = await handle.stop();
        r = await pronounce(out.b64, target, { heard });
      } catch {
        // Neither the recording nor the score came back (e.g. the demo scorer failed to load offline):
        // the mic is free again for another try.
        if (!R.alive) return;
        setPhase('idle');
        toast('Não deu para avaliar a gravação. Tente de novo ou pule esta etapa.');
        return;
      }
      if (!R.alive) return;
      const voice: VoiceTest = {
        score: r.score,
        praise_pt: r.praise_pt,
        issues: r.issues || [],
        heard: r.heard || heard,
      };
      patchDraft({ voice });
      setPhase('idle');
      if (r.score >= 8) sfx.ok();
      else sfx.soft();
    };
    timer = setTimeout(() => void R.stopper?.(), 4200);
  };

  const status =
    phase === 'rec'
      ? 'Ouvindo… toque para parar'
      : phase === 'busy'
        ? 'A Maggie está ouvindo a gravação…'
        : res
          ? 'Toque para tentar de novo'
          : 'Toque no microfone e diga a frase';

  return (
    <div class="stack" style={desk ? LAYOUT_DESK : { '--gap': '16px' }}>
      {/* The @tie/ui Stage markup, with the status text set to white: tie.css gives the pill a navy
          background but no text colour, so the name was navy on navy. On desktop the stage sits beside
          the phrase card, so the mic and the CTA stay on the first screen. */}
      <div class="avatar-stage" id="av-onb" style={desk ? STAGE_DESK : STAGE_PHONE}>
        <div class="bg" style={{ backgroundImage: `url(${catalogImage('bg/maggie-set') ?? ''})` }} />
        <span class={`status${listening ? ' listen' : ''}`} style={desk ? STATUS_DESK : STATUS}>
          <i style={listening ? { flex: 'none' } : DOT} />
          {listening ? 'Ouvindo' : (a?.name ?? 'Maggie')}
        </span>
        {listening ? (
          <div class="eq">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
        ) : null}
        <div class="caption" style={desk ? CAPTION_BAR_DESK : CAPTION_BAR}>
          <span class="en" style={CAPTION_EN}>
            Hi, {name}. Can you say this for me?
          </span>
          <span class="ptl">
            <span style={CAPTION_PT}>Oi, {name}. Você consegue dizer isto para mim?</span>
          </span>
        </div>
        <AvatarVideo a={a} talking={talking} style={desk ? VIDEO_DESK : VIDEO_PHONE} />
      </div>
      <div
        class="card stack tc"
        style={
          desk
            ? { '--gap': '12px', alignItems: 'center', justifyContent: 'center', padding: '20px 18px' }
            : { '--gap': '12px', alignItems: 'center' }
        }
      >
        <div class="lbl">Diga em voz alta</div>
        <div class="h1">{target}</div>
        <div class="fb tip" style={TIP_TEXT}>
          <b>Dica de boca:</b> o H de hi é só ar. Nada{' '}de{' '}R de{' '}“rato”.
        </div>
        <div class="vu" style={desk ? VU_DESK : VU} ref={vu}>
          {BARS.map((i) => (
            <i key={i} id={`vu${i}`} style={{ height: REST[i], background: REST_BG }} />
          ))}
        </div>
        <div class="row" style={{ '--gap': '12px' }}>
          <button type="button" class="btn light compact" onClick={activator(undefined, hear)}>
            <Icon name="speaker" size={18} />
            <span>Ouvir a Maggie</span>
          </button>
          <button
            type="button"
            class={`mic${phase === 'rec' ? ' rec' : ''}`}
            aria-label={phase === 'rec' ? 'Parar a gravação' : 'Gravar'}
            aria-pressed={phase === 'rec'}
            onClick={activator(undefined, () => void rec())}
          >
            <Icon name={phase === 'rec' ? 'stop' : 'mic'} size={28} />
          </button>
        </div>
        <div class="sm" style={{ fontWeight: '700' }}>
          {status}
        </div>
        {res ? <VoiceResult res={res} /> : null}
      </div>
      <p class="xs" style={desk ? NOTE_DESK : NOTE_PHONE}>
        O microfone só liga quando você toca no botão. O áudio serve para a nota e não fica guardado.
        {aiOnline.value ? '' : ' Neste teste rápido, a nota é uma estimativa.'}
      </p>
    </div>
  );
}

function VoiceResult({ res }: { res: VoiceTest }) {
  return (
    <div class="stack pop" style={{ '--gap': '10px', width: '100%', textAlign: 'left' }}>
      <div class="row center base" style={{ '--gap': '4px' }}>
        <span class="num" style={{ fontSize: '2.8rem' }}>
          {res.score}
        </span>
        <span class="h3 muted">/10</span>
      </div>
      <div class={`fb ${res.score >= 8 ? 'ok' : 'fix'}`}>
        <b>{res.praise_pt}</b>
        {res.issues.map((x, i) => (
          <Fragment key={i}>
            <br />
            {`${x.word}: ${x.tip_pt}`}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
