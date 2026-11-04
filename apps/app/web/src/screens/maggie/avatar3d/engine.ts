// 3D Mic avatar (three.js). Loaded with import() only when the assistant has a model, so three.js stays
// out of the Mic screen chunk. The model (web/public/avatars/<k>/) is a 2.5D rig made in Blender from the
// assistant's photo: 17 bones (head, jaw, lips, brows, lids), 11 morph targets (mouth shapes and
// expressions) and 6 skeleton clips (idle + one talk clip per mood). Idle ↔ talk is a crossfade; the
// mouth follows the line: text + audio visemes for the HD voice, the flap visemes for the browser voice.
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
};
const EXPRESSIONS = ['cheekRaise', 'browFurrow', 'noseWrinkle', 'mouthFrown'] as const;
type Expression = (typeof EXPRESSIONS)[number];
const MOOD_FACE: Readonly<Record<string, Partial<Record<Expression, number>>>> = {
  idle: { cheekRaise: 0.1 },
  happy: { cheekRaise: 0.55 },
  encouraging: { cheekRaise: 0.75, noseWrinkle: 0.1 },
  curious: { cheekRaise: 0.15 },
  thinking: { cheekRaise: 0.1, browFurrow: 0.15 },
  correcting: { cheekRaise: 0.2, browFurrow: 0.1 },
};
/** Browser-voice flap visemes (speech.ts VIS) → mouth shapes. */
const FLAP: Readonly<Record<string, Viseme>> = { a: 'aa', o: 'O', e: 'E', m: 'PP', rest: 'sil' };

const P = {
  jawMax: 0.02, // m; 1 px of the photo = 1 mm, so ~2 cm on open vowels
  lead: 0.05, // s: the mouth leads the sound
  energyBase: 0.45,
  energyGain: 0.75,
  jawCap: 1.05,
  jawRate: 25,
  shapeRate: 22,
};
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
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    mixer.update(dt);
    const target: Record<string, number> = Object.fromEntries(Object.keys(morphNow).map((k) => [k, 0]));
    for (const [k, v] of Object.entries(MOOD_FACE[talking ? mood : 'idle'] ?? {})) target[k] = v;
    let jawT = 0;
    let driven = false;
    if (line) {
      const t = (line.ctx.currentTime - line.startAt) * line.rate + P.lead;
      if (t > line.duration + 0.3) line = null;
      else {
        const e = line.env[Math.min(line.env.length - 1, Math.max(0, Math.floor(t * 100)))] ?? 0;
        const s = sample(line.keys, t);
        for (const m of MORPHS) target[m] = s[m];
        jawT = s.v === 'PP' ? 0 : Math.min(P.jawCap, Math.max(0, s.jaw) * (P.energyBase + P.energyGain * e));
        driven = true;
      }
    }
    if (!driven && flap && performance.now() - flap.at < 400) {
      const sh = SHAPES[flap.v];
      for (const m of MORPHS) target[m] = sh[m as MouthMorph] ?? 0;
      jawT = sh.jaw * 0.8;
      driven = true;
    }
    for (const k of Object.keys(morphNow)) {
      const rate = (EXPRESSIONS as readonly string[]).includes(k) ? 3 : P.shapeRate;
      let v = (morphNow[k] as number) + ((target[k] ?? 0) - (morphNow[k] as number)) * Math.min(1, rate * dt);
      if (!Number.isFinite(v)) v = 0;
      morphNow[k] = v;
      setMorph(k, v);
    }
    // Only the voice moves the mouth (the talk clip starts while the TTS is still loading): the clip's
    // jaw and lip tracks are always overridden.
    jawNow += (jawT - jawNow) * Math.min(1, P.jawRate * dt);
    if (!Number.isFinite(jawNow)) jawNow = 0;
    jaw.parent?.updateWorldMatrix(true, false);
    jaw.parent?.getWorldQuaternion(q).invert();
    down.set(0, -1, 0).applyQuaternion(q);
    jaw.position.copy(jawRest).addScaledVector(down, jawNow * P.jawMax);
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
          keys: timeline(e.text, env),
        };
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
