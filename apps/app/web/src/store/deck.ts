// review.queue() / s.due on the client. The prototype recounted the due cards on every render
// (review.sync); here a minute clock recounts them from state.deck, so the Revisão badge also
// grows while the app sits open as cards come due.
import { computed, signal } from '@preact/signals';
import { meApi } from '@tie/shared/contracts/me';
import { queue } from '@tie/shared/domain/srs';
import { call } from '../api';
import { set, state } from './state';

const TICK_MS = 30_000;

/** Coarse wall clock (ms), bumped every 30 s in the browser. */
export const clock = signal(Date.now());
if (typeof window !== 'undefined') {
  setInterval(() => {
    clock.value = Date.now();
  }, TICK_MS);
}

/** Cards due now (Tabbar / Side badge, the cards mission). */
export const dueNow = computed(() => queue(state.value.deck, Math.max(clock.value, Date.now())).length);

/**
 * Pulls the deck again after the server unlocked cards (step 4 / 8 advance, episode done): the
 * progress endpoints answer only how many were added. Only deck and due are taken from the fresh
 * state, so in-flight optimistic writes elsewhere are not overwritten.
 */
export async function syncDeck(): Promise<void> {
  try {
    const s = await call(meApi.state);
    set({ deck: s.deck, due: s.due });
  } catch {
    // Offline: the cards show up on the next load.
  }
}
