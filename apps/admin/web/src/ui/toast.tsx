// Short confirmations and errors, announced politely to screen readers. Rendered once by the shell.
import { signal } from '@preact/signals';
import { Icon } from './icons';

export type ToastKind = 'ok' | 'err' | 'warn' | 'info';
interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
  at: number;
}

const toasts = signal<ToastItem[]>([]);
let seq = 0;

export function toast(msg: string, kind: ToastKind = 'ok', ms = kind === 'err' ? 6500 : 3800): void {
  const id = ++seq;
  toasts.value = [...toasts.value.slice(-3), { id, msg, kind, at: Date.now() }];
  setTimeout(() => dismiss(id), ms);
}

/**
 * Called on every route change: a confirmation belongs to the screen it was raised on, so older ones
 * go away. One raised right before the navigation (e.g. "Conta excluída." then back to the list) stays.
 */
export function dropStaleToasts(graceMs = 1200): void {
  const now = Date.now();
  const keep = toasts.value.filter((t) => now - t.at < graceMs);
  if (keep.length !== toasts.value.length) toasts.value = keep;
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

const ICON: Record<ToastKind, string> = { ok: 'check', err: 'alert', warn: 'alert', info: 'bulb' };

export function Toasts() {
  return (
    <div class="ad-toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`ad-toast ${t.kind}`}>
          <span class="ic">
            <Icon name={ICON[t.kind]} size={16} />
          </span>
          <span class="grow">{t.msg}</span>
          <button type="button" class="x" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
