// Conquistas (prototipo/js/screens/conta.js, TIE.screens.conquistas): level card, gamebar, today's
// missions, the medals and the "Como ganhar pontos" table. Points, medals and missions come from the
// server-backed store; the table reads the catalog's point values (same numbers as the prototype).
import type { Catalog, PointKind } from '@tie/shared/content/schema';
import { POINTS } from '@tie/shared/domain/game';
import { Icon, Missions, Topbar } from '@tie/ui';
import type { ScreenProps } from '../../frame';
import { levels, state } from '../../store';
import { LiveGamebar, LiveLevelPill } from '../../ui-blocks/chrome';
import { isDesktop, summary, WithCatalog } from '../inicio/today';

/** The prototype's static table: [label, point kind]. */
const EARN: readonly (readonly [string, PointKind])[] = [
  ['Etapa do episódio', 'step'],
  ['Episódio inteiro', 'episode'],
  ['Exercício certo', 'ex_right'],
  ['Pronúncia nota 8+', 'mic_good'],
  ['Fala no Mic', 'maggie_turn'],
  ['Conversa inteira', 'maggie_session'],
  ['Extra até o fim', 'extra'],
  ['Cartão revisado', 'card'],
  ['Missão do dia', 'mission'],
  ['Teste do e-book', 'test_pass'],
];

const BALANCE = { 'text-wrap': 'balance' } as const;
const MEDAL = { position: 'relative', padding: '14px 8px 12px', justifyContent: 'flex-start' } as const;
/**
 * Earned medals: white tile, gold disc, navy title, and a green check in the tile's corner.
 * Locked medals: the prototype faded the whole tile to 50%, which left grey-on-cream text hard to
 * read. Here the text stays legible but clearly secondary: no fill and a dashed outline (the tile
 * sits on the page's cream), a hollow grey disc with a grey icon, a lighter grey title, a muted
 * description, and a padlock in the tile's corner (clear of the disc).
 */
const LOCKED = {
  opacity: '1',
  background: 'transparent',
  border: '1.5px dashed var(--line2)',
  color: 'var(--muted)',
} as const;
const LOCKED_IC = {
  background: 'transparent',
  border: '2px solid var(--line2)',
  color: 'var(--muted)',
} as const;
const corner = (bg: string, fg: string) =>
  ({
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: bg,
    color: fg,
  }) as const;
/** A phone's two columns: a smaller disc and tighter tile so the seven rows stay compact. */
const IC_PHONE = { width: '44px', height: '44px' } as const;
const MEDAL_PHONE = { padding: '12px 8px 10px', gap: '4px' } as const;
const HAS_MARK = corner('var(--green)', '#fff');
const LOCK_MARK = corner('var(--line)', 'var(--muted)');

export default function Conquistas(_props: ScreenProps) {
  const desk = isDesktop();
  return (
    <>
      {desk ? null : <Topbar back="inicio" kicker="Sua caminhada" title="Conquistas" />}
      <WithCatalog>{(c) => <Body c={c} desk={desk} />}</WithCatalog>
    </>
  );
}

function Body({ c, desk }: { c: Catalog; desk: boolean }) {
  const g = summary(state.value, c);
  const l = g.level;
  const nextName = levels.value[l.n]?.[1];
  const pts = (k: PointKind) => c.game?.points?.[k] ?? POINTS[k];
  // Fixed columns on a grid of twice as many tracks (each medal spans 2). The column count divides
  // the 14 medals (7 on desktop: two full rows; 2 on a phone: seven full rows), so no row is short;
  // should the catalog's count not divide, the short last row keeps the medals' width and is centred.
  const cols = desk ? 7 : 2;
  const tracks = cols * 2;
  const rest = g.badges.length % cols;
  const lastRow = g.badges.length - rest;
  const offset = (tracks - rest * 2) / 2;
  const span = (i: number) =>
    rest && i >= lastRow && Number.isInteger(offset) ? `${offset + 1 + (i - lastRow) * 2} / span 2` : 'span 2';
  return (
    <div class="scroll">
      <div class="wrap stack" style={{ '--wrap': desk ? '1120px' : '760px', '--gap': '16px' }}>
        {desk ? (
          <div>
            <div class="lbl">Sua caminhada</div>
            <h1 class="h1 mt4">Conquistas</h1>
          </div>
        ) : null}
        <div class="card navy stack" style={{ '--gap': '12px' }}>
          <div class="row between">
            <LiveLevelPill />
            <span class="h2" style={{ color: '#fff' }}>{`${g.points} pontos`}</span>
          </div>
          <div class="bar">
            <i style={{ width: `${l.pct}%`, background: 'var(--orange)' }} />
          </div>
          <div class="xs" style={{ color: 'var(--onNavy)' }}>
            {l.next !== null && nextName
              ? `Faltam ${l.next - g.points} pontos para o nível ${l.n + 1} · ${nextName}`
              : 'Nível máximo alcançado.'}
          </div>
        </div>
        <LiveGamebar />
        <div class="card stack" style={{ '--gap': '8px' }}>
          <div class="row between">
            <div class="lbl">Missões do dia</div>
            <span class="xs">{`${g.missions.filter((m) => m.done).length}/${g.missions.length}`}</span>
          </div>
          <Missions list={g.missions} />
        </div>
        <div class="stack" style={{ '--gap': '8px' }}>
          <div class="lbl">{`Medalhas · ${g.badges.filter((b) => b.has).length} de ${g.badges.length}`}</div>
          {/* Fixed columns and equal row heights, so the grid never looks ragged. */}
          <div class="badges" style={{ gridTemplateColumns: `repeat(${tracks}, minmax(0, 1fr))`, gridAutoRows: '1fr' }}>
            {g.badges.map((b, i) => (
              <div
                key={b.id}
                class={`medal${b.has ? '' : ' locked'}`}
                style={{ ...MEDAL, ...(desk ? {} : MEDAL_PHONE), ...(b.has ? {} : LOCKED), gridColumn: span(i) }}
              >
                <span class="ic" style={{ ...(desk ? {} : IC_PHONE), ...(b.has ? {} : LOCKED_IC) }}>
                  <Icon name={b.icon} size={24} />
                  {/* The disc is not positioned, so the mark sits in the tile's corner. */}
                  <span style={b.has ? HAS_MARK : LOCK_MARK} aria-hidden="true">
                    <Icon name={b.has ? 'check' : 'lock'} size={12} />
                  </span>
                </span>
                <b
                  style={{
                    ...BALANCE,
                    fontSize: '.85rem',
                    fontWeight: b.has ? 800 : 700,
                    color: b.has ? undefined : 'var(--muted)',
                  }}
                >
                  {b.t}
                </b>
                <span
                  class="xs"
                  style={{
                    ...BALANCE,
                    fontSize: '.8125rem',
                    lineHeight: '1.35',
                    opacity: b.has ? undefined : '.85',
                  }}
                >
                  {b.s}
                </span>              </div>
            ))}
          </div>
        </div>
        {/* A white card (the prototype's cream-on-cream had no visible edge, so the list looked
            indented against the medals). */}
        <div class="card soft" style={{ background: '#fff', borderColor: 'var(--line)' }}>
          <div class="lbl">Como ganhar pontos</div>
          {/* Two columns on desktop (so a label and its points never sit a whole page apart), split
              by a rule so each column's points read with its own labels. */}
          <div
            class="stack mt8"
            style={desk ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' } : { '--gap': '4px' }}
          >
            {EARN.map(([t, k], i) => (
              <div
                key={k}
                class="row between"
                style={
                  desk
                    ? i % 2
                      ? { padding: '5px 0 5px 28px', borderLeft: '2px solid var(--line2)' }
                      : { padding: '5px 28px 5px 0' }
                    : undefined
                }
              >
                <span class="p">{t}</span>
                <span class="pill gold">{`+${pts(k)}`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
