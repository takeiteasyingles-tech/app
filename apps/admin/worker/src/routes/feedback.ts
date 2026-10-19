// Feature C (spec 07): NPS ratings (list, summary) and learning statistics (one learner, funnel).
// STUB: every endpoint is guarded and answers 404 until feature C lands.
import { adminFeedbackApi, adminStatsApi } from '@tie/shared';
import { stubRoutes } from '../lib/stub';

export default stubRoutes({ adminFeedbackApi, adminStatsApi });
