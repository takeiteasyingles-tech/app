// #/entrar (staff login) and #/convite/<token> (invite accept: set a password, then sign in). Same
// .auth layout as the student login: a navy hero beside (desktop) or above (phone) the form card.
import { adminAuthApi, type InviteInfo, STAFF_PASSWORD_MIN } from '@tie/shared/contracts/admin';
import { Logo } from '@tie/ui/components';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../api';
import { fmtLong } from '../format';
import { replace } from '../router';
import { ROLE_LABEL, signedIn } from '../session';
import { siteKey, useTurnstile } from '../turnstile';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Button, Field, Skeleton, TextIn } from '../ui/kit';
import { setTitle } from '../ui/layout';

function PasswordIn({
  id,
  value,
  onValue,
  autoComplete,
  err,
}: {
  id: string;
  value: string;
  onValue: (v: string) => void;
  autoComplete: string;
  err?: string | null;
}) {
  const [show, setShow] = useState(false);
  return (
    <div class="input-wrap">
      <TextIn id={id} type={show ? 'text' : 'password'} value={value} onValue={onValue} autoComplete={autoComplete} err={err} required />
      <button type="button" class="iconbtn" aria-label={show ? 'Esconder a senha' : 'Mostrar a senha'} aria-pressed={show ? 'true' : 'false'} onClick={() => setShow(!show)}>
        <Icon name={show ? 'eyeoff' : 'eye'} size={20} />
      </button>
    </div>
  );
}

function Hero() {
  return (
    <div class="hero ad-hero">
      <Logo size={24} white />
      <div class="stack mt24" style={{ '--gap': '10px' }}>
        <span class="lbl">Painel administrativo</span>
        <h1 class="h1">O bastidor do Take It Easy.</h1>
        <p class="p ad-hero-p">Conteúdo, alunos, moderação e publicações num só lugar, com cada ação registrada.</p>
      </div>
      <ul class="ad-hero-list" aria-label="O que dá para fazer aqui">
        <li>
          <Icon name="trail" size={18} /> Episódios, e-books e Extras
        </li>
        <li>
          <Icon name="users" size={18} /> Alunos, planos e papéis da equipe
        </li>
        <li>
          <Icon name="shield" size={18} /> Moderação e auditoria
        </li>
      </ul>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ts = useTurnstile('login');
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!email.trim() || !pass) {
      setErr('Preencha e-mail e senha.');
      return;
    }
    setBusy(true);
    try {
      const token = await ts.token();
      const res = await call(adminAuthApi.login, { body: { email: email.trim(), password: pass, turnstileToken: token } });
      signedIn(res);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : errorMessage(ex));
      setPass('');
    } finally {
      ts.reset();
      setBusy(false);
    }
  };
  return (
    <form class="card formcard stack ad-formcard" style={{ '--gap': '16px' }} onSubmit={submit} onFocusIn={ts.warm} noValidate>
      <div class="stack" style={{ '--gap': '4px' }}>
        <h2 class="h2">Entrar no painel</h2>
        <p class="sm">Use o e-mail da equipe. Alunos entram pelo app.</p>
      </div>
      <Field id="login-email" label="E-mail">
        <TextIn id="login-email" type="email" value={email} onValue={setEmail} autoComplete="username" inputMode="email" required />
      </Field>
      <Field id="login-pass" label="Senha">
        <PasswordIn id="login-pass" value={pass} onValue={setPass} autoComplete="current-password" />
      </Field>
      <div ref={ts.ref} style={{ display: 'contents' }} />
      {err ? (
        <div class="fb err" role="alert">
          {err}
        </div>
      ) : null}
      {!siteKey() ? (
        <div class="fb tip">A verificação de segurança não está configurada neste build (VITE_TURNSTILE_SITEKEY).</div>
      ) : null}
      <Button type="submit" label="Entrar" kind="navy" small={false} block busy={busy} />
      <p class="xs">Esqueceu a senha? Peça a um admin um link novo; ele sai da página do seu usuário.</p>
    </form>
  );
}

function InviteForm({ token }: { token: string }) {
  const info = useLoad<InviteInfo>((signal) => call(adminAuthApi.inviteInfo, { params: { token }, signal }), [token]);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ts = useTurnstile('invite');
  const short = pass.length > 0 && pass.length < STAFF_PASSWORD_MIN;
  const mismatch = pass2.length > 0 && pass !== pass2;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (pass.length < STAFF_PASSWORD_MIN) return setErr(`A senha precisa de pelo menos ${STAFF_PASSWORD_MIN} caracteres.`);
    if (pass !== pass2) return setErr('As duas senhas precisam ser iguais.');
    setBusy(true);
    try {
      const t = await ts.token();
      const res = await call(adminAuthApi.inviteAccept, { body: { token, password: pass, turnstileToken: t } });
      signedIn(res);
      replace('');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : errorMessage(ex));
    } finally {
      ts.reset();
      setBusy(false);
    }
  };
  if (info.error) {
    return (
      <div class="card formcard stack ad-formcard" style={{ '--gap': '14px' }}>
        <h2 class="h2">Convite indisponível</h2>
        <p class="p">{errorMessage(info.error)}</p>
        <p class="sm">Peça a quem convidou você um link novo. Cada convite vale por 7 dias e só uma vez.</p>
        <a class="btn compact light" href="#/entrar">
          Ir para o login
        </a>
      </div>
    );
  }
  if (!info.data) {
    return (
      <div class="card formcard ad-formcard">
        <Skeleton rows={4} />
      </div>
    );
  }
  const d = info.data;
  return (
    <form class="card formcard stack ad-formcard" style={{ '--gap': '16px' }} onSubmit={submit} onFocusIn={ts.warm} noValidate>
      <div class="stack" style={{ '--gap': '6px' }}>
        <span class="pill gr">Convite para {ROLE_LABEL[d.role]}</span>
        <h2 class="h2">Crie sua senha</h2>
        <p class="sm">
          Conta <b>{d.email}</b>. O convite vale até {fmtLong(d.expiresAt)}.
        </p>
      </div>
      <Field id="inv-pass" label="Senha nova" hint={`Pelo menos ${STAFF_PASSWORD_MIN} caracteres.`} err={short ? `Faltam ${STAFF_PASSWORD_MIN - pass.length} caracteres.` : null}>
        <PasswordIn id="inv-pass" value={pass} onValue={setPass} autoComplete="new-password" err={short ? 'x' : null} />
      </Field>
      <Field id="inv-pass2" label="Repita a senha" err={mismatch ? 'As senhas não são iguais.' : null}>
        <PasswordIn id="inv-pass2" value={pass2} onValue={setPass2} autoComplete="new-password" err={mismatch ? 'x' : null} />
      </Field>
      <div ref={ts.ref} style={{ display: 'contents' }} />
      {err ? (
        <div class="fb err" role="alert">
          {err}
        </div>
      ) : null}
      <Button type="submit" label="Criar senha e entrar" kind="navy" small={false} block busy={busy} />
    </form>
  );
}

export function Login({ token }: { token?: string }) {
  useEffect(() => setTitle(token ? 'Convite' : 'Entrar'), [token]);
  return (
    <div class="view enter">
      <div class="scroll" id="main" tabIndex={-1}>
        <div class="auth ad-auth">
          <Hero />
          <div class="formwrap">{token ? <InviteForm token={token} /> : <LoginForm />}</div>
        </div>
      </div>
    </div>
  );
}
