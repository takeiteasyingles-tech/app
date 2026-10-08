import { z } from 'zod';

// Staff roles. super_admin ⊇ admin ⊇ {editor, moderator}; editor and moderator are disjoint.
export const ROLES = ['super_admin', 'admin', 'editor', 'moderator'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const SUPER_ADMIN_EMAIL = 'diego.perez@digitalsolvers.com';

export const PERMISSIONS = [
  // moderator
  'users.read',
  'users.suspend',
  'transcripts.read',
  'moderation.manage',
  // editor
  'content.edit',
  'content.publish',
  'media.manage',
  // admin
  'users.delete',
  'users.plan',
  'users.reset_link',
  'users.progress_reset',
  'roles.grant_staff',
  'plans.manage',
  'ai.persona',
  'ai.prompts',
  'game.rules',
  'releases.manage',
  'audit.read',
  'flags.manage',
  'settings.manage',
  'stats.read',
  // super_admin
  'roles.grant_admin',
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

const MODERATOR: readonly Permission[] = ['users.read', 'users.suspend', 'transcripts.read', 'moderation.manage'];
const EDITOR: readonly Permission[] = ['content.edit', 'content.publish', 'media.manage'];
const ADMIN_ONLY: readonly Permission[] = [
  'users.delete',
  'users.plan',
  'users.reset_link',
  'users.progress_reset',
  'roles.grant_staff',
  'plans.manage',
  'ai.persona',
  'ai.prompts',
  'game.rules',
  'releases.manage',
  'audit.read',
  'flags.manage',
  'settings.manage',
  'stats.read',
];
const ADMIN: readonly Permission[] = [...MODERATOR, ...EDITOR, ...ADMIN_ONLY];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  moderator: new Set(MODERATOR),
  editor: new Set(EDITOR),
  admin: new Set(ADMIN),
  super_admin: new Set([...ADMIN, 'roles.grant_admin']),
};

/** Lowest role that holds each permission; used for UI hints and the admin API table. */
export const MIN_ROLE: Record<Permission, Role> = Object.fromEntries(
  PERMISSIONS.map((p) => [
    p,
    MODERATOR.includes(p)
      ? 'moderator'
      : EDITOR.includes(p)
        ? 'editor'
        : ADMIN_ONLY.includes(p)
          ? 'admin'
          : 'super_admin',
  ]),
) as Record<Permission, Role>;

export function permissionsOf(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  return out;
}

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].has(permission));
}

export function isStaff(roles: readonly Role[]): boolean {
  return roles.length > 0;
}

/** True when `holder` covers every permission of `role` (super_admin ⊇ admin ⊇ editor/moderator). */
export function roleIncludes(holder: Role, role: Role): boolean {
  const have = ROLE_PERMISSIONS[holder];
  for (const p of ROLE_PERMISSIONS[role]) if (!have.has(p)) return false;
  return true;
}

/**
 * Who may grant or revoke a role: admin grants editor/moderator, super_admin also grants admin.
 * super_admin itself is never granted through the API (only the bootstrap script creates it).
 */
export function canGrantRole(granterRoles: readonly Role[], role: Role): boolean {
  if (role === 'super_admin') return false;
  if (role === 'admin') return can(granterRoles, 'roles.grant_admin');
  return can(granterRoles, 'roles.grant_staff');
}

/** Highest role held, for audit_log.actor_role. */
export function primaryRole(roles: readonly Role[]): Role | null {
  for (const r of ROLES) if (roles.includes(r)) return r;
  return null;
}
