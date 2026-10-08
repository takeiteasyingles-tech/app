// The 10 step bodies of the episode player (STEP[1..10] in prototipo/js/screens/player.js), with the
// prototype's exact markup, classes, inline styles and pt-BR copy so tie.css renders them the same.
import { need } from '@tie/shared/domain/gating';
import { Btn, Icon } from '@tie/ui';
import { type ComponentChildren, Fragment } from 'preact';
import { Blocks } from '../../ui-blocks/Blocks';
import { fmt, heard, lyricRows, type MicFeedback, pad2, type StepCtx, type StepOut } from './model';

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
 * The episode's cast. Phone: an even strip (avatar over name), one column per character (the
 * prototype's wrapping pills left a ragged 3 + 2). Desktop: a row of avatar + name pills, each as
 * wide as its name. Every avatar is navy; the character's colour (its dot in Take It In) is the ring.
 */
function CastStrip({ Ep, cat, desk, bare = false }: Pick<StepCtx, 'Ep' | 'cat' | 'desk'> & { bare?: boolean }) {
  const n = Ep.cast.length;
  // Up to 6 characters: one even row spread across the full width (phone: equal columns; desktop:
  // pills as wide as their names, spaced evenly from edge to edge). More than 6 wrap.
  const even = n > 0 && n <= 6;
  return (
    <div
      class={`pl-cast${even ? ' pl-even' : ''}${bare ? ' pl-bare' : ''}`}
      style={even ? { gridTemplateColumns: desk ? `repeat(${n}, auto)` : `repeat(${n}, minmax(0, 1fr))` } : undefined}
    >
      {Ep.cast.map((name) => {
        const c = cat.cast[name];
        return (
          <span key={name} class="pl-castm">
            <b class="pl-ava" style={{ '--c': castColor(Ep, cat, name) }}>
              {c?.initials ?? name.slice(0, 2).toUpperCase()}
            </b>
            <span class="pl-castn">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

// ---------- 1 · Abertura ----------

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

function Intro({ Ep, cat, P, desk, a, tap, homeBg }: StepCtx): StepOut {
  const has = !!Ep.introAudio;
  // "1 · O VERBO TO BE NA 1ª E 2ª PESSOA" → "O verbo to be na 1ª e 2ª pessoa" (numbered by the list).
  const topics = Ep.lesson.map((b) => sentenceCase(b.k.replace(/^\s*\d+\s*·\s*/, '').trim())).filter(Boolean);
  return {
    body: (
      <>
        <div class="now-card stack" style={{ '--gap': '16px', minHeight: '340px', justifyContent: 'space-between' }}>
          <div class="bgimg" style={{ backgroundImage: homeBg ? `url(${homeBg})` : undefined, opacity: '.3' }} />
          <div class="row between">
            <span class="kick">Abertura</span>
            <span class="pill pl-eppill">Ep. {pad2(Ep.num)}</span>
          </div>
          <div>
            <div class="h1" style={{ color: '#fff' }}>
              {Ep.title}
            </div>
            <p class="p mt8" style={{ color: 'var(--onNavy)' }}>
              {Ep.synopsis}
            </p>
          </div>
          <div class="stack" style={{ '--gap': '10px' }}>
            <button type="button" class="btn light" onClick={tap(a.play)} style={{ alignSelf: 'flex-start' }}>
              {playIco(P.playing)}
              <span>{has ? (P.playing ? 'Pausar a abertura' : 'Ouvir a abertura') : 'Ouvir a vinheta'}</span>
            </button>
            {has ? (
              <div class="row" style={{ '--gap': '10px' }}>
                <div class="bar grow">
                  <i id="pl-bar" style={{ width: `${P.aD ? Math.round((P.aT / P.aD) * 100) : 0}%` }} />
                </div>
                {/* The opening is a short sting: before it plays, "vinheta · 3 s" says so (a bare
                    "0:00 / 0:03" read like placeholder audio); while it plays, the clock. */}
                <span class="xs" id="pl-time" style={{ color: '#fff', whiteSpace: 'nowrap' }}>
                  {P.playing || P.aT > 0
                    ? clock(P.aT, P.aD)
                    : P.aD
                      ? `vinheta · ${Math.max(1, Math.round(P.aD))} s`
                      : 'vinheta'}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <p class="p-read">
          {has
            ? 'A mesma música volta no fim do episódio para você cantar junto.'
            : 'A música do episódio abre, marca e fecha a aula. Você ouve a abertura agora e canta junto no fim.'}
        </p>
        {topics.length || Ep.cast.length ? (
          <div class="card stack" style={{ '--gap': '14px' }}>
            {topics.length ? (
              <>
                <div class="lbl or">Neste episódio você aprende</div>
                <ol class="pl-topics">
                  {topics.map((t, i) => (
                    <li key={i}>
                      <span class="num">{i + 1}</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            {Ep.cast.length ? (
              <>
                <div
                  class="lbl"
                  style={topics.length ? { borderTop: '1.5px solid var(--line2)', paddingTop: '14px' } : undefined}
                >
                  Quem aparece
                </div>
                <CastStrip Ep={Ep} cat={cat} desk={desk} />
              </>
            ) : null}
          </div>
        ) : null}
      </>
    ),
  };
}

// ---------- 2 e 10 · Música (título, tradução, player e instrução fixos; só a letra rola) ----------

function Song({ Ep, s, P, step, a, tap }: StepCtx): StepOut {
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
            <div class="lbl">{step === 2 ? 'Música · 1ª passada' : 'Música · cante junto'}</div>
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
        {step === 10 ? (
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
        {step === 2 && !need(Ep, s, 2) ? (
          <NextCard icon="download" onClick={tap(a.next)}>
            <b class="pl-nextt">
              Próximo: baixar o <span class="nw">e-book {Ep.ebook}.</span>
            </b>
            <span class="sm pl-nexts">O download libera o episódio.</span>
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

// ---------- 3 · E-book ----------

function Ebook({ Ep, cat, s, P, a, tap }: StepCtx): StepOut {
  const busy = P.dl === 'busy';
  const nx = cat.steps[3];
  return {
    body: (
      <>
        <div class="card stack" style={{ '--gap': '12px' }}>
          <div class="row between">
            <span class="lbl">
              E-book {pad2(Ep.ebook)} · Episódios {Ep.ebookEps}
            </span>
            <span class="pill navy pl-pdf">
              <Icon name="book" size={14} />
              PDF
            </span>
          </div>
          <div class="h1">{Ep.ebookTitle}</div>
          <p class="p-read">{Ep.scope}</p>
          <div class="chips pl-inside">
            {['Diálogo bilíngue', 'Take Away', 'Exercícios', 'Gabarito'].map((t) => (
              <span key={t} class="pill">
                <Icon name="check" size={12} />
                {t}
              </span>
            ))}
          </div>
        </div>
        {s.ebooks[Ep.ebook] ? (
          <>
            <div class="card gr stack pl-ebdone" style={{ '--gap': '16px' }}>
              {/* The prototype's single success line, plus the actions it lacked (open / download again). */}
              <div class="row" style={{ '--gap': '12px' }}>
                <span class="iconbtn" style={{ background: 'var(--green)', color: '#fff', border: '0', flex: 'none' }}>
                  <Icon name="check" size={20} />
                </span>
                <span class="grow pl-ebok">
                  <b>E-book baixado.</b>
                  <span>O episódio está liberado.</span>
                </span>
              </div>
              <div class="pl-ebtns">
                <Btn label="Abrir no app" kind="green compact" icon="book" onClick={a.ebookOpen} />
                <Btn
                  label={busy ? 'Baixando…' : 'Baixar de novo'}
                  kind="light compact"
                  cls="pl-again"
                  icon="download"
                  onClick={a.download}
                />
              </div>
            </div>
            {nx ? (
              <NextCard icon="play" onClick={tap(a.next)}>
                <b class="pl-nextt">Próximo: {nx.name}</b>
                <span class="sm pl-nexts">{nx.pt}</span>
              </NextCard>
            ) : null}
          </>
        ) : (
          <Btn
            label={busy ? 'Baixando…' : `Baixar e-book ${Ep.ebook}`}
            onClick={a.download}
            icon="download"
            cls="block"
            kind={busy ? 'navy' : ''}
          />
        )}
      </>
    ),
  };
}

// ---------- 4 · Take a Look ----------

function Look({ Ep, cat, P, desk, a, tap, homeBg }: StepCtx, onVideoEnd: () => void): StepOut {
  const still = Ep.sceneImage || homeBg;
  return {
    body: (
      <>
        <div class="row between" style={{ '--gap': '10px' }}>
          <div class="lbl">Cena · Act 1</div>
          {Ep.sceneVideo && P.vD ? (
            <span class="pl-vdur">
              <Icon name="clock" size={14} />
              {fmt(P.vD)}
            </span>
          ) : null}
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
        {/* The cast sits straight on the page (a card around five names was heavy). */}
        {Ep.cast.length ? <CastStrip Ep={Ep} cat={cat} desk={desk} bare /> : null}
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
          <span>Ao seguir para a próxima etapa, estas palavras entram na sua Revisão.</span>
        </p>
      </>
    ),
  };
}

// ---------- 5 · Take It In (dock fixo; só as falas rolam) ----------

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

// ---------- 6 · Take the Mic (gravar) ----------

function Mic({ Ep, s, P, desk, training, a, tap }: StepCtx): StepOut {
  const m = Ep.mic[P.micIdx];
  if (!m) return { body: <></> };
  const sc = s.scores[m.id];
  const fbObj: MicFeedback | null = P.fb || (sc != null ? { score: sc, praise_pt: m.fb, issues: [] } : null);
  const status =
    P.mic === 'rec'
      ? 'Ouvindo… toque para parar'
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
        {/* Ouvir, then the take's waveform (grey: nothing recorded; orange and moving: recording;
            blue: a recorded take) and the status. On a phone the status drops under them. */}
        <div class={`row pl-microw${P.mic === 'rec' ? ' rec' : ''}`} style={{ '--gap': '12px' }}>
          <button type="button" class="btn light compact" onClick={tap(() => a.say(m.en))}>
            <Icon name="speaker" size={18} />
            <span>Ouvir</span>
          </button>
          <div
            class={`waves mini pl-waves${P.mic === 'rec' ? ' rec' : P.mic === 'done' || fbObj ? ' done' : ''}`}
            aria-hidden="true"
          >
            {Array.from({ length: desk ? 16 : 22 }, (_, i) => (
              <i key={i} style={{ height: `${8 + ((i * 7) % 17)}px`, animationDelay: `${i * 0.05}s` }} />
            ))}
          </div>
          <span class="sm grow pl-mics">{status}</span>
        </div>
        {fb}
      </div>
    ),
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
                <span class="num" style={{ color: 'var(--orange)', width: '20px' }}>
                  {i + 1}
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

// ---------- 7 · Take a Lesson ----------

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

// ---------- 8 · Take Away ----------

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
          <span class="nw">expressões-chave</span> entram na sua Revisão.
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

// ---------- 9 · Take Action: uma pergunta por vez ----------

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
  const nextName = cat.steps[9]?.name ?? '';
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
    case 1:
      return Intro(c);
    case 2:
    case 10:
      return Song(c);
    case 3:
      return Ebook(c);
    case 4:
      return Look(c, onVideoEnd);
    case 5:
      return Dialog(c);
    case 6:
      return Mic(c);
    case 7:
      return Lesson(c);
    case 8:
      return Away(c);
    default:
      return Action(c);
  }
}
