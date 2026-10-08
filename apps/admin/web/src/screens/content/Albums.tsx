// Álbuns da Música (Extras): album data plus its tracks (child rows). A track that points at an
// episode gets that episode's lyrics and gaps at publish; any other track carries its own lines.
import { AlbumEdit as AlbumSchema, type AlbumRow, adminContentApi, TrackEdit, type TrackRow } from '@tie/shared/contracts/admin';
import { useMemo, useState } from 'preact/hooks';
import { call } from '../../api';
import { go } from '../../router';
import { useLoad } from '../../ui/async';
import type { Obj, Spec } from '../../ui/form';
import { Async, Button, Empty, Page } from '../../ui/kit';
import { useMedia } from '../../ui/media';
import { type Col, Table } from '../../ui/table';
import { prefixErrors, zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { applyRows, applyToBase, type CrudApi, CreateModal, DraftNote, diffRows, keysOf, nextId, patchOf, pick, slugify } from './common';
import { DocEditor, PartialSave, tabFinder } from './DocEditor';
import { useOptions } from './options';

const C = adminContentApi;
const AL_KEYS = keysOf(AlbumSchema.create);
const TR_KEYS = keysOf(TrackEdit.create);
type Doc = Obj & { id: string; tracks: TrackRow[] };
const bySort = (a: TrackRow, b: TrackRow) => a.sort - b.sort;

const KEYS_PT = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];

function specsFor(genres: string[]): Record<string, readonly Spec[]> {
  return {
    geral: [
      { t: 'text', k: 'id', label: 'Identificador', ro: true, mono: true },
      { t: 'text', k: 'title', label: 'Título' },
      { t: 'text', k: 'sub', label: 'Subtítulo', opt: 'null' },
      { t: 'text', k: 'level', label: 'Nível (rótulo)', opt: 'null', hint: 'Ex.: "A1".' },
      { t: 'int', k: 'sort', label: 'Ordem' },
      { t: 'strings', k: 'genres', label: 'Gêneros', suggest: genres },
      { t: 'media', k: 'imgMedia', label: 'Capa', kind: 'image', opt: 'null' },
    ],
    faixas: [
      {
        t: 'list',
        k: 'tracks',
        label: 'Faixas',
        item: 'faixa',
        summary: (v) => `${String(v.title ?? '')}${v.epNum ? ` · episódio ${String(v.epNum)}` : ''}`,
        make: () => ({ title: '', srcFrom: null, audioMedia: null, epNum: null, bpm: null, musicKey: null, lines: null }),
        of: [
          { t: 'text', k: 'title', label: 'Título' },
          { t: 'text', k: 'srcFrom', label: 'De onde vem', opt: 'null', hint: 'Ex.: "Episódio 1 · Good Morning".' },
          { t: 'media', k: 'audioMedia', label: 'Áudio', kind: 'audio', opt: 'null' },
          { t: 'int', k: 'epNum', label: 'Episódio da letra', opt: 'null', min: 1, hint: 'Usa a letra (com lacunas) do episódio.' },
          { t: 'int', k: 'bpm', label: 'BPM (sintetizador)', opt: 'null', min: 1 },
          {
            t: 'select',
            k: 'musicKey',
            label: 'Tom (sintetizador)',
            opt: 'null',
            num: true,
            options: KEYS_PT.map((n, i) => [String(i), n] as const),
          },
          {
            t: 'list',
            k: 'lines',
            label: 'Letra própria',
            item: 'linha',
            inline: true,
            opt: 'null',
            when: (v) => !v.epNum,
            make: () => ({ en: '', pt: '', gap: '' }),
            of: [
              { t: 'text', k: 'en', label: 'Inglês' },
              { t: 'text', k: 'pt', label: 'Tradução' },
              { t: 'text', k: 'gap', label: 'Lacuna' },
            ],
          },
        ],
      },
    ],
  };
}

const TABS = [
  ['geral', 'Álbum'],
  ['faixas', 'Faixas'],
] as const;

async function loadDoc(id: string, signal: AbortSignal): Promise<Doc> {
  const [al, tr] = await Promise.all([
    call(C.albums.get, { params: { id }, signal }),
    call(C.tracks.list, { query: { parent: id }, signal }),
  ]);
  return { ...pick(al.item as unknown as Obj, AL_KEYS), id, tracks: [...tr.items].sort(bySort) } as Doc;
}

function normalize(d: Doc): Doc {
  const taken = d.tracks.map((t) => t.id).filter(Boolean);
  return {
    ...d,
    tracks: d.tracks.map((t, i) => {
      let id = t.id;
      if (!id) {
        id = nextId(`${d.id}-t`, taken);
        taken.push(id);
      }
      return { ...t, id, albumId: d.id, sort: i };
    }),
  };
}

function validate(d: Doc): Record<string, string> {
  const out: Record<string, string> = { ...zodErrors(AlbumSchema.create, pick(d, AL_KEYS)) };
  d.tracks.forEach((t, i) => Object.assign(out, prefixErrors(zodErrors(TrackEdit.create, pick(t as unknown as Obj, TR_KEYS)), `tracks.${i}`)));
  for (const k of Object.keys(out)) if (/\.(id|albumId|sort)$/.test(k)) delete out[k];
  return out;
}

async function persist(base: Doc, d: Doc): Promise<Doc> {
  const b: Doc = JSON.parse(JSON.stringify(base));
  let stage = 'o álbum';
  try {
    const patch = patchOf(pick(b, AL_KEYS), pick(d, AL_KEYS), AL_KEYS);
    if (Object.keys(patch).length) {
      const res = await call(C.albums.update, { params: { id: d.id }, body: patch as never });
      Object.assign(b, pick(res.item as unknown as Obj, AL_KEYS));
    }
    stage = 'as faixas';
    await applyRows(
      C.tracks as CrudApi,
      diffRows(b.tracks as unknown as Obj[], d.tracks as unknown as Obj[], (r) => String(r.id), TR_KEYS),
      TR_KEYS,
      (kind, id, row) => {
        b.tracks = applyToBase(b.tracks as unknown as Obj[], kind, id, row, (r) => String(r.id)) as unknown as TrackRow[];
      },
      (r) => String(r.id),
    );
  } catch (e) {
    b.tracks.sort(bySort);
    throw new PartialSave(b, e, stage, stage === 'o álbum');
  }
  b.tracks.sort(bySort);
  return b;
}

export function AlbumEdit({ params, q }: ScreenProps) {
  const id = params.id ?? '';
  const o = useOptions();
  const specs = useMemo(() => specsFor(o.genres), [o]);
  const all = useMemo(() => Object.values(specs).flat(), [specs]);
  const tabOf = useMemo(() => tabFinder(specs, 'geral'), [specs]);
  return (
    <DocEditor<Doc>
      load={(signal) => loadDoc(id, signal)}
      deps={[id]}
      title={(d) => String(d.title || id)}
      kicker="Álbum"
      back="conteudo/albuns"
      noun="Álbum"
      tabs={TABS}
      tab={q.aba}
      specs={specs}
      allSpecs={all}
      tabOf={tabOf}
      idp="al"
      validate={validate}
      normalize={normalize}
      persist={persist}
      remove={{
        id,
        body: 'Apaga o álbum e as faixas dele. Os alunos deixam de ver na próxima publicação.',
        run: () => call(C.albums.remove, { params: { id } }),
        after: 'conteudo/albuns',
      }}
    />
  );
}

function Art({ id }: { id: string | null }) {
  const m = useMedia(id);
  return m ? <img class="ad-thumb sq" src={m.url} alt="" loading="lazy" /> : <span class="ad-thumb sq" aria-hidden="true" />;
}

export function Albums(_: ScreenProps) {
  const load = useLoad((signal) => call(C.albums.list, { query: {}, signal }), []);
  const [creating, setCreating] = useState(false);
  const cols: Col<AlbumRow>[] = [
    {
      key: 't',
      label: 'Álbum',
      cell: (a) => (
        <span class="row" style={{ '--gap': '12px' }}>
          <Art id={a.imgMedia} />
          <span class="ad-cell2">
            <span>{a.title}</span>
            <span class="xs">{a.sub ?? ''}</span>
          </span>
        </span>
      ),
    },
    { key: 'lv', label: 'Nível', cell: (a) => a.level ?? '—' },
    { key: 'g', label: 'Gêneros', cell: (a) => a.genres.join(', ') || '—' },
    { key: 's', label: 'Ordem', cls: 'num', cell: (a) => String(a.sort) },
  ];
  const all = load.data?.items ?? [];
  return (
    <Page title="Álbuns" kicker="Conteúdo · Música" actions={<Button label="Novo álbum" icon="plus" onClick={() => setCreating(true)} />}>
      <DraftNote />
      <Async load={load}>
        {(d) =>
          d.items.length ? (
            <Table rows={d.items} cols={cols} rowKey={(a) => a.id} href={(a) => `conteudo/albuns/${a.id}`} caption="Álbuns" />
          ) : (
            <Empty icon="music" title="Nenhum álbum ainda." />
          )
        }
      </Async>
      {creating ? (
        <CreateModal
          noun="Álbum"
          idLabel="Identificador"
          idHint="Letras minúsculas, números e hífen."
          onClose={() => setCreating(false)}
          create={async (id, title) => {
            const slug = slugify(id) || id;
            await call(C.albums.create, {
              body: { id: slug, title, sub: null, level: null, imgMedia: null, genres: [], sort: all.reduce((m, a) => Math.max(m, a.sort), 0) + 1 },
            });
            go(`conteudo/albuns/${slug}`);
          }}
        />
      ) : null}
    </Page>
  );
}
