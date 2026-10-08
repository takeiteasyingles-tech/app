// Media references: write-time checks (the id exists and is the right kind) and the reverse lookup
// that keeps a referenced file from being deleted. Content tables point at media by id; two blobs
// (scene_images, ui_images) hold media ids inside their JSON.
import { all, batch, fromJson, q } from '@tie/worker-core';
import type { Issue, MediaKind } from './entities';

export interface MediaNeed {
  id: string;
  path: string;
  kinds: readonly MediaKind[];
}

const KIND_PT: Record<MediaKind, string> = { image: 'imagem', audio: 'áudio', video: 'vídeo', pdf: 'PDF' };

/** Issues for unknown media ids and for files of the wrong kind. */
export async function mediaIssues(db: D1Database, needs: readonly MediaNeed[]): Promise<Issue[]> {
  const ids = [...new Set(needs.map((n) => n.id))];
  if (!ids.length) return [];
  const found = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await all<{ id: string; kind: string }>(
      db,
      `SELECT id, kind FROM media WHERE id IN (${chunk.map(() => '?').join(', ')})`,
      ...chunk,
    );
    for (const r of rows) found.set(r.id, r.kind);
  }
  const out: Issue[] = [];
  for (const n of needs) {
    const kind = found.get(n.id);
    if (!kind) out.push({ path: n.path, code: 'unknown_media', message: `Arquivo de mídia "${n.id}" não existe.` });
    else if (n.kinds.length && !n.kinds.includes(kind as MediaKind)) {
      out.push({
        path: n.path,
        code: 'media_kind',
        message: `Este campo aceita ${n.kinds.map((k) => KIND_PT[k]).join(' ou ')}, não ${KIND_PT[kind as MediaKind] ?? kind}.`,
      });
    }
  }
  return out;
}

/** Every column that holds a media id: [table, id expression, column]. */
const MEDIA_COLUMNS: readonly [string, string, string][] = [
  ['episodes', 'num', 'intro_media'],
  ['episodes', 'num', 'song_media'],
  ['episodes', 'num', 'scene_media'],
  ['ebooks', 'num', 'pdf_media'],
  ['extras', 'id', 'cover_media'],
  ['extras', 'id', 'scene_media'],
  ['albums', 'id', 'img_media'],
  ['album_tracks', 'id', 'audio_media'],
  ['assistants', 'key', 'poster_media'],
  ['assistants', 'key', 'thumb_media'],
  ['assistant_clips', "assistant_key || ':' || state", 'media_id'],
  ['option_lists', "list_key || ':' || scope || ':' || item_key", 'img_media'],
];

export interface MediaRef {
  table: string;
  id: string;
  column: string;
}

/** Everything in D1 that points at a media id (columns and the media-holding blobs). */
export async function mediaReferences(db: D1Database, mediaId: string): Promise<MediaRef[]> {
  // One statement per column in a single batch (D1 caps the terms of a compound SELECT).
  const results = await batch(db, [
    ...MEDIA_COLUMNS.map(([table, idExpr, col]) =>
      q<{ id: string }>(db, `SELECT CAST(${idExpr} AS TEXT) AS id FROM ${table} WHERE ${col} = ?`, mediaId),
    ),
    q<{ key: string; json: string }>(
      db,
      "SELECT key, json FROM content_blobs WHERE key IN ('scene_images', 'ui_images')",
    ),
  ]);
  const out: MediaRef[] = [];
  MEDIA_COLUMNS.forEach(([table, , column], i) => {
    for (const r of (results[i] ?? []) as { id: string }[]) out.push({ table, id: r.id, column });
  });
  const blobs = (results[MEDIA_COLUMNS.length] ?? []) as { key: string; json: string }[];
  for (const b of blobs) {
    const value = fromJson<unknown>(b.json, null);
    for (const path of blobMediaPaths(b.key, value)) {
      if (path.id === mediaId) out.push({ table: 'content_blobs', id: b.key, column: path.path });
    }
  }
  return out;
}

/** Media ids inside the scene_images / ui_images blobs, with their JSON paths. */
export function blobMediaPaths(key: string, value: unknown): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  if (!value || typeof value !== 'object') return out;
  if (key === 'scene_images') {
    const v = value as { default?: unknown; episodes?: Record<string, unknown> };
    if (typeof v.default === 'string') out.push({ id: v.default, path: 'default' });
    for (const [ep, id] of Object.entries(v.episodes ?? {})) {
      if (typeof id === 'string') out.push({ id, path: `episodes.${ep}` });
    }
  } else if (key === 'ui_images') {
    for (const [k, id] of Object.entries(value as Record<string, unknown>)) {
      if (typeof id === 'string') out.push({ id, path: k });
    }
  }
  return out;
}
