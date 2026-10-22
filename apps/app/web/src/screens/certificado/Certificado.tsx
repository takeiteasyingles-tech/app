// Public certificate check (#/certificado/<code>), spec 07 feature B (PROD, no prototype counterpart).
// Reachable signed out (guard.ts lets it through): anyone holding a certificate's code or its verify URL
// sees whether it is valid, with the name, the season and the issue date (nothing else is public).
import { CERT_CODE_RE, CERT_VERIFY_ROUTE } from '@tie/shared/constants';
import { type CertificateVerifyRes, certificatesApi } from '@tie/shared/contracts/certificates';
import { ApiError } from '@tie/shared/errors';
import { Btn, Icon, Logo } from '@tie/ui';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { type ScreenProps, useChrome } from '../../frame';
import { go } from '../../router';
import { state } from '../../store';
import { datePt } from '../temporada/CertificateCard';

type Check =
  | { kind: 'loading' }
  | { kind: 'ok'; res: CertificateVerifyRes }
  | { kind: 'missing' }
  | { kind: 'bad' }
  | { kind: 'error'; msg: string };

const normCode = (s: string): string => s.trim().toUpperCase();

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      class="row"
      style={{
        '--gap': '8px',
        alignSelf: 'flex-start',
        padding: '6px 14px 6px 8px',
        borderRadius: '999px',
        fontWeight: '800',
        background: ok ? 'var(--greenT)' : 'var(--redT)',
        color: ok ? 'var(--green)' : '#A23B33',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: ok ? 'var(--green)' : 'var(--red)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={ok ? 'check' : 'close'} size={14} />
      </span>
      {label}
    </span>
  );
}

export default function Certificado({ params }: ScreenProps) {
  const code = normCode(params.code ?? '');
  useChrome({ title: 'Verificar certificado' });
  const [check, setCheck] = useState<Check>({ kind: 'loading' });
  const [typed, setTyped] = useState(code);

  useEffect(() => {
    setTyped(code);
    if (!CERT_CODE_RE.test(code)) {
      setCheck({ kind: 'bad' });
      return;
    }
    let live = true;
    setCheck({ kind: 'loading' });
    call(certificatesApi.verify, { params: { code } })
      .then((res) => live && setCheck({ kind: 'ok', res }))
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiError && err.code === 'not_found') setCheck({ kind: 'missing' });
        else setCheck({ kind: 'error', msg: errorMessage(err) });
      });
    return () => {
      live = false;
    };
  }, [code]);

  const submit = (e: Event) => {
    e.preventDefault();
    const c = normCode(typed);
    if (c) go(`${CERT_VERIFY_ROUTE}/${c}`);
  };
  const signedIn = !!state.value.user;

  let body = null;
  if (check.kind === 'loading') body = <p class="p">Conferindo o certificado…</p>;
  else if (check.kind === 'ok') {
    const r = check.res;
    body = (
      <>
        <Badge ok={r.valid} label={r.valid ? 'Certificado válido' : 'Certificado revogado'} />
        <div>
          <div class="lbl">Certificado de conclusão</div>
          <h1 class="h1 mt8" style={{ overflowWrap: 'anywhere' }}>
            {r.name}
          </h1>
        </div>
        <p class="p-read">{`concluiu a Temporada ${r.seasonN} · ${r.seasonTitle} do curso de inglês Take It Easy.`}</p>
        <div class="row wrapx" style={{ '--gap': '10px 28px' }}>
          <div>
            <div class="lbl">Emitido em</div>
            <div class="h3 mt4">{datePt(r.issuedAt)}</div>
          </div>
          <div>
            <div class="lbl">Código</div>
            <div class="h3 mt4">{r.code}</div>
          </div>
          {r.revokedAt ? (
            <div>
              <div class="lbl">Revogado em</div>
              <div class="h3 mt4">{datePt(r.revokedAt)}</div>
            </div>
          ) : null}
        </div>
        {r.valid ? null : (
          <p class="sm">Este certificado foi cancelado pela equipe do Take It Easy e não vale mais como comprovante.</p>
        )}
      </>
    );
  } else {
    const msg =
      check.kind === 'missing'
        ? `Não encontramos um certificado com o código ${code}.`
        : check.kind === 'bad'
          ? 'Este código não tem o formato de um certificado (TIE-XXXX-XXXX).'
          : check.msg;
    body = (
      <>
        <Badge ok={false} label={check.kind === 'error' ? 'Não deu para conferir' : 'Código não encontrado'} />
        <p class="p">{msg}</p>
      </>
    );
  }

  return (
    <div class="scroll">
      <div class="wrap stack" style={{ '--wrap': '720px', '--gap': '18px', paddingTop: '28px', paddingBottom: '40px' }}>
        <a
          href={signedIn ? '#/inicio' : '#/entrar'}
          aria-label="Take It Easy"
          style={{ alignSelf: 'flex-start', color: 'var(--navy)' }}
        >
          <Logo size={22} desc />
        </a>
        <div class="card stack" style={{ '--gap': '16px', padding: '24px' }} aria-live="polite">
          {body}
        </div>
        <form class="card stack" style={{ '--gap': '10px' }} onSubmit={submit}>
          <label class="lbl" for="cert-code">
            Conferir outro código
          </label>
          <div class="row" style={{ '--gap': '8px' }}>
            <input
              id="cert-code"
              class="input grow"
              placeholder="TIE-XXXX-XXXX"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              maxLength={20}
              value={typed}
              onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)}
            />
            <Btn label="Conferir" kind="navy" type="submit" />
          </div>
        </form>
        <p class="sm">
          A página mostra apenas o nome, a temporada e a data de emissão. O certificado é emitido automaticamente quando
          o aluno é aprovado no teste da temporada.
        </p>
        <div>
          <Btn
            label={signedIn ? 'Voltar ao início' : 'Conhecer o Take It Easy'}
            kind="ghost"
            go={signedIn ? 'inicio' : 'entrar'}
          />
        </div>
      </div>
    </div>
  );
}
