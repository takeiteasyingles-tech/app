// Entry: styles, UI hooks, router, then app.start() — load the session state and the AI health.
import '@tie/ui/css/fonts.css';
import '@tie/ui/css/tie.css';
import '@tie/ui/css/tie-ext.css';
import { configureUi } from '@tie/ui';
import { render } from 'preact';
import { startRouter } from './router';
import { DevToggle, Shell } from './shell';
import { checkHealth, load, state } from './store';

configureUi({ fxEnabled: () => state.value.settings.fx });
startRouter();

const stage = document.getElementById('stage');
if (stage) {
  stage.textContent = '';
  render(<Shell />, stage);
}

if (import.meta.env.DEV) {
  const el = document.createElement('div');
  el.id = 'devtoggle';
  el.className = 'devtoggle';
  document.body.appendChild(el);
  render(<DevToggle />, el);
}

void load();
void checkHealth();
