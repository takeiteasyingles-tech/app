// Take Some Extras (#/ebook/:num/:part): port of TIE.screens.ebookx in prototipo/js/screens/curso.js.
// five = bilingual culture pages (TIE.blocks), real = book vs street, lead = scripted chat with
// Margaret. PROD (spec 05 "Take Some Extras at the end of every episode"): they open from the
// episode's Concluído screen and go back to it; the test is the player's Take the Test step.
import type { Ebook } from '@tie/shared/content/schema';
import { type ScreenProps, useChrome } from '../../frame';
import { isDesk, LoadFailed, PartFrame, pad2, useEbook } from './common';
import { Five } from './Five';
import { Lead } from './Lead';

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
 * Book vs street. Each card leads with what people say ("Na rua", the phrase to learn), then the
 * textbook form on one compact line ("No livro", or "não aparece no livro" in muted italics instead
 * of a bare dash), then the why as plain reading text under a hairline. Desktop: a two-column grid,
 * so no line runs across the whole main and the rows (and the last row) end level.
 */
function Real({ eb, desk }: { eb: Ebook; desk: boolean }) {
  return (
    <>
      <div
        style={
          desk
            ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 14px' }
            : // minmax(0, 1fr): an implicit auto column grows to the widest card's min-content.
              { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '10px' }
        }
      >
        {eb.real.map((r, i) => {
          const none = NOT_IN_BOOK.test(r.book);
          // Alternatives ("Bye · See you · Take care") on one line, split by an orange "·" (each kept
          // whole), so they read as options of one phrase and not as an unstructured list.
          const street = r.street.split(' · ');
          return (
            <div
              key={i}
              class="card stack"
              style={{
                '--gap': '8px',
                padding: desk ? '18px 20px' : '14px 16px',
              }}
            >
              <div class="stack" style={{ '--gap': '3px' }}>
                <K color="var(--orange)">Na rua</K>
                <span class="en" style={{ fontSize: '1.14rem', lineHeight: '1.4', textWrap: 'pretty' }}>
                  {street.map((x, j) => (
                    <span key={x}>
                      {j ? (
                        <span
                          aria-hidden="true"
                          style={{ color: 'var(--orange)', fontWeight: '900', margin: '0 .4em' }}
                        >
                          ·
                        </span>
                      ) : null}
                      {j ? <span class="sr">{' ou '}</span> : null}
                      {/* A line may break between alternatives (each one stays whole). */}
                      {j ? <wbr /> : null}
                      <span style={{ whiteSpace: x.length <= 28 ? 'nowrap' : undefined }}>{x}</span>
                    </span>
                  ))}
                </span>
              </div>
              <div class="row wrapx" style={{ '--gap': '4px 10px' }}>
                <K color="var(--muted)">No livro</K>
                {none ? (
                  // Plain muted words (a pill on three cards read as noise).
                  <span class="sm" style={{ fontStyle: 'italic', fontWeight: '600' }}>
                    não aparece no livro
                  </span>
                ) : (
                  <span class="p" style={{ color: 'var(--navy2)', fontSize: '.98rem', fontWeight: '600' }}>
                    {r.book}
                  </span>
                )}
              </div>
              <p
                class="p"
                style={{
                  fontSize: '.98rem',
                  lineHeight: '1.55',
                  color: 'var(--ink)',
                  margin: '0',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--line)',
                  textWrap: 'pretty',
                }}
              >
                {r.why}
              </p>
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
  // Unlike the prototype (a bare full-screen page), the parts keep the side nav / tab bar.
  useChrome({ tabs: true, nav: 'trilha', title: head.title || 'E-book' });
  const desk = isDesk();
  const { data: eb, error } = useEbook();
  // The episode this e-book row belongs to: the extras go back to its end screen.
  const epNum = eb?.episodes[0];
  const back = epNum ? `concluido/${epNum}` : 'trilha';
  const kicker = epNum ? `Episódio ${pad2(epNum)} · ${head.kick}` : head.kick;
  if (error) return <LoadFailed back="trilha" kicker={head.kick} title={head.title} />;
  if (!eb) return <PartFrame kick={head.kick} title={head.title} back={back} kicker={kicker} />;
  return (
    <PartFrame kick={head.kick} title={head.title} intro={head.intro} back={back} kicker={kicker}>
      {part === 'five' ? <Five list={eb.five} desk={desk} /> : null}
      {part === 'real' ? <Real eb={eb} desk={desk} /> : null}
      {part === 'lead' ? <Lead eb={eb} desk={desk} /> : null}
    </PartFrame>
  );
}
