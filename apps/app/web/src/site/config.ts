// Course home settings: the premiere and launch dates that switch the page's phase.

export type Fase = 'pre' | 'mvp' | 'oficial';

export const SITE = {
  /** MVP premiere (4 free episodes). Until then the page is in pre-premiere ('pre'). */
  estreia: '2026-12-01T00:00:00-03:00',
  /** Official launch (the whole Season 1 and the paid plans). */
  lancamentoOficial: '2027-02-01T00:00:00-03:00',
  /** Forces a phase for testing; null follows the dates. `?fase=mvp` in the URL does the same. */
  forcarFase: null as Fase | null,
} as const;

/** Where the app shell always answers (the Worker serves the course home at /; SPA fallback here). */
export const APP_BASE = '/app';
