// What happens around a session on the auth screens: after login/signup the state is loaded and the
// guard's destination opened; logout drops the session, the per-user offline data and the state.
import { authApi } from '@tie/shared/contracts/auth';
import { ApiError } from '@tie/shared/errors';
import { toast } from '@tie/ui';
import { call, errorMessage } from '../../api';
import { clearOfflineData } from '../../core/outbox';
import { stop as stopSpeech } from '../../core/speech';
import { go } from '../../router';
import { load, signedOut, state } from '../../store';

/** E-mail shape the prototype checked before any request. */
export const emailOk = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');

/** Pulls /api/me/state for the new session and opens Hoje (or the onboarding step to resume). */
export async function afterAuth(): Promise<void> {
  await load();
  const s = state.value;
  if (!s.user) return;
  go(s.profile ? 'inicio' : `cadastro/${s.onbStep || 1}`);
}

/** The server no longer knows the session: signing out locally is all that is left to do. */
const sessionGone = (err: unknown): boolean =>
  err instanceof ApiError && (err.code === 'unauthorized' || err.code === 'session_expired');

let loggingOut = false;

/**
 * TIE.act.logout: stops the voice, ends the server session and clears the device's user data.
 * Only a confirmed sign-out clears the device: when the request fails (offline, 5xx) the HttpOnly
 * cookie is still valid, so the person is told and stays signed in instead of seeing a sign-out that
 * did not happen (on a shared device, the next load would sign them straight back in).
 * Resolves true when the session ended.
 */
export async function logout(): Promise<boolean> {
  if (loggingOut) return false;
  loggingOut = true;
  try {
    stopSpeech();
    try {
      await call(authApi.logout);
    } catch (err) {
      if (!sessionGone(err)) {
        toast(`Não deu para sair agora. ${errorMessage(err)}`, 4200);
        return false;
      }
    }
    await clearOfflineData().catch(() => {});
    signedOut();
    go('entrar');
    return true;
  } finally {
    loggingOut = false;
  }
}

/** `{path: message}` from a validation_failed error's details.issues. */
export function issuePaths(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(err instanceof ApiError) || err.code !== 'validation_failed') return out;
  const issues = (err.details as { issues?: { path?: unknown; message?: unknown }[] } | undefined)?.issues;
  for (const i of issues ?? []) {
    const p = String(i.path ?? '').split('.')[0] ?? '';
    if (p && !out[p]) out[p] = String(i.message ?? '');
  }
  return out;
}
