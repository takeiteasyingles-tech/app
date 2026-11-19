// PROD: the Mic assistant as a 3D avatar (three.js, lazy: this module is the `engine` chunk, loaded
// only when the Mic shows an assistant with a model and the browser has WebGL2). The model is a glTF
// with an `idle` clip and talk clips (talk_normal, talk_happy, …), mouth and face blend shapes, and
// jaw/head/lip bones. The lips follow the speech: HD audio is lip-synced from its text, word timings
// and energy envelope; the browser voice drives a coarse mouth from speech.ts's visemes.
import {
  type AnimationAction,
  AnimationMixer,
  Clock,
  Color,
  DoubleSide,
  LoopRepeat,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  NoToneMapping,
  type Object3D,
  OrthographicCamera,
  PropertyBinding,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SpeechEvent } from '../../../core/speech';
import {
  envelope,
  LIP_BONES,
  LIP_OFFSETS,
  lipOffsetsAt,
  MOUTH_SHAPES,
  type MouthShape,
  poseWithLookahead,
  VISEME_POSE,
  type Viseme,
  type VisemeKey,
  visemeKeys,
} from './lipsync';

/** What the Mic screen drives. */
export interface AvatarHandle {
  /** Talking or idle, and the reply's mood (picks the talk clip and the face). */
  set(talking: boolean, mood: string): void;
  /** speech.ts events (onSpeech): the lip sync. */
  speech(e: SpeechEvent): void;
  dispose(): void;
}

/** Talk clip per mood (default talk_normal). */
const TALK_CLIP: Readonly<Record<string, string>> = {
  happy: 'talk_happy',
  encouraging: 'talk_excited',
  curious: 'talk_normal',
  thinking: 'talk_soft',
  correcting: 'talk_soft',
  sad: 'talk_sad',
};

/** Face blend shapes set by the mood. */
const FACE_SHAPES = [
  'cheekRaise',
  'browFurrow',
  'noseWrinkle',
  'mouthFrown',
  'browSad',
  'mouthSmile',
  'browRaise',
] as const;
type FaceShape = (typeof FACE_SHAPES)[number];
type Shape = MouthShape | FaceShape;

const FACE: Readonly<Record<string, Partial<Record<FaceShape, number>>>> = {
  idle: { cheekRaise: 0.1 },
  happy: { cheekRaise: 0.55, mouthSmile: 0.7 },
  encouraging: { cheekRaise: 0.75, noseWrinkle: 0.1, mouthSmile: 0.85 },
  curious: { cheekRaise: 0.1 },
  thinking: { cheekRaise: 0.1, browFurrow: 0.15 },
  correcting: { cheekRaise: 0.15, browFurrow: 0.1 },
  sad: { browSad: 0.85, mouthFrown: 0.3 },
};

/** How the mood colours the speech: wider/lifted lips, jaw scale, speed, eyebrow accents and nods. */
interface SpeakStyle {
  wide: number;
  lift: number;
  jaw: number;
  rate: number;
  accent: number;
  nod: number;
}
const STYLE: Readonly<Record<string, SpeakStyle>> = {
  neutral: { wide: 0, lift: 0, jaw: 1, rate: 1, accent: 0.45, nod: 1.2 },
  happy: { wide: 0.15, lift: 0.15, jaw: 1.15, rate: 1.05, accent: 0.6, nod: 1.7 },
  encouraging: { wide: 0.15, lift: 0.18, jaw: 1.15, rate: 1.05, accent: 0.65, nod: 1.8 },
  sad: { wide: -0.08, lift: 0, jaw: 0.92, rate: 0.88, accent: 0, nod: 0.6 },
};
const styleFor = (mood: string): SpeakStyle => STYLE[mood] ?? (STYLE.neutral as SpeakStyle);

/** Critically damped spring step: [position, velocity] after dt toward target at stiffness w. */
function spring(x: number, v: number, target: number, w: number, dt: number): [number, number] {
  const d = x - target;
  const c = v + w * d;
  const e = Math.exp(-w * dt);
  const nx = target + (d + c * dt) * e;
  const nv = (c - w * (d + c * dt)) * e;
  return Number.isFinite(nx) && Number.isFinite(nv) ? [nx, nv] : [target, 0];
}

/** speech.ts's 2D visemes (browser voice) → 3D visemes. */
const FROM_2D: Readonly<Record<string, Viseme>> = { a: 'aa', o: 'O', e: 'E', m: 'PP', rest: 'sil' };

/** Tuning (bone offsets in metres, weights in 1/s). */
const TUNE = {
  jawMax: 0.045,
  lipGain: 2.3,
  capX: 6,
  capUp: 10,
  capLow: 22,
  capChin: 14,
  lipE0: 0.55,
  lipE1: 0.65,
  lipW: 30,
  /** The mouth leads the sound slightly. */
  lead: 0.1,
  energyBase: 0.45,
  energyGain: 0.75,
  jawCap: 1.05,
  jawW: 32,
  closeW: 55,
  shapeW: 28,
  faceW: 6,
  accentE: 0.7,
  accentRise: 0.3,
  accentGap: 0.65,
} as const;

/** Eyebrow/nod accent over time since it fired: quick rise, slow fall. */
const accentCurve = (t: number): number => (t < 0 ? 0 : t < 0.09 ? t / 0.09 : Math.max(0, 1 - (t - 0.09) / 0.42) ** 2);

/** Framing of the orthographic camera (world units): head and shoulders. */
const FRAME_W = 1.344;
const FRAME_H = 0.768;

interface Playing {
  ctx: AudioContext;
  startAt: number;
  rate: number;
  duration: number;
  env: Float32Array;
  keys: VisemeKey[];
}

/** Renders the model at `modelUrl` into `host` (a canvas is appended); rejects if it cannot load. */
export async function createAvatar(host: HTMLElement, modelUrl: string): Promise<AvatarHandle> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  const canvas = renderer.domElement;
  canvas.className = 'av3d-canvas';

  const scene = new Scene();
  scene.background = new Color(0x8f8b87);
  const camera = new OrthographicCamera(-FRAME_W / 2, FRAME_W / 2, FRAME_H / 2, -FRAME_H / 2, 0.01, 10);
  camera.position.set(0, 0, 2);

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  // Unlit: the textures carry the baked lighting.
  const morphMeshes: Mesh[] = [];
  gltf.scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const unlit = (m: Material) => {
      const src = m as MeshStandardMaterial;
      return new MeshBasicMaterial({ map: src.map ?? src.emissiveMap, side: DoubleSide, vertexColors: true });
    };
    o.material = Array.isArray(o.material) ? o.material.map(unlit) : unlit(o.material);
    o.frustumCulled = false;
    if (o.morphTargetDictionary) morphMeshes.push(o);
  });
  scene.add(gltf.scene);

  const bone = (name: string): Object3D => {
    const b = gltf.scene.getObjectByName(PropertyBinding.sanitizeNodeName(name));
    if (!b) throw new Error(`avatar: no bone ${name}`);
    return b;
  };
  const jaw = bone('jaw');
  const head = bone('head');
  const lipUp = bone('lipUp');
  const corners = [bone('lipCorner.L'), bone('lipCorner.R')];
  const jawRest = jaw.position.clone();
  const lipUpRest = lipUp.position.clone();
  const cornerPos = corners.map((c) => c.position.clone());
  // Rigs with the full set of lip bones get per-bone lip offsets (and the chin drives the jaw).
  const lipBoneList = LIP_BONES.slice(0, 8).map((n) => gltf.scene.getObjectByName(PropertyBinding.sanitizeNodeName(n)));
  const lipBones = lipBoneList.every(Boolean) ? (lipBoneList as Object3D[]) : null;
  const lipRest = lipBones?.map((b) => b.position.clone()) ?? [];
  const lipPos = LIP_BONES.map(() => [0, 0] as [number, number]);
  const lipVel = LIP_BONES.map(() => [0, 0] as [number, number]);
  const right = new Vector3();

  const setShape = (name: string, value: number) => {
    for (const m of morphMeshes) {
      const i = m.morphTargetDictionary?.[name];
      if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = value;
    }
  };
  const shapes = Object.fromEntries([...MOUTH_SHAPES, ...FACE_SHAPES].map((k) => [k, 0])) as Record<Shape, number>;
  const shapeVel = Object.fromEntries(Object.keys(shapes).map((k) => [k, 0])) as Record<Shape, number>;

  const mixer = new AnimationMixer(gltf.scene);
  const actions = new Map<string, AnimationAction>();
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.setLoop(LoopRepeat, Infinity);
    actions.set(clip.name, a);
  }
  let current = actions.get('idle');
  if (!current) throw new Error('avatar: no idle clip');
  current.play();
  const crossfade = (name: string, secs: number) => {
    const next = actions.get(name) ?? actions.get('talk_normal');
    if (!next || next === current) return;
    next.reset().setEffectiveWeight(1).fadeIn(secs).play();
    current?.fadeOut(secs);
    current = next;
  };

  let talking = false;
  let mood = 'idle';
  let playing: Playing | null = null;
  let browserMouth: { v: Viseme; at: number } | null = null;
  let jawOpen = 0;
  let jawVel = 0;
  let accentAt = -Infinity;

  host.append(canvas);
  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    // Fit the frame (cover) and keep the face a little above the middle.
    const scale = Math.min(FRAME_W / w, FRAME_H / h);
    const vw = w * scale;
    const vh = h * scale;
    const dy = (FRAME_H - vh) * 0.2;
    camera.left = -vw / 2;
    camera.right = vw / 2;
    camera.top = dy + vh / 2;
    camera.bottom = dy - vh / 2;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const clock = new Clock();
  const down = new Vector3();
  const q = new Quaternion();
  const nodQ = new Quaternion();
  const X_AXIS = new Vector3(1, 0, 0);
  const energyAt = (p: Playing, t: number) => p.env[Math.min(p.env.length - 1, Math.max(0, Math.floor(t * 100)))] ?? 0;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    mixer.update(dt);
    const style = styleFor(talking ? mood : 'neutral');
    const target = Object.fromEntries(Object.keys(shapes).map((k) => [k, 0])) as Record<Shape, number>;
    for (const [k, v] of Object.entries(FACE[talking ? mood : 'idle'] ?? {})) target[k as FaceShape] = v;
    let jawTarget = 0;
    let closed = false;
    let speaking = false;
    let accent = 0;
    let lips: [number, number][] = LIP_BONES.map(() => [0, 0]);

    if (playing) {
      const t = (playing.ctx.currentTime - playing.startAt) * playing.rate + TUNE.lead;
      if (t > playing.duration + 0.3) playing = null;
      else {
        const energy = energyAt(playing, t);
        const pose = poseWithLookahead(playing.keys, t);
        for (const k of MOUTH_SHAPES) target[k] = pose[k];
        if (pose.v !== 'sil') {
          target.mouthWide = Math.max(0, Math.min(1, (target.mouthWide ?? 0) + style.wide));
          target.upperLipUp = Math.min(1, (target.upperLipUp ?? 0) + style.lift);
        }
        // An open jaw narrows the lips and lifts the upper one.
        const open = Math.min(1, jawOpen / 0.6);
        target.mouthWide = (target.mouthWide ?? 0) * (1 - 0.4 * open);
        target.mouthSmile = (target.mouthSmile ?? 0) * (1 - 0.6 * open);
        target.upperLipUp = Math.min(1, (target.upperLipUp ?? 0) + 0.3 * open);
        closed = pose.v === 'PP';
        jawTarget = closed
          ? 0
          : Math.min(TUNE.jawCap, Math.max(0, pose.jaw) * style.jaw * (TUNE.energyBase + TUNE.energyGain * energy));
        if (lipBones) {
          const gain = TUNE.lipGain * style.jaw * (TUNE.lipE0 + TUNE.lipE1 * energy);
          const soft = (v: number, cap: number) => cap * Math.tanh(v / cap);
          lips = lipOffsetsAt(playing.keys, t).map(([x, y], n) => [
            soft(x * gain, TUNE.capX),
            soft(y * gain, n === 8 ? TUNE.capChin : n >= 5 ? TUNE.capLow : TUNE.capUp),
          ]);
          if (pose.v !== 'sil') {
            const l = lips[0] as [number, number];
            const r = lips[4] as [number, number];
            l[0] -= style.wide * 12;
            r[0] += style.wide * 12;
            l[1] -= style.wide * 6;
            r[1] -= style.wide * 6;
            for (const n of [1, 2, 3]) (lips[n] as [number, number])[1] -= style.lift * 16;
          }
        }
        // Stressed syllables (an energy jump) raise the brows and nod.
        if (
          style.accent + style.nod > 0 &&
          energy > TUNE.accentE &&
          energy - energyAt(playing, t - 0.12) > TUNE.accentRise &&
          t - accentAt > TUNE.accentGap
        )
          accentAt = t;
        accent = accentCurve(t - accentAt);
        speaking = true;
      }
    }
    if (!speaking && browserMouth && performance.now() - browserMouth.at < 400) {
      const pose = VISEME_POSE[browserMouth.v];
      for (const k of MOUTH_SHAPES) target[k] = pose[k] ?? 0;
      jawTarget = pose.jaw * 0.8;
      closed = browserMouth.v === 'PP';
      if (lipBones)
        lips = LIP_OFFSETS[browserMouth.v].map(([x, y]) => [x * TUNE.lipGain * 0.8, y * TUNE.lipGain * 0.8]);
      speaking = true;
    }
    if (accent > 0) target.browRaise = Math.max(target.browRaise ?? 0, style.accent * accent);

    for (const k of Object.keys(shapes) as Shape[]) {
      const w =
        (FACE_SHAPES as readonly string[]).includes(k) && k !== 'browRaise' ? TUNE.faceW : TUNE.shapeW * style.rate;
      const [x, v] = spring(shapes[k], shapeVel[k], target[k] ?? 0, w, dt);
      shapes[k] = Math.max(0, Math.min(1.2, x));
      shapeVel[k] = v;
      setShape(k, shapes[k]);
    }
    // With lip bones, the bones shape the mouth instead of these blend shapes.
    if (lipBones)
      for (const k of ['mouthWide', 'upperLipUp', 'lowerLipDown', 'mouthRound', 'mouthFunnel']) setShape(k, 0);

    lips.forEach(([x, y], n) => {
      const p = lipPos[n] as [number, number];
      const v = lipVel[n] as [number, number];
      const w = closed ? TUNE.closeW : TUNE.lipW * style.rate;
      [p[0], v[0]] = spring(p[0], v[0], x, w, dt);
      [p[1], v[1]] = spring(p[1], v[1], y, w, dt);
    });
    [jawOpen, jawVel] = spring(jawOpen, jawVel, jawTarget, closed ? TUNE.closeW : TUNE.jawW * style.rate, dt);
    jawOpen = Math.max(0, jawOpen);

    // Jaw: moves down in its parent's space (by the chin offset when the rig has lip bones).
    jaw.parent?.updateWorldMatrix(true, false);
    jaw.parent?.getWorldQuaternion(q).invert();
    down.set(0, -1, 0).applyQuaternion(q);
    if (lipBones)
      jaw.position.copy(jawRest).addScaledVector(down, Math.max(0, (lipPos[8] as [number, number])[1]) / 1000);
    else jaw.position.copy(jawRest).addScaledVector(down, jawOpen * TUNE.jawMax);

    // Nod on accents, on top of the clip's head motion.
    if (accent > 0 && style.nod > 0 && head.parent) {
      head.parent.updateWorldMatrix(true, false);
      head.parent.getWorldQuaternion(q);
      nodQ.setFromAxisAngle(X_AXIS, ((style.nod * Math.PI) / 180) * accent);
      head.quaternion.premultiply(q.clone().invert().multiply(nodQ).multiply(q));
    }

    if (lipBones) {
      head.updateWorldMatrix(true, false);
      head.getWorldQuaternion(q).invert();
      right.set(1, 0, 0).applyQuaternion(q);
      down.set(0, -1, 0).applyQuaternion(q);
      lipBones.forEach((b, n) => {
        const [x, y] = lipPos[n] as [number, number];
        b.position
          .copy(lipRest[n] as Vector3)
          .addScaledVector(right, x / 1000)
          .addScaledVector(down, y / 1000);
      });
    } else {
      // Simple rigs: keep the upper lip still and ease the corners (they lag the clip a little).
      lipUp.position.copy(lipUpRest);
      corners.forEach((c, n) => {
        const p = cornerPos[n] as Vector3;
        p.lerp(c.position, Math.min(1, 2.5 * dt));
        c.position.copy(p);
      });
    }
    renderer.render(scene, camera);
  });

  return {
    set(isTalking, m) {
      mood = m || 'happy';
      if (isTalking === talking) {
        // Same state, new mood: switch talk clips.
        if (isTalking) crossfade(TALK_CLIP[mood] ?? 'talk_normal', 0.3);
        return;
      }
      talking = isTalking;
      crossfade(isTalking ? (TALK_CLIP[mood] ?? 'talk_normal') : 'idle', isTalking ? 0.3 : 0.45);
    },
    speech(e) {
      if (e.type === 'audio') {
        const env = envelope(e.buffer);
        playing = {
          ctx: e.ctx,
          startAt: e.startAt,
          rate: e.rate,
          duration: e.buffer.duration,
          env,
          keys: visemeKeys(e.text, env, e.words),
        };
        accentAt = -Infinity;
      } else if (e.type === 'mouth') browserMouth = { v: FROM_2D[e.v] ?? 'sil', at: performance.now() };
      else {
        playing = null;
        browserMouth = null;
      }
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      mixer.stopAllAction();
      gltf.scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          (m as MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    },
  };
}
