// Feedbacks (spec 07, feature C; feedback.read): the learners' 1-5 star ratings of each episode.
// Overall numbers and an NPS-style score, one summary card per episode (distribution of the notes),
// then the ratings themselves, newest first, with filters kept in the URL (#/feedbacks?ep=1&nota=5).
// Learners appear by display name only; the name links to the user page for roles with users.read.
import { type AdminFeedbackRow, adminFeedbackApi, type FeedbackSummary } from '@tie/shared/contracts/feedback';
import { call } from '../api';
import { fmtAgo, fmtDateTime, fmtDay, fmtInt, fromDateInputEnd, fromDateInputStart, plural } from '../format';
import { setQuery } from '../router';
import { can } from '../session';
import { useLoad, usePaged } from '../ui/async';
import { Icon } from '../ui/icons';
import { Button, Empty, ErrorBox, Kpi, MoreButton, Page, SearchBox, Sel, Skeleton, TextIn } from '../ui/kit';
import { fmtAvg, NpsPill, npsTone, StarDist, Stars } from './learning';
import type { ScreenProps } from './registry';

const pad2 = (n: number) => String(n).padStart(2, '0');

const STAR_OPTIONS: readonly (readonly [string, string])[] = [
  ['', 'Todas as notas'],
  ['5', '5 estrelas'],
  ['4', '4 estrelas'],
  ['3', '3 estrelas'],
  ['2', '2 estrelas'],
  ['1', '1 estrela'],
];

const COMMENT_OPTIONS: readonly (readonly [string, string])[] = [
  ['', 'Com e sem comentário'],
  ['1', 'Só com comentário'],
  ['0', 'Sem comentário'],
];

function Overview({ s, ranged }: { s: FeedbackSummary; ranged: boolean }) {
  const o = s.overall;
  return (
    <section class="stack" style={{ '--gap': '10px' }} aria-labelledby="fb-geral">
      <h2 class="lbl" id="fb-geral">
        {ranged ? 'Resumo do período' : 'Resumo geral'}
      </h2>
      <div class="ad-kpis lead">
        <Kpi
          label="Avaliações"
          value={fmtInt(o.count)}
          sub={`${plural(s.episodes.length, 'episódio avaliado', 'episódios avaliados')}`}
          icon="star"
          tone="navy"
        />
        <Kpi
          label="Nota média"
          value={
            <span class="ad-fb-avg">
              {fmtAvg(o.avg)}
              {o.avg != null ? <Stars value={o.avg} size={18} /> : null}
            </span>
          }
          sub="de 1 a 5 estrelas"
          icon="trophy"
        />
        <Kpi
          label="NPS"
          value={o.nps == null ? '—' : `${o.nps > 0 ? '+' : ''}${o.nps}`}
          sub="% de 5★ menos % de 1-2★"
          icon="chart"
          tone={npsTone(o.nps)}
        />
        <Kpi
          label="Com comentário"
          value={fmtInt(o.comments)}
          sub={o.count ? `${Math.round((100 * o.comments) / o.count)}% das avaliações` : 'nenhuma avaliação'}
          icon="chat"
        />
      </div>
    </section>
  );
}

function EpisodeCards({ s, selected }: { s: FeedbackSummary; selected: number | null }) {
  if (!s.episodes.length) return null;
  return (
    <section class="stack" style={{ '--gap': '10px' }} aria-labelledby="fb-eps">
      <h2 class="lbl" id="fb-eps">
        Por episódio
      </h2>
      <div class="ad-fb-eps">
        {s.episodes.map((e) => {
          const on = selected === e.episodeNum;
          return (
            <article key={e.episodeNum} class={`card ad-card ad-fb-ep${on ? ' on' : ''}`}>
              <div class="ad-fb-ep-h">
                <span class="ad-fb-ep-n">{pad2(e.episodeNum)}</span>
                <h3 class="h3 grow ad-fb-ep-t">{e.title ?? `Episódio ${pad2(e.episodeNum)}`}</h3>
                <NpsPill nps={e.nps} />
              </div>
              <div class="ad-fb-ep-avg">
                <span class="num">{fmtAvg(e.avg)}</span>
                <span class="stack" style={{ '--gap': '2px' }}>
                  <Stars value={e.avg ?? 0} size={16} />
                  <span class="xs">{`${plural(e.count, 'avaliação', 'avaliações')} · ${plural(e.comments, 'comentário', 'comentários')}`}</span>
                </span>
              </div>
              <StarDist dist={e.dist} />
              <Button
                label={on ? 'Mostrando abaixo' : 'Ver avaliações'}
                icon={on ? 'check' : 'eye'}
                kind="light"
                disabled={on}
                onClick={() => setQuery({ ep: e.episodeNum })}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RatingItem({ r }: { r: AdminFeedbackRow }) {
  const name = r.userName || 'Aluno sem nome';
  const edited = r.updatedAt - r.createdAt > 60_000;
  return (
    <li class="ad-fb-item">
      <div class="ad-fb-item-h">
        <Stars value={r.stars} size={17} label={`${r.stars} de 5 estrelas`} />
        <span class="ad-fb-item-ep">
          <b>{`Ep. ${pad2(r.episodeNum)}`}</b>
          {r.episodeTitle ? ` · ${r.episodeTitle}` : ''}
        </span>
      </div>
      {r.comment ? <p class="ad-fb-item-c">{r.comment}</p> : <p class="xs ad-fb-item-none">Sem comentário.</p>}
      <div class="xs ad-fb-item-f">
        {can('users.read') ? (
          <a class="ad-linkbtn" href={`#/alunos/${r.userId}`}>
            {name}
          </a>
        ) : (
          <span>{name}</span>
        )}
        <span aria-hidden="true">·</span>
        <span title={fmtDateTime(r.updatedAt)}>{fmtAgo(r.updatedAt)}</span>
        {edited ? <span class="ad-fb-edited">editada</span> : null}
      </div>
    </li>
  );
}

export function Feedbacks({ q }: ScreenProps) {
  const ep = /^\d{1,6}$/.test(q.ep ?? '') ? Number(q.ep) : null;
  const stars = /^[1-5]$/.test(q.nota ?? '') ? Number(q.nota) : null;
  const com = q.com === '1' || q.com === '0' ? q.com : '';
  const text = q.q ?? '';
  const from = q.de ?? '';
  const to = q.ate ?? '';
  const fromMs = from ? (fromDateInputStart(from) ?? undefined) : undefined;
  const toMs = to ? (fromDateInputEnd(to) ?? undefined) : undefined;

  const summary = useLoad(
    (signal) => call(adminFeedbackApi.summary, { query: { from: fromMs, to: toMs }, signal }),
    [fromMs, toMs],
  );
  const page = usePaged(
    (cursor, signal) =>
      call(adminFeedbackApi.list, {
        query: {
          episode: ep ?? undefined,
          stars: stars ?? undefined,
          hasComment: com === '' ? undefined : com,
          q: text || undefined,
          from: fromMs,
          to: toMs,
          cursor,
          limit: 30,
        },
        signal,
      }),
    [ep, stars, com, text, fromMs, toMs],
  );

  const eps = summary.data?.episodes ?? [];
  const epOptions: (readonly [string, string])[] = [
    ['', 'Todos os episódios'],
    ...eps.map((e) => [String(e.episodeNum), `Ep. ${pad2(e.episodeNum)} · ${e.title ?? ''}`] as const),
  ];
  if (ep != null && !eps.some((e) => e.episodeNum === ep)) epOptions.push([String(ep), `Ep. ${pad2(ep)}`]);
  const filtered = !!(ep != null || stars != null || com || text || from || to);
  const listFiltered = !!(ep != null || stars != null || com || text);

  return (
    <Page
      title="Feedbacks"
      kicker="Pessoas"
      actions={
        <Button
          label="Atualizar"
          ariaLabel="Atualizar as avaliações"
          icon="refresh"
          kind="light"
          busy={(summary.loading && !!summary.data) || (page.loading && page.items.length > 0)}
          onClick={() => {
            summary.reload();
            page.reload();
          }}
        />
      }
      bar={
        <div class="ad-filters">
          <SearchBox
            value={text}
            onValue={(v) => setQuery({ q: v })}
            placeholder="Buscar nos comentários"
            id="fb-busca"
          />
          <Sel
            ariaLabel="Episódio"
            value={ep != null ? String(ep) : ''}
            onValue={(v) => setQuery({ ep: v })}
            options={epOptions}
          />
          <Sel
            ariaLabel="Nota"
            value={stars != null ? String(stars) : ''}
            onValue={(v) => setQuery({ nota: v })}
            options={STAR_OPTIONS}
          />
          <Sel ariaLabel="Comentário" value={com} onValue={(v) => setQuery({ com: v })} options={COMMENT_OPTIONS} />
          {filtered ? (
            <Button
              label="Limpar"
              kind="link"
              onClick={() => setQuery({ ep: '', nota: '', com: '', q: '', de: '', ate: '' })}
            />
          ) : null}
        </div>
      }
    >
      {/* The period filters the summary and the list; folded away so the bar stays short on a phone. */}
      <details class="card ad-card ad-more" open={!!(from || to)}>
        <summary>
          <span class="ad-more-ic" aria-hidden="true">
            <Icon name="clock" size={18} />
          </span>
          <span class="grow">
            <span class="h3">Período</span>
            <span class="xs">
              {from || to
                ? `${from ? `De ${fmtDay(from)}` : 'Desde o início'}${to ? ` até ${fmtDay(to)}` : ' até hoje'}`
                : 'Todas as avaliações, desde o início'}
            </span>
          </span>
          <span class="ad-more-chev" aria-hidden="true">
            <Icon name="down" size={18} />
          </span>
        </summary>
        <div class="ad-filters ad-fb-period">
          <label class="ad-dl" for="fb-de">
            <span>De</span>
            <TextIn id="fb-de" type="date" value={from} max={to || undefined} onValue={(v) => setQuery({ de: v })} />
          </label>
          <label class="ad-dl" for="fb-ate">
            <span>Até</span>
            <TextIn id="fb-ate" type="date" value={to} min={from || undefined} onValue={(v) => setQuery({ ate: v })} />
          </label>
          {from || to ? (
            <Button label="Todo o período" kind="link" onClick={() => setQuery({ de: '', ate: '' })} />
          ) : null}
        </div>
      </details>
      {summary.error && !summary.data ? (
        <ErrorBox error={summary.error} retry={summary.reload} />
      ) : summary.data ? (
        summary.data.overall.count ? (
          <>
            <Overview s={summary.data} ranged={!!(from || to)} />
            <EpisodeCards s={summary.data} selected={ep} />
          </>
        ) : null
      ) : (
        <Skeleton rows={2} height={110} />
      )}
      <section class="stack" style={{ '--gap': '10px' }} aria-labelledby="fb-lista">
        <div class="row between wrapx" style={{ '--gap': '8px' }}>
          <h2 class="lbl" id="fb-lista">
            {ep != null ? `Avaliações do episódio ${pad2(ep)}` : 'Avaliações'}
          </h2>
          {ep != null ? <Button label="Todos os episódios" kind="link" onClick={() => setQuery({ ep: '' })} /> : null}
        </div>
        {page.error && !page.items.length ? (
          <ErrorBox error={page.error} retry={page.reload} />
        ) : page.loading ? (
          <Skeleton rows={5} height={84} />
        ) : !page.items.length ? (
          <Empty
            icon="star"
            title={filtered ? 'Nenhuma avaliação com esses filtros.' : 'Nenhuma avaliação ainda.'}
            body={
              filtered
                ? 'Tente outra nota, outro período ou limpe os filtros.'
                : 'Quando um aluno concluir um episódio, ele pode dar de 1 a 5 estrelas e deixar um comentário. As avaliações aparecem aqui.'
            }
          />
        ) : (
          <>
            <ul class="ad-fb-list" aria-label={listFiltered ? 'Avaliações filtradas' : 'Avaliações'}>
              {page.items.map((r) => (
                <RatingItem key={r.id} r={r} />
              ))}
            </ul>
            {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
          </>
        )}
      </section>
      <p class="xs ad-fb-note">
        <Icon name="alert" size={14} /> O NPS conta 5 estrelas como promotores, 3 e 4 como neutros e 1 e 2 como
        detratores: % de promotores menos % de detratores, de −100 a +100.
      </p>
    </Page>
  );
}
