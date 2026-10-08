// Canonical markup for parity tests: both the prototype's HTML strings and Preact vnodes are reduced
// to the same normalized form (sorted attributes, normalized style, decoded/merged text), so a test
// can assert that a component produces the prototype's DOM. No DOM library needed.
import { Fragment, type VNode } from 'preact';

export type Node = string | { tag: string; attrs: Record<string, string>; children: Node[] };

/** Attributes that only exist on one side by design (event delegation vs. handlers). */
const IGNORED_ATTRS = new Set(['data-act', 'data-arg', 'data-go', 'data-flow', 'data-model', 'data-ui', 'data-enter']);

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);

const kebab = (k: string) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

function normStyle(s: string): string {
  return s
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return `${d.slice(0, i).trim().toLowerCase()}:${d
        .slice(i + 1)
        .trim()
        .replace(/\s+/g, ' ')}`;
    })
    .join(';');
}

function normAttrs(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(raw).sort()) {
    if (IGNORED_ATTRS.has(k)) continue;
    const v = raw[k] ?? '';
    out[k] = k === 'style' ? normStyle(v) : k === 'class' ? v.trim().split(/\s+/).filter(Boolean).join(' ') : v;
  }
  if (out.style === '') delete out.style;
  return out;
}

function pushText(list: Node[], text: string): void {
  if (!text) return;
  const last = list[list.length - 1];
  if (typeof last === 'string') list[list.length - 1] = last + text;
  else list.push(text);
}

/** Parses the prototype's generated markup (well-formed, double-quoted attributes). */
export function parseHtml(html: string): Node[] {
  const root: Node[] = [];
  const stack: { tag: string; children: Node[] }[] = [{ tag: '#root', children: root }];
  const re = /<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const top = stack[stack.length - 1];
    if (!top) throw new Error('unbalanced markup');
    if (m[1]) {
      if (top.tag !== m[1]) throw new Error(`expected </${top.tag}>, got </${m[1]}>`);
      stack.pop();
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[3] ?? '').matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1] as string] = decode(a[2] ?? '');
      const el = { tag: m[2], attrs: normAttrs(attrs), children: [] as Node[] };
      top.children.push(el);
      if (!m[4] && !VOID.has(m[2])) stack.push(el);
    } else if (m[5]) pushText(top.children, decode(m[5]));
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]?.tag}>`);
  return root;
}

function propToAttr(k: string, v: unknown): [string, string] | null {
  if (k === 'children' || k === 'key' || k === 'ref' || /^on[A-Z]/.test(k)) return null;
  if (v === false || v === null || v === undefined) return null;
  if (k === 'className') k = 'class';
  if (k === 'style' && typeof v === 'object') {
    const css = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined && x !== '')
      .map(([p, x]) => `${kebab(p)}:${String(x)}`)
      .join(';');
    return ['style', css];
  }
  return [k, v === true ? '' : String(v)];
}

/** Renders hook-free components to canonical nodes (function components are called directly). */
export function renderVNode(v: unknown, out: Node[] = []): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return out;
  if (typeof v === 'string' || typeof v === 'number') {
    pushText(out, String(v));
    return out;
  }
  if (Array.isArray(v)) {
    for (const c of v) renderVNode(c, out);
    return out;
  }
  const node = v as VNode<Record<string, unknown>>;
  const props = (node.props ?? {}) as Record<string, unknown>;
  if (node.type === Fragment) return renderVNode(props.children, out);
  if (typeof node.type === 'function') {
    const fn = node.type as (p: unknown) => unknown;
    return renderVNode(fn(props), out);
  }
  const attrs: Record<string, string> = {};
  for (const [k, val] of Object.entries(props)) {
    const a = propToAttr(k, val);
    if (a) attrs[a[0]] = a[1];
  }
  out.push({ tag: String(node.type), attrs: normAttrs(attrs), children: renderVNode(props.children) });
  return out;
}

/** Drops attributes that a test accepts as intentional differences, recursively. */
export function without(nodes: Node[], drop: (tag: string, attr: string, value: string) => boolean): Node[] {
  return nodes.map((n) => {
    if (typeof n === 'string') return n;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.attrs)) if (!drop(n.tag, k, v)) attrs[k] = v;
    return { tag: n.tag, attrs, children: without(n.children, drop) };
  });
}
