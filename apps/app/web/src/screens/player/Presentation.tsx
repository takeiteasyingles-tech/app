// Step 1 · Apresentação do Episódio (PROD, spec 05 "Step order"): the episode opens with its presentation
// audio in a pill player (play/pause, a waveform that fills as it plays), a large animated orb (CSS and
// SVG only, ui-blocks/Orb.tsx: halos, a glowing sphere with a travelling wave, sound bars at its sides; it
// swells while the audio plays) and the episode text in a box that scrolls with a chevron when it does not fit. Without
// a recording, the play button runs the 15 s synth jingle, as the old intro did.
import { Icon } from '@tie/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Orb } from '../../ui-blocks/Orb';
import { fmt } from './model';
import './presentation.css';

/** Bar heights (0..1) of the pill's waveform: a fixed, symmetric-looking shape. */
const WAVE = [
  0.25, 0.35, 0.3, 0.45, 0.4, 0.6, 0.35, 0.5, 0.75, 0.55, 0.9, 0.65, 1, 0.8, 0.95, 0.7, 0.85, 0.55, 0.7, 0.45, 0.6, 0.4,
  0.5, 0.3, 0.42, 0.28, 0.35, 0.22,
];

function Headphones() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 14v-2a8 8 0 0 1 16 0v2"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect x="3" y="13" width="5" height="7" rx="2" fill="currentColor" />
      <rect x="16" y="13" width="5" height="7" rx="2" fill="currentColor" />
    </svg>
  );
}

/** The episode text: scrolls inside its box; the chevron shows while there is more below. */
function ScrollText({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = () => {
    const el = box.current;
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  };
  useEffect(() => {
    check();
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div class="pr-textwrap">
      <div class={`pr-text${more ? ' more' : ''}`} ref={box} onScroll={check}>
        <p>{text}</p>
      </div>
      <button
        type="button"
        class={`pr-more${more ? '' : ' hide'}`}
        aria-label="Continuar lendo"
        tabIndex={more ? 0 : -1}
        onClick={() => {
          const el = box.current;
          if (el) el.scrollBy({ top: Math.max(40, el.clientHeight * 0.8), behavior: 'smooth' });
        }}
      >
        <Icon name="down" size={26} />
      </button>
    </div>
  );
}

/** The pill player (play/pause, a waveform that fills as it plays, headphones) and its clock. */
export function AudioPill({
  playing,
  aT,
  aD,
  hasAudio,
  onPlay,
  what,
}: {
  playing: boolean;
  aT: number;
  aD: number;
  hasAudio: boolean;
  onPlay: (ev: Event) => void;
  /** Accessible name's object: "a apresentação", "o contexto". */
  what: string;
}) {
  const filled = aD ? Math.round((aT / aD) * WAVE.length) : 0;
  const started = playing || aT > 0;
  return (
    <>
      <div class="pr-pill">
        <button
          type="button"
          class="pr-play"
          onClick={onPlay}
          aria-label={playing ? `Pausar ${what}` : `Ouvir ${what}`}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <span class={`pr-wavebars${playing ? ' on' : ''}`} aria-hidden="true">
          {WAVE.map((h, i) => (
            <i key={i} class={i < filled ? 'past' : ''} style={{ '--h': String(h), '--d': `${(i % 7) * 0.09}s` }} />
          ))}
        </span>
        <span class="pr-phones" aria-hidden="true">
          <Headphones />
        </span>
      </div>
      <div class="pr-clock xs" aria-live="off">
        {hasAudio && started ? `${fmt(aT)} / ${fmt(Math.round(aD))}` : hasAudio ? '' : started ? 'vinheta' : ''}
      </div>
    </>
  );
}

export function Presentation({
  text,
  playing,
  aT,
  aD,
  hasAudio,
  onPlay,
}: {
  text: string;
  playing: boolean;
  aT: number;
  aD: number;
  hasAudio: boolean;
  onPlay: (ev: Event) => void;
}) {
  return (
    <div class="pr">
      <h2 class="pr-title">Apresentação do Episódio</h2>
      <AudioPill playing={playing} aT={aT} aD={aD} hasAudio={hasAudio} onPlay={onPlay} what="a apresentação" />
      <Orb on={playing} />
      {text ? <ScrollText text={text} /> : null}
    </div>
  );
}
