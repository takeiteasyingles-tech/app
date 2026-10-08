// Store load() outcomes and the shell's game card numbers.
import { emptyDaily, freshState, type Profile, type TieState } from '@tie/shared/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameView, load, loadError, state, status, today } from '../src/store';

const user = { id: 'u', email: 'a@b.c', name: 'Ana', fullName: 'Ana Souza' };

function signedIn(): TieState {
  return { ...freshState(), user, profile: { name: 'Ana', minutes: 10 } as Profile };
}

function reply(code: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
}

const envelope = (code: string, message: string) => ({ error: { code, message } });

describe('load()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    status.value = 'loading';
    state.value = freshState();
  });

  it('applies the server state', async () => {
    reply(200, signedIn());
    await load();
    expect(status.value).toBe('ready');
    expect(state.value.user?.id).toBe('u');
  });

  it('treats 401 unauthorized and session_expired as signed out', async () => {
    for (const code of ['unauthorized', 'session_expired']) {
      state.value = signedIn();
      reply(401, envelope(code, 'Entre de novo.'));
      await load();
      expect(status.value).toBe('ready');
      expect(state.value.user).toBeNull();
    }
  });

  it('keeps the session on 5xx and 429 and reports an error instead', async () => {
    for (const [http, code] of [
      [500, 'internal'],
      [503, 'internal'],
      [429, 'rate_limited'],
    ] as const) {
      state.value = signedIn();
      reply(http, envelope(code, `falhou ${http}`));
      await load();
      expect(status.value).toBe('error');
      expect(loadError.value).toBe(`falhou ${http}`);
      expect(state.value.user?.id).toBe('u');
    }
  });

  it('reports offline on a network failure', async () => {
    state.value = signedIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await load();
    expect(status.value).toBe('offline');
    expect(state.value.user?.id).toBe('u');
  });
});

describe('gameView', () => {
  afterEach(() => {
    state.value = freshState();
  });

  it('uses the shared levels and daily goal (C.side)', () => {
    const s = signedIn();
    s.game = { ...s.game, points: 340, streak: 4, daily: { [today(s.tz)]: { ...emptyDaily(), points: 20 } } };
    state.value = s;
    expect(gameView.value).toEqual({
      points: 340,
      streak: 4,
      level: { n: 3, name: 'Aprendiz', from: 250, next: 500, pct: 36 },
      goal: { target: 50, done: 20, pct: 40 },
    });
  });

  it('falls back to the default timezone for an unknown tz', () => {
    expect(today('Not/AZone', Date.parse('2026-09-15T02:30:00Z'))).toBe('2026-09-14');
  });
});
