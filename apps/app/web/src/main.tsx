// Entry: styles, UI hooks, router, then app.start() — load the session state and the AI health.
// zod-config first: it runs before any schema module is evaluated (no eval probe under the CSP).
import './zod-config';
import '@tie/ui/css/fonts.css';
import '@tie/ui/css/tie.css';
import '@tie/ui/css/tie-ext.css';
import { configureUi } from '@tie/ui';
import { render } from 'preact';
import { startOutbox } from './core/outbox';
import { playSfx } from './core/sound';
import { startRouter } from './router';
import { Shell } from './shell';
import { checkHealth, load, state } from './store';

// Every data-go/data-act click ticks; +N pontos plays the points arpeggio (gated by settings.sound).
configureUi({ fxEnabled: () => state.value.settings.fx, sfx: playSfx });
startRouter();

const stage = document.getElementById('stage');
if (stage) {
  stage.textContent = '';
  render(<Shell />, stage);
}

void load();
void checkHealth();
if (import.meta.env.PROD) startOutbox();
