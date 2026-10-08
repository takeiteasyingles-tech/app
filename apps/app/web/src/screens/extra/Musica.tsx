// EXTRA music (TIE.screens.musica): an album's tracks as karaoke. The episode recording plays when
// there is one (lines follow its time), otherwise the synth backing track (lines follow the beat).
// "Completar a letra" blanks one word per line with three options; picks are graded by
// /api/karaoke/gap (+ex_right) and the end of a song awards `song`.
import type { Album, Track } from '@tie/shared/content/schema';
import { activator, Icon, Topbar } from '@tie/ui';
import { useEffect, useRef } from 'preact/hooks';
import { synth } from '../../core/sound';
import { type ScreenProps, useChrome } from '../../frame';
import { replace } from '../../router';
import { gameEvent, pickKaraokeGap } from '../../store/actions';
import { showToast } from '../../store/award';
import { isDesktop, pts, shuffle, useCatalog, useRerender } from './data';
import { LoadFailed, OnNavy } from './parts';

/** The prototype's K. */
interface KState {
  id: string;
  tr: number;
  line: number;
  playing: boolean;
  gap: boolean;
  picks: Record<string, string>;
  opts: Record<string, string[]>;
  right: number;
  timer?: ReturnType<typeof setInterval>;
  audio?: HTMLAudioElement | null;
}

const kfresh = (id: string): KState => ({
  id,
  tr: 0,
  line: -1,
  playing: false,
  gap: false,
  picks: {},
  opts: {},
  right: 0,
});

const stripGap = (g: string): string => g.replace(/[.,!?]/g, '');
const reEsc = (s: string): string => s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');

/** gapOpts(tr, i): the right word and two other gaps of the track, shuffled. */
function gapOpts(tr: Track, i: number): string[] {
  const right = stripGap(tr.lines[i]?.gap ?? '');
  const others = shuffle(
    tr.lines.map((l) => stripGap(l.gap)).filter((g) => g.toLowerCase() !== right.toLowerCase()),
  ).slice(0, 2);
  return shuffle([right, ...others]);
}

/** Splits a lyric at its gap word (case-insensitive, ’ and ' interchangeable), like the prototype's regex. */
function splitAtGap(en: string, gap: string): [string, string] | null {
  if (!gap) return null;
  const re = new RegExp(`\\b${reEsc(gap).replace(/[’']/g, '.')}\\b`, 'i');
  const m = re.exec(en);
  if (!m) return null;
  return [en.slice(0, m.index), en.slice(m.index + m[0].length)];
}

const act = (fn: () => void) => activator(undefined, fn);

export default function Musica({ params }: ScreenProps) {
  // Full screen like the prototype (no tab bar / side nav: the registry's chrome).
  useChrome({ title: 'Música' });
  const id = params.id ?? '';
  const { c, failed, retry } = useCatalog();
  const k: Album | null = c?.albums.find((a) => a.id === id) ?? null;
  const missing = !!c && !k;
  useEffect(() => {
    if (missing) replace('extra');
  }, [missing]);
  const kre = useRerender();
  const ref = useRef<KState | null>(null);
  const kstop = () => {
    const K = ref.current;
    if (K?.audio) {
      K.audio.pause();
      K.audio = null;
    }
    synth.stop();
    if (K) {
      K.playing = false;
      clearInterval(K.timer);
    }
  };
  if (!ref.current || ref.current.id !== id) {
    kstop();
    ref.current = kfresh(id);
  }
  const K = ref.current;

  // leave()
  useEffect(() => () => kstop(), []);

  // after(): keep the sung line in the middle of the screen.
  useEffect(() => {
    if (K.playing && K.line >= 0)
      document.getElementById(`ly${K.line}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [K.line, K.playing]);

  if (failed) {
    return (
      <OnNavy>
        <Topbar back="extra" />
        <div class="scroll">
          <LoadFailed onRetry={retry} />
        </div>
      </OnNavy>
    );
  }
  if (!c || !k?.tracks.length) return <OnNavy />;

  const tracks = k.tracks;
  const tr = (tracks[K.tr] ?? tracks[0]) as Track;

  const songDone = (t: Track) => {
    if (t.lines.length) void gameEvent('song', t.id);
  };
  const kPlay = () => {
    if (K.playing) {
      kstop();
      return kre();
    }
    K.playing = true;
    K.line = 0;
    if (tr.audio) {
      const audio = new Audio(tr.audio);
      K.audio = audio;
      audio.addEventListener('timeupdate', () => {
        if (ref.current !== K || K.audio !== audio || !tr.lines.length) return;
        const n = Math.min(
          tr.lines.length - 1,
          Math.floor((audio.currentTime / (audio.duration || 1)) * tr.lines.length),
        );
        if (n !== K.line) {
          K.line = n;
          kre();
        }
      });
      audio.addEventListener('ended', () => {
        if (ref.current !== K || K.audio !== audio) return;
        K.playing = false;
        K.audio = null;
        songDone(tr);
        kre();
      });
      audio.play().catch(() => {});
    } else {
      const bpm = tr.bpm || 110;
      const beat = (60 / bpm) * 1000 * 8;
      synth.play({ bpm, key: tr.key || 0 });
      K.timer = setInterval(() => {
        if (ref.current !== K) return;
        if (K.line >= tr.lines.length - 1) {
          kstop();
          songDone(tr);
        } else K.line++;
        kre();
      }, beat);
    }
    kre();
  };
  const kSel = (i: number) => {
    kstop();
    K.tr = i;
    K.line = -1;
    kre();
  };
  const kTrack = (d: number) => {
    kstop();
    K.tr = (K.tr + d + tracks.length) % tracks.length;
    K.line = -1;
    kre();
  };
  const kGapMode = () => {
    K.gap = !K.gap;
    kre();
  };
  const kGap = (w: string) => {
    const line = K.line;
    const right = stripGap(tr.lines[line]?.gap ?? '');
    const ok = w.toLowerCase() === right.toLowerCase();
    K.picks[`${K.tr}-${line}`] = right;
    if (ok) K.right++;
    else showToast(`Era “${right}”. Segue o próximo verso.`);
    kre();
    // Graded again on the server: a right pick awards ex_right (+5), a wrong one plays the soft sfx.
    void pickKaraokeGap(tr.id, line, w);
  };

  const desk = isDesktop();
  const n = tr.lines.length;
  const exRight = pts(c, 'ex_right', 5);
  // A line sung twice in a row (a chorus) shows once with "×2"; the repeat appears while it is sung.
  const repeatOf = (i: number): boolean => i > 0 && tr.lines[i]?.en === tr.lines[i - 1]?.en;
  const repeats = (i: number): number => {
    let r = 1;
    while (repeatOf(i + r)) r++;
    return r;
  };

  const gapBtn = (
    <button type="button" class={`chip x-gapbtn${K.gap ? ' on' : ''}`} aria-pressed={K.gap} onClick={act(kGapMode)}>
      <span class="ck">{K.gap ? <Icon name="check" size={12} /> : null}</span>
      Completar a letra
      <span class="x-gapnote">{`+${exRight} por acerto`}</span>
    </button>
  );

  const player = (
    <div class="card stack" style={{ '--gap': '14px' }}>
      <div class="x-head">
        {desk ? null : <img class="x-cover" src={k.img ?? ''} alt="" />}
        <div class="grow">
          <div class="h2" style={{ color: '#fff' }}>
            {tr.title}
          </div>
          <div class="xs" style={{ textWrap: 'balance' }}>
            {`${tr.from}${tr.audio ? ' · gravação do episódio' : ' · trilha sintetizada'}`}
          </div>
        </div>
      </div>
      <div class="x-prog">
        <div class="segs" aria-hidden="true">
          {tr.lines.map((_, i) => (
            <i key={i} class={i < K.line ? 'done' : i === K.line ? 'now' : ''} />
          ))}
        </div>
        <div class="xs">
          <span>{K.line >= 0 ? `Verso ${K.line + 1} de ${n}` : `${n} versos`}</span>
          <span>{`Faixa ${K.tr + 1} de ${tracks.length}`}</span>
        </div>
      </div>
      <div class="controls">
        <button type="button" class="iconbtn" aria-label="Anterior" onClick={act(() => kTrack(-1))}>
          <Icon name="back" size={20} />
        </button>
        <button type="button" class="playbtn" aria-label="Tocar" onClick={act(kPlay)}>
          <Icon name={K.playing ? 'pause' : 'play'} size={24} />
        </button>
        <button type="button" class="iconbtn" aria-label="Próxima" onClick={act(() => kTrack(1))}>
          <Icon name="next" size={20} />
        </button>
        {/* Desktop: the gap switch closes the controls row, as in the prototype. */}
        {desk ? (
          <>
            <span class="grow" />
            {gapBtn}
          </>
        ) : null}
      </div>
      {desk ? null : gapBtn}
    </div>
  );

  const faixas = (
    <div class="stack" style={{ '--gap': '6px' }}>
      <div class="lbl x-lbl">Faixas</div>
      {tracks.map((t, i) => (
        <button type="button" key={t.id} class={`line${i === K.tr ? ' on' : ''}`} onClick={act(() => kSel(i))}>
          <div class="who">{`FAIXA ${i + 1}`}</div>
          <div class="en">{t.title}</div>
          <div class="pt">{t.from}</div>
        </button>
      ))}
    </div>
  );

  return (
    <OnNavy cls="x-mus" w={1100}>
      <Topbar back="extra" kicker={`EXTRA · Música · ${k.level}`} title={k.title} />
      <div class="scroll">
        <div class="wrap" style={{ '--wrap': '1100px' }}>
          {/* Desktop: album art and the track list | the player and the lyrics. */}
          <div class="x-mus-grid">
            {desk ? (
              <div class="x-mus-col">
                <img class="x-cover x-art" src={k.img ?? ''} alt="" />
                {faixas}
              </div>
            ) : null}
            <div class="x-mus-col">
              {player}
              {K.gap ? (
                <div class="fb tip" style={{ background: 'var(--navy2)', color: '#fff' }}>
                  Uma palavra some em cada verso. Escolha antes do verso acabar. Acertos: <b>{K.right}</b>
                  {` · +${exRight} cada`}
                </div>
              ) : null}
              <div class="stack x-lyr" style={{ '--gap': '6px' }}>
                <div class="lbl x-lbl">Letra</div>
                <div class="lyrics">
                  {tr.lines.map((l, i) => {
                    const on = i === K.line;
                    // The repeat of the line above stays folded into it unless it is the one being sung.
                    const folded = repeatOf(i) && !on;
                    const times = repeatOf(i) ? 1 : repeats(i);
                    const g = stripGap(l.gap);
                    const key = `${K.tr}-${i}`;
                    const picked = K.picks[key];
                    const parts = K.gap ? splitAtGap(l.en, g) : null;
                    let opts: string[] | null = null;
                    if (K.gap && on && !picked) {
                      K.opts[key] ??= gapOpts(tr, i);
                      opts = K.opts[key] ?? null;
                    }
                    return (
                      <div
                        key={key}
                        class={`lyric${on ? ' on' : ''}`}
                        id={`ly${i}`}
                        style={folded ? { display: 'none' } : undefined}
                      >
                        <div class="en">
                          {parts ? (
                            <>
                              {parts[0]}
                              <span class={`gap${picked ? ' filled' : ''}`}>{picked || '____'}</span>
                              {parts[1]}
                            </>
                          ) : (
                            l.en
                          )}
                          {times > 1 && K.line !== i + 1 ? <span class="pill x-rep">{`×${times}`}</span> : null}
                        </div>
                        <div class="pt">{l.pt}</div>
                        {opts ? (
                          <div class="chips mt8">
                            {opts.map((o, j) => (
                              <button type="button" key={j} class="chip" onClick={act(() => kGap(o))}>
                                {o}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              {desk ? null : faixas}
            </div>
          </div>
        </div>
      </div>
    </OnNavy>
  );
}
