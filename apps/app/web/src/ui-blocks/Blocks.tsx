// TIE.blocks(list, badLabel) from prototipo/js/screens/curso.js: the lesson / Take Five content
// blocks (Take a Lesson in the player, Take Five in the e-book), with the prototype's exact markup.
import type { Block, BlockRow } from '@tie/shared/content/schema';

export interface BlocksProps {
  list: readonly Block[] | null | undefined;
  /** Label of the "wrong form" line (rows[].bad): the block's own badLabel wins, then this, then "NÃO É". */
  badLabel?: string;
}

function Row({ r, bad }: { r: BlockRow; bad: string }) {
  return (
    <div
      class="stack"
      style={{ '--gap': '4px', padding: '12px 14px', borderRadius: '14px', background: 'var(--cream)' }}
    >
      {r.q ? (
        <div class="sm" style={{ fontWeight: '700' }}>
          {r.q}
        </div>
      ) : null}
      <div class="en" style={{ fontSize: '1.06rem' }}>
        {r.en}
      </div>
      {r.pt ? <div class="pt">{r.pt}</div> : null}
      {r.bad ? (
        <div class="row base mt4" style={{ '--gap': '8px' }}>
          <span class="lbl bl" style={{ flex: 'none' }}>
            {bad}
          </span>
          <span class="strike" style={{ fontWeight: '700' }}>
            {r.bad}
          </span>
        </div>
      ) : null}
      {r.note ? <div class="sm mt4">{r.note}</div> : null}
    </div>
  );
}

function BlockCard({ b, badLabel }: { b: Block; badLabel: string | undefined }) {
  const bad = b.badLabel || badLabel || 'NÃO É';
  return (
    <div class="card stack" style={{ '--gap': '12px' }}>
      <div class="lbl or">{b.k || ''}</div>
      {b.title ? <div class="h2">{b.title}</div> : null}
      {b.body ? <p class="p-read">{b.body}</p> : null}
      {b.body2 ? <p class="p-read">{b.body2}</p> : null}
      {b.rows?.length ? (
        <div class="stack" style={{ '--gap': '8px' }}>
          {b.rows.map((r, i) => (
            <Row key={i} r={r} bad={bad} />
          ))}
        </div>
      ) : null}
      {b.bullets?.length ? (
        <div class="stack" style={{ '--gap': '10px' }}>
          {b.bullets.map((x, i) => (
            <div key={i} class="row top" style={{ '--gap': '10px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'var(--orange)',
                  flex: 'none',
                  marginTop: '9px',
                }}
              />
              <span class="p-read">{x}</span>
            </div>
          ))}
        </div>
      ) : null}
      {b.callout ? (
        <div class="card navy" style={{ padding: '14px 16px' }}>
          <div class="h3" style={{ color: '#fff' }}>
            {b.callout}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** TIE.blocks: one `.card.stack` per block, in order (nothing for an empty list). */
export function Blocks({ list, badLabel }: BlocksProps) {
  return (
    <>
      {(list || []).map((b, i) => (
        <BlockCard key={i} b={b} badLabel={badLabel} />
      ))}
    </>
  );
}
