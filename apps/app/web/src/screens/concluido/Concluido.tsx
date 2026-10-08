// Episode done (#/concluido/:ep), port of TIE.screens.concluido in prototipo/js/screens/curso.js:
// the done card (+40 pontos), the Take the Mic average and the Revisão card count, "A seguir" and the
// episode's CTA. Scores are the server's (state.scores by phrase id).
//
// The prototype celebrated whoever opened the link. Here the celebration (badge "concluído",
// "+40 pontos", confetti, the next episode's CTA) only shows once the episode is in epsDone. A deep
// link to an unfinished episode shows a progress screen instead: how many steps are left, the
// 10-step bar, what the student will be able to do, where to pick up and the CTA back to that step.
// It never shows points, cards or a "concluído" the learner did not get.
import type { Episode } from '@tie/shared/content/schema';
import { cardsOf } from '@tie/shared/domain/srs';
import { Btn, Icon, Segs } from '@tie/ui';
import { useEffect, useLayoutEffect } from 'preact/hooks';
import './concluido.css';
import type { ScreenProps } from '../../frame';
import { replace } from '../../router';
import { catalog, loadCatalog, loadEpisode, state, useContent } from '../../store';

const pad2 = (n: number) => String(n).padStart(2, '0');
/** TIE.u.sub: {N} → the student's name. */
const sub = (t: string, name: string) =>
  String(t || '')
    .split('{N}')
    .join(name || '');

/** "AGORA VOCÊ CUMPRIMENTA E DIZ QUEM VOCÊ É." → "Você cumprimenta e diz quem você é." (the goal). */
function goalOf(title: string): string {
  const low = title
    .replace(/^\s*agora\s+/i, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
  return low.replace(/\p{L}/u, (ch) => ch.toLocaleUpperCase('pt-BR'));
}

export default function Concluido({ params }: ScreenProps) {
  const num = Number(params.ep);
  const { data: E, error } = useContent<Episode>(() => loadEpisode(num), [num]);
  useEffect(() => {
    if (!catalog.value) void loadCatalog().catch(() => {});
  }, []);
  // The prototype fell back to another episode's card; an unknown episode goes back to the trilha.
  const gone = !Number.isInteger(num) || !!error;
  useLayoutEffect(() => {
    if (gone) replace('trilha');
  }, [gone]);
  if (gone || !E) return null;

  const s = state.value;
  const done = !!s.epsDone[num];
  const dn = E.done;
  const name = s.profile?.name ?? '';
  const sc = E.mic.map((m) => s.scores[m.id]).filter((v): v is number => v != null);
  const avg = sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1).replace('.', ',') : '—';

  if (!done) return <Todo E={E} avg={avg} />;

  return (
    <div class="scroll cc-scr">
      <div class="wrap stack cc-wrap" style={{ '--wrap': '680px', '--gap': '16px', paddingTop: '20px' }}>
        <div class="now-card stack pop cc-card" style={{ '--gap': '12px' }}>
          {/* Static celebration (the confetti burst is gone by the time the screen settles). */}
          <span class="cc-spark" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          {/* Trophy and badge side by side on the left. */}
          <div class="row cc-top" style={{ '--gap': '14px' }}>
            <span class="cc-medal" aria-hidden="true">
              <Icon name="trophy" size={26} />
            </span>
            <span class="kick">
              <Icon name="check" size={12} />
              {` Episódio ${pad2(E.num)} concluído`}
            </span>
          </div>
          <div class="h1" style={{ color: '#fff' }}>
            {dn.title}
          </div>
          <div class="h2" style={{ color: '#fff' }}>
            {sub(dn.line, name)}
          </div>
          <span class="pill gold" style={{ alignSelf: 'flex-start' }}>
            +40 pontos
          </span>
        </div>
        <div class="grid2">
          <div class="stat">
            <div class="num">{avg}</div>
            <div class="sm mt8">nota média no Take the Mic</div>
          </div>
          <div class="stat">
            <div class="num">{cardsOf(E).length}</div>
            <div class="sm mt8">cartões na sua Revisão</div>
          </div>
        </div>
        <div class="card stack" style={{ '--gap': '12px' }}>
          <div class="lbl">A seguir</div>
          <div class="row" style={{ '--gap': '14px' }}>
            <span class="num" style={{ fontSize: '2rem', color: 'var(--orange)' }}>
              {dn.nextNum}
            </span>
            <div>
              <div class="h3">{dn.nextTitle}</div>
              <div class="sm">{dn.nextSub}</div>
            </div>
          </div>
          <p class="p" style={{ borderTop: '1.5px solid var(--line)', paddingTop: '10px' }}>
            {dn.nextNote}
          </p>
        </div>
        <Btn label={dn.cta} go={dn.go || 'inicio'} cls="block" />
        <Btn label="Voltar para Hoje" kind="ghost" go="inicio" cls="block" />
      </div>
    </div>
  );
}

/**
 * Not finished yet: where the student stands in the episode, what finishing it gives, and the step to
 * pick up from. Same card, grid and CTA layout as the celebration, so the screen keeps its shape.
 */
function Todo({ E, avg }: { E: Episode; avg: string }) {
  const s = state.value;
  const cat = catalog.value;
  const steps = cat?.steps ?? [];
  const total = steps.length || 10;
  const at = Math.min(Math.max(s.prog[E.num] || 1, 1), total);
  const doneN = at - 1;
  const left = total - doneN;
  const cur = steps[at - 1];
  const dn = E.done;
  // The trilha lock (the player's lockedBy, the server's assertOpen): while an earlier published
  // episode is unfinished this one cannot be played, so the CTA points at the blocking episode
  // instead of a step the player would bounce back to the trilha.
  const lockedBy = cat
    ? (cat.episodes
        .filter((x) => x.status === 'published' && x.num < E.num)
        .map((x) => x.num)
        .sort((x, y) => x - y)
        .find((n) => !s.epsDone[n]) ?? null)
    : null;
  const blockAt = lockedBy != null ? Math.min(Math.max(s.prog[lockedBy] || 1, 1), total) : 1;
  return (
    <div class="scroll cc-scr">
      <div class="wrap stack cc-wrap" style={{ '--wrap': '680px', '--gap': '16px', paddingTop: '20px' }}>
        <div class="now-card stack pop cc-card cc-todo" style={{ '--gap': '14px' }}>
          {/* Flag medal beside the episode's status and title (a quiet label, so the only pill in the
              card is the reward). */}
          <div class="row cc-top" style={{ '--gap': '12px' }}>
            <span class="cc-medal" aria-hidden="true">
              <Icon name="flag" size={22} />
            </span>
            <span class="cc-hd">
              <span class="cc-kt">{`Episódio ${pad2(E.num)} · em andamento`}</span>
              <span class="cc-ept">{E.title}</span>
            </span>
          </div>
          <div>
            <div class="h1 cc-h" style={{ color: '#fff' }}>
              {left === 1 ? 'Falta 1 etapa para concluir' : `Faltam ${left} etapas para concluir`}
            </div>
            {/* Says why this is not the celebration: it opens once the last step is done. */}
            <p class="sm cc-why">
              {lockedBy != null
                ? `Este episódio abre depois do episódio ${pad2(lockedBy)}.`
                : `A comemoração abre na etapa ${pad2(total)}.`}
            </p>
          </div>
          <div class="row cc-prog" style={{ '--gap': '12px' }}>
            <div class="grow">
              <Segs cur={at} reached={at} total={total} />
            </div>
            <span class="stepcount">{`etapa ${at} de ${total}`}</span>
          </div>
          <div class="cc-goal">
            <div class="cc-goalh">
              <span class="lbl" style={{ color: 'var(--onNavy)' }}>
                Ao concluir
              </span>
              <span class="pill gold cc-pts">
                <Icon name="star" size={14} />
                +40 pontos
              </span>
            </div>
            <span class="cc-goalx">{goalOf(dn.title)}</span>
          </div>
        </div>
        <div class="grid2">
          <div class="stat">
            <div class="num">
              {doneN}
              <span class="cc-of">/{total}</span>
            </div>
            <div class="sm mt8">etapas feitas</div>
          </div>
          <div class="stat">
            <div class="num">{avg}</div>
            <div class="sm mt8">nota média no Mic</div>
          </div>
        </div>
        {lockedBy != null ? (
          <div class="card stack" style={{ '--gap': '12px' }}>
            <div class="lbl or">Antes deste, termine</div>
            <div class="row" style={{ '--gap': '14px' }}>
              <span class="num" style={{ fontSize: '2rem', color: 'var(--orange)' }}>
                {pad2(lockedBy)}
              </span>
              <div style={{ minWidth: '0' }}>
                <div class="h3">
                  {cat?.episodes.find((x) => x.num === lockedBy)?.title ?? `Episódio ${pad2(lockedBy)}`}
                </div>
                <div class="sm">{`etapa ${blockAt} de ${total}`}</div>
              </div>
            </div>
          </div>
        ) : (
          <div class="card stack" style={{ '--gap': '12px' }}>
            <div class="lbl or">Continue de onde parou</div>
            <div class="row" style={{ '--gap': '14px' }}>
              <span class="num" style={{ fontSize: '2rem', color: 'var(--orange)' }}>
                {pad2(at)}
              </span>
              <div style={{ minWidth: '0' }}>
                <div class="h3">{cur?.name ?? `Etapa ${at}`}</div>
                {cur?.pt ? <div class="sm">{cur.pt}</div> : null}
              </div>
            </div>
            <p class="p" style={{ borderTop: '1.5px solid var(--line)', paddingTop: '10px' }}>
              {'Depois deste episódio: '}
              <span class="cc-nw">{`${dn.nextNum} · ${dn.nextTitle}.`}</span>
            </p>
          </div>
        )}
        {lockedBy != null ? (
          <Btn
            label={`Ir para o episódio ${pad2(lockedBy)}`}
            go={`episodio/${lockedBy}/${blockAt}`}
            cls="block"
            iconR="next"
          />
        ) : (
          <Btn label={`Continuar na etapa ${pad2(at)}`} go={`episodio/${E.num}/${at}`} cls="block" iconR="next" />
        )}
        <Btn label="Voltar para Hoje" kind="ghost" go="inicio" cls="block" />
      </div>
    </div>
  );
}
