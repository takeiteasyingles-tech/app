// Markup pieces several EXTRA screens share, as the prototype wrote them in extra.js.
import { Btn } from '@tie/ui';
import type { ComponentChildren } from 'preact';
// Slice-local polish on top of tie.css (scoped under .x-scr; loaded with the EXTRA chunks).
import './extra.css';

/**
 * The navy column every EXTRA screen renders into. `cls` scopes the screen's rules in extra.css;
 * `w` is the content width the header lines up with on desktop.
 */
export function OnNavy({ children, cls = '', w }: { children?: ComponentChildren; cls?: string; w?: number }) {
  return (
    <div
      class={`on-navy x-scr ${cls}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: '1',
        minHeight: '0',
        ...(w ? { '--x-w': `${w}px` } : {}),
      }}
    >
      {children}
    </div>
  );
}

/** Content that could not load (the prototype had it all in memory, so this state is production-only). */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div class="wrap">
      <div class="card mt24 stack" style={{ '--gap': '12px' }}>
        <div class="h3" style={{ color: '#fff' }}>
          Não deu para carregar o EXTRA.
        </div>
        <p class="p" style={{ color: 'var(--onNavy)' }}>
          Confira a internet e tente de novo.
        </p>
        <Btn label="Tentar de novo" kind="light" onClick={onRetry} />
      </div>
    </div>
  );
}
