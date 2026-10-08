// Episódios: the 20 titles of the course with their status (só título → rascunho → publicado), filter
// and search in the URL, and "Novo episódio" (number + title, created as "só título").
import { adminContentApi, type EpisodeRow } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call } from '../../api';
import { fmtAgo, fmtDateTime } from '../../format';
import { useEmails } from '../../people';
import { go, setQuery } from '../../router';
import { useLoad } from '../../ui/async';
import { Async, Button, Empty, FilterChips, Page, SearchBox } from '../../ui/kit';
import { type Col, Table } from '../../ui/table';
import type { ScreenProps } from '../registry';
import { CreateModal, DraftNote, StatusPill } from './common';

export function blankEpisode(num: number, title: string) {
  return {
    num,
    title,
    seasonN: null,
    status: 'title_only' as const,
    ebookNum: null,
    synopsis: null,
    introMedia: null,
    songMedia: null,
    songTitle: null,
    sceneMedia: null,
    sceneNote: null,
    dialogTitle: null,
    dialogSub: null,
    lyrics: [],
    castNames: [],
    visual: [],
    dialog: [],
    lesson: [],
    pron: null,
    awayExp: [],
    awayWords: [],
    done: null,
  };
}

const completeness = (e: EpisodeRow): number => {
  const parts = [
    e.lyrics.length > 0,
    !!e.songMedia,
    e.visual.length > 0,
    e.dialog.length > 0,
    e.lesson.length > 0,
    e.awayExp.length > 0,
    !!e.done,
    !!e.introMedia,
    !!e.sceneMedia,
  ];
  return parts.filter(Boolean).length / parts.length;
};

export function Episodes({ q }: ScreenProps) {
  const status = q.status ?? '';
  const search = (q.q ?? '').toLowerCase();
  const load = useLoad((signal) => call(adminContentApi.episodes.list, { query: {}, signal }), []);
  const [creating, setCreating] = useState(false);
  const all = load.data?.items ?? [];
  const email = useEmails(all.map((e) => e.updatedBy));
  const rows = all.filter((e) => (!status || e.status === status) && (!search || `${e.num} ${e.title}`.toLowerCase().includes(search)));
  const count = (s: string) => all.filter((e) => e.status === s).length;
  const cols: Col<EpisodeRow>[] = [
    {
      key: 'title',
      label: 'Episódio',
      cell: (e) => (
        <span class="row" style={{ '--gap': '10px' }}>
          <span class="ad-epnum">{String(e.num).padStart(2, '0')}</span>
          <span class="ad-cell2">
            <span>{e.title}</span>
            <span class="xs">{e.ebookNum ? `E-book ${e.ebookNum}` : 'Sem e-book'}{e.seasonN ? ` · Temporada ${e.seasonN}` : ''}</span>
          </span>
        </span>
      ),
    },
    { key: 'status', label: 'Situação', cell: (e) => <StatusPill status={e.status} /> },
    {
      key: 'fill',
      label: 'Conteúdo',
      cell: (e) => {
        const c = completeness(e);
        return (
          <span class="row" style={{ '--gap': '8px', minWidth: '120px' }} title="Partes preenchidas: letra, música, Take a Look, diálogo, lição, Take Away, conclusão e mídias">
            <span class="bar grow" style={{ height: '8px' }}>
              <i style={{ width: `${Math.round(c * 100)}%`, background: c === 1 ? 'var(--green)' : undefined }} />
            </span>
            <span class="xs">{Math.round(c * 100)}%</span>
          </span>
        );
      },
    },
    { key: 'lines', label: 'Falas', cls: 'num', cell: (e) => String(e.dialog.length), desktopOnly: true },
    {
      key: 'upd',
      label: 'Editado',
      cell: (e) => (
        <span class="ad-cell2" title={fmtDateTime(e.updatedAt)}>
          <span>{fmtAgo(e.updatedAt)}</span>
          {e.updatedBy ? <span class="xs ad-ell">{email(e.updatedBy) ?? ''}</span> : null}
        </span>
      ),
    },
  ];
  const nextNum = all.reduce((m, e) => Math.max(m, e.num), 0) + 1;
  return (
    <Page
      title="Episódios"
      kicker="Conteúdo"
      actions={<Button label="Novo episódio" icon="plus" onClick={() => setCreating(true)} />}
      bar={
        <div class="ad-filters">
          <SearchBox value={q.q ?? ''} onValue={(v) => setQuery({ q: v })} placeholder="Buscar por número ou título" id="ep-q" />
          <FilterChips
            label="Situação"
            value={status}
            onChange={(v) => setQuery({ status: v })}
            options={[
              ['', 'Todos', all.length],
              ['published', 'Publicados', count('published')],
              ['draft', 'Rascunhos', count('draft')],
              ['title_only', 'Só título', count('title_only')],
            ]}
          />
        </div>
      }
    >
      <DraftNote />
      <Async load={load} rows={8}>
        {() =>
          rows.length ? (
            <Table rows={rows} cols={cols} rowKey={(e) => String(e.num)} href={(e) => `conteudo/episodios/${e.num}`} caption="Episódios" />
          ) : (
            <Empty icon="trail" title={all.length ? 'Nenhum episódio com esses filtros.' : 'Nenhum episódio ainda.'} />
          )
        }
      </Async>
      {creating ? (
        <CreateModal
          noun="Episódio"
          idLabel="Número"
          idHint="A posição na trilha (1, 2, 3…)."
          numeric
          suggestId={String(nextNum)}
          onClose={() => setCreating(false)}
          create={async (id, title) => {
            const num = Number(id);
            await call(adminContentApi.episodes.create, { body: blankEpisode(num, title) });
            go(`conteudo/episodios/${num}`);
          }}
        />
      ) : null}
    </Page>
  );
}
