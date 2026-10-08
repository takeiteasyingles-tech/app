// Declarative forms for the content editors. A screen describes its row with a Spec[] (text, numbers,
// toggles, selects, media, chip lists, nested lists of objects…) and <Form> renders the inputs, keeps
// the value immutable, and shows each error under its field by dotted path ("dialog.3.en"). Lists can
// be reordered, duplicated and removed; long lists collapse to one summary line per item.
import type { ComponentChildren, VNode } from 'preact';
import { createContext } from 'preact';
import { memo } from 'preact/compat';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import { Area, Field, IconButton, Sel, Switch, TextIn } from './kit';
import { MediaField, type MediaKind } from './media';
import { type Errors, errorKey } from './validate';

export type Obj = Record<string, unknown>;
export type Path = readonly (string | number)[];
/** How an empty optional value is stored: left out (`.optional()`) or null (`.nullable()`). */
export type Opt = 'undef' | 'null';

interface Base {
  k: string;
  label: string;
  hint?: string;
  /** Spans the whole form row. */
  wide?: boolean;
  opt?: Opt;
  /** Shown only when this returns true for the parent object. */
  when?: (parent: Obj) => boolean;
  ro?: boolean;
}

export type Spec =
  | (Base & { t: 'text'; rows?: number; ph?: string; max?: number; mono?: boolean })
  | (Base & { t: 'int' | 'num'; min?: number; max?: number; step?: number; ph?: string })
  | (Base & { t: 'bool' })
  | (Base & { t: 'select'; options: readonly (readonly [string, string])[]; num?: boolean })
  | (Base & { t: 'media'; kind: MediaKind })
  | (Base & { t: 'strings'; ph?: string; suggest?: readonly string[] })
  | (Base & { t: 'lines'; rows?: number; ph?: string })
  | (Base & { t: 'color' })
  | (Base & {
      t: 'choices';
      /** Key of the correct option's index in the parent. */
      answer: string;
      min?: number;
      max?: number;
    })
  | (Base & {
      t: 'list';
      of: readonly Spec[];
      /** Singular noun for buttons ("linha", "bloco"). */
      item: string;
      summary?: (v: Obj, i: number) => string;
      /** One compact line per item instead of a collapsible card. */
      inline?: boolean;
      max?: number;
      make?: () => Obj;
      /** Items start open (short lists). */
      open?: boolean;
      /** The rows are a fixed set: no add, remove or reorder. */
      fixed?: boolean;
    })
  | (Base & { t: 'obj'; of: readonly Spec[]; make?: () => Obj })
  | (Base & { t: 'custom'; render: (p: CustomProps) => VNode | null });

export interface CustomProps {
  value: unknown;
  parent: Obj;
  set: (v: unknown) => void;
  path: Path;
  id: string;
  err: string | null;
}

// ---------- immutable path updates ----------

export function setIn(root: unknown, path: Path, value: unknown): unknown {
  if (!path.length) return value;
  const [h, ...rest] = path;
  if (typeof h === 'number') {
    const arr = Array.isArray(root) ? [...root] : [];
    arr[h] = setIn(arr[h], rest, value);
    return arr;
  }
  const obj: Obj = root && typeof root === 'object' && !Array.isArray(root) ? { ...(root as Obj) } : {};
  const v = setIn(obj[h as string], rest, value);
  if (v === undefined) delete obj[h as string];
  else obj[h as string] = v;
  return obj;
}

export function getIn(root: unknown, path: Path): unknown {
  let cur = root;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

const pathStr = (p: Path) => p.join('.');

/** Default value of a new list item / object, from its specs. */
export function blank(specs: readonly Spec[]): Obj {
  const o: Obj = {};
  for (const s of specs) {
    if (s.opt === 'undef') continue;
    if (s.opt === 'null') {
      o[s.k] = null;
      continue;
    }
    switch (s.t) {
      case 'text':
      case 'color':
        o[s.k] = s.t === 'color' ? '#0F2A55' : '';
        break;
      case 'int':
      case 'num':
        o[s.k] = s.min ?? 0;
        break;
      case 'bool':
        o[s.k] = false;
        break;
      case 'select':
        o[s.k] = s.num ? Number(s.options[0]?.[0] ?? 0) : (s.options[0]?.[0] ?? '');
        break;
      case 'media':
        o[s.k] = null;
        break;
      case 'strings':
      case 'lines':
      case 'list':
        o[s.k] = [];
        break;
      case 'choices':
        o[s.k] = ['', ''];
        break;
      case 'obj':
        o[s.k] = s.make ? s.make() : blank(s.of);
        break;
      default:
        break;
    }
  }
  return o;
}

// ---------- context ----------

interface Ctx {
  set: (path: Path, v: unknown) => void;
  idp: string;
  errors: Errors;
  root: readonly Spec[];
}

const FormCtx = createContext<Ctx | null>(null);

function useForm(): Ctx {
  const c = useContext(FormCtx);
  if (!c) throw new Error('form field outside <Form>');
  return c;
}

export const fieldId = (idp: string, path: Path): string => `${idp}-${pathStr(path).replace(/[^\w-]/g, '-')}`;

export interface FormProps<T> {
  specs: readonly Spec[];
  value: T;
  /** A state setter: receives an updater. */
  set: (fn: (prev: T) => T) => void;
  errors?: Errors;
  /** Prefix of every input id (unique per form on a page). */
  idp: string;
  /** Path of `value` inside a larger document (errors are keyed from the root). */
  base?: Path;
  cls?: string;
}

export function Form<T>({ specs, value, set, errors = {}, idp, base = [], cls = '' }: FormProps<T>) {
  const setRef = useRef(set);
  setRef.current = set;
  const ctx = useMemo<Ctx>(
    () => ({
      set: (path, v) => setRef.current((prev) => setIn(prev, path.slice(base.length), v) as T),
      idp,
      errors,
      root: specs,
    }),
    [idp, errors, specs],
  );
  return (
    <FormCtx.Provider value={ctx}>
      <Fields specs={specs} value={value as Obj} path={base} cls={cls} />
    </FormCtx.Provider>
  );
}

export function Fields({
  specs,
  value,
  path,
  cls = '',
}: {
  specs: readonly Spec[];
  value: Obj;
  path: Path;
  cls?: string;
}) {
  const obj = value && typeof value === 'object' ? value : {};
  return (
    <div class={`ad-grid ${cls}`}>
      {specs.map((s) =>
        s.when && !s.when(obj) ? null : <FieldView key={s.k} spec={s} parent={obj} path={[...path, s.k]} />,
      )}
    </div>
  );
}

function emptyAs(opt: Opt | undefined): unknown {
  return opt === 'undef' ? undefined : opt === 'null' ? null : '';
}

function FieldView({ spec, parent, path }: { spec: Spec; parent: Obj; path: Path }) {
  const ctx = useForm();
  const v = parent[spec.k];
  const id = fieldId(ctx.idp, path);
  const err = ctx.errors[pathStr(path)] ?? null;
  const set = (x: unknown) => ctx.set(path, x);
  const optional = !!spec.opt;
  switch (spec.t) {
    case 'text':
      return (
        <Field
          id={id}
          label={spec.label}
          hint={spec.hint}
          err={err}
          opt={optional}
          wide={spec.wide || (spec.rows ?? 0) > 1}
        >
          {spec.rows && spec.rows > 1 ? (
            <Area
              id={id}
              value={v == null ? '' : String(v)}
              rows={spec.rows}
              mono={spec.mono}
              maxLength={spec.max}
              placeholder={spec.ph}
              err={err}
              onValue={(s) => set(s === '' ? emptyAs(spec.opt) : s)}
            />
          ) : (
            <TextIn
              id={id}
              value={v == null ? '' : String(v)}
              placeholder={spec.ph}
              maxLength={spec.max}
              readOnly={spec.ro}
              class={spec.mono ? 'ad-mono' : ''}
              err={err}
              onValue={(s) => set(s === '' ? emptyAs(spec.opt) : s)}
            />
          )}
        </Field>
      );
    case 'int':
    case 'num':
      return (
        <Field id={id} label={spec.label} hint={spec.hint} err={err} opt={optional} wide={spec.wide}>
          <TextIn
            id={id}
            type="number"
            inputMode={spec.t === 'int' ? 'numeric' : 'decimal'}
            step={spec.step ?? (spec.t === 'int' ? 1 : 'any')}
            min={spec.min}
            max={spec.max}
            placeholder={spec.ph}
            readOnly={spec.ro}
            value={v == null || Number.isNaN(v) ? '' : String(v)}
            err={err}
            onValue={(s) => {
              if (s.trim() === '') return set(spec.opt === 'undef' ? undefined : null);
              const n = spec.t === 'int' ? Number.parseInt(s, 10) : Number.parseFloat(s);
              if (Number.isFinite(n)) set(n);
            }}
          />
        </Field>
      );
    case 'bool':
      return (
        <div class={`ad-f ad-bool ${spec.wide ? 'ad-span' : ''}`}>
          <Switch
            id={id}
            on={!!v}
            label={spec.label}
            onChange={(on) => set(on ? true : spec.opt === 'undef' ? undefined : false)}
          />
          <label for={id} class="grow">
            <span class="ad-bool-l">{spec.label}</span>
            {spec.hint ? <small class="xs">{spec.hint}</small> : null}
          </label>
          {err ? <span class="err">{err}</span> : null}
        </div>
      );
    case 'select': {
      const opts: (readonly [string, string])[] = optional ? [['', '—'], ...spec.options] : [...spec.options];
      const cur = v == null ? '' : String(v);
      if (cur && !opts.some(([o]) => o === cur)) opts.push([cur, `${cur} (atual)`]);
      return (
        <Field id={id} label={spec.label} hint={spec.hint} err={err} opt={optional} wide={spec.wide}>
          <Sel
            id={id}
            value={cur}
            options={opts}
            err={err}
            onValue={(s) => set(s === '' ? emptyAs(spec.opt) : spec.num ? Number(s) : s)}
          />
        </Field>
      );
    }
    case 'media':
      return (
        <Field id={id} label={spec.label} hint={spec.hint} err={err} opt={optional} wide={spec.wide ?? true}>
          <MediaField
            id={id}
            kind={spec.kind}
            value={typeof v === 'string' ? v : null}
            err={err}
            onChange={(x) => set(x === null && spec.opt === 'undef' ? undefined : x)}
          />
        </Field>
      );
    case 'strings':
      return (
        <Field id={id} label={spec.label} hint={spec.hint} err={err} opt={optional} wide={spec.wide}>
          <Chips
            id={id}
            value={Array.isArray(v) ? (v as string[]) : []}
            ph={spec.ph}
            suggest={spec.suggest}
            err={err}
            errors={ctx.errors}
            path={path}
            onChange={(arr) => set(arr.length ? arr : spec.opt ? emptyAs(spec.opt) : [])}
          />
        </Field>
      );
    case 'lines':
      return (
        <Field
          id={id}
          label={spec.label}
          hint={spec.hint ?? 'Um item por linha.'}
          err={err ?? childErr(ctx.errors, path)}
          opt={optional}
          wide
        >
          <Lines
            id={id}
            value={Array.isArray(v) ? (v as string[]) : []}
            rows={spec.rows ?? 4}
            ph={spec.ph}
            onChange={(arr) => set(arr.length ? arr : spec.opt ? emptyAs(spec.opt) : [])}
          />
        </Field>
      );
    case 'color':
      return (
        <Field id={id} label={spec.label} hint={spec.hint} err={err} wide={spec.wide}>
          <div class="row" style={{ '--gap': '8px' }}>
            <input
              type="color"
              class="ad-color"
              aria-label={`${spec.label} (seletor)`}
              value={typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'}
              onInput={(e) => set((e.currentTarget as HTMLInputElement).value.toUpperCase())}
            />
            <TextIn
              id={id}
              class="ad-mono"
              value={typeof v === 'string' ? v : ''}
              err={err}
              maxLength={7}
              onValue={(s) => set(s)}
            />
          </div>
        </Field>
      );
    case 'choices':
      return <Choices spec={spec} parent={parent} path={path} id={id} />;
    case 'list':
      return <ListView spec={spec} value={v} path={path} />;
    case 'obj':
      return <ObjView spec={spec} value={v} path={path} />;
    case 'custom':
      return spec.render({ value: v, parent, set, path, id, err });
    default:
      return null;
  }
}

function childErr(errors: Errors, path: Path): string | null {
  const p = `${pathStr(path)}.`;
  for (const k in errors) if (k.startsWith(p)) return errors[k] ?? null;
  return null;
}

// ---------- chips / lines / choices ----------

function Chips({
  id,
  value,
  onChange,
  ph,
  suggest,
  err,
  errors,
  path,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  ph?: string;
  suggest?: readonly string[];
  err: string | null;
  errors: Errors;
  path: Path;
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setText('');
  };
  const listId = `${id}-sug`;
  const itemErr = childErr(errors, path);
  return (
    <div class={`ad-chipin${err || itemErr ? ' bad' : ''}`}>
      {value.map((s, i) => (
        <span key={`${s}-${i}`} class="ad-chipv">
          {s}
          <button type="button" aria-label={`Remover ${s}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        class="ad-chipin-i"
        value={text}
        placeholder={value.length ? '' : (ph ?? 'Digite e tecle Enter')}
        list={suggest?.length ? listId : undefined}
        onInput={(e) => {
          const t = (e.currentTarget as HTMLInputElement).value;
          if (t.endsWith(',')) add(t);
          else setText(t);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      {suggest?.length ? (
        <datalist id={listId}>
          {suggest.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      {itemErr && !err ? <span class="err">{itemErr}</span> : null}
    </div>
  );
}

const splitLines = (t: string) =>
  t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function Lines({
  id,
  value,
  onChange,
  rows,
  ph,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  rows: number;
  ph?: string;
}) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    if (splitLines(text).join('\n') !== value.join('\n')) setText(value.join('\n'));
  }, [value]);
  return (
    <Area
      id={id}
      value={text}
      rows={Math.max(rows, Math.min(12, value.length + 1))}
      placeholder={ph}
      onValue={(t) => {
        setText(t);
        onChange(splitLines(t));
      }}
    />
  );
}

function Choices({
  spec,
  parent,
  path,
  id,
}: {
  spec: Extract<Spec, { t: 'choices' }>;
  parent: Obj;
  path: Path;
  id: string;
}) {
  const ctx = useForm();
  const raw = parent[spec.k];
  const opts = Array.isArray(raw) ? (raw as string[]) : null;
  const answerPath = [...path.slice(0, -1), spec.answer];
  const answer = typeof parent[spec.answer] === 'number' ? (parent[spec.answer] as number) : null;
  const max = spec.max ?? 4;
  const min = spec.min ?? 2;
  const err = ctx.errors[pathStr(path)] ?? ctx.errors[pathStr(answerPath)] ?? childErr(ctx.errors, path);
  const setOpts = (next: string[] | null, nextAnswer: number | null) => {
    ctx.set(path, next);
    ctx.set(answerPath, nextAnswer);
  };
  if (!opts) {
    return (
      <div class="ad-f ad-span">
        <span class="ad-flabel">{spec.label}</span>
        <div class="row wrapx">
          <span class="xs grow">Sem opções (a resposta é digitada).</span>
          <button type="button" class="btn compact light" onClick={() => setOpts(['', ''], 0)}>
            <Icon name="plus" size={16} />
            <span>Usar opções</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <fieldset class="ad-f ad-span ad-choices">
      <legend class="ad-flabel">
        {spec.label} <span class="xs">· marque a certa</span>
      </legend>
      {opts.map((o, i) => (
        <div key={i} class={`ad-choice${answer === i ? ' right' : ''}`}>
          <input
            type="radio"
            name={`${id}-ans`}
            id={`${id}-r${i}`}
            checked={answer === i}
            aria-label={`Opção ${i + 1} é a resposta certa`}
            onChange={() => ctx.set(answerPath, i)}
          />
          <span class="ad-choice-k">{String.fromCharCode(65 + i)}</span>
          <input
            id={i === 0 ? id : `${id}-${i}`}
            class="input ad-in grow"
            value={o}
            aria-label={`Opção ${String.fromCharCode(65 + i)}`}
            onInput={(e) => ctx.set([...path, i], (e.currentTarget as HTMLInputElement).value)}
          />
          <IconButton
            icon="close"
            label={`Remover a opção ${String.fromCharCode(65 + i)}`}
            disabled={opts.length <= min}
            onClick={() => {
              const next = opts.filter((_, j) => j !== i);
              const a = answer == null ? 0 : answer === i ? 0 : answer > i ? answer - 1 : answer;
              setOpts(next, Math.min(a, next.length - 1));
            }}
          />
        </div>
      ))}
      <div class="row wrapx">
        {opts.length < max ? (
          <button type="button" class="btn compact light" onClick={() => setOpts([...opts, ''], answer ?? 0)}>
            <Icon name="plus" size={16} />
            <span>Opção</span>
          </button>
        ) : null}
        {spec.opt ? (
          <button type="button" class="btn compact link" onClick={() => setOpts(null, null)}>
            Sem opções (resposta digitada)
          </button>
        ) : null}
      </div>
      {err ? <span class="err">{err}</span> : null}
    </fieldset>
  );
}

// ---------- nested objects ----------

function ObjView({ spec, value, path }: { spec: Extract<Spec, { t: 'obj' }>; value: unknown; path: Path }) {
  const ctx = useForm();
  const obj = value && typeof value === 'object' ? (value as Obj) : null;
  const ek = errorKey(ctx.errors, pathStr(path));
  if (!obj) {
    return (
      <div class="ad-f ad-span ad-objnull">
        <span class="ad-flabel">{spec.label}</span>
        <div class="row wrapx">
          <span class="xs grow">{spec.hint ?? 'Não definido.'}</span>
          <button
            type="button"
            class="btn compact light"
            onClick={() => ctx.set(path, spec.make ? spec.make() : blank(spec.of))}
          >
            <Icon name="plus" size={16} />
            <span>Adicionar</span>
          </button>
        </div>
        {ek ? <span class="err">{ctx.errors[pathStr(path)] ?? 'Obrigatório.'}</span> : null}
      </div>
    );
  }
  return (
    <fieldset class="ad-span ad-obj">
      <legend class="ad-flabel">{spec.label}</legend>
      {spec.opt ? (
        <button type="button" class="btn compact link ad-obj-x" onClick={() => ctx.set(path, emptyAs(spec.opt))}>
          Remover
        </button>
      ) : null}
      <Fields specs={spec.of} value={obj} path={path} />
    </fieldset>
  );
}

// ---------- lists ----------

function summaryOf(spec: Extract<Spec, { t: 'list' }>, v: Obj, i: number): string {
  if (spec.summary) return spec.summary(v, i);
  for (const s of spec.of) {
    const x = v[s.k];
    if ((s.t === 'text' || s.t === 'select') && typeof x === 'string' && x.trim()) return x;
  }
  return '';
}

interface ListOps {
  up(i: number): void;
  down(i: number): void;
  dup(i: number): void;
  remove(i: number): void;
}

function ListView({ spec, value, path }: { spec: Extract<Spec, { t: 'list' }>; value: unknown; path: Path }) {
  const ctx = useForm();
  const arr = (Array.isArray(value) ? value : []) as Obj[];
  const [added, setAdded] = useState<number | null>(null);
  const ownErr = ctx.errors[pathStr(path)] ?? null;
  const live = useRef({ arr, ctx, path, spec });
  live.current = { arr, ctx, path, spec };
  const setArr = (next: Obj[]) => {
    const l = live.current;
    l.ctx.set(l.path, next.length || !l.spec.opt ? next : emptyAs(l.spec.opt));
  };
  // Stable across renders, so unchanged items skip re-rendering (memo) while one is edited.
  const ops = useMemo<ListOps>(() => {
    const swap = (i: number, j: number) => {
      const next = [...live.current.arr];
      const a = next[i] as Obj;
      next[i] = next[j] as Obj;
      next[j] = a;
      setArr(next);
    };
    return {
      up: (i) => swap(i, i - 1),
      down: (i) => swap(i, i + 1),
      dup: (i) => {
        const cur = live.current.arr;
        const copy = JSON.parse(JSON.stringify(cur[i])) as Obj;
        delete copy.id;
        setArr([...cur.slice(0, i + 1), copy, ...cur.slice(i + 1)]);
      },
      remove: (i) => setArr(live.current.arr.filter((_, j) => j !== i)),
    };
  }, []);
  const add = () => {
    setAdded(arr.length);
    setArr([...arr, spec.make ? spec.make() : blank(spec.of)]);
  };
  const full = spec.fixed || (spec.max !== undefined && arr.length >= spec.max);
  return (
    <section class="ad-span ad-list" aria-label={spec.label}>
      <div class="ad-list-h">
        <h3 class="ad-flabel">
          {spec.label} <span class="ad-count">{arr.length}</span>
        </h3>
        {spec.hint ? <span class="xs">{spec.hint}</span> : null}
      </div>
      {ownErr ? <span class="err">{ownErr}</span> : null}
      {spec.inline && arr.length ? (
        <div class="ad-inline-head" aria-hidden="true">
          <span>#</span>
          {spec.of.map((s) => (
            <span key={s.k}>{s.label}</span>
          ))}
          <span />
        </div>
      ) : null}
      <div
        class={spec.inline ? 'ad-inline-rows' : 'stack'}
        style={{ '--gap': '8px', '--cols': String(spec.of.length) }}
      >
        {arr.map((item, i) => {
          const p = [...path, i];
          const ek = errorKey(ctx.errors, pathStr(p));
          return spec.inline ? (
            <InlineRow key={i} spec={spec} value={item} path={p} n={arr.length} ek={ek} ops={ops} />
          ) : (
            <ItemView
              key={i}
              spec={spec}
              value={item}
              path={p}
              n={arr.length}
              ek={ek}
              ops={ops}
              initialOpen={spec.open || added === i}
            />
          );
        })}
      </div>
      {!arr.length ? <div class="xs ad-list-empty">Nenhum item ainda.</div> : null}
      {!full ? (
        <div>
          <button type="button" class="btn compact light ad-add" onClick={add}>
            <Icon name="plus" size={16} />
            <span>Adicionar {spec.item}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface ItemProps {
  spec: Extract<Spec, { t: 'list' }>;
  value: Obj;
  path: Path;
  n: number;
  ek: string;
  ops: ListOps;
  initialOpen?: boolean;
}

function ItemActions({ i, n, label, ops }: { i: number; n: number; label: string; ops: ListOps }) {
  return (
    <div class="ad-item-a">
      <IconButton icon="moveUp" label={`Subir ${label} ${i + 1}`} disabled={i === 0} onClick={() => ops.up(i)} />
      <IconButton
        icon="moveDown"
        label={`Descer ${label} ${i + 1}`}
        disabled={i === n - 1}
        onClick={() => ops.down(i)}
      />
      <IconButton icon="dup" label={`Duplicar ${label} ${i + 1}`} onClick={() => ops.dup(i)} />
      <IconButton icon="trash" cls="danger" label={`Remover ${label} ${i + 1}`} onClick={() => ops.remove(i)} />
    </div>
  );
}

const sameItem = (a: ItemProps, b: ItemProps) =>
  a.value === b.value &&
  a.ek === b.ek &&
  a.n === b.n &&
  a.ops === b.ops &&
  a.spec === b.spec &&
  pathStr(a.path) === pathStr(b.path);

const ItemView = memo(function ItemView({ spec, value, path, n, ek, ops, initialOpen }: ItemProps) {
  const [open, setOpen] = useState(!!initialOpen);
  const i = path[path.length - 1] as number;
  useEffect(() => {
    if (ek) setOpen(true);
  }, [ek]);
  const sum = summaryOf(spec, value, i);
  const ctx = useForm();
  const bodyId = `${fieldId(ctx.idp, path)}-body`;
  return (
    <div class={`ad-item${open ? ' open' : ''}${ek ? ' bad' : ''}`}>
      <div class="ad-item-h">
        <button
          type="button"
          class="ad-item-t"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <span class="ad-item-n">{i + 1}</span>
          <span class="grow ad-ell">{sum || <i class="muted">{`${spec.item} sem texto`}</i>}</span>
          {ek ? <span class="pill bl">corrigir</span> : null}
          <span class="ad-item-tg" aria-hidden="true">
            {open ? 'Fechar' : 'Editar'}
            <Icon name={open ? 'up' : 'down'} size={14} />
          </span>
        </button>
        {spec.fixed ? null : <ItemActions i={i} n={n} label={spec.item} ops={ops} />}
      </div>
      {open ? (
        <div class="ad-item-b" id={bodyId}>
          <Fields specs={spec.of} value={value} path={path} />
        </div>
      ) : null}
    </div>
  );
}, sameItem);

const InlineRow = memo(function InlineRow({ spec, value, path, n, ek, ops }: ItemProps) {
  const i = path[path.length - 1] as number;
  return (
    <div class={`ad-irow${ek ? ' bad' : ''}`}>
      <span class="ad-item-n">{i + 1}</span>
      {spec.of.map((s) => (
        <InlineCell key={s.k} spec={s} parent={value} path={[...path, s.k]} listLabel={spec.label} i={i} />
      ))}
      {spec.fixed ? <span /> : <ItemActions i={i} n={n} label={spec.item} ops={ops} />}
    </div>
  );
}, sameItem);

function InlineCell({
  spec,
  parent,
  path,
  listLabel,
  i,
}: {
  spec: Spec;
  parent: Obj;
  path: Path;
  listLabel: string;
  i: number;
}) {
  const ctx = useForm();
  const id = fieldId(ctx.idp, path);
  const v = parent[spec.k];
  const err = ctx.errors[pathStr(path)] ?? null;
  const label = `${listLabel} ${i + 1}: ${spec.label}`;
  const set = (x: unknown) => ctx.set(path, x);
  let input: ComponentChildren;
  if (spec.t === 'custom') {
    input = spec.render({ value: v, parent, set, path, id, err });
  } else if (spec.t === 'bool') {
    input = (
      <Switch
        id={id}
        on={!!v}
        label={label}
        onChange={(on) => set(on ? true : spec.opt === 'undef' ? undefined : false)}
      />
    );
  } else if (spec.t === 'select') {
    input = (
      <Sel
        id={id}
        ariaLabel={label}
        value={v == null ? '' : String(v)}
        options={spec.opt ? [['', '—'], ...spec.options] : spec.options}
        onValue={(s) => set(s === '' ? emptyAs(spec.opt) : spec.num ? Number(s) : s)}
      />
    );
  } else if (spec.t === 'int' || spec.t === 'num') {
    input = (
      <TextIn
        id={id}
        type="number"
        aria-label={label}
        value={v == null ? '' : String(v)}
        err={err}
        onValue={(s) => {
          if (s.trim() === '') return set(spec.opt === 'undef' ? undefined : null);
          const nn = Number(s);
          if (Number.isFinite(nn)) set(nn);
        }}
      />
    );
  } else {
    input = (
      <TextIn
        id={id}
        aria-label={label}
        placeholder={spec.label}
        readOnly={spec.ro}
        class={spec.t === 'text' && spec.mono ? 'ad-mono' : ''}
        value={v == null ? '' : String(v)}
        err={err}
        onValue={(s) => set(s === '' ? emptyAs(spec.opt) : s)}
      />
    );
  }
  return (
    <div class="ad-icell">
      {input}
      {err ? (
        <span class="err" id={`${id}-err`}>
          {err}
        </span>
      ) : null}
    </div>
  );
}

// ---------- error summary ----------

/** Human label of an error path, from the specs: "Diálogo › fala 4 › Inglês". */
export function describePath(specs: readonly Spec[], path: string): string {
  const parts = path.split('.');
  const out: string[] = [];
  let cur: readonly Spec[] | null = specs;
  let listItem: string | null = null;
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      out.push(`${listItem ?? 'item'} ${Number(p) + 1}`);
      continue;
    }
    const s: Spec | undefined = cur?.find((x) => x.k === p);
    if (!s) {
      out.push(p);
      cur = null;
      continue;
    }
    out.push(s.label);
    if (s.t === 'list') {
      cur = s.of;
      listItem = s.item;
    } else if (s.t === 'obj') {
      cur = s.of;
    } else cur = null;
  }
  return out.join(' › ');
}

export function ErrorSummary({
  errors,
  specs,
  idp,
  title = 'Corrija antes de salvar',
}: {
  errors: Errors;
  specs: readonly Spec[];
  idp: string;
  title?: string;
}) {
  const keys = Object.keys(errors);
  if (!keys.length) return null;
  const jump = (k: string) => {
    requestAnimationFrame(() => {
      const el = document.getElementById(fieldId(idp, k.split('.')));
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.focus();
      }
    });
  };
  return (
    <div class="ad-errsum" role="alert">
      <div class="h3">
        {title} · {keys.length} {keys.length === 1 ? 'campo' : 'campos'}
      </div>
      <ul>
        {keys.slice(0, 8).map((k) => (
          <li key={k}>
            <button type="button" class="ad-linkbtn" onClick={() => jump(k)}>
              {k ? describePath(specs, k) : 'Geral'}
            </button>
            : {errors[k]}
          </li>
        ))}
        {keys.length > 8 ? <li class="xs">e mais {keys.length - 8}…</li> : null}
      </ul>
    </div>
  );
}
