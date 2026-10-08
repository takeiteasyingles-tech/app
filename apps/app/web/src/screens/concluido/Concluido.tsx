// Episode done (#/concluido/:ep), port of TIE.screens.concluido in prototipo/js/screens/curso.js:
// the done card (+40 pontos), the Take the Mic average and the Revisão card count, "A seguir" and the
// episode's CTA. Scores are the server's (state.scores by phrase id).
import type { Episode } from '@tie/shared/content/schema';
import { cardsOf } from '@tie/shared/domain/srs';
import { Btn, Icon } from '@tie/ui';
import { useLayoutEffect } from 'preact/hooks';
import './concluido.css';
import type { ScreenProps } from '../../frame';
import { replace } from '../../router';
import { loadEpisode, state, useContent } from '../../store';

const pad2 = (n: number) => String(n).padStart(2, '0');
/** TIE.u.sub: {N} → the student's name. */
const sub = (t: string, name: string) =>
  String(t || '')
    .split('{N}')
    .join(name || '');

export default function Concluido({ params }: ScreenProps) {
  const num = Number(params.ep);
  const { data: E, error } = useContent<Episode>(() => loadEpisode(num), [num]);
  // The prototype fell back to another episode's card; an unknown episode goes back to the trilha.
  const gone = !Number.isInteger(num) || !!error;
  useLayoutEffect(() => {
    if (gone) replace('trilha');
  }, [gone]);
  if (gone || !E) return null;

  const s = state.value;
  const dn = E.done;
  const name = s.profile?.name ?? '';
  const sc = E.mic.map((m) => s.scores[m.id]).filter((v): v is number => v != null);
  const avg = sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1).replace('.', ',') : '—';
  const go = dn.go || 'inicio';

  return (
    <div class="scroll cc-scr">
      <div class="wrap stack cc-wrap" style={{ '--wrap': '680px', '--gap': '16px', paddingTop: '20px' }}>
        <div class="now-card stack pop cc-card" style={{ '--gap': '12px' }}>
          {/* Static celebration (the confetti burst is gone by the time the screen settles). */}
          <span class="cc-spark" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <i key={i} />
            ))}
          </span>
          {/* Trophy and badge side by side on the left; the confetti keeps the right-hand side. */}
          <div class="row" style={{ '--gap': '14px' }}>
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
        <Btn label={dn.cta} go={go} cls="block" />
        <Btn label="Voltar para Hoje" kind="ghost" go="inicio" cls="block" />
      </div>
    </div>
  );
}
