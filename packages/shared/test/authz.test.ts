import { describe, expect, it } from 'vitest';
import {
  can,
  canGrantRole,
  MIN_ROLE,
  PERMISSIONS,
  permissionsOf,
  primaryRole,
  ROLES,
  roleIncludes,
} from '../src/authz';

describe('authz', () => {
  it('nests super_admin ⊇ admin ⊇ {editor, moderator}', () => {
    expect(roleIncludes('super_admin', 'admin')).toBe(true);
    expect(roleIncludes('admin', 'editor')).toBe(true);
    expect(roleIncludes('admin', 'moderator')).toBe(true);
    expect(roleIncludes('editor', 'moderator')).toBe(false);
    expect(roleIncludes('moderator', 'editor')).toBe(false);
    expect(roleIncludes('admin', 'super_admin')).toBe(false);
  });

  it('matches the admin API table', () => {
    expect(can(['moderator'], 'users.suspend')).toBe(true);
    expect(can(['moderator'], 'users.delete')).toBe(false);
    expect(can(['editor'], 'content.publish')).toBe(true);
    expect(can(['editor'], 'releases.manage')).toBe(false);
    expect(can(['editor'], 'users.read')).toBe(false);
    expect(can(['admin'], 'audit.read')).toBe(true);
    expect(can(['admin'], 'roles.grant_admin')).toBe(false);
    expect(can(['super_admin'], 'roles.grant_admin')).toBe(true);
    expect(can([], 'users.read')).toBe(false);
  });

  it('grants roles by rank and never super_admin', () => {
    expect(canGrantRole(['admin'], 'editor')).toBe(true);
    expect(canGrantRole(['admin'], 'moderator')).toBe(true);
    expect(canGrantRole(['admin'], 'admin')).toBe(false);
    expect(canGrantRole(['super_admin'], 'admin')).toBe(true);
    expect(canGrantRole(['super_admin'], 'super_admin')).toBe(false);
    expect(canGrantRole(['editor', 'moderator'], 'editor')).toBe(false);
  });

  it('gives every permission a minimum role that actually holds it', () => {
    for (const p of PERMISSIONS) expect(can([MIN_ROLE[p]], p)).toBe(true);
    expect(permissionsOf(['super_admin']).size).toBe(PERMISSIONS.length);
    expect(primaryRole(['editor', 'admin'])).toBe('admin');
    expect(primaryRole([])).toBeNull();
    expect(ROLES[0]).toBe('super_admin');
  });
});
