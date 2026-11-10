// The 9 step bodies of the episode player (prototipo/js/screens/player.js STEP, without its e-book), with the
// prototype's exact markup, classes, inline styles and pt-BR copy so tie.css renders them the same.
// Steps 1-3 follow the production order (STEP: song, e-book, intro), not the prototype's.
import { STEP } from '@tie/shared/constants';
import { need } from '@tie/shared/domain/gating';
import { Btn, Icon } from '@tie/ui';
import { type ComponentChildren, Fragment } from 'preact';
import { Blocks } from '../../ui-blocks/Blocks';
import { fmt, heard, lyricRows, type MicFeedback, pad2, type StepCtx, type StepOut } from './model';
import { AudioPill, Presentation } from './Presentation';
import { TestStep } from './TestStep';

const playIco = (playing: boolean) => <Icon name={playing ? 'pause' : 'play'} size={20} />;

/**
 * "0:12 / 0:58"; before the metadata arrives only the position shows (never the prototype's "/ —").
 * The duration is rounded (a 2,6 s file reads "0:03", not "0:02").
 */
const clock = (t: number, d: number) => (d ? `${fmt(t)} / ${fmt(Math.round(d))}` : fmt(t));

/** One hue per character of the episode, in cast order (used when the catalog colours repeat). */
const HUES = ['#F45A28', '#2A6FF5', '#1F7A4C', '#E9A200', '#8E5BD6', '#D9645B', '#0E8A9A'];

/**
 * The colour of a character in this episode: its avatar ring (cast strip) and its dot (Take It In).
 * The catalog's colours when they tell the whole cast apart; otherwise (the prototype's cast was
 * four slate characters and one blue, so the blue one looked "selected") one hue per character.
 */
export function castColor(Ep: StepCtx['Ep'], cat: StepCtx['cat'], who: string): string {
  const own = Ep.cast.map((n) => cat.cast[n]?.color ?? '');
  const distinct = own.every((c) => c) && new Set(own.map((c) => c.toLowerCase())).size === own.length;
  const i = Ep.cast.indexOf(who);
  if (i < 0) return cat.cast[who]?.color ?? 'var(--muted)';
  return distinct ? (own[i] as string) : (HUES[i % HUES.length] as string);
}

/**
 * A lesson block's all-caps label in sentence case, for a light read: "O VERBO TO BE NA 1ª E 2ª
 * PESSOA" → "O verbo to be na 1ª e 2ª pessoa", "MR. · MRS. · MS. · MISS" → "Mr. · Mrs. · Ms. · Miss".
 * Each "·" part starts with a capital, and the pronoun I stays a capital.
 */
function sentenceCase(t: string): string {
  return t
    .split(' · ')
    .map((part) => {
      const low = part.toLocaleLowerCase('pt-BR').replace(/(^|[^\p{L}])i(?=$|[^\p{L}])/gu, '$1I');
      return low.replace(/\p{L}/u, (ch) => ch.toLocaleUpperCase('pt-BR'));
    })
    .join(' · ');
}

// ---------- 1 · Apresentação do Episódio (abre o episódio; Presentation.tsx) ----------

function Intro({ Ep, P, a, tap }: StepCtx): StepOut {
  return {
    body: (
      <Presentation
        text={Ep.synopsis}
        playing={P.playing}
        aT={P.aT}
        aD={P.aD}
        hasAudio={!!Ep.introAudio}
        onPlay={tap(a.play)}
      />
    ),
  };
}

// ---------- 2 e 9 · Música (título, tradução, player e instrução fixos; só a letra rola) ----------

function Song({ Ep, cat, s, P, step, a, tap }: StepCtx): StepOut {
  const len = Ep.lyrics.length || 1;
  const pct =
    Ep.songAudio && P.aD ? Math.round((P.aT / P.aD) * 100) : Math.round(((P.line + (P.playing ? 1 : 0)) / len) * 100);
  const time = Ep.songAudio ? clock(P.aT, P.aD) : `0:${pad2(8 + P.line * 7)}`;
  const { rows, of } = lyricRows(Ep.lyrics);
  const on = of[P.line] ?? 0;
  return {
    dock: (
      <div class="stack" style={{ '--gap': '8px' }}>
        {/* Label and title are one block; the Tradução toggle centres on that block. */}
        <div class="row between" style={{ '--gap': '12px' }}>
          <div class="pl-songh">
            <div class="lbl">{step === STEP.SONG ? 'Música · 1ª passada' : 'Música · cante junto'}</div>
            <div class="h2">{Ep.songTitle}</div>
          </div>
          <button
            type="button"
            class="row pl-trans"
            aria-pressed={P.trans}
            onClick={tap(a.trans)}
            style={{ '--gap': '8px', fontWeight: '800', minHeight: '44px', flex: 'none' }}
          >
            <span class="pl-transl">Tradução</span>
            <span class={`toggle${P.trans ? ' on' : ''}`}>
              <i />
            </span>
          </button>
        </div>
        <div class="card row" style={{ '--gap': '12px', padding: '8px 14px 8px 8px' }}>
          <button
            type="button"
            class={`playbtn${P.playing ? '' : ' navy'}`}
            onClick={tap(a.play)}
            aria-label="Tocar"
            style={{ width: '48px', height: '48px' }}
          >
            {playIco(P.playing)}
          </button>
          <div class="bar grow">
            <i id="pl-bar" style={{ width: `${pct}%` }} />
          </div>
          <span class="xs" id="pl-time">
            {time}
          </span>
        </div>
        {!Ep.songAudio ? (
          <p class="xs">Sem a gravação desta música: a trilha é sintetizada e a letra avança sozinha.</p>
        ) : null}
      </div>
    ),
    body: (
      <>
        {/* Step 10's instruction scrolls away with the lyrics instead of making the fixed dock taller. */}
        {step === STEP.SING ? (
          <div class="pl-sing">
            <span class="pl-singi" aria-hidden="true">
              <Icon name="mic" size={18} />
            </span>
            <span class="grow">
              <b>Agora é sua vez:</b> cante junto <span class="nw">até o fim.</span>
            </span>
            <span class="pill pl-singp">+10 pontos</span>
          </div>
        ) : null}
        <div class="stack" style={{ '--gap': '2px' }}>
          {rows.map(({ l, n, first }, i) => (
            <div key={l.id ?? first} class={`dialog-line${i === on ? ' on' : ''}`} id={`ly${i}`}>
              <div
                class="en"
                style={{
                  fontSize: i === on ? '1.2rem' : '1.08rem',
                  color: i === on ? 'var(--navy)' : 'var(--muted)',
                }}
              >
                {l.en}
                {n > 1 ? (
                  <span class="pill pl-rep" title={`A música repete esta linha ${n} vezes`}>
                    {`×${n}`}
                  </span>
                ) : null}
              </div>
              {P.trans ? (
                <div class="pt sm" style={{ marginTop: '2px' }}>
                  {l.pt}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {step === STEP.SONG && !need(Ep, s, STEP.SONG) && cat.steps[STEP.SONG] ? (
          <NextCard icon="play" onClick={tap(a.next)}>
            <b class="pl-nextt">Próximo: {cat.steps[STEP.SONG]?.name}</b>
            <span class="sm pl-nexts">{cat.steps[STEP.SONG]?.pt}</span>
          </NextCard>
        ) : null}
      </>
    ),
  };
}

/** The dashed "Próximo: …" card that ends a finished step (the prototype's step-2 hint), as a Next shortcut. */
function NextCard({
  icon,
  onClick,
  children,
}: {
  icon: string;
  onClick: (ev: Event) => void;
  children: ComponentChildren;
}) {
  return (
    <button type="button" class="card row pl-next" onClick={onClick} style={{ '--gap': '14px' }}>
      <span class="pl-cico">
        <Icon name={icon} size={22} />
      </span>
      <span class="grow pl-nextx">{children}</span>
      <Icon name="next" size={20} />
    </button>
  );
}

// ---------- 3 · Take a Look ----------

function Look({ Ep, P, a, tap, homeBg }: StepCtx, onVideoEnd: () => void): StepOut {
  const still = Ep.sceneImage || homeBg;
  const ctx = !!Ep.lookAudio;
  return {
    body: (
      <>
        {/* PROD (spec 05 "Take a Look"): today's episode in two moves, the context audio, then the scene. */}
        <div class="lk-h">Episódio de hoje</div>
        {ctx ? (
          <>
            <div class="lk-step">1º Ouça o contexto e prepare a mente.</div>
            <div class="lk-pill">
              <AudioPill playing={P.playing} aT={P.aT} aD={P.aD} hasAudio onPlay={tap(a.play)} what="o contexto" />
            </div>
          </>
        ) : null}
        <div class="lk-step">
          {ctx ? '2º Assista o vídeo e prepare o coração.' : 'Assista o vídeo e prepare o coração.'}
        </div>
        {Ep.sceneVideo ? (
          // Until the student presses play the scene is a clean poster (its first frame) with one play
          // button in the middle: no native control bar, no caption over the picture and no loading
          // spinner. The native controls appear once it plays.
          <div class="pl-video">
            {/* biome-ignore lint/a11y/useMediaCaption: the scene has no caption track yet; the dialogue is in Take It In */}
            <video
              src={Ep.sceneVideo}
              controls={P.vid}
              playsInline
              preload="metadata"
              onEnded={onVideoEnd}
              onLoadedMetadata={(ev) => a.vidMeta(ev.currentTarget.duration)}
            />
            {P.vid ? null : (
              <button
                type="button"
                class="pl-vplay"
                aria-label="Assistir à cena"
                onClick={(ev) => {
                  const v = ev.currentTarget.parentElement?.querySelector('video') ?? null;
                  tap(() => a.vidStart(v))(ev);
                }}
              >
                <span class="pl-vbar">
                  <span class="pl-vbtn">
                    <Icon name="play" size={22} />
                  </span>
                  <span class="pl-vlbl">Assistir à cena</span>
                </span>
              </button>
            )}
          </div>
        ) : (
          <div class="scene">
            <div class="img" style={{ backgroundImage: still ? `url(${still})` : undefined }} />
            <div class="sub">
              <span class="ptl">{Ep.sceneNote}</span>
            </div>
          </div>
        )}
        <div class="lbl mt8">Vocabulário visual · toque para ouvir</div>
        <div class="grid2 pl-vocab">
          {Ep.visual.map((v, i) => (
            <button
              type="button"
              key={v.id ?? i}
              class="card row pl-vcard"
              onClick={tap(() => a.say(v.en))}
              style={{ '--gap': '12px', padding: '12px 14px' }}
            >
              <span class="sayico">
                <Icon name="speaker" size={18} />
              </span>
              <span class="grow" style={{ minWidth: '0' }}>
                <span class="en" style={{ display: 'block' }}>
                  {v.en}
                </span>
                <span class="sm" style={{ display: 'block' }}>
                  {v.pt}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p class="sm pl-note">
          <Icon name="cards" size={16} />
          <span>Ao seguir para a próxima etapa, estas palavras entram nos seus Flashcards.</span>
        </p>
      </>
    ),
  };
}

// ---------- 4 · Take It In (dock fixo; só as falas rolam) ----------

const SPEEDS = [0.75, 1, 1.25] as const;

function Dialog({ Ep, cat, P, desk, a, tap }: StepCtx): StepOut {
  const spoken = Ep.dialog.filter((d) => !d.stage).length;
  const pct = Ep.dialog.length ? Math.round(((P.line + (P.playing ? 1 : 0)) / Ep.dialog.length) * 100) : 0;
  // Spoken lines already passed (the line being spoken counts): "3 de 15 falas" beside the track.
  const past = Ep.dialog.slice(0, P.line + (P.playing ? 1 : 0)).filter((d) => !d.stage).length;
  const progress = (
    <div class={`row pl-dtrack ${desk ? 'grow' : ''}`} style={{ '--gap': '10px' }}>
      <div class="bar pl-dprog grow">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span class="pl-dcount">
        <b>{past}</b>
        {` de ${spoken} falas`}
      </span>
    </div>
  );
  return {
    dock: (
      <div class="stack" style={{ '--gap': '8px' }}>
        <div class="row" style={{ '--gap': '10px' }}>
          <button
            type="button"
            class={`playbtn${P.playing ? '' : ' navy'}`}
            onClick={tap(a.play)}
            aria-label="Tocar diálogo"
            style={{ width: '48px', height: '48px' }}
          >
            {playIco(P.playing)}
          </button>
          <div class={desk ? '' : 'grow'} style={desk ? { flex: 'none', minWidth: '150px' } : undefined}>
            <div class="h3" style={{ fontSize: '.95rem' }}>
              {P.playing ? 'Tocando' : 'Ouvir tudo'}
            </div>
            <div class="xs">{P.playing ? 'rolagem automática' : 'ou toque numa fala'}</div>
          </div>
          {desk ? progress : null}
          <div class="seg">
            {SPEEDS.map((v) => (
              <button type="button" key={v} class={P.speed === v ? 'on' : ''} onClick={tap(() => a.speed(v))}>
                {`${String(v).replace('.', ',')}×`}
              </button>
            ))}
          </div>
        </div>
        {/* Phone: the progress runs under the controls, the full width of the dock. */}
        {desk ? null : progress}
      </div>
    ),
    body: (
      <>
        <div>
          <div class="lbl">{Ep.dialogTitle}</div>
          <p class="p mt4">{Ep.dialogSub}</p>
        </div>
        <div class="stack" style={{ '--gap': '6px' }}>
          {Ep.dialog.map((d, i) => (
            <button
              type="button"
              key={d.id ?? i}
              class={`dialog-line${i === P.line ? ' on' : ''}${d.stage ? ' stage' : ''}`}
              onClick={tap(() => a.line(i))}
              id={`dl${i}`}
              // tie.css's app-root `.stage { min-height: 100dvh }` also matches stage directions: in the
              // prototype "(the doorbell rings)" was a full screen tall. Keep it a normal line.
              style={d.stage ? { minHeight: '0' } : undefined}
            >
              {d.who ? (
                <div class="who pl-who">
                  <i style={{ background: castColor(Ep, cat, d.who) }} />
                  {d.who.toUpperCase()}
                </div>
              ) : null}
              {d.stage ? (
                // A stage direction is not a line anyone says: one centred band, English · Portuguese.
                <div class="pl-stagex">
                  <div class="en">{d.en}</div>
                  <div class="pt">{d.pt}</div>
                </div>
              ) : (
                <div class={desk ? 'grid' : 'stack'} style={{ '--gap': '3px' }}>
                  <div class="en">{d.en}</div>
                  <div class="pt">{d.pt}</div>
                </div>
              )}
              {d.err || d.hook ? <div class={`note${d.err ? ' err' : ''}`}>{d.err || d.hook}</div> : null}
            </button>
          ))}
        </div>
      </>
    ),
  };
}

// ---------- 5 · Take the Mic (gravar) ----------

function Mic({ Ep, s, P, training, a, tap }: StepCtx): StepOut {
  const m = Ep.mic[P.micIdx];
  if (!m) return { body: <></> };
  const sc = s.scores[m.id];
  const fbObj: MicFeedback | null = P.fb || (sc != null ? { score: sc, praise_pt: m.fb, issues: [] } : null);
  const status = P.micHear
    ? 'Ouça a frase…'
    : P.mic === 'rec'
      ? 'Fale agora · toque para parar'
      : P.mic === 'busy'
        ? 'Avaliando…'
        : fbObj
          ? 'Toque no microfone para tentar de novo'
          : 'Toque no microfone e fale · +5 a +15';
  // Training mode hides the score: the card is neutral too (green/blue would give the score away).
  const hidden = training && !P.showScore;
  const fbText = fbObj ? (
    <span class="sm pl-fbt" style={{ color: 'var(--navy)' }}>
      {fbObj.praise_pt || m.fb}
      {fbObj.heard ? (
        <>
          <br />
          {`Entendi: “${fbObj.heard}”`}
        </>
      ) : null}
      {fbObj.issues.map((x, i) => (
        <Fragment key={i}>
          <br />
          <b>{x.word}:</b> {x.tip_pt}
        </Fragment>
      ))}
    </span>
  ) : null;
  const fb =
    fbObj && P.mic !== 'rec' && P.mic !== 'busy' ? (
      hidden ? (
        // Score hidden. Desktop: the text in its own column, "Ver nota" centred on the right. Phone: a
        // head row ("Modo treino · nota escondida" + "Ver nota"), the text under it at full width.
        <div class="fb tip pop pl-fb pl-fbh" style={{ padding: '10px 12px' }}>
          <div class="pl-fbhd">
            <span class="pl-fbk">Nota escondida</span>
            <button
              type="button"
              class="pl-reveal"
              onClick={tap(a.showScore)}
              aria-label="Ver nota (escondida no modo treino)"
            >
              <Icon name="eye" size={18} />
              <span>Ver nota</span>
            </button>
          </div>
          {fbText}
        </div>
      ) : (
        <div
          class={`fb ${fbObj.score >= 8 ? 'ok' : 'fix'} row pop pl-fb`}
          style={{ '--gap': '12px', alignItems: 'flex-start', padding: '10px 12px' }}
        >
          <span class="num" style={{ fontSize: '1.6rem', lineHeight: '1', flex: 'none' }}>
            {fbObj.score}
            <span class="xs muted">/10</span>
          </span>
          {fbText}
        </div>
      )
    ) : null;
  return {
    dock: (
      <div class="card stack" style={{ '--gap': '8px', padding: '14px 16px' }}>
        <div class="lbl">
          Frase {P.micIdx + 1} de {Ep.mic.length} · diga em voz alta
        </div>
        <div class="row" style={{ '--gap': '12px' }}>
          <div class="grow stack" style={{ '--gap': '4px' }}>
            <div class="h2">{m.en}</div>
            {m.tip ? (
              <div class="sm">
                <b>Dica de boca:</b> {m.tip}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            class={`mic${P.mic === 'rec' ? ' rec' : ''}`}
            onClick={tap(a.record)}
            aria-label="Gravar"
            style={{ width: '60px', height: '60px' }}
          >
            <Icon name={P.mic === 'rec' ? 'stop' : 'mic'} size={28} />
          </button>
        </div>
        {P.micOpen ? null : fb}
      </div>
    ),
    // Hear → "Fale agora" → score: a phrase card opens this, plays the phrase and starts recording when it
    // ends. The score stays on the card once the modal closes.
    modal: P.micOpen ? (
      <div class="overlay">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim mirrors the close button for pointer users */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the modal's close button is the keyboard path */}
        <div class="scrim" onClick={tap(a.micClose)} />
        <div class="sheet pl-micm" role="dialog" aria-modal="true" aria-label={`Frase ${P.micIdx + 1}: ${m.en}`}>
          <div class="grab" />
          <div class="row between top">
            <div class="lbl">
              Frase {P.micIdx + 1} de {Ep.mic.length}
            </div>
            <button type="button" class="iconbtn pl-micx" onClick={tap(a.micClose)} aria-label="Fechar">
              <Icon name="close" size={18} />
            </button>
          </div>
          <div class="stack tc" style={{ '--gap': '6px' }}>
            <div class="h2">{m.en}</div>
            {m.tip ? (
              <div class="sm">
                <b>Dica de boca:</b> {m.tip}
              </div>
            ) : null}
          </div>
          <div class="stack pl-micc" style={{ '--gap': '12px' }}>
            <button
              type="button"
              class={`mic pl-micbig${P.mic === 'rec' ? ' rec' : ''}${P.micHear ? ' hear' : ''}`}
              onClick={tap(a.record)}
              aria-label={P.mic === 'rec' ? 'Parar' : 'Gravar'}
              aria-pressed={P.mic === 'rec'}
              disabled={P.mic === 'busy'}
            >
              <Icon name={P.micHear ? 'speaker' : P.mic === 'rec' ? 'stop' : 'mic'} size={36} />
            </button>
            <div
              class={`waves mini pl-waves${P.mic === 'rec' ? ' rec' : P.mic === 'done' || fbObj ? ' done' : ''}`}
              aria-hidden="true"
            >
              {Array.from({ length: 22 }, (_, i) => (
                <i key={i} style={{ height: `${8 + ((i * 7) % 17)}px`, animationDelay: `${i * 0.05}s` }} />
              ))}
            </div>
            <div class={`pl-mics${P.mic === 'rec' ? ' rec' : ''}`} role="status" aria-live="polite">
              {status}
            </div>
          </div>
          {fb}
          {P.mic === 'done' ? (
            <div class="row pl-micact" style={{ '--gap': '10px' }}>
              <button type="button" class="btn light" onClick={tap(() => a.micPick(P.micIdx))}>
                <Icon name="speaker" size={18} />
                <span>Ouvir e repetir</span>
              </button>
              {P.micIdx < Ep.mic.length - 1 ? (
                <button type="button" class="btn" onClick={tap(() => a.micPick(P.micIdx + 1))}>
                  <span>Próxima frase</span>
                  <Icon name="next" size={18} />
                </button>
              ) : (
                <button type="button" class="btn" onClick={tap(a.micClose)}>
                  <span>Concluir</span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    ) : undefined,
    body: (
      <>
        <div class="stack" style={{ '--gap': '6px' }}>
          {Ep.mic.map((x, i) => {
            const v = s.scores[x.id];
            return (
              <button
                type="button"
                key={x.id}
                class="card row"
                onClick={tap(() => a.micPick(i))}
                style={{
                  '--gap': '10px',
                  padding: '12px 14px',
                  ...(i === P.micIdx ? { borderColor: 'var(--navy)', borderWidth: '2px' } : {}),
                }}
              >
                <span class={`pl-micsp${P.micHear && i === P.micIdx ? ' on' : ''}`}>
                  <Icon name="speaker" size={18} />
                  <span class="pl-sr">Ouvir e gravar: </span>
                </span>
                <span class="h3 grow" style={{ fontSize: '1rem' }}>
                  {x.en}
                </span>
                {v != null && hidden ? (
                  // Recorded, score hidden: one neutral mark for every phrase.
                  <span class="pl-recd" title="Gravada">
                    <Icon name="check" size={14} />
                  </span>
                ) : (
                  <span
                    class="num"
                    style={{
                      fontSize: '1rem',
                      color: v == null ? 'var(--muted)' : v >= 8 ? 'var(--green)' : 'var(--blue)',
                    }}
                  >
                    {v == null ? '—' : `${v}/10`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p class="sm pl-note">
          <Icon name="bulb" size={16} />
          <span>A nota mede quanto da sua fala foi entendida, não quanto você soa americano.</span>
        </p>
      </>
    ),
  };
}

// ---------- 6 · Take a Lesson ----------

/** Scrolls Take a Lesson to its i-th block (the cards Blocks renders, then the pronunciation card). */
function toBlock(i: number): void {
  const cards = document.querySelectorAll<HTMLElement>('.pl-s7 > .card:not(.pl-toc)');
  cards[i]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** "hi /haɪ/" → the word and its IPA, so the transcription gets a font that has the IPA glyphs. */
function PairWord({ t, cls }: { t: string; cls: string }) {
  const m = /^(.*?)\s*(\/[^/]+\/)\s*$/.exec(t);
  return (
    <span class={cls}>
      <b>{m ? m[1] : t}</b>
      {m ? <span class="pl-ipa">{m[2]}</span> : null}
    </span>
  );
}

function Lesson({ Ep, desk, a, tap }: StepCtx): StepOut {
  const pr = Ep.pron;
  // "Nesta lição": one entry per block, so a long lesson has a visible outline and a way to jump
  // (desktop: an even two-column index; phone: a folded one-line summary that opens the list, so the
  // outline does not push the lesson a screen down).
  const toc = Ep.lesson.map((b, i) => {
    const m = /^\s*(\d+)\s*·\s*(.+)$/.exec(b.k);
    return { n: m ? m[1] : String(i + 1), t: sentenceCase((m ? m[2] : b.k) ?? '') };
  });
  // Desktop: the blocks fill an even two-column grid and "Pronúncia" is a pill in the head (a lone
  // full-width last entry unbalanced the grid). Phone: Pronúncia closes the list.
  const pronBtn = pr ? (
    <button type="button" class="pl-tocpr" onClick={tap(() => toBlock(toc.length))}>
      <Icon name="speaker" size={14} />
      <span>Pronúncia</span>
    </button>
  ) : null;
  const entries = (
    <div class="pl-tocl">
      {toc.map((x, i) => (
        <button type="button" key={i} class="pl-tocb" onClick={tap(() => toBlock(i))}>
          <span class="num pl-tocn">{x.n}</span>
          <span>{x.t}</span>
        </button>
      ))}
      {pr && !desk ? (
        <button type="button" class="pl-tocb" onClick={tap(() => toBlock(toc.length))}>
          <span class="num pl-tocn">
            <Icon name="speaker" size={14} />
          </span>
          <span>Pronúncia</span>
        </button>
      ) : null}
    </div>
  );
  const parts = `${toc.length} blocos${pr ? ' e pronúncia' : ''}`;
  return {
    body: (
      <>
        {toc.length > 2 ? (
          desk ? (
            <nav class="card stack pl-toc" style={{ '--gap': '10px' }} aria-label="Nesta lição">
              <div class="row between" style={{ '--gap': '10px' }}>
                <div class="lbl or">Nesta lição</div>
                {pronBtn}
              </div>
              {entries}
            </nav>
          ) : (
            <details class="card pl-toc pl-tocd">
              <summary>
                <span class="pl-tocico" aria-hidden="true">
                  <Icon name="list" size={18} />
                </span>
                <span class="grow pl-tocst">
                  <span class="lbl or">Nesta lição</span>
                  <span class="pl-tocsub">{parts}</span>
                </span>
                <span class="pl-tocchev" aria-hidden="true">
                  <Icon name="down" size={18} />
                </span>
              </summary>
              <nav aria-label="Nesta lição">{entries}</nav>
            </details>
          )
        ) : null}
        <Blocks list={Ep.lesson} badLabel="EVITE" />
        {pr ? (
          <div class="card navy stack" style={{ '--gap': '12px' }}>
            <div class="lbl" style={{ color: 'var(--onNavy)' }}>
              {pr.k}
            </div>
            {pr.parts.map((pp, i) => (
              <p key={i} class="p">
                <b>{pp.b}</b> {pp.t}
              </p>
            ))}
            {pr.pairs?.length ? (
              <div class="pl-pairs">
                {/* Minimal pairs: with /h/ ≠ without /h/, both sides weighted alike, the gloss under them. */}
                {pr.pairs.map((pa, i) => (
                  <div key={i} class="pl-pair">
                    <PairWord t={pa.a} cls="pl-pa" />
                    <span class="pl-vs" aria-hidden="true">
                      ≠
                    </span>
                    <PairWord t={pa.b} cls="pl-pb" />
                    <span class="pl-gloss">{pa.c}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div class="chips pl-words">
              {pr.words.map((w) => (
                <button
                  type="button"
                  key={w}
                  class="chip"
                  onClick={tap(() => a.say(w))}
                  style={{ background: '#fff', color: 'var(--navy)', borderColor: '#fff' }}
                >
                  <Icon name="play" size={12} />
                  {w}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </>
    ),
  };
}

// ---------- 7 · Take Away ----------

const heardCls = (t: string) => (heard.has(t) ? ' heard' : '');

/**
 * Desktop keyword grid: the column count (5 down to 3) whose last row is full or at least half full,
 * so no chip is left alone on a row ("ready" was, as the 16th of 16).
 */
function wordCols(n: number, max: number, min: number): number {
  for (let c = max; c >= min; c--) if (n % c === 0 || n % c >= Math.ceil(c / 2)) return Math.min(c, n);
  return min;
}

function Away({ Ep, desk, a, tap }: StepCtx): StepOut {
  // Keywords in even rows on both layouts (desktop: 5 down to 3 columns; phone: 3), a short last row
  // centred.
  const cols = desk ? wordCols(Ep.awayWords.length, 5, 3) : Math.min(3, Ep.awayWords.length || 1);
  const row = (x: StepCtx['Ep']['awayExp'][number], i: number) => (
    <button type="button" key={i} class={`listrow sayrow${heardCls(x.en)}`} onClick={tap(() => a.sayMark(x.en))}>
      <span class="sayico">
        <Icon name="speaker" size={16} />
      </span>
      <span class="grow pl-exp">
        {/* Phone: English and its translation share a line when they fit, the note under them. */}
        <span class="pl-expl">
          <span class="en">{x.en}</span>
          <span class="pt">{x.pt}</span>
        </span>
        {/* No usage note: the desktop column simply stays empty (a dash read as unfinished). */}
        {x.note ? <span class="pl-expn">{x.note}</span> : desk ? <span class="pl-expn" /> : null}
      </span>
    </button>
  );
  return {
    body: (
      <>
        <p class="p-read">
          Lista fechada. Toque para ouvir: o que você já ouviu fica azul. Ao seguir, as{' '}
          <span class="nw">expressões-chave</span> entram nos seus Flashcards.
        </p>
        <div class="card" style={{ padding: '6px 16px' }}>
          <div class="lbl or" style={{ padding: '12px 0 6px' }}>
            Expressões-chave
          </div>
          {/* Phone: English over its translation and note, left-aligned (the prototype pushed the
              translation to the far right and wrapped both mid-phrase). Desktop: one row per
              expression, English · translation · note in three aligned columns. */}
          {desk ? (
            <div class="pl-explist pl-exptab">
              <div class="pl-exphead" aria-hidden="true">
                <span>Inglês</span>
                <span>Tradução</span>
                <span>Quando usar</span>
              </div>
              {Ep.awayExp.map(row)}
            </div>
          ) : (
            <div class="pl-explist">{Ep.awayExp.map(row)}</div>
          )}
        </div>
        <div class="card stack" style={{ '--gap': '10px' }}>
          <div class="lbl or">Palavras-chave</div>
          <div class="chips pl-words8" style={{ '--cols': String(cols) }}>
            {Ep.awayWords.map((w) => (
              <button type="button" key={w} class={`pill saypill${heardCls(w)}`} onClick={tap(() => a.sayMark(w))}>
                <Icon name="speaker" size={14} />
                {w}
              </button>
            ))}
          </div>
        </div>
      </>
    ),
  };
}

// ---------- 8 · Take Action: uma pergunta por vez ----------

function Dots({ n, cur, w }: { n: number; cur: number; w: number }) {
  return (
    <div class="row" style={{ '--gap': '5px' }}>
      {Array.from({ length: n }, (_, i) => (
        <i
          key={i}
          style={{
            height: '7px',
            borderRadius: '4px',
            display: 'block',
            width: `${i === cur ? w : 7}px`,
            background: i === cur ? 'var(--orange)' : i < cur ? 'var(--blue)' : 'var(--line2)',
          }}
        />
      ))}
    </div>
  );
}

function Action({ Ep, cat, s, P, desk, a, tap }: StepCtx): StepOut {
  if (!Ep.ex.length) return { body: <></> };
  // Opens on the first unanswered question.
  if (P.itIdx == null) {
    let at: [number, number] = [0, 0];
    outer: for (let x = 0; x < Ep.ex.length; x++) {
      const items = Ep.ex[x]?.items ?? [];
      for (let j = 0; j < items.length; j++) {
        if (s.exAns[items[j]?.id ?? ''] == null) {
          at = [x, j];
          break outer;
        }
      }
    }
    P.exIdx = at[0];
    P.itIdx = at[1];
  }
  const ex = Ep.ex[P.exIdx] ?? Ep.ex[0];
  if (!ex) return { body: <></> };
  const itIdx = Math.min(P.itIdx, ex.items.length - 1);
  const it = ex.items[itIdx];
  if (!it) return { body: <></> };
  const ans = s.exAns[it.id];
  const answered = ans != null;
  const ok = ans === it.a;
  const right = ex.items.filter((x) => s.exAns[x.id] === x.a).length;
  const seen = ex.items.filter((x) => s.exAns[x.id] != null).length;
  const lastIt = itIdx === ex.items.length - 1;
  const end = lastIt && P.exIdx === Ep.ex.length - 1;
  const hasAudio = ex.audio === 'tts' || ex.audio === 'song';
  const nextName = cat.steps[STEP.SING - 1]?.name ?? '';
  const all = Ep.ex.flatMap((x) => x.items);
  const totalAll = all.length;
  const answeredAll = all.filter((x) => s.exAns[x.id] != null).length;
  // Desktop answers side by side only in even pairs that fit their column on one line (four in two
  // rows of two, or two side by side); three answers, or longer ones, stay one per line (three in a
  // row looked squeezed).
  const longest = Math.max(0, ...it.opts.map((o) => o.length));
  const optCols = desk && (it.opts.length === 4 || it.opts.length === 2) && longest <= 28 ? 2 : 1;
  return {
    body: (
      <>
        <div class="row between" style={{ '--gap': '10px' }}>
          <div class="h3">
            Exercício {P.exIdx + 1} de {Ep.ex.length} ·{' '}
            <span class="muted" style={{ fontWeight: '600' }}>
              {ex.kind}
            </span>
          </div>
          <Dots n={Ep.ex.length} cur={P.exIdx} w={22} />
        </div>
        <div>
          <div class="h2">{ex.title}</div>
          {ex.intro ? <p class="p mt8">{ex.intro}</p> : null}
        </div>
        {hasAudio ? (
          <Btn label={ex.audioLabel || 'Ouvir'} kind="navy compact" onClick={a.exAudio} icon="speaker" />
        ) : null}
        {/* Keyed by item: a new question mounts a new card, so `pop` plays as in the prototype. */}
        <div key={it.id} class="card stack pop" style={{ '--gap': '12px' }}>
          <div class="row between">
            <span class="lbl">
              {`Pergunta ${itIdx + 1} de ${ex.items.length}${seen ? ` · ${right}/${seen} certas` : ''}`}
            </span>
            <Dots n={ex.items.length} cur={itIdx} w={16} />
          </div>
          <div class="h2 pl-q">{it.q}</div>
          <div
            class={`stack pl-opts${optCols > 1 ? ' pl-optrow' : ''}`}
            style={optCols > 1 ? { gridTemplateColumns: `repeat(${optCols}, minmax(0, 1fr))` } : { '--gap': '8px' }}
          >
            {it.opts.map((o, i) => (
              <button
                type="button"
                key={i}
                class={`opt${answered && i === it.a ? ' right' : answered && i === ans ? ' wrong' : ''}`}
                disabled={answered}
                onClick={answered ? undefined : tap(() => a.ex(it.id, i))}
              >
                <span class="key">{'ABCD'[i]}</span>
                <span>{o}</span>
              </button>
            ))}
          </div>
          {answered ? (
            <div class={`fb ${ok ? 'ok' : 'err'}`}>
              {(ok ? 'Isso. +5 pontos.' : `Quase. A resposta é “${it.opts[it.a] ?? ''}”.`) +
                (it.fix ? ` ${it.fix}` : '')}
            </div>
          ) : null}
        </div>
        {/* "Anterior" is a quiet secondary button (a third of the row on desktop, its own width on a
            phone) and the next button takes the rest, so the forward action leads. */}
        <div class="pl-exnav">
          {P.exIdx || itIdx ? (
            <Btn label="Anterior" kind="light compact" cls="pl-exprev" onClick={() => a.exGo(-1)} icon="back" />
          ) : (
            <span />
          )}
          {end ? (
            <span class="sm tc" style={{ fontWeight: '700', alignSelf: 'center' }}>
              Última pergunta. Siga para {nextName} abaixo.
            </span>
          ) : (
            <Btn
              label={lastIt ? 'Próximo exercício' : 'Próxima pergunta'}
              kind={`${answered ? '' : 'ghost'} compact`}
              onClick={() => a.exGo(1)}
              iconR="next"
            />
          )}
        </div>
        {Ep.ex.length > 1 ? (
          <div class="stack mt8" style={{ '--gap': '10px' }}>
            <div class="row between" style={{ '--gap': '10px' }}>
              <div class="lbl">Exercícios desta etapa</div>
              <span class="pl-count">
                <b>{answeredAll}</b>
                {` de ${totalAll} respondidas`}
              </span>
            </div>
            <div class="pl-exlist">
              {Ep.ex.map((x, i) => {
                const n = x.items.length;
                const got = x.items.filter((y) => s.exAns[y.id] != null).length;
                const ok2 = x.items.filter((y) => s.exAns[y.id] === y.a).length;
                return (
                  <button
                    type="button"
                    key={x.title + i}
                    class={`card${i === P.exIdx ? ' cur' : ''}`}
                    aria-current={i === P.exIdx ? 'true' : undefined}
                    onClick={tap(() => a.exPick(i))}
                  >
                    <span class="num">{i + 1}</span>
                    <span class="grow" style={{ minWidth: '0' }}>
                      <span class="h3" style={{ display: 'block', fontSize: '1rem' }}>
                        {x.title}
                      </span>
                      <span class="xs" style={{ display: 'block' }}>
                        {x.kind}
                        {got ? ` · ${ok2}/${got} certas` : ''}
                      </span>
                    </span>
                    {got === n ? (
                      <span class="pill gr">
                        <Icon name="check" size={12} />
                        Feito
                      </span>
                    ) : (
                      <span class={`pill pl-expill${got ? ' bl' : ''}`}>{`${got}/${n}`}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </>
    ),
  };
}

/** STEP[n](Ep, s): the body (and dock) of step n. */
export function renderStep(c: StepCtx, onVideoEnd: () => void): StepOut {
  switch (c.step) {
    case STEP.SONG:
    case STEP.SING:
      return Song(c);
    case STEP.INTRO:
      return Intro(c);
    case STEP.LOOK:
      return Look(c, onVideoEnd);
    case STEP.DIALOG:
      return Dialog(c);
    case STEP.MIC:
      return Mic(c);
    case STEP.LESSON:
      return Lesson(c);
    case STEP.AWAY:
      return Away(c);
    case STEP.TEST:
      return TestStep(c);
    default:
      return Action(c);
  }
}
