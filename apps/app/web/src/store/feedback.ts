// NPS per episode (spec 07, feature C): the learner's 1-5 star rating of an episode, with an optional
// comment, from the Concluído screen. Optimistic like every store action: state.feedback[ep] changes
// at once, the server's answer settles it, a refusal rolls it back (and toasts its message). The path
// is in OUTBOX_PATHS, so `send` gives it an Idempotency-Key and the service worker queues it offline.
import { feedbackApi } from '@tie/shared/contracts/feedback';
import type { EpisodeFeedbackState } from '@tie/shared/state';
import { send } from './actions';
import { state } from './state';

/** 'sent' (the server stored it), 'queued' (offline: kept locally, sent later) or 'failed' (rolled back). */
export type RateResult = 'sent' | 'queued' | 'failed';

/** PUT /api/feedback/episodes/:n. `comment` is the whole comment (null or blank clears it). */
export async function rateEpisode(ep: number, stars: number, comment: string | null): Promise<RateResult> {
  const key = String(ep);
  const text = comment?.trim() ? comment.trim() : null;
  const value: EpisodeFeedbackState = { stars, comment: text };
  const res = await send(
    feedbackApi.episode,
    { params: { n: ep }, body: { stars, comment: text } },
    {
      optimistic: (s) => ({ feedback: { ...s.feedback, [key]: value } }),
      apply: (r, s) => ({ feedback: { ...s.feedback, [String(r.episode)]: r.feedback } }),
    },
  );
  if (res) return 'sent';
  // send() resolves null both when the write was queued (the optimistic value stays) and when it
  // failed (the value was rolled back and the error toasted).
  return state.value.feedback[key] === value ? 'queued' : 'failed';
}
