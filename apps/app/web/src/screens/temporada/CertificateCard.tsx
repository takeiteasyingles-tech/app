// A season certificate as a card (spec 07, feature B): season, name, date, code, the PDF download and
// the public verification page. Used by the season test result and by Perfil → Certificados.
import { CERT_VERIFY_ROUTE } from '@tie/shared/constants';
import { certificatesApi } from '@tie/shared/contracts/certificates';
import { buildPath } from '@tie/shared/contracts/http';
import { Icon } from '@tie/ui';

export interface CertLike {
  id: string;
  code: string;
  seasonN: number;
  seasonTitle?: string;
  fullName?: string;
  scorePct: number;
  issuedAt: number;
  revoked: boolean;
}

/** "18 de outubro de 2026". */
export const datePt = (at: number): string =>
  new Date(at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Same-origin download (the session cookie goes with it); the server sends Content-Disposition. */
export const pdfHref = (id: string): string => buildPath(certificatesApi.pdf.path, { id });

export function CertificateCard({ cert, compact = false }: { cert: CertLike; compact?: boolean }) {
  const season = `Temporada ${cert.seasonN}${cert.seasonTitle ? ` · ${cert.seasonTitle}` : ''}`;
  return (
    <div
      class={compact ? 'stack' : 'card stack'}
      style={
        compact
          ? { '--gap': '12px', paddingTop: '12px', borderTop: '1.5px solid var(--line)' }
          : { '--gap': '12px', borderColor: cert.revoked ? 'var(--line2)' : 'var(--gold)' }
      }
    >
      <div class="row top" style={{ '--gap': '12px' }}>
        <span
          aria-hidden="true"
          style={{
            width: '46px',
            height: '46px',
            flex: 'none',
            borderRadius: '14px',
            background: cert.revoked ? 'var(--line)' : 'var(--goldT)',
            color: cert.revoked ? 'var(--muted)' : '#B88A1E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="trophy" size={24} />
        </span>
        <div class="grow" style={{ minWidth: '0' }}>
          <div class="lbl">{compact ? season : 'Certificado de conclusão'}</div>
          <div class="h3 mt4">{compact ? `${cert.scorePct}% de acertos` : season}</div>
          <div class="sm mt4">
            {`${compact ? '' : `${cert.scorePct}% de acertos · `}Emitido em ${datePt(cert.issuedAt)} · `}
            <span style={{ whiteSpace: 'nowrap', fontWeight: '800', color: 'var(--navy)' }}>{cert.code}</span>
          </div>
        </div>
        {cert.revoked ? <span class="pill">Revogado</span> : null}
      </div>
      {cert.revoked ? (
        <p class="sm">
          Este certificado foi revogado e não pode mais ser baixado. Fale com o suporte se for um engano.
        </p>
      ) : (
        <div class="row wrapx" style={{ '--gap': '8px' }}>
          <a class="btn navy" href={pdfHref(cert.id)} download={`certificado-${cert.code}.pdf`}>
            <Icon name="download" size={18} />
            <span>Baixar certificado (PDF)</span>
          </a>
          <a class="btn ghost" href={`#/${CERT_VERIFY_ROUTE}/${cert.code}`}>
            Página de verificação
          </a>
        </div>
      )}
    </div>
  );
}
