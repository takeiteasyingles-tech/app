// 3D Mic avatar (three.js). Loaded with import() only when the assistant has a model, so three.js stays
// out of the Mic screen chunk. The model (web/public/avatars/<k>/) is a 2.5D rig made in Blender from the
// assistant's photo: 17 bones (head, jaw, lips, brows, lids), 14 morph targets (mouth shapes and
// expressions) and 6 skeleton clips (idle + one talk clip per mood). Idle ↔ talk is a crossfade; the
// mouth follows the line: text + audio visemes for the HD voice (timed on its word timing when the TTS
// reports it), the flap visemes for the browser voice. Moods set the resting face, the talking style
// and the accents (brow raise + nod on stressed syllables).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SpeechEvent } from '../../../core/speech';
import { envelope, type Key, MORPHS, type MouthMorph, SHAPES, sample, timeline, type Viseme } from './lipsync';

/** Mood of the reply (the AI's Mood enum) → talk clip and expression morphs. */
const CLIP: Readonly<Record<string, string>> = {
  happy: 'talk_happy',
  encouraging: 'talk_excited',
  curious: 'talk_normal',
  thinking: 'talk_soft',
  correcting: 'talk_soft',
  sad: 'talk_sad',
};
// browSad, mouthSmile and browRaise exist from model v4 on (a model without them just ignores them).
const EXPRESSIONS = [
  'cheekRaise',
  'browFurrow',
  'noseWrinkle',
  'mouthFrown',
  'browSad',
  'mouthSmile',
  'browRaise',
] as const;
type Expression = (typeof EXPRESSIONS)[number];
/**
 * Resting face per mood. Calibrated on 2026-11-09 against three reference clips of Margaret talking
 * neutral, happy and sad (MediaPipe blendshapes per frame): happy almost doubles the smile and widens
 * the mouth ~15 %; sad lifts the inner brows ×2.2 and drops the outer ones, with a narrower mouth.
 */
const MOOD_FACE: Readonly<Record<string, Partial<Record<Expression, number>>>> = {
  idle: { cheekRaise: 0.1, mouthSmile: 0.12 },
  happy: { cheekRaise: 0.55, mouthSmile: 0.7 },
  encouraging: { cheekRaise: 0.75, noseWrinkle: 0.1, mouthSmile: 0.85 },
  curious: { cheekRaise: 0.15, mouthSmile: 0.2 },
  thinking: { cheekRaise: 0.1, browFurrow: 0.15, mouthSmile: 0.08 },
  correcting: { cheekRaise: 0.2, browFurrow: 0.1, mouthSmile: 0.15 },
  sad: { browSad: 0.85, mouthFrown: 0.3 },
};
/**
 * How the mood speaks (same clips): `wide` is added to mouthWide while talking, `rate` scales how fast
 * the lips move, `accent` is the brow raise on a stressed syllable and `nod` the head nod (degrees).
 * From the clips: happy talks wider and nods most (pitch SD 6°), sad is narrower, ~10 % slower, nods
 * least (3.5°) and never raises the brows.
 */
interface Style {
  wide: number;
  rate: number;
  accent: number;
  nod: number;
}
const STYLE: Readonly<Record<string, Style>> = {
  neutral: { wide: 0, rate: 1, accent: 0.45, nod: 1.2 },
  happy: { wide: 0.12, rate: 1.05, accent: 0.6, nod: 1.7 },
  encouraging: { wide: 0.12, rate: 1.05, accent: 0.65, nod: 1.8 },
  sad: { wide: -0.08, rate: 0.88, accent: 0, nod: 0.6 },
};
const styleOf = (mood: string): Style => STYLE[mood] ?? (STYLE.neutral as Style);

/**
 * Critically damped spring toward `target` (no overshoot, no jitter): the mouth accelerates and
 * settles like a muscle instead of the exponential chase's constant snap. `w` is the stiffness, rad/s.
 */
export function spring(x: number, v: number, target: number, w: number, dt: number): [number, number] {
  // Exact solution over dt (stable for any frame time): x(t) = target + (c1 + c2·t)·e^(−w·t).
  const c1 = x - target;
  const c2 = v + w * c1;
  const e = Math.exp(-w * dt);
  const nx = target + (c1 + c2 * dt) * e;
  const nv = (c2 - w * (c1 + c2 * dt)) * e;
  return Number.isFinite(nx) && Number.isFinite(nv) ? [nx, nv] : [target, 0];
}
/** Browser-voice flap visemes (speech.ts VIS) → mouth shapes. */
const FLAP: Readonly<Record<string, Viseme>> = { a: 'aa', o: 'O', e: 'E', m: 'PP', rest: 'sil' };

const P = {
  jawMax: 0.02, // m; 1 px of the photo = 1 mm, so ~2 cm on open vowels
  lead: 0.05, // s: the mouth leads the sound
  energyBase: 0.45,
  energyGain: 0.75,
  jawCap: 1.05,
  /** Spring stiffness (rad/s): jaw, jaw shutting for M/B/P (the lips must meet), lip shapes, face. */
  jawW: 32,
  closeW: 55,
  shapeW: 28,
  faceW: 6,
  /** A stressed syllable: energy above `accentE` that rose by `accentRise` over the last 120 ms. */
  accentE: 0.7,
  accentRise: 0.3,
  accentGap: 0.65, // s between two accents
};
/** Brow raise and nod of an accent over time: quick rise, slow fall (s → 0..1). */
const accentCurve = (age: number): number =>
  age < 0 ? 0 : age < 0.09 ? age / 0.09 : Math.max(0, 1 - (age - 0.09) / 0.42) ** 2;
const PHOTO_W = 1.344;
const PHOTO_H = 0.768;
/** Where the frame sits when the stage crops the photo vertically (like object-position: center 30%). */
const FOCUS_Y = 0.3;

interface Line {
  ctx: AudioContext;
  startAt: number;
  rate: number;
  duration: number;
  env: Float32Array;
  keys: Key[];
}

export interface AvatarEngine {
  /** Talking (M.speaking) and the reply's mood. */
  set(talking: boolean, mood: string): void;
  speech(e: SpeechEvent): void;
  dispose(): void;
}

export async function createAvatar(host: HTMLElement, modelUrl: string): Promise<AvatarEngine> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.className = 'av3d-canvas';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8f8b87);
  const camera = new THREE.OrthographicCamera(-PHOTO_W / 2, PHOTO_W / 2, PHOTO_H / 2, -PHOTO_H / 2, 0.01, 10);
  camera.position.set(0, 0, 2);

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // The photo is the lighting: unlit, multiplied by the painted mouth shading (vertex colours).
    const toBasic = (m: THREE.Material) =>
      new THREE.MeshBasicMaterial({
        map: (m as THREE.MeshStandardMaterial).map ?? (m as THREE.MeshStandardMaterial).emissiveMap,
        side: THREE.DoubleSide,
        vertexColors: true,
      });
    o.material = Array.isArray(o.material) ? o.material.map(toBasic) : toBasic(o.material);
    o.frustumCulled = false;
    if (o.morphTargetDictionary) meshes.push(o);
  });
  scene.add(gltf.scene);
  const bone = (n: string) => {
    const b = gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n)); // "lipCorner.L" → "lipCornerL"
    if (!b) throw new Error(`avatar: no bone ${n}`);
    return b;
  };
  const jaw = bone('jaw');
  const head = bone('head');
  const lipUp = bone('lipUp');
  const corners = [bone('lipCorner.L'), bone('lipCorner.R')];
  const jawRest = jaw.position.clone();
  const lipUpRest = lipUp.position.clone();
  const cornerSmooth = corners.map((c) => c.position.clone());
  const setMorph = (name: string, v: number) => {
    for (const m of meshes) {
      const i = m.morphTargetDictionary?.[name];
      if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = v;
    }
  };
  const morphNow: Record<string, number> = Object.fromEntries([...MORPHS, ...EXPRESSIONS].map((k) => [k, 0]));
  const morphVel: Record<string, number> = Object.fromEntries(Object.keys(morphNow).map((k) => [k, 0]));

  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopRepeat, Infinity);
    actions.set(clip.name, a);
  }
  let current = actions.get('idle');
  if (!current) throw new Error('avatar: no idle clip');
  current.play();
  const fadeTo = (name: string, d: number) => {
    const next = actions.get(name) ?? actions.get('talk_normal');
    if (!next || next === current) return;
    next.reset().setEffectiveWeight(1).fadeIn(d).play();
    current?.fadeOut(d);
    current = next;
  };

  let talking = false;
  let mood = 'idle';
  let line: Line | null = null;
  let flap: { v: Viseme; at: number } | null = null;
  let jawNow = 0;
  let jawVel = 0;
  /** Line time of the last stressed syllable (brow raise + nod), or -∞. */
  let accentAt = Number.NEGATIVE_INFINITY;

  host.append(canvas);
  const fit = () => {
    // Cover-fit the 16:9 photo to the stage; when the stage is wider, keep the face in the frame.
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    const s = Math.min(PHOTO_W / w, PHOTO_H / h);
    const vw = w * s;
    const vh = h * s;
    const cy = (PHOTO_H - vh) * (0.5 - FOCUS_Y);
    camera.left = -vw / 2;
    camera.right = vw / 2;
    camera.top = cy + vh / 2;
    camera.bottom = cy - vh / 2;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(host);
  fit();

  const clock = new THREE.Clock();
  const down = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const qn = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const envAt = (l: Line, t: number) => l.env[Math.min(l.env.length - 1, Math.max(0, Math.floor(t * 100)))] ?? 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    mixer.update(dt);
    const st = styleOf(talking ? mood : 'neutral');
    const target: Record<string, number> = Object.fromEntries(Object.keys(morphNow).map((k) => [k, 0]));
    for (const [k, v] of Object.entries(MOOD_FACE[talking ? mood : 'idle'] ?? {})) target[k] = v;
    let jawT = 0;
    let closing = false;
    let driven = false;
    let accent = 0;
    if (line) {
      const t = (line.ctx.currentTime - line.startAt) * line.rate + P.lead;
      if (t > line.duration + 0.3) line = null;
      else {
        const e = envAt(line, t);
        const s = sample(line.keys, t);
        for (const m of MORPHS) target[m] = s[m];
        // the mood's mouth width while talking (happy wider, sad narrower)
        if (s.v !== 'sil') target.mouthWide = Math.max(0, Math.min(1, (target.mouthWide ?? 0) + st.wide));
        closing = s.v === 'PP';
        jawT = closing ? 0 : Math.min(P.jawCap, Math.max(0, s.jaw) * (P.energyBase + P.energyGain * e));
        // a stressed syllable: the energy jumps up → brows lift a little and the head nods
        if (
          st.accent + st.nod > 0 &&
          e > P.accentE &&
          e - envAt(line, t - 0.12) > P.accentRise &&
          t - accentAt > P.accentGap
        )
          accentAt = t;
        accent = accentCurve(t - accentAt);
        driven = true;
      }
    }
    if (!driven && flap && performance.now() - flap.at < 400) {
      const sh = SHAPES[flap.v];
      for (const m of MORPHS) target[m] = sh[m as MouthMorph] ?? 0;
      jawT = sh.jaw * 0.8;
      closing = flap.v === 'PP';
      driven = true;
    }
    if (accent > 0) target.browRaise = Math.max(target.browRaise ?? 0, st.accent * accent);
    for (const k of Object.keys(morphNow)) {
      const w = (EXPRESSIONS as readonly string[]).includes(k) && k !== 'browRaise' ? P.faceW : P.shapeW * st.rate;
      const [x, v] = spring(morphNow[k] as number, morphVel[k] as number, target[k] ?? 0, w, dt);
      morphNow[k] = Math.max(0, Math.min(1.2, x));
      morphVel[k] = v;
      setMorph(k, morphNow[k] as number);
    }
    // Only the voice moves the mouth (the talk clip starts while the TTS is still loading): the clip's
    // jaw and lip tracks are always overridden. M/B/P shut faster so the lips really meet.
    [jawNow, jawVel] = spring(jawNow, jawVel, jawT, closing ? P.closeW : P.jawW * st.rate, dt);
    jawNow = Math.max(0, jawNow);
    jaw.parent?.updateWorldMatrix(true, false);
    jaw.parent?.getWorldQuaternion(q).invert();
    down.set(0, -1, 0).applyQuaternion(q);
    jaw.position.copy(jawRest).addScaledVector(down, jawNow * P.jawMax);
    // The accent's nod, on top of the clip's head motion (the mixer rewrites the head every frame).
    if (accent > 0 && st.nod > 0 && head.parent) {
      head.parent.updateWorldMatrix(true, false);
      head.parent.getWorldQuaternion(q);
      qn.setFromAxisAngle(X, ((st.nod * Math.PI) / 180) * accent);
      head.quaternion.premultiply(q.clone().invert().multiply(qn).multiply(q));
    }
    lipUp.position.copy(lipUpRest);
    // keep the mood smile of the clip, drop its per-syllable corner jitter
    corners.forEach((c, i) => {
      const sm = cornerSmooth[i] as THREE.Vector3;
      sm.lerp(c.position, Math.min(1, 2.5 * dt));
      c.position.copy(sm);
    });
    renderer.render(scene, camera);
  });

  return {
    set(t, m) {
      mood = m || 'happy';
      if (t !== talking) {
        talking = t;
        fadeTo(t ? (CLIP[mood] ?? 'talk_normal') : 'idle', t ? 0.3 : 0.45);
      } else if (t) fadeTo(CLIP[mood] ?? 'talk_normal', 0.3);
    },
    speech(e) {
      if (e.type === 'audio') {
        const env = envelope(e.buffer);
        line = {
          ctx: e.ctx,
          startAt: e.startAt,
          rate: e.rate,
          duration: e.buffer.duration,
          env,
          // with the TTS's word timing (cloned voices) the mouth follows it exactly
          keys: timeline(e.text, env, e.words),
        };
        accentAt = Number.NEGATIVE_INFINITY;
      } else if (e.type === 'mouth') flap = { v: FLAP[e.v] ?? 'sil', at: performance.now() };
      else {
        line = null;
        flap = null;
      }
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      mixer.stopAllAction();
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    },
  };
}
