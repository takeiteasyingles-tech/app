// Admin entry: zod-config first (no eval probe under the CSP), the student app's design tokens and
// fonts (@tie/ui), the panel's own additive rules, then the router and the session check.
import './zod-config';
import '@tie/ui/css/fonts.css';
import '@tie/ui/css/tie.css';
import '@tie/ui/css/tie-ext.css';
import './admin.css';
import { render } from 'preact';
import { startRouter } from './router';
import { loadSession } from './session';
import { Shell } from './shell';

startRouter();

const stage = document.getElementById('stage');
if (stage) {
  stage.textContent = '';
  render(<Shell />, stage);
}

void loadSession();
