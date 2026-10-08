// The signed-in staff member: GET /admin-api/auth/me at start, login / invite accept / logout, and
// the permission set every screen and nav item checks. The UI only hides what a role cannot do; the
// Worker enforces every permission again.
import { computed, signal } from '@preact/signals';
import type { Permission, Role } from '@tie/shared/authz';
import { type AdminAuthRes, adminAuthApi, adminOpsApi } from '@tie/shared/contracts/admin';
import { ApiError, call, NetworkError, onUnauthorized } from './api';
import { toast } from './ui/toast';

export type AuthStatus = 'loading' | 'in' | 'out' | 'offline';

export const auth = signal<AdminAuthRes | null>(null);
export const authStatus = signal<AuthStatus>('loading');

/** Pending moderation items for the sidebar badge (set from the stats the dashboard reads). */
export const pendingModeration = signal(0);

export const perms = computed(() => new Set<Permission>(auth.value?.permissions ?? []));
export const roles = computed<readonly Role[]>(() => auth.value?.user.roles ?? []);

/** True when the signed-in staff member holds `p` (any of them, for an array). */
export function can(p: Permission | readonly Permission[]): boolean {
  const set = perms.value;
  return Array.isArray(p) ? p.some((x) => set.has(x)) : set.has(p as Permission);
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  editor: 'Editor',
  moderator: 'Moderador',
};

/** Reads the moderation backlog for the sidebar badge (admins: stats.read). */
export function refreshBadges(): void {
  if (!can('stats.read')) return;
  call(adminOpsApi.stats).then(
    (s) => {
      pendingModeration.value = s.moderation.pending;
    },
    () => {},
  );
}

export async function loadSession(): Promise<void> {
  try {
    auth.value = await call(adminAuthApi.me);
    authStatus.value = 'in';
    refreshBadges();
  } catch (err) {
    auth.value = null;
    authStatus.value = err instanceof NetworkError ? 'offline' : 'out';
    if (err instanceof ApiError && err.code !== 'unauthorized' && err.code !== 'session_expired') {
      // forbidden (no staff role any more) or a server error: the login screen explains.
      authStatus.value = 'out';
    }
  }
}

export function signedIn(res: AdminAuthRes): void {
  auth.value = res;
  authStatus.value = 'in';
  refreshBadges();
}

export async function logout(): Promise<void> {
  try {
    await call(adminAuthApi.logout);
  } catch {
    // The cookie is cleared server side when reachable; locally we sign out either way.
  }
  auth.value = null;
  authStatus.value = 'out';
}

let warned = false;
onUnauthorized((err) => {
  if (authStatus.value !== 'in') return;
  auth.value = null;
  authStatus.value = 'out';
  if (!warned) {
    warned = true;
    toast(err.code === 'session_expired' ? 'Sua sessão expirou. Entre de novo.' : 'Entre de novo para continuar.', 'warn');
    setTimeout(() => {
      warned = false;
    }, 4000);
  }
});
