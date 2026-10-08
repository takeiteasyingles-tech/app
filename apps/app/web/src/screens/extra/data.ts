// Shared bits of the EXTRA screens (prototipo/js/screens/extra.js): the catalog hook, every extra's
// lines and vocab (Desafio pool, word lookup), the point values shown in the copy and the
// prototype's random helpers.
import { effect, untracked } from '@preact/signals';
import { PLAN_FEATURES } from '@tie/shared/constants';
import type { Catalog, Extra, PointKind } from '@tie/shared/content/schema';
import { useEffect, useState } from 'preact/hooks';
import { layoutOf } from '../../shell';
import { catalog, loadCatalog, loadExtra } from '../../store/content';
import { state } from '../../store/state';

/** TIE.data for the EXTRA screens: the catalog signal, loaded on first use (null until it lands). */
export function useCatalog(): { c: Catalog | null; failed: boolean; retry: () => void } {
  const c = catalog.value;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (c) return;
    let alive = true;
    loadCatalog().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [c, attempt]);
  return {
    c,
    failed: failed && !c,
    retry: () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    },
  };
}

/** app.isDesktop() */
export const isDesktop = (): boolean => layoutOf(state.value) === 'desktop';

/** Points a kind is worth (catalog point rules), for the "+20 pontos" copy. */
export const pts = (c: Catalog | null, k: PointKind, fallback: number): number => c?.game.points[k] ?? fallback;

/**
 * The loadAllExtras cache. It belongs to one catalog object, one plan and one user: resetContent()
 * (sign-out, a new content version) drops the catalog signal and the next load is a new object, so
 * a cache built for another catalog, plan or user is thrown away instead of leaking the previous
 * session's lines (premium ones included) into the Desafio pool and the word lookup.
 */
let allP: Promise<Extra[]> | null = null;
let allCache: Extra[] | null = null;
let allFor: { cat: Catalog; premium: boolean; user: string | null } | null = null;
/** Bumped on every drop, so a load that was in flight across a reset does not repopulate the cache. */
let allGen = 0;

const premiumNow = (): boolean => !!state.value.plan?.features[PLAN_FEATURES.premiumExtras];
const userNow = (): string | null => state.value.user?.id ?? null;

function dropAll(): void {
  allGen++;
  allP = null;
  allCache = null;
  allFor = null;
}

/** True when the cache (or the load in flight) still matches the current catalog, plan and user. */
function cacheFresh(): boolean {
  if (!allFor) return true;
  return allFor.cat === catalog.value && allFor.premium === premiumNow() && allFor.user === userNow();
}

// Content reset (sign-out, new version) or another learner: drop the cache right away.
effect(() => {
  const cat = catalog.value;
  const user = state.value.user?.id ?? null;
  untracked(() => {
    if (allFor && (allFor.cat !== cat || allFor.user !== user)) dropAll();
  });
});

/**
 * Every published extra with its lines and vocab (D().EXTRAS). Premium titles the plan does not
 * open are not requested at all (they would only answer 403 plan_required and log a console
 * error); anything else that fails is skipped. Fetched once per catalog, plan and user; each file
 * is shared with the screens that load it.
 */
export function loadAllExtras(): Promise<Extra[]> {
  if (!cacheFresh()) dropAll();
  if (allP) return allP;
  const gen = allGen;
  const premium = premiumNow();
  const user = userNow();
  const p = loadCatalog()
    .then(async (c) => {
      const rs = await Promise.allSettled(c.extras.filter((x) => premium || !x.premium).map((x) => loadExtra(x.id)));
      const list = rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      // Cached only if nothing was reset meanwhile and it is still this catalog, plan and user.
      if (gen === allGen && catalog.value === c && premiumNow() === premium && userNow() === user) {
        allCache = list;
        allFor = { cat: c, premium, user };
      } else if (allP === p) allP = null;
      return list;
    })
    .catch((err: unknown) => {
      if (allP === p) allP = null;
      throw err;
    });
  allP = p;
  return p;
}

/** The extras loaded so far by loadAllExtras (empty before it resolves, or once the content resets). */
export const allExtrasNow = (): readonly Extra[] => (allCache && cacheFresh() ? allCache : []);

/** TIE.u.pick */
export const pick = <T>(arr: readonly T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];

/** TIE.u.shuffle */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

/** TIE.u.pad2 */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A re-render trigger for screens that keep their state in a mutable ref (the prototype's V/K/G). */
export function useRerender(): () => void {
  const [, set] = useState(0);
  return () => set((n) => n + 1);
}
