// Relatório de uma conversa do Mic (#/maggie/relatorio/:id), port de TIE.screens.relatorio em
// prototipo/js/screens/maggie.js. O relatório é escrito uma vez (POST /api/report, guardado na
// sessão pelo servidor) enquanto a tela mostra "está escrevendo o seu relatório…".
import type { Catalog } from '@tie/shared/content/schema';
import { defaults } from '@tie/shared/domain/personalize';
import type { MicSession } from '@tie/shared/state';
import { activator, Btn, Icon, Topbar, toast } from '@tie/ui';
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect } from 'preact/hooks';
import { report as aiReport } from '../../core/aiClient';
import * as speech from '../../core/speech';
import { type ScreenProps, useChrome } from '../../frame';
import { replace } from '../../router';
import { layoutOf } from '../../shell';
import { addCards } from '../../store/actions';
import { catalog, loadCatalog } from '../../store/content';
import { state } from '../../store/state';
import { assistant, fmt, isLocalSession, sessionPoints, sessionTitle, setSessionReport, The, the } from './data';

/** Relatórios sendo escritos (sess.loading do protótipo), para não pedir duas vezes. */
const loading = new Set<string>();

async function writeReport(c: Catalog, sess: MicSession): Promise<void> {
  if (sess.report || loading.has(sess.id)) return;
  loading.add(sess.id);
  try {
    const A = assistant(c, sess.assistant);
    const R = await aiReport({
      id: isLocalSession(sess.id) ? null : sess.id,
      turns: sess.turns,
      aThe: the(A),
    });
    setSessionReport(sess.id, R);
  } finally {
    loading.delete(sess.id);
  }
}

/** repSave: as palavras novas do relatório viram cartões da Revisão (um prêmio `word`). */
async function repSave(c: Catalog, sess: MicSession): Promise<void> {
  const words = sess.report?.words ?? [];
  if (!words.length) return;
  const scene = `Mic · ${assistant(c, sess.assistant).name}`;
  const r = await addCards(
    words.map((w) => ({ en: w.en, pt: w.pt, scene })),
    'report',
  );
  if (!r) return;
  const n = r.added;
  toast(n ? `${n}${n > 1 ? ' cartões novos' : ' cartão novo'} na Revisão.` : 'Essas palavras já estavam na Revisão.');
}

const say = (t: string) => () => void speech.say(t);

/**
 * No desktop o relatório ocupa a largura útil e começa alinhado ao topo (botão Voltar), em vez de
 * uma faixa estreita centralizada; no celular segue a coluna única do protótipo.
 */
const wrapStyle = (desk: boolean) =>
  desk ? { '--wrap': '1180px', '--gap': '16px', margin: '0' } : { '--wrap': '760px', '--gap': '16px' };

/** Duas colunas do relatório no desktop (sem .grid2, que é a grade dos números). */
const cols = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: '16px',
  alignItems: 'stretch',
} as const;

/** No desktop o último cartão da coluna cresce até a altura da coluna vizinha. */
const fill = (desk: boolean) => (desk ? { flex: '1 0 auto' } : {});

/** Frases curtas que quebram em duas linhas parelhas, sem palavra sobrando sozinha embaixo. */
const balanced = { textWrap: 'balance' } as const;

const divider = { paddingTop: '14px', borderTop: '1.5px solid var(--line)' } as const;

const wordCell = (i: number) =>
  ({
    padding: '7px 0',
    borderTop: i ? '1.5px solid var(--line)' : 'none',
    lineHeight: '1.35',
  }) as const;

export default function Relatorio({ params }: ScreenProps) {
  const c = catalog.value;
  const s = state.value;
  const sess = s.maggie.sessions.find((x) => x.id === params.id) ?? s.maggie.sessions[0];
  useChrome({ tabs: true, nav: 'maggie', title: 'Relatório' });

  useEffect(() => {
    if (!catalog.value) void loadCatalog().catch(() => {});
  }, []);

  // Sem nenhuma conversa guardada, volta para o Mic.
  useLayoutEffect(() => {
    if (!sess) replace('maggie');
  }, [sess]);

  useEffect(() => {
    if (c && sess && !sess.report) void writeReport(c, sess);
  }, [c, sess?.id, !!sess?.report]);

  if (!c || !sess) return null;

  const R = sess.report;
  const A = assistant(c, sess.assistant);
  const title = sessionTitle(c, sess.mode, sess.mission);
  const mine = sess.turns.filter((t) => t.who === 'me');
  const ok = mine.filter((t) => t.fb?.status === 'certo').length;
  const desk = layoutOf(s) === 'desktop';
  // Só os pontos que o servidor deu (ou daria, pelas regras dele) a esta conversa.
  const pts = sessionPoints(sess);
  const head = (
    // O fim do parágrafo já traz a meia entrelinha: a borda de baixo fica um pouco menor que a de cima.
    <div class="now-card stack" style={{ '--gap': '10px', paddingBottom: '16px' }}>
      <span class="kick" style={{ alignSelf: 'flex-start' }}>
        <Icon name="star" size={12} /> Relatório
      </span>
      <div class="h1" style={{ color: '#fff' }}>
        {title}
      </div>
      <div class="sm" style={{ color: 'var(--onNavy)' }}>
        {`${fmt(sess.secs)} de conversa · ${mine.length} ${mine.length === 1 ? 'fala sua' : 'falas suas'}${pts ? ` · +${pts} pontos` : ''}`}
      </div>
      {R ? (
        <p class="p" style={{ color: '#fff', maxWidth: '68ch' }}>
          {R.summary_pt}
        </p>
      ) : null}
    </div>
  );

  if (!R)
    return (
      <>
        <Topbar back="maggie" kicker="Mic" title="Relatório" />
        <div class="scroll">
          <div class="wrap stack" style={wrapStyle(desk)}>
            {head}
            <div class="card row" style={{ '--gap': '12px' }}>
              <div class="thinking" style={{ background: 'var(--cream)' }}>
                <i />
                <i />
                <i />
              </div>
              <span class="p">{`${The(A)} está escrevendo o seu relatório…`}</span>
            </div>
          </div>
        </div>
      </>
    );

  const training = s.profile ? defaults(s.profile).training : false;
  const words = R.words || [];
  const again = `maggie?modo=${sess.mode}${sess.mode === 'missao' && sess.mission ? `&m=${sess.mission}` : ''}&r=${Date.now()}`;

  const stats = training ? null : (
    <div class="grid2">
      <div class="stat">
        <div class="num">{`${ok}/${mine.length}`}</div>
        <div class="sm mt8">falas certas de primeira</div>
      </div>
      <div class="stat">
        <div class="num">{words.length}</div>
        <div class="sm mt8">expressões novas</div>
      </div>
    </div>
  );

  const strengths = (
    <div class="card stack" style={{ '--gap': '10px' }}>
      <div class="lbl gr">O que foi bem</div>
      {(R.strengths || []).map((t) => (
        <div key={t} class="row top" style={{ '--gap': '10px' }}>
          <Icon name="check" size={20} extra={{ style: { color: 'var(--green)', flex: 'none', marginTop: '2px' } }} />
          <span class="p">{t}</span>
        </div>
      ))}
    </div>
  );

  // "O que ajustar" num cartão só, como os outros blocos: cada ajuste separado por uma linha.
  const fixes = (R.fixes || []).length ? (
    <div class="card stack" style={{ '--gap': '14px' }}>
      <div class="lbl bl">O que ajustar</div>
      {R.fixes.map((f, i) => (
        <div key={i} class="stack" style={{ '--gap': '10px', ...(i ? divider : {}) }}>
          <div class="cmp">
            <span class="k" style={{ color: 'var(--muted)' }}>
              VOCÊ
            </span>
            <span
              class="p strike"
              style={{
                color: 'var(--ink)',
                textDecorationColor: 'var(--orange)',
                textDecorationThickness: '1.5px',
                ...balanced,
              }}
            >
              {f.said}
            </span>
            <span class="k" style={{ color: 'var(--blue)' }}>
              MELHOR
            </span>
            <button
              type="button"
              class="en"
              style={{ textAlign: 'left', fontSize: '1.06rem', ...balanced }}
              onClick={activator(undefined, say(f.better))}
            >
              {f.better}{' '}
              <Icon name="speaker" size={16} extra={{ style: { verticalAlign: '-2px', color: 'var(--blue)' } }} />
            </button>
          </div>
          <div class="fb fix">
            {f.cat ? (
              <>
                <b>{f.cat}.</b>{' '}
              </>
            ) : null}
            {f.why_pt}
          </div>
        </div>
      ))}
    </div>
  ) : null;

  // Uma grade só para todas as linhas: a dica começa na mesma coluna, qualquer que seja a palavra.
  const pron = (R.pron || []).length ? (
    <div class="card stack" style={{ '--gap': '12px' }}>
      <div class="lbl">Pronúncia para ficar de olho</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content minmax(0, 1fr)',
          gap: desk ? '14px 12px' : '10px 12px',
        }}
      >
        {R.pron.map((x) => (
          <Fragment key={x.word}>
            <button
              type="button"
              class="pill navy"
              style={{ justifySelf: 'stretch', alignSelf: 'start', marginTop: '1px' }}
              onClick={activator(undefined, say(x.word))}
            >
              <Icon name="play" size={12} />
              {x.word}
            </button>
            {/* Quebra comum: a dica usa a largura toda do cartão antes de descer de linha. */}
            <span class="p" style={{ textWrap: 'wrap' }}>
              {x.tip_pt}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  ) : null;

  const newWords = words.length ? (
    <div class="card stack" style={{ '--gap': '12px', ...fill(desk) }}>
      <div class="lbl or">Palavras novas</div>
      {/* Um glossário em duas colunas (inglês | português) em vez de pílulas de largura irregular. No
          celular a tradução encosta à direita, como num cardápio: a coluna fecha numa borda reta. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: desk ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'fit-content(60%) minmax(0, 1fr)',
        }}
      >
        {words.map((w, i) => (
          <Fragment key={w.en}>
            <button
              type="button"
              class="en"
              style={{ ...wordCell(i), textAlign: 'left', paddingRight: desk ? '12px' : '16px' }}
              onClick={activator(undefined, say(w.en))}
            >
              <Icon
                name="speaker"
                size={14}
                extra={{ style: { color: 'var(--blue)', verticalAlign: '-2px', marginRight: '6px' } }}
              />
              {w.en}
            </button>
            <span class="p" style={{ ...wordCell(i), ...(desk ? {} : { textAlign: 'right' }) }}>
              {w.pt}
            </span>
          </Fragment>
        ))}
      </div>
      <div style={{ marginTop: 'auto' }}>
        <Btn
          label={`Levar ${words.length} para a Revisão`}
          icon="plus"
          kind="blue"
          cls="block"
          onClick={() => void repSave(c, sess)}
        />
      </div>
    </div>
  ) : null;

  // Como os outros blocos: rótulo e texto no topo (a frase usa a largura toda). No desktop é o último
  // cartão da coluna da direita e cobre só a pequena sobra até o fim da coluna da esquerda.
  const goal = (
    <div class="card or stack" style={{ '--gap': '6px', ...fill(desk), justifyContent: 'center' }}>
      <div class="lbl or">Próxima meta</div>
      <p class="p" style={{ textWrap: 'wrap', maxWidth: 'none' }}>
        {R.next_goal_pt}
      </p>
    </div>
  );

  const actions = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: desk ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
        gap: desk ? '16px' : '10px',
        width: '100%',
      }}
    >
      <Btn label="Conversar de novo" icon="mic" cls="block" go={again} />
      <Btn label="Voltar para Hoje" kind="ghost" cls="block" go="inicio" />
    </div>
  );

  return (
    <>
      <Topbar
        back="maggie"
        kicker="Mic"
        title="Relatório"
        right={
          <span class={`demo-badge${R.source === 'ia' ? ' live' : ''}`}>
            <i />
            {R.source === 'ia' ? 'Feito pela IA' : 'Modo demo'}
          </span>
        }
      />
      <div class="scroll">
        <div class="wrap stack" style={wrapStyle(desk)}>
          {head}
          {desk ? (
            // Duas colunas da mesma altura (o último cartão de cada uma estica até o fim dela) e, embaixo
            // das duas, os botões, cada um alinhado a uma coluna: a borda de baixo fica reta.
            <>
              <div style={cols}>
                <div class="stack" style={{ '--gap': '16px' }}>
                  {stats}
                  {strengths}
                  {newWords}
                </div>
                <div class="stack" style={{ '--gap': '16px' }}>
                  {fixes}
                  {pron}
                  {goal}
                </div>
              </div>
              {actions}
            </>
          ) : (
            <>
              {stats}
              {strengths}
              {fixes}
              {pron}
              {newWords}
              {goal}
              {actions}
            </>
          )}
        </div>
      </div>
    </>
  );
}
