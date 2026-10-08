import { DURATIONS, LOCKOUT_FAILED_LOGINS } from '@tie/shared';
import { type Query, q } from '../db';

// Login lockout shared by the student and staff logins (spec 04 §5: 10 failures lock for 15 min).

/**
 * Failures older than this stop counting (spec 06 "Lockout"): ten typos spread over weeks never
 * lock an account; ten inside the window still do.
 */
export const FAILED_LOGIN_DECAY_MS = 60 * 60_000;

export interface FailRow {
  failed_logins: number;
  locked_until: number | null;
}

/**
 * Counts one failed login atomically. Every SET expression reads the pre-update row, so parallel
 * failures each add one instead of overwriting each other. Cases, in order:
 * - lock still on (a racer that passed the pre-check): keep the lock, failed_logins + 1;
 * - this failure reaches the limit: failed_logins = 0, locked_until = now + 15 min;
 * - otherwise: failed_logins + 1, restarting from 0 after an expired lock or when the previous
 *   failure is older than FAILED_LOGIN_DECAY_MS (failed_at NULL: a count from before the decay
 *   existed, kept until the next failure stamps it), locked_until = NULL.
 * failed_at always becomes now. With userId '' it matches no row (unknown-email timing twin).
 */
export function failedLoginQuery(db: D1Database, userId: string, now: number): Query<FailRow> {
  const base = `(CASE WHEN locked_until IS NULL AND (failed_at IS NULL OR failed_at > ?5) THEN failed_logins ELSE 0 END)`;
  const next = `${base} + 1`;
  return q<FailRow>(
    db,
    `UPDATE users SET
       failed_logins = CASE WHEN locked_until > ?1 THEN failed_logins + 1 WHEN ${next} >= ?3 THEN 0 ELSE ${next} END,
       locked_until = CASE WHEN locked_until > ?1 THEN locked_until WHEN ${next} >= ?3 THEN ?2 ELSE NULL END,
       failed_at = ?1
     WHERE id = ?4
     RETURNING failed_logins, locked_until`,
    now,
    now + DURATIONS.lockoutMs,
    LOCKOUT_FAILED_LOGINS,
    userId,
    now - FAILED_LOGIN_DECAY_MS,
  );
}

/** A random claim nonce for one-time-token consumption (see claimedBy). */
export function newClaim(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * SQL condition (2 binds: token hash, claim) true only for the request whose UPDATE claimed the
 * token with that nonce. A timestamp is not enough: two consumers in the same millisecond would
 * both see "their" used_at and both apply (spec 06 "Password reset").
 */
export const CLAIMED_BY = '(SELECT claim FROM one_time_tokens WHERE token_hash = ?) = ?';
