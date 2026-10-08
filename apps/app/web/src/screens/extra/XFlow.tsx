// The EXTRA catalog coverflow: the prototype's C.flow markup (.flow > .item > img + .cap, arrows,
// dots) and behaviour (a side cover comes forward on click, the front one opens, arrows, drag,
// auto-advance), as @tie/ui's Flow. The difference is the desktop arrangement: five readable covers
// in a shallow fan instead of three small ones in the middle of an empty band.
// Each item gets position classes (on, n1/n2, nl/nr) so extra.css can style the captions.
import { type CoverItem, Icon, navigate, uiConfig } from '@tie/ui';
import type { Ref } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Pose {
  x: number;
  z: number;
  rot: number;
  scale: number;
  show: boolean;
}

/** Desktop: a shallow fan (little rotation and depth), so the side covers' captions stay crisp. */
function deskPose(d: number): Pose {
  const ad = Math.abs(d);
  const s = Math.sign(d);
  if (ad === 0) return { x: 0, z: 0, rot: 0, scale: 1, show: true };
  if (ad === 1) return { x: s * 220, z: -40, rot: -s * 12, scale: 0.84, show: true };
  if (ad === 2) return { x: s * 372, z: -80, rot: -s * 18, scale: 0.7, show: true };
  return { x: s * 460, z: -120, rot: -s * 20, scale: 0.6, show: false };
}

/** Phones: the prototype's flowMount numbers (only the front cover and its two neighbours show). */
function phonePose(d: number): Pose {
  const ad = Math.abs(d);
  return { x: d * 120, z: -ad * 160, rot: -d * 28, scale: 1 - ad * 0.08, show: ad <= 1 };
}

export function XFlow({ items, id, auto = 3800 }: { items: readonly CoverItem[]; id: string; auto?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const api = useRef<{ go(d: number): void; set(i: number): void; arm(): void; cur(): number } | null>(null);
  const drag = useRef<{ x: number | null; moved: boolean }>({ x: null, moved: false });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const its = [...el.querySelectorAll<HTMLElement>('.item')];
    const dots = [...el.querySelectorAll<HTMLElement>('[data-dot]')];
    const n = its.length;
    let cur = 0;
    let timer = 0;
    const layout = () => {
      const pose = el.clientWidth > 700 ? deskPose : phonePose;
      its.forEach((it, i) => {
        let d = i - cur;
        if (d > n / 2) d -= n;
        if (d < -n / 2) d += n;
        const ad = Math.abs(d);
        const p = pose(d);
        it.style.transform = `translateX(${p.x}px) translateZ(${p.z}px) rotateY(${p.rot}deg) scale(${p.scale})`;
        it.style.opacity = p.show ? '1' : '0';
        it.style.zIndex = String(10 - ad);
        it.style.pointerEvents = p.show ? '' : 'none';
        it.classList.toggle('on', d === 0);
        it.classList.toggle('n1', ad === 1);
        it.classList.toggle('n2', ad === 2);
        it.classList.toggle('nl', d < 0);
        it.classList.toggle('nr', d > 0);
        it.setAttribute('aria-hidden', p.show ? 'false' : 'true');
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
    // Desktop and phones use different arrangements: lay out again when the width changes.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
    ro?.observe(el);
    return () => {
      clearInterval(timer);
      ro?.disconnect();
      api.current = null;
    };
  }, [items, auto]);

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
    // A drag that ends on a cover is a swipe, not a click.
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
      class="flow x-flow"
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
