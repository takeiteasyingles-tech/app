// Feature B (spec 07): season test questions (CRUD, AI draft, review, publish) and certificates
// (list, PDF, revoke). STUB: every endpoint is guarded and answers 404 until feature B lands.
import { adminCertificatesApi, adminSeasonTestApi } from '@tie/shared';
import { stubRoutes } from '../lib/stub';

export default stubRoutes({ adminSeasonTestApi, adminCertificatesApi });
