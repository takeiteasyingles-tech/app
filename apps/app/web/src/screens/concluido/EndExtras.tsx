// PROD (0018, spec 05 "Take Some Extras at the end of every episode"): the e-book step left the
// episode track, so its optional extras (Take a Five, Take the Lead, Get Real, Take It Out) moved to
// the Concluído celebration. Same cards as the old e-book screen: a playable one links to
// #/ebook/:num/<part>; one still in production shows an "Em produção" pill and opens nothing.
import type { EbookExtra } from '@tie/shared/constants';
import type { Ebook, EbookExtraCard } from '@tie/shared/content/schema';
import { Icon } from '@tie/ui';
import { layoutOf } from '../../shell';
import { loadEbook, state, useContent } from '../../store';

const ALL: readonly EbookExtra[] = ['five', 'lead', 'real', 'out'];

/** Which extra a card is, from its route (`ebook/1/five`); anything else is Take It Out. */
function kindOf(card: EbookExtraCard): EbookExtra {
  return (/\/(five|lead|real)$/.exec(card.go)?.[1] as EbookExtra | undefined) ?? 'out';
}

/** An extra is offered only when it has content (Take It Out is always "Em produção"). */
function hasContent(eb: Ebook, kind: EbookExtra): boolean {
  if (kind === 'five') return eb.five.length > 0;
  if (kind === 'lead') return eb.lead.length > 0;
  if (kind === 'real') return eb.real.length > 0;
  return true;
}

export function EndExtras({ ebook }: { ebook: number | null | undefined }) {
  const { data: eb } = useContent<Ebook>(() => (ebook ? loadEbook(ebook) : Promise.reject(new Error('none'))), [ebook]);
  if (!eb) return null;
  const on = new Set<EbookExtra>(eb.extrasOn ?? ALL);
  const cards = eb.extrasCards.filter((x) => on.has(kindOf(x)) && hasContent(eb, kindOf(x)));
  if (!cards.length) return null;
  const desk = layoutOf(state.value) === 'desktop';
  return (
    <div class="stack" style={{ '--gap': '8px' }}>
      <div class="lbl">Take some extras · opcionais</div>
      <div style={{ display: 'grid', gridTemplateColumns: desk ? '1fr 1fr' : '1fr', gap: '10px' }}>
        {cards.map((x) => {
          const kind = kindOf(x);
          const go = kind === 'out' ? '' : `ebook/${eb.num}/${kind}`;
          const inner = (
            <>
              <div class={`row between ${go ? 'base' : ''}`}>
                <span class="h3">{x.name}</span>
                {go ? (
                  <span class="pill bl" style={{ gap: '2px', padding: '4px 6px 4px 10px' }}>
                    {x.meta}
                    <Icon name="next" size={18} />
                  </span>
                ) : (
                  <span class="pill" style={{ background: 'var(--goldT)', color: '#7A5400' }}>
                    <Icon name="clock" size={13} />
                    {x.meta || 'Em produção'}
                  </span>
                )}
              </div>
              <div class="sm" style={{ fontWeight: '700' }}>
                {x.pt}
              </div>
              <div class="p">{x.desc}</div>
            </>
          );
          return go ? (
            <a key={x.name} href={`#/${go}`} class="card stack" style={{ '--gap': '6px' }}>
              {inner}
            </a>
          ) : (
            <div key={x.name} class="card stack soon" style={{ '--gap': '6px' }}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
