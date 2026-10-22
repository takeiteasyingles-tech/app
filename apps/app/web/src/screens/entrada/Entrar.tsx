// #/entrar: port of prototipo/js/screens/entrada.js with the PROD changes of spec 01 §1: real login
// (e-mail + senha + Turnstile), no Google/Apple or demo account, and the footer links the Termos de Uso
// and the Política de Privacidade. "Esqueci a senha" opens `?esqueci=1`, the e-mail form of spec 07
// (feature A); `?reset=<token>` opens the "nova senha" form for a reset link (e-mailed or admin-issued).

import { DURATIONS, LIMITS } from '@tie/shared/constants';
import { authApi } from '@tie/shared/contracts/auth';
import { ApiError } from '@tie/shared/errors';
import { activator, Btn, Icon, Logo, toast } from '@tie/ui';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { type ScreenProps, useChrome } from '../../frame';
import { go, replace } from '../../router';
import { layoutOf } from '../../shell';
import { state } from '../../store';
import { HERO_URL } from './hero';
import { isLegalDoc, LegalLink, LegalSheet } from './legal';
import { afterAuth, emailOk } from './session';
import { TURNSTILE_ERROR, useTurnstile } from './turnstile';
import './entrada.css';

// The photo comes in two sizes (hero.ts): the desktop original, a lighter copy for phones.
const HERO_IMG = `url(${HERO_URL.desktop})`;
const HERO_IMG_MOBILE = `url(${HERO_URL.mobile})`;
/**
 * Desktop: the photo fills the left side, framed on the café (its "Good Coffee" window lettering whole,
 * the neighbour's "River & Oak" sign out of frame rather than cut) and the copy sits on the soft veil
 * at its foot (entrada.css).
 */
const HERO_DESKTOP = { backgroundImage: HERO_IMG, backgroundPosition: '48% 42%' };
/**
 * Mobile: the whole photo across the top of the hero (the café's corner and its "Woods & Beans" sign in
 * view), the logo on a light veil over its sky, and the headline starting where the photo melts into
 * the navy below it (entrada.css), so no sign sits behind the copy and the place still reads. The
 * bottom padding keeps the subtitle clear of the card that overlaps the hero by 20px.
 */
const HERO_MOBILE = {
  backgroundImage: HERO_IMG_MOBILE,
  backgroundPosition: 'center top',
  backgroundSize: '100% auto',
  backgroundRepeat: 'no-repeat',
  justifyContent: 'flex-start',
  paddingTop: '22px',
  paddingBottom: '46px',
};
/**
 * Phone: the headline begins a little above the photo's foot (the picture is 2:3 of the width; the
 * logo block above is about 72px tall).
 */
const H1_MOBILE = { color: '#fff', marginTop: 'max(20px, calc(66.6cqw - 104px))' };
const H1_DESKTOP = { color: '#fff', marginTop: '16px' };
/**
 * Desktop: the form column is a full-height panel beside the photo (the split-screen login) in the app's
 * cream, so it continues the rest of the app; the form, the way to sign up and the terms form one group
 * centred in it, instead of a small card floating on cream or terms stranded at the panel's foot.
 */
const WRAP_DESKTOP = {
  width: '540px',
  padding: '40px 64px 32px',
  flexDirection: 'column',
  alignItems: 'stretch',
  background: 'var(--cream)',
};
const CARD_DESKTOP = {
  '--gap': '16px',
  margin: 'auto 0',
  padding: '0',
  border: '0',
  borderRadius: '0',
  background: 'transparent',
};
/** The terms line at the size of .sm (not 13px .xs) in a dark slate, so its two links read clearly. */
const LEGAL_STYLE = { textWrap: 'pretty', fontSize: '.875rem', color: '#3C4357', marginTop: '2px' };
const LEGAL_DESK = { ...LEGAL_STYLE, marginTop: '6px' };
/** The way to sign up, under a hairline: a question and the button (no "ou" divider with one option). */
const SIGNUP_ROW = { borderTop: '1.5px solid rgba(15,42,85,.11)', paddingTop: '16px', marginTop: '4px' };
/** The welcome line under the heading. */
const SUB_STYLE = { textWrap: 'pretty' };
/** "Esqueci a senha" lines up with the field labels (tie.css gives .btn.link 4px side padding). */
const LINK_FLUSH = { paddingLeft: '0', paddingRight: '0' };

type Errs = { email?: string; pass?: string };

/**
 * The address typed on the login form, carried to the "Esqueci a senha" form in memory (never in the
 * URL), so the person does not type it twice.
 */
let typedEmail = '';

/** "Esqueci a senha" (spec 07, feature A): the e-mail form at `#/entrar?esqueci=1`. */
const forgot = () => go('entrar?esqueci=1');

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
  const [email, setEmail] = useState(typedEmail);
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
      typedEmail = '';
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
      <div style={desk ? { marginBottom: '6px' } : undefined}>
        <div class="h2" style={desk ? { fontSize: '1.9rem' } : undefined}>
          Entrar
        </div>
        {/* Phone: the short form fits one line of the card (the full one broke after "de novo."). */}
        <p class="sm mt4" style={desk ? { ...SUB_STYLE, fontSize: '1rem' } : SUB_STYLE}>
          {desk ? 'Que bom ver você de novo. A história continua.' : 'Que bom ver você de novo.'}
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
          onInput={(e) => {
            typedEmail = e.currentTarget.value;
            setEmail(typedEmail);
          }}
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
      <div ref={ts.ref} style={{ display: 'contents' }} />
      <div class="stack" style={{ ...SIGNUP_ROW, '--gap': '10px' }}>
        <p class="sm" style={{ fontWeight: '700', color: 'var(--navy)' }}>
          Ainda não tem conta? O 1º episódio é grátis.
        </p>
        <Btn label="Criar conta grátis" kind="ghost" go="cadastro/1" cls="block" />
      </div>
      <Legal desk={desk} />
    </div>
  );
}

/** "Ao entrar você concorda…" with the two documents, left-aligned like the form. */
function Legal({ desk = false }: { desk?: boolean }) {
  return (
    <p class="xs" style={desk ? LEGAL_DESK : LEGAL_STYLE}>
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
  );
}

/** How long the e-mailed link lasts, in the e-mail's words ("1 hora"). */
const LINK_LIFE = (() => {
  const min = Math.round(DURATIONS.resetEmailTokenMs / 60_000);
  if (min % 60) return `${min} minutos`;
  return min === 60 ? '1 hora' : `${min / 60} horas`;
})();

/** The round icon over the "Confira o seu e-mail" message. */
const SENT_ICON = {
  width: '52px',
  height: '52px',
  borderRadius: '50%',
  background: 'var(--orangeT)',
  color: 'var(--orange)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
/** Desktop: the panel is cream, so the icon disc and the hint become white with a hairline edge. */
const SENT_ICON_DESK = { ...SENT_ICON, background: '#fff', border: '1.5px solid var(--line)' };
const HINT_DESK = { ...SUB_STYLE, background: '#fff', border: '1.5px solid var(--line)' };

/**
 * `#/entrar?esqueci=1` (spec 07, feature A): asks for the account's e-mail and has the server e-mail a
 * one-time link (`?reset=<token>`). The server answers the same whether or not the address has an
 * account, so the confirmation is worded "se o e-mail estiver cadastrado".
 */
function ForgotForm({ desk }: { desk: boolean }) {
  const [email, setEmail] = useState(typedEmail);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const ts = useTurnstile('reset_request');
  const head = useRef<HTMLDivElement>(null);

  // The confirmation replaces the form: move the focus to its heading so it is announced.
  useEffect(() => {
    if (sentTo) head.current?.focus();
  }, [sentTo]);

  const send = async () => {
    if (busy) return;
    const v = email.trim();
    if (!emailOk(v)) {
      setErr('Confira o e-mail. Ele precisa ter @ e um domínio.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const turnstileToken = await ts.token();
      await call(authApi.resetRequest, { body: { email: v, turnstileToken } });
      typedEmail = v;
      setSentTo(v);
    } catch (x) {
      toast(x instanceof Error && x.message === TURNSTILE_ERROR ? TURNSTILE_ERROR : errorMessage(x));
    } finally {
      setBusy(false);
      ts.reset();
    }
  };

  const title = { fontSize: desk ? '1.9rem' : undefined, outline: 'none' };

  if (sentTo)
    return (
      <div class="card formcard stack" style={desk ? CARD_DESKTOP : { '--gap': '12px' }}>
        <span style={desk ? SENT_ICON_DESK : SENT_ICON} aria-hidden="true">
          <Icon name="send" size={24} />
        </span>
        <div class="h2" style={title} tabIndex={-1} ref={head}>
          Confira o seu e-mail
        </div>
        <p class="p" style={SUB_STYLE}>
          Se o e-mail <b style={{ color: 'var(--navy)', overflowWrap: 'anywhere' }}>{sentTo}</b> estiver cadastrado,
          enviamos um link para você criar uma senha nova. O link vale por {LINK_LIFE}.
        </p>
        <div class="fb tip sm" style={desk ? HINT_DESK : SUB_STYLE}>
          Não chegou em alguns minutos? Olhe a caixa de spam ou de promoções, ou peça outro link.
        </div>
        <Btn label="Voltar para Entrar" cls="block" onClick={() => replace('entrar')} />
        <Btn label="Pedir outro link" kind="ghost" cls="block" onClick={() => setSentTo('')} />
      </div>
    );

  return (
    <div class="card formcard stack" style={desk ? CARD_DESKTOP : { '--gap': '12px' }} onFocusIn={ts.warm}>
      <div style={desk ? { marginBottom: '6px' } : undefined}>
        <div class="h2" style={title}>
          Esqueci a senha
        </div>
        <p class="sm mt4" style={desk ? { ...SUB_STYLE, fontSize: '1rem' } : SUB_STYLE}>
          Digite o e-mail da sua conta. Enviamos um link para você criar uma senha nova.
        </p>
      </div>
      <label class="field">
        <span>E-mail</span>
        <input
          class="input"
          id="forgot-email"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="voce@email.com"
          value={email}
          maxLength={LIMITS.emailMax}
          aria-invalid={err ? 'true' : undefined}
          aria-describedby={err ? 'forgot-email-err' : undefined}
          onInput={(e) => setEmail(e.currentTarget.value)}
          onKeyDown={onEnter(() => void send())}
        />
      </label>
      {err ? (
        <div class="field">
          <span class="err" id="forgot-email-err">
            {err}
          </span>
        </div>
      ) : null}
      <Btn label={busy ? 'Enviando…' : 'Enviar o link'} cls="block" dis={busy} onClick={() => void send()} />
      <Btn label="Voltar para Entrar" kind="ghost" cls="block" onClick={() => replace('entrar')} />
      <div ref={ts.ref} style={{ display: 'contents' }} />
    </div>
  );
}

/** `#/entrar?reset=<token>`: sets a new password from a one-time link (e-mailed or admin-issued). */
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
      <div class="h2" style={desk ? { fontSize: '1.9rem' } : undefined}>
        Criar uma senha nova
      </div>
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
    <div class="scroll" data-u1="entrar">
      <div class="auth">
        <div class="hero" style={desk ? HERO_DESKTOP : HERO_MOBILE}>
          <Logo size={30} desc white />
          <h1 class="h1" style={desk ? H1_DESKTOP : H1_MOBILE}>
            Você não faz lições. Você acompanha uma história.
          </h1>
          <p class="p" style={{ color: 'var(--onNavy)', marginTop: desk ? '8px' : '8px', textWrap: 'pretty' }}>
            Uma série do zero ao B2, com a Maggie para conversar quando você quiser.
          </p>
        </div>
        <div class="formwrap" style={desk ? WRAP_DESKTOP : undefined}>
          {reset ? (
            <ResetForm token={reset} desk={desk} />
          ) : q.esqueci ? (
            <ForgotForm desk={desk} />
          ) : (
            <LoginForm desk={desk} />
          )}
        </div>
      </div>
      {isLegalDoc(q.doc) ? <LegalSheet path="entrar" doc={q.doc} /> : null}
    </div>
  );
}
