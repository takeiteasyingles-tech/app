import { ApiError, can, type Permission, type Role, roleIncludes } from '@tie/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, Audience } from '../env';
import {
  clearCookie,
  clearSessionCookie,
  readCookie,
  readSessionCookie,
  setSessionCookie,
  writeCookie,
} from './cookies';
import { type MediaTokenClaims, signMediaToken, verifyMediaToken } from './mediaToken';
import { lookupSession, type SessionInfo } from './sessions';

type Failure = 'unauthorized' | 'session_expired' | 'account_suspended';

/** Resolves the session cookie; a valid session is cached on the context for later middleware. */
async function resolve(c: Context<AppEnv>, audience: Audience): Promise<SessionInfo | Failure> {
  const existing = c.get('session');
  if (existing && existing.audience === audience) return existing;
  const token = readSessionCookie(c, audience);
  if (!token) return 'unauthorized';
  const res = await lookupSession(c.env.DB, token, audience);
  if (!res.ok) {
    clearSessionCookie(c, audience);
    return res.reason === 'expired'
      ? 'session_expired'
      : res.reason === 'suspended'
        ? 'account_suspended'
        : 'unauthorized';
  }
  // Sliding app sessions: re-send the cookie with the extended Max-Age.
  if (res.touched && audience === 'app') setSessionCookie(c, audience, token, res.session.expiresAt);
  c.set('session', res.session);
  return res.session;
}

/** Loads the session when present; never rejects (public routes that personalize). */
export function loadSession(audience: Audience = 'app'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await resolve(c, audience);
    await next();
  };
}

/** 401 unless a valid, active session for `audience` exists. */
export function requireUser(audience: Audience = 'app'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const s = await resolve(c, audience);
    if (typeof s === 'string') throw new ApiError(s);
    await next();
  };
}

/** Admin session holding `minRole` or a role that includes it (super_admin ⊇ admin ⊇ editor/moderator). */
export function requireRole(minRole: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const s = await resolve(c, 'admin');
    if (typeof s === 'string') throw new ApiError(s);
    if (!s.roles.some((held) => roleIncludes(held, minRole))) throw new ApiError('forbidden');
    await next();
  };
}

/** Admin session holding a specific permission (the admin API table names one per endpoint). */
export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const s = await resolve(c, 'admin');
    if (typeof s === 'string') throw new ApiError(s);
    if (!can(s.roles, permission)) throw new ApiError('forbidden');
    await next();
  };
}

/** The session set by requireUser/requireRole; throws if the route forgot the middleware. */
export function sessionOf(c: Context<AppEnv>): SessionInfo {
  const s = c.get('session');
  if (!s) throw new ApiError('unauthorized');
  return s;
}

/** Issues the tie_m media cookie (12h) for the given user. */
export async function issueMediaCookie(c: Context<AppEnv>, userId: string, now: number = Date.now()): Promise<void> {
  const { token, expiresAt } = await signMediaToken(c.env.MEDIA_TOKEN_KEY, userId, now);
  writeCookie(c, 'media', token, (expiresAt - now) / 1000);
}

/** Claims from a valid tie_m cookie, without touching D1. */
export async function readMediaCookie(c: Context<AppEnv>): Promise<MediaTokenClaims | null> {
  return verifyMediaToken(c.env.MEDIA_TOKEN_KEY, readCookie(c, 'media'));
}

export function clearMediaCookie(c: Context<AppEnv>): void {
  clearCookie(c, 'media');
}
