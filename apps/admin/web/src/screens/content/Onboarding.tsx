// Cadastro: the option lists of the 7 onboarding steps (ages, goals, formats, genres per format,
// themes, difficulties…). Each list is saved whole (PUT replaces it); keys are what profiles store,
// so renaming a key breaks the link with learners who already chose it.
import { adminContentApi, OptionListPutBody, type OptionListRow } from '@tie/shared/contracts/admin';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { call, errorMessage, issuesOf } from '../../api';
import { setQuery } from '../../router';
import { useLoad } from '../../ui/async';
import { ErrorSummary, Form, type Obj, type Spec } from '../../ui/form';
import { Icon } from '../../ui/icons';
import { Async, Page, Sel } from '../../ui/kit';
import { wide } from '../../ui/layout';
import { toast } from '../../ui/toast';
import { type Errors, issuesToErrors, zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { DraftNote, SaveBar, same, useLeaveGuard, useSaveShortcut } from './common';
import { forgetOptionRows } from './options';

const C = adminContentApi;

export const LISTS: readonly (readonly [string, string, string])[] = [
  ['onb_steps', 'Etapas do cadastro', 'Título, subtítulo e chamada de cada uma das 7 etapas.'],
  ['ages', 'Faixas etárias', 'Etapa 1.'],
  ['occup', 'Ocupação', 'Etapa 1.'],
  ['areas', 'Áreas de trabalho', 'Etapa 1.'],
  ['levels', 'Níveis', 'Etapa 2: define a temporada inicial e o CEFR.'],
  ['goals', 'Objetivos', 'Etapa 2.'],
  ['deadlines', 'Prazos', 'Etapa 2.'],
  ['history', 'Histórico com inglês', 'Etapa 4.'],
  ['fails', 'O que já deu errado', 'Etapa 4.'],
  ['formats', 'Formatos', 'Etapa 3: séries, novelas, filmes…'],
  ['genres', 'Gêneros por formato', 'Etapa 3: cada gênero pertence a um formato.'],
  ['themes', 'Temas', 'Etapa 3.'],
  ['diffs', 'Dificuldades', 'Etapa 4: definem o foco da semana.'],
  ['styles', 'Jeitos de aprender', 'Etapa 5.'],
  ['company', 'Companhia', 'Etapa 5.'],
  ['feedback', 'Tipo de correção', 'Etapa 5.'],
  ['days', 'Dias da semana', 'Etapa 6: exatamente 7, de domingo a sábado.'],
  ['minutes', 'Minutos por dia', 'Etapa 6: a chave é o número de minutos.'],
  ['motives', 'Motivos', 'Etapa 7.'],
];

const base: Spec[] = [
  { t: 'text', k: 'itemKey', label: 'Chave', mono: true, hint: 'O que fica salvo no perfil do aluno.' },
  { t: 'text', k: 'label', label: 'Texto' },
  { t: 'text', k: 'sub', label: 'Detalhe', opt: 'null' },
  { t: 'text', k: 'icon', label: 'Ícone', opt: 'null', mono: true },
  { t: 'media', k: 'imgMedia', label: 'Imagem', kind: 'image', opt: 'null' },
];

function itemSpecs(listKey: string, formats: readonly (readonly [string, string])[]): Spec[] {
  const extra: Spec[] =
    listKey === 'onb_steps'
      ? [
          {
            t: 'obj',
            k: 'extra',
            label: 'Etapa',
            make: () => ({ h: '' }),
            of: [
              { t: 'text', k: 'h', label: 'Chamada (título grande)', rows: 2 },
              { t: 'bool', k: 'skip', label: 'Pode pular', opt: 'undef' },
            ],
          },
        ]
      : listKey === 'levels'
        ? [
            {
              t: 'obj',
              k: 'extra',
              label: 'Nível',
              make: () => ({ season: 1, cefr: 'A1' }),
              of: [
                { t: 'int', k: 'season', label: 'Temporada inicial', min: 1 },
                { t: 'text', k: 'cefr', label: 'CEFR', hint: 'A1, A1+, A2, B1…' },
              ],
            },
          ]
        : [];
  const scope: Spec[] =
    listKey === 'genres'
      ? [{ t: 'select', k: 'scope', label: 'Formato', options: formats.length ? formats : [['', '—']] }]
      : [];
  const inline = listKey === 'days' || listKey === 'minutes';
  // The 7 onboarding steps and the 7 week days are structure, not options: their texts change, but
  // nobody adds, removes, reorders or re-keys them here.
  const structural = listKey === 'onb_steps' || listKey === 'days';
  const fields = structural
    ? base.map((s) => (s.k === 'itemKey' ? ({ ...s, ro: true, hint: 'Fixa: o app usa esta chave.' } as Spec) : s))
    : base;
  return [
    {
      t: 'list',
      k: 'items',
      label: listKey === 'onb_steps' ? 'Etapas' : 'Opções',
      item: listKey === 'onb_steps' ? 'etapa' : 'opção',
      fixed: structural,
      hint: structural ? 'Lista fixa: edite os textos de cada item.' : undefined,
      inline,
      summary: (v) => `${String(v.label ?? '')}${v.scope ? ` · ${String(v.scope)}` : ''}`,
      make: () => ({
        scope: listKey === 'genres' ? (formats[0]?.[0] ?? '') : '',
        itemKey: '',
        label: '',
        sub: null,
        icon: null,
        imgMedia: null,
        extra: listKey === 'onb_steps' ? { h: '' } : listKey === 'levels' ? { season: 1, cefr: 'A1' } : null,
      }),
      of: inline ? fields.slice(0, 2) : [...scope, ...fields, ...extra],
    },
  ];
}

type Doc = { items: Obj[] };

const toDoc = (rows: readonly OptionListRow[], listKey: string): Doc => ({
  items: rows
    .filter((r) => r.listKey === listKey)
    .sort((a, b) => (a.scope === b.scope ? a.sort - b.sort : a.scope.localeCompare(b.scope)))
    .map((r) => ({
      scope: r.scope,
      itemKey: r.itemKey,
      label: r.label,
      sub: r.sub,
      icon: r.icon,
      imgMedia: r.imgMedia,
      extra: r.extra,
    })),
});

function Editor({
  listKey,
  rows,
  onSaved,
}: {
  listKey: string;
  rows: OptionListRow[];
  onSaved: (rows: OptionListRow[]) => void;
}) {
  const formats = useMemo(
    () =>
      rows
        .filter((r) => r.listKey === 'formats')
        .sort((a, b) => a.sort - b.sort)
        .map((r) => [r.itemKey, r.label] as const),
    [rows],
  );
  const specs = useMemo(() => itemSpecs(listKey, formats), [listKey, formats]);
  const initial = useMemo(() => toDoc(rows, listKey), [rows, listKey]);
  const [draft, setDraft] = useState<Doc>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    setDraft(initial);
    setErrors({});
  }, [initial]);
  const dirty = !same(initial, draft);
  useLeaveGuard(dirty);
  const save = async () => {
    if (!dirty || busy) return;
    const body = { items: draft.items.map((it, i): Obj => ({ ...it, sort: i })) };
    const errs: Record<string, string> = zodErrors(OptionListPutBody, body);
    const seen = new Map<string, number>();
    body.items.forEach((it, i) => {
      const k = `${String(it.scope)}\u0000${String(it.itemKey)}`;
      if (seen.has(k)) errs[`items.${i}.itemKey`] = 'Chave repetida.';
      seen.set(k, i);
    });
    if (listKey === 'days' && body.items.length !== 7) errs.items = 'A lista de dias tem exatamente 7 itens.';
    setErrors(errs);
    if (Object.keys(errs).length) return toast('Há campos para corrigir.', 'warn');
    setBusy(true);
    try {
      const res = await call(C.optionLists.put, { params: { listKey }, body: body as never });
      forgetOptionRows();
      onSaved(res.items);
      setSavedAt(Date.now());
      toast('Lista salva no rascunho.');
    } catch (e) {
      const iss = issuesOf(e);
      if (iss.length) setErrors(issuesToErrors(iss));
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  useSaveShortcut(() => void save());
  const meta = LISTS.find(([k]) => k === listKey);
  return (
    <>
      <section class="card ad-card">
        <div class="ad-card-h">
          <div class="grow">
            <h2 class="h3">{meta?.[1] ?? listKey}</h2>
            <div class="xs mt4">{meta?.[2]}</div>
          </div>
          <span class="pill ad-mono">{listKey}</span>
        </div>
        <div class="ad-note">
          <Icon name="alert" size={18} /> Mudar uma chave desliga as escolhas que os alunos já fizeram com ela. Prefira
          mudar só o texto.
        </div>
        <ErrorSummary errors={errors} specs={specs} idp={`ol-${listKey}`} />
        <Form specs={specs} value={draft} set={setDraft as never} errors={errors} idp={`ol-${listKey}`} />
      </section>
      <SaveBar
        dirty={dirty}
        busy={busy}
        savedAt={savedAt}
        errors={Object.keys(errors).length}
        onSave={() => void save()}
        onDiscard={() => {
          setDraft(initial);
          setErrors({});
        }}
      />
    </>
  );
}

export function Onboarding({ q }: ScreenProps) {
  const listKey = LISTS.some(([k]) => k === q.lista) ? (q.lista as string) : 'onb_steps';
  const load = useLoad((signal) => call(C.optionLists.list, { signal }), []);
  const count = (k: string) => load.data?.items.filter((r) => r.listKey === k).length ?? 0;
  return (
    <Page title="Cadastro" kicker="Conteúdo · listas de opções">
      <DraftNote />
      <Async load={load}>
        {(d) => (
          <div
            class={wide.value ? 'ad-cols main' : 'stack'}
            style={wide.value ? { gridTemplateColumns: '260px minmax(0, 1fr)' } : undefined}
          >
            {wide.value ? (
              <nav class="card ad-card" aria-label="Listas" style={{ padding: '10px', gap: '2px' }}>
                {LISTS.map(([k, l]) => (
                  <a
                    key={k}
                    href={`#/conteudo/cadastro?lista=${k}`}
                    class={`ad-tab${k === listKey ? ' on' : ''}`}
                    style={{ justifyContent: 'space-between', borderRadius: '10px' }}
                    aria-current={k === listKey ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      setQuery({ lista: k });
                    }}
                  >
                    <span>{l}</span>
                    <span class="xs" style={{ color: 'inherit', opacity: '.8' }}>
                      {count(k)}
                    </span>
                  </a>
                ))}
              </nav>
            ) : (
              <Sel
                ariaLabel="Lista"
                value={listKey}
                onValue={(v) => setQuery({ lista: v })}
                options={LISTS.map(([k, l]) => [k, `${l} (${count(k)})`] as const)}
              />
            )}
            <div class="stack" style={{ '--gap': '18px', minWidth: '0' }}>
              <Editor
                key={listKey}
                listKey={listKey}
                rows={d.items}
                onSaved={(rows) =>
                  load.setData((p) => ({ items: [...(p?.items ?? []).filter((r) => r.listKey !== listKey), ...rows] }))
                }
              />
            </div>
          </div>
        )}
      </Async>
    </Page>
  );
}
