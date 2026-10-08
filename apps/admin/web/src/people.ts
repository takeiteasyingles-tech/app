// Resolves user ids (audit actors, moderation subjects) to e-mails for display, with a shared cache.
// Only staff with users.read can look people up; everyone else sees the id.
import { adminUsersApi } from '@tie/shared/contracts/admin';
import { useEffect, useState } from 'preact/hooks';
import { call } from './api';
import { can } from './session';

const emails = new Map<string, string | null>();
const inflight = new Map<string, Promise<void>>();

function fetchOne(id: string): Promise<void> {
  let p = inflight.get(id);
  if (!p) {
    p = call(adminUsersApi.get, { params: { id } })
      .then(
        (u) => {
          emails.set(id, u.email);
        },
        () => {
          emails.set(id, null);
        },
      )
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

export function rememberEmail(id: string, email: string): void {
  emails.set(id, email);
}

/** id → e-mail (or undefined while unknown). Re-renders when lookups land. */
export function useEmails(ids: readonly (string | null | undefined)[]): (id: string | null | undefined) => string | undefined {
  const [, bump] = useState(0);
  const key = [...new Set(ids.filter((x): x is string => !!x))].sort().join(',');
  useEffect(() => {
    if (!key || !can('users.read')) return;
    const todo = key.split(',').filter((id) => !emails.has(id)).slice(0, 25);
    if (!todo.length) return;
    let alive = true;
    void Promise.all(todo.map(fetchOne)).then(() => alive && bump((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [key]);
  return (id) => (id ? (emails.get(id) ?? undefined) : undefined);
}
