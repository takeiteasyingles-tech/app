import { Topbar } from '@tie/ui';
import type { ScreenProps } from '../frame';

/** Stand-in each slice replaces with the real port of its prototype screen. */
export function Placeholder({ title, path, params }: ScreenProps & { title: string }) {
  const args = Object.entries(params).filter(([, v]) => v !== undefined);
  return (
    <>
      <Topbar kicker="Take It Easy" title={title} />
      <div class="scroll">
        <div class="wrap stack">
          <div class="card stack" style={{ '--gap': '8px' }}>
            <div class="lbl">{`#/${path}`}</div>
            <p class="p">Esta tela ainda está sendo construída.</p>
            {args.length ? <p class="sm">{args.map(([k, v]) => `${k}: ${v}`).join(' · ')}</p> : null}
          </div>
        </div>
      </div>
    </>
  );
}
