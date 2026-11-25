import { IDEMPOTENCY_HEADER, isOutboxPath, OUTBOX_USER_HEADER } from '@tie/shared/constants';
import { freshState } from '@tie/shared/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitStepFeedback } from '../src/store/feedback';
import { state } from '../src/store/state';

const body = { episodeNum: 1, step: 4, stars: 4, hadDifficulty: false, improvement: 'Aumentar a legenda' };

describe('step feedback submission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    state.value = freshState();
  });

  it('sends a stable transition id and binds the offline queue to the signed-in learner', async () => {
    state.value = { ...freshState(), user: { id: 'u', email: 'a@b.c', name: 'Ana', fullName: 'Ana' } };
    const fetch = vi.fn(async (_url: string, _opts: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    expect(await submitStepFeedback('transition-1', body)).toBe('sent');
    const request = fetch.mock.calls[0];
    if (!request) throw new Error('Expected the feedback request');
    const [url, opts] = request;
    expect(url).toBe('/api/feedback/steps/transition-1');
    expect(isOutboxPath(url)).toBe(true);
    const headers = new Headers(opts.headers);
    expect(headers.get(IDEMPOTENCY_HEADER)).toBe('transition-1');
    expect(headers.get(OUTBOX_USER_HEADER)).toBe('u');
    expect(JSON.parse(String(opts.body))).toEqual(body);
  });

  it('allows continuation when the service worker has stored the feedback offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { queued: true },
          {
            status: 202,
            headers: { 'X-Tie-Outbox': 'queued' },
          },
        ),
      ),
    );
    expect(await submitStepFeedback('transition-2', body)).toBe('queued');
  });

  it('rejects failures so the player keeps the current stage and preserves the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: { code: 'internal', message: 'Tente de novo.' } }, { status: 500 })),
    );
    await expect(submitStepFeedback('transition-3', body)).rejects.toThrow('Tente de novo.');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    await expect(submitStepFeedback('transition-3', body)).rejects.toThrow('Sem conexão');
  });
});
