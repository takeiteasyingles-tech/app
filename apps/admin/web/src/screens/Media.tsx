// Mídia: the media library. Upload (drag and drop or picker, several at once, with progress; identical
// files are deduplicated by the server), filter by kind, search, preview, see where a file is used
// (content rows and retained releases) and delete it only when nothing uses it.
import { adminMediaApi, type MediaRow } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../api';
import { fmtBytes, fmtDateTime, fmtDuration } from '../format';
import { setQuery } from '../router';
import { useLoad, usePaged } from '../ui/async';
import { Icon } from '../ui/icons';
import { Button, CopyButton, Empty, ErrorBox, Facts, FilterChips, MoreButton, Page, SearchBox, Skeleton } from '../ui/kit';
import {
  DropZone,
  forgetMedia,
  KIND_LABEL,
  type MediaKind,
  MediaPreview,
  MediaTile,
  mediaMeta,
  mediaName,
  rememberMedia,
  UploadList,
  useUploads,
} from '../ui/media';
import { confirmAction, Modal } from '../ui/modal';
import { toast } from '../ui/toast';
import type { ScreenProps } from './registry';

const TABLE_LABEL: Record<string, string> = {
  episodes: 'Episódio',
  extras: 'Extra',
  albums: 'Álbum',
  album_tracks: 'Faixa',
  assistants: 'Assistente',
  assistant_clips: 'Vídeo de assistente',
  ebooks: 'E-book',
  option_lists: 'Lista do cadastro',
  content_blobs: 'Bloco de conteúdo',
  content_releases: 'Publicação',
};

function refHref(table: string, id: string): string | null {
  switch (table) {
    case 'episodes':
      return `conteudo/episodios/${id}`;
    case 'extras':
      return `conteudo/extras/${id}`;
    case 'albums':
      return `conteudo/albuns/${id}`;
    case 'assistants':
    case 'assistant_clips':
      return `conteudo/assistentes/${id.split(':')[0]}`;
    case 'ebooks':
      return `conteudo/ebooks/${id}`;
    case 'content_releases':
      return 'publicacoes';
    case 'option_lists':
      return 'conteudo/cadastro';
    default:
      return null;
  }
}

function Detail({ m, onClose, onDeleted }: { m: MediaRow; onClose: () => void; onDeleted: (id: string) => void }) {
  const refs = useLoad((signal) => call(adminMediaApi.refs, { params: { id: m.id }, signal }), [m.id]);
  const remove = () =>
    void confirmAction({
      title: 'Excluir este arquivo?',
      body: 'Só dá para excluir o que nada usa (nem o rascunho, nem uma publicação guardada). Não dá para desfazer.',
      confirm: 'Excluir arquivo',
      danger: true,
      run: () => call(adminMediaApi.remove, { params: { id: m.id } }),
    }).then((ok) => {
      if (ok) {
        forgetMedia(m.id);
        toast('Arquivo excluído.');
        onDeleted(m.id);
      }
    });
  const used = refs.data?.refs ?? [];
  return (
    <Modal
      title={mediaName(m)}
      size="lg"
      onClose={onClose}
      foot={
        <>
          <Button label="Excluir" icon="trash" kind="ad-danger-l" disabled={!refs.data || used.length > 0} onClick={remove} />
          <span class="grow" />
          <CopyButton text={m.id} label="Copiar id" />
          <a class="btn compact light" href={m.url} target="_blank" rel="noopener">
            <Icon name="link" size={18} />
            <span>Abrir</span>
          </a>
        </>
      }
    >
      <div class="card soft tc">
        <MediaPreview m={m} size="lg" />
      </div>
      <Facts
        rows={[
          ['Tipo', `${KIND_LABEL[m.kind]} · ${m.mime}`],
          ['Tamanho', fmtBytes(m.bytes)],
          ...(m.width && m.height ? ([['Dimensões', `${m.width} × ${m.height}`]] as const) : []),
          ...(m.durationMs ? ([['Duração', fmtDuration(m.durationMs)]] as const) : []),
          ['Enviado', fmtDateTime(m.createdAt)],
          ['Origem', m.sourcePath ?? 'Enviado pelo painel'],
          ['Id', <code class="ad-mono ad-break">{m.id}</code>],
          ['SHA-256', <code class="ad-mono ad-break">{m.sha256.slice(0, 16)}…</code>],
        ]}
      />
      <section class="stack" style={{ '--gap': '8px' }} aria-label="Onde é usado">
        <div class="lbl">Onde é usado</div>
        {refs.error ? (
          <ErrorBox error={refs.error} retry={refs.reload} />
        ) : !refs.data ? (
          <Skeleton rows={2} height={40} />
        ) : used.length ? (
          <ul class="ad-feed">
            {used.map((r) => {
              const href = refHref(r.table, r.id);
              const label = `${TABLE_LABEL[r.table] ?? r.table} ${r.table === 'content_releases' ? r.id.slice(0, 10) : r.id}`;
              return (
                <li key={`${r.table}:${r.id}:${r.column}`}>
                  <span class="ad-feed-ic">
                    <Icon name={r.table === 'content_releases' ? 'rocket' : 'link'} size={16} />
                  </span>
                  <div class="grow">
                    {href ? (
                      <a class="ad-linkbtn" href={`#/${href}`}>
                        {label}
                      </a>
                    ) : (
                      <b>{label}</b>
                    )}
                    <div class="xs">{r.table === 'content_releases' ? (r.column === 'current' ? 'publicação atual' : 'publicação guardada (para voltar)') : `campo ${r.column}`}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div class="ad-note bl">
            <Icon name="check" size={18} /> Nada usa este arquivo. Pode ser excluído.
          </div>
        )}
      </section>
    </Modal>
  );
}

export function Media({ q }: ScreenProps) {
  const kind = (q.tipo ?? '') as MediaKind | '';
  const search = q.q ?? '';
  const [open, setOpen] = useState<MediaRow | null>(null);
  const page = usePaged(
    async (cursor, signal) => {
      const res = await call(adminMediaApi.list, { query: { kind: kind || undefined, q: search || undefined, cursor, limit: 60 }, signal });
      rememberMedia(res.items);
      return res;
    },
    [kind, search],
  );
  const ups = useUploads((row) => {
    if (!kind || row.kind === kind) page.setItems((prev) => [row, ...prev.filter((x) => x.id !== row.id)]);
  });
  return (
    <Page
      title="Mídia"
      kicker="Conteúdo"
      bar={
        <div class="ad-filters">
          <SearchBox value={search} onValue={(v) => setQuery({ q: v })} placeholder="Buscar por nome, caminho ou id" id="media-q" />
          <FilterChips
            label="Tipo"
            value={kind}
            onChange={(v) => setQuery({ tipo: v })}
            options={[
              ['', 'Tudo'],
              ['image', 'Imagens'],
              ['audio', 'Áudios'],
              ['video', 'Vídeos'],
              ['pdf', 'PDFs'],
            ]}
          />
        </div>
      }
    >
      <DropZone onFiles={(f) => ups.add(f)}>Arraste arquivos para enviar</DropZone>
      {ups.items.length ? (
        <div class="stack" style={{ '--gap': '8px' }}>
          <div class="row between">
            <span class="lbl">Envios</span>
            {ups.items.some((u) => u.status !== 'up') ? <Button label="Limpar concluídos" kind="link" onClick={ups.clearDone} /> : null}
          </div>
          <UploadList items={ups.items} />
        </div>
      ) : null}
      {page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading ? (
        <Skeleton rows={4} height={120} />
      ) : !page.items.length ? (
        <Empty icon="image" title={search || kind ? 'Nada com esses filtros.' : 'A biblioteca está vazia.'} body="Envie imagens, áudios, vídeos ou PDFs acima." />
      ) : (
        <>
          <div class="ad-mgrid" role="list" aria-label="Arquivos">
            {page.items.map((m) => (
              <button key={m.id} type="button" class="ad-mcard" role="listitem" onClick={() => setOpen(m)} aria-label={`${mediaName(m)}, ${mediaMeta(m)}`}>
                <MediaTile m={m} />
                <span class="ad-pick-n">{mediaName(m)}</span>
                <span class="xs">{mediaMeta(m)}</span>
              </button>
            ))}
          </div>
          {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
        </>
      )}
      {open ? (
        <Detail
          m={open}
          onClose={() => setOpen(null)}
          onDeleted={(id) => {
            setOpen(null);
            page.setItems((prev) => prev.filter((x) => x.id !== id));
          }}
        />
      ) : null}
      {page.error && page.items.length ? <div class="fb err">{errorMessage(page.error)}</div> : null}
    </Page>
  );
}
