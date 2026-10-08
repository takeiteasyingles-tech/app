// Store actions: optimistic write → server answer (award mirrored) / rollback / offline outbox.
import { freshState, type Profile, type TieState } from '@tie/shared/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceStep, answerExercise, gradeCardAction, markStep, state } from '../src/store';

const user = { id: 'u', email: 'a@b.c', name: 'Ana', fullName: 'Ana Souza' };
const signedIn = (): TieState => ({ ...freshState(), user, profile: { name: 'Ana', minutes: 10 } as Profile });

const award = {
  awarded: true,
  kind: 'step',
  points: 10,
  total: 25,
  dayPoints: 25,
  levelUp: null,
  goalHit: false,
  newBadges: [],
  missionsDone: ['step'],
};

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

function server(reply: Reply | ((req: Request) => Reply)) {
  const seen: Request[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
    const req = new Request(`http://app.test${input}`, init);
    seen.push(req);
    const r = typeof reply === 'function' ? reply(req) : reply;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json', ...r.headers },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return seen;
}

describe('store actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    state.value = freshState();
  });

  it('applies the optimistic change, then mirrors the award', async () => {
    state.value = signedIn();
    const seen = server({ status: 200, body: { prog: 2, cardsAdded: 0, award } });
    const p = advanceStep(1, 2);
    expect(state.value.prog['1']).toBe(2);
    const res = await p;
    expect(res?.prog).toBe(2);
    expect(state.value.game.points).toBe(25);
    expect(seen[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    // The account the write is for: a replay after someone else signs in is refused by the server.
    expect(seen[0]?.headers.get('X-Tie-User')).toBe('u');
    expect(await seen[0]?.json()).toEqual({ ep: 1, step: 2 });
  });

  it('rolls back on a gated advance and resolves null', async () => {
    state.value = signedIn();
    server({ status: 409, body: { error: { code: 'gated', message: 'Ouça o áudio até o fim.' } } });
    expect(await advanceStep(1, 3)).toBeNull();
    expect(state.value.prog['1']).toBeUndefined();
    expect(state.value.game.points).toBe(0);
  });

  it('keeps the local change when the service worker queued the write offline', async () => {
    state.value = signedIn();
    server({ status: 202, body: { queued: true }, headers: { 'X-Tie-Outbox': 'queued' } });
    expect(await markStep(1, 1)).toBeNull();
    expect(state.value.stepOk['1-1']).toBe(true);
  });

  it('settles the exercise choice from the server', async () => {
    state.value = signedIn();
    server({
      status: 200,
      body: { itemId: 'e1-ex0-i0', choice: 2, correct: false, answer: 1, fix: null, award: null },
    });
    const r = await answerExercise('e1-ex0-i0', 2);
    expect(r?.correct).toBe(false);
    expect(state.value.exAns['e1-ex0-i0']).toBe(2);
  });

  it('reschedules a graded card at once and takes the server card', async () => {
    const s = signedIn();
    s.deck = [{ id: 'c1', en: 'Hi', pt: 'Oi', scene: 's', note: '', at: 0, reps: 0 }];
    state.value = s;
    const card = { ...s.deck[0], at: 123, reps: 1 };
    server({
      status: 200,
      body: { card, due: 0, award: { ...award, kind: 'card', points: 2, total: 2, dayPoints: 2, missionsDone: [] } },
    });
    const p = gradeCardAction('c1', 2);
    expect(state.value.deck[0]?.reps).toBe(1);
    expect(state.value.deck[0]?.at).toBeGreaterThan(Date.now());
    await p;
    expect(state.value.deck[0]?.at).toBe(123);
    expect(state.value.game.points).toBe(2);
  });
});
