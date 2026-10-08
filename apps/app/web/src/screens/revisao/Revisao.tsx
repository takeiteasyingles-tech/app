// Revisão (prototipo/js/screens/conta.js, TIE.screens.revisao): one flashcard at a time from the due
// queue. Tap flips it (PT + note), the speaker reads the EN, and a grade reschedules the card through
// POST /api/srs/cards/:id/grade (applied at once, +2 pontos from the server's award). Empty states:
// "Revisão em dia" with when the next card comes back, or "Seus cartões começam no episódio".
import type { Catalog } from '@tie/shared/content/schema';
import { srsApi } from '@tie/shared/contracts/srs';
import { current } from '@tie/shared/domain/guide';
import { GRADES, gradeCard, nextIn, queue } from '@tie/shared/domain/srs';
import type { DeckCard } from '@tie/shared/state';
import { activator, Btn, Icon, Topbar } from '@tie/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { say } from '../../core/speech';
import type { ScreenProps } from '../../frame';
import { clock, send, state } from '../../store';
import { UserAvatarBtn } from '../../ui-blocks/chrome';
import { isDesktop, publishedEpisodes, summary, WithCatalog } from '../inicio/today';

/**
 * review.grade(en, i) + game.award('card'): the card is rescheduled at once from this device's clock
 * and the server records the grade and plays the award. The server's card is kept except for its due
 * time, which stays the one computed here: the queue is checked against this device's clock, so a
 * "De novo" card (due now) must not drop out of the queue when the server clock runs a little ahead.
 */
function gradeNow(cardId: string, grade: number) {
  let at: number | null = null;
  return send(
    srsApi.grade,
    { params: { id: cardId }, body: { grade } },
    {
      optimistic: (s) => ({
        deck: s.deck.map((x) => {
          if (x.id !== cardId) return x;
          const next = gradeCard(x, grade, Date.now());
          if (!next) return x;
          at = next.at;
          return { ...x, ...next };
        }),
      }),
      apply: (r, s) => ({
        deck: s.deck.map((x) => (x.id === r.card.id ? { ...r.card, at: at ?? r.card.at } : x)),
        due: r.due,
      }),
    },
  );
}

// The prototype's info sentence, split only so "expressões-chave" never breaks at its hyphen
// (the text content is unchanged).
const INFO_A = 'Do Take a Look (palavras da cena) e do Take Away (';
const INFO_KEY = 'expressões-chave';
const INFO_B = ') de cada episódio que você faz';

const KEYCAP = {
  width: '28px',
  height: '28px',
  padding: '0',
  flex: 'none',
  justifyContent: 'center',
  background: 'var(--cream)',
  border: '1.5px solid var(--line2)',
  color: 'var(--navy)',
  fontWeight: 800,
} as const;

/** A key named in running text, drawn as a small keycap. */
const KEYCAP_INLINE = {
  display: 'inline-block',
  padding: '0 6px',
  borderRadius: '6px',
  border: '1.5px solid var(--line2)',
  borderBottomWidth: '2.5px',
  background: '#fff',
  color: 'var(--navy)',
  fontWeight: 800,
  lineHeight: '1.4',
} as const;

/** One line of the keys note: text and keycaps on a shared centre line. */
const NOTE_LINE = { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } as const;

/** The four grades with their keys (desktop): a compact 2 × 2 legend. */
function GradeLegend({ grades }: { grades: readonly (readonly [string, string])[] }) {
  return (
    <div class="card stack" style={{ '--gap': '10px', flex: '1 1 auto' }}>
      <div class="lbl">Como avaliar</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
        {grades.map(([l, t], i) => (
          <div key={l} class="row" style={{ '--gap': '10px', flexWrap: 'nowrap' }}>
            <span class="pill" style={KEYCAP}>
              {i + 1}
            </span>
            <span style={{ minWidth: '0', lineHeight: '1.25' }}>
              <b style={{ display: 'block', color: 'var(--navy)' }}>{l}</b>
              <span class="xs" style={{ color: 'var(--navy3)', fontWeight: 600 }}>{`volta em ${t}`}</span>
            </span>
          </div>
        ))}
      </div>
      {/* A plain note under a rule (grey, not blue, so it never reads as a link), as two set lines
          (one per key group) with the keycaps centred on the text, never a ragged wrap. Same text
          content: the space between the two lines stays in the DOM. */}
      <div
        class="xs stack"
        style={{
          '--gap': '6px',
          lineHeight: '1.4',
          color: 'var(--muted)',
          fontWeight: 600,
          marginTop: 'auto',
          paddingTop: '12px',
          borderTop: '1.5px solid var(--line)',
        }}
      >
        <span style={NOTE_LINE}>
          <span style={KEYCAP_INLINE}>Espaço</span>
          <span>{' vira o cartão; '}</span>
        </span>
        <span style={NOTE_LINE}>
          <span>{'as teclas '}</span>
          <span style={KEYCAP_INLINE}>1</span>
          <span>{' a '}</span>
          <span style={KEYCAP_INLINE}>4</span>
          <span>{' escolhem a nota.'}</span>
        </span>
      </div>
    </div>
  );
}

/** The card's call to action (a solid blue pill: the screen's primary action). */
const REVEAL = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  alignSelf: 'center',
  minHeight: '44px',
  padding: '0 20px',
  borderRadius: '999px',
  background: 'var(--blue)',
  color: '#fff',
  fontWeight: 800,
  fontSize: '.95rem',
  lineHeight: '1.2',
} as const;

/** Desktop: the same pill, a size larger (it sits in a bigger card). */
const REVEAL_DESK = { minHeight: '50px', padding: '0 28px', fontSize: '1.02rem' } as const;
/**
 * Phone: the whole card is the button, so its action reads as a light tint (pale blue, blue text) at a
 * compact size instead of a heavy solid bar across the card.
 */
const REVEAL_PHONE = {
  minHeight: '40px',
  padding: '0 16px',
  fontSize: '.9rem',
  background: 'var(--blueT)',
  color: 'var(--blueD)',
} as const;

/**
 * The deck at a glance (gamebar tiles, not links): due now, when the next reviewed card comes back
 * (or, with every card due, how many were reviewed today), the whole deck.
 */
function DeckStats({
  due,
  next,
  done,
  total,
  desk,
}: {
  due: number;
  next: string;
  done: number;
  total: number;
  desk: boolean;
}) {
  const tile = (ic: string, color: string, v: number | string, t: string) => (
    <div class="g">
      <span class="ic" style={{ color }}>
        <Icon name={ic} size={22} />
      </span>
      <span>
        <b style={{ justifyContent: 'center' }}>{v}</b>
        <small>{t}</small>
      </span>
    </div>
  );
  // Phone: the title ("6 cartões hoje") and the bar's caption sit right above, so the "para agora"
  // count would say it a third time; two wider tiles instead.
  return (
    <div class="gamebar" style={desk ? undefined : { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      {desk ? tile('cards', 'var(--orange)', due, 'para agora') : null}
      {next ? tile('clock', 'var(--green)', next, 'próxima volta') : tile('check', 'var(--green)', done, 'feitos hoje')}
      {tile('book', 'var(--blue)', total, 'no baralho')}
    </div>
  );
}

/**
 * Desktop: the cards already reviewed and when each comes back (English side only, so nothing is
 * given away). The deck at a glance under the review, instead of a blank lower half.
 */
function ComingBack({ deck, now, desk }: { deck: readonly DeckCard[]; now: number; desk: boolean }) {
  const later = deck.filter((x) => (x.at || 0) > now).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (!later.length) return null;
  // Always full rows: desktop up to six in one row, or eight in two rows of four; a phone shows two
  // rows of two.
  const shown = desk ? later.slice(0, later.length >= 8 ? 8 : 6) : later.slice(0, later.length >= 4 ? 4 : 2);
  const cols = desk ? (shown.length === 8 ? 4 : shown.length) : Math.min(2, shown.length);
  const more = later.length - shown.length;
  // Each card: the word, then when it returns as a small clock-and-time tag (blue: it is scheduled).
  return (
    <div class="card stack" style={desk ? { '--gap': '12px' } : { '--gap': '12px', padding: '18px 20px 20px' }}>
      <div class="row between">
        <div class="lbl">Voltam depois</div>
        <span class="xs">{`${later.length} ${later.length === 1 ? 'agendado' : 'agendados'}`}</span>
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: desk ? '8px' : '10px' }}
      >
        {shown.map((x) => (
          <div
            key={x.id}
            style={{
              padding: desk ? '12px 14px' : '9px 12px',
              borderRadius: '12px',
              background: 'var(--cream)',
              minWidth: '0',
            }}
          >
            <b
              style={{
                display: 'block',
                color: 'var(--navy)',
                overflowWrap: 'anywhere',
                lineHeight: '1.3',
                fontSize: desk ? '1.05rem' : '1rem',
              }}
            >
              {x.en}
            </b>
            {/* Desktop: where the card came from (one line), under the word. */}
            {desk ? (
              <span
                class="xs"
                style={{
                  display: 'block',
                  marginTop: '2px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={x.scene}
              >
                {x.scene}
              </span>
            ) : null}
            <span
              class="xs"
              style={
                desk
                  ? {
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '6px',
                      padding: '2px 8px 2px 6px',
                      borderRadius: '999px',
                      background: 'var(--blueT)',
                      color: 'var(--blueD)',
                      fontWeight: 700,
                    }
                  : // Phone: the same tag without its pill, so the list stays short.
                    {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '2px',
                      color: 'var(--blueD)',
                      fontWeight: 700,
                    }
              }
            >
              <Icon name="clock" size={13} />
              {`volta ${nextIn([x], now)}`}
            </span>
          </div>
        ))}
      </div>
      {more > 0 ? (
        <div class="xs" style={{ color: 'var(--muted)' }}>
          {`e mais ${more} ${more === 1 ? 'cartão agendado' : 'cartões agendados'}`}
        </div>
      ) : null}
    </div>
  );
}

export default function Revisao(_props: ScreenProps) {
  return <WithCatalog>{(c) => <Review c={c} />}</WithCatalog>;
}

function Review({ c }: { c: Catalog }) {
  // TIE.ui.flip: whether the current card shows its back.
  const [flip, setFlip] = useState(false);
  const flipRef = useRef(flip);
  flipRef.current = flip;
  const s = state.value;
  const now = Math.max(clock.value, Date.now());
  const q = queue(s.deck, now);
  const card = q[0];
  const n = q.length;
  const done = summary(s, c).daily.cards || 0;
  const desk = isDesktop(s);
  const title = n + (n === 1 ? ' cartão hoje' : ' cartões hoje');
  const pct = n ? Math.round((done / (done + n)) * 100) : s.deck.length ? 100 : 0;
  const taken = s.deck.filter((x) => !/^Ep\. /.test(x.scene)).length;
  const deckLine = s.deck.length ? ' Seu baralho tem ' : '';
  const grades: (readonly [string, string])[] = c.srs?.grades?.length
    ? c.srs.grades.map((g) => [g.label, g.hint] as const)
    : GRADES.map(([l, t]) => [l, t] as const);

  const grade = (i: number) => {
    if (!card) return;
    flipRef.current = false;
    setFlip(false);
    void gradeNow(card.id, i);
  };
  const gradeRef = useRef(grade);
  gradeRef.current = grade;

  // Desktop nicety on top of the prototype: Space flips, 1-4 grade the flipped card. Registered once
  // per card; the flip state is read from a ref, so a key pressed right after the flip still counts.
  const cardId = card?.id;
  useEffect(() => {
    if (!cardId) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.repeat) return;
      const el = ev.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      // On a focused button Space already clicks it (the card flips through its own handler).
      if (ev.key === ' ' && !el?.closest('button, [role="button"]')) {
        ev.preventDefault();
        flipRef.current = !flipRef.current;
        setFlip(flipRef.current);
      } else if (flipRef.current && /^[1-4]$/.test(ev.key)) {
        ev.preventDefault();
        gradeRef.current(Number(ev.key) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardId]);
  const toggle = () => {
    flipRef.current = !flipRef.current;
    setFlip(flipRef.current);
  };

  // The queue is worked out at render time; re-render when the next reviewed card falls due, so it
  // shows up (and the title's count follows) even while the learner sits on this screen.
  const [, setTick] = useState(0);
  const nextAt = s.deck.reduce((m, x) => ((x.at || 0) > now ? Math.min(m, x.at || 0) : m), Number.POSITIVE_INFINITY);
  useEffect(() => {
    if (!Number.isFinite(nextAt)) return;
    const wait = nextAt - Date.now();
    if (wait > 86_400_000) return; // a day or more away: the day's clock tick re-renders first
    const t = setTimeout(() => setTick((k) => k + 1), Math.max(0, wait) + 250);
    return () => clearTimeout(t);
  }, [nextAt]);

  // Desktop: the real "Ver a tradução" button sits exactly over its invisible twin inside the card
  // (a button cannot nest in the card's button). The twin follows the centred group, so its offset is
  // read after layout and again whenever the card or the word changes size.
  const wordRef = useRef<HTMLSpanElement>(null);
  const twinRef = useRef<HTMLSpanElement>(null);
  const [revealTop, setRevealTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const twin = twinRef.current;
    if (!desk || flip || !cardId || !twin) return;
    const measure = () => setRevealTop(twin.offsetTop);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    const box = twin.closest('.flash');
    if (box) ro.observe(box);
    if (wordRef.current) ro.observe(wordRef.current);
    return () => ro.disconnect();
  }, [desk, flip, cardId]);

  const cur = current(s, publishedEpisodes(c));
  const empty = s.deck.length ? (
    <div class="card gr stack tc pop" style={{ '--gap': '10px', alignItems: 'center' }}>
      <Icon name="check" size={40} extra={{ style: { color: 'var(--green)' } }} />
      <div class="h2">Revisão em dia.</div>
      <p class="p">{`Nenhum cartão para agora. O próximo volta ${nextIn(s.deck, now)}.`}</p>
      <Btn label="Ver um Extra" go="extra" icon="tv" />
    </div>
  ) : (
    <div class="card stack tc pop" style={{ '--gap': '10px', alignItems: 'center' }}>
      <Icon name="cards" size={40} extra={{ style: { color: 'var(--orange)' } }} />
      <div class="h2">Seus cartões começam no episódio.</div>
      <p class="p">
        {`Termine o Take a Look do episódio ${String(cur.num).padStart(2, '0')} e as palavras da cena viram os primeiros cartões.`}
      </p>
      <Btn label="Continuar o episódio" go={`episodio/${cur.num}`} icon="play" />
    </div>
  );

  // The flashcard: header (where the card came from + the speaker), the word centred as the card's
  // focal point (and, flipped, its translation), and the card's action at its foot. The speaker and,
  // on desktop, "Ver a tradução" are real buttons laid over the card (a button cannot nest in the
  // card's button); invisible twins inside the card keep their room.
  const pad = desk ? { y: 26, x: 28 } : { y: 20, x: 20 };
  const flashCard = card ? (
    <>
      {/* Desktop: the card fills its column down to the right column's end (both columns level). */}
      <div
        style={
          desk
            ? { position: 'relative', display: 'flex', flexDirection: 'column', flex: '1 1 auto' }
            : { position: 'relative' }
        }
      >
        <button
          type="button"
          class="flash"
          style={{
            minHeight: desk ? '340px' : '240px',
            flex: desk ? '1 1 auto' : undefined,
            padding: `${pad.y}px ${pad.x}px`,
            gap: '16px',
            textAlign: 'center',
          }}
          onClick={activator(undefined, toggle)}
        >
          {/* A long scene label wraps inside the row (never widens the page); the speaker's twin
              keeps its 44px. */}
          <span class="row between" style={{ textAlign: 'left', flexWrap: 'nowrap', alignItems: 'center' }}>
            <span class="sm" style={{ fontWeight: 700, minWidth: '0', flex: '1 1 auto', overflowWrap: 'anywhere' }}>
              {card.scene}
            </span>
            <span class="iconbtn" aria-hidden="true" style={{ border: '0', visibility: 'hidden' }} />
          </span>
          {/* The word, its hint (or translation) and the card's action as one group, centred in the
              room under the header: any extra height (desktop: the card is as tall as the right
              column) goes evenly above and below it, never between the hint and the action. */}
          <span
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: desk ? '24px' : '20px',
              flex: '1 1 auto',
              // Desktop: the group sits a little above the card's centre (optical centre), so the
              // header's room above the word does not read as an empty band.
              paddingBottom: desk ? '48px' : '4px',
            }}
          >
            <span ref={wordRef} style={{ display: 'block', overflowWrap: 'anywhere' }}>
              <span class="h1" style={{ display: 'block', fontSize: desk ? '4rem' : '2.5rem', lineHeight: '1.1' }}>
                {card.en}
              </span>
              {flip ? (
                <span
                  class="p-read pop"
                  style={{
                    display: 'block',
                    marginTop: '14px',
                    paddingTop: '14px',
                    borderTop: '1.5px solid var(--line)',
                    fontSize: desk ? '1.2rem' : undefined,
                  }}
                >
                  {card.pt}
                  {card.note ? (
                    <span class="sm" style={{ display: 'block', marginTop: '6px' }}>
                      {card.note}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span
                  class="sm"
                  style={{ display: 'block', marginTop: '10px', fontSize: desk ? '1.02rem' : undefined }}
                >
                  Lembra o que significa?
                </span>
              )}
            </span>
            {flip ? (
              <span class="sm" style={{ fontWeight: 800, color: 'var(--blue)', fontSize: desk ? '1rem' : undefined }}>
                Como foi? Escolha abaixo · +2 pontos
              </span>
            ) : (
              // Phone: the card's own action, drawn as a button. Desktop: the room for the real
              // "Ver a tradução" button laid over it.
              <span
                ref={twinRef}
                aria-hidden={desk ? 'true' : undefined}
                style={{ ...REVEAL, ...(desk ? REVEAL_DESK : REVEAL_PHONE), visibility: desk ? 'hidden' : undefined }}
              >
                <Icon name="eye" size={desk ? 18 : 16} />
                Toque para ver a tradução
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          class="iconbtn"
          aria-label="Ouvir"
          style={{
            position: 'absolute',
            top: `${pad.y + 1.5}px`,
            right: `${pad.x + 1.5}px`,
            border: '0',
            background: 'var(--cream)',
          }}
          onClick={activator(undefined, () => void say(card.en))}
        >
          <Icon name="speaker" size={18} />
        </button>
        {desk && !flip ? (
          <button
            type="button"
            style={{
              ...REVEAL,
              ...REVEAL_DESK,
              position: 'absolute',
              left: '50%',
              top: `${revealTop ?? 0}px`,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              visibility: revealTop === null ? 'hidden' : undefined,
            }}
            onClick={activator(undefined, toggle)}
          >
            <Icon name="eye" size={18} />
            Ver a tradução
          </button>
        ) : null}
      </div>
      {flip ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px' }}>
          {grades.map(([l, t], i) => (
            <button
              key={l}
              type="button"
              class="card stack tc"
              style={{
                '--gap': '2px',
                padding: '10px 4px',
                alignItems: 'center',
                border: '2px solid var(--navy)',
              }}
              onClick={activator(undefined, () => grade(i))}
            >
              <span class="h3" style={{ fontSize: '.95rem' }}>
                {l}
              </span>
              <span class="xs">{t}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  ) : (
    empty
  );

  // The bar with what it measures spelled out: today's reviews out of today's total and the share done
  // (the title already says how many are left).
  const progress = (
    <div class="stack" style={{ '--gap': '6px' }}>
      {s.deck.length ? (
        <div class="row between xs" style={{ fontWeight: 700 }}>
          <span>
            {n
              ? `${done} de ${done + n} revisados hoje`
              : done
                ? `${done} revisados hoje · tudo em dia`
                : 'Nada para revisar agora'}
          </span>
          <span>{`${pct}%`}</span>
        </div>
      ) : null}
      <div class="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );

  // The prototype's soft card was cream on cream (no edge, so its text looked indented); white here.
  const info = (
    <div class="card soft" style={{ background: '#fff', borderColor: 'var(--line)' }}>
      <div class="lbl">De onde vêm os cartões</div>
      {/* Same text content as the prototype's string (one run per stretch between the <b>s). */}
      <p class="p mt4" style={desk ? undefined : { fontSize: '.95rem', lineHeight: '1.5' }}>
        {INFO_A}
        <span style={{ whiteSpace: 'nowrap' }}>{INFO_KEY}</span>
        {`${INFO_B}${taken ? ', mais ' : `. Toque numa palavra da legenda dos Extras para trazer mais.${deckLine}`}`}
        {taken ? <b>{taken}</b> : null}
        {taken ? ` que você levou dos Extras e das conversas no Mic.${deckLine}` : null}
        {s.deck.length ? <b>{s.deck.length}</b> : null}
        {s.deck.length ? ' cartões.' : null}
      </p>
    </div>
  );

  // "em 2 dias" → "2 dias", "amanhã" stays (the tile's label says what it is).
  const later = s.deck.filter((x) => (x.at || 0) > now);
  const next = later.length ? nextIn(later, now).replace(/^em /, '') : '';
  const stats = s.deck.length ? <DeckStats due={n} next={next} done={done} total={s.deck.length} desk={desk} /> : null;

  return (
    <>
      {desk ? null : <Topbar kicker="Revisão" title={title} right={<UserAvatarBtn />} />}
      <div class="scroll">
        <div class="wrap stack" style={{ '--wrap': desk ? '1040px' : '560px', '--gap': '16px' }}>
          {desk ? (
            <>
              <div class="row between top">
                <div>
                  <div class="lbl">Revisão</div>
                  <h1 class="h1 mt4">{title}</h1>
                </div>
                <UserAvatarBtn />
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)',
                  gap: '20px',
                  alignItems: 'stretch',
                }}
              >
                <div class="stack" style={{ '--gap': '16px' }}>
                  {progress}
                  {flashCard}
                </div>
                <div class="stack" style={{ '--gap': '16px' }}>
                  {stats}
                  {info}
                  {card ? <GradeLegend grades={grades} /> : null}
                </div>
              </div>
              <ComingBack deck={s.deck} now={now} desk />
            </>
          ) : (
            <>
              {progress}
              {flashCard}
              {stats}
              {info}
              <ComingBack deck={s.deck} now={now} desk={false} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
