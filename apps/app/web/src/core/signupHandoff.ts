// The course home (web/home.html, served at / to visitors) asks for the sign-up's first fields and
// hands them to the app's own sign-up (#/cadastro/1), which then only asks for the password. Both pages
// share the origin and the tab, so sessionStorage carries them: nothing personal goes in the URL, and
// the app reads the copy once and deletes it. No imports: the landing bundles this file on its own.

const KEY = 'tie.signup-handoff';

export interface SignupHandoff {
  fullName: string;
  name: string;
  /** YYYY-MM-DD, like the app's date input. */
  birth: string;
  email: string;
}

/** Stores the fields for the next page. False when storage is unavailable (the app then starts empty). */
export function writeSignupHandoff(h: SignupHandoff): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(h));
    return true;
  } catch {
    return false;
  }
}

/** Reads and deletes the fields the landing left, cut to the app's limits; null when there are none. */
export function takeSignupHandoff(max: { fullName: number; name: number; email: number }): SignupHandoff | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, n: number) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const birth = str(o.birth, 10);
  return {
    fullName: str(o.fullName, max.fullName),
    name: str(o.name, max.name),
    birth: /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : '',
    email: str(o.email, max.email),
  };
}
