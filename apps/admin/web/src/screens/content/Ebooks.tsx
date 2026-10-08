// E-books: the list and the editor (Take Five blocks, Take it for Real cards, Take the Lead turns,
// the chat, the Extras cards, the PDF) with the e-book test questions as child rows.
import {
  adminContentApi,
  type EbookRow,
  EbookEdit as EbookSchema,
  TestQuestionEdit,
  type TestQuestionRow,
} from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call } from '../../api';
import { fmtAgo, fmtDateTime } from '../../format';
import { go } from '../../router';
import { useLoad } from '../../ui/async';
import type { Obj, Spec } from '../../ui/form';
import { Async, Button, Empty, Page, Pill } from '../../ui/kit';
import { type Col, Table } from '../../ui/table';
import { prefixErrors, zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import {
  applyRows,
  applyToBase,
  CreateModal,
  type CrudApi,
  DraftNote,
  diffRows,
  keysOf,
  patchOf,
  pick,
} from './common';
import { DocEditor, PartialSave, tabFinder } from './DocEditor';
import { BlockView } from './EpisodePreview';
import { BLOCK_SPECS } from './episodeSpecs';

const C = adminContentApi;
const EB_KEYS = keysOf(EbookSchema.create);
const TQ_KEYS = keysOf(TestQuestionEdit.create);

type Doc = Obj & { num: number; tq: TestQuestionRow[] };

const BI = (label: string): Spec[] => [
  { t: 'text', k: 'en', label: `${label} (inglês)` },
  { t: 'text', k: 'pt', label: `${label} (tradução)` },
];

const OPT_SPECS: Spec[] = [
  { t: 'text', k: 'en', label: 'Inglês' },
  { t: 'text', k: 'pt', label: 'Tradução' },
  { t: 'text', k: 'fix', label: 'Correção (se errada)', opt: 'undef' },
];

const SPECS: Record<string, readonly Spec[]> = {
  geral: [
    { t: 'text', k: 'title', label: 'Título' },
    { t: 'text', k: 'epsLabel', label: 'Episódios cobertos', opt: 'null', hint: 'Ex.: "Episódios 01 e 02".' },
    { t: 'text', k: 'scope', label: 'O que o e-book cobre', opt: 'null', rows: 3 },
    { t: 'int', k: 'passScore', label: 'Acertos para passar no teste', min: 0 },
    { t: 'media', k: 'pdfMedia', label: 'PDF do e-book', kind: 'pdf', opt: 'null' },
  ],
  five: [
    {
      t: 'list',
      k: 'five',
      label: 'Páginas do Take Five',
      item: 'bloco',
      of: BLOCK_SPECS,
      summary: (v) => [v.k, v.title].filter(Boolean).join(' · '),
    },
  ],
  real: [
    {
      t: 'list',
      k: 'real',
      label: 'Cartões',
      item: 'cartão',
      summary: (v) => String(v.street ?? ''),
      of: [
        { t: 'text', k: 'street', label: 'Na rua' },
        { t: 'text', k: 'book', label: 'No livro', hint: 'Vazio quando não está no livro.' },
        { t: 'text', k: 'why', label: 'Por quê', rows: 2 },
      ],
    },
  ],
  lead: [
    {
      t: 'list',
      k: 'lead',
      label: 'Falas da Margaret e respostas',
      item: 'turno',
      summary: (v) => String((v.m as Obj | undefined)?.en ?? ''),
      make: () => ({ m: { en: '', pt: '' }, opts: [{ en: '', pt: '' }] }),
      of: [
        { t: 'obj', k: 'm', label: 'Fala da Margaret', of: BI('Fala') },
        {
          t: 'list',
          k: 'opts',
          label: 'Respostas',
          item: 'resposta',
          inline: true,
          of: OPT_SPECS,
          hint: 'A certa não tem correção; as erradas explicam o porquê.',
        },
      ],
    },
  ],
  chat: [
    {
      t: 'list',
      k: 'chat',
      label: 'Conversa',
      item: 'turno',
      summary: (v) => String((v.her as Obj | undefined)?.en ?? ''),
      make: () => ({ her: { en: '', pt: '' }, sug: [] }),
      of: [
        { t: 'obj', k: 'her', label: 'Fala dela', of: BI('Fala') },
        { t: 'list', k: 'sug', label: 'Sugestões de resposta', item: 'sugestão', inline: true, of: OPT_SPECS },
      ],
    },
  ],
  extras: [
    {
      t: 'list',
      k: 'extrasCards',
      label: 'Cartões de Extras',
      item: 'cartão',
      summary: (v) => String(v.name ?? ''),
      of: [
        { t: 'text', k: 'name', label: 'Nome' },
        { t: 'text', k: 'pt', label: 'Nome em português' },
        { t: 'text', k: 'desc', label: 'Descrição', rows: 2 },
        { t: 'text', k: 'meta', label: 'Detalhe', hint: 'Ex.: "8 min · áudio".' },
        { t: 'text', k: 'go', label: 'Destino', mono: true, hint: 'Rota sem "#/". Vazio = "Em produção".' },
      ],
    },
  ],
  teste: [
    {
      t: 'list',
      k: 'tq',
      label: 'Questões do teste',
      item: 'questão',
      summary: (v) => `${String(v.n || '?')}. ${String(v.q ?? '')}`,
      make: () => ({
        n: 0,
        partIdx: 0,
        partTitle: '',
        q: '',
        opts: ['', '', ''],
        answerIdx: 0,
        accept: null,
        show: null,
        audio: null,
        rev: null,
        epNum: null,
        step: null,
      }),
      of: [
        { t: 'int', k: 'n', label: 'Número', min: 1 },
        { t: 'int', k: 'partIdx', label: 'Parte (0, 1, 2…)', min: 0 },
        { t: 'text', k: 'partTitle', label: 'Título da parte' },
        { t: 'text', k: 'q', label: 'Pergunta', rows: 2 },
        { t: 'choices', k: 'opts', label: 'Opções', answer: 'answerIdx', opt: 'null', min: 2, max: 6 },
        {
          t: 'strings',
          k: 'accept',
          label: 'Respostas digitadas aceitas',
          opt: 'null',
          hint: 'Use quando não há opções. Comparadas sem acento, caixa e pontuação.',
        },
        { t: 'text', k: 'show', label: 'Resposta mostrada na revisão', opt: 'null' },
        { t: 'text', k: 'audio', label: 'Texto do áudio', opt: 'null' },
        { t: 'text', k: 'rev', label: 'O que revisar', opt: 'null', rows: 2 },
        { t: 'int', k: 'epNum', label: 'Episódio para revisar', opt: 'null', min: 1 },
        { t: 'int', k: 'step', label: 'Etapa para revisar (1 a 10)', opt: 'null', min: 1, max: 10 },
      ],
    },
  ],
};

const TABS = [
  ['geral', 'Geral'],
  ['five', 'Take Five'],
  ['real', 'Take it for Real'],
  ['lead', 'Take the Lead'],
  ['chat', 'Conversa'],
  ['extras', 'Extras'],
  ['teste', 'Teste'],
] as const;

const ALL = Object.values(SPECS).flat();
const tabOf = tabFinder(SPECS, 'geral');
const bySort = (a: TestQuestionRow, b: TestQuestionRow) => a.n - b.n;

async function loadDoc(num: number, signal: AbortSignal): Promise<Doc> {
  const [eb, tq] = await Promise.all([
    call(C.ebooks.get, { params: { id: String(num) }, signal }),
    call(C.testQuestions.list, { query: { parent: String(num) }, signal }),
  ]);
  return { ...pick(eb.item as unknown as Obj, EB_KEYS), num, tq: [...tq.items].sort(bySort) } as Doc;
}

function normalize(d: Doc): Doc {
  const taken = new Set(d.tq.map((q) => q.id).filter(Boolean));
  let maxN = d.tq.reduce((m, q) => Math.max(m, q.n || 0), 0);
  return {
    ...d,
    tq: d.tq.map((q0) => {
      const q = q0.n >= 1 ? q0 : { ...q0, n: ++maxN };
      if (q.id) return { ...q, ebookNum: d.num };
      let id = `eb${d.num}-t${q.n}`;
      let k = 2;
      while (taken.has(id)) id = `eb${d.num}-t${q.n}-${k++}`;
      taken.add(id);
      return { ...q, id, ebookNum: d.num };
    }),
  };
}

function validate(d: Doc): Record<string, string> {
  const out: Record<string, string> = { ...zodErrors(EbookSchema.create, pick(d, EB_KEYS)) };
  const ns = new Map<number, number>();
  d.tq.forEach((q, i) => {
    Object.assign(out, prefixErrors(zodErrors(TestQuestionEdit.create, pick(q as unknown as Obj, TQ_KEYS)), `tq.${i}`));
    if (!q.opts && !q.accept?.length) out[`tq.${i}.opts`] = 'Dê opções com a certa, ou respostas digitadas aceitas.';
    if (ns.has(q.n)) out[`tq.${i}.n`] = `O número ${q.n} já é usado pela questão ${(ns.get(q.n) as number) + 1}.`;
    ns.set(q.n, i);
  });
  for (const k of Object.keys(out)) if (/\.(id|ebookNum)$/.test(k)) delete out[k];
  return out;
}

async function persist(base: Doc, d: Doc): Promise<Doc> {
  const b: Doc = JSON.parse(JSON.stringify(base));
  let stage = 'o e-book';
  try {
    const patch = patchOf(pick(b, EB_KEYS), pick(d, EB_KEYS), EB_KEYS);
    if (Object.keys(patch).length) {
      const res = await call(C.ebooks.update, { params: { id: String(d.num) }, body: patch as never });
      Object.assign(b, pick(res.item as unknown as Obj, EB_KEYS));
    }
    stage = 'as questões do teste';
    await applyRows(
      C.testQuestions as CrudApi,
      diffRows(b.tq as unknown as Obj[], d.tq as unknown as Obj[], (r) => String(r.id), TQ_KEYS),
      TQ_KEYS,
      (kind, id, row) => {
        b.tq = applyToBase(b.tq as unknown as Obj[], kind, id, row, (r) =>
          String(r.id),
        ) as unknown as TestQuestionRow[];
      },
      (r) => String(r.id),
    );
  } catch (e) {
    b.tq.sort(bySort);
    throw new PartialSave(b, e, stage, stage === 'o e-book');
  }
  b.tq.sort(bySort);
  return b;
}

function Preview({ d, tab }: { d: Doc; tab: string }) {
  const five = (d.five as EbookRow['five']) ?? [];
  const real = (d.real as EbookRow['real']) ?? [];
  return (
    <aside class="ad-preview" aria-label="Prévia para o aluno">
      <span class="lbl">Prévia no app</span>
      <div class="ad-phone">
        <div class="ad-phone-in">
          {tab === 'five' ? (
            five.length ? (
              five.map((b, i) => <BlockView key={i} b={b} />)
            ) : (
              <div class="card dash tc sm">As páginas aparecem aqui.</div>
            )
          ) : tab === 'real' ? (
            real.map((c, i) => (
              <div key={i} class="card stack" style={{ '--gap': '6px' }}>
                <span class="lbl or">Na rua</span>
                <div class="en">{c.street}</div>
                <div class="row" style={{ '--gap': '6px' }}>
                  <span class="lbl">No livro</span>
                  {c.book ? <span class="sm">{c.book}</span> : <span class="pill">Não está no livro</span>}
                </div>
                <div class="sm">{c.why}</div>
              </div>
            ))
          ) : (
            <div class="card stack" style={{ '--gap': '8px' }}>
              <span class="lbl or">E-book {d.num}</span>
              <div class="h2">{String(d.title ?? '')}</div>
              {d.epsLabel ? <span class="pill bl">{String(d.epsLabel)}</span> : null}
              {d.scope ? <p class="sm">{String(d.scope)}</p> : null}
              <div class="xs">
                Teste: {d.tq.length} questões · passa com {String(d.passScore)}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export function EbookEdit({ params, q }: ScreenProps) {
  const num = Number(params.num);
  return (
    <DocEditor<Doc>
      load={(signal) => loadDoc(num, signal)}
      deps={[num]}
      title={(d) => `E-book ${d.num} · ${String(d.title || '')}`}
      kicker="E-book"
      back="conteudo/ebooks"
      noun="E-book"
      tabs={TABS}
      tab={q.aba}
      specs={SPECS}
      allSpecs={ALL}
      validate={validate}
      normalize={normalize}
      persist={persist}
      tabOf={tabOf}
      idp="eb"
      preview={(d, tab) => <Preview d={d} tab={tab} />}
      remove={{
        id: String(num),
        body: 'Some do rascunho. Se houver episódios ligados a ele ou alunos com download ou teste, o servidor recusa.',
        run: () => call(C.ebooks.remove, { params: { id: String(num) } }),
        after: 'conteudo/ebooks',
      }}
    />
  );
}

export function Ebooks(_: ScreenProps) {
  const load = useLoad((signal) => call(C.ebooks.list, { query: {}, signal }), []);
  const [creating, setCreating] = useState(false);
  const cols: Col<EbookRow>[] = [
    {
      key: 't',
      label: 'E-book',
      cell: (e) => (
        <span class="row" style={{ '--gap': '10px' }}>
          <span class="ad-epnum">{e.num}</span>
          <span class="ad-cell2">
            <span>{e.title}</span>
            <span class="xs">{e.epsLabel ?? '—'}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'pdf',
      label: 'PDF',
      cell: (e) => (e.pdfMedia ? <Pill label="Com PDF" tone="gr" /> : <Pill label="Sem PDF" />),
    },
    { key: 'five', label: 'Take Five', cls: 'num', cell: (e) => String(e.five.length) },
    { key: 'lead', label: 'Take the Lead', cls: 'num', cell: (e) => String(e.lead.length), desktopOnly: true },
    { key: 'pass', label: 'Passa com', cls: 'num', cell: (e) => String(e.passScore) },
    { key: 'upd', label: 'Editado', cell: (e) => <span title={fmtDateTime(e.updatedAt)}>{fmtAgo(e.updatedAt)}</span> },
  ];
  const next = (load.data?.items ?? []).reduce((m, e) => Math.max(m, e.num), 0) + 1;
  return (
    <Page
      title="E-books"
      kicker="Conteúdo"
      actions={<Button label="Novo e-book" icon="plus" onClick={() => setCreating(true)} />}
    >
      <DraftNote />
      <Async load={load}>
        {(d) =>
          d.items.length ? (
            <Table
              rows={d.items}
              cols={cols}
              rowKey={(e) => String(e.num)}
              href={(e) => `conteudo/ebooks/${e.num}`}
              caption="E-books"
            />
          ) : (
            <Empty icon="book" title="Nenhum e-book ainda." />
          )
        }
      </Async>
      {creating ? (
        <CreateModal
          noun="E-book"
          idLabel="Número"
          idHint="1, 2, 3…"
          numeric
          suggestId={String(next)}
          onClose={() => setCreating(false)}
          create={async (id, title) => {
            const num = Number(id);
            await call(C.ebooks.create, {
              body: {
                num,
                title,
                epsLabel: null,
                scope: null,
                five: [],
                real: [],
                lead: [],
                chat: [],
                extrasCards: [],
                pdfMedia: null,
                passScore: 14,
              },
            });
            go(`conteudo/ebooks/${num}`);
          }}
        />
      ) : null}
    </Page>
  );
}
