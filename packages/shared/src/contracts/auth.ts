import { z } from 'zod';
import { LIMITS } from '../constants';
import { SessionUser } from '../state';
import { Email, IsoDate, Ok, Password, PasswordAttempt, TurnstileToken } from './common';
import { endpoint } from './http';

export const FullName = z
  .string()
  .trim()
  .min(3)
  .max(LIMITS.fullNameMax)
  .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, { message: 'Nome completo: nome e sobrenome.' });
export const ShortName = z.string().trim().min(2).max(LIMITS.nameMax);
/** IANA timezone, e.g. America/Sao_Paulo. */
export const TimeZone = z.string().min(1).max(64);

/** Onboarding step 1 ("conta") creates the account. Age 5..110 is checked on the server. */
export const SignupBody = z.object({
  email: Email,
  password: Password,
  fullName: FullName,
  name: ShortName,
  birth: IsoDate,
  tz: TimeZone,
  termsVersion: z.string().min(1).max(40),
  acceptTerms: z.literal(true),
  turnstileToken: TurnstileToken,
});
export type SignupBody = z.infer<typeof SignupBody>;

export const LoginBody = z.object({
  email: Email,
  password: PasswordAttempt,
  turnstileToken: TurnstileToken,
});
export type LoginBody = z.infer<typeof LoginBody>;

export const AuthRes = z.object({ user: SessionUser });
export type AuthRes = z.infer<typeof AuthRes>;

/** Admin-issued one-time reset link (one_time_tokens kind 'reset'). */
export const ResetConsumeBody = z.object({
  token: z.string().min(16).max(200),
  password: Password,
  turnstileToken: TurnstileToken,
});
export type ResetConsumeBody = z.infer<typeof ResetConsumeBody>;

export const ChangePasswordBody = z.object({
  currentPassword: PasswordAttempt,
  newPassword: Password,
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

/** Public config the auth screens need before any session exists. */
export const AuthConfig = z.object({
  turnstileSiteKey: z.string(),
  termsVersion: z.string(),
  passwordMin: z.int().positive(),
});
export type AuthConfig = z.infer<typeof AuthConfig>;

export const authApi = {
  config: endpoint({ method: 'GET', path: '/api/auth/config', access: 'public', res: AuthConfig }),
  signup: endpoint({
    method: 'POST',
    path: '/api/auth/signup',
    access: 'public',
    body: SignupBody,
    res: AuthRes,
    rateLimit: 'RL_AUTH',
  }),
  login: endpoint({
    method: 'POST',
    path: '/api/auth/login',
    access: 'public',
    body: LoginBody,
    res: AuthRes,
    rateLimit: 'RL_AUTH',
  }),
  logout: endpoint({ method: 'POST', path: '/api/auth/logout', access: 'public', res: Ok }),
  resetConsume: endpoint({
    method: 'POST',
    path: '/api/auth/reset/consume',
    access: 'public',
    body: ResetConsumeBody,
    res: Ok,
    rateLimit: 'RL_AUTH',
  }),
  /** Revokes every other session of the user and rotates the current one. */
  changePassword: endpoint({
    method: 'POST',
    path: '/api/auth/password',
    access: 'user',
    body: ChangePasswordBody,
    res: Ok,
    rateLimit: 'RL_AUTH',
  }),
} as const;
