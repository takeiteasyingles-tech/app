// Shared plumbing of the content editors: the draft/baseline pair with dirty tracking, the leave
// guard, the sticky save bar (Ctrl+S), id generation for new rows, child-row diffs (mic phrases,
// exercises and their items, test questions, tracks) and the create dialog.
import type { EndpointDef } from '@tie/shared/contracts/http';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { z } from 'zod';
import { call, errorMessage } from '../../api';
import { fmtAgo } from '../../format';
import { setLeaveGuard } from '../../router';
import type { Obj } from '../../ui/form';
import { Icon } from '../../ui/icons';
import { Button, Field, Pill, TextIn } from '../../ui/kit';
import { Modal } from '../../ui/modal';
import { zodErrors } from '../../ui/validate';

// ---------- equality, diffs ----------

/** Deep equality for JSON-like values; key order is ignored and undefined keys count as absent. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => same(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ak.length === bk.length && ak.every((k) => same(ao[k], bo[k]));
}

/** Keys of `next` whose value differs from `base` (a partial update body). */
export function patchOf(base: Obj, next: Obj, keys?: readonly string[]): Obj {
  const out: Obj = {};
  for (const k of keys ?? Object.keys(next))
    if (!same(base[k], next[k])) out[k] = next[k] === undefined ? null : next[k];
  return out;
}

/** Strips keys the update schema does not accept. */
export function pick(o: Obj, keys: readonly string[]): Obj {
  const out: Obj = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
}

export const keysOf = (schema: z.ZodObject): string[] => Object.keys(schema.shape);

/** `prefix` + the next free number after the highest one already used ("e1-mic-" → "e1-mic-7"). */
export function nextId(prefix: string, taken: Iterable<string>): string {
  let max = -1;
  const set = new Set(taken);
  for (const id of set) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  let n = max + 1;
  while (set.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

// ---------- leave guard ----------

export function useLeaveGuard(dirty: boolean): void {
  const ref = useRef(dirty);
  ref.current = dirty;
  useEffect(() => {
    setLeaveGuard(() => !ref.current || window.confirm('Há alterações não salvas. Sair mesmo assim?'));
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!ref.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);
}

/** Ctrl/Cmd+S runs `fn` while mounted. */
export function useSaveShortcut(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// ---------- save bar ----------

export function SaveBar({
  dirty,
  busy,
  onSave,
  onDiscard,
  savedAt,
  errors,
  extra,
}: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  savedAt: number | null;
  errors: number;
  extra?: ComponentChildren;
}) {
  return (
    <section class={`ad-savebar${dirty ? ' dirty' : ''}`} aria-label="Salvar">
      {dirty ? (
        <span class="ad-dirty">Alterações não salvas</span>
      ) : (
        <span class="ad-saved">{savedAt ? `Salvo ${fmtAgo(savedAt)}` : 'Sem alterações'}</span>
      )}
      {errors ? (
        <Pill
          label={`${errors} ${errors === 1 ? 'campo para corrigir' : 'campos para corrigir'}`}
          tone="or"
          icon="alert"
        />
      ) : null}
      <div class="ad-savebar-btns">
        {extra}
        <Button label="Descartar" kind="light" disabled={!dirty || busy} onClick={onDiscard} />
        <Button label="Salvar" icon="check" busy={busy} disabled={!dirty} onClick={onSave} title="Ctrl+S" />
      </div>
    </section>
  );
}

// ---------- status pills ----------

export const EP_STATUS: Record<string, [string, string]> = {
  published: ['Publicado', 'gr'],
  draft: ['Rascunho', 'gold'],
  title_only: ['Só título', ''],
};

export function StatusPill({ status }: { status: string }) {
  const [l, t] = EP_STATUS[status] ?? [status, ''];
  return <Pill label={l} tone={t} />;
}

export function PubPill({ status }: { status: 'draft' | 'published' }) {
  return (
    <Pill label={status === 'published' ? 'Publicado' : 'Rascunho'} tone={status === 'published' ? 'gr' : 'gold'} />
  );
}

export function DraftNote() {
  return (
    <div class="ad-note bl">
      <Icon name="rocket" size={18} /> Edições ficam no rascunho. Os alunos só veem depois de uma publicação
      (Publicações).
    </div>
  );
}

// ---------- child rows ----------

export interface ChildOps<R> {
  create: R[];
  update: { id: string; patch: Obj; row: R }[];
  remove: string[];
}

/** What changed between the saved rows and the edited ones (by id). */
export function diffRows<R extends Obj>(
  base: readonly R[],
  draft: readonly R[],
  idOf: (r: R) => string,
  keys: readonly string[],
): ChildOps<R> {
  const before = new Map(base.map((r) => [idOf(r), r]));
  const after = new Set(draft.map(idOf));
  const out: ChildOps<R> = { create: [], update: [], remove: [] };
  for (const id of before.keys()) if (!after.has(id)) out.remove.push(id);
  for (const r of draft) {
    const b = before.get(idOf(r));
    if (!b) out.create.push(r);
    else {
      const patch = patchOf(pick(b, keys), pick(r, keys), keys);
      if (Object.keys(patch).length) out.update.push({ id: idOf(r), patch, row: r });
    }
  }
  return out;
}

export interface CrudApi {
  list: EndpointDef;
  get: EndpointDef;
  create: EndpointDef;
  update: EndpointDef;
  remove: EndpointDef;
}

/** Calls the typed CRUD endpoints with loose bodies (the forms build them from the shared schemas). */
// biome-ignore lint/suspicious/noExplicitAny: generic over every content entity; bodies are checked by the forms and the server.
const callLoose = call as (ep: EndpointDef, opts?: any) => Promise<unknown>;

export const crud = {
  list: <T,>(api: CrudApi, parent?: string | number, signal?: AbortSignal) =>
    callLoose(api.list, { query: { parent: parent === undefined ? undefined : String(parent) }, signal }) as Promise<{
      items: T[];
    }>,
  get: <T,>(api: CrudApi, id: string | number, signal?: AbortSignal) =>
    callLoose(api.get, { params: { id: String(id) }, signal }) as Promise<{ item: T }>,
  create: <T,>(api: CrudApi, body: Obj) => callLoose(api.create, { body }) as Promise<{ item: T }>,
  update: <T,>(api: CrudApi, id: string | number, body: Obj) =>
    callLoose(api.update, { params: { id: String(id) }, body }) as Promise<{ item: T }>,
  remove: (api: CrudApi, id: string | number) =>
    callLoose(api.remove, { params: { id: String(id) } }) as Promise<{ ok: true }>,
};

/**
 * Applies child-row changes one request at a time: removals, then creations, then updates. Each
 * success moves that row into the baseline (onApplied), so a failure leaves only the rest unsaved.
 */
export async function applyRows<R extends Obj>(
  api: CrudApi,
  ops: ChildOps<R>,
  keys: readonly string[],
  onApplied: (kind: 'create' | 'update' | 'remove', id: string, row: R | null) => void,
  idOf: (r: R) => string,
): Promise<void> {
  for (const id of ops.remove) {
    await crud.remove(api, id);
    onApplied('remove', id, null);
  }
  for (const r of ops.create) {
    const res = await crud.create<R>(api, pick(r, keys));
    onApplied('create', idOf(r), res.item);
  }
  for (const u of ops.update) {
    const res = await crud.update<R>(api, u.id, u.patch);
    onApplied('update', u.id, res.item);
  }
}

/** Replaces/removes one row of a baseline list, keeping the draft's order for new ones. */
export function applyToBase<R extends Obj>(
  base: R[],
  kind: 'create' | 'update' | 'remove',
  id: string,
  row: R | null,
  idOf: (r: R) => string,
): R[] {
  if (kind === 'remove') return base.filter((r) => idOf(r) !== id);
  if (kind === 'create') return row ? [...base, row] : base;
  return base.map((r) => (idOf(r) === id && row ? row : r));
}

/** Errors of each child row, validated with its create schema and keyed under `prefix.i`. */
export function rowErrors(
  schema: z.ZodType,
  rows: readonly Obj[],
  prefix: string,
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  rows.forEach((r, i) => {
    for (const [k, v] of Object.entries(zodErrors(schema, pick(r, keys))))
      out[k ? `${prefix}.${i}.${k}` : `${prefix}.${i}`] = v;
  });
  return out;
}

// ---------- create dialog ----------

/** Asks for the new row's id (and title), creates it from `make` and opens its editor. */
export function CreateModal({
  noun,
  idLabel,
  idHint,
  numeric,
  suggestId,
  onClose,
  create,
}: {
  noun: string;
  idLabel: string;
  idHint: string;
  numeric?: boolean;
  suggestId?: string;
  onClose: () => void;
  create: (id: string, title: string) => Promise<void>;
}) {
  const [id, setId] = useState(suggestId ?? '');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const idOk = numeric ? /^[1-9]\d{0,8}$/.test(id) : /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!idOk || !title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await create(id, title.trim());
    } catch (ex) {
      setErr(errorMessage(ex));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Novo ${noun.toLowerCase()}`}
      onClose={onClose}
      locked={busy}
      foot={
        <>
          <Button label="Cancelar" kind="light" onClick={onClose} />
          <Button
            label="Criar e editar"
            icon="plus"
            type="submit"
            form="create-form"
            busy={busy}
            disabled={!idOk || !title.trim()}
          />
        </>
      }
    >
      <form id="create-form" class="stack" onSubmit={submit} noValidate>
        <Field id="new-id" label={idLabel} hint={idHint} err={id && !idOk ? 'Identificador inválido.' : null}>
          <TextIn
            id="new-id"
            class="ad-mono"
            value={id}
            onValue={setId}
            inputMode={numeric ? 'numeric' : undefined}
            data-autofocus
          />
        </Field>
        <Field id="new-title" label="Título">
          <TextIn id="new-title" value={title} onValue={setTitle} maxLength={200} />
        </Field>
        <p class="xs">O identificador não muda depois. O item nasce como rascunho.</p>
        {err ? (
          <div class="fb err" role="alert">
            {err}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

/** Slug from a title, for suggested ids. */
export const slugify = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
