// Extras: the catalogue of series, novelas, films, animes… (cover, scene, cast, script lines and
// vocabulary), with premiere / locked / premium flags and draft or published status.
import { adminContentApi, ExtraEdit as ExtraSchema, type ExtraRow } from '@tie/shared/contracts/admin';
import { useMemo, useState } from 'preact/hooks';
import { call } from '../../api';
import { go, setQuery } from '../../router';
import { useLoad } from '../../ui/async';
import type { Obj, Spec } from '../../ui/form';
import { Async, Button, Empty, FilterChips, Page, Pill, SearchBox } from '../../ui/kit';
import { useMedia } from '../../ui/media';
import { type Col, Table } from '../../ui/table';
import { zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { type CrudApi, CreateModal, crud, DraftNote, keysOf, patchOf, PubPill, pick, slugify } from './common';
import { DocEditor, tabFinder } from './DocEditor';
import { type Options, useOptions } from './options';

const C = adminContentApi;
const KEYS = keysOf(ExtraSchema.create);

function specsFor(o: Options): Record<string, readonly Spec[]> {
  return {
    geral: [
      { t: 'text', k: 'id', label: 'Identificador', ro: true, mono: true, hint: 'Faz parte do endereço (#/extra/id). Não muda.' },
      { t: 'text', k: 'title', label: 'Título' },
      {
        t: 'select',
        k: 'status',
        label: 'Situação',
        options: [
          ['draft', 'Rascunho'],
          ['published', 'Publicado'],
        ],
      },
      o.formats.length
        ? { t: 'select', k: 'format', label: 'Formato', options: o.formats }
        : { t: 'text', k: 'format', label: 'Formato', hint: 'series, novelas, filmes, animes, musica ou games.' },
      { t: 'text', k: 'kind', label: 'Tipo (rótulo)', opt: 'null', hint: 'Ex.: "Sitcom", "Filme · suspense".' },
      { t: 'text', k: 'epLabel', label: 'Episódio / parte', opt: 'null', hint: 'Ex.: "T1 · Ep. 3 · The Wrong Order".' },
      { t: 'text', k: 'level', label: 'Nível (rótulo)', opt: 'null', hint: 'Ex.: "A1–A2".' },
      {
        t: 'select',
        k: 'cefr',
        label: 'Nível para recomendar',
        opt: 'null',
        num: true,
        options: [
          ['1', '1 · iniciante (A1)'],
          ['2', '2 · básico (A2)'],
          ['3', '3 · intermediário (B1)'],
        ],
      },
      { t: 'text', k: 'dur', label: 'Duração', opt: 'null', hint: 'Ex.: "8 min".' },
      { t: 'int', k: 'sort', label: 'Ordem no catálogo' },
      { t: 'text', k: 'synopsis', label: 'Sinopse', opt: 'null', rows: 3 },
      { t: 'strings', k: 'genres', label: 'Gêneros', suggest: o.genres, hint: 'As chaves do cadastro (gostos do aluno).' },
      { t: 'strings', k: 'themes', label: 'Temas', suggest: o.themes },
      { t: 'bool', k: 'premiere', label: 'Estreia', hint: 'Aparece na prateleira de estreias.' },
      { t: 'bool', k: 'locked', label: 'Bloqueado', hint: 'Aparece com cadeado ("Sexta").' },
      { t: 'bool', k: 'premium', label: 'Premium', hint: 'Só abre para planos com Extras premium.' },
    ],
    midia: [
      { t: 'media', k: 'coverMedia', label: 'Capa (2:3)', kind: 'image', opt: 'null' },
      { t: 'media', k: 'sceneMedia', label: 'Imagem da cena (16:9)', kind: 'image', opt: 'null' },
    ],
    elenco: [
      {
        t: 'list',
        k: 'cast',
        label: 'Elenco',
        item: 'personagem',
        inline: true,
        make: () => ({ name: '', initials: '', color: '#2A6FF5' }),
        of: [
          { t: 'text', k: 'name', label: 'Nome' },
          { t: 'text', k: 'initials', label: 'Iniciais' },
          { t: 'text', k: 'color', label: 'Cor (#RRGGBB)', mono: true },
        ],
      },
      { t: 'text', k: 'dub', label: 'Personagem para dublar', opt: 'null', hint: 'O aluno dubla as falas deste personagem.' },
    ],
    roteiro: [
      {
        t: 'list',
        k: 'lines',
        label: 'Falas',
        item: 'fala',
        inline: true,
        of: [
          { t: 'text', k: 'who', label: 'Quem' },
          { t: 'text', k: 'en', label: 'Inglês' },
          { t: 'text', k: 'pt', label: 'Tradução' },
        ],
      },
    ],
    vocab: [
      {
        t: 'list',
        k: 'vocab',
        label: 'Vocabulário da cena',
        item: 'palavra',
        inline: true,
        of: [
          { t: 'text', k: 'en', label: 'Inglês' },
          { t: 'text', k: 'pt', label: 'Tradução' },
        ],
      },
    ],
  };
}

const TABS = [
  ['geral', 'Geral'],
  ['midia', 'Capa e cena'],
  ['elenco', 'Elenco'],
  ['roteiro', 'Roteiro'],
  ['vocab', 'Vocabulário'],
] as const;

function Preview({ d }: { d: ExtraRow }) {
  const cover = useMedia(d.coverMedia);
  const scene = useMedia(d.sceneMedia);
  return (
    <aside class="ad-preview" aria-label="Prévia para o aluno">
      <span class="lbl">Prévia no app</span>
      <div class="ad-phone">
        <div class="ad-phone-in navy on-navy">
          <div class="row top" style={{ '--gap': '14px' }}>
            <div class="cover">
              <div class="art">
                {cover ? <img src={cover.url} alt="" /> : null}
                {d.level ? <span class="pill lvl lv">{d.level}</span> : null}
              </div>
              <div class="ttl">{d.title}</div>
              <div class="why">{d.kind ?? ''}</div>
            </div>
            <div class="stack grow" style={{ '--gap': '6px' }}>
              {d.premiere ? <Pill label="Estreia" tone="or" /> : null}
              {d.premium ? <Pill label="Premium" tone="gold" /> : null}
              <span class="xs">{[d.epLabel, d.dur].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          {scene ? (
            <div class="scene">
              <div class="img" style={{ backgroundImage: `url("${scene.url}")`, animation: 'none' }} />
            </div>
          ) : null}
          {d.synopsis ? <p class="p">{d.synopsis}</p> : null}
          {d.lines.length ? (
            <div class="lines">
              {d.lines.slice(0, 8).map((l, i) => (
                <div key={i} class={`line${l.who === d.dub ? ' dub' : ''}`}>
                  <div class="who">{l.who.toUpperCase()}</div>
                  <div class="en">{l.en}</div>
                  <div class="pt">{l.pt}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export function ExtraEdit({ params, q }: ScreenProps) {
  const id = params.id ?? '';
  const o = useOptions();
  const specs = useMemo(() => specsFor(o), [o]);
  const all = useMemo(() => Object.values(specs).flat(), [specs]);
  const tabOf = useMemo(() => tabFinder(specs, 'geral'), [specs]);
  return (
    <DocEditor<Obj>
      load={async (signal) => pick((await crud.get<Obj>(C.extras as CrudApi, id, signal)).item, KEYS)}
      deps={[id]}
      title={(d) => String(d.title || id)}
      kicker="Extra"
      back="conteudo/extras"
      noun="Extra"
      tabs={TABS}
      tab={q.aba}
      specs={specs}
      allSpecs={all}
      tabOf={tabOf}
      idp="ex"
      header={(d) => <PubPill status={d.status as 'draft' | 'published'} />}
      validate={(d) => {
        const out = zodErrors(ExtraSchema.create, d);
        (d.cast as ExtraRow['cast']).forEach((c, i) => {
          if (!/^#[0-9A-Fa-f]{6}$/.test(c.color)) out[`cast.${i}.color`] = 'Use uma cor #RRGGBB.';
        });
        return out;
      }}
      persist={async (base, d) => {
        const patch = patchOf(base, d, KEYS);
        if (!Object.keys(patch).length) return d;
        return pick((await crud.update<Obj>(C.extras as CrudApi, id, patch)).item, KEYS);
      }}
      preview={(d) => <Preview d={d as unknown as ExtraRow} />}
      remove={{
        id,
        body: 'Some do rascunho. Se algum aluno já assistiu, o servidor recusa: mude para Rascunho em vez de excluir.',
        run: () => crud.remove(C.extras as CrudApi, id),
        after: 'conteudo/extras',
      }}
    />
  );
}

function Cover({ id }: { id: string | null }) {
  const m = useMedia(id);
  return m ? <img class="ad-thumb" src={m.url} alt="" loading="lazy" /> : <span class="ad-thumb" aria-hidden="true" />;
}

export function Extras({ q }: ScreenProps) {
  const load = useLoad((signal) => call(C.extras.list, { query: {}, signal }), []);
  const [creating, setCreating] = useState(false);
  const fmt = q.formato ?? '';
  const search = (q.q ?? '').toLowerCase();
  const all = load.data?.items ?? [];
  const formats = [...new Set(all.map((e) => e.format))];
  const rows = all.filter((e) => (!fmt || e.format === fmt) && (!search || `${e.id} ${e.title}`.toLowerCase().includes(search)));
  const cols: Col<ExtraRow>[] = [
    {
      key: 't',
      label: 'Extra',
      cell: (e) => (
        <span class="row" style={{ '--gap': '12px' }}>
          <Cover id={e.coverMedia} />
          <span class="ad-cell2">
            <span>{e.title}</span>
            <span class="xs">{[e.kind, e.epLabel].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
      ),
    },
    { key: 'f', label: 'Formato', cell: (e) => e.format },
    { key: 'lv', label: 'Nível', cell: (e) => e.level ?? '—' },
    {
      key: 'flags',
      label: 'Marcas',
      cell: (e) => (
        <span class="ad-pills">
          {e.premiere ? <Pill label="Estreia" tone="or" /> : null}
          {e.locked ? <Pill label="Bloqueado" icon="lock" /> : null}
          {e.premium ? <Pill label="Premium" tone="gold" /> : null}
          {!e.premiere && !e.locked && !e.premium ? <span class="xs">—</span> : null}
        </span>
      ),
    },
    { key: 'l', label: 'Falas', cls: 'num', cell: (e) => String(e.lines.length), desktopOnly: true },
    { key: 's', label: 'Situação', cell: (e) => <PubPill status={e.status} /> },
  ];
  return (
    <Page
      title="Extras"
      kicker="Conteúdo"
      actions={<Button label="Novo Extra" icon="plus" onClick={() => setCreating(true)} />}
      bar={
        <div class="ad-filters">
          <SearchBox value={q.q ?? ''} onValue={(v) => setQuery({ q: v })} placeholder="Buscar por título ou id" id="ex-q" />
          <FilterChips
            label="Formato"
            value={fmt}
            onChange={(v) => setQuery({ formato: v })}
            options={[['', 'Todos', all.length] as const, ...formats.map((f) => [f, f, all.filter((e) => e.format === f).length] as const)]}
          />
        </div>
      }
    >
      <DraftNote />
      <Async load={load}>
        {() =>
          rows.length ? (
            <Table rows={rows} cols={cols} rowKey={(e) => e.id} href={(e) => `conteudo/extras/${e.id}`} caption="Extras" />
          ) : (
            <Empty icon="tv" title={all.length ? 'Nenhum Extra com esses filtros.' : 'Nenhum Extra ainda.'} />
          )
        }
      </Async>
      {creating ? (
        <CreateModal
          noun="Extra"
          idLabel="Identificador"
          idHint="Letras minúsculas, números e hífen (vira o endereço #/extra/…)."
          onClose={() => setCreating(false)}
          create={async (id, title) => {
            await call(C.extras.create, {
              body: {
                id: slugify(id) || id,
                title,
                kind: null,
                format: formats[0] ?? 'series',
                genres: [],
                themes: [],
                level: null,
                cefr: 1,
                epLabel: null,
                dur: null,
                coverMedia: null,
                sceneMedia: null,
                synopsis: null,
                cast: [],
                dub: null,
                premiere: false,
                locked: false,
                premium: false,
                lines: [],
                vocab: [],
                sort: all.reduce((m, e) => Math.max(m, e.sort), 0) + 1,
                status: 'draft',
              },
            });
            go(`conteudo/extras/${slugify(id) || id}`);
          }}
        />
      ) : null}
    </Page>
  );
}
