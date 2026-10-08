// Keyset pagination. A cursor is the sort key of the last row served, as base64url(JSON array), so
// pages stay stable while rows are inserted (the audit log grows constantly). Lists fetch limit + 1
// rows to know whether another page exists.
import { ApiError } from '@tie/shared';
import { fromBase64Url, toBase64Url, utf8 } from '@tie/worker-core';

export type CursorKey = (string | number)[];

export function encodeCursor(key: CursorKey): string {
  return toBase64Url(utf8(JSON.stringify(key)));
}

/** Decodes a cursor whose parts have the given types ('s' string, 'n' number); throws on tampering. */
export function decodeCursor(cursor: string | undefined, shape: readonly ('s' | 'n')[]): CursorKey | null {
  if (!cursor) return null;
  const bad = () => new ApiError('validation_failed', 'Cursor inválido.', { issues: [{ path: 'cursor' }] });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(cursor)));
  } catch {
    throw bad();
  }
  if (!Array.isArray(parsed) || parsed.length !== shape.length) throw bad();
  shape.forEach((t, i) => {
    const v = parsed[i];
    if (t === 'n' ? typeof v !== 'number' || !Number.isFinite(v) : typeof v !== 'string') throw bad();
  });
  return parsed as CursorKey;
}

/** Splits limit + 1 fetched rows into the page and the next cursor. */
export function pageOf<Row, Item>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
  keyOf: (row: Row) => CursorKey,
): { items: Item[]; nextCursor: string | null } {
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { items: page.map(map), nextCursor: more && last !== undefined ? encodeCursor(keyOf(last)) : null };
}
