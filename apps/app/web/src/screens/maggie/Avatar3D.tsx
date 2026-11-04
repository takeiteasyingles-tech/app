// 3D Mic avatar (PROD deviation, docs/spec/05-foundation-notes.md): assistants with a model in MODELS
// render it with three.js (avatar3d/engine, loaded on demand) instead of the prototype's video clips.
// The mouth follows the line being spoken (core/speech onSpeech). Without WebGL, or if the model fails
// to load, the video avatar is shown.
import { useEffect, useRef, useState } from 'preact/hooks';
import { onSpeech } from '../../core/speech';
import { type AvatarAssistant, AvatarVideo } from './Avatar';
import type { AvatarEngine } from './avatar3d/engine';

/** Assistant key → glTF model (web/public/avatars). */
const MODELS: Readonly<Record<string, string>> = {
  margaret: '/avatars/margaret/margaret.gltf',
};

let webgl: boolean | null = null;
function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      webgl = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

export function MicAvatar(props: { a: AvatarAssistant; talking: boolean; mood: string }) {
  const model = MODELS[props.a.k];
  if (!model || !hasWebGL()) return <AvatarVideo {...props} />;
  return <Avatar3D {...props} model={model} />;
}

function Avatar3D({ a, talking, mood, model }: { a: AvatarAssistant; talking: boolean; mood: string; model: string }) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<AvatarEngine | null>(null);
  const latest = useRef({ talking, mood });
  latest.current = { talking, mood };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    import('./avatar3d/engine')
      .then(({ createAvatar }) => {
        const el = host.current;
        if (!el) throw new Error('avatar: no host');
        return createAvatar(el, model);
      })
      .then((e) => {
        if (!alive) return e.dispose();
        engine.current = e;
        e.set(latest.current.talking, latest.current.mood);
        off = onSpeech((ev) => e.speech(ev));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      off?.();
      engine.current?.dispose();
      engine.current = null;
    };
  }, [model]);

  useEffect(() => {
    engine.current?.set(talking, mood);
  }, [talking, mood]);

  if (failed) return <AvatarVideo a={a} talking={talking} mood={mood} />;
  // data-a: same hook as the video avatar (maggie.css framing per assistant); data-talking for the e2e.
  return <div class="av2d av3d" data-a={a.k} data-talking={talking ? '1' : '0'} ref={host} />;
}
