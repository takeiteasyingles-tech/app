// Editor de episódio: every part of the 10 steps as structured forms (lyrics, scene words, dialogue,
// Mic phrases, lesson blocks, pronunciation, Take Away, exercises and their questions, the done card,
// media pickers), one tab per part, with a live preview in the student app's own styles. The episode
// row and its child rows (mic_phrases, exercises, exercise_items) save together; each request that
// lands moves into the saved baseline, so a refusal (e.g. a phrase with learner scores) leaves only
// the rest marked unsaved.
import {
  adminContentApi,
  EpisodeEdit as EpisodeEditSchema,
  type EpisodeRow,
  ExerciseEdit,
  type ExerciseItemRow,
  ExerciseItemEdit,
  type ExerciseRow,
  MicPhraseEdit,
  type MicPhraseRow,
} from '@tie/shared/contracts/admin';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { call, errorMessage, issuesOf } from '../../api';
import { fmtAgo, fmtDateTime } from '../../format';
import { useEmails } from '../../people';
import { go, setLeaveGuard, setQuery } from '../../router';
import { useLoad } from '../../ui/async';
import { ErrorSummary, Form, type Obj } from '../../ui/form';
import { Icon } from '../../ui/icons';
import { Button, ErrorBox, Page, Seg, Skeleton } from '../../ui/kit';
import { wide } from '../../ui/layout';
import { confirmAction } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { type Errors, issuesToErrors, prefixErrors, zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import {
  applyRows,
  applyToBase,
  type CrudApi,
  DraftNote,
  diffRows,
  keysOf,
  nextId,
  patchOf,
  pick,
  SaveBar,
  StatusPill,
  same,
  useLeaveGuard,
  useSaveShortcut,
} from './common';
import { EpisodePreview } from './EpisodePreview';
import { ALL_SPECS, TAB_SPECS, TABS, type TabId, tabOf } from './episodeSpecs';

type Ex = ExerciseRow & { items: ExerciseItemRow[] };
type Doc = Obj & { num: number; mic: MicPhraseRow[]; ex: Ex[] };

const EP_KEYS = keysOf(EpisodeEditSchema.create);
const MIC_KEYS = keysOf(MicPhraseEdit.create);
const EX_KEYS = keysOf(ExerciseEdit.create);
const ITEM_KEYS = keysOf(ExerciseItemEdit.create);
const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;
const C = adminContentApi;

/** Ids, parents and order for every row (new rows get the seed's id pattern). */
function normalize(d: Doc): Doc {
  const num = d.num;
  const withIds = (list: unknown, prefix: string): Obj[] => {
    const rows = (Array.isArray(list) ? list : []) as Obj[];
    const taken = rows.map((r) => (typeof r.id === 'string' ? r.id : '')).filter(Boolean);
    return rows.map((r) => {
      if (typeof r.id === 'string' && r.id) return r;
      const id = nextId(prefix, taken);
      taken.push(id);
      return { id, ...r };
    });
  };
  const micTaken = d.mic.map((m) => m.id).filter(Boolean);
  const mic = d.mic.map((m, i) => {
    let id = m.id;
    if (!id) {
      id = nextId(`e${num}-mic-`, micTaken);
      micTaken.push(id);
    }
    return { ...m, id, episodeNum: num, sort: i };
  });
  const exTaken = d.ex.map((x) => x.id).filter(Boolean);
  const ex = d.ex.map((x, i) => {
    let id = x.id;
    if (!id) {
      id = nextId(`e${num}-ex`, exTaken);
      exTaken.push(id);
    }
    const itTaken = x.items.map((it) => it.id).filter(Boolean);
    const items = x.items.map((it, j) => {
      let iid = it.id;
      if (!iid) {
        iid = nextId(`${id}-i`, itTaken);
        itTaken.push(iid);
      }
      return { ...it, id: iid, exerciseId: id, sort: j };
    });
    return { ...x, id, episodeNum: num, sort: i, items };
  });
  return {
    ...d,
    lyrics: withIds(d.lyrics, `e${num}-ly`),
    dialog: withIds(d.dialog, `e${num}-dl`),
    mic,
    ex,
  } as Doc;
}

function validate(d: Doc): Record<string, string> {
  const out: Record<string, string> = { ...zodErrors(EpisodeEditSchema.create, pick(d, EP_KEYS)) };
  if (d.status === 'published' && !d.done) out.done = 'Um episódio publicado precisa da tela de conclusão.';
  d.mic.forEach((m, i) => Object.assign(out, prefixErrors(zodErrors(MicPhraseEdit.create, pick(m, MIC_KEYS)), `mic.${i}`)));
  d.ex.forEach((x, i) => {
    Object.assign(out, prefixErrors(zodErrors(ExerciseEdit.create, pick(x, EX_KEYS)), `ex.${i}`));
    if (!x.items.length) out[`ex.${i}.items`] = 'Inclua pelo menos 1 questão.';
    x.items.forEach((it, j) => {
      Object.assign(out, prefixErrors(zodErrors(ExerciseItemEdit.create, pick(it, ITEM_KEYS)), `ex.${i}.items.${j}`));
      if (it.answerIdx >= it.opts.length) out[`ex.${i}.items.${j}.opts`] = 'Marque a opção certa.';
    });
  });
  // Server paths of child rows are relative to the row; drop "id"/"sort" issues of rows not yet saved.
  for (const k of Object.keys(out)) if (/\.(id|episodeNum|exerciseId|sort)$/.test(k)) delete out[k];
  return out;
}

async function loadDoc(num: number, signal: AbortSignal): Promise<Doc> {
  const [ep, mic, ex] = await Promise.all([
    call(C.episodes.get, { params: { id: String(num) }, signal }),
    call(C.micPhrases.list, { query: { parent: String(num) }, signal }),
    call(C.exercises.list, { query: { parent: String(num) }, signal }),
  ]);
  const items = await Promise.all(ex.items.map((x) => call(C.items.list, { query: { parent: x.id }, signal })));
  const row = ep.item as EpisodeRow;
  return {
    ...pick(row as unknown as Obj, EP_KEYS),
    num: row.num,
    mic: [...mic.items].sort(bySort),
    ex: ex.items.sort(bySort).map((x, i) => ({ ...x, items: [...(items[i]?.items ?? [])].sort(bySort) })),
    _meta: { updatedAt: row.updatedAt, updatedBy: row.updatedBy },
  } as Doc;
}

const meta = (d: Doc | null) => (d?._meta ?? null) as { updatedAt: number; updatedBy: string | null } | null;
const stripMeta = (d: Doc): Doc => {
  const { _meta, ...rest } = d;
  return rest as Doc;
};

export function EpisodeEdit({ params, q }: ScreenProps) {
  const num = Number(params.num);
  const tab = (TABS.some(([t]) => t === q.aba) ? q.aba : 'geral') as TabId;
  const load = useLoad((signal) => loadDoc(num, signal), [num]);
  const [base, setBase] = useState<Doc | null>(null);
  const [draft, setDraft] = useState<Doc | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [info, setInfo] = useState<{ updatedAt: number; updatedBy: string | null } | null>(null);
  useEffect(() => {
    if (!load.data) return;
    setInfo(meta(load.data));
    const d = stripMeta(load.data);
    setBase(d);
    setDraft(d);
    setErrors({});
  }, [load.data]);
  const dirty = !!(base && draft && !same(base, draft));
  useLeaveGuard(dirty);
  const email = useEmails([info?.updatedBy]);

  const tabErrors = useMemo(() => {
    const out: Partial<Record<TabId, number>> = {};
    for (const k of Object.keys(errors)) {
      const t = tabOf(k);
      out[t] = (out[t] ?? 0) + 1;
    }
    return out;
  }, [errors]);

  const save = async () => {
    if (!draft || !base || busy || !dirty) return;
    const d = normalize(draft);
    setDraft(d);
    const errs = validate(d);
    setErrors(errs);
    const keys = Object.keys(errs);
    if (keys.length) {
      const first = tabOf(keys[0] as string);
      if (first !== tab) setQuery({ aba: first });
      toast('Há campos para corrigir.', 'warn');
      return;
    }
    setBusy(true);
    const b: Doc = JSON.parse(JSON.stringify(base));
    let failed = false;
    let stage = 'o episódio';
    try {
      const epPatch = patchOf(pick(b, EP_KEYS), pick(d, EP_KEYS), EP_KEYS);
      if (Object.keys(epPatch).length) {
        const res = await call(C.episodes.update, { params: { id: String(num) }, body: epPatch as never });
        Object.assign(b, pick(res.item as unknown as Obj, EP_KEYS));
        setInfo({ updatedAt: res.item.updatedAt, updatedBy: res.item.updatedBy });
      }
      // Mic phrases
      stage = 'as frases do Mic';
      await applyRows(
        C.micPhrases as CrudApi,
        diffRows(b.mic as Obj[], d.mic as Obj[], (r) => String(r.id), MIC_KEYS),
        MIC_KEYS,
        (kind, id, row) => {
          b.mic = applyToBase(b.mic as Obj[], kind, id, row, (r) => String(r.id)) as MicPhraseRow[];
        },
        (r) => String(r.id),
      );
      // Exercises (rows without their items), then each exercise's items
      const exBase = b.ex.map((x) => pick(x as unknown as Obj, EX_KEYS));
      const exDraft = d.ex.map((x) => pick(x as unknown as Obj, EX_KEYS));
      stage = 'os exercícios';
      await applyRows(
        C.exercises as CrudApi,
        diffRows(exBase, exDraft, (r) => String(r.id), EX_KEYS),
        EX_KEYS,
        (kind, id, row) => {
          if (kind === 'remove') b.ex = b.ex.filter((x) => x.id !== id);
          else if (kind === 'create' && row) b.ex.push({ ...(row as unknown as ExerciseRow), items: [] });
          else if (row) b.ex = b.ex.map((x) => (x.id === id ? { ...(row as unknown as ExerciseRow), items: x.items } : x));
        },
        (r) => String(r.id),
      );
      for (const x of d.ex) {
        const bx = b.ex.find((e) => e.id === x.id);
        if (!bx) continue;
        stage = `as questões de "${x.title}"`;
        await applyRows(
          C.items as CrudApi,
          diffRows(bx.items as unknown as Obj[], x.items as unknown as Obj[], (r) => String(r.id), ITEM_KEYS),
          ITEM_KEYS,
          (kind, id, row) => {
            bx.items = applyToBase(bx.items as unknown as Obj[], kind, id, row, (r) => String(r.id)) as unknown as ExerciseItemRow[];
          },
          (r) => String(r.id),
        );
      }
    } catch (e) {
      failed = true;
      const iss = issuesOf(e);
      if (iss.length && stage === 'o episódio') setErrors(issuesToErrors(iss));
      toast(`Não deu para salvar ${stage}: ${errorMessage(e)} O resto continua marcado como não salvo.`, 'err');
    } finally {
      b.mic.sort(bySort);
      b.ex.sort(bySort);
      for (const x of b.ex) x.items.sort(bySort);
      setBase(b);
      if (!failed) {
        setDraft(b);
        setSavedAt(Date.now());
        toast('Episódio salvo no rascunho.');
      }
      setBusy(false);
    }
  };
  useSaveShortcut(() => void save());

  const remove = () =>
    void confirmAction({
      title: `Excluir o episódio ${num}?`,
      body: 'Apaga o episódio, as frases do Mic e os exercícios. Se algum aluno já tiver progresso nele, o servidor recusa: use "Só título" ou "Rascunho".',
      confirm: 'Excluir episódio',
      danger: true,
      typeToConfirm: String(num),
      run: () => call(C.episodes.remove, { params: { id: String(num) } }),
    }).then((ok) => {
      if (ok) {
        setLeaveGuard(null);
        toast('Episódio excluído.');
        go('conteudo/episodios');
      }
    });

  const showPreview = wide.value ? true : view === 'preview';
  const showEditor = wide.value ? true : view === 'edit';
  const title = draft ? `${String(num).padStart(2, '0')} · ${String(draft.title || 'Sem título')}` : `Episódio ${num}`;
  return (
    <Page
      title={title}
      kicker="Episódio"
      back="conteudo/episodios"
      actions={draft ? <Button label="Excluir" icon="trash" kind="ad-danger-l" onClick={remove} /> : null}
      bar={
        <nav class="ad-tabs" aria-label="Partes do episódio">
          {TABS.map(([t, l]) => (
            <a
              key={t}
              class={`ad-tab${t === tab ? ' on' : ''}${tabErrors[t] ? ' bad' : ''}`}
              href={`#/conteudo/episodios/${num}?aba=${t}`}
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
      }
    >
      {load.error && !load.data ? (
        <ErrorBox error={load.error} retry={load.reload} />
      ) : !draft ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <div class="row wrapx" style={{ '--gap': '10px' }}>
            <StatusPill status={String(draft.status)} />
            {info ? (
              <span class="xs" title={fmtDateTime(info.updatedAt)}>
                Editado {fmtAgo(info.updatedAt)}
                {info.updatedBy ? ` por ${email(info.updatedBy) ?? 'alguém da equipe'}` : ''}
              </span>
            ) : null}
            <span class="grow" />
            {!wide.value ? (
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
          <DraftNote />
          <ErrorSummary errors={errors} specs={ALL_SPECS} idp="ep" />
          <div class="ad-split with-preview">
            {showEditor ? (
              <section class="card ad-card" aria-label={TABS.find(([t]) => t === tab)?.[1]}>
                <Form specs={TAB_SPECS[tab]} value={draft} set={(fn) => setDraft((p) => (p ? fn(p) : p))} errors={errors} idp="ep" />
                {tab === 'mic' ? (
                  <p class="xs">
                    <Icon name="bulb" size={14} /> Uma frase com notas de alunos não pode ser excluída (o servidor recusa); edite o texto em vez disso.
                  </p>
                ) : null}
              </section>
            ) : null}
            {showPreview ? <EpisodePreview doc={draft} tab={tab} /> : null}
          </div>
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
