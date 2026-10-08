// Generic editor page for a content "document": one row plus, optionally, its child rows. Handles the
// load, the tabs (kept in ?aba=), the browser-side validation, the save bar (Ctrl+S), the leave guard,
// deletion and an optional live preview. `persist` saves what changed and returns the new baseline;
// when it fails midway it throws PartialSave with what did land, so only the rest stays unsaved.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { errorMessage, issuesOf } from '../../api';
import { go, setLeaveGuard, setQuery } from '../../router';
import { useLoad } from '../../ui/async';
import { ErrorSummary, Form, type Spec } from '../../ui/form';
import { Button, ErrorBox, Page, Seg, Skeleton } from '../../ui/kit';
import { wide } from '../../ui/layout';
import { confirmAction } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { type Errors, issuesToErrors } from '../../ui/validate';
import { DraftNote, SaveBar, same, useLeaveGuard, useSaveShortcut } from './common';

export class PartialSave<D> extends Error {
  constructor(
    readonly base: D,
    readonly error: unknown,
    readonly stage: string,
    /** Server issues belong to the main row (paths are document paths). */
    readonly rowIssues: boolean,
  ) {
    super(errorMessage(error));
  }
}

export interface DocEditorProps<D extends Record<string, unknown>> {
  load: (signal: AbortSignal) => Promise<D>;
  deps: readonly unknown[];
  title: (d: D) => string;
  kicker: string;
  back: string;
  noun: string;
  tabs?: readonly (readonly [string, string])[];
  tab?: string;
  specs: Readonly<Record<string, readonly Spec[]>>;
  /** All specs (for error labels). */
  allSpecs: readonly Spec[];
  validate: (d: D) => Record<string, string>;
  normalize?: (d: D) => D;
  persist: (base: D, draft: D) => Promise<D>;
  /** Tab of an error path (to jump to the first error). */
  tabOf?: (path: string) => string;
  remove?: { id: string; body: string; run: () => Promise<unknown>; after: string };
  preview?: (d: D, tab: string) => ComponentChildren;
  /** Extra panels after the form (persona, usage notes…). */
  after?: (d: D) => ComponentChildren;
  header?: (d: D) => ComponentChildren;
  idp: string;
}

export function DocEditor<D extends Record<string, unknown>>(p: DocEditorProps<D>) {
  const tabs = p.tabs ?? [];
  const tab = tabs.length ? (tabs.some(([t]) => t === p.tab) ? (p.tab as string) : (tabs[0]?.[0] ?? '')) : '';
  const load = useLoad(p.load, p.deps);
  const [base, setBase] = useState<D | null>(null);
  const [draft, setDraft] = useState<D | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  useEffect(() => {
    if (!load.data) return;
    setBase(load.data);
    setDraft(load.data);
    setErrors({});
  }, [load.data]);
  const dirty = !!(base && draft && !same(base, draft));
  useLeaveGuard(dirty);
  const tabErrors = useMemo(() => {
    const out: Record<string, number> = {};
    if (p.tabOf) for (const k of Object.keys(errors)) out[p.tabOf(k)] = (out[p.tabOf(k)] ?? 0) + 1;
    return out;
  }, [errors]);

  const save = async () => {
    if (!draft || !base || busy || !dirty) return;
    const d = p.normalize ? p.normalize(draft) : draft;
    setDraft(d);
    const errs = p.validate(d);
    setErrors(errs);
    const keys = Object.keys(errs);
    if (keys.length) {
      const first = p.tabOf?.(keys[0] as string);
      if (first && first !== tab) setQuery({ aba: first });
      toast('Há campos para corrigir.', 'warn');
      return;
    }
    setBusy(true);
    try {
      const next = await p.persist(base, d);
      setBase(next);
      setDraft(next);
      setSavedAt(Date.now());
      toast(`${p.noun} salvo no rascunho.`);
    } catch (e) {
      if (e instanceof PartialSave) {
        setBase(e.base as D);
        const iss = issuesOf(e.error);
        if (iss.length && e.rowIssues) setErrors(issuesToErrors(iss));
        toast(`Não deu para salvar ${e.stage}: ${e.message} O resto continua marcado como não salvo.`, 'err');
      } else {
        const iss = issuesOf(e);
        if (iss.length) setErrors(issuesToErrors(iss));
        toast(errorMessage(e), 'err');
      }
    } finally {
      setBusy(false);
    }
  };
  useSaveShortcut(() => void save());

  const remove = p.remove
    ? () => {
        const r = p.remove;
        if (!r) return;
        void confirmAction({
          title: `Excluir ${p.noun.toLowerCase()} ${r.id}?`,
          body: r.body,
          confirm: 'Excluir',
          danger: true,
          typeToConfirm: r.id,
          run: r.run,
        }).then((ok) => {
          if (ok) {
            setLeaveGuard(null);
            toast(`${p.noun} excluído.`);
            go(r.after);
          }
        });
      }
    : null;

  const hasPreview = !!p.preview;
  const showPreview = hasPreview && (wide.value || view === 'preview');
  const showEditor = !hasPreview || wide.value || view === 'edit';
  return (
    <Page
      title={draft ? p.title(draft) : p.noun}
      kicker={p.kicker}
      back={p.back}
      actions={draft && remove ? <Button label="Excluir" icon="trash" kind="ad-danger-l" onClick={remove} /> : null}
      bar={
        tabs.length ? (
          <nav class="ad-tabs" aria-label={`Partes: ${p.noun}`}>
            {tabs.map(([t, l]) => (
              <a
                key={t}
                class={`ad-tab${t === tab ? ' on' : ''}${tabErrors[t] ? ' bad' : ''}`}
                href={`#/${p.back}`}
                aria-current={t === tab ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setQuery({ aba: t });
                }}
              >
                {l}
                {tabErrors[t] ? <span class="dot" aria-label={`${tabErrors[t]} erros`} /> : null}
              </a>
            ))}
          </nav>
        ) : undefined
      }
    >
      {load.error && !load.data ? (
        <ErrorBox error={load.error} retry={load.reload} />
      ) : !draft ? (
        <Skeleton rows={8} />
      ) : (
        <>
          {p.header || (hasPreview && !wide.value) ? (
            <div class="row wrapx" style={{ '--gap': '10px' }}>
              {p.header?.(draft)}
              <span class="grow" />
              {hasPreview && !wide.value ? (
                <Seg
                  label="Modo"
                  value={view}
                  onChange={setView}
                  options={[
                    ['edit', 'Editar'],
                    ['preview', 'Prévia'],
                  ]}
                />
              ) : null}
            </div>
          ) : null}
          <DraftNote />
          <ErrorSummary errors={errors} specs={p.allSpecs} idp={p.idp} />
          <div class={`ad-split${hasPreview ? ' with-preview' : ''}`}>
            {showEditor ? (
              <section class="card ad-card">
                <Form specs={p.specs[tab] ?? p.specs[''] ?? []} value={draft} set={(fn) => setDraft((x) => (x ? fn(x) : x))} errors={errors} idp={p.idp} />
              </section>
            ) : null}
            {showPreview ? p.preview?.(draft, tab) : null}
          </div>
          {p.after?.(draft)}
          <SaveBar
            dirty={dirty}
            busy={busy}
            savedAt={savedAt}
            errors={Object.keys(errors).length}
            onSave={() => void save()}
            onDiscard={() => {
              setDraft(base);
              setErrors({});
            }}
          />
        </>
      )}
    </Page>
  );
}

/** Tab lookup from a {tab: specs} map by the error path's first segment. */
export function tabFinder(specs: Readonly<Record<string, readonly Spec[]>>, fallback: string) {
  return (path: string): string => {
    const head = path.split('.')[0] ?? '';
    for (const [t, list] of Object.entries(specs)) if (list.some((s) => s.k === head)) return t;
    return fallback;
  };
}
