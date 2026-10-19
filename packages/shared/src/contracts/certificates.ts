import { z } from 'zod';
import { CERT_CODE_RE, LIMITS } from '../constants';
import { IdParams, Page, PageQuery, QueryBool, Timestamp } from './common';
import { endpoint } from './http';

// Season certificates (spec 07, feature B). Issued automatically, in the same D1 batch as the
// season_test_results row, the first time a learner passes a season test. The PDF is rendered on
// first download and cached in R2 (certificateR2Key). Anyone can check a code on the public
// verification page (`#/certificado/<code>`), which shows name, season and date only.

/** Code as typed by a person: trimmed and upper-cased before matching CERT_CODE_RE. */
export const CertCode = z.string().trim().toUpperCase().pipe(z.string().regex(CERT_CODE_RE, 'Código inválido.'));

export const CertCodeParams = z.object({ code: CertCode });

export const CertificateSummary = z.object({
  id: z.string(),
  code: z.string(),
  seasonN: z.int().positive(),
  /** Frozen at issue time. */
  seasonTitle: z.string(),
  /** Frozen at issue time (profiles.full_name then). */
  fullName: z.string(),
  scorePct: z.int().min(0).max(100),
  issuedAt: Timestamp,
  revoked: z.boolean(),
  /** Absolute public verification URL (`${APP_ORIGIN}/#/certificado/<code>`). */
  verifyUrl: z.string(),
});
export type CertificateSummary = z.infer<typeof CertificateSummary>;

/** Public lookup. Unknown codes answer 404 not_found; a revoked certificate answers valid: false. */
export const CertificateVerifyRes = z.object({
  valid: z.boolean(),
  code: z.string(),
  name: z.string(),
  seasonN: z.int().positive(),
  seasonTitle: z.string(),
  issuedAt: Timestamp,
  revokedAt: Timestamp.nullable(),
});
export type CertificateVerifyRes = z.infer<typeof CertificateVerifyRes>;

export const certificatesApi = {
  /** The signed-in learner's certificates, oldest first (revoked ones included, flagged). */
  list: endpoint({
    method: 'GET',
    path: '/api/certificates',
    access: 'user',
    res: z.object({ items: z.array(CertificateSummary) }),
  }),
  /** application/pdf, Content-Disposition attachment. 404 for someone else's id; 403 forbidden once revoked. */
  pdf: endpoint({
    method: 'GET',
    path: '/api/certificates/:id/pdf',
    access: 'owner',
    params: IdParams,
    res: 'binary',
    rateLimit: 'RL_API',
  }),
  verify: endpoint({
    method: 'GET',
    path: '/api/certificates/verify/:code',
    access: 'public',
    params: CertCodeParams,
    res: CertificateVerifyRes,
    rateLimit: 'RL_API',
  }),
} as const;

// ---------- Admin ----------

export const AdminCertificateRow = z.object({
  id: z.string(),
  code: z.string(),
  userId: z.string(),
  userEmail: z.string().nullable(),
  fullName: z.string(),
  seasonN: z.int().positive(),
  seasonTitle: z.string(),
  scorePct: z.int().min(0).max(100),
  issuedAt: Timestamp,
  revokedAt: Timestamp.nullable(),
  revokedBy: z.string().nullable(),
  revokeReason: z.string().nullable(),
});
export type AdminCertificateRow = z.infer<typeof AdminCertificateRow>;

/** Newest first. `q` matches the code, the frozen name or the learner's e-mail. */
export const CertificatesQuery = PageQuery.extend({
  season: z.coerce.number().int().positive().optional(),
  userId: z.string().min(1).max(120).optional(),
  revoked: QueryBool.optional(),
  q: z.string().trim().max(200).optional(),
});
export type CertificatesQuery = z.infer<typeof CertificatesQuery>;

/** revoked: false reinstates. The reason is required either way (audit). */
export const RevokeCertificateBody = z.strictObject({
  revoked: z.boolean(),
  reason: z.string().trim().min(1).max(LIMITS.freeTextMax),
});
export type RevokeCertificateBody = z.infer<typeof RevokeCertificateBody>;

export const adminCertificatesApi = {
  list: endpoint({
    method: 'GET',
    path: '/admin-api/certificates',
    access: 'staff',
    perm: 'users.read',
    query: CertificatesQuery,
    res: Page(AdminCertificateRow),
  }),
  /** Same PDF the learner downloads (rendered and cached on first request). */
  pdf: endpoint({
    method: 'GET',
    path: '/admin-api/certificates/:id/pdf',
    access: 'staff',
    perm: 'users.read',
    params: IdParams,
    res: 'binary',
  }),
  revoke: endpoint({
    method: 'POST',
    path: '/admin-api/certificates/:id/revoke',
    access: 'staff',
    perm: 'certificates.revoke',
    params: IdParams,
    body: RevokeCertificateBody,
    res: z.object({ item: AdminCertificateRow }),
  }),
} as const;
