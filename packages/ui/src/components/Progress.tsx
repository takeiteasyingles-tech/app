import type { ComponentChildren } from 'preact';

export const STEP_COUNT = 10;

export type SegsProps = {
  /** Current step (1-based). */
  cur: number;
  /** Furthest step reached. */
  reached: number;
  /** Number of steps (data.STEPS.length). */
  total?: number;
};

/** C.segs: the 10-step bar; separators before steps 4 and 10. */
export function Segs({ cur, reached, total = STEP_COUNT }: SegsProps) {
  const bars = [];
  for (let n = 1; n <= total; n++) {
    const state = n < cur || (n <= reached && n !== cur) ? 'done' : n === cur ? 'now' : '';
    bars.push(<i key={n} class={state + (n === 4 || n === 10 ? ' sep' : '')} />);
  }
  return <div class="segs">{bars}</div>;
}

export type RingProps = {
  pct: number;
  label: ComponentChildren;
  lg?: boolean;
  /** Stroke color override for the progress arc. */
  color?: string;
};

const R = 26;
const C = 2 * Math.PI * R;

/** C.ring: 64px progress ring (96px with lg). */
export function Ring({ pct, label, lg = false, color = '' }: RingProps) {
  return (
    <div class={`ring${lg ? ' lg' : ''}`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle class="bg" cx="32" cy="32" r={R} />
        <circle
          class="fg"
          cx="32"
          cy="32"
          r={R}
          stroke-dasharray={C.toFixed(1)}
          stroke-dashoffset={(C * (1 - Math.min(100, pct) / 100)).toFixed(1)}
          style={color ? { stroke: color } : undefined}
        />
      </svg>
      <div class="val">{label}</div>
    </div>
  );
}
