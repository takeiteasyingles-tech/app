// Brings the e2e slot up (build → seed if stale → fixture users → wrangler dev) and returns the teardown,
// which stops the server and frees the slot. Same machinery as the parity harness.
import { startSlot } from '../../parity/src/slot';
import { SLOT } from './slotEnv';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const env = await startSlot({
    slot: SLOT,
    app: 'app',
    prototype: false,
    skipBuild: process.env.E2E_SKIP_BUILD === '1',
    // Real Worker clock: the e2e user signs up "now", like a person would.
    realClock: true,
    log: (m) => console.log(`[e2e slot ${SLOT}] ${m}`),
  });
  console.log(`[e2e slot ${SLOT}] app on ${env.origin}`);
  return async () => {
    await env.close();
    console.log(`[e2e slot ${SLOT}] servers stopped`);
  };
}
