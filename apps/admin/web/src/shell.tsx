// Admin shell: the student app's frame (.app with data-layout, the navy .side on desktop) around lazy
// screens. Signed-out visitors only reach #/entrar and #/convite/<token>; a screen whose permission
// the role lacks shows a "not part of your role" card (the Worker refuses the calls anyway).
import { Logo } from '@tie/ui/components';
import { Component, type ComponentChildren, type FunctionComponent } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { NAV_GROUPS, type NavItem } from './nav';
import { replace, route, withQuery } from './router';
import { SCREENS, type ScreenProps } from './screens/registry';
import { Login } from './screens/Login';
import { auth, authStatus, can, loadSession, logout, pendingModeration, ROLE_LABEL } from './session';
import { Icon } from './ui/icons';
import { Button, Empty, NoAccess, Page, Skeleton } from './ui/kit';
import { menuOpen, wide } from './ui/layout';
import { DialogHost, Modal } from './ui/modal';
import { Toasts } from './ui/toast';

function Frame({ children, layout }: { children?: ComponentChildren; layout: 'desktop' | 'mobile' }) {
  return (
    <div class="app ad-app" id="app" data-layout={layout} data-theme="cream">
      <a class="ad-skip" href="#main" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Pular para o conteúdo
      </a>
      <div id="content" style={{ display: 'contents' }}>
        {children}
        <div id="overlayroot" />
      </div>
      <Toasts />
      <DialogHost />
    </div>
  );
}

const visible = (it: NavItem) => !it.perm || can(it.perm);

function NavLinks({ active, onPick }: { active: string; onPick?: () => void }) {
  const pending = pendingModeration.value;
  return (
    <>
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter(visible);
        if (!items.length) return null;
        return (
          <div key={g.label ?? 'top'} class="ad-navgroup" role="group" aria-label={g.label ?? 'Início'}>
            {g.label ? <div class="lbl ad-navlbl">{g.label}</div> : null}
            {items.map((it) => (
              <a
                key={it.href}
                class={`nav${active === it.href ? ' on' : ''}`}
                href={`#/${it.href}`}
                aria-current={active === it.href ? 'page' : undefined}
                onClick={onPick}
              >
                <Icon name={it.icon} size={20} />
                <span>{it.label}</span>
                {it.href === 'moderacao' && pending ? <span class="badge">{pending > 99 ? '99+' : pending}</span> : null}
              </a>
            ))}
          </div>
        );
      })}
    </>
  );
}

function UserFoot({ onPick }: { onPick?: () => void }) {
  const a = auth.value;
  if (!a) return null;
  const top = a.user.roles[0];
  return (
    <div class="ad-me">
      <div class="ad-me-who">
        <span class="ad-me-av" aria-hidden="true">
          {a.user.email.slice(0, 1).toUpperCase()}
        </span>
        <div class="grow" style={{ minWidth: '0' }}>
          <div class="ad-me-mail" title={a.user.email}>
            {a.user.email}
          </div>
          {top ? <span class="xs">{ROLE_LABEL[top]}</span> : null}
        </div>
      </div>
      <div class="row" style={{ '--gap': '6px' }}>
        <a class="ad-me-btn grow" href="#/conta" onClick={onPick}>
          <Icon name="key" size={16} />
          <span>Minha conta</span>
        </a>
        <button type="button" class="ad-me-btn" onClick={() => void logout()} aria-label="Sair do painel">
          <Icon name="logout" size={16} />
          <span>Sair</span>
        </button>
      </div>
    </div>
  );
}

function Side({ active }: { active: string }) {
  return (
    <aside class="side on-navy ad-side" aria-label="Seções do painel">
      <a href="#/" class="ad-brand" aria-label="Take It Easy · Painel">
        <Logo size={17} white />
        <span class="ad-brand-tag">ADMIN</span>
      </a>
      <nav class="ad-nav">
        <NavLinks active={active} />
      </nav>
      <div class="foot">
        <UserFoot />
      </div>
    </aside>
  );
}

function MobileMenu({ active }: { active: string }) {
  if (!menuOpen.value) return null;
  const close = () => {
    menuOpen.value = false;
  };
  return (
    <Modal title="Menu" onClose={close}>
      <nav class="ad-mnav on-navy" aria-label="Seções do painel">
        <NavLinks active={active} onPick={close} />
      </nav>
      <UserFoot onPick={close} />
    </Modal>
  );
}

class Boundary extends Component<{ children: ComponentChildren }, { error: unknown }> {
  override state = { error: null as unknown };
  static override getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown) {
    console.error(error);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    const detail = import.meta.env.DEV && this.state.error instanceof Error ? this.state.error.stack : '';
    return (
      <Page title="Erro">
        <Empty
          icon="alert"
          title="Algo deu errado nesta tela."
          body={detail ? <pre class="ad-json">{detail}</pre> : 'Recarregue a página. Se continuar, avise o time técnico.'}
          action={<Button label="Recarregar" icon="refresh" onClick={() => location.reload()} />}
        />
      </Page>
    );
  }
}

const loaded = new Map<string, FunctionComponent<ScreenProps>>();

function ScreenHost({ name, props }: { name: string; props: ScreenProps }) {
  const def = SCREENS[name as keyof typeof SCREENS];
  const [C, setC] = useState<FunctionComponent<ScreenProps> | undefined>(() => loaded.get(name));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (C || !def) return;
    let alive = true;
    def.load().then(
      (c) => {
        loaded.set(name, c);
        if (alive) setC(() => c);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [name]);
  if (!def) {
    return (
      <Page title="Página não encontrada">
        <Empty icon="search" title="Não existe nada neste endereço." action={<a class="btn compact navy" href="#/">Ir para o painel</a>} />
      </Page>
    );
  }
  if (def.perm && !can(def.perm)) {
    return (
      <Page title="Sem acesso">
        <NoAccess />
      </Page>
    );
  }
  if (failed) {
    return (
      <Page title="Sem conexão">
        <Empty
          icon="alert"
          title="Não deu para abrir esta tela."
          body="Confira a internet. Se o painel foi atualizado, recarregar resolve."
          action={<Button label="Recarregar" icon="refresh" onClick={() => location.reload()} />}
        />
      </Page>
    );
  }
  if (!C) {
    return (
      <Page title="Carregando…">
        <Skeleton rows={6} />
      </Page>
    );
  }
  return <C {...props} />;
}

function Splash({ offline }: { offline?: boolean }) {
  return (
    <div class="ad-splash">
      <Logo size={26} />
      {offline ? (
        <div class="stack tc" style={{ '--gap': '10px', alignItems: 'center' }}>
          <p class="p">Não deu para falar com o servidor.</p>
          <Button label="Tentar de novo" icon="refresh" onClick={() => void loadSession()} />
        </div>
      ) : (
        <span class="ad-spin lg" role="progressbar" aria-label="Carregando o painel" />
      )}
    </div>
  );
}

export function Shell() {
  const st = authStatus.value;
  const r = route.value;
  const layout = wide.value ? 'desktop' : 'mobile';
  const isPublic = r.name === 'login' || r.name === 'invite';
  const redirectTo =
    st === 'out' && !isPublic
      ? withQuery('entrar', { volta: r.path && r.path !== 'painel' ? r.path : undefined })
      : st === 'in' && r.name === 'login'
        ? r.q.volta && !r.q.volta.startsWith('entrar') ? r.q.volta : ''
        : null;

  useLayoutEffect(() => {
    if (redirectTo !== null) replace(redirectTo);
  }, [redirectTo]);

  useEffect(() => {
    menuOpen.value = false;
  }, [r.path]);

  if (st === 'loading' || st === 'offline') {
    return (
      <Frame layout={layout}>
        <Splash offline={st === 'offline'} />
      </Frame>
    );
  }
  if (isPublic) {
    return (
      <Frame layout={layout}>
        <Login token={r.name === 'invite' ? r.params.token : undefined} />
      </Frame>
    );
  }
  if (st !== 'in' || redirectTo !== null) return <Frame layout={layout} />;

  const def = SCREENS[r.name as keyof typeof SCREENS];
  const active = def?.nav ?? '';
  return (
    <Frame layout={layout}>
      {layout === 'desktop' ? <Side active={active} /> : null}
      <main key={r.path} class="view enter ad-view">
        <Boundary>
          <ScreenHost name={r.name} props={{ params: r.params, q: r.q }} />
        </Boundary>
      </main>
      {layout === 'mobile' ? <MobileMenu active={active} /> : null}
    </Frame>
  );
}
