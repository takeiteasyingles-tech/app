// DOM parity: each @tie/ui component must produce the same markup as the prototype's C.* helper
// (prototipo/js/ui/components.js, icons.js and avatar2d.js run in node:vm) for the same inputs.
// Accepted differences: data-act/data-go/data-flow (handlers instead of delegation), type="button"
// on buttons, and aria-hidden on the ring's decorative svg.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import {
  AssistPicker,
  AvatarBtn,
  Btn,
  Chip,
  Cover,
  DemoBadge,
  Gamebar,
  ICON_NAMES,
  Icon,
  LevelPill,
  Logo,
  Missions,
  Ring,
  Segs,
  Side,
  Stage,
  Tabbar,
  Toggle,
  Topbar,
  UserPic,
} from '../src/index';
import { type Node, parseHtml, renderVNode, without } from './helpers/canon';

const PROTO = fileURLToPath(new URL('../../../prototipo/js/', import.meta.url));

// biome-ignore lint/suspicious/noExplicitAny: prototype globals are untyped JS
type Any = any;

const G = {
  points: 340,
  streak: 3,
  level: { n: 3, name: 'Aprendiz', from: 250, next: 500, pct: 36 },
  goal: { target: 100, done: 45, pct: 45, hit: false },
};
const ASSISTANTS = [
  { k: 'margaret', name: 'Maggie', full: 'Margaret Woods', tag: 'Calma e paciente', clips: ['idle', 'talk'] },
  { k: 'robert', name: 'Robert', full: 'Robert Woods', tag: 'Direto ao ponto', clips: [] },
];

function loadPrototype(state: { profile: Any; due: number }, online = false): Any {
  const esc = (s: unknown) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
    );
  const sandbox: Any = {
    TIE: {
      u: { esc },
      store: { s: { ...state, settings: { fx: true } } },
      game: { summary: () => G },
      ai: { online },
      data: { STEPS: Array.from({ length: 10 }, (_, i) => ({ n: i + 1 })) },
      assist: {
        list: ASSISTANTS,
        cur: () => ASSISTANTS[0],
        get: (k: string) => ASSISTANTS.find((a) => a.k === k),
      },
    },
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of ['ui/icons.js', 'ui/avatar2d.js', 'ui/components.js']) {
    vm.runInContext(readFileSync(PROTO + f, 'utf8'), ctx, { filename: f });
  }
  return sandbox.TIE;
}

const TIE = loadPrototype({ profile: { avatar: 4, photo: null }, due: 3 });

const intentional = (tag: string, attr: string) => (tag === 'button' && attr === 'type') || attr === 'aria-hidden';
const proto = (html: string): Node[] => without(parseHtml(html), intentional);
const mine = (vnode: unknown): Node[] => without(renderVNode(vnode), intentional);

describe('Icon', () => {
  it('has every prototype icon', () => {
    const src = readFileSync(`${PROTO}ui/icons.js`, 'utf8');
    const names = [...src.matchAll(/^\s+(?:(\w+): '|.*?, (\w+): ')/gm)].length;
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(names);
    expect(ICON_NAMES).toContain('google');
    expect(ICON_NAMES).toContain('apple');
  });

  it.each(ICON_NAMES.map((n) => [n]))('%s renders the same svg', (name) => {
    expect(renderVNode(h(Icon, { name, size: 20 }))).toEqual(parseHtml(TIE.icon(name, 20)));
    expect(renderVNode(h(Icon, { name }))).toEqual(parseHtml(TIE.icon(name)));
  });

  it('passes extra attributes (style)', () => {
    expect(
      renderVNode(h(Icon, { name: 'bell', size: 22, extra: { style: { color: 'var(--blue)', flex: 'none' } } })),
    ).toEqual(parseHtml(TIE.icon('bell', 22, 'style="color:var(--blue);flex:none"')));
  });

  it('renders an empty svg for unknown names', () => {
    expect(renderVNode(h(Icon, { name: 'nope' }))).toEqual(parseHtml(TIE.icon('nope')));
  });
});

describe('components match the prototype markup', () => {
  const C = TIE.C;

  it('logo', () => {
    expect(mine(h(Logo, { size: 20 }))).toEqual(proto(C.logo()));
    expect(mine(h(Logo, { size: 30, desc: true, white: true }))).toEqual(
      proto(C.logo({ size: 30, desc: true, white: true })),
    );
  });

  it('btn', () => {
    expect(mine(h(Btn, { label: 'Entrar', cls: 'block' }))).toEqual(proto(C.btn('Entrar', { cls: 'block' })));
    const o = { kind: 'navy', icon: 'mic', iconR: 'next', cls: 'block', dis: true, kicker: 'Etapa 2 & 3' };
    expect(mine(h(Btn, { label: 'Falar <agora>', ...o }))).toEqual(proto(C.btn('Falar <agora>', o)));
  });

  it('chip and toggle', () => {
    for (const on of [true, false]) {
      expect(mine(h(Chip, { label: 'Séries', on }))).toEqual(proto(C.chip('Séries', { on })));
      expect(mine(h(Toggle, { on, label: 'Som' }))).toEqual(proto(C.toggle(on, 'x', '', 'Som')));
    }
  });

  it('topbar, user picture, avatar button and demo badge', () => {
    expect(mine(h(Topbar, { back: 'inicio', kicker: 'Sua caminhada', title: 'Conquistas' }))).toEqual(
      proto(C.topbar({ back: 'inicio', kicker: 'Sua caminhada', title: 'Conquistas' })),
    );
    const profile = { avatar: 4, photo: null };
    expect(mine(h(Topbar, { kicker: 'Revisão', right: h(AvatarBtn, { profile }) }))).toEqual(
      proto(C.topbar({ kicker: 'Revisão', right: C.avatarBtn() })),
    );
    expect(mine(h(UserPic, { profile, size: 64 }))).toEqual(proto(C.userPic(64)));
    expect(mine(h(DemoBadge, { online: false }))).toEqual(proto(C.demoBadge()));
    expect(mine(h(DemoBadge, { online: true }))).toEqual(proto(loadPrototype({ profile, due: 0 }, true).C.demoBadge()));
  });

  it('segs and ring', () => {
    for (const [cur, reached] of [
      [1, 1],
      [3, 6],
      [10, 10],
    ] as const) {
      expect(mine(h(Segs, { cur, reached }))).toEqual(proto(C.segs(cur, reached)));
    }
    expect(mine(h(Ring, { pct: 40, label: '4/10' }))).toEqual(proto(C.ring(40, '4/10')));
    expect(mine(h(Ring, { pct: 140, label: '9', lg: true, color: 'var(--green)' }))).toEqual(
      proto(C.ring(140, '9', { lg: true, color: 'var(--green)' })),
    );
  });

  it('gamebar, level pill and missions', () => {
    expect(mine(h(Gamebar, { g: G }))).toEqual(proto(C.gamebar()));
    expect(mine(h(LevelPill, { level: G.level }))).toEqual(proto(C.levelpill()));
    const list = [
      { k: 'step', t: 'Fazer 1 etapa do episódio', go: 'episodio/1', done: true },
      { k: 'maggie', t: '2 minutos com a Maggie', go: 'maggie', done: false },
    ];
    expect(mine(h(Missions, { list }))).toEqual(proto(C.missions(list)));
  });

  it('cover', () => {
    const x = { id: 'last-train', title: 'Last Train', kind: 'Série', level: 'A2', cover: 'c.webp', locked: true };
    expect(mine(h(Cover, { x: { ...x, why: 'Porque você curte suspense' } }))).toEqual(
      proto(C.cover({ ...x, why: 'Porque você curte suspense' })),
    );
    expect(mine(h(Cover, { x: { ...x, locked: false, why: 'w' }, why: false }))).toEqual(
      proto(C.cover({ ...x, locked: false, why: 'w' }, { why: false })),
    );
  });

  it('stage', () => {
    expect(
      mine(h(Stage, { status: 'Ouvindo', listening: true, cls: 'big' }, h('div', { class: 'caption' }, 'Hi'))),
    ).toEqual(
      proto(C.stage({ status: 'Ouvindo', listening: true, cls: 'big', caption: '<div class="caption">Hi</div>' })),
    );
    expect(mine(h(Stage, { id: 'x', bg: 'b.webp' }))).toEqual(proto(C.stage({ id: 'x', bg: 'b.webp' })));
  });

  it('tab bar and side nav', () => {
    for (const active of ['inicio', 'revisao', 'conquistas', 'perfil']) {
      expect(mine(h(Tabbar, { active, due: 3 }))).toEqual(proto(C.tabbar(active)));
      expect(mine(h(Side, { active, due: 3, g: G }))).toEqual(proto(C.side(active)));
    }
    const none = loadPrototype({ profile: null, due: 0 }).C;
    expect(mine(h(Tabbar, { active: 'trilha', due: 0 }))).toEqual(proto(none.tabbar('trilha')));
    expect(mine(h(Side, { active: 'trilha', due: 0, g: G }))).toEqual(proto(none.side('trilha')));
  });

  it('assistant picker', () => {
    const list = ASSISTANTS.map((a) => ({
      ...a,
      thumb: `assets/img/gen/avatar/as-${a.k}-thumb.webp`,
      clips: Object.fromEntries(a.clips.map((c) => [c, `${c}.mp4`])),
    }));
    expect(mine(h(AssistPicker, { list, cur: 'margaret', onPick: () => {} }))).toEqual(proto(C.assistPicker('pick')));
  });
});
