// Layout signals shared by the shell and the screens: desktop at ≥900px (tie.css's only breakpoint),
// the mobile navigation sheet, and the document title.
import { signal } from '@preact/signals';

export const DESKTOP_MIN = 900;

export const wide = signal(typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN);
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    const w = window.innerWidth >= DESKTOP_MIN;
    if (w !== wide.value) wide.value = w;
  });
}

/** Mobile: the section menu (a bottom sheet) is open. */
export const menuOpen = signal(false);

export function setTitle(title: string): void {
  document.title = title ? `${title} · Admin · Take It Easy` : 'Admin · Take It Easy';
}
