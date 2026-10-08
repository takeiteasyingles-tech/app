import type { ComponentChildren, Ref } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { uiConfig } from '../config';
import { Icon } from '../icons';
import { navigate } from '../nav';
import { activator } from './act';

/** The Extra fields a cover needs (ExtraMeta + the personalize "why" line). */
export type CoverItem = {
  id: string;
  title: string;
  kind: string;
  level: string;
  cover: string | null;
  locked?: boolean;
  why?: string;
};

export type CoverProps = { x: CoverItem; why?: boolean; go?: string };

/** C.cover: 2/3 art with level pill and the "Sexta" lock, title, kind and why line. */
export function Cover({ x, why = true, go }: CoverProps) {
  return (
    <button type="button" class="cover" aria-label={x.title} onClick={activator(go ?? `extra/${x.id}`, undefined)}>
      <div class="art">
        <img src={x.cover ?? ''} alt="" loading="lazy" />
        <span class="pill lvl lv">{x.level}</span>
        {x.locked ? (
          <div class="lock">
            <span class="pill or">
              <Icon name="lock" size={13} /> Sexta
            </span>
          </div>
        ) : null}
      </div>
      <div class="ttl">{x.title}</div>
      <div class="xs">{x.kind}</div>
      {why && x.why ? <div class="why">{x.why}</div> : null}
    </button>
  );
}

export type FlowProps = {
  items: readonly CoverItem[];
  id: string;
  /** Index shown first. */
  start?: number;
  /** Auto-advance period in ms; 0 turns it off. */
  auto?: number;
};

/**
 * C.flow + C.flowMount: 3D coverflow. Click a side item to bring it forward, click the front item
 * to open it, arrows step, drag swipes, and it auto-advances every 3.8s. Transforms are written
 * straight to the items (as flowMount did) so the carousel never re-renders while it moves.
 */
export function Flow({ items, id, start = 0, auto = 3800 }: FlowProps) {
  const root = useRef<HTMLDivElement>(null);
  const api = useRef<{ go(d: number): void; set(i: number): void; arm(): void; cur(): number } | null>(null);
  const drag = useRef<{ x: number | null; moved: boolean }>({ x: null, moved: false });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const its = [...el.querySelectorAll<HTMLElement>('.item')];
    const dots = [...el.querySelectorAll<HTMLElement>('[data-dot]')];
    const n = its.length;
    let cur = Math.min(Math.max(0, start), Math.max(0, n - 1));
    let timer = 0;
    const layout = () => {
      const desk = el.clientWidth > 700;
      const gapX = desk ? 190 : 120;
      its.forEach((it, i) => {
        let d = i - cur;
        if (d > n / 2) d -= n;
        if (d < -n / 2) d += n;
        const ad = Math.abs(d);
        it.style.transform = `translateX(${d * gapX}px) translateZ(${-ad * 160}px) rotateY(${-d * 28}deg) scale(${1 - ad * 0.08})`;
        it.style.opacity = String(ad > 2 ? 0 : 1 - ad * 0.18);
        it.style.zIndex = String(10 - ad);
        it.style.filter = ad ? `brightness(${1 - ad * 0.25})` : 'none';
        it.classList.toggle('on', d === 0);
      });
      dots.forEach((dt, i) => {
        dt.classList.toggle('on', i === cur);
      });
    };
    const go = (d: number) => {
      cur = (cur + d + n) % n;
      layout();
    };
    const arm = () => {
      clearInterval(timer);
      if (auto) timer = window.setInterval(() => go(1), auto);
    };
    api.current = {
      go,
      set(i) {
        cur = i;
        layout();
      },
      arm,
      cur: () => cur,
    };
    layout();
    arm();
    return () => {
      clearInterval(timer);
      api.current = null;
    };
  }, [items, start, auto]);

  const step = (d: number) => (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    uiConfig.sfx('tick');
    api.current?.go(d);
    api.current?.arm();
  };
  const onItem = (i: number, xid: string) => (ev: MouseEvent) => {
    ev.preventDefault();
    const a = api.current;
    // A drag that ends on an item is a swipe, not a click.
    if (!a || drag.current.moved) return;
    if (i !== a.cur()) {
      a.set(i);
      a.arm();
      return;
    }
    uiConfig.sfx('tick');
    navigate(`extra/${xid}`);
  };

  return (
    <div
      class="flow"
      id={id}
      data-n={items.length}
      ref={root as Ref<HTMLDivElement>}
      onPointerDown={(ev) => {
        drag.current = { x: ev.clientX, moved: false };
      }}
      onPointerMove={(ev) => {
        const dr = drag.current;
        if (dr.x == null) return;
        const dx = ev.clientX - dr.x;
        if (Math.abs(dx) > 40) {
          api.current?.go(dx < 0 ? 1 : -1);
          dr.x = ev.clientX;
          dr.moved = true;
          api.current?.arm();
        }
      }}
      onPointerUp={() => {
        drag.current.x = null;
        setTimeout(() => {
          drag.current.moved = false;
        }, 50);
      }}
    >
      {items.map((x, i) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: same markup as the prototype; arrows are the keyboard path.
        // biome-ignore lint/a11y/noStaticElementInteractions: same markup as the prototype's .flow .item.
        <div key={x.id} class="item" data-i={i} onClick={onItem(i, x.id)}>
          <img src={x.cover ?? ''} alt="" draggable={false} />
          <div class="cap">
            <b>{x.title}</b>
            <span>{`${x.kind} · ${x.level}`}</span>
          </div>
        </div>
      ))}
      <button type="button" class="arrow l" aria-label="Anterior" onClick={step(-1)}>
        <Icon name="back" size={18} />
      </button>
      <button type="button" class="arrow r" aria-label="Próxima" onClick={step(1)}>
        <Icon name="next" size={18} />
      </button>
      <div class="dots">
        {items.map((x, i) => (
          <i key={x.id} data-dot={i} />
        ))}
      </div>
    </div>
  );
}

export type StageProps = {
  id?: string;
  bg?: string;
  status?: string;
  listening?: boolean;
  cls?: string;
  /** Caption overlay (the prototype's `caption` HTML). */
  children?: ComponentChildren;
  stageRef?: Ref<HTMLDivElement>;
};

/** C.stage: Mic avatar stage with background, status pill, EQ bars and caption. */
export function Stage({ id = 'av', bg, status = '', listening = false, cls = '', children, stageRef }: StageProps) {
  return (
    <div class={`avatar-stage ${cls}`} id={id} ref={stageRef}>
      <div class="bg" style={{ backgroundImage: `url(${bg ?? uiConfig.stageBg})` }} />
      {status ? (
        <span class={`status${listening ? ' listen' : ''}`}>
          <i />
          {status}
        </span>
      ) : null}
      {listening ? (
        <div class="eq">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}
