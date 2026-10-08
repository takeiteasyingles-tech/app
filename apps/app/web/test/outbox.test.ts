// Service worker protocol (spec 06 "Service worker cache" / "Offline outbox"): which caches logout
// clears, what is never cached, and what a replayed write's status does to the queue.
import { isOutboxPath } from '@tie/shared/constants';
import { describe, expect, it } from 'vitest';
import { CACHE_NAMES, isUncacheableMePath, replayOutcome, USER_CACHES } from '../sw/protocol';

describe('service worker protocol', () => {
  it('logout clears every runtime cache (state, manifest, plan-gated content, premium media)', () => {
    expect([...USER_CACHES].sort()).toEqual(Object.values(CACHE_NAMES).sort());
    expect(USER_CACHES).toContain(CACHE_NAMES.media);
    expect(USER_CACHES).toContain(CACHE_NAMES.content);
  });

  it('never caches the LGPD export', () => {
    expect(isUncacheableMePath('/api/me/export')).toBe(true);
    expect(isUncacheableMePath('/api/me/state')).toBe(false);
  });

  it('keeps writes on 401 until a login, retries 5xx/429, drops other 4xx', () => {
    expect(replayOutcome(200)).toBe('sent');
    expect(replayOutcome(201)).toBe('sent');
    expect(replayOutcome(401)).toBe('hold');
    expect(replayOutcome(503)).toBe('retry');
    expect(replayOutcome(429)).toBe('retry');
    for (const s of [400, 403, 404, 409, 422]) expect(replayOutcome(s), String(s)).toBe('drop');
  });

  it('queues only the replay-safe writes', () => {
    for (const p of ['/api/progress/advance', '/api/srs/cards/abc/grade', '/api/extras/x/dub', '/api/me/settings']) {
      expect(isOutboxPath(p), p).toBe(true);
    }
    for (const p of ['/api/auth/login', '/api/tutor', '/api/me/photo', '/api/me', '/api/reports', '/api/me/export']) {
      expect(isOutboxPath(p), p).toBe(false);
    }
  });
});
