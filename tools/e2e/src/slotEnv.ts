// Slot settings shared by playwright.config.ts, the global setup and the specs.
import { slot } from '../../parity/src/config';

export const SLOT = Number(process.env.E2E_SLOT ?? '7');
export const sl = slot(SLOT);
export const BASE_URL = sl.origin;
