// Lists: a real <table> on desktop, a stack of cards on phones (same columns, labelled). The primary
// column carries the row's link, so every row is reachable with Tab and opens with Enter.
import type { ComponentChildren } from 'preact';
import { go } from '../router';
import { wide } from './layout';

export interface Col<T> {
  key: string;
  label: string;
  cell: (row: T) => ComponentChildren;
  /** Text alignment / width helpers: 'num' right-aligns, 'shrink' keeps the column narrow. */
  cls?: string;
  /** Left out of the phone card. */
  desktopOnly?: boolean;
}

export interface TableProps<T> {
  rows: readonly T[];
  cols: readonly Col<T>[];
  rowKey: (row: T) => string;
  /** Hash path each row opens (the first column becomes its link). */
  href?: (row: T) => string;
  caption?: string;
  /** Highlighted rows (e.g. the current release). */
  hi?: (row: T) => boolean;
}

export function Table<T>({ rows, cols, rowKey, href, caption, hi }: TableProps<T>) {
  if (!wide.value) {
    const [first, ...rest] = cols;
    return (
      <ul class="ad-cards" aria-label={caption}>
        {rows.map((r) => {
          const link = href?.(r);
          return (
            <li key={rowKey(r)} class={`ad-rcard${hi?.(r) ? ' hi' : ''}`}>
              <div class="ad-rcard-h">
                {link ? (
                  <a class="ad-rowlink" href={`#/${link}`}>
                    {first?.cell(r)}
                  </a>
                ) : (
                  first?.cell(r)
                )}
              </div>
              <dl class="ad-rcard-b">
                {rest
                  .filter((c) => !c.desktopOnly)
                  .map((c) => (
                    <div key={c.key}>
                      <dt>{c.label}</dt>
                      <dd>{c.cell(r)}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div class="ad-tablewrap">
      <table class="ad-table">
        {caption ? <caption class="sr">{caption}</caption> : null}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col" class={c.cls}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const link = href?.(r);
            return (
              <tr
                key={rowKey(r)}
                class={`${link ? 'click' : ''}${hi?.(r) ? ' hi' : ''}`}
                onClick={
                  link
                    ? (e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('a, button, input, select, textarea, label')) return;
                        go(link);
                      }
                    : undefined
                }
              >
                {cols.map((c, i) => (
                  <td key={c.key} class={c.cls}>
                    {i === 0 && link ? (
                      <a class="ad-rowlink" href={`#/${link}`}>
                        {c.cell(r)}
                      </a>
                    ) : (
                      c.cell(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
