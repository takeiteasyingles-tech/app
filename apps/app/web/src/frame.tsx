// What a screen tells the shell, replacing the prototype's render() return fields
// {tabs, nav, theme, title, overlay} (html is the component itself).
import { signal } from '@preact/signals';
import { type ComponentChildren, Fragment, h, render } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import type { RouteParams } from './router';

export type Theme = 'cream' | 'navy';

export interface Chrome {
  /** Side nav (desktop) or tab bar (mobile) around the view. */
  tabs?: boolean;
  /** Nav item to highlight; defaults to the route's section. */
  nav?: string;
  theme?: Theme;
  /** document.title prefix: "<title> · Take It Easy". */
  title?: string;
}

export interface ScreenProps {
  params: RouteParams;
  q: Readonly<Record<string, string>>;
  path: string;
}

/** Overrides set by the mounted screen on top of its registry defaults. */
export const chromeOverride = signal<Chrome>({});

/**
 * Lets a screen change its chrome from render data (e.g. Mic hides the tabs during a call, the
 * player sets "Ep. 1 · Take a Look" as title). Pass a stable shape; it is re-applied when it changes.
 */
export function useChrome(c: Chrome): void {
  const key = JSON.stringify(c);
  useLayoutEffect(() => {
    chromeOverride.value = c;
    return () => {
      chromeOverride.value = {};
    };
  }, [key]);
}

/**
 * The prototype's `overlay` output: rendered at the end of #content (so `.overlay` covers the whole
 * .app, side nav and tab bar included) instead of inside the view.
 */
export function Overlay({ children }: { children: ComponentChildren }) {
  useLayoutEffect(() => {
    const host = document.getElementById('overlayroot');
    if (!host) return;
    render(h(Fragment, null, children), host);
  });
  useLayoutEffect(
    () => () => {
      const host = document.getElementById('overlayroot');
      if (host) render(null, host);
    },
    [],
  );
  return null;
}
