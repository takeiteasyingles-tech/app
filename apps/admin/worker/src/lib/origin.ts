// Origins for the one-time links the admin hands out: invites open the admin SPA, password resets
// open the student app (#/entrar?reset=<token>, apps/app web Entrar.tsx).
import { isLocalOrigin, one } from '@tie/worker-core';
import type { Ctx } from './http';

/** app_settings key that names the student app origin when the STUDENT_APP_ORIGIN var is unset. */
export const STUDENT_ORIGIN_SETTING = 'app.origin';

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** The admin SPA origin: APP_ORIGIN, else the request's own origin (local dev, tests). */
export function adminOrigin(c: Ctx): string {
  return originOf(c.env.APP_ORIGIN) ?? new URL(c.req.url).origin;
}

/**
 * The student app origin, in order: the STUDENT_APP_ORIGIN var, app_settings['app.origin'], then a
 * guess from the admin origin (tie-admin.* → tie-app.*; local :8788 → :8787, the two dev ports).
 */
export async function studentOrigin(c: Ctx): Promise<string> {
  const fromVar = originOf((c.env as { STUDENT_APP_ORIGIN?: string }).STUDENT_APP_ORIGIN);
  if (fromVar) return fromVar;
  const row = await one<{ value: string }>(
    c.env.DB,
    'SELECT value FROM app_settings WHERE key = ?',
    STUDENT_ORIGIN_SETTING,
  );
  const fromSetting = originOf(row?.value);
  if (fromSetting) return fromSetting;
  const admin = new URL(adminOrigin(c));
  if (isLocalOrigin(admin.origin)) {
    if (admin.port === '8788') admin.port = '8787';
    return admin.origin;
  }
  admin.hostname = admin.hostname.replace(/^tie-admin(?=[.-])/, 'tie-app');
  return admin.origin;
}

export const inviteUrl = (origin: string, token: string): string => `${origin}/#/convite/${token}`;
export const resetUrl = (origin: string, token: string): string => `${origin}/#/entrar?reset=${token}`;
