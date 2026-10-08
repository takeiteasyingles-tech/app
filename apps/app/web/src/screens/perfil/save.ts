// Perfil writes. The prototype changed store.s.profile and re-rendered at once; here the change is
// applied to the store at once and sent with PUT /api/me/profile, one request after the other so the
// last tap wins. A failed write toasts its message and the state is pulled again from the server.
import { meApi } from '@tie/shared/contracts/me';
import type { Profile } from '@tie/shared/state';
import { toast } from '@tie/ui';
import { call, errorMessage } from '../../api';
import { refreshState } from '../../core/outbox';
import { set, state } from '../../store';

type Patch = Partial<Omit<Profile, 'photo'>>;
type Key = keyof Patch;

let chain: Promise<unknown> = Promise.resolve();
/** Debounced sends of typed fields, by profile key. */
const timers = new Map<Key, ReturnType<typeof setTimeout>>();

function send(body: Patch): Promise<boolean> {
  const run = chain.then(() =>
    call(meApi.profile, { body }).then(
      () => true,
      (err: unknown) => {
        toast(errorMessage(err));
        void refreshState();
        return false;
      },
    ),
  );
  chain = run;
  return run;
}

/** A write that carries these keys supersedes their debounced send (it already has the newest value). */
function cancelSoon(patch: Patch): void {
  for (const k of Object.keys(patch) as Key[]) {
    clearTimeout(timers.get(k));
    timers.delete(k);
  }
}

/** profile.x = …; save(msg): local now, then the server. */
export function saveProfile(patch: Patch, msg?: string): Promise<boolean> {
  cancelSoon(patch);
  set((s) => (s.profile ? { profile: { ...s.profile, ...patch } } : undefined));
  if (msg) toast(msg);
  return send(patch);
}

/**
 * For typed fields (reminder times): local now, sent once typing settles. The body is read from the
 * store when the timer fires, so it is always the newest value of the field, never the one captured
 * when the person typed.
 */
export function saveProfileSoon<K extends Key>(key: K, value: Patch[K], ms = 700): void {
  set((s) => (s.profile ? { profile: { ...s.profile, [key]: value } } : undefined));
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const p = state.value.profile;
      if (p) void send({ [key]: p[key] } as Patch);
    }, ms),
  );
}
