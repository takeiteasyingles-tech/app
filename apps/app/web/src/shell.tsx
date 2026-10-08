// App shell: port of draw() in prototipo/js/app.js. Route guards, desktop/mobile layout at 900px,
// data-theme, side nav / tab bar, the '.view enter' animation on route change and the #fxroot host.
// Scroll and focus survive re-renders on their own (Preact keeps the DOM); the view is keyed by
// path, so a route change starts fresh at the top, like the prototype's innerHTML swap.
import { signal } from '@preact/signals';
import type { TieState } from '@tie/shared/state';
import { Btn, Side, Tabbar } from '@tie/ui';
import { Component, type ComponentChildren } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { chromeOverride } from './frame';
import { resolveView } from './guard';
import { navTick, replace, route } from './router';
import { SECTION } from './screens/registry';
import { dueNow, gameView, loadError, retryLoad, state, status } from './store';

const DESKTOP_MIN = 900;

/** innerWidth ≥ 900, updated only when it flips (the prototype re-rendered on layout change only). */
export const wide = signal(typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN);
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    const w = window.innerWidth >= DESKTOP_MIN;
    if (w !== wide.value) wide.value = w;
  });
}

export type Layout = 'desktop' | 'mobile';
/** app.layout() */
export const layoutOf = (s: TieState): Layout => (wide.value && !s.settings.phone ? 'desktop' : 'mobile');

// app.render()'s depth guard: more than 4 redirects in a row is a loop.
let redirects = 0;
function redirect(to: string): void {
  if (redirects > 4) {
    console.error('[TIE] redirecionamento em loop');
    return;
  }
  redirects++;
  replace(to);
}

/**
 * Catches a screen's render errors. `resetKey` is the store state: when it changes (the state
 * arrives, a write lands) a failed screen gets another try instead of staying on the error card
 * until the user navigates away.
 */
class ScreenBoundary extends Component<{ children: ComponentChildren; resetKey: unknown }, { error: unknown }> {
  override state = { error: null as unknown };
  static override getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown) {
    console.error(error);
  }
  override componentDidUpdate(prev: { resetKey: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const detail = import.meta.env.DEV && error instanceof Error ? error.stack || String(error) : '';
    return (
      <div class="wrap">
        <div class="card mt24">
          <div class="h3">Algo deu errado nesta tela.</div>
          {detail ? <pre class="xs">{detail}</pre> : null}
        </div>
      </div>
    );
  }
}

function Frame({ layout, theme, children }: { layout: Layout; theme: string; children?: ComponentChildren }) {
  return (
    <div class="app" id="app" data-layout={layout} data-theme={theme}>
      <div id="content" style={{ display: 'contents' }}>
        {children}
        <div id="overlayroot" />
      </div>
      <div id="fxroot" />
    </div>
  );
}

/** /api/me/state failed for a reason other than "signed out": keep the session and offer a retry. */
function LoadFailed() {
  return (
    <div class="view enter">
      <div class="wrap">
        <div class="card mt24 stack" style={{ '--gap': '12px' }}>
          <div class="h3">Não deu para carregar seus dados.</div>
          {loadError.value ? <p class="p">{loadError.value}</p> : null}
          <Btn label="Tentar de novo" kind="block" onClick={() => void retryLoad()} />
        </div>
      </div>
    </div>
  );
}

export function Shell() {
  const s = state.value;
  const r = route.value;
  void navTick.value; // TIE.router.go to the current hash still re-renders
  const L = layoutOf(s);
  const view = resolveView(status.value, r, s);
  const target = view.kind === 'redirect' ? view.to : null;
  const def = view.kind === 'screen' ? view.def : undefined;
  const over = chromeOverride.value;
  const chrome = { ...def?.chrome, ...over };
  const tabs = !!chrome.tabs;
  const nav = chrome.nav ?? SECTION[r.name] ?? '';

  useLayoutEffect(() => {
    if (target) redirect(target);
    else if (def) redirects = 0;
  }, [target, r.path, def]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--ts', String(s.settings.ts));
    document.body.classList.toggle('phone-mode', !!s.settings.phone && wide.value);
    document.title = `${chrome.title ? `${chrome.title} · ` : ''}Take It Easy`;
  });

  if (view.kind === 'failed') {
    return (
      <Frame layout={L} theme="cream">
        <LoadFailed />
      </Frame>
    );
  }
  if (!def) return <Frame layout={L} theme="cream" />;

  const Screen = def.component;
  const g = gameView.value;
  // review.sync() recounted s.due on every render; dueNow recounts it from the deck as cards come due.
  const due = s.profile ? dueNow.value : s.due;
  return (
    <Frame layout={L} theme={chrome.theme ?? 'cream'}>
      {tabs && L === 'desktop' ? <Side active={nav} due={due} g={g} /> : null}
      {/* Keyed by path: a new route mounts a new .view, so 'enter' plays once and later re-renders
          keep the class without restarting (or cutting) the animation. */}
      <div key={r.path} class={`view${tabs ? ' has-tabs' : ''} enter`}>
        <ScreenBoundary resetKey={s}>
          <Screen params={r.params} q={r.q} path={r.path} />
        </ScreenBoundary>
      </div>
      {tabs && L === 'mobile' ? <Tabbar active={nav} due={due} /> : null}
    </Frame>
  );
}
