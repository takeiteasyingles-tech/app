// Markup helpers shared by Cadastro and Perfil, same output as the prototype's local chips(),
// block() and field() in cadastro.js / conta.js.
import { activator, Chip, Icon } from '@tie/ui';
import type { ComponentChildren, JSX } from 'preact';

export type Opt = { k: string | number; t: string };
type Key = string | number;

/**
 * The catalog's option icon. The icon set's 'ear' is a small question-mark-like squiggle that reads
 * as an odd glyph at 22px, so "listening" is drawn as headphones here; every other name is the @tie/ui
 * icon.
 */
export function OptIcon({ name, size = 22 }: { name: string; size?: number }) {
  if (name !== 'ear') return <Icon name={name} size={size} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4 16v-4a8 8 0 0 1 16 0v4" />
      <path d="M4 14.5h2a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 6 20.5H5.5A1.5 1.5 0 0 1 4 19z" />
      <path d="M20 14.5h-2a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 1.5 1.5h.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  );
}

/**
 * The disabled CTA: tie.css paints it white on #C9C2AE (about 1.8:1). Here dark slate on a beige that is
 * still clearly not the orange of the live button (about 7:1), with a dashed edge marking it as waiting.
 */
const CTA_OFF = { '--bg': '#E2DBC6', '--fg': '#3C4357', border: '1.5px dashed #BFB59B' };

/** C.btn markup (same classes as @tie/ui Btn) for the wizard's main CTA, with the readable disabled state. */
export function Cta({
  label,
  cls = '',
  iconR,
  dis = false,
  onClick,
}: {
  label: string;
  cls?: string;
  iconR?: string;
  dis?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={`btn  ${cls}`}
      disabled={dis}
      style={dis ? CTA_OFF : undefined}
      onClick={activator(undefined, onClick)}
    >
      <span>{label}</span>
      {iconR ? <Icon name={iconR} size={20} /> : null}
    </button>
  );
}

/** chips(list, sel, act, single): one C.chip per option, `.on` when selected. */
export function OptChips<K extends Key>({
  list,
  sel,
  single = false,
  onPick,
  style,
}: {
  list: readonly { k: K; t: string }[];
  sel: readonly K[] | K;
  single?: boolean;
  onPick: (k: K) => void;
  style?: JSX.CSSProperties | undefined;
}) {
  const isOn = (k: K) => (single || !Array.isArray(sel) ? sel === k : (sel as readonly K[]).includes(k));
  return (
    <div class="chips" style={style}>
      {list.map((x) => (
        <Chip key={x.k} label={x.t} on={isOn(x.k)} onClick={() => onPick(x.k)} />
      ))}
    </div>
  );
}

/** block(title, inner, sub): a labelled group under the step's options. */
export function Block({ title, sub, children }: { title: string; sub?: string; children: ComponentChildren }) {
  return (
    <div class="stack mt24" style={{ '--gap': '8px' }}>
      <div>
        <div class="lbl">{title}</div>
        {sub ? <div class="xs mt4">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** field(label, input, err) */
export function Field({
  label,
  err,
  children,
}: {
  label: string;
  err?: string | undefined;
  children: ComponentChildren;
}) {
  return (
    <>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside, rendered by a child component */}
      <label class="field">
        <span>{label}</span>
        {children}
      </label>
      {err ? (
        <span class="field">
          <span class="err">{err}</span>
        </span>
      ) : null}
    </>
  );
}

/** Perfil's sec(title, inner, sub): one card per section. `id` makes it a target of the section nav. */
export function Sec({
  title,
  sub,
  id,
  children,
}: {
  title: string;
  sub?: string;
  id?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="card stack" id={id} style={{ '--gap': '10px', scrollMarginTop: '72px' }}>
      <div>
        <div class="lbl">{title}</div>
        {sub ? <div class="xs mt4">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}
