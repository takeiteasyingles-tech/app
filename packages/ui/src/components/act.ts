import { uiConfig } from '../config';
import { navigate } from '../nav';

/** Click handler a component receives instead of the prototype's data-act/data-arg. */
export type Act = (ev: MouseEvent) => void;

/**
 * The prototype's delegated click: preventDefault, tick sfx, then data-go (wins when both are set)
 * or data-act. Disabled buttons never fire click events, so no check is needed here.
 */
export function activator(go: string | undefined, onClick: Act | undefined): Act | undefined {
  if (!go && !onClick) return undefined;
  return (ev) => {
    ev.preventDefault();
    uiConfig.sfx('tick');
    if (go) navigate(go);
    else onClick?.(ev);
  };
}
