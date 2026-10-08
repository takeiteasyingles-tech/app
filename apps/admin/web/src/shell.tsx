// Admin shell placeholder: desktop frame with the navy side column and a dashboard card, built from
// the student app's tie.css classes. S10 replaces it with the real admin (login, users, content…).
import { Icon, Logo } from '@tie/ui';

const SECTIONS = [
  ['Painel', 'home'],
  ['Usuários', 'profile'],
  ['Conteúdo', 'book'],
  ['Moderação', 'flag'],
  ['Configurações', 'list'],
] as const;

export function AdminShell() {
  return (
    <div class="app" id="app" data-layout="desktop" data-theme="cream">
      <aside class="side on-navy">
        <Logo size={19} white />
        {SECTIONS.map(([label, icon], i) => (
          <a key={label} class={`nav${i === 0 ? ' on' : ''}`} href="#/">
            <Icon name={icon} size={21} />
            <span>{label}</span>
          </a>
        ))}
      </aside>
      <div class="view enter">
        <header class="topbar">
          <div class="ttl">
            <div class="lbl">Administração</div>
            <div class="h2" style={{ marginTop: '2px' }}>
              Painel
            </div>
          </div>
        </header>
        <div class="scroll">
          <div class="wrap stack" style={{ '--wrap': '900px' }}>
            <div class="card stack" style={{ '--gap': '8px' }}>
              <div class="lbl">Em construção</div>
              <p class="p">O painel administrativo do Take It Easy chega em breve.</p>
            </div>
          </div>
        </div>
      </div>
      <div id="fxroot" />
    </div>
  );
}
