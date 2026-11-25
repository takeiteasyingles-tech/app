// PROD (spec 05 "Take Some Extras at the end of every episode"): the e-book extras (Take Five, Take
// the Lead, Take it for Real, Take It Out) the episode offers, on its Concluído screen, as the
// prototype's e-book hub showed them: one card each, a playable one with its meta and a chevron, the
// one still in production with an "Em produção" pill. Which ones show is the episode's choice
// (Ebook.extrasOn, admin → Take Some Extras); their content lives on its hidden e-book row.
import type { Ebook, EbookExtraCard } from '@tie/shared/content/schema';
import { Icon } from '@tie/ui';
import { layoutOf } from '../../shell';
import { loadEbook, state, useContent } from '../../store';

type Part = 'five' | 'lead' | 'real' | 'out';

/** Which extra a card is, from its route ("ebook/1/five"); no route = Take It Out, in production. */
function partOf(x: EbookExtraCard): Part {
  const m = /\/(five|lead|real)$/.exec(x.go);
  return (m?.[1] as Part | undefined) ?? 'out';
}

/** The extra has something to open (pages, a conversation, cards); Take It Out always shows. */
function hasContent(eb: Ebook, p: Part): boolean {
  if (p === 'five') return eb.five.length > 0;
  if (p === 'lead') return eb.lead.length > 0;
  if (p === 'real') return eb.real.length > 0;
  return true;
}

export function EpisodeExtras({ ebook }: { ebook: number | null | undefined }) {
  const { data: eb } = useContent<Ebook>(() => (ebook ? loadEbook(ebook) : Promise.reject(new Error('none'))), [ebook]);
  if (!eb) return null;
  const on = new Set<Part>(eb.extrasOn ?? ['five', 'lead', 'real', 'out']);
  const cards = eb.extrasCards.filter((x) => on.has(partOf(x)) && hasContent(eb, partOf(x)));
  if (!cards.length) return null;
  const desk = layoutOf(state.value) === 'desktop';
  return (
    <div class="stack" style={{ '--gap': '8px' }}>
      <div class="lbl">Take some extras · opcionais</div>
      <div style={{ display: 'grid', gridTemplateColumns: desk ? '1fr 1fr' : '1fr', gap: '10px' }}>
        {cards.map((x) => {
          const go = partOf(x) === 'out' ? '' : `ebook/${eb.num}/${partOf(x)}`;
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
