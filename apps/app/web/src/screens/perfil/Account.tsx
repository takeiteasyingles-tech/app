// PROD replacement for the prototype's "Apagar dados do protótipo" (wipe): "Zerar progresso" and
// "Excluir minha conta" (LGPD), each confirmed in a sheet (the deletion also asks for the password),
// plus "Baixar meus dados" (GET /api/me/export).
import { meApi } from '@tie/shared/contracts/me';
import { ApiError } from '@tie/shared/errors';
import { activator, Btn, Icon, toast } from '@tie/ui';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { clearOfflineData, refreshState } from '../../core/outbox';
import { stop as stopSpeech } from '../../core/speech';
import { Overlay } from '../../frame';
import { go } from '../../router';
import { signedOut, state } from '../../store';
import { todayIso } from '../cadastro/onb';
import { PassInput } from '../entrada/Entrar';
import { SHEET_FOCUS, useModal } from '../entrada/legal';

function Sheet({
  title,
  kicker,
  onClose,
  children,
}: {
  title: string;
  kicker: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useModal(onClose);
  return (
    <Overlay>
      <div class="overlay">
        <div class="scrim" onClick={onClose} aria-hidden="true" />
        <div
          class="sheet"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          ref={ref}
          style={SHEET_FOCUS}
        >
          <div class="grab" />
          <div class="row between top">
            <div>
              <div class="lbl">{kicker}</div>
              <div class="h2 mt4">{title}</div>
            </div>
            <button type="button" class="iconbtn" aria-label="Fechar" onClick={activator(undefined, onClose)}>
              <Icon name="close" size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </Overlay>
  );
}

function ResetSheet({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await call(meApi.resetProgress, { body: { confirm: true } });
      await refreshState();
      onClose();
      toast('Progresso zerado. Bom recomeço!');
    } catch (err) {
      toast(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Sheet kicker="Seus dados" title="Zerar o seu progresso?" onClose={onClose}>
      <div class="stack mt12" style={{ '--gap': '12px' }}>
        <p class="p">
          Episódios, cartões da Revisão, pontos, medalhas, Extras e conversas no Mic voltam do zero. A sua conta, o seu
          perfil e as preferências continuam como estão.
        </p>
        <Btn
          label={busy ? 'Zerando…' : 'Zerar o progresso'}
          kind="navy"
          cls="block"
          dis={busy}
          onClick={() => void confirm()}
        />
        <Btn label="Cancelar" kind="ghost" cls="block" onClick={onClose} />
      </div>
    </Sheet>
  );
}

function DeleteSheet({ onClose }: { onClose: () => void }) {
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy) return;
    if (!pass) {
      setErr('Digite a sua senha para confirmar.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await call(meApi.deleteAccount, { body: { password: pass, confirm: true } });
      stopSpeech();
      await clearOfflineData().catch(() => {});
      signedOut();
      go('entrar');
      toast('Sua conta foi excluída. Obrigado por estudar com a gente.', 4000);
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiError && x.code === 'invalid_credentials')
        setErr('Senha incorreta. Confira e tente de novo.');
      else toast(errorMessage(x));
    }
  };
  return (
    <Sheet kicker="Seus dados" title="Excluir a sua conta?" onClose={onClose}>
      <div class="stack mt12" style={{ '--gap': '12px' }}>
        <p class="p">
          Isso apaga para sempre a sua conta, o perfil, a foto, o progresso e as conversas no Mic. Não dá para desfazer.
        </p>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside, rendered by a child component */}
        <label class="field">
          <span>Senha</span>
          <PassInput
            id="pf-del-pass"
            value={pass}
            show={show}
            onShow={() => setShow(!show)}
            onInput={setPass}
            onEnterKey={() => void confirm()}
            autocomplete="current-password"
            placeholder="Digite a sua senha"
          />
        </label>
        {err ? (
          <div class="field">
            <span class="err">{err}</span>
          </div>
        ) : null}
        <Btn
          label={busy ? 'Excluindo…' : 'Excluir minha conta'}
          kind="navy"
          cls="block"
          dis={busy}
          onClick={() => void confirm()}
        />
        <Btn label="Cancelar" kind="ghost" cls="block" onClick={onClose} />
      </div>
    </Sheet>
  );
}

/** LGPD export: the JSON the server builds, saved as a file. */
async function exportData(): Promise<void> {
  try {
    const data = await call(meApi.export);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `takeiteasy-dados-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('Seus dados foram baixados.');
  } catch (err) {
    toast(errorMessage(err));
  }
}

/** Text colour of the destructive action: a darker --red, readable on white (about 6:1). */
const DANGER = '#B3362C';

/** One action of the "Seus dados" card: a full-width row, named by its title. */
function ActionRow({
  icon,
  t,
  sub,
  danger = false,
  onClick,
}: {
  icon: string;
  t: string;
  sub: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="listrow"
      aria-label={t}
      style={{ width: '100%', textAlign: 'left' }}
      onClick={activator(undefined, onClick)}
    >
      <span
        class="iconbtn"
        aria-hidden="true"
        style={{ border: '0', background: danger ? 'var(--redT)' : 'var(--cream)', color: danger ? DANGER : undefined }}
      >
        <Icon name={icon} size={18} />
      </span>
      <span class="grow">
        <span class="h3" style={{ display: 'block', color: danger ? DANGER : undefined }}>
          {t}
        </span>
        <span class="sm" style={{ display: 'block' }}>
          {sub}
        </span>
      </span>
      <Icon name="next" size={18} />
    </button>
  );
}

/** Desktop: one action as a tile of the "Conta e dados" row; the destructive one tinted red. */
function ActionTile({
  icon,
  t,
  sub,
  danger = false,
  onClick,
}: {
  icon: string;
  t: string;
  sub: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="card row"
      aria-label={t}
      style={{
        '--gap': '12px',
        alignItems: 'flex-start',
        padding: '14px',
        textAlign: 'left',
        background: danger ? DANGER_BG : '#fff',
        borderColor: danger ? DANGER_LINE : undefined,
      }}
      onClick={activator(undefined, onClick)}
    >
      <span
        class="iconbtn"
        aria-hidden="true"
        style={{ border: '0', background: danger ? '#fff' : 'var(--cream)', color: danger ? DANGER : undefined }}
      >
        <Icon name={icon} size={18} />
      </span>
      <span class="grow">
        <span class="h3" style={{ display: 'block', color: danger ? DANGER : undefined }}>
          {t}
        </span>
        <span class="sm" style={{ display: 'block' }}>
          {sub}
        </span>
      </span>
    </button>
  );
}

/** The danger zone: a faint red fill and edge, set apart from the harmless actions. */
const DANGER_BG = '#FFF7F6';
const DANGER_LINE = '#F2C4BE';

const EXPORT = { icon: 'download', t: 'Baixar meus dados', sub: 'Uma cópia de tudo o que o app guarda sobre você.' };
const RESET = { icon: 'repeat', t: 'Zerar progresso', sub: 'Recomeça o curso. A conta e o perfil continuam.' };
const DELETE = { icon: 'close', t: 'Excluir minha conta', sub: 'Apaga a conta e todos os dados, para sempre.' };
const LOGOUT = { icon: 'logout', t: 'Sair', sub: 'Encerra a sessão neste aparelho. Seus dados ficam salvos.' };

/**
 * The closing block. Phone: "Seus dados" (export, reset), then the deletion in its own red-edged card,
 * then Sair. Desktop: one full-width card with the e-mail in use and four tiles: Sair, the export, the
 * reset and the deletion (tinted red).
 */
export function AccountActions({
  onLogout,
  desk = false,
  email = '',
}: {
  onLogout: () => void;
  desk?: boolean;
  email?: string;
}) {
  const [sheet, setSheet] = useState<'' | 'reset' | 'delete'>('');
  const close = () => setSheet('');
  const sheets = (
    <>
      {sheet === 'reset' && state.value.user ? <ResetSheet onClose={close} /> : null}
      {sheet === 'delete' && state.value.user ? <DeleteSheet onClose={close} /> : null}
    </>
  );
  if (desk)
    return (
      <>
        <div class="card stack" id="pf-conta" style={{ '--gap': '14px' }}>
          <div style={{ minWidth: '0' }}>
            <div class="lbl">Conta e dados</div>
            {email ? (
              <div class="sm mt4" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Conectado como <b style={{ color: 'var(--navy)' }}>{email}</b>
              </div>
            ) : null}
          </div>
          {/* Sair is one of the row's tiles (first: the everyday action), the deletion last and red. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px' }}>
            <ActionTile {...LOGOUT} onClick={onLogout} />
            <ActionTile {...EXPORT} onClick={() => void exportData()} />
            <ActionTile {...RESET} onClick={() => setSheet('reset')} />
            <ActionTile {...DELETE} danger onClick={() => setSheet('delete')} />
          </div>
        </div>
        {sheets}
      </>
    );
  return (
    <>
      <div class="card stack" style={{ '--gap': '4px' }}>
        <div class="lbl">Seus dados</div>
        <div>
          <ActionRow {...EXPORT} onClick={() => void exportData()} />
          <ActionRow {...RESET} onClick={() => setSheet('reset')} />
        </div>
      </div>
      <div class="card stack" style={{ '--gap': '4px', background: DANGER_BG, borderColor: DANGER_LINE }}>
        <div class="lbl" style={{ color: DANGER }}>
          Zona de risco
        </div>
        <div>
          <ActionRow {...DELETE} danger onClick={() => setSheet('delete')} />
        </div>
      </div>
      <Btn label="Sair" kind="ghost" icon="logout" cls="block" onClick={onLogout} />
      {sheets}
    </>
  );
}
