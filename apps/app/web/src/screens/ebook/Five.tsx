// Take Five: the bilingual culture pages (TIE.blocks(eb.five, 'EVITE') in prototipo/js/screens/curso.js),
// with the block markup of ui-blocks/Blocks plus what the prototype lacked: a page index ("Página 1
// de 5") on every page, a jump list of the pages that follows the reading (a sticky one-line strip that
// fits a phone's width, a sticky card with the reading progress on desktop), and an EVITE line that
// stays readable (its label over dark text with a soft red strike) instead of blue-struck text.
import type { Block, BlockRow } from '@tie/shared/content/schema';
import { activator, Icon } from '@tie/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { EB } from './common';

const BAD = 'EVITE';

const pageId = (i: number) => `five-p${i + 1}`;

function jump(i: number): void {
  document.getElementById(pageId(i))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
        // The label over the line (not beside it): the struck text gets the whole width, so a list
        // like "Salário, quanto custou, aluguel" never leaves one word alone under the label.
        <div
          class="mt4 stack"
          style={{
            '--gap': '2px',
            padding: '7px 12px 8px',
            borderRadius: '10px',
            background: 'var(--redT)',
            lineHeight: '1.45',
            fontSize: '.95rem',
          }}
        >
          <span class="lbl" style={{ display: 'block', color: 'var(--red)' }}>
            {bad}
          </span>
          <span
            style={{
              display: 'block',
              fontWeight: '700',
              color: 'var(--navy)',
              textDecoration: 'line-through',
              textDecorationColor: 'rgba(217,100,91,.7)',
              textDecorationThickness: '1.5px',
              textWrap: 'pretty',
            }}
          >
            {r.bad}
          </span>
        </div>
      ) : null}
      {r.note ? <div class="sm mt4">{r.note}</div> : null}
    </div>
  );
}

function Page({ b, i, total }: { b: Block; i: number; total: number }) {
  const bad = b.badLabel || BAD;
  return (
    <div id={pageId(i)} class="card stack" style={{ '--gap': '12px', scrollMarginTop: '72px' }}>
      <div class="row between base">
        <span class="lbl or">{b.k || ''}</span>
        <span class="pill">{`Página ${i + 1} de ${total}`}</span>
      </div>
      {b.title ? <div class="h2">{b.title}</div> : null}
      {b.body ? <p class="p-read">{b.body}</p> : null}
      {b.body2 ? <p class="p-read">{b.body2}</p> : null}
      {b.rows?.length ? (
        <div class="stack" style={{ '--gap': '8px' }}>
          {b.rows.map((r, j) => (
            <Row key={j} r={r} bad={bad} />
          ))}
        </div>
      ) : null}
      {b.bullets?.length ? (
        <div class="stack" style={{ '--gap': '10px' }}>
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

/** "Palavra-chave" from "PALAVRA-CHAVE". */
const pageName = (b: Block): string => {
  const k = (b.k || '').toLowerCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
};

/**
 * The page list; the page being read is lit. Mobile: a sticky one-line strip that always fits the
 * width (no clipped chip): the page being read shows its number and name, the others only their
 * number. Desktop: a sticky card with every page named and the reading progress under them.
 */
function Index({ list, desk, cur }: { list: readonly Block[]; desk: boolean; cur: number }) {
  const total = list.length;
  const items = list.map((b, i) => {
    const on = i === cur;
    const name = pageName(b);
    return (
      <button
        key={i}
        type="button"
        class={`chip${on ? ' on' : ''}`}
        aria-current={on ? 'true' : undefined}
        aria-label={`Página ${i + 1}: ${name}`}
        style={
          desk
            ? { width: '100%', justifyContent: 'flex-start' }
            : on
              ? // Sized to its name (not stretched to the gutter), shrinking only if the row is short.
                { flex: '0 1 auto', minWidth: '0', justifyContent: 'flex-start', padding: '0 14px' }
              : { flex: 'none', width: '40px', padding: '0', justifyContent: 'center' }
        }
        onClick={activator(undefined, () => jump(i))}
      >
        <b style={{ color: on ? '#fff' : 'var(--orange)' }}>{i + 1}</b>
        {desk || on ? (
          <span style={{ minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        ) : null}
      </button>
    );
  });
  if (desk) {
    const pct = total ? Math.round(((cur + 1) / total) * 100) : 0;
    return (
      <nav class="card stack" aria-label="Páginas" style={{ '--gap': '8px', padding: '16px' }}>
        <div class="lbl">{`${total} páginas`}</div>
        {items}
        <div class="stack mt8" style={{ '--gap': '6px', paddingTop: '12px', borderTop: '1.5px solid var(--line)' }}>
          <div class="bar or">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span class="sm" style={{ fontWeight: '800', color: 'var(--navy)' }}>
            {`Lendo a página ${cur + 1} de ${total}`}
          </span>
        </div>
      </nav>
    );
  }
  return (
    <nav
      class="chips"
      aria-label="Páginas"
      style={{
        flexWrap: 'nowrap',
        gap: '6px',
        position: 'sticky',
        top: '0',
        zIndex: '3',
        background: 'var(--cream)',
        margin: '0 -18px',
        padding: '6px 18px 8px',
      }}
    >
      {items}
    </nav>
  );
}

/** The page whose top has passed the upper part of the scroller (the first one before any scroll). */
function useCurrentPage(total: number, host: { current: HTMLElement | null }): number {
  const [cur, setCur] = useState(0);
  useEffect(() => {
    const sc = host.current?.closest('.scroll') as HTMLElement | null;
    if (!sc) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = sc.getBoundingClientRect().top + 96;
      let at = 0;
      for (let i = 0; i < total; i++) {
        const el = document.getElementById(pageId(i));
        if (el && el.getBoundingClientRect().top <= top) at = i;
      }
      // At the very bottom the last page is the one being read, even when it is short.
      if (sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) at = total - 1;
      setCur(at);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      sc.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [total]);
  return cur;
}

/** Desktop: the e-book's other parts under the page index, so the side column leads somewhere next. */
const MORE: readonly { go: string; name: string; meta: string }[] = [
  { go: `ebook/${EB}/lead`, name: 'Take the Lead', meta: 'Conversa com a Margaret' },
  { go: `ebook/${EB}/real`, name: 'Take it for Real', meta: 'Livro × rua' },
  { go: `ebook/${EB}/teste`, name: 'Take the episode test', meta: '20 questões' },
];

function More() {
  return (
    <nav class="card stack" aria-label="Mais do e-book" style={{ '--gap': '4px', padding: '16px' }}>
      <div class="lbl" style={{ marginBottom: '4px' }}>
        Depois daqui
      </div>
      {MORE.map((x) => (
        <a
          key={x.go}
          href={`#/${x.go}`}
          class="row between"
          style={{ '--gap': '8px', padding: '8px 0', borderTop: '1.5px solid var(--line)' }}
        >
          <span style={{ minWidth: '0' }}>
            <span class="h3" style={{ display: 'block', fontSize: '.95rem' }}>
              {x.name}
            </span>
            <span class="xs" style={{ display: 'block' }}>
              {x.meta}
            </span>
          </span>
          <Icon name="next" size={16} />
        </a>
      ))}
    </nav>
  );
}

export function Five({ list, desk }: { list: readonly Block[]; desk: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const cur = useCurrentPage(list.length, host);
  const pages = list.map((b, i) => <Page key={i} b={b} i={i} total={list.length} />);
  if (!desk) {
    return (
      <div ref={host} class="stack" style={{ '--gap': '14px' }}>
        <Index list={list} desk={false} cur={cur} />
        {pages}
      </div>
    );
  }
  // Desktop: the page index (and where to go next) in a sticky side column beside the pages.
  return (
    <div ref={host} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '24px', alignItems: 'start' }}>
      <div class="stack" style={{ '--gap': '14px', position: 'sticky', top: '16px' }}>
        <Index list={list} desk cur={cur} />
        <More />
      </div>
      <div class="stack" style={{ '--gap': '14px' }}>
        {pages}
      </div>
    </div>
  );
}
