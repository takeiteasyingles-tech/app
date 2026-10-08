// TIE.ai.online: whether the server has Workers AI (drives the "IA ligada" / "Modo demo" badge).
import { signal } from '@preact/signals';
import { aiApi } from '@tie/shared/contracts/ai';
import { call } from '../api';

export const aiOnline = signal(false);
export const aiModel = signal('');

/** TIE.ai.init(): GET /api/health; any failure keeps demo mode. */
export async function checkHealth(): Promise<void> {
  try {
    const h = await call(aiApi.health);
    aiOnline.value = h.ai;
    aiModel.value = h.model ?? '';
  } catch {
    aiOnline.value = false;
  }
}
