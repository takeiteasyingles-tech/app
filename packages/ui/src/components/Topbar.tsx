import type { ComponentChildren } from 'preact';
import { Icon } from '../icons';
import { activator } from './act';

export type TopbarProps = {
  /** Route of the back button (data-go); no button when empty. */
  back?: string;
  title?: string;
  kicker?: string;
  /** Right-hand slot (avatar button, demo badge…). */
  right?: ComponentChildren;
};

/** C.topbar */
export function Topbar({ back, title, kicker, right }: TopbarProps) {
  return (
    <header class="topbar">
      {back ? (
        <button type="button" class="iconbtn" aria-label="Voltar" onClick={activator(back, undefined)}>
          <Icon name="back" size={20} />
        </button>
      ) : null}
      <div class="ttl">
        {kicker ? <div class="lbl">{kicker}</div> : null}
        {title ? (
          <div class="h2" style={{ marginTop: '2px' }}>
            {title}
          </div>
        ) : null}
      </div>
      {right}
    </header>
  );
}
