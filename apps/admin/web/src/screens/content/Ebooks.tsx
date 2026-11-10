// E-books: the list and the editor (Take Five blocks, Take it for Real cards, Take the Lead turns,
// the chat, the Extras cards, the PDF) with the e-book test questions as child rows.
import {
  adminContentApi,
  type EbookRow,
  EbookEdit as EbookSchema,
  TestQuestionEdit,
  type TestQuestionRow,
} from '@tie/shared/contracts/admin';
import { call } from '../../api';
import { useLoad } from '../../ui/async';
import type { CustomProps, Obj, Spec } from '../../ui/form';
import { Async } from '../../ui/kit';
import { prefixErrors, zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { applyRows, applyToBase, type CrudApi, diffRows, keysOf, patchOf, pick } from './common';
import { DocEditor, PartialSave, tabFinder } from './DocEditor';
import { BlockView } from './EpisodePreview';
import { BLOCK_SPECS } from './episodeSpecs';

const C = adminContentApi;
const EB_KEYS = keysOf(EbookSchema.create);
const TQ_KEYS = keysOf(TestQuestionEdit.create);

function RequiredEpisodes({ value, set, id, err }: CustomProps) {
  const eps = useLoad((signal) => call(C.episodes.list, { query: {}, signal }), []);
  const selected = (value as number[]) ?? [];
  return (
    <fieldset id={id} class="stack ad-span" style={{ '--gap': '8px', border: 0, padding: 0, margin: 0 }}>
      <legend class="lbl">Episódios que contam para liberar</legend>
      <p class="xs">
        Sem seleção, vale a conclusão do próprio episódio. Selecione outros para regras como “concluir 2 episódios”.
      </p>
      <Async load={eps}>
        {({ items }) => (
          <div class="ad-grid">
            {items.map((e) => (
              <label key={e.num} class="row" style={{ '--gap': '8px' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(e.num)}
                  onChange={(ev) =>
                    set(ev.currentTarget.checked ? [...selected, e.num] : selected.filter((n) => n !== e.num))
                  }
                />
                <span>
                  {e.num} · {e.title}
                </span>
              </label>
            ))}
          </div>
        )}
      </Async>
      {err ? (
        <span class="err" role="alert">
          {err}
        </span>
      ) : null}
    </fieldset>
  );
}

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
  regras: [
    { t: 'bool', k: 'testEnabled', label: 'Teste habilitado' },
    { t: 'int', k: 'passScore', label: 'Acertos para passar no teste', min: 0 },
    {
      t: 'custom',
      k: 'testRequiredEpisodes',
      label: 'Episódios que contam para liberar',
      wide: true,
      render: (p) => <RequiredEpisodes {...p} />,
    },
    {
      t: 'int',
      k: 'testMinCompleted',
      label: 'Quantidade de episódios completos',
      opt: 'null',
      min: 1,
      max: 200,
      hint: 'Vazio exige todos os selecionados. Conte apenas episódios com as 10 etapas concluídas.',
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
        { t: 'int', k: 'step', label: 'Etapa para revisar (1 a 9)', opt: 'null', min: 1, max: 9 },
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
  ['regras', 'Regra de liberação'],
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

/**
 * PROD (spec 05 "No e-book", "Step order"): the e-book is gone; only its test survives, as the episode's
 * last step (Take the Test). The episode editor opens this with testOnly: the questions, then the test
 * switch and the pass mark. The release rule (episodes to complete) no longer applies: the test is step 10.
 */
const TEST_TABS = [
  ['teste', 'Questões'],
  ['regras', 'Configuração'],
] as const;
const TEST_SPECS: Record<string, readonly Spec[]> = {
  ...SPECS,
  regras: (SPECS.regras ?? []).filter((x) => x.k === 'testEnabled' || x.k === 'passScore'),
};

export function EbookEdit({ params, q, testOnly = false }: ScreenProps & { testOnly?: boolean }) {
  const num = Number(params.num);
  const tabs = testOnly ? TEST_TABS : params.ep ? TABS.filter(([id]) => id !== 'regras' && id !== 'teste') : TABS;
  return (
    <DocEditor<Doc>
      load={(signal) => loadDoc(num, signal)}
      deps={[num, testOnly]}
      title={(d) => (testOnly ? `Take the Test · episódio ${params.ep}` : `E-book ${d.num} · ${String(d.title || '')}`)}
      kicker={testOnly ? 'Teste do episódio' : 'E-book do episódio'}
      back={params.ep ? `conteudo/episodios/${params.ep}` : 'conteudo/temporadas'}
      noun={testOnly ? 'Teste' : 'E-book'}
      tabs={tabs}
      tab={tabs.some(([id]) => id === q.aba) ? q.aba : tabs[0]?.[0]}
      specs={testOnly ? TEST_SPECS : SPECS}
      allSpecs={ALL}
      validate={validate}
      normalize={normalize}
      persist={persist}
      tabOf={tabOf}
      idp="eb"
      preview={(d, tab) =>
        testOnly ? (
          <aside class="ad-preview">
            <span class="lbl">Teste do episódio {params.ep}</span>
            <div class="card stack" style={{ '--gap': '10px' }}>
              <span class="pill">{d.testEnabled ? 'Habilitado' : 'Em preparação'}</span>
              <h2 class="h2">{d.tq.length} questões</h2>
              <p class="sm">Passa com {String(d.passScore)} acertos.</p>
              <p class="sm">Etapa 10 do episódio (Take the Test). Entregar o teste conclui o episódio.</p>
              {d.tq.slice(0, 3).map((question) => (
                <p key={question.id} class="xs">
                  {question.n}. {question.q}
                </p>
              ))}
            </div>
          </aside>
        ) : (
          <Preview d={d} tab={tab} />
        )
      }
      remove={
        testOnly
          ? undefined
          : {
              id: String(num),
              body: 'Some do rascunho. Se houver episódios ligados a ele ou alunos com download ou teste, o servidor recusa.',
              run: () => call(C.ebooks.remove, { params: { id: String(num) } }),
              after: params.ep ? `conteudo/episodios/${params.ep}` : 'conteudo/temporadas',
            }
      }
    />
  );
}
