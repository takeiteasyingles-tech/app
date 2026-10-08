import { z } from 'zod';
import { LIMITS, PHOTO_MIME } from '../constants';
import { PlanInfo, Profile, QuotaInfo, Settings, TieState } from '../state';
import { Ok, PasswordAttempt, Timestamp } from './common';
import { GameSummary } from './game';
import { endpoint } from './http';

export const MeSummary = GameSummary.extend({ plan: PlanInfo.nullable(), quota: QuotaInfo });
export type MeSummary = z.infer<typeof MeSummary>;

/**
 * Partial profile update from the onboarding wizard and the Perfil screen. `onbStep` records how far
 * the wizard got. Photo has its own endpoint; account fields (email, password) are not editable here.
 */
export const ProfilePatch = Profile.omit({ photo: true })
  .partial()
  .extend({ onbStep: z.int().min(1).max(7).optional() });
export type ProfilePatch = z.infer<typeof ProfilePatch>;

export const ProfileRes = z.object({
  profile: Profile,
  onbStep: z.int().min(1).max(7),
  completed: z.boolean(),
});
export type ProfileRes = z.infer<typeof ProfileRes>;

/** onbFinish: marks onboarding complete, sets settings.slow from personalize defaults, touches the streak. */
export const ProfileCompleteRes = z.object({ profile: Profile, settings: Settings });
export type ProfileCompleteRes = z.infer<typeof ProfileCompleteRes>;

/** `phone` is client-only and `free` comes from a feature flag, so neither is patchable. */
export const SettingsPatch = Settings.omit({ phone: true, free: true }).partial();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const SettingsRes = z.object({ settings: Settings });
export type SettingsRes = z.infer<typeof SettingsRes>;

export const PhotoRes = z.object({
  photo: z.string(),
  /** New photos wait in the moderation queue; the owner already sees them. */
  status: z.enum(['pending', 'approved']),
});
export type PhotoRes = z.infer<typeof PhotoRes>;

export const ResetProgressBody = z.object({ confirm: z.literal(true) });
export type ResetProgressBody = z.infer<typeof ResetProgressBody>;

export const DeleteAccountBody = z.object({ password: PasswordAttempt, confirm: z.literal(true) });
export type DeleteAccountBody = z.infer<typeof DeleteAccountBody>;

/** LGPD export: every row tied to the user, grouped by table. */
export const MeExport = z.looseObject({
  exportedAt: Timestamp,
  user: z.record(z.string(), z.unknown()),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type MeExport = z.infer<typeof MeExport>;

/**
 * `?probe=1`: the shell's start-up call. Signed out (no session, or an expired one) it answers 204
 * with no body instead of 401, so a first visit logs no failed request (Chrome prints every 4xx as a
 * console error). A suspended account still gets its 403.
 */
export const StateQuery = z.object({ probe: z.literal('1').optional() });
export type StateQuery = z.infer<typeof StateQuery>;

export const meApi = {
  state: endpoint({ method: 'GET', path: '/api/me/state', access: 'user', query: StateQuery, res: TieState }),
  summary: endpoint({ method: 'GET', path: '/api/me/summary', access: 'user', res: MeSummary }),
  profile: endpoint({ method: 'PUT', path: '/api/me/profile', access: 'user', body: ProfilePatch, res: ProfileRes }),
  profileComplete: endpoint({
    method: 'POST',
    path: '/api/me/profile/complete',
    access: 'user',
    res: ProfileCompleteRes,
  }),
  settings: endpoint({
    method: 'PATCH',
    path: '/api/me/settings',
    access: 'user',
    body: SettingsPatch,
    res: SettingsRes,
  }),
  /** multipart/form-data; magic bytes are checked, the client resizes to 256×256 JPEG first. */
  photoUpload: endpoint({
    method: 'POST',
    path: '/api/me/photo',
    access: 'user',
    multipart: { field: 'photo', maxBytes: LIMITS.photoMaxBytes, mime: PHOTO_MIME },
    res: PhotoRes,
    rateLimit: 'RL_UPLOAD',
  }),
  photoDelete: endpoint({ method: 'DELETE', path: '/api/me/photo', access: 'user', res: Ok }),
  resetProgress: endpoint({
    method: 'POST',
    path: '/api/me/reset-progress',
    access: 'user',
    body: ResetProgressBody,
    res: Ok,
  }),
  export: endpoint({ method: 'GET', path: '/api/me/export', access: 'user', res: MeExport }),
  deleteAccount: endpoint({ method: 'DELETE', path: '/api/me', access: 'user', body: DeleteAccountBody, res: Ok }),
} as const;
