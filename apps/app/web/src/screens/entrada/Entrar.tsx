// #/entrar: port of prototipo/js/screens/entrada.js with the PROD changes of spec 01 §1: real login
// (e-mail + senha + Turnstile), no Google/Apple or demo account, "Esqueci a senha" points to support
// and the footer links the Termos de Uso and the Política de Privacidade. `?reset=<token>` opens the
// "nova senha" form for an admin-issued reset link.

import { LIMITS } from '@tie/shared/constants';
import { authApi } from '@tie/shared/contracts/auth';
import { ApiError } from '@tie/shared/errors';
import { activator, Btn, Icon, Logo, toast } from '@tie/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { type ScreenProps, useChrome } from '../../frame';
import { replace } from '../../router';
import { layoutOf } from '../../shell';
import { state } from '../../store';
import { isLegalDoc, LegalLink, LegalSheet } from './legal';
import { afterAuth, emailOk } from './session';
import { TURNSTILE_ERROR, useTurnstile } from './turnstile';

const HERO_IMG = 'url(/img/login.webp)';
/** Desktop: the photo fills the left side and the copy sits on the dark bottom of the tie.css gradient. */
const HERO_DESKTOP = { backgroundImage: HERO_IMG, backgroundPosition: '62% 42%' };
/**
 * Mobile: the logo tagline lands on the café's sign, so a navy veil keeps the top legible, and the
 * extra bottom padding keeps the subtitle clear of the card that overlaps the hero by 20px.
 */
const HERO_MOBILE = {
  backgroundImage: `linear-gradient(rgba(10,30,63,.62), rgba(10,30,63,.18) 55%, rgba(10,30,63,0)), ${HERO_IMG}`,
  backgroundPosition: 'center, 62% 42%',
  backgroundSize: 'cover, cover',
  paddingBottom: '46px',
};
/** Desktop: a roomier form column, so the card does not look undersized next to the photo. */
const WRAP_DESKTOP = { width: '520px', padding: '40px' };
const CARD_DESKTOP = { '--gap': '14px', padding: '32px 30px 26px' };
/** The terms line at the size of .sm (not 13px .xs), so its two links read clearly, balanced on two lines. */
const LEGAL_STYLE = { textWrap: 'balance', fontSize: '.875rem' };
/** On a phone the subtitle breaks after its first sentence (balanced, with "de novo" and "A história" kept together). */
const SUB_STYLE = { textWrap: 'balance' };
/** "Esqueci a senha" lines up with the field labels (tie.css gives .btn.link 4px side padding). */
const LINK_FLUSH = { paddingLeft: '0', paddingRight: '0' };
/** The "ou" rules as hairlines: --line (beige) at 1.5px read heavier than the rest of the card. */
const DIVIDER = { '--line': 'rgba(15,42,85,.11)' };

type Errs = { email?: string; pass?: string };

/** PROD: admins issue reset links (spec 01 §1), so the person is pointed to support. */
const forgot = () =>
  toast('Fale com o suporte do Take It Easy: a equipe envia um link para você criar uma senha nova.', 4200);

const onEnter = (fn: () => void) => (ev: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  fn();
};

/** Password input with the eye toggle (`.input-wrap`), as in the prototype. */
export function PassInput({
  id,
  value,
  show,
  onShow,
  onInput,
  onEnterKey,
  autocomplete,
  placeholder = `Mínimo de ${LIMITS.passwordMin} caracteres`,
  readOnly,
}: {
  id: string;
  value: string;
  show: boolean;
  onShow: () => void;
  onInput: (v: string) => void;
  onEnterKey?: () => void;
  autocomplete: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <span class="input-wrap">
      <input
        class="input"
        id={id}
        type={show ? 'text' : 'password'}
        autocomplete={autocomplete}
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        maxLength={LIMITS.passwordMax}
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={onEnterKey ? onEnter(onEnterKey) : undefined}
      />
      {readOnly ? null : (
        <button
          type="button"
          class="iconbtn"
          aria-label="Mostrar senha"
          aria-pressed={show}
          title={show ? 'Ocultar senha' : 'Mostrar senha'}
          onClick={activator(undefined, onShow)}
        >
          <Icon name={show ? 'eyeoff' : 'eye'} size={20} />
        </button>
      )}
    </span>
  );
}

function FieldErr({ msg }: { msg?: string | undefined }) {
  return msg ? (
    <div class="field">
      <span class="err">{msg}</span>
    </div>
  ) : null;
}

function LoginForm({ desk }: { desk: boolean }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<Errs>({});
  const [busy, setBusy] = useState(false);
  const ts = useTurnstile('login');

  const login = async () => {
    if (busy) return;
    const e: Errs = {};
    if (!emailOk(email.trim())) e.email = 'Confira o e-mail. Ele precisa ter @ e um domínio.';
    if (pass.length < LIMITS.passwordMin) e.pass = `A senha tem pelo menos ${LIMITS.passwordMin} caracteres.`;
    setErr(e);
    if (e.email || e.pass) return;
    setBusy(true);
    try {
      const turnstileToken = await ts.token();
      await call(authApi.login, { body: { email: email.trim(), password: pass, turnstileToken } });
      await afterAuth();
    } catch (x) {
      if (x instanceof ApiError && x.code === 'invalid_credentials') setErr({ pass: x.message });
      else toast(x instanceof Error && x.message === TURNSTILE_ERROR ? TURNSTILE_ERROR : errorMessage(x));
      setBusy(false);
    } finally {
      ts.reset();
    }
  };

  return (
    <div class="card formcard stack" style={desk ? CARD_DESKTOP : { '--gap': '12px' }} onFocusIn={ts.warm}>
      <div>
        <div class="h2">Entrar</div>
        <p class="sm mt4" style={SUB_STYLE}>
          Que bom ver você de{'\u00a0'}novo. A{'\u00a0'}história continua.
        </p>
      </div>
      <label class="field">
        <span>E-mail</span>
        <input
          class="input"
          id="login-email"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="voce@email.com"
          value={email}
          maxLength={LIMITS.emailMax}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </label>
      <FieldErr msg={err.email} />
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside, rendered by a child component */}
      <label class="field">
        <span>Senha</span>
        <PassInput
          id="login-pass"
          value={pass}
          show={show}
          onShow={() => setShow(!show)}
          onInput={setPass}
          onEnterKey={() => void login()}
          autocomplete="current-password"
        />
      </label>
      <FieldErr msg={err.pass} />
      <div class="row between">
        <button type="button" class="btn link" style={LINK_FLUSH} onClick={activator(undefined, forgot)}>
          Esqueci a senha
        </button>
      </div>
      <Btn label={busy ? 'Entrando…' : 'Entrar'} cls="block" dis={busy} onClick={() => void login()} />
      <div class="divider" style={DIVIDER}>
        ou
      </div>
      <Btn label="Criar conta grátis" kind="ghost" go="cadastro/1" cls="block" />
      <div ref={ts.ref} style={{ display: 'contents' }} />
      <p class="xs tc" style={LEGAL_STYLE}>
        Ao entrar você concorda com os{' '}
        <LegalLink path="entrar" doc="termos">
          Termos de Uso
        </LegalLink>{' '}
        e a{' '}
        <LegalLink path="entrar" doc="privacidade">
          Política de Privacidade
        </LegalLink>
        .
      </p>
    </div>
  );
}

/** `#/entrar?reset=<token>`: sets a new password from the one-time link an admin issued. */
function ResetForm({ token, desk }: { token: string; desk: boolean }) {
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ts = useTurnstile('reset');

  const save = async () => {
    if (busy) return;
    if (pass.length < LIMITS.passwordMin) {
      setErr(`A senha precisa de pelo menos ${LIMITS.passwordMin} caracteres.`);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const turnstileToken = await ts.token();
      await call(authApi.resetConsume, { body: { token, password: pass, turnstileToken } });
      toast('Senha nova salva. Entre com ela.');
      replace('entrar');
    } catch (x) {
      toast(x instanceof Error && x.message === TURNSTILE_ERROR ? TURNSTILE_ERROR : errorMessage(x));
      setBusy(false);
    } finally {
      ts.reset();
    }
  };

  return (
    <div class="card formcard stack" style={desk ? CARD_DESKTOP : { '--gap': '12px' }} onFocusIn={ts.warm}>
      <div class="h2">Criar uma senha nova</div>
      <p class="sm">Escolha a senha que você vai usar daqui para a frente. O link vale uma vez só.</p>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside, rendered by a child component */}
      <label class="field">
        <span>Senha nova</span>
        <PassInput
          id="reset-pass"
          value={pass}
          show={show}
          onShow={() => setShow(!show)}
          onInput={setPass}
          onEnterKey={() => void save()}
          autocomplete="new-password"
        />
      </label>
      <FieldErr msg={err} />
      <Btn label={busy ? 'Salvando…' : 'Salvar a senha nova'} cls="block" dis={busy} onClick={() => void save()} />
      <Btn label="Voltar para Entrar" kind="ghost" cls="block" onClick={() => replace('entrar')} />
      <div ref={ts.ref} style={{ display: 'contents' }} />
    </div>
  );
}

export default function Entrar({ q }: ScreenProps) {
  useChrome({ title: 'Entrar' });
  const reset = q.reset && /^[\w-]{16,200}$/.test(q.reset) ? q.reset : '';
  const desk = layoutOf(state.value) === 'desktop';
  return (
    <div class="scroll">
      <div class="auth">
        <div class="hero" style={desk ? HERO_DESKTOP : HERO_MOBILE}>
          <Logo size={30} desc white />
          <h1 class="h1 mt16" style={{ color: '#fff' }}>
            Você não faz lições. Você acompanha uma história.
          </h1>
          <p class="p mt8" style={{ color: 'var(--onNavy)' }}>
            Uma série do zero ao B2, com a Maggie para conversar quando você quiser.
          </p>
        </div>
        <div class="formwrap" style={desk ? WRAP_DESKTOP : undefined}>
          {reset ? <ResetForm token={reset} desk={desk} /> : <LoginForm desk={desk} />}
        </div>
      </div>
      {isLegalDoc(q.doc) ? <LegalSheet path="entrar" doc={q.doc} /> : null}
    </div>
  );
}
