// Entry: styles, UI hooks, router, then app.start() — load the session state and the AI health.
// No zod in the browser bundle (scripts/slimSchemas.ts), so no zod config (jitless) is needed here.
import '@tie/ui/css/fonts.css';
import '@tie/ui/css/tie.css';
import '@tie/ui/css/tie-ext.css';
import { configureUi } from '@tie/ui';
import { render } from 'preact';
import { startOutbox } from './core/outbox';
import { playSfx } from './core/sound';
import { route, startRouter } from './router';
import { preloadHero } from './screens/entrada/hero';
import { screenFor } from './screens/registry';
import { layoutOf, Shell } from './shell';
import { checkHealth, load, state } from './store';

// Every data-go/data-act click ticks; +N pontos plays the points arpeggio (gated by settings.sound).
configureUi({ fxEnabled: () => state.value.settings.fx, sfx: playSfx });
startRouter();

// The shell shows no screen until /api/me/state answers (index.html preloads it), so the first
// screen's chunk and, signed out, the sign-in photo download meanwhile instead of after it.
const first = route.value.name;
// (preload() never rejects: a failed chunk surfaces when the screen renders.)
void screenFor(first)?.component.preload();
if (first === 'entrar' || first === 'raiz') preloadHero(layoutOf(state.value));

const stage = document.getElementById('stage');
if (stage) {
  stage.textContent = '';
  render(<Shell />, stage);
}

void load();
void checkHealth();

/**
 * The service worker (its registration chunk, then its ~0.5 MB precache) starts once the page has
 * loaded and the main thread is idle, so it does not compete with the first screen's photo and content.
 */
function whenIdle(fn: () => void): void {
  const run = () => {
    if ('requestIdleCallback' in window) requestIdleCallback(() => fn(), { timeout: 4000 });
    else setTimeout(fn, 1000);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}
if (import.meta.env.PROD) whenIdle(startOutbox);
