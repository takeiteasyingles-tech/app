// Revisão (prototipo/js/screens/conta.js, TIE.screens.revisao): one flashcard at a time from the due
// queue. Tap flips it (PT + note), the speaker reads the EN, and a grade reschedules the card through
// POST /api/srs/cards/:id/grade (applied at once, +2 pontos from the server's award). Empty states:
// "Revisão em dia" with when the next card comes back, or "Seus cartões começam no episódio".
import type { Catalog } from '@tie/shared/content/schema';
import { srsApi } from '@tie/shared/contracts/srs';
import { current } from '@tie/shared/domain/guide';
import { GRADES, gradeCard, nextIn, queue } from '@tie/shared/domain/srs';
import { activator, Btn, Icon, Topbar } from '@tie/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
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

/** The four grades as the desktop legend shows them, with their keys. */
function GradeLegend({ grades, keys }: { grades: readonly (readonly [string, string])[]; keys: boolean }) {
  return (
    <div class="card stack" style={{ '--gap': '8px' }}>
      <div class="lbl">Como avaliar</div>
      <div class="stack" style={{ '--gap': '6px' }}>
        {grades.map(([l, t], i) => (
          <div key={l} class="row" style={{ '--gap': '10px' }}>
            <span class="pill" style={KEYCAP}>
              {i + 1}
            </span>
            <span class="p grow" style={{ fontWeight: 700 }}>
              {l}
            </span>
            <span class="sm">{`volta em ${t}`}</span>
          </div>
        ))}
      </div>
      {keys ? <div class="sm">Espaço vira o cartão; as teclas 1 a 4 escolhem a nota.</div> : null}
    </div>
  );
}

const HINT_BTN = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  alignSelf: 'center',
  minHeight: '44px',
  padding: '0 18px',
  borderRadius: '999px',
  background: 'var(--blueT)',
} as const;

const KEYCAP = {
  minWidth: '28px',
  justifyContent: 'center',
  background: 'var(--cream)',
  border: '1.5px solid var(--line2)',
  color: 'var(--navy)',
  fontWeight: 800,
} as const;

/** The deck at a glance: due now, coming back within a day, the whole deck (gamebar tiles, not links). */
function DeckStats({ due, soon, total }: { due: number; soon: number; total: number }) {
  const tile = (ic: string, color: string, v: number, t: string) => (
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
  return (
    <div class="gamebar">
      {tile('cards', 'var(--orange)', due, 'para agora')}
      {tile('clock', 'var(--green)', soon, 'até amanhã')}
      {tile('book', 'var(--blue)', total, 'no baralho')}
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

  // The flashcard: the word (and, flipped, its translation) centred as the card's focal point, with
  // a tighter card on a phone and a roomier one on desktop. The speaker is a real button laid over
  // the card's corner (a button cannot nest in the card's button); an invisible twin keeps the
  // card's header row the same height.
  const pad = desk ? { y: 28, x: 28 } : { y: 22, x: 20 };
  const flashCard = card ? (
    <>
      {/* Desktop: the card fills its column down to the right column's end (both columns level),
          from a compact 320px; a phone keeps a compact card so the word sits close to its label. */}
      <div
        style={
          desk ? { position: 'relative', display: 'flex', flexDirection: 'column', flex: '1 1 auto' } : { position: 'relative' }
        }
      >
        <button
          type="button"
          class="flash"
          style={{
            minHeight: desk ? '320px' : '232px',
            flex: desk ? '1 1 auto' : undefined,
            padding: `${pad.y}px ${pad.x}px`,
            gap: '16px',
            textAlign: 'center',
          }}
          onClick={activator(undefined, toggle)}
        >
          <span class="row between" style={{ textAlign: 'left' }}>
            <span class="sm" style={{ fontWeight: 700 }}>
              {card.scene}
            </span>
            <span class="iconbtn" aria-hidden="true" style={{ border: '0', visibility: 'hidden' }} />
          </span>
          <span style={{ display: 'block', overflowWrap: 'anywhere' }}>
            <span class="h1" style={{ display: 'block', fontSize: desk ? '3.5rem' : '2.5rem', lineHeight: '1.1' }}>
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
            ) : null}
          </span>
          {/* Desktop shows a "Ver a tradução" button under the card instead of the tap hint; the hint
              keeps its place (hidden) so the word stays centred. */}
          {/* Unflipped on a phone the hint is drawn as a button (a blue pill with the eye icon): it is
              the card's own action, so it reads as tappable. */}
          <span
            class="sm"
            aria-hidden={desk && !flip ? 'true' : undefined}
            style={{
              fontWeight: 800,
              color: 'var(--blue)',
              fontSize: desk ? '1rem' : undefined,
              visibility: desk && !flip ? 'hidden' : undefined,
              ...(flip ? {} : HINT_BTN),
            }}
          >
            {flip ? null : <Icon name="eye" size={18} />}
            {flip ? 'Como foi? Escolha abaixo · +2 pontos' : 'Toque para ver a tradução'}
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
      ) : desk ? (
        // Desktop: an explicit way to turn the card for mouse users, where the grades will appear.
        <Btn label="Ver a tradução" kind="blue" cls="block" icon="eye" onClick={toggle} />
      ) : null}
    </>
  ) : (
    empty
  );

  // The bar with what it measures spelled out (the prototype's bare bar read as "40% of this card").
  const progress = (
    <div class="stack" style={{ '--gap': '6px' }}>
      {s.deck.length ? (
        <div class="row between xs" style={{ fontWeight: 700 }}>
          {/* Worded from the title's side ("6 cartões hoje" = the ones still to do). */}
          <span>
            {n
              ? `${done} feitos hoje · faltam ${n}`
              : done
                ? `${done} feitos hoje · tudo em dia`
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
      <p class="p mt4">
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

  const soon = s.deck.filter((x) => (x.at || 0) > now && (x.at || 0) <= now + 86_400_000).length;
  const stats = s.deck.length ? <DeckStats due={n} soon={soon} total={s.deck.length} /> : null;

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
                  {card ? <GradeLegend grades={grades} keys /> : null}
                </div>
              </div>
            </>
          ) : (
            <>
              {progress}
              {flashCard}
              {stats}
              {info}
              {card ? <GradeLegend grades={grades} keys={false} /> : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
