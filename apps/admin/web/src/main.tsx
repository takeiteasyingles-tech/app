// Admin entry: same design tokens and fonts as the student app (@tie/ui), placeholder shell.
import '@tie/ui/css/fonts.css';
import '@tie/ui/css/tie.css';
import '@tie/ui/css/tie-ext.css';
import { render } from 'preact';
import { AdminShell } from './shell';

const stage = document.getElementById('stage');
if (stage) {
  stage.textContent = '';
  render(<AdminShell />, stage);
}
