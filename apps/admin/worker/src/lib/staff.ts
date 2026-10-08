// Staff identity helpers: role lookups, the AdminAuthRes shape and the "who may act on whom" rule.
import { type AdminAuthRes, canGrantRole, PERMISSIONS, permissionsOf, ROLES, type Role } from '@tie/shared';
import { all, type Query, q } from '@tie/worker-core';

export function rolesQuery(db: D1Database, userId: string): Query<{ role: string }> {
  return q<{ role: string }>(db, 'SELECT role FROM user_roles WHERE user_id = ?', userId);
}

export function toRoles(rows: readonly { role: string }[]): Role[] {
  const held = new Set(rows.map((r) => r.role));
  return ROLES.filter((r) => held.has(r));
}

/** "admin,editor" (group_concat) → ordered roles. */
export function rolesFromCsv(csv: string | null | undefined): Role[] {
  return toRoles((csv ?? '').split(',').map((role) => ({ role })));
}

export async function loadRoles(db: D1Database, userId: string): Promise<Role[]> {
  return toRoles(await all<{ role: string }>(db, 'SELECT role FROM user_roles WHERE user_id = ?', userId));
}

export function authRes(user: { id: string; email: string }, roles: Role[]): AdminAuthRes {
  const perms = permissionsOf(roles);
  return { user: { id: user.id, email: user.email, roles }, permissions: PERMISSIONS.filter((p) => perms.has(p)) };
}

/**
 * Account-level actions on a staff member (suspend, delete, plan, reset link, progress reset, role
 * changes, invites) need authority over every role the target holds, the same rule as granting it:
 * admin over editor/moderator, super_admin over admin. Nobody acts on a super_admin through the
 * API. Learners (no roles) are fair game.
 */
export function canManage(actorRoles: readonly Role[], targetRoles: readonly Role[]): boolean {
  return targetRoles.every((r) => canGrantRole(actorRoles, r));
}
