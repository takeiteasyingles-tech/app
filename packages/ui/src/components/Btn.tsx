import type { ComponentChildren } from 'preact';
import { Icon } from '../icons';
import { type Act, activator } from './act';

export type BtnProps = {
  label: ComponentChildren;
  /** Variant classes: block, compact, navy, blue, green, light, ghost, link… */
  kind?: string;
  cls?: string;
  /** Route to open (data-go). */
  go?: string;
  onClick?: Act;
  icon?: string;
  iconR?: string;
  dis?: boolean;
  kicker?: string;
  id?: string;
  type?: 'button' | 'submit';
};

/** C.btn: `<button class="btn kind cls">[icon]<span>label</span>[iconR]</button>`. */
export function Btn({
  label,
  kind = '',
  cls = '',
  go,
  onClick,
  icon,
  iconR,
  dis = false,
  kicker,
  id,
  type = 'button',
}: BtnProps) {
  return (
    <button class={`btn ${kind} ${cls}`} id={id} type={type} disabled={dis} onClick={activator(go, onClick)}>
      {icon ? <Icon name={icon} size={20} /> : null}
      {kicker ? (
        <span>
          <span class="kicker">{kicker}</span>
          {label}
        </span>
      ) : (
        <span>{label}</span>
      )}
      {iconR ? <Icon name={iconR} size={20} /> : null}
    </button>
  );
}
