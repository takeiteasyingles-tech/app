// Temporadas (spec 07, feature D): the seasons of the course (title and synopsis reach learners with
// the next publish) with their season-test settings (pass mark, target question count), and which
// episodes belong to each season (episodes.season_n, edited here or in the episode editor). Whether
// the test is open and its questions live in the season test editor (feature B), linked from here.
import {
  adminContentApi,
  type EpisodeRow,
  type SeasonRow,
  SeasonEdit as SeasonSchema,
} from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { fmtAgo, fmtDateTime } from '../../format';
import { useEmails } from '../../people';
import { go } from '../../router';
import { useLoad } from '../../ui/async';
import type { Obj, Spec } from '../../ui/form';
import { Async, Button, Card, Empty, Page, Sel } from '../../ui/kit';
import { wide } from '../../ui/layout';
import { type Col, Table } from '../../ui/table';
import { toast } from '../../ui/toast';
import { zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { CreateModal, type CrudApi, crud, DraftNote, keysOf, patchOf, pick, StatusPill } from './common';
import { DocEditor } from './DocEditor';
import { blankEpisode } from './Episodes';

const C = adminContentApi;
const KEYS = keysOf(SeasonSchema.create);

const SPECS: Record<string, readonly Spec[]> = {
  '': [
    { t: 'int', k: 'n', label: 'Número', ro: true },
    { t: 'text', k: 'title', label: 'Título', hint: 'Aparece na trilha e no certificado.', max: 200 },
    {
      t: 'text',
      k: 'synopsis',
      label: 'Sinopse',
      opt: 'null',
      rows: 4,
      max: 2000,
      wide: true,
      hint: 'O que acontece nesta temporada, em poucas frases.',
    },
  ],
};
const ALL = SPECS[''] ?? [];

function EpisodesCard({ n }: { n: number }) {
  const [creating, setCreating] = useState(false);
  const load = useLoad((signal) => call(C.episodes.list, { query: {}, signal }), [n]);
  const seasons = useLoad((signal) => call(C.seasons.list, { query: {}, signal }), []);
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState('');
  const all = load.data?.items ?? [];
  const mine = all.filter((e) => e.seasonN === n);
  const others = all.filter((e) => e.seasonN !== n);
  // Short labels: on phones the select sits in a half-width cell already labelled "Temporada".
  const seasonOpts = (seasons.data?.items ?? []).map(
    (s) => [String(s.n), wide.value ? `Temporada ${s.n}` : String(s.n)] as const,
  );

  const move = async (e: EpisodeRow, to: number | null) => {
    setBusy(e.num);
    try {
      const res = await call(C.episodes.update, {
        params: { id: String(e.num) },
        body: { seasonN: to },
        // expectedUpdatedAt is MCP-only; the admin editor is last-write-wins as everywhere else.
      });
      load.setData((p) => ({ items: (p?.items ?? []).map((x) => (x.num === e.num ? res.item : x)) }));
      toast(
        to === null
          ? `Episódio ${e.num} saiu da temporada.`
          : to === n
            ? `Episódio ${e.num} entrou na temporada ${n}.`
            : `Episódio ${e.num} foi para a temporada ${to}.`,
      );
    } catch (err) {
      toast(errorMessage(err), 'err');
    } finally {
      setBusy(null);
    }
  };

  const cols: Col<EpisodeRow>[] = [
    {
      key: 'ep',
      label: 'Episódio',
      cell: (e) => (
        <span class="row" style={{ '--gap': '10px' }}>
          <span class="ad-epnum">{String(e.num).padStart(2, '0')}</span>
          <span class="ad-cell2">
            {e.title.trim() ? <span>{e.title}</span> : <i class="ad-untitled">Sem título</i>}
            <span class="xs">{e.ebookNum ? `E-book ${e.ebookNum}` : 'Sem e-book'}</span>
          </span>
        </span>
      ),
    },
    { key: 'st', label: 'Situação', cell: (e) => <StatusPill status={e.status} /> },
    {
      key: 'mv',
      label: 'Temporada',
      cell: (e) => (
        <Sel
          ariaLabel={`Temporada do episódio ${e.num}`}
          value={e.seasonN === null ? '' : String(e.seasonN)}
          onValue={(v) => void move(e, v === '' ? null : Number(v))}
          options={[['', wide.value ? 'Sem temporada' : 'Nenhuma'], ...seasonOpts]}
          cls={busy === e.num ? 'ad-busy' : ''}
        />
      ),
    },
  ];

  return (
    <Card
      title="Episódios da temporada"
      sub="A ordem na trilha segue o número do episódio. Mudar a temporada vale para os alunos depois da próxima publicação."
      actions={<Button label="Novo episódio" icon="plus" onClick={() => setCreating(true)} />}
    >
      <Async load={load} rows={4}>
        {() =>
          mine.length ? (
            <Table
              rows={mine}
              cols={cols}
              rowKey={(e) => String(e.num)}
              href={(e) => `conteudo/episodios/${e.num}`}
              caption={`Episódios da temporada ${n}`}
            />
          ) : (
            <Empty icon="trail" title="Nenhum episódio nesta temporada." body="Adicione um episódio abaixo." />
          )
        }
      </Async>
      {creating ? (
        <CreateModal
          noun="Episódio"
          idLabel="Número"
          idHint="A posição do episódio na trilha."
          numeric
          suggestId={String(all.reduce((max, e) => Math.max(max, e.num), 0) + 1)}
          onClose={() => setCreating(false)}
          create={async (id, title) => {
            await call(C.episodes.create, { body: { ...blankEpisode(Number(id), title), seasonN: n } });
            go(`conteudo/episodios/${id}`);
          }}
        />
      ) : null}
      {others.length ? (
        <form
          class="ad-inlineform mt8"
          onSubmit={(ev) => {
            ev.preventDefault();
            const e = others.find((x) => String(x.num) === adding);
            if (e) {
              void move(e, n);
              setAdding('');
            }
          }}
        >
          <Sel
            id="season-add"
            ariaLabel="Episódio para adicionar"
            value={adding}
            onValue={setAdding}
            cls="ad-grow"
            options={[
              ['', 'Escolha um episódio…'],
              ...others.map(
                (e) =>
                  [
                    String(e.num),
                    `${String(e.num).padStart(2, '0')} · ${e.title || 'Sem título'}${e.seasonN ? ` (temporada ${e.seasonN})` : ''}`,
                  ] as const,
              ),
            ]}
          />
          <Button
            label="Adicionar"
            ariaLabel="Adicionar à temporada"
            icon="plus"
            kind="light"
            type="submit"
            disabled={!adding}
          />
        </form>
      ) : null}
    </Card>
  );
}

export function SeasonEdit({ params }: ScreenProps) {
  const n = Number(params.n ?? '0');
  return (
    <DocEditor<Obj>
      load={async (signal) => pick((await crud.get<Obj>(C.seasons as CrudApi, n, signal)).item, [...KEYS, 'updatedAt'])}
      deps={[n]}
      title={(d) => `Temporada ${n}${d.title ? ` · ${String(d.title)}` : ''}`}
      kicker="Temporada"
      back="conteudo/temporadas"
      noun="Temporada"
      specs={SPECS}
      allSpecs={ALL}
      idp="se"
      validate={(d) => zodErrors(SeasonSchema.create, pick(d, KEYS))}
      persist={async (base, d) => {
        const patch = patchOf(base, d, KEYS);
        if (!Object.keys(patch).length) return d;
        return pick((await crud.update<Obj>(C.seasons as CrudApi, n, patch)).item, [...KEYS, 'updatedAt']);
      }}
      after={() => (
        <>
          <EpisodesCard n={n} />
        </>
      )}
      remove={{
        id: String(n),
        body: 'Só é possível excluir uma temporada sem episódios, questões de teste, resultados ou certificados.',
        run: () => crud.remove(C.seasons as CrudApi, n),
        after: 'conteudo/temporadas',
      }}
    />
  );
}

// ---------- List ----------

export function Seasons(_: ScreenProps) {
  const load = useLoad((signal) => call(C.seasons.list, { query: {}, signal }), []);
  const eps = useLoad((signal) => call(C.episodes.list, { query: {}, signal }), []);
  const [creating, setCreating] = useState(false);
  const all = load.data?.items ?? [];
  const email = useEmails(all.map((s) => s.updatedBy));
  const episodes = eps.data?.items ?? [];
  const count = (n: number) => {
    const of = episodes.filter((e) => e.seasonN === n);
    return { total: of.length, published: of.filter((e) => e.status === 'published').length };
  };
  const loose = episodes.filter((e) => e.seasonN === null).length;
  const cols: Col<SeasonRow>[] = [
    {
      key: 't',
      label: 'Temporada',
      cell: (s) => (
        <span class="row" style={{ '--gap': '10px' }}>
          <span class="ad-epnum">{String(s.n).padStart(2, '0')}</span>
          <span class="ad-cell2">
            {s.title.trim() ? <span>{s.title}</span> : <i class="ad-untitled">Sem título</i>}
            <span class="xs ad-ell" style={{ maxWidth: '44ch' }} title={s.synopsis ?? undefined}>
              {s.synopsis ?? 'Sem sinopse'}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'eps',
      label: 'Episódios',
      cell: (s) => {
        if (!eps.data) return <span class="xs">…</span>;
        const c = count(s.n);
        return (
          <span class="ad-cell2">
            <span>{c.total}</span>
            <span class="xs">{c.published} publicados</span>
          </span>
        );
      },
    },
    {
      key: 'upd',
      label: 'Editado',
      cell: (s) =>
        s.updatedAt ? (
          <span class="ad-cell2" title={fmtDateTime(s.updatedAt)}>
            <span>{fmtAgo(s.updatedAt)}</span>
            {s.updatedBy ? <span class="xs ad-ell">{email(s.updatedBy) ?? ''}</span> : null}
          </span>
        ) : (
          <span class="xs">—</span>
        ),
    },
  ];
  const nextN = all.reduce((m, s) => Math.max(m, s.n), 0) + 1;
  return (
    <Page
      title="Temporadas"
      kicker="Conteúdo"
      actions={<Button label="Nova temporada" icon="plus" onClick={() => setCreating(true)} />}
    >
      <DraftNote />
      {loose ? (
        <div class="ad-note">
          {loose === 1 ? '1 episódio está' : `${loose} episódios estão`} sem temporada. Abra uma temporada para
          adicioná-los.
        </div>
      ) : null}
      <Async load={load} rows={4}>
        {(d) =>
          d.items.length ? (
            <Table
              rows={d.items}
              cols={cols}
              rowKey={(s) => String(s.n)}
              href={(s) => `conteudo/temporadas/${s.n}`}
              caption="Temporadas"
            />
          ) : (
            <Empty icon="trail" title="Nenhuma temporada ainda." body="Crie a primeira pelo botão Nova temporada." />
          )
        }
      </Async>
      {creating ? (
        <CreateModal
          noun="Temporada"
          idLabel="Número"
          idHint="A ordem no curso (1, 2, 3…)."
          numeric
          suggestId={String(nextN)}
          onClose={() => setCreating(false)}
          create={async (id, title) => {
            const num = Number(id);
            await call(C.seasons.create, {
              body: { n: num, title, synopsis: null, testPassPct: 70, testQuestionCount: 20 },
            });
            go(`conteudo/temporadas/${num}`);
          }}
        />
      ) : null}
    </Page>
  );
}
