// Media: previews, the upload queue (XHR with progress), the drop zone and the picker every content
// form uses for its media fields. Files are served by the admin Worker's /m/* to staff sessions.
import { LIMITS, MEDIA_MIME } from '@tie/shared/constants';
import { adminApi, type MediaRow } from '@tie/shared/contracts/admin';
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { call, errorMessage, uploadMedia } from '../api';
import { fmtBytes, fmtDuration } from '../format';
import { usePaged } from './async';
import { Icon } from './icons';
import { Button, Empty, ErrorBox, MoreButton, SearchBox, Skeleton } from './kit';
import { Modal } from './modal';

export type MediaKind = MediaRow['kind'];

export const KIND_LABEL: Record<MediaKind, string> = { image: 'Imagem', audio: 'Áudio', video: 'Vídeo', pdf: 'PDF' };
export const KIND_ICON: Record<MediaKind, string> = { image: 'image', audio: 'music', video: 'video', pdf: 'file' };

export const ACCEPT: Record<MediaKind, string> = {
  image: 'image/jpeg,image/png,image/webp',
  audio: 'audio/mpeg,audio/mp4,audio/wav,.mp3,.m4a,.wav',
  video: 'video/mp4,video/webm',
  pdf: 'application/pdf',
};
const ACCEPT_ALL = `${MEDIA_MIME.join(',')},.mp3,.m4a,.wav`;

/** "media/ab12cd34/img/gen/cover.webp" → "cover.webp" */
export function mediaName(m: Pick<MediaRow, 'sourcePath' | 'r2Key'>): string {
  const p = m.sourcePath || m.r2Key;
  return p.split('/').pop() || p;
}

export function mediaMeta(m: MediaRow): string {
  const parts = [KIND_LABEL[m.kind], fmtBytes(m.bytes)];
  if (m.width && m.height) parts.push(`${m.width}×${m.height}`);
  if (m.durationMs) parts.push(fmtDuration(m.durationMs));
  return parts.join(' · ');
}

// ---------- Lookup cache (media fields hold ids) ----------

const cache = new Map<string, MediaRow>();
const inflight = new Map<string, Promise<MediaRow | null>>();

export function rememberMedia(rows: readonly MediaRow[]): void {
  for (const r of rows) cache.set(r.id, r);
}

export function forgetMedia(id: string): void {
  cache.delete(id);
}

export function lookupMedia(id: string): Promise<MediaRow | null> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(id);
  if (!p) {
    p = call(adminApi.media.list, { query: { q: id, limit: 5 } })
      .then((res) => {
        rememberMedia(res.items);
        return res.items.find((m) => m.id === id) ?? null;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

/** undefined while loading, null when the id is unknown. */
export function useMedia(id: string | null | undefined): MediaRow | null | undefined {
  const [row, setRow] = useState<MediaRow | null | undefined>(id ? cache.get(id) : null);
  useEffect(() => {
    if (!id) {
      setRow(null);
      return;
    }
    const hit = cache.get(id);
    if (hit) {
      setRow(hit);
      return;
    }
    let alive = true;
    setRow(undefined);
    lookupMedia(id).then(
      (r) => alive && setRow(r),
      () => alive && setRow(null),
    );
    return () => {
      alive = false;
    };
  }, [id]);
  return row;
}

// ---------- Previews ----------

export function MediaPreview({ m, size = 'sm' }: { m: MediaRow; size?: 'sm' | 'lg' }) {
  if (m.kind === 'image') {
    return <img class={`ad-mprev ${size}`} src={m.url} alt={mediaName(m)} loading="lazy" decoding="async" />;
  }
  if (m.kind === 'video') {
    // biome-ignore lint/a11y/useMediaCaption: content preview of an uploaded file.
    return <video class={`ad-mprev ${size}`} src={m.url} controls preload="metadata" playsInline />;
  }
  if (m.kind === 'audio') {
    // biome-ignore lint/a11y/useMediaCaption: content preview of an uploaded file.
    return <audio class="ad-maudio" src={m.url} controls preload="none" />;
  }
  return (
    <a class="btn compact light" href={m.url} target="_blank" rel="noopener">
      <Icon name="file" size={18} />
      <span>Abrir PDF</span>
    </a>
  );
}

/** Square tile: image thumbnail or the kind's icon. */
export function MediaTile({ m }: { m: MediaRow }) {
  return (
    <span class={`ad-mtile k-${m.kind}`}>
      {m.kind === 'image' ? (
        <img src={m.url} alt="" loading="lazy" decoding="async" />
      ) : (
        <Icon name={KIND_ICON[m.kind]} size={26} />
      )}
    </span>
  );
}

// ---------- Uploads ----------

export interface UploadItem {
  key: string;
  name: string;
  bytes: number;
  progress: number;
  status: 'up' | 'done' | 'err';
  error?: string;
  row?: MediaRow;
  abort?: () => void;
}

/** Client prechecks; the Worker sniffs the bytes again. */
export function precheck(file: File, kind?: MediaKind): string | null {
  if (file.size > LIMITS.mediaMaxBytes) return `Maior que ${fmtBytes(LIMITS.mediaMaxBytes)}.`;
  const type = file.type || '';
  if (type && !(MEDIA_MIME as readonly string[]).includes(type)) return 'Formato não aceito.';
  if (kind && type) {
    const ok = kind === 'pdf' ? type === 'application/pdf' : type.startsWith(`${kind}/`);
    if (!ok) return `Este campo pede ${KIND_LABEL[kind].toLowerCase()}.`;
  }
  return null;
}

export function useUploads(onDone?: (row: MediaRow) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const patch = (key: string, p: Partial<UploadItem>) =>
    setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const add = (files: Iterable<File>, kind?: MediaKind) => {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      const bad = precheck(file, kind);
      const base: UploadItem = { key, name: file.name, bytes: file.size, progress: 0, status: 'up' };
      if (bad) {
        setItems((prev) => [{ ...base, status: 'err', error: bad }, ...prev]);
        continue;
      }
      const h = uploadMedia(file, (f) => patch(key, { progress: f }));
      setItems((prev) => [{ ...base, abort: h.abort }, ...prev]);
      h.promise.then(
        (row) => {
          rememberMedia([row]);
          patch(key, { status: 'done', progress: 1, row, abort: undefined });
          doneRef.current?.(row);
        },
        (e: unknown) => patch(key, { status: 'err', error: errorMessage(e), abort: undefined }),
      );
    }
  };
  const clearDone = () => setItems((prev) => prev.filter((x) => x.status === 'up'));
  return { items, add, clearDone };
}

export function UploadList({ items }: { items: readonly UploadItem[] }) {
  if (!items.length) return null;
  return (
    <ul class="ad-uploads" aria-label="Envios">
      {items.map((u) => (
        <li key={u.key} class={`ad-upload ${u.status}`}>
          <div class="row between">
            <span class="ad-upname">{u.name}</span>
            <span class="xs">
              {u.status === 'up'
                ? `${Math.round(u.progress * 100)}% de ${fmtBytes(u.bytes)}`
                : u.status === 'done'
                  ? 'Enviado'
                  : 'Falhou'}
            </span>
            {u.abort ? (
              <button type="button" class="ad-ib" aria-label={`Cancelar o envio de ${u.name}`} onClick={u.abort}>
                <Icon name="close" size={15} />
              </button>
            ) : null}
          </div>
          {u.status === 'up' ? (
            <div class="bar" role="progressbar" aria-label={`Enviando ${u.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)}>
              <i style={{ width: `${Math.round(u.progress * 100)}%` }} />
            </div>
          ) : null}
          {u.error ? <div class="xs ad-err-t">{u.error}</div> : null}
        </li>
      ))}
    </ul>
  );
}

export function DropZone({
  onFiles,
  kind,
  compact,
  children,
}: {
  onFiles: (files: File[]) => void;
  kind?: MediaKind;
  compact?: boolean;
  children?: ComponentChildren;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      class={`ad-drop${over ? ' over' : ''}${compact ? ' compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) onFiles(files);
      }}
    >
      <span class="ad-drop-ic">
        <Icon name="upload" size={22} />
      </span>
      <div class="grow">
        <div class="h3">{children ?? 'Arraste arquivos para cá'}</div>
        <div class="xs">
          {kind ? KIND_LABEL[kind] : 'Imagem, áudio, vídeo ou PDF'} · até {fmtBytes(LIMITS.mediaMaxBytes)}
        </div>
      </div>
      <input
        ref={input}
        id={id}
        class="sr"
        type="file"
        multiple
        accept={kind ? ACCEPT[kind] : ACCEPT_ALL}
        tabIndex={-1}
        onChange={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          const files = Array.from(el.files ?? []);
          el.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <Button label="Escolher arquivos" icon="upload" kind="navy" onClick={() => input.current?.click()} />
    </div>
  );
}

// ---------- Picker ----------

export function MediaPicker({
  kind,
  value,
  onPick,
  onClose,
}: {
  kind: MediaKind;
  value: string | null;
  onPick: (row: MediaRow) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(value);
  const page = usePaged(
    async (cursor, signal) => {
      const res = await call(adminApi.media.list, { query: { kind, q: q || undefined, cursor, limit: 48 }, signal });
      rememberMedia(res.items);
      return res;
    },
    [kind, q],
  );
  const ups = useUploads((row) => {
    if (row.kind !== kind) return;
    page.setItems((prev) => [row, ...prev.filter((x) => x.id !== row.id)]);
    setSel(row.id);
  });
  const chosen = page.items.find((m) => m.id === sel) ?? null;
  return (
    <Modal
      title={`Escolher ${KIND_LABEL[kind].toLowerCase()}`}
      size="xl"
      onClose={onClose}
      foot={
        <>
          <span class="xs grow ad-ell">{chosen ? `${mediaName(chosen)} · ${mediaMeta(chosen)}` : 'Nenhum arquivo escolhido'}</span>
          <Button label="Cancelar" kind="light" onClick={onClose} />
          <Button
            label="Usar este arquivo"
            icon="check"
            disabled={!chosen}
            onClick={() => {
              if (chosen) onPick(chosen);
            }}
          />
        </>
      }
    >
      <DropZone kind={kind} compact onFiles={(f) => ups.add(f, kind)}>
        Enviar {KIND_LABEL[kind].toLowerCase()} novo
      </DropZone>
      <UploadList items={ups.items} />
      <SearchBox value={q} onValue={setQ} placeholder="Buscar por nome ou id" id="picker-q" />
      {page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading ? (
        <Skeleton rows={3} height={90} />
      ) : !page.items.length ? (
        <Empty icon={KIND_ICON[kind]} title="Nenhum arquivo encontrado." body="Envie um arquivo novo acima." />
      ) : (
        <div class="ad-pick-grid" role="listbox" aria-label="Arquivos">
          {page.items.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === sel ? 'true' : 'false'}
              class={`ad-pick${m.id === sel ? ' on' : ''}`}
              onClick={() => setSel(m.id)}
              onDblClick={() => onPick(m)}
            >
              <MediaTile m={m} />
              <span class="ad-pick-n">{mediaName(m)}</span>
              <span class="xs">{mediaMeta(m)}</span>
            </button>
          ))}
        </div>
      )}
      {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
      {chosen && chosen.kind !== 'image' ? (
        <div class="card soft">
          <div class="lbl">Prévia</div>
          <div class="mt8">
            <MediaPreview m={chosen} size="lg" />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** A media field: current file (preview + name) with Escolher / Trocar / Remover. */
export function MediaField({
  id,
  value,
  kind,
  onChange,
  err,
}: {
  id: string;
  value: string | null;
  kind: MediaKind;
  onChange: (v: string | null) => void;
  err?: string | null;
}) {
  const row = useMedia(value);
  const [open, setOpen] = useState(false);
  return (
    <div class={`ad-mfield${err ? ' bad' : ''}`} id={id}>
      {value ? (
        row === undefined ? (
          <span class="ad-skel" style={{ height: '56px', flex: '1' }} />
        ) : row ? (
          <div class="ad-mfield-cur">
            {row.kind === 'image' || row.kind === 'video' ? <MediaTile m={row} /> : null}
            <div class="grow stack" style={{ '--gap': '4px', minWidth: '0' }}>
              <span class="ad-pick-n">{mediaName(row)}</span>
              <span class="xs">{mediaMeta(row)}</span>
              {row.kind === 'audio' ? <MediaPreview m={row} /> : null}
            </div>
          </div>
        ) : (
          <div class="xs ad-err-t grow">Arquivo {value} não encontrado.</div>
        )
      ) : (
        <div class="xs grow">Nenhum arquivo.</div>
      )}
      <div class="row" style={{ '--gap': '6px' }}>
        <Button label={value ? 'Trocar' : 'Escolher'} icon={KIND_ICON[kind]} kind="light" onClick={() => setOpen(true)} />
        {value ? <Button ariaLabel="Remover o arquivo" icon="close" kind="light" onClick={() => onChange(null)} /> : null}
      </div>
      {open ? (
        <MediaPicker
          kind={kind}
          value={value}
          onClose={() => setOpen(false)}
          onPick={(m) => {
            onChange(m.id);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
