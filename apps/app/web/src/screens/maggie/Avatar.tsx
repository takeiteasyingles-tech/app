// Avatar do assistente do Mic em vídeo (port de prototipo/js/ui/avatar2d.js, TIE.avatar.mount):
// "idle" quando não está falando e, enquanto a voz sai, um de três clipes falando escolhido pelo
// humor da resposta: talk, talk-happy (elogio) ou talk-soft (correção, pensando). Sem clipes, as
// iniciais. Os <video> são JSX; só a classe .on e o play/pause são trocados por fora (Preact não
// mexe na classe porque ela não é prop), então um re-render nunca reinicia o clipe.
import type { AssistantPublic, ClipState } from '@tie/shared/content/schema';
import { assistInitials } from '@tie/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as speech from '../../core/speech';
import type { AvatarHandle } from './avatar3d/engine';

/** encouraging → talk-happy, thinking/correcting → talk-soft; o resto → talk. */
const TALK: Readonly<Record<string, ClipState>> = {
  encouraging: 'talk-happy',
  thinking: 'talk-soft',
  correcting: 'talk-soft',
};
/** Se faltar o clipe pedido, usa outro clipe falando; só sem nenhum fica no idle. */
const ORDER: Readonly<Record<ClipState, readonly ClipState[]>> = {
  talk: ['talk', 'talk-soft', 'talk-happy'],
  'talk-happy': ['talk-happy', 'talk', 'talk-soft'],
  'talk-soft': ['talk-soft', 'talk', 'talk-happy'],
  idle: [],
};
const CLIPS: readonly ClipState[] = ['idle', 'talk', 'talk-happy', 'talk-soft'];

export type AvatarAssistant = Pick<AssistantPublic, 'k' | 'name' | 'full' | 'clips' | 'poster'>;

/** Clipe que deve aparecer para o estado (pickClip do protótipo). */
export function clipFor(available: readonly string[], talking: boolean, mood: string): string {
  const want: ClipState = talking ? (TALK[mood] ?? 'talk') : 'idle';
  return ORDER[want].find((x) => available.includes(x)) ?? 'idle';
}

export function AvatarVideo({ a, talking, mood }: { a: AvatarAssistant; talking: boolean; mood: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const clips = CLIPS.flatMap((k) => {
    const src = a.clips[k];
    return src ? [[k, src] as const] : [];
  });
  const keys = clips.map(([k]) => k);
  const cur = useRef('');

  useEffect(() => {
    const el = wrap.current;
    if (!el || !keys.length) return;
    const pick = clipFor(keys, talking, mood);
    if (cur.current === pick) return;
    cur.current = pick;
    for (const v of el.querySelectorAll('video')) {
      const on = v.getAttribute('data-k') === pick;
      v.classList.toggle('on', on);
      // O clipe que entra começa do início; o que sai pausa depois do cross-fade.
      if (on) {
        try {
          v.currentTime = 0;
        } catch {
          // Ainda sem metadados.
        }
        v.play()?.catch(() => {});
      } else {
        setTimeout(() => {
          if (!v.classList.contains('on')) v.pause();
        }, 300);
      }
    }
  });

  // destroy(): solta os vídeos ao trocar de assistente ou sair da tela.
  useEffect(() => {
    const el = wrap.current;
    return () => {
      if (!el) return;
      for (const v of el.querySelectorAll('video')) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    };
  }, []);

  if (!clips.length) {
    return (
      <div class="av2d vid" data-a={a.k}>
        <div class="av-empty">
          <span class="av-ini" style={{ '--s': '120px' }}>
            {assistInitials(a)}
          </span>
        </div>
      </div>
    );
  }
  // data-a: maggie.css frames each assistant's clips (where the face sits in the 16:9 frame).
  return (
    <div class="av2d vid" data-a={a.k} ref={wrap}>
      {clips.map(([k, src]) => (
        <video
          key={k}
          data-k={k}
          src={src}
          muted
          loop
          playsInline
          preload="auto"
          poster={k === 'idle' ? (a.poster ?? undefined) : undefined}
        />
      ))}
    </div>
  );
}

// ---------- PROD: the embedded and the 3D avatar ----------

/** Origin of the hosted talking-avatar embed (its own voice and lip sync, in an iframe). */
const EMBED_ORIGIN = 'https://assistia-backend.perfectdesigner.workers.dev';
/** Assistants with a hosted embed: assistant key → embed slug. */
const EMBED_SLUG: Readonly<Record<string, string>> = { margaret: 'marguert' };
/** Without a `ready` from the embed by then, the Mic falls back to the local avatar. */
const EMBED_READY_MS = 15_000;
/** A line the embed has not started speaking by then is given up (the HD/browser voice takes it). */
const EMBED_START_MS = 20_000;

interface EmbedMessage {
  source?: string;
  type?: string;
  value?: boolean;
}

interface EmbedLine {
  started: boolean;
  onStart: () => void;
  done: (spoke: boolean) => void;
}

/**
 * The hosted avatar in an iframe. It registers as speech's voice host for its assistant, so the
 * assistant's lines are spoken (and lip-synced) by the embed: say → postMessage {type:'say'}, and the
 * embed answers 'ready', 'speaking' true/false and 'error'. If it never gets ready, onFail() swaps in
 * the local avatar.
 */
function AvatarEmbed({
  a,
  talking,
  slug,
  onFail,
}: {
  a: AvatarAssistant;
  talking: boolean;
  slug: string;
  onFail: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useEffect(() => {
    let ready = false;
    let failed = false;
    const waiting: ((ok: boolean) => void)[] = [];
    let line: EmbedLine | null = null;
    const post = (type: string, extra: Record<string, unknown> = {}) =>
      frame.current?.contentWindow?.postMessage({ source: 'assistia', type, ...extra }, EMBED_ORIGIN);
    const settle = (ok: boolean) => {
      for (const fn of waiting.splice(0)) fn(ok);
    };
    const whenReady = (): Promise<boolean> =>
      ready ? Promise.resolve(true) : failed ? Promise.resolve(false) : new Promise((r) => waiting.push(r));
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== EMBED_ORIGIN || !frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as EmbedMessage | null;
      if (d?.source !== 'assistia') return;
      if (d.type === 'ready') {
        ready = true;
        clearTimeout(readyTimer);
        settle(true);
      } else if (d.type === 'speaking' && line) {
        if (d.value) {
          if (!line.started) {
            line.started = true;
            line.onStart();
          }
        } else if (line.started) line.done(true);
      } else if (d.type === 'error' && line) line.done(line.started);
    };
    window.addEventListener('message', onMessage);
    const readyTimer = setTimeout(() => {
      if (ready) return;
      failed = true;
      settle(false);
      failRef.current();
    }, EMBED_READY_MS);

    const removeHost = speech.setVoiceHost({
      k: a.k,
      say: (text, onStart) =>
        whenReady().then(
          (ok) =>
            new Promise<boolean>((resolve) => {
              if (!ok) return resolve(false);
              line?.done(true);
              // Once it starts: done when it says so, or after a generous time for the text.
              const maxMs = Math.max(10_000, text.length * 120 + 8000);
              let timer = setTimeout(() => {
                post('stop');
                me.done(false);
              }, EMBED_START_MS);
              const me: EmbedLine = {
                started: false,
                onStart: () => {
                  onStart();
                  clearTimeout(timer);
                  timer = setTimeout(() => me.done(true), maxMs);
                },
                done: (spoke) => {
                  clearTimeout(timer);
                  if (line === me) line = null;
                  resolve(spoke);
                },
              };
              line = me;
              post('say', { text });
            }),
        ),
      stop: () => {
        if (line) {
          post('stop');
          line.done(true);
        }
      },
    });

    return () => {
      removeHost();
      failed = true;
      clearTimeout(readyTimer);
      window.removeEventListener('message', onMessage);
      settle(false);
      line?.done(true);
    };
  }, [a.k]);

  return (
    <div class="av2d avemb" data-a={a.k} data-talking={talking ? '1' : '0'}>
      <iframe
        ref={frame}
        class="avemb-frame"
        src={`${EMBED_ORIGIN}/embed/${encodeURIComponent(slug)}`}
        title={a.full}
        allow="autoplay"
        sandbox="allow-scripts allow-same-origin"
        referrerpolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
      />
    </div>
  );
}

/** Assistants with a 3D model (static files under /avatars/, cached by the service worker). */
const MODELS: Readonly<Record<string, string>> = { margaret: '/avatars/margaret/v5/margaret.gltf' };

let webgl2: boolean | null = null;
function hasWebGL2(): boolean {
  if (webgl2 === null) {
    try {
      webgl2 = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

interface AvatarProps {
  a: AvatarAssistant;
  talking: boolean;
  mood: string;
}

/**
 * The Mic assistant: the hosted embed when the assistant has one (until it fails), else the 3D model
 * when there is one and WebGL2 works, else the video clips.
 */
export function Avatar(props: AvatarProps) {
  const [embedFailed, setEmbedFailed] = useState(false);
  const slug = embedFailed ? undefined : EMBED_SLUG[props.a.k];
  if (slug) return <AvatarEmbed a={props.a} talking={props.talking} slug={slug} onFail={() => setEmbedFailed(true)} />;
  const model = MODELS[props.a.k];
  return !model || !hasWebGL2() ? <AvatarVideo {...props} /> : <Avatar3D {...props} model={model} />;
}

/** The 3D avatar (lazy three.js engine); falls back to the video clips if it cannot load. */
function Avatar3D({ a, talking, mood, model }: AvatarProps & { model: string }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<AvatarHandle | null>(null);
  const latest = useRef({ talking, mood });
  latest.current = { talking, mood };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    import('./avatar3d/engine')
      .then(({ createAvatar }) => {
        const el = host.current;
        if (!el) throw new Error('avatar: no host');
        return createAvatar(el, model);
      })
      .then((h) => {
        if (!alive) return h.dispose();
        handle.current = h;
        h.set(latest.current.talking, latest.current.mood);
        unsubscribe = speech.onSpeech((e) => h.speech(e));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      unsubscribe?.();
      handle.current?.dispose();
      handle.current = null;
    };
  }, [model]);

  useEffect(() => {
    handle.current?.set(talking, mood);
  }, [talking, mood]);

  if (failed) return <AvatarVideo a={a} talking={talking} mood={mood} />;
  return <div class="av2d av3d" data-a={a.k} data-talking={talking ? '1' : '0'} ref={host} />;
}
