// E-book parts (#/ebook/1/:part): port of TIE.screens.ebookx in prototipo/js/screens/curso.js.
// five = bilingual culture pages (TIE.blocks), real = book vs street, lead = scripted chat with
// Margaret, teste = the 20-question test graded on the server.
import type { Ebook } from '@tie/shared/content/schema';
import { type ScreenProps, useChrome } from '../../frame';
import { EB, isDesk, LoadFailed, PartFrame, pad2, useEbook } from './common';
import { Five } from './Five';
import { Lead } from './Lead';
import { Teste } from './Teste';

const HEAD: Record<string, { kick: string; title: string; intro?: string }> = {
  five: {
    kick: 'Extra',
    title: 'Take Five',
    intro: 'Páginas culturais bilíngues. Opcional, mas é aqui que mora o inglês que o livro não ensina.',
  },
  real: {
    kick: 'Extra',
    title: 'Take it for Real',
    intro: 'O que os livros ensinam, e o que as pessoas realmente dizem.',
  },
  lead: { kick: 'Extra', title: 'Take the Lead' },
  teste: { kick: 'Take a test', title: 'Take the episode test' },
};

/** A tip with no textbook form (the prototype printed "—" there). */
const NOT_IN_BOOK = /^[\s—–-]*$/;

/** Uppercase column label of a Real card. */
function K({ children, color }: { children: string; color: string }) {
  return (
    // .cmp .k's metrics spelled out, so the label reads the same outside a .cmp (desktop rows).
    <span
      class="k"
      style={{
        color,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        fontSize: '.75rem',
        fontWeight: '800',
        letterSpacing: '.08em',
      }}
    >
      {children}
    </span>
  );
}

/**
 * Book vs street, with "Não está no livro" instead of a bare dash. Phone: the prototype's .cmp label
 * column ("No livro" / "Na rua") and the why as a quieter line under a divider. Desktop: one row per
 * tip, three columns.
 */
function Real({ eb, desk }: { eb: Ebook; desk: boolean }) {
  return (
    <>
      <div class="stack" style={{ '--gap': '10px' }}>
        {eb.real.map((r, i) => {
          const none = NOT_IN_BOOK.test(r.book);
          const book = none ? (
            <span class="p" style={{ fontStyle: 'italic', color: 'var(--muted)' }}>
              Não está no livro
            </span>
          ) : (
            <span class="p">{r.book}</span>
          );
          if (desk) {
            // Desktop: one row per tip, book | street | why side by side, so every card is only as
            // tall as its longest column (no 2-column grid stretching short cards to a neighbour's
            // height).
            return (
              <div
                key={i}
                class="card stack"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 1.35fr)',
                  gap: '6px 24px',
                  padding: '16px 20px',
                  alignItems: 'start',
                }}
              >
                <div class="stack" style={{ '--gap': '4px' }}>
                  <K color="var(--muted)">No livro</K>
                  {book}
                </div>
                <div class="stack" style={{ '--gap': '4px' }}>
                  <K color="var(--orange)">Na rua</K>
                  <span class="en" style={{ fontSize: '1.12rem', textWrap: 'pretty' }}>
                    {r.street}
                  </span>
                </div>
                <div
                  class="sm"
                  style={{
                    alignSelf: 'stretch',
                    paddingLeft: '20px',
                    borderLeft: '1.5px solid var(--line2)',
                    color: 'var(--navy2)',
                  }}
                >
                  {r.why}
                </div>
              </div>
            );
          }
          return (
            <div key={i} class="card stack" style={{ '--gap': '10px', padding: '14px 16px' }}>
              <div class="cmp" style={{ gridTemplateColumns: 'max-content 1fr', gap: '6px 12px' }}>
                <K color="var(--muted)">No livro</K>
                {book}
                <K color="var(--orange)">Na rua</K>
                <span class="en" style={{ fontSize: '1.12rem' }}>
                  {r.street}
                </span>
              </div>
              {/* The why: a step below the phrases (smaller, in the muted navy of notes, after a
                  divider), and right under them in every card, so short cards keep the same rhythm. */}
              <div
                class="sm"
                style={{
                  paddingTop: '10px',
                  borderTop: '1.5px solid var(--line2)',
                  color: 'var(--navy2)',
                }}
              >
                {r.why}
              </div>
            </div>
          );
        })}
      </div>
      <div class="card navy stack" style={{ '--gap': '6px' }}>
        <div class="lbl" style={{ color: 'var(--onNavy)' }}>
          Uma observação sobre sotaque
        </div>
        <p class="p">
          Nada aqui é sobre perder o seu sotaque. O objetivo é você ser entendido de primeira e entender o que ouve.
        </p>
      </div>
    </>
  );
}

export default function EbookPart({ params }: ScreenProps) {
  const part = params.part ?? '';
  const head = HEAD[part] ?? { kick: 'Extra', title: '' };
  // Unlike the prototype (a bare full-screen page), the parts keep the side nav / tab bar of the
  // e-book hub they belong to.
  useChrome({ tabs: true, nav: 'trilha', title: head.title || 'E-book' });
  const desk = isDesk();
  const { data: eb, error } = useEbook();
  if (error) return <LoadFailed back={`ebook/${EB}`} kicker={`E-book ${pad2(EB)} · ${head.kick}`} title={head.title} />;
  if (!eb) return <PartFrame kick={head.kick} title={head.title} />;
  if (part === 'teste') return <Teste eb={eb} />;
  return (
    <PartFrame kick={head.kick} title={head.title} intro={head.intro}>
      {part === 'five' ? <Five list={eb.five} desk={desk} /> : null}
      {part === 'real' ? <Real eb={eb} desk={desk} /> : null}
      {part === 'lead' ? <Lead eb={eb} desk={desk} /> : null}
    </PartFrame>
  );
}
