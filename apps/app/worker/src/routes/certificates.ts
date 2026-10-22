// Season certificates (spec 07, feature B): the learner's list and PDF download, and the public
// verification lookup behind #/certificado/<code> (works signed out, rate limited per IP).
import { CertCodeParams, type CertificateVerifyRes, certificatesApi, IdParams } from '@tie/shared';
import { type AppEnv, fail, one, rateLimit, requireUser, sessionOf, vParam } from '@tie/worker-core';
import { certificatePdf, loadCertificate, pdfResponse } from '@tie/worker-core/pdf/certificate';
import { Hono } from 'hono';
import { myCertificates } from '../learning/seasonTest';
import { appOrigin } from './seasons';

const routes = new Hono<AppEnv>();

routes.get(certificatesApi.list.path, requireUser(), async (c) =>
  c.json({ items: await myCertificates(c.env.DB, sessionOf(c).userId, appOrigin(c)) }),
);

routes.get(certificatesApi.verify.path, rateLimit('RL_API'), vParam(CertCodeParams), async (c) => {
  const row = await one<{
    code: string;
    full_name_snapshot: string;
    season_n: number;
    season_title_snapshot: string;
    issued_at: number;
    revoked_at: number | null;
  }>(
    c.env.DB,
    `SELECT code, full_name_snapshot, season_n, season_title_snapshot, issued_at, revoked_at
     FROM certificates WHERE code = ?`,
    c.req.valid('param').code,
  );
  if (!row) throw fail('not_found', 'Não encontramos um certificado com este código.');
  return c.json({
    valid: row.revoked_at == null,
    code: row.code,
    name: row.full_name_snapshot,
    seasonN: row.season_n,
    seasonTitle: row.season_title_snapshot,
    issuedAt: row.issued_at,
    revokedAt: row.revoked_at,
  } satisfies CertificateVerifyRes);
});

routes.get(certificatesApi.pdf.path, requireUser(), rateLimit('RL_API'), vParam(IdParams), async (c) => {
  const row = await loadCertificate(c.env.DB, c.req.valid('param').id);
  // Someone else's certificate reads as unknown.
  if (!row || row.user_id !== sessionOf(c).userId) throw fail('not_found');
  if (row.revoked_at != null) throw fail('forbidden', 'Este certificado foi revogado.');
  return pdfResponse(await certificatePdf(c.env, row, appOrigin(c)), row.code);
});

export default routes;
