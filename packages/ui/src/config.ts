// App-level hooks the components and effects call. Each app wires these once at startup
// (sound effects, media URLs, the fx setting); the defaults keep components usable in isolation.

export type SfxName = 'tick' | 'ok' | 'soft' | 'points' | 'level' | 'rec' | 'done';

export interface UiConfig {
  /** Synthesized sound effects (core/sound). The prototype plays `tick` on every data-go/data-act click. */
  sfx: (name: SfxName) => void;
  /** settings.fx: confetti is skipped when false. */
  fxEnabled: () => boolean;
  /** Folder with user-1..6.webp (prototype: assets/img/gen/avatar/). */
  avatarDir: string;
  /** Default background of the Mic avatar stage. */
  stageBg: string;
}

export const uiConfig: UiConfig = {
  sfx: () => {},
  fxEnabled: () => true,
  avatarDir: 'assets/img/gen/avatar/',
  stageBg: 'assets/img/gen/bg/maggie-set.webp',
};

export function configureUi(patch: Partial<UiConfig>): void {
  Object.assign(uiConfig, patch);
}
