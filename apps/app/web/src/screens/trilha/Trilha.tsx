// Seasons contain episodes; each episode owns its ten steps, book, extra and assessment.
import type { Catalog, EpisodeIndexEntry } from '@tie/shared/content/schema';
import { type CurrentEpisode, current } from '@tie/shared/domain/guide';
import { testGate } from '@tie/shared/domain/testGate';
import type { TieState } from '@tie/shared/state';
import { Icon, Topbar } from '@tie/ui';
import { useState } from 'preact/hooks';
import { type ScreenProps, useChrome } from '../../frame';
import { layoutOf } from '../../shell';
import { catalog, state } from '../../store';
import { UserAvatarBtn } from '../../ui-blocks';

const pad2 = (n: number) => String(n).padStart(2, '0');
const LOCKED_STYLE = { opacity: '1', minHeight: '60px', padding: '5px 0 5px 44px' };
const SLATE = '#646D82';
const LOCKED_EP = { color: SLATE, fontSize: '1.15rem' };
const LOCKED_TITLE = { display: 'block', color: SLATE, fontWeight: '700', fontSize: '1rem' };
const LOCKED_BODY = { background: 'transparent', borderColor: '#DDD3B8', padding: '9px 14px' };
const LOCKED_DOT = { background: 'var(--cream)', borderColor: 'var(--line2)', color: SLATE };
/** The small hollow stop of a locked row (centred on the line, like the 26px dots). */
const LOCKED_STOP = { ...LOCKED_DOT, left: '10px', width: '14px', height: '14px', borderWidth: '3px' };

function EvenSegs({ cur, total }: { cur: number; total: number }) {
  const bars = [];
  for (let n = 1; n <= total; n++) bars.push(<i key={n} class={n < cur ? 'done' : n === cur ? 'now' : ''} />);
  return (
    <span class="segs" style={{ display: 'flex' }}>
      {bars}
    </span>
  );
}

function EpisodeNode({
  n,
  s,
  c,
  cur,
  desk,
}: {
  n: number;
  s: TieState;
  c: Catalog;
  cur: CurrentEpisode;
  desk: boolean;
}) {
  // Only what is done and the current episode open. Unscripted episodes before the current one are
  // "Em produção".
  const done = !!s.epsDone[n];
  const now = n === cur.num && !done;
  const open = c.episodes.some((ep) => ep.num === n && ep.status === 'published') && (done || now);
  const step = c.steps[cur.step - 1];
  // The current line, "Take the Mic · etapa 6 de 10", on one line. On a phone "Agora" moves up beside
  // the title so the line has the row's full width; on a very narrow screen it breaks before the "·".
  const subl = now
    ? cur.started
      ? [
          <span key="s" style={{ whiteSpace: 'nowrap' }}>
            {step?.name ?? ''}
          </span>,
          ' ',
          <span key="e" style={{ whiteSpace: 'nowrap' }}>
            {`· etapa ${cur.step} de ${c.steps.length || 10}`}
          </span>,
        ]
      : 'Comece por aqui'
    : done
      ? 'Concluído'
      : n < cur.num
        ? 'Em produção'
        : 'A seguir';
  // Locked: a small hollow stop on the line (the chapter label carries the e-book's one lock) and a
  // compact unfilled row; less faded than tie.css's .55.
  const body = (
    <>
      <span class="dot" style={open ? undefined : LOCKED_STOP}>
        {done ? <Icon name="check" size={12} /> : now ? <Icon name="play" size={10} /> : null}
      </span>
      <div class="body" style={open ? undefined : LOCKED_BODY}>
        <span class="ep" style={open ? undefined : LOCKED_EP}>
          {pad2(n)}
        </span>
        <span class="grow">
          {now && !desk ? (
            <span class="row between" style={{ '--gap': '8px' }}>
              <span class="h3" style={{ minWidth: '0' }}>
                {c.episodes.find((ep) => ep.num === n)?.title ?? ''}
              </span>
              <span class="pill or">Agora</span>
            </span>
          ) : (
            <span class="h3" style={open ? { display: 'block' } : LOCKED_TITLE}>
              {c.titles[n - 1] ?? ''}
            </span>
          )}
          <span class="sm" style={{ display: 'block' }}>
            {subl}
          </span>
          {now ? (
            <span class="mt8" style={{ display: 'block' }}>
              <EvenSegs cur={cur.step} total={c.steps.length || 10} />
            </span>
          ) : null}
        </span>
        {now && desk ? (
          <span class="pill or">Agora</span>
        ) : done ? (
          <span class="pill gold">+{c.game.points.episode ?? 40}</span>
        ) : null}
      </div>
    </>
  );
  const cls = `node ${done ? 'done' : now ? 'now' : 'locked'}`;
  return open ? (
    <a href={`#/episodio/${n}${done ? '/1' : ''}`} class={cls}>
      {body}
    </a>
  ) : (
    <div class={cls} style={LOCKED_STYLE}>
      {body}
    </div>
  );
}

function Materials({ ep, c, s, open }: { ep: EpisodeIndexEntry; c: Catalog; s: TieState; open: boolean }) {
  const book = c.ebooks.find((b) => b.num === ep.ebook);
  const extra = c.extras.find((x) => x.id === ep.extra);
  const gate = book
    ? testGate(
        book.episodes,
        s.epsDone,
        book.testRequiredEpisodes,
        book.testMinCompleted,
        book.testEnabled,
        c.episodes.filter((e) => e.status === 'published').map((e) => e.num),
      )
    : null;
  const testReady = !!book?.available && (book.testQuestionCount ?? 0) > 0 && !!gate?.unlocked;
  const action = (label: string, href: string | null, icon: string) =>
    href ? (
      <a class="pill bl" href={`#/${href}`}>
        <Icon name={icon} size={15} />
        {label}
        <Icon name="next" size={13} />
      </a>
    ) : (
      <span class="pill">
        <Icon name="lock" size={14} />
        {label}
      </span>
    );
  return (
    <div class="stack" style={{ '--gap': '8px', padding: '0 12px 16px 44px' }}>
      <span class="xs">Jornada de {c.steps.length || 10} etapas · materiais do episódio</span>
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        {action('E-book', open && book?.available ? `ebook/${book.num}` : null, 'book')}
        {action(
          extra ? `Extra · ${extra.title}` : 'Extra em preparação',
          open && extra ? `extra/${extra.id}` : null,
          'tv',
        )}
        {action(
          s.testDone[String(ep.ebook)] ? 'Teste concluído' : 'Teste',
          testReady ? `ebook/${book?.num}/teste` : null,
          'pen',
        )}
      </div>
      {book?.testEnabled === false ? (
        <span class="xs">Teste ainda não liberado pela equipe.</span>
      ) : !book?.testQuestionCount ? (
        <span class="xs">Teste em preparação.</span>
      ) : gate && !gate.unlocked ? (
        <span class="xs">
          Teste: {gate.completed} de {gate.minimum} episódios completos. Conclua mais {gate.remaining} para liberar.
        </span>
      ) : null}
    </div>
  );
}

export default function Trilha(_props: ScreenProps) {
  useChrome({ title: 'Trilha' });
  const [selected, select] = useState<number | null>(null);
  const s = state.value,
    c = catalog.value;
  if (!c) return null;
  const published = c.episodes.filter((e) => e.status === 'published').map((e) => e.num);
  const cur = current(s, published.length ? published : [1]);
  const seasonN = selected ?? c.episodes.find((e) => e.num === cur.num)?.season ?? c.seasons[0]?.n ?? 1;
  const season = c.seasons.find((x) => x.n === seasonN);
  const episodes = c.episodes.filter((e) => (e.season ?? 1) === seasonN).sort((a, b) => a.num - b.num);
  const completed = episodes.filter((e) => s.epsDone[String(e.num)]).length;
  const desk = layoutOf(s) === 'desktop';
  const title = season?.title ?? `Temporada ${seasonN}`;
  return (
    <>
      {desk ? null : <Topbar kicker={`Temporada ${seasonN}`} title={title} right={<UserAvatarBtn />} />}
      <div class="scroll">
        <div class="wrap stack" style={{ '--wrap': desk ? '1040px' : '760px', '--gap': '16px' }}>
          {desk ? (
            <div>
              <div class="lbl">Temporada {seasonN}</div>
              <h1 class="h1">{title}</h1>
            </div>
          ) : null}
          <div class="card stack" style={{ '--gap': '10px' }}>
            <nav class="row wrapx" aria-label="Temporadas" style={{ '--gap': '8px' }}>
              {c.seasons.map((x) => (
                <button
                  key={x.n}
                  type="button"
                  class={`pill${seasonN === x.n ? ' navy' : ''}`}
                  aria-pressed={seasonN === x.n}
                  onClick={() => select(x.n)}
                >
                  {x.n} · {x.title}
                </button>
              ))}
            </nav>
            <div class="row between">
              <span class="lbl">Progresso da temporada</span>
              <span class="sm">
                {completed} de {episodes.length} episódios concluídos
              </span>
            </div>
            <div
              class="bar"
              role="progressbar"
              aria-label="Progresso da temporada"
              aria-valuemin={0}
              aria-valuemax={episodes.length}
              aria-valuenow={completed}
            >
              <i style={{ width: `${episodes.length ? (100 * completed) / episodes.length : 0}%` }} />
            </div>
            {season?.synopsis ? <p class="p">{season.synopsis}</p> : null}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: desk ? 'repeat(2,minmax(0,1fr))' : 'minmax(0,1fr)',
              gap: '16px',
              alignItems: 'start',
            }}
          >
            {episodes.map((ep, i) => (
              <section
                key={ep.num}
                class="card"
                style={{ padding: '14px', minWidth: 0 }}
                aria-label={`Episódio ${ep.num}`}
              >
                <div class="trail">
                  <EpisodeNode n={ep.num} s={s} c={c} cur={cur} desk={desk} />
                </div>
                <Materials
                  ep={ep}
                  c={c}
                  s={s}
                  open={ep.status === 'published' && (!!s.epsDone[String(ep.num)] || ep.num === cur.num)}
                />
                {i === episodes.length - 1 ? (
                  <a
                    class="sm"
                    style={{ display: 'block', padding: '0 12px 8px 44px' }}
                    href={`#/temporada/${seasonN}/teste`}
                  >
                    Avaliação da temporada e certificado
                  </a>
                ) : null}
              </section>
            ))}
          </div>
          {!episodes.length ? <div class="card">Os episódios desta temporada estão em preparação.</div> : null}
        </div>
      </div>
    </>
  );
}
