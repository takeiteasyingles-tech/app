import { z } from 'zod';
import { LIMITS } from '../constants';

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;

/** Unix ms. */
export const Timestamp = z.int().min(0);

/** YYYY-MM-DD (also used for local dates in the user's timezone). */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** HH:MM, 24h. */
export const TimeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Email = z.string().trim().toLowerCase().pipe(z.email().max(LIMITS.emailMax));
export const Password = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);
/** Login only checks presence; strength rules apply when a password is set. */
export const PasswordAttempt = z.string().min(1).max(LIMITS.passwordMax);
export const TurnstileToken = z.string().min(1).max(2048);

export const IdString = z.string().min(1).max(120);
export const IdParams = z.object({ id: IdString });
export const NumParams = z.object({ n: z.coerce.number().int().positive() });

export const PageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function Page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** Query-string boolean: "1" / "true" / "0" / "false". */
export const QueryBool = z.enum(['1', '0', 'true', 'false']).transform((v) => v === '1' || v === 'true');
