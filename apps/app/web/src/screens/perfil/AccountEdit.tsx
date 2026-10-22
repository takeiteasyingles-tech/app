// "Sua conta" in Perfil (spec 07, feature A; PROD, no prototype counterpart): edit the full name and
// the display name (PUT /api/me/profile, validated like signup) and change the password
// (POST /api/auth/password: asks for the current one; every other session ends, this one continues).
// Each edit opens a sheet, like the data actions of Account.tsx.
import { LIMITS } from '@tie/shared/constants';
import { authApi } from '@tie/shared/contracts/auth';
import { meApi } from '@tie/shared/contracts/me';
import { ApiError } from '@tie/shared/errors';
import { Btn, toast } from '@tie/ui';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { set, state } from '../../store';
import { Sec } from '../cadastro/ui';
import { PassInput } from '../entrada/Entrar';
import { issuePaths } from '../entrada/session';
import { ActionRow, Sheet } from './Account';

function FieldErr({ id, msg }: { id: string; msg?: string | undefined }) {
  return msg ? (
    <div class="field">
      <span class="err" id={id}>
        {msg}
      </span>
    </div>
  ) : null;
}

type NameErrs = { fullName?: string; name?: string };

function NameSheet({ onClose }: { onClose: () => void }) {
  const p = state.value.profile;
  const [fullName, setFullName] = useState(p?.fullName ?? state.value.user?.fullName ?? '');
  const [name, setName] = useState(p?.name ?? state.value.user?.name ?? '');
  const [err, setErr] = useState<NameErrs>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const body = { fullName: fullName.trim().replace(/\s+/g, ' '), name: name.trim() };
    const e: NameErrs = {};
    if (body.fullName.length < 3 || body.fullName.split(' ').length < 2) e.fullName = 'Digite o nome e o sobrenome.';
    if (body.name.length < 2) e.name = 'Diga como quer ser chamado.';
    setErr(e);
    if (e.fullName || e.name) return;
    setBusy(true);
    try {
      const r = await call(meApi.profile, { body });
      set((x) => ({
        profile: x.profile ? { ...x.profile, fullName: r.profile.fullName, name: r.profile.name } : x.profile,
        user: x.user ? { ...x.user, fullName: r.profile.fullName, name: r.profile.name } : x.user,
      }));
      onClose();
      toast('Nome atualizado.');
    } catch (x) {
      setBusy(false);
      const paths = issuePaths(x);
      if (paths.fullName || paths.name) setErr({ fullName: paths.fullName, name: paths.name });
      else toast(errorMessage(x));
    }
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    void save();
  };

  return (
    <Sheet kicker="Sua conta" title="Editar o seu nome" onClose={onClose}>
      <div class="stack mt12" style={{ '--gap': '12px' }}>
        <label class="field">
          <span>Nome completo</span>
          <input
            class="input"
            id="pf-fullname"
            autocomplete="name"
            placeholder="Seu nome e sobrenome"
            value={fullName}
            maxLength={LIMITS.fullNameMax}
            aria-invalid={err.fullName ? 'true' : undefined}
            aria-describedby={err.fullName ? 'pf-fullname-err' : 'pf-fullname-hint'}
            onInput={(e) => setFullName(e.currentTarget.value)}
            onKeyDown={onKey}
          />
        </label>
        {err.fullName ? (
          <FieldErr id="pf-fullname-err" msg={err.fullName} />
        ) : (
          <div class="xs" id="pf-fullname-hint" style={{ marginTop: '-6px' }}>
            Vai nos certificados das temporadas.
          </div>
        )}
        <label class="field">
          <span>Como você quer ser chamado</span>
          <input
            class="input"
            id="pf-name"
            autocomplete="nickname"
            placeholder="Ex.: Ana"
            value={name}
            maxLength={LIMITS.nameMax}
            aria-invalid={err.name ? 'true' : undefined}
            aria-describedby={err.name ? 'pf-name-err' : 'pf-name-hint'}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={onKey}
          />
        </label>
        {err.name ? (
          <FieldErr id="pf-name-err" msg={err.name} />
        ) : (
          <div class="xs" id="pf-name-hint" style={{ marginTop: '-6px' }}>
            É assim que o app e os personagens chamam você.
          </div>
        )}
        <Btn label={busy ? 'Salvando…' : 'Salvar'} kind="navy" cls="block" dis={busy} onClick={() => void save()} />
        <Btn label="Cancelar" kind="ghost" cls="block" onClick={onClose} />
      </div>
    </Sheet>
  );
}

type PassErrs = { current?: string; next?: string; confirm?: string };

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<PassErrs>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const e: PassErrs = {};
    if (!current) e.current = 'Digite a sua senha atual.';
    if (next.length < LIMITS.passwordMin)
      e.next = `A senha nova precisa de pelo menos ${LIMITS.passwordMin} caracteres.`;
    else if (next === current) e.next = 'A senha nova precisa ser diferente da atual.';
    if (!e.next && confirm !== next) e.confirm = 'As duas senhas não são iguais.';
    setErr(e);
    if (e.current || e.next || e.confirm) return;
    setBusy(true);
    try {
      await call(authApi.changePassword, { body: { currentPassword: current, newPassword: next } });
      onClose();
      toast('Senha trocada. As outras sessões abertas foram encerradas.', 4000);
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiError && x.code === 'invalid_credentials')
        setErr({ current: 'Senha atual incorreta. Confira e tente de novo.' });
      else {
        const paths = issuePaths(x);
        if (paths.newPassword) setErr({ next: paths.newPassword });
        else toast(errorMessage(x));
      }
    }
  };
  const toggle = () => setShow(!show);

  return (
    <Sheet kicker="Sua conta" title="Trocar a senha" onClose={onClose}>
      <div class="stack mt12" style={{ '--gap': '12px' }}>
        <p class="sm">Depois da troca, as outras sessões abertas (em outros aparelhos) são encerradas.</p>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside, rendered by a child component */}
        <label class="field">
          <span>Senha atual</span>
          <PassInput
            id="pf-pass-current"
            value={current}
            show={show}
            onShow={toggle}
            onInput={setCurrent}
            onEnterKey={() => void save()}
            autocomplete="current-password"
            placeholder="Digite a senha atual"
          />
        </label>
        <FieldErr id="pf-pass-current-err" msg={err.current} />
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside, rendered by a child component */}
        <label class="field">
          <span>Senha nova</span>
          <PassInput
            id="pf-pass-new"
            value={next}
            show={show}
            onShow={toggle}
            onInput={setNext}
            onEnterKey={() => void save()}
            autocomplete="new-password"
          />
        </label>
        <FieldErr id="pf-pass-new-err" msg={err.next} />
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside, rendered by a child component */}
        <label class="field">
          <span>Repita a senha nova</span>
          <PassInput
            id="pf-pass-confirm"
            value={confirm}
            show={show}
            onShow={toggle}
            onInput={setConfirm}
            onEnterKey={() => void save()}
            autocomplete="new-password"
            placeholder="Digite de novo"
          />
        </label>
        <FieldErr id="pf-pass-confirm-err" msg={err.confirm} />
        <Btn
          label={busy ? 'Salvando…' : 'Salvar a senha nova'}
          kind="navy"
          cls="block"
          dis={busy}
          onClick={() => void save()}
        />
        <Btn label="Cancelar" kind="ghost" cls="block" onClick={onClose} />
      </div>
    </Sheet>
  );
}

/** "Sua conta": the names and the password, each edited in a sheet. */
export function AccountEdit() {
  const [sheet, setSheet] = useState<'' | 'name' | 'password'>('');
  const close = () => setSheet('');
  const s = state.value;
  const fullName = s.profile?.fullName || s.user?.fullName || '';
  const name = s.profile?.name || s.user?.name || '';
  return (
    <Sec title="Sua conta" id="pf-conta-edit">
      <div>
        <ActionRow
          icon="pen"
          t="Editar o nome"
          sub={name && name !== fullName ? `${fullName} · chamado de ${name}` : fullName}
          onClick={() => setSheet('name')}
        />
        <ActionRow
          icon="lock"
          t="Trocar a senha"
          sub="Pede a senha atual e encerra as outras sessões."
          onClick={() => setSheet('password')}
        />
      </div>
      {sheet === 'name' && s.user ? <NameSheet onClose={close} /> : null}
      {sheet === 'password' && s.user ? <PasswordSheet onClose={close} /> : null}
    </Sec>
  );
}
