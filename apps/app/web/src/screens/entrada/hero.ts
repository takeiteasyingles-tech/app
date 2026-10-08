// The sign-in photo (web/public/img). It is the largest paint of #/entrar (its LCP), so:
// - phones get an 828 px copy (login-m.webp: the original resized, webp q72, 76 KB instead of 387 KB;
//   the photo sits under a navy veil, which hides the difference); the original is for desktop only;
// - main.tsx starts its download with the shell (preloadHero) instead of after the screen chunk and
//   /api/me/state, and the screen's background-image finds it in the cache.
export const HERO_URL = { desktop: '/img/login.webp', mobile: '/img/login-m.webp' } as const;

export function preloadHero(layout: keyof typeof HERO_URL): void {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.fetchPriority = 'high';
  img.src = HERO_URL[layout];
}
