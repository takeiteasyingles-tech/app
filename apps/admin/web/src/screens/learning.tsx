// Learning statistics (spec 07, feature C), shared by three screens: the star and NPS widgets of
// Feedbacks, the course funnel on the Painel (LearningSection) and the per-learner numbers on a user's
// page (UserLearning). Charts are plain HTML/CSS bars, each with its value as text for screen readers.
import { adminStatsApi, type LearningStats, type UserLearningStats } from '@tie/shared/contracts/stats';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { call } from '../api';
import { fmtDate, fmtDay, fmtInt, fmtMinutes, plural } from '../format';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Async, Card, Empty, Meter, Pill, Seg } from '../ui/kit';
import './learning.css';

// ---------- Small pieces ----------

const STAR_PATH = 'm12 3.5 2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9L3.4 9.8l6-.8z';

/** 1.6 → "1,6". */
export const fmtAvg = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Five stars, filled up to `value` (fractions fill part of a star). */
export function Stars({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
  return (
    <span class="ad-stars" role="img" aria-label={label ?? `${fmtAvg(value)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, value - (n - 1)));
        return (
          <span key={n} class="ad-star" style={{ width: `${size}px`, height: `${size}px` }}>
            <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
              <path d={STAR_PATH} />
            </svg>
            {fill > 0 ? (
              <span class="ad-star-on" style={{ width: `${fill * 100}%` }}>
                <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
                  <path d={STAR_PATH} />
                </svg>
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** NPS-style score: green from 50, navy from 0, orange below. */
export function npsTone(nps: number | null): string {
  if (nps == null) return '';
  return nps >= 50 ? 'gr' : nps >= 0 ? 'bl' : 'or';
}

export function NpsPill({ nps }: { nps: number | null }) {
  if (nps == null) return <Pill label="NPS —" />;
  return <Pill label={`NPS ${nps > 0 ? '+' : ''}${nps}`} tone={npsTone(nps)} />;
}

/** Distribution of 1-5 star ratings, 5★ on top, each bar relative to the whole. */
export function StarDist({ dist }: { dist: readonly number[] }) {
  const total = dist.reduce((a, b) => a + b, 0);
  return (
    <ul class="ad-dist" aria-label="Distribuição das notas">
      {[5, 4, 3, 2, 1].map((s) => {
        const n = dist[s - 1] ?? 0;
        const share = total ? n / total : 0;
        return (
          <li key={s}>
            <span class="ad-dist-k" aria-hidden="true">
              {s}
              <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden="true" focusable="false">
                <path d={STAR_PATH} />
              </svg>
            </span>
            <span class={`ad-dist-bar s${s}`} aria-hidden="true">
              <i class="ad-db" style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
            <span class="ad-dist-n">
              <span class="sr">{`${s} ${s === 1 ? 'estrela' : 'estrelas'}: `}</span>
              {fmtInt(n)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical bars over days (oldest first), with each day's value as text for screen readers. */
export function DayBars({
  days,
  label,
  unit,
  tone = '',
}: {
  days: readonly { date: string; value: number }[];
  label: string;
  unit: (n: number) => string;
  tone?: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.value));
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <figure class="ad-vbars-f">
      <ol class={`ad-vbars ${tone}`} aria-label={label} style={{ '--n': String(days.length) }}>
        {days.map((d) => (
          <li key={d.date} title={`${fmtDay(d.date)}: ${unit(d.value)}`}>
            <i
              class={`ad-vb${d.value ? '' : ' zero'}`}
              style={{ height: `${d.value ? Math.max(4, (d.value / max) * 100) : 0}%` }}
            />
            <span class="sr">{`${fmtDay(d.date)}: ${unit(d.value)}`}</span>
          </li>
        ))}
      </ol>
      <figcaption class="ad-vbars-x" aria-hidden="true">
        <span>{first ? fmtDay(first.date).slice(0, 5) : ''}</span>
        <span>{`máx. ${unit(max)}`}</span>
        <span>{last ? fmtDay(last.date).slice(0, 5) : ''}</span>
      </figcaption>
    </figure>
  );
}

function Stat({ value, label, sub }: { value: ComponentChildren; label: string; sub?: ComponentChildren }) {
  return (
    <div class="ad-lstat">
      <div class="num ad-stat-v">{value}</div>
      <div class="xs">{label}</div>
      {sub ? <div class="xs ad-lstat-sub">{sub}</div> : null}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// ---------- Painel: course funnel ----------

const PERIODS = [
  ['7', '7 dias'],
  ['30', '30 dias'],
  ['90', '90 dias'],
] as const;

function Funnel({ eps }: { eps: LearningStats['episodes'] }) {
  if (!eps.length) {
    return <Empty icon="trail" title="Nenhum episódio publicado." body="O funil aparece quando houver episódios." />;
  }
  const max = Math.max(1, ...eps.map((e) => e.started));
  return (
    <ol class="ad-funnel" aria-label="Funil por episódio">
      {eps.map((e) => (
        <li key={e.num}>
          <div class="ad-funnel-h">
            <span class="ad-funnel-n">{pad2(e.num)}</span>
            <span class="ad-funnel-t" title={e.title}>
              {e.title}
            </span>
            {e.ratings ? (
              <span class="ad-funnel-r">
                <Stars value={e.avgStars ?? 0} size={13} />
                <span class="xs">{fmtAvg(e.avgStars)}</span>
              </span>
            ) : null}
          </div>
          <div class="ad-funnel-bar" aria-hidden="true">
            <i class="ad-fn st" style={{ width: `${(e.started / max) * 100}%` }} />
            <i class="ad-fn dn" style={{ width: `${(e.completed / max) * 100}%` }} />
          </div>
          <div class="xs ad-funnel-x">
            {`${plural(e.started, 'começou', 'começaram')} · ${plural(e.completed, 'concluiu', 'concluíram')}`}
            <b>{`${e.completionPct}%`}</b>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TestRates({ s }: { s: LearningStats }) {
  const rows = [
    ...s.ebookTests.map((t) => ({
      key: `e${t.ebookNum}`,
      name: `Teste do e-book ${pad2(t.ebookNum)}`,
      takers: t.takers,
      passed: t.passed,
      pct: t.passPct,
      extra: null as string | null,
      off: false,
    })),
    // A season test nobody can take yet (unpublished, no results) would only add noise.
    ...s.seasonTests
      .filter((t) => t.published || t.takers > 0)
      .map((t) => ({
        key: `s${t.seasonN}`,
        name: `Prova da temporada ${t.seasonN}`,
        takers: t.takers,
        passed: t.passed,
        pct: t.passPct,
        extra: `${plural(t.certificates, 'certificado', 'certificados')}${
          t.avgAttempts != null ? ` · ${fmtAvg(t.avgAttempts)} tentativas em média` : ''
        }`,
        off: !t.published,
      })),
  ];
  if (!rows.length) return <p class="sm">Nenhum teste aberto aos alunos ainda.</p>;
  return (
    <ul class="ad-rates">
      {rows.map((r) => (
        <li key={r.key}>
          <div class="row between wrapx" style={{ '--gap': '4px 10px' }}>
            <span class="h3 ad-rates-t">
              {r.name}
              {r.off ? <Pill label="Não publicada" /> : null}
            </span>
            <span class="ad-rates-p">{r.takers ? `${r.pct}%` : '—'}</span>
          </div>
          <Meter value={r.passed} max={Math.max(1, r.takers)} tone={r.takers && r.pct < 50 ? 'or' : 'gr'} />
          <div class="xs">
            {r.takers ? `${plural(r.passed, 'aprovado', 'aprovados')} de ${fmtInt(r.takers)}` : 'Ninguém fez ainda'}
            {r.extra ? ` · ${r.extra}` : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Painel section "Aprendizado" (users.read): funnel, test pass rates and active learners per day. */
export function LearningSection() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const load = useLoad((signal) => call(adminStatsApi.learning, { query: { days: Number(days) }, signal }), [days]);
  return (
    <section class="stack" style={{ '--gap': '10px' }} aria-labelledby="k-aprendizado">
      <div class="row between wrapx" style={{ '--gap': '8px' }}>
        <h2 class="lbl" id="k-aprendizado">
          Estatísticas de aprendizado
        </h2>
        <Seg value={days} options={PERIODS} onChange={setDays} label="Período dos alunos ativos" />
      </div>
      <Async load={load} rows={3}>
        {(s) => {
          const active = s.activeByDay.map((d) => ({ date: d.date, value: d.learners }));
          const sum = active.reduce((a, d) => a + d.value, 0);
          const peak = active.reduce((a, d) => (d.value > a.value ? d : a), active[0] ?? { date: '', value: 0 });
          const started = s.episodes.reduce((a, e) => a + e.started, 0);
          const completed = s.episodes.reduce((a, e) => a + e.completed, 0);
          return (
            <div class="ad-cols main">
              <Card
                title="Funil dos episódios"
                sub="Alunos que começaram e concluíram cada episódio publicado"
                actions={<Icon name="trail" size={20} />}
              >
                <div class="ad-legend">
                  <span>
                    <i class="ad-lg-st" /> começaram
                  </span>
                  <span>
                    <i class="ad-lg-dn" /> concluíram
                  </span>
                  <span>
                    <Icon name="star" size={12} /> média das avaliações
                  </span>
                </div>
                <Funnel eps={s.episodes} />
                <p class="xs">
                  {`No total, ${plural(started, 'início', 'inícios')} e ${plural(completed, 'conclusão', 'conclusões')} de episódio. Contas da equipe não entram.`}
                </p>
              </Card>
              <div class="stack" style={{ '--gap': '18px' }}>
                <Card title="Alunos ativos por dia" sub={`Últimos ${s.days} dias, horário de Brasília`}>
                  <div class="ad-stats">
                    <Stat value={fmtInt(active[active.length - 1]?.value ?? 0)} label="hoje" />
                    <Stat value={fmtAvg(active.length ? sum / active.length : 0)} label="média por dia" />
                    <Stat value={fmtInt(peak.value)} label="pico" sub={peak.value ? fmtDay(peak.date) : undefined} />
                  </div>
                  <DayBars
                    days={active}
                    label={`Alunos ativos por dia, últimos ${s.days} dias`}
                    unit={(n) => plural(n, 'aluno', 'alunos')}
                  />
                </Card>
                <Card title="Aprovação nos testes" sub="Alunos aprovados entre os que fizeram">
                  <TestRates s={s} />
                </Card>
              </div>
            </div>
          );
        }}
      </Async>
    </section>
  );
}

// ---------- User page: one learner ----------

function EpisodeRows({ eps, ratings }: { eps: UserLearningStats['episodes']; ratings: Map<number, number> }) {
  if (!eps.length) return <p class="sm">Ainda não abriu nenhum episódio.</p>;
  return (
    <ul class="ad-uep">
      {eps.map((e) => {
        const r = ratings.get(e.num);
        return (
          <li key={e.num}>
            <span class={`ad-uep-n${e.done ? ' done' : ''}`} aria-hidden="true">
              {e.done ? <Icon name="check" size={16} /> : pad2(e.num)}
            </span>
            <div class="grow" style={{ minWidth: '0' }}>
              <div class="row between wrapx" style={{ '--gap': '2px 10px' }}>
                <span class="ad-uep-t">
                  <span class="sr">{`Episódio ${e.num}: `}</span>
                  {e.title ?? `Episódio ${pad2(e.num)}`}
                </span>
                <span class="xs">
                  {e.done ? `Concluído em ${fmtDate(e.doneAt)}` : `Na etapa ${e.furthestStep} de 10`}
                </span>
              </div>
              <div class="ad-uep-b">
                <span class="segs" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, i) => (
                    <i
                      key={i}
                      class={e.done || i < e.furthestStep - 1 ? 'done' : i === e.furthestStep - 1 ? 'now' : ''}
                    />
                  ))}
                </span>
                {r ? <Stars value={r} size={13} label={`Avaliou com ${r} de 5 estrelas`} /> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "Estatísticas" on a user's page (users.read). */
export function UserLearning({ userId }: { userId: string }) {
  const load = useLoad((signal) => call(adminStatsApi.user, { params: { id: userId }, signal }), [userId]);
  return (
    <Card title="Estatísticas" sub="Progresso no curso, testes, tempo de estudo e avaliações" cls="ad-ulearn">
      <Async load={load} rows={3}>
        {(s) => {
          const ratings = new Map(s.feedback.map((f) => [f.episodeNum, f.stars]));
          const done = s.episodes.filter((e) => e.done).length;
          const points30 = s.last30.reduce((a, d) => a + Math.max(0, d.points), 0);
          return (
            <>
              <div class="ad-kpis ad-ukpis">
                <div class="ad-kpi">
                  <span class="lbl">Episódios</span>
                  <span class="num ad-kpi-v">{fmtInt(done)}</span>
                  <span class="xs">{`concluídos de ${fmtInt(s.episodes.length)} abertos`}</span>
                </div>
                <div class="ad-kpi">
                  <span class="lbl">Dias ativos</span>
                  <span class="num ad-kpi-v">{fmtInt(s.study.activeDays30d)}</span>
                  <span class="xs">{`nos últimos 30 · meta em ${plural(s.study.goalDays, 'dia', 'dias')}`}</span>
                </div>
                <div class="ad-kpi">
                  <span class="lbl">Tempo no Mic</span>
                  <span class="num ad-kpi-v">{fmtMinutes(s.study.maggieSec30d)}</span>
                  <span class="xs">{`em 30 dias · ${fmtMinutes(s.study.maggieSecTotal)} no total`}</span>
                </div>
                <div class="ad-kpi">
                  <span class="lbl">Flashcards</span>
                  <span class="num ad-kpi-v">{fmtInt(s.study.srsCards)}</span>
                  <span class="xs">cartões no baralho</span>
                </div>
              </div>
              <div class="ad-cols">
                <div class="stack" style={{ '--gap': '10px' }}>
                  <div class="row between wrapx">
                    <h3 class="lbl">Pontos por dia</h3>
                    <span class="xs">{`${fmtInt(points30)} em 30 dias`}</span>
                  </div>
                  <DayBars
                    days={s.last30.map((d) => ({ date: d.date, value: Math.max(0, d.points) }))}
                    label="Pontos por dia, últimos 30 dias"
                    unit={(n) => plural(n, 'ponto', 'pontos')}
                    tone="or"
                  />
                </div>
                <div class="stack" style={{ '--gap': '10px' }}>
                  <h3 class="lbl">Testes e certificados</h3>
                  {s.ebookTests.length || s.seasonTests.length || s.certificates.length ? (
                    <ul class="ad-utests">
                      {s.ebookTests.map((t) => (
                        <li key={`e${t.ebookNum}`}>
                          <span class="grow">{`Teste do e-book ${pad2(t.ebookNum)}`}</span>
                          {t.submittedAt === 0 ? (
                            <Pill label="Refazendo" tone="bl" />
                          ) : (
                            <Pill
                              label={`${t.score}${t.passScore != null ? `/${t.passScore}` : ''} · ${t.passed ? 'aprovado' : 'não passou'}`}
                              tone={t.passed ? 'gr' : 'or'}
                            />
                          )}
                        </li>
                      ))}
                      {s.seasonTests.map((t) => (
                        <li key={`s${t.seasonN}`}>
                          <span class="grow">
                            {`Prova da temporada ${t.seasonN}`}
                            <span class="xs">{` · ${plural(t.attempts, 'tentativa', 'tentativas')}, melhor ${t.bestPct}%`}</span>
                          </span>
                          <Pill
                            label={`${t.scorePct}% · ${t.passed ? 'aprovado' : 'não passou'}`}
                            tone={t.passed ? 'gr' : 'or'}
                          />
                        </li>
                      ))}
                      {s.certificates.map((c) => (
                        <li key={c.id}>
                          <span class="grow">
                            <Icon name="trophy" size={15} />
                            {` Certificado da temporada ${c.seasonN}`}
                            <span class="xs">{` · ${c.code} · ${fmtDate(c.issuedAt)}`}</span>
                          </span>
                          {c.revokedAt ? <Pill label="Revogado" tone="or" /> : <Pill label="Válido" tone="gr" />}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p class="sm">Nenhum teste feito ainda.</p>
                  )}
                </div>
              </div>
              <div class="stack" style={{ '--gap': '10px' }}>
                <h3 class="lbl">Episódios</h3>
                <EpisodeRows eps={s.episodes} ratings={ratings} />
              </div>
              {s.feedback.some((f) => f.comment) ? (
                <div class="stack" style={{ '--gap': '10px' }}>
                  <h3 class="lbl">Comentários nas avaliações</h3>
                  <ul class="ad-fbq">
                    {s.feedback
                      .filter((f) => f.comment)
                      .map((f) => (
                        <li key={f.episodeNum}>
                          <div class="row wrapx" style={{ '--gap': '6px 10px' }}>
                            <b>{`Episódio ${pad2(f.episodeNum)}`}</b>
                            <Stars value={f.stars} size={13} label={`${f.stars} de 5 estrelas`} />
                            <span class="xs">{fmtDate(f.updatedAt)}</span>
                          </div>
                          <p>{f.comment}</p>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </>
          );
        }}
      </Async>
    </Card>
  );
}
