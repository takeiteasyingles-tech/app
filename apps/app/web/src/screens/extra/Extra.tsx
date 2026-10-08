// EXTRA catalog (TIE.screens.extra in prototipo/js/screens/extra.js): shelf tabs, the 3D coverflow
// of the top titles for this profile, rails by format, the music albums, the Desafio card and the
// Friday premieres. Ranking is the shared personalize.rankExtras / rankAlbums.
import { signal } from '@preact/signals';
import type { Album, Catalog, ExtraMeta } from '@tie/shared/content/schema';
import { FORMAT_WORD, label, type Ranked, rankAlbums, rankExtras } from '@tie/shared/domain/personalize';
import type { Profile } from '@tie/shared/state';
import { activator, Cover, Icon } from '@tie/ui';
import type { ComponentChildren, Ref } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import { type ScreenProps, useChrome } from '../../frame';
import { state } from '../../store/state';
import { UserAvatarBtn } from '../../ui-blocks/chrome';
import { isDesktop, useCatalog } from './data';
import { LoadFailed, OnNavy } from './parts';
import { XFlow } from './XFlow';

/** Fallback when the catalog has no extras_shelves blob. */
const SHELVES = [
  { k: 'pra-voce', t: 'Pra você' },
  { k: 'series', t: 'Séries' },
  { k: 'novelas', t: 'Novelas' },
  { k: 'filmes', t: 'Filmes' },
  { k: 'animes', t: 'Animes' },
  { k: 'musica', t: 'Música' },
  { k: 'games', t: 'Games' },
];

/** TIE.ui.shelf: the open shelf survives leaving and coming back during the session. */
export const shelf = signal('pra-voce');

type RankedExtra = Ranked<ExtraMeta>;
type RankedAlbum = Ranked<Album>;

/**
 * The album cover (album() in extra.js). Its 150px width (inline in the prototype) is .cover's own
 * width from tie.css, so the desktop rails can widen it.
 */
function AlbumCover({ k }: { k: RankedAlbum }) {
  return (
    <button type="button" class="cover" onClick={activator(`extra/musica/${k.id}`, undefined)}>
      <div class="art" style={{ aspectRatio: '1' }}>
        <img src={k.img ?? ''} alt="" loading="lazy" />
        <span class="pill lvl lv">{k.level}</span>
      </div>
      <div class="ttl">{k.title}</div>
      <div class="xs">{k.sub}</div>
      {k.why ? <div class="why">{k.why}</div> : null}
    </button>
  );
}

/**
 * rail(title, items, sub): nothing when there are no items. `cls` tags the rail for extra.css
 * (x-sq: square album covers).
 */
function Rail({
  title,
  sub,
  cls = '',
  children,
}: {
  title: string;
  sub?: string;
  cls?: string;
  children: ComponentChildren[];
}) {
  const rail = useRef<HTMLDivElement>(null);
  const items = children.filter(Boolean);
  if (!items.length) return null;
  // Phones show two whole cards per screen; a longer rail gets a "more" link that pages it.
  const more = !isDesktop() && items.length > 2;
  const page = () => {
    const el = rail.current;
    if (!el) return;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    el.scrollTo({ left: end ? 0 : el.scrollLeft + el.clientWidth - 18, behavior: 'smooth' });
  };
  // --n (the card count) lets the desktop rows share their width out by cards (extra.css).
  return (
    <section class={`stack x-rail ${cls}`} style={{ '--gap': '8px', '--n': String(items.length) }}>
      <div class={`x-railhd${sub ? ' x-hassub' : ''}`}>
        <div class="h2" style={{ color: '#fff' }}>
          {title}
        </div>
        {sub ? <div class="xs">{sub}</div> : null}
        {more ? (
          <button type="button" class="x-more" aria-label={`Ver mais: ${title}`} onClick={activator(undefined, page)}>
            Ver mais
            <Icon name="next" size={16} />
          </button>
        ) : null}
      </div>
      <div class="rail" ref={rail as Ref<HTMLDivElement>}>
        {items}
      </div>
    </section>
  );
}

/** Horizontal room taken by a desktop shelf panel besides its cards (padding + borders), and the gaps. */
const PANEL_PAD = 43;
const PANEL_GAP = 20;
const CARD_GAP = 12;

function ForYou({ c, p, open, soon, albums }: ShelfProps) {
  // Foundation note #2: Flow restarts when its items array changes identity, so key it on the ids.
  const top = open.slice(0, 7);
  const flowKey = top.map((x) => x.id).join('|');
  // Memoized on the ids on purpose.
  const flowItems = useMemo(() => top, [flowKey]);
  const fw = c.personalize?.formatWord ?? FORMAT_WORD;
  const desk = isDesktop();
  const shelvesByFormat = p.formats
    .filter((f) => f !== 'musica')
    .map((f) => ({ f, it: open.filter((x) => x.format === f) }))
    .filter((r) => r.it.length);
  const formatRails = shelvesByFormat.map(({ f, it }) => (
    <Rail key={f} title={label(c.onboarding.formats, f)}>
      {it.map((x) => (
        <Cover key={x.id} x={x} why={false} />
      ))}
    </Rail>
  ));
  const music = (
    <Rail title="Música" sub="Karaokê com lacunas" cls="x-sq">
      {albums.map((k) => (
        <AlbumCover key={k.id} k={k} />
      ))}
    </Rail>
  );
  const topRail = open[0] ? (
    <Rail title={open[0].why} sub="Os mais parecidos com o seu perfil">
      {open.slice(0, 6).map((x) => (
        <Cover key={x.id} x={x} />
      ))}
    </Rail>
  ) : null;
  const premieres = (
    <Rail title="Estreias sexta">
      {soon.map((x) => (
        <Cover key={x.id} x={x} why={false} />
      ))}
    </Rail>
  );
  // Desktop, tidy rows: when the poster shelves (formats + premieres) fit one row, they take it at one
  // card width (--cw); the music panel below gives its square covers room for one-line titles, with
  // the Desafio card beside it.
  const posterCounts = [...shelvesByFormat.map((r) => r.it.length), ...(soon.length ? [soon.length] : [])];
  const nPanels = posterCounts.length;
  const nCards = posterCounts.reduce((a, b) => a + b, 0);
  const tidy = desk && nPanels >= 2 && nPanels <= 3 && nCards >= 4 && nCards <= 6 && albums.length > 0;
  const fixed = (nPanels - 1) * PANEL_GAP + nPanels * PANEL_PAD + (nCards - nPanels) * CARD_GAP;
  return (
    <>
      <XFlow items={flowItems} id="flow-home" />
      <div class="tc xs">
        {`Arraste ou toque numa capa. Sugestões pelo que você marcou: ${p.formats.map((f) => fw[f] ?? f).join(', ')}.`}
      </div>
      {/* Desktop: a panel like every other shelf, so the row keeps its margins. */}
      {topRail && desk ? <div class="x-group">{topRail}</div> : topRail}
      {tidy ? (
        <div class="x-group x-tidy" style={{ '--cw': `min(220px, calc((100% - ${fixed}px) / ${nCards}))` }}>
          {formatRails}
          {premieres}
          {music}
          <DesafioCard />
        </div>
      ) : desk ? (
        // Desktop: the short rails share rows (with the Desafio card) instead of leaving the width empty.
        <div class="x-group">
          {formatRails}
          <DesafioCard />
          {music}
          {premieres}
        </div>
      ) : (
        <>
          {formatRails}
          {music}
          <DesafioCard />
          {premieres}
        </>
      )}
    </>
  );
}

/** The Desafio relâmpago card (the prototype's orange a.card), with the record as a highlight. */
function DesafioCard() {
  const best = state.value.extras.best;
  return (
    <div class="x-dwrap">
      <a class="card x-dcard" href="#/extra/desafio">
        <span class="ic">
          <Icon name="game" size={28} />
        </span>
        <span class="tx">
          {/* The prototype's title. When the card is narrow, "60 segundos" drops to its own line
              (the separator hides), so the title never ends on a dangling "·". */}
          <span class="h3">
            Desafio relâmpago<span class="x-sep"> · </span>
            <span class="x-sec">60 segundos</span>
          </span>
          <span class="xs">As falas dos Extras caem na tela. Escolha a tradução certa.</span>
        </span>
        <span class="meta">
          <span class="pill rec">
            <Icon name="trophy" size={14} /> {`Recorde: ${best} pontos`}
          </span>
        </span>
        <span class="steps" aria-hidden="true">
          <span>
            <b>1</b> Uma fala em inglês cai na tela
          </span>
          <span>
            <b>2</b> Toque na tradução certa
          </span>
          <span>
            <b>3</b> Acertos seguidos: até x5
          </span>
        </span>
        <span class="go">
          <span>Jogar agora</span>
          <Icon name="next" size={20} />
        </span>
      </a>
    </div>
  );
}

interface ShelfProps {
  c: Catalog;
  p: Profile;
  all: RankedExtra[];
  open: RankedExtra[];
  soon: RankedExtra[];
  albums: RankedAlbum[];
}

function Body(props: ShelfProps & { sh: string }) {
  const { sh, all, albums } = props;
  if (sh === 'pra-voce') return <ForYou {...props} />;
  if (sh === 'musica') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '16px' }}>
        {albums.map((k) => (
          <AlbumCover key={k.id} k={k} />
        ))}
      </div>
    );
  }
  const list = all.filter((x) => x.format === sh);
  if (!list.length) {
    return (
      <div class="card dash" style={{ color: 'var(--onNavy)', borderColor: 'var(--navy3)' }}>
        Nada nesta prateleira ainda. Toda sexta chega título novo.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '18px 14px' }}>
      {list.map((x) => (
        <Cover key={x.id} x={x} />
      ))}
    </div>
  );
}

export default function Extra(_props: ScreenProps) {
  useChrome({ title: 'EXTRA' });
  const { c, failed, retry } = useCatalog();
  const p = state.value.profile;
  const desk = isDesktop();
  const ranked = useMemo(() => {
    if (!c || !p) return null;
    const all = rankExtras(p, c);
    return {
      all,
      open: all.filter((x) => !x.locked),
      soon: all.filter((x) => x.locked),
      albums: rankAlbums(p, c),
    };
  }, [c, p]);
  const sh = shelf.value;
  const shelves = c?.extrasShelves.length ? c.extrasShelves : SHELVES;

  return (
    <OnNavy cls="x-cat" w={1120}>
      <header class="topbar">
        <div class="ttl">
          <div class="lbl">Séries, novelas, filmes, animes e música</div>
          <div class="h1" style={{ color: '#fff' }}>
            EXTRA
          </div>
        </div>
        {desk ? null : <UserAvatarBtn />}
      </header>
      <div class="scroll">
        {failed ? (
          <LoadFailed onRetry={retry} />
        ) : (
          <div class="wrap stack" style={{ '--wrap': '1120px', '--gap': '20px', paddingTop: '4px' }}>
            <div class="shelf-tabs">
              {shelves.map(({ k, t }) => (
                <button
                  type="button"
                  key={k}
                  class={sh === k ? 'on' : ''}
                  onClick={activator(undefined, () => {
                    shelf.value = k;
                  })}
                >
                  {t}
                </button>
              ))}
              <button
                type="button"
                class="x-dchip"
                style={{ background: 'var(--orange)', color: '#fff' }}
                onClick={activator('extra/desafio', undefined)}
              >
                <Icon name="game" size={18} extra={{ style: { verticalAlign: '-4px' } }} /> Desafio
              </button>
            </div>
            {c && p && ranked ? <Body sh={sh} c={c} p={p} {...ranked} /> : null}
          </div>
        )}
      </div>
    </OnNavy>
  );
}
