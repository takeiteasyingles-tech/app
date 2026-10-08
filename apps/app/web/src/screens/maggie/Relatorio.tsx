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
  desk
    ? { '--wrap': '1180px', '--gap': '16px', margin: '0', paddingBottom: '8px' }
    : { '--wrap': '760px', '--gap': '16px' };

/** Duas colunas do relatório no desktop (sem .grid2, que é a grade dos números). */
const cols = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: '16px',
  alignItems: 'stretch',
} as const;

/** No desktop o último cartão da coluna cresce até a altura da coluna vizinha. */
const fill = (desk: boolean) => (desk ? { flex: '1 0 auto' } : {});

/**
 * As frases do "o que ajustar": no desktop (coluna estreita ao lado do rótulo) em duas linhas
 * parelhas; no celular, com a largura toda, enchem a linha e só evitam a palavra sozinha embaixo.
 */
const wrapFor = (desk: boolean) => ({ textWrap: desk ? 'balance' : 'pretty' }) as const;

const divider = { paddingTop: '14px', borderTop: '1.5px solid var(--line)' } as const;

/** A frase dita, riscada em laranja. */
const strike = {
  color: 'var(--ink)',
  textDecorationColor: 'var(--orange)',
  textDecorationThickness: '1.5px',
} as const;

/** Texto só para leitores de tela (o tie.css não tem uma classe para isso). */
const srOnly = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

/** Selo redondo que abre a frase dita (X) e a melhor (certo) no "o que ajustar" do celular. */
function mark(icon: string, color: string, bg: string) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: '22px',
        height: '22px',
        flex: 'none',
        marginTop: '1px',
        borderRadius: '50%',
        background: bg,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={13} />
    </span>
  );
}

/**
 * A meta vem do relatório (IA ou roteiro) às vezes já começando por "Próxima meta:", o que repetia o
 * rótulo do cartão. Tira esse começo e devolve a frase com maiúscula.
 */
export function goalText(t: string): string {
  const s = t.replace(/^\s*pr[oó]xima\s+meta\s*[:·\-–—]\s*/i, '').trim();
  return s ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : t;
}

/** Cada palavra nova é um ladrilho: inglês (toque para ouvir) sobre a tradução. */
const wordTile = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  width: '100%',
  minWidth: '0',
  textAlign: 'left',
  padding: '10px 12px',
  borderRadius: '12px',
  background: 'var(--cream)',
  border: '1.5px solid var(--line)',
  lineHeight: '1.3',
} as const;

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

  // Todos os blocos no mesmo cartão branco; a cor fica no rótulo e nos ícones (verde aqui, azul no
  // que ajustar). Só a próxima meta, o passo seguinte, ganha o fundo pêssego.
  const strengths = (
    <div class="card stack" style={{ '--gap': '12px', ...fill(desk) }}>
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
    <div class="card stack" style={{ '--gap': '14px', ...fill(desk) }}>
      <div class="lbl bl">O que ajustar</div>
      {R.fixes.map((f, i) => (
        <div key={i} class="stack" style={{ '--gap': '10px', ...(i ? divider : {}) }}>
          {desk ? (
            <div class="cmp">
              <span class="k" style={{ color: 'var(--muted)' }}>
                VOCÊ
              </span>
              <span class="p strike" style={{ ...strike, ...wrapFor(desk) }}>
                {f.said}
              </span>
              <span class="k" style={{ color: 'var(--blue)' }}>
                MELHOR
              </span>
              <button
                type="button"
                class="en"
                style={{ textAlign: 'left', fontSize: '1.06rem', ...wrapFor(desk) }}
                onClick={activator(undefined, say(f.better))}
              >
                {f.better}{' '}
                <Icon name="speaker" size={16} extra={{ style: { verticalAlign: '-2px', color: 'var(--blue)' } }} />
              </button>
            </div>
          ) : (
            // Celular: em vez de uma linha só para cada rótulo (ou de uma coluna estreita ao lado
            // dele), um selo pequeno abre cada frase, que usa o resto da largura: o X laranja na
            // frase dita, o certo azul na melhor. Os rótulos VOCÊ / MELHOR seguem no nome acessível.
            // O .cmp do protótipo continua no DOM (o mesmo seletor nos dois tamanhos), em coluna.
            <div class="cmp" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div class="row top" style={{ '--gap': '10px' }}>
                {mark('close', 'var(--orange)', 'var(--orangeT)')}
                <p class="p" style={{ ...wrapFor(desk), fontSize: '.95rem', lineHeight: '1.45', position: 'relative' }}>
                  <span style={srOnly}>Você: </span>
                  <span class="strike" style={strike}>
                    {f.said}
                  </span>
                </p>
              </div>
              <div class="row top" style={{ '--gap': '10px' }}>
                {mark('check', 'var(--blue)', 'var(--blueT)')}
                <button
                  type="button"
                  class="en"
                  style={{
                    position: 'relative',
                    textAlign: 'left',
                    fontSize: '1.06rem',
                    lineHeight: '1.4',
                    ...wrapFor(desk),
                  }}
                  onClick={activator(undefined, say(f.better))}
                >
                  <span style={srOnly}>Melhor: </span>
                  {f.better}{' '}
                  <Icon name="speaker" size={16} extra={{ style: { verticalAlign: '-2px', color: 'var(--blue)' } }} />
                </button>
              </div>
            </div>
          )}
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
  // Cada linha separada por um fio, no ritmo das listas dos outros cartões; a dica enche a linha
  // ("pretty" só evita a palavra sozinha embaixo).
  // Desktop: o cartão tem a altura do vizinho (palavras novas) e as linhas dividem essa altura por
  // igual, cada uma centrada, sem sobra no pé. Celular: a palavra sobre a dica, que usa a largura
  // toda do cartão (sem quebrar numa coluna estreita ao lado da palavra).
  const pron = (R.pron || []).length ? (
    <div class="card stack" style={{ '--gap': desk ? '4px' : '6px', ...fill(desk) }}>
      <div class="lbl">Pronúncia para ficar de olho</div>
      {desk ? (
        <div
          style={{
            flex: '1 0 auto',
            display: 'grid',
            gridTemplateColumns: 'max-content minmax(0, 1fr)',
            gridAutoRows: '1fr',
          }}
        >
          {R.pron.map((x, i) => {
            const line = {
              display: 'flex',
              alignItems: 'center',
              padding: '12px 0',
              ...(i ? { borderTop: '1.5px solid var(--line)' } : {}),
            };
            return (
              <Fragment key={x.word}>
                <div style={{ ...line, paddingRight: '12px' }}>
                  <button
                    type="button"
                    class="pill navy"
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                    onClick={activator(undefined, say(x.word))}
                  >
                    <Icon name="play" size={12} />
                    {x.word}
                  </button>
                </div>
                <span class="p" style={{ ...line, textWrap: 'pretty' }}>
                  {x.tip_pt}
                </span>
              </Fragment>
            );
          })}
        </div>
      ) : (
        <div class="stack" style={{ '--gap': '0' }}>
          {R.pron.map((x, i) => (
            <div
              key={x.word}
              class="stack"
              style={{
                '--gap': '5px',
                alignItems: 'flex-start',
                padding: '11px 0',
                ...(i ? { borderTop: '1.5px solid var(--line)' } : { paddingTop: '8px' }),
                ...(i === R.pron.length - 1 ? { paddingBottom: '0' } : {}),
              }}
            >
              <button type="button" class="pill navy" onClick={activator(undefined, say(x.word))}>
                <Icon name="play" size={12} />
                {x.word}
              </button>
              <span class="p" style={{ fontSize: '.9rem', lineHeight: '1.45', textWrap: 'pretty' }}>
                {x.tip_pt}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const newWords = words.length ? (
    <div class="card stack" style={{ '--gap': '12px', ...fill(desk) }}>
      <div class="lbl or">Palavras novas</div>
      {/* Ladrilhos em vez de pílulas de largura irregular, em duas colunas nos dois tamanhos: inglês
          (toque para ouvir) sobre a tradução, todos os ladrilhos da mesma altura, sem vão entre a
          palavra e a tradução. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gridAutoRows: '1fr',
          gap: '8px',
        }}
      >
        {words.map((w) => (
          <button
            type="button"
            key={w.en}
            style={desk ? wordTile : { ...wordTile, padding: '9px 11px' }}
            onClick={activator(undefined, say(w.en))}
          >
            {/* Celular: o alto-falante vai depois da palavra, e a tradução ganha a largura toda do
                ladrilho (numa linha só, em vez de quebrar ao lado do ícone). */}
            {desk ? (
              <Icon
                name="speaker"
                size={15}
                extra={{ style: { color: 'var(--blue)', flex: 'none', marginTop: '3px' } }}
              />
            ) : null}
            <span class="stack" style={{ '--gap': '2px', minWidth: '0' }}>
              <span class="en" style={{ fontSize: desk ? '.98rem' : '.95rem', overflowWrap: 'anywhere' }}>
                {w.en}
                {desk ? null : (
                  <Icon
                    name="speaker"
                    size={14}
                    extra={{ style: { color: 'var(--blue)', marginLeft: '6px', verticalAlign: '-2px' } }}
                  />
                )}
              </span>
              <span class="xs" style={{ color: 'var(--ink)', fontSize: desk ? '.88rem' : '.82rem' }}>
                {w.pt}
              </span>
            </span>
          </button>
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

  const goalBody = (
    <div class="stack" style={{ '--gap': '6px', minWidth: '0', flex: '1' }}>
      <div class="lbl or">Próxima meta</div>
      <p class="p" style={{ textWrap: 'pretty', maxWidth: 'none' }}>
        {goalText(R.next_goal_pt)}
      </p>
    </div>
  );

  // O botão principal é o laranja; voltar para Hoje é secundário (fundo claro, borda fina).
  const again_ = <Btn label="Conversar de novo" icon="mic" cls={desk ? '' : 'block'} go={again} />;
  const home = <Btn label="Voltar para Hoje" kind="light" cls={desk ? '' : 'block'} go="inicio" />;

  // Desktop: a próxima meta e os botões numa faixa só no pé, a largura toda: o passo seguinte, sem
  // cartão curto sobrando no fim de uma coluna. Celular: o cartão da meta e, embaixo, os botões.
  const footer = desk ? (
    <div class="card or row" style={{ '--gap': '24px', alignItems: 'center' }}>
      {goalBody}
      <div class="row" style={{ '--gap': '12px', flex: 'none' }}>
        {home}
        {again_}
      </div>
    </div>
  ) : (
    <>
      <div class="card or">{goalBody}</div>
      <div class="stack" style={{ '--gap': '10px' }}>
        {again_}
        {home}
      </div>
    </>
  );

  // Desktop: os cartões em pares de mesma altura (o que foi bem | o que ajustar; palavras novas |
  // pronúncia); um cartão sem par ocupa a linha toda.
  const cards = [strengths, fixes, newWords, pron].filter((x) => !!x);

  return (
    <>
      <Topbar
        back="maggie"
        kicker="Mic"
        title="Relatório"
        right={
          // O selo cheio de sempre (.demo-badge), com um fio bem leve para não sumir no creme.
          <span
            class={`demo-badge${R.source === 'ia' ? ' live' : ''}`}
            style={{
              boxShadow: `inset 0 0 0 1px ${R.source === 'ia' ? 'rgba(31, 122, 76, .2)' : 'rgba(27, 82, 196, .18)'}`,
            }}
          >
            <i />
            {R.source === 'ia' ? 'Feito pela IA' : 'Modo demo'}
          </span>
        }
      />
      <div class="scroll">
        <div class="wrap stack" style={wrapStyle(desk)}>
          {head}
          {desk ? (
            <>
              {stats}
              <div style={cols}>
                {cards.map((x, i) =>
                  cards.length % 2 && i === cards.length - 1 ? (
                    <div key={i} class="stack" style={{ gridColumn: '1 / -1' }}>
                      {x}
                    </div>
                  ) : (
                    <div key={i} class="stack">
                      {x}
                    </div>
                  ),
                )}
              </div>
              {footer}
            </>
          ) : (
            <>
              {stats}
              {strengths}
              {fixes}
              {pron}
              {newWords}
              {footer}
            </>
          )}
        </div>
      </div>
    </>
  );
}
