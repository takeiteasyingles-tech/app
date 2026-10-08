// Take Five: the bilingual culture pages (TIE.blocks(eb.five, 'EVITE') in prototipo/js/screens/curso.js),
// with the block markup of ui-blocks/Blocks plus what the prototype lacked: a page index ("Página 1
// de 5") on every page, a sticky page bar (one page at a time on both layouts: the bar and "Anterior /
// Próxima" switch it; pages already read in a soft blue, the page being read ringed in navy),
// an EVITE line that stays readable (its label over dark text) instead of blue-struck text, and the
// e-book's next parts at the end ("Depois daqui").
import type { Block, BlockRow } from '@tie/shared/content/schema';
import { activator, Btn, Icon } from '@tie/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { EB } from './common';

const BAD = 'EVITE';

const pageId = (i: number) => `five-p${i + 1}`;

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
        // The prototype struck the text through, which made exactly the words to avoid hard to read.
        // Here a small soft-red "x" and the EVITE label say it; the words stay unstruck, in a dark
        // red, on the row itself, under a dashed rule.
        <div
          class="row top mt4"
          style={{ '--gap': '8px', paddingTop: '9px', borderTop: '1.5px dashed var(--line2)', lineHeight: '1.45' }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '18px',
              height: '18px',
              flex: 'none',
              marginTop: '1px',
              borderRadius: '50%',
              background: 'var(--redT)',
              color: '#B23F35',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="close" size={10} extra={{ 'stroke-width': '3' }} />
          </span>
          <span class="stack" style={{ '--gap': '1px', minWidth: '0' }}>
            <span class="lbl" style={{ display: 'block', color: '#B23F35', fontSize: '.8rem' }}>
              {bad}
            </span>
            <span
              style={{ display: 'block', fontWeight: '700', color: '#8E2F27', fontSize: '1.04rem', textWrap: 'pretty' }}
            >
              {r.bad}
            </span>
          </span>
        </div>
      ) : null}
      {r.note ? <div class="sm mt4">{r.note}</div> : null}
    </div>
  );
}

/** Phone: reading text a touch smaller and tighter (a 1.08rem/1.6 body made a 8000px page). */
const READ_M = { fontSize: '1.02rem', lineHeight: '1.55' };

/** Two columns on desktop (short items side by side), one stack on a phone. */
const twoUp = (desk: boolean, gap: string) =>
  desk ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap } : { '--gap': gap };

function Page({ b, i, total, desk, hidden }: { b: Block; i: number; total: number; desk: boolean; hidden: boolean }) {
  const bad = b.badLabel || BAD;
  // Desktop: two paragraphs side by side, each whole in its own cell (CSS columns cut a sentence in
  // the middle); the cells are sized by the paragraphs' lengths (at most 2:1), so they end close to
  // each other. A lone paragraph spans the card.
  const both = desk && !!b.body && !!b.body2;
  const ratio = both ? Math.min(2, Math.max(1, (b.body?.length ?? 1) / Math.max(1, b.body2?.length ?? 1))) : 1;
  return (
    <div
      id={pageId(i)}
      class="card stack"
      hidden={hidden}
      style={{ '--gap': '12px', scrollMarginTop: desk ? '84px' : '72px' }}
    >
      <div class="row between base">
        <span class="lbl or">{b.k || ''}</span>
        <span class="pill bl">{`Página ${i + 1} de ${total}`}</span>
      </div>
      {b.title ? <div class="h2">{b.title}</div> : null}
      {both ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `minmax(0, ${ratio.toFixed(2)}fr) minmax(0, 1fr)`,
            gap: '32px',
            alignItems: 'start',
          }}
        >
          <p class="p-read">{b.body}</p>
          <p class="p-read" style={{ paddingLeft: '20px', borderLeft: '2px solid var(--line)' }}>
            {b.body2}
          </p>
        </div>
      ) : (
        <>
          {b.body ? (
            <p class="p-read" style={desk ? undefined : READ_M}>
              {b.body}
            </p>
          ) : null}
          {b.body2 ? (
            <p class="p-read" style={desk ? undefined : READ_M}>
              {b.body2}
            </p>
          ) : null}
        </>
      )}
      {b.rows?.length ? (
        <div class={desk ? undefined : 'stack'} style={twoUp(desk, '8px')}>
          {b.rows.map((r, j) => (
            <Row key={j} r={r} bad={bad} />
          ))}
        </div>
      ) : null}
      {b.bullets?.length ? (
        <div class={desk ? undefined : 'stack'} style={twoUp(desk, desk ? '12px 28px' : '10px')}>
          {b.bullets.map((x, j) => (
            <div key={j} class="row top" style={{ '--gap': '10px' }}>
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
              <span class="p-read" style={desk ? undefined : READ_M}>
                {x}
              </span>
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

/** "Palavra-chave" from "PALAVRA-CHAVE". */
const pageName = (b: Block): string => {
  const k = (b.k || '').toLowerCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
};

/**
 * The page bar: a sticky segmented control over the pages, one segment per page, that always fits
 * the width. Pages already passed are soft blue with a check, the page being read is white with a
 * navy ring (a solid navy pill weighed too much beside its plain siblings), the rest plain. Desktop:
 * number and name on every segment. Phone (one page at a time): the current segment carries its name,
 * the others their number.
 */
function Index({
  list,
  desk,
  cur,
  onPick,
}: {
  list: readonly Block[];
  desk: boolean;
  cur: number;
  onPick: (i: number) => void;
}) {
  const side = desk ? '32px' : '18px';
  const navRef = useRef<HTMLElement>(null);
  // Phone: the bar scrolls sideways; the page being read is brought into view (centred).
  useEffect(() => {
    if (desk) return;
    const nav = navRef.current;
    const el = nav?.children[cur] as HTMLElement | undefined;
    if (!nav || !el) return;
    nav.scrollLeft = Math.max(0, el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2);
  }, [cur, desk]);
  return (
    <div
      style={{
        position: 'sticky',
        top: '0',
        zIndex: '3',
        background: 'var(--cream)',
        margin: `0 -${side}`,
        padding: desk ? `6px ${side} 8px` : '6px 0 8px',
      }}
    >
      <nav
        ref={navRef}
        class="chips"
        aria-label="Páginas"
        style={
          desk
            ? {
                flexWrap: 'nowrap',
                gap: '4px',
                padding: '4px',
                borderRadius: '999px',
                background: '#fff',
                border: '1.5px solid var(--line2)',
                boxShadow: '0 2px 8px rgba(15,42,85,.06)',
              }
            : {
                // Phone: every page with its number and name, in a row that scrolls sideways inside
                // the bar (five names do not fit 375px; bare numbers said nothing).
                flexWrap: 'nowrap',
                gap: '6px',
                overflowX: 'auto',
                scrollbarWidth: 'none',
                padding: `2px ${side}`,
                scrollPaddingInline: side,
              }
        }
      >
        {list.map((b, i) => {
          const on = i === cur;
          const read = i < cur;
          const name = pageName(b);
          return (
            <button
              key={i}
              type="button"
              class="chip"
              aria-current={on ? 'true' : undefined}
              aria-label={`Página ${i + 1}: ${name}`}
              style={{
                flex: desk ? '1 1 0' : 'none',
                minWidth: '0',
                minHeight: desk ? '40px' : '44px',
                padding: '0 14px',
                justifyContent: 'center',
                gap: '6px',
                ...(desk ? {} : { border: '1.5px solid var(--line2)' }),
                ...(on
                  ? {
                      background: '#fff',
                      borderColor: 'var(--navy)',
                      color: 'var(--navy)',
                      boxShadow: '0 1px 4px rgba(15,42,85,.12)',
                    }
                  : read
                    ? { background: 'var(--blueT)', borderColor: 'var(--blueT)', color: 'var(--blueD)' }
                    : { background: '#fff', borderColor: desk ? 'transparent' : 'var(--line2)' }),
              }}
              onClick={activator(undefined, () => onPick(i))}
            >
              {read ? <Icon name="check" size={13} extra={{ 'stroke-width': '3' }} /> : null}
              <b style={{ color: read ? 'var(--blueD)' : 'var(--orange)' }}>{i + 1}</b>
              <span style={{ minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** The e-book's other parts, after the last page, so the reading leads somewhere next. */
const MORE: readonly { go: string; name: string; meta: string; icon: string }[] = [
  { go: `ebook/${EB}/lead`, name: 'Take the Lead', meta: 'Conversa com a Margaret', icon: 'chat' },
  { go: `ebook/${EB}/real`, name: 'Take it for Real', meta: 'O livro × a rua', icon: 'bulb' },
  { go: `ebook/${EB}/teste`, name: 'Take the episode test', meta: '20 questões', icon: 'pen' },
];

function More({ desk }: { desk: boolean }) {
  // Desktop: three cards in a row. Phone: one card, the three parts as rows split by hairlines.
  return (
    <nav class="stack mt8" aria-label="Depois daqui" style={{ '--gap': '8px' }}>
      <div class="lbl">Depois daqui</div>
      <div
        class={desk ? undefined : 'card'}
        style={
          desk
            ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }
            : { padding: '4px 16px' }
        }
      >
        {MORE.map((x, j) => (
          <a
            key={x.go}
            href={`#/${x.go}`}
            class={desk ? 'card row' : 'row'}
            style={
              desk
                ? { '--gap': '12px', padding: '14px 16px' }
                : { '--gap': '12px', padding: '10px 0', borderTop: j ? '1.5px solid var(--line)' : undefined }
            }
          >
            <span
              aria-hidden="true"
              style={{
                width: '42px',
                height: '42px',
                flex: 'none',
                borderRadius: '12px',
                background: 'var(--blue)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={x.icon} size={21} />
            </span>
            <span class="grow">
              <span class="h3" style={{ display: 'block' }}>
                {x.name}
              </span>
              <span class="sm" style={{ display: 'block' }}>
                {x.meta}
              </span>
            </span>
            <Icon name="next" size={18} />
          </a>
        ))}
      </div>
    </nav>
  );
}

/**
 * One page at a time on both layouts (all five stacked made a long scroll and left the bar without a
 * purpose): the bar and the "Anterior / Próxima" buttons under the page switch it; the other pages
 * stay in the DOM, hidden. Desktop: "Depois daqui" under every page; phone: it closes the last page.
 */
export function Five({ list, desk }: { list: readonly Block[]; desk: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState(0);
  const cur = Math.min(pick, list.length - 1);
  const last = list.length - 1;
  const show = (i: number) => {
    setPick(i);
    // The new page starts under the bar (the bar is sticky at the top of this block).
    requestAnimationFrame(() => host.current?.scrollIntoView({ block: 'start' }));
  };
  const prev = list[cur - 1];
  const next = list[cur + 1];
  return (
    <div ref={host} class="stack" style={{ '--gap': '14px', scrollMarginTop: '0' }}>
      <Index list={list} desk={desk} cur={cur} onPick={show} />
      {list.map((b, i) => (
        <Page key={i} b={b} i={i} total={list.length} desk={desk} hidden={i !== cur} />
      ))}
      {desk ? (
        // Desktop: Anterior on the left, the next page on the right, each at its own width.
        <div class="row between" style={{ '--gap': '12px' }}>
          {prev ? (
            <Btn label={`Anterior: ${pageName(prev)}`} kind="ghost" icon="back" onClick={() => show(cur - 1)} />
          ) : (
            <span />
          )}
          {next ? <Btn label={`Próxima: ${pageName(next)}`} iconR="next" onClick={() => show(cur + 1)} /> : null}
        </div>
      ) : (
        <div class="row" style={{ '--gap': '8px' }}>
          {cur > 0 ? <Btn label="Anterior" kind="ghost" icon="back" onClick={() => show(cur - 1)} /> : null}
          {next ? (
            <Btn label={`Próxima: ${pageName(next)}`} cls="grow" iconR="next" onClick={() => show(cur + 1)} />
          ) : null}
        </div>
      )}
      {desk || cur === last ? <More desk={desk} /> : null}
    </div>
  );
}
