// Tiny hash navigation used by components in place of the prototype's data-go attribute.
// The app router (apps/*/web/src/router.ts) owns ROUTES/parse and subscribes with onNavigate.

type Listener = () => void;
const listeners = new Set<Listener>();

/** '#/' + path, accepting 'inicio', '/inicio', '#/inicio'. */
export function hashFor(path: string): string {
  return `#/${String(path).replace(/^#?\/?/, '')}`;
}

/**
 * Subscribe to navigations that do not fire `hashchange` (same-hash go, replace).
 * Returns the unsubscribe function.
 */
export function onNavigate(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

/** TIE.router.go: sets the hash, or re-renders when it is already there. */
export function navigate(path: string): void {
  const h = hashFor(path);
  if (location.hash === h) emit();
  else location.hash = h;
}

/** TIE.router.replace: swaps the history entry without a new one and re-renders. */
export function replace(path: string): void {
  history.replaceState(null, '', hashFor(path));
  emit();
}
