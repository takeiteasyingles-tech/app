// Slice S7 public surface for other slices and for integration (I1):
// - quotaFactory: pass as createApp({services: {quota: quotaFactory}}) in worker/src/index.ts.
// - verifyAttempt / attemptMatches: S2 (/api/progress/mic) and S6 (/api/extras/:id/dub) can require
//   a valid attempt token before accepting an 'ia' score.
export {
  ATTEMPT_CLAIMED,
  ATTEMPT_TTL_MS,
  type AttemptClaims,
  attemptMatches,
  attemptSig,
  claimAttempt,
  signAttempt,
  verifyAttempt,
} from './attempt';
export { aiEnabled, invalidateModels, loadModels, type Models } from './models';
export { type AiQuotaService, createQuotaService, quotaFactory, quotaOf, reserveOrThrow } from './quota';
