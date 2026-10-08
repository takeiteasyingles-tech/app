// Toasts and confetti from prototipo/js/app.js, appended to #fxroot with the same classes and timings.
// Built with DOM APIs (no innerHTML) so they stay CSP-clean.
import { uiConfig } from './config';

const CONFETTI_COLORS = ['#2A6FF5', '#F45A28', '#1F7A4C', '#E9A200', '#0F2A55'];

function fxRoot(): HTMLElement | null {
  return document.getElementById('fxroot');
}

function flash(cls: string, text: string, ms: number, role?: string): void {
  const root = fxRoot();
  if (!root) return;
  const t = document.createElement('div');
  t.className = cls;
  if (role) t.setAttribute('role', role);
  t.textContent = text;
  root.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** app.toast(msg, ms = 2600) */
export function toast(msg: string, ms = 2600): void {
  flash('toast', msg, ms, 'status');
}

/**
 * app.points(n): "+n pontos" toast with the points sfx. The prototype also redrew the gamebar;
 * here the gamebar re-renders from the store when the award updates it.
 */
export function pointsToast(n: number): void {
  uiConfig.sfx('points');
  flash('pts-toast', `+${n} pontos`, 1700);
}

/** app.confetti(): 40 pieces for 2.6s, skipped when settings.fx is off. */
export function confetti(): void {
  if (!uiConfig.fxEnabled()) return;
  const root = fxRoot();
  if (!root) return;
  const c = document.createElement('div');
  c.className = 'confetti';
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = CONFETTI_COLORS[i % 5] ?? '';
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    p.style.animationDuration = `${1.3 + Math.random()}s`;
    c.appendChild(p);
  }
  root.appendChild(c);
  setTimeout(() => c.remove(), 2600);
}
