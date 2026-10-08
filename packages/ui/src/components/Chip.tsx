import { Icon } from '../icons';
import { type Act, activator } from './act';

export type ChipProps = { label: string; on?: boolean; onClick?: Act };

/** C.chip: 44px pill; `.on` shows the orange check. */
export function Chip({ label, on = false, onClick }: ChipProps) {
  return (
    <button
      type="button"
      class={`chip${on ? ' on' : ''}`}
      aria-pressed={on ? 'true' : 'false'}
      onClick={activator(undefined, onClick)}
    >
      <span class="ck">{on ? <Icon name="check" size={12} /> : null}</span>
      {label}
    </button>
  );
}

export type ToggleProps = { on: boolean; label?: string; onClick?: Act };

/** C.toggle: role=switch, green when on. */
export function Toggle({ on, label = '', onClick }: ToggleProps) {
  return (
    <button
      type="button"
      class={`toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on ? 'true' : 'false'}
      aria-label={label}
      onClick={activator(undefined, onClick)}
    >
      <i />
    </button>
  );
}
