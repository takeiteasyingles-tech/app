// Public surface of the parity harness (tools/e2e reuses the slot environment and determinism).
export * from './config';
export { contextOptions, launchBrowser, prepareContext, settle, TSX_HELPERS } from './determinism';
export { FIXTURE_PASSWORD, loadFixture, sessionToken } from './fixture/state';
export { pairIdOf, swapOf } from './pair';
export { reveal } from './reveal';
export { type SlotEnv, type SlotEnvOptions, startSlot } from './slot';
