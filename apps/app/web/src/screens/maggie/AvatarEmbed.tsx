// Assistia embed as the Mic avatar (PROD deviation, docs/spec/05-foundation-notes.md § "Mic avatar:
// Assistia embed"). Our tutor still writes every line; the embed only gives the assistant its face and
// voice: while it is on stage, speech.say() hands the assistant's lines to the iframe ("say") and resolves
// when the iframe reports the line over. We talk to the iframe directly with the protocol of Assistia's
// embed.js (postMessage {source:'assistia', type}) instead of loading that script, so the strict CSP only
// gains a frame-src. If the frame never gets ready, the 3D/video avatar takes the stage (onFail); a line
// that cannot start falls back to our own voice.
import { useEffect, useRef } from 'preact/hooks';
import { setExternalVoice } from '../../core/speech';
import type { AvatarAssistant } from './Avatar';

/** Assistia's origin: the iframe's src and the only origin whose messages are read (CSP frame-src). */
export const MIC_EMBED_ORIGIN = 'https://assistia-backend.perfectdesigner.workers.dev';
/** Assistant key → Assistia avatar slug. */
export const MIC_EMBEDS: Readonly<Record<string, string>> = { margaret: 'marguert' };
/** Test builds (tools/parity build.ts sets VITE_MIC_EMBED=off) never reach Assistia. */
export const micEmbedOn = import.meta.env.VITE_MIC_EMBED !== 'off';

/** Frame load + 3D model, before the stage gives up on the embed. */
const READY_MS = 15_000;
/** From "say" to the voice starting (Assistia generates the audio first). */
const START_MS = 20_000;

interface Msg {
  source?: string;
  type?: string;
  value?: unknown;
}

export function AvatarEmbed({
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
  const fail = useRef(onFail);
  fail.current = onFail;

  useEffect(() => {
    let ready = false;
    let dead = false;
    const waiting: ((ok: boolean) => void)[] = [];
    /** The line being spoken: settles its say() once. */
    let line: { started: boolean; onStart: () => void; done: (spoken: boolean) => void } | null = null;

    const post = (type: string, extra: Record<string, unknown> = {}) =>
      frame.current?.contentWindow?.postMessage({ source: 'assistia', type, ...extra }, MIC_EMBED_ORIGIN);
    const settleWaiting = (ok: boolean) => {
      for (const w of waiting.splice(0)) w(ok);
    };
    const whenReady = () =>
      ready ? Promise.resolve(true) : dead ? Promise.resolve(false) : new Promise<boolean>((r) => waiting.push(r));

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== MIC_EMBED_ORIGIN || !frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as Msg | null;
      if (m?.source !== 'assistia') return;
      if (m.type === 'ready') {
        ready = true;
        clearTimeout(readyTimer);
        settleWaiting(true);
      } else if (m.type === 'speaking' && line) {
        if (m.value) {
          if (!line.started) {
            line.started = true;
            line.onStart();
          }
        } else if (line.started) line.done(true);
      } else if (m.type === 'error' && line) {
        // Before the voice started, our own voice says the line; after, it simply ends.
        line.done(line.started);
      }
    };
    window.addEventListener('message', onMessage);

    const readyTimer = setTimeout(() => {
      if (ready) return;
      dead = true;
      settleWaiting(false);
      fail.current();
    }, READY_MS);

    const off = setExternalVoice({
      k: a.k,
      say: (text, onStart) =>
        whenReady().then(
          (ok) =>
            new Promise<boolean>((resolve) => {
              if (!ok) return resolve(false);
              line?.done(true);
              const cap = Math.max(10_000, text.length * 120 + 8_000);
              let timer = setTimeout(() => {
                post('stop');
                me.done(false);
              }, START_MS);
              const me = {
                started: false,
                onStart: () => {
                  onStart();
                  // Safety net if the "not speaking" message never comes.
                  clearTimeout(timer);
                  timer = setTimeout(() => me.done(true), cap);
                },
                done: (spoken: boolean) => {
                  clearTimeout(timer);
                  if (line === me) line = null;
                  resolve(spoken);
                },
              };
              line = me;
              post('say', { text });
            }),
        ),
      stop: () => {
        if (!line) return;
        post('stop');
        line.done(true);
      },
    });

    return () => {
      off();
      dead = true;
      clearTimeout(readyTimer);
      window.removeEventListener('message', onMessage);
      settleWaiting(false);
      line?.done(true);
    };
  }, [a.k]);

  // data-a: same framing hook as the other avatars; data-talking for the e2e.
  return (
    <div class="av2d avemb" data-a={a.k} data-talking={talking ? '1' : '0'}>
      <iframe
        ref={frame}
        class="avemb-frame"
        src={`${MIC_EMBED_ORIGIN}/embed/${encodeURIComponent(slug)}`}
        title={a.full}
        allow="autoplay"
        sandbox="allow-scripts allow-same-origin"
        referrerpolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
      />
    </div>
  );
}
