import { COOKIES } from '@tie/shared';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Audience, Env } from '../env';

// __Host-tie_s / __Host-tie_adm / __Host-tie_m in production. Plain-HTTP localhost sets
// COOKIE_PREFIX="" (browsers reject __Host- cookies without Secure, and Secure needs https).

export type CookieKind = 'app' | 'admin' | 'media';

export function cookiePrefix(env: Pick<Env, 'COOKIE_PREFIX'>): string {
  return env.COOKIE_PREFIX ?? COOKIES.securePrefix;
}

export function cookieName(env: Pick<Env, 'COOKIE_PREFIX'>, kind: CookieKind): string {
  return cookiePrefix(env) + COOKIES[kind];
}

export function sessionCookieKind(audience: Audience): CookieKind {
  return audience === 'admin' ? 'admin' : 'app';
}

function secureFor(c: Context<AppEnv>): boolean {
  return cookiePrefix(c.env) !== '' || new URL(c.req.url).protocol === 'https:';
}

export function readCookie(c: Context<AppEnv>, kind: CookieKind): string | undefined {
  return getCookie(c, cookieName(c.env, kind)) || undefined;
}

export function writeCookie(c: Context<AppEnv>, kind: CookieKind, value: string, maxAgeSec: number): void {
  setCookie(c, cookieName(c.env, kind), value, {
    path: '/',
    httpOnly: true,
    secure: secureFor(c),
    sameSite: 'Lax',
    maxAge: Math.max(0, Math.floor(maxAgeSec)),
  });
}

export function clearCookie(c: Context<AppEnv>, kind: CookieKind): void {
  writeCookie(c, kind, '', 0);
}

export function setSessionCookie(
  c: Context<AppEnv>,
  audience: Audience,
  token: string,
  expiresAt: number,
  now: number = Date.now(),
): void {
  writeCookie(c, sessionCookieKind(audience), token, Math.ceil((expiresAt - now) / 1000));
}

export function readSessionCookie(c: Context<AppEnv>, audience: Audience): string | undefined {
  return readCookie(c, sessionCookieKind(audience));
}

export function clearSessionCookie(c: Context<AppEnv>, audience: Audience): void {
  clearCookie(c, sessionCookieKind(audience));
}
