// Perfil → Certificados (spec 07, feature B; PROD): the learner's season certificates with the PDF
// download and the public verification page, or how to earn the first one.
import type { Catalog } from '@tie/shared/content/schema';
import type { TieState } from '@tie/shared/state';
import { Sec } from '../cadastro/ui';
import { CertificateCard } from '../temporada/CertificateCard';

export function Certificates({ s, c }: { s: TieState; c: Catalog }) {
  const list = s.certificates;
  const n = c.seasons[0]?.n ?? 1;
  return (
    <Sec
      title="Certificados"
      id="pf-certificados"
      sub={list.length ? 'Um por temporada concluída. Qualquer pessoa confere a autenticidade pelo código.' : undefined}
    >
      {list.length ? (
        <div class="stack" style={{ '--gap': '10px' }}>
          {list.map((x) => (
            <CertificateCard
              key={x.id}
              compact
              cert={{ ...x, seasonTitle: c.seasons.find((t) => t.n === x.seasonN)?.title }}
            />
          ))}
        </div>
      ) : (
        <div class="listrow">
          <div class="grow">
            <div class="h3">Nenhum certificado ainda</div>
            <div class="sm">Conclua os episódios da temporada e passe no teste para ganhar o seu.</div>
          </div>
          <a class="btn light compact" href={`#/temporada/${n}/teste`}>
            Ver o teste
          </a>
        </div>
      )}
    </Sec>
  );
}
