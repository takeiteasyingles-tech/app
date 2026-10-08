// Port of prototipo/js/core/sound.js: synthesized interface sounds (no files) and a simple backing
// track for songs without a recording. One shared AudioContext, master gain .9. Every sfx is gated
// by settings.sound; the backing track starts muted when sound is off.
import type { SfxName } from '@tie/ui';
import { state } from '../store/state';

type AC = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** The shared AudioContext (created on first use, resumed when suspended); null without Web Audio. */
export function ac(): AudioContext | null {
  if (!ctx) {
    if (typeof window === 'undefined') return null;
    const Ctor: AC | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

const on = (): boolean => state.value.settings.sound;

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  when?: number;
  to?: number | null;
  attack?: number;
  dest?: AudioNode | null;
}

function tone(freq: number, dur: number, opt: ToneOpts = {}): void {
  const c = ac();
  if (!c) return;
  const o = { type: 'sine' as OscillatorType, vol: 0.05, when: 0, to: null, attack: 0.005, dest: master, ...opt };
  const t = c.currentTime + o.when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + o.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(o.dest ?? c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let nb: AudioBuffer | null = null;

interface NoiseOpts {
  vol?: number;
  when?: number;
  hp?: number;
  dest?: AudioNode | null;
}

function noise(dur: number, opt: NoiseOpts = {}): void {
  const c = ac();
  if (!c) return;
  const o = { vol: 0.05, when: 0, hp: 1000, dest: master, ...opt };
  if (!nb) {
    nb = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + o.when;
  const s = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  s.buffer = nb;
  f.type = 'highpass';
  f.frequency.value = o.hp;
  g.gain.setValueAtTime(o.vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(o.dest ?? c.destination);
  s.start(t);
  s.stop(t + dur + 0.02);
}

/** TIE.sound.sfx */
export const sfx: Readonly<Record<SfxName, () => void>> = {
  tick() {
    if (on()) tone(1800, 0.03, { vol: 0.015 });
  },
  ok() {
    if (!on()) return;
    tone(660, 0.12, { type: 'triangle', vol: 0.07 });
    tone(990, 0.2, { type: 'triangle', vol: 0.07, when: 0.09 });
  },
  soft() {
    if (on()) tone(520, 0.16, { type: 'triangle', vol: 0.05, to: 440 });
  },
  points() {
    if (!on()) return;
    [880, 1175, 1480].forEach((f, i) => {
      tone(f, 0.12, { type: 'triangle', vol: 0.06, when: i * 0.07 });
    });
  },
  level() {
    if (!on()) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      tone(f, 0.25, { type: 'triangle', vol: 0.07, when: i * 0.12 });
    });
  },
  rec() {
    if (on()) tone(880, 0.08, { vol: 0.06 });
  },
  done() {
    if (!on()) return;
    tone(440, 0.3, { type: 'triangle', vol: 0.06 });
    tone(554, 0.3, { type: 'triangle', vol: 0.06, when: 0.1 });
    tone(659, 0.5, { type: 'triangle', vol: 0.06, when: 0.2 });
  },
};

/** Plays a sound effect by name (what @tie/ui's uiConfig.sfx calls). */
export const playSfx = (name: SfxName): void => sfx[name]?.();

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** I–V–vi–IV. */
const CHORDS = [
  [0, 4, 7],
  [7, 11, 14],
  [9, 12, 16],
  [5, 9, 12],
] as const;

/** TIE.sound.synth: I–V–vi–IV backing track with an electronic drum kit, for songs without an mp3. */
export const synth = {
  playing: false,
  timer: 0 as ReturnType<typeof setInterval> | 0,
  step: 0,
  next: 0,
  bus: null as GainNode | null,
  play(opt: { bpm?: number; key?: number } = {}): void {
    const c = ac();
    if (!c) return;
    this.stop();
    const bpm = opt.bpm || 110;
    const root = 45 + (opt.key || 0);
    const s16 = 60 / bpm / 4;
    this.playing = true;
    this.step = 0;
    this.next = c.currentTime + 0.08;
    const bus = c.createGain();
    bus.gain.value = on() ? 0.7 : 0;
    bus.connect(master ?? c.destination);
    this.bus = bus;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    lp.connect(bus);
    const tick = () => {
      while (this.next < c.currentTime + 0.12) {
        const st = this.step;
        const when = this.next - c.currentTime;
        const chord = CHORDS[Math.floor(st / 16) % 4] ?? CHORDS[0];
        const i = st % 16;
        if (i % 4 === 0) tone(150, 0.18, { vol: 0.3, to: 42, when, dest: bus });
        if (i === 4 || i === 12) noise(0.16, { vol: 0.14, hp: 1400, when, dest: bus });
        if (i % 2 === 0) noise(0.035, { vol: 0.04, hp: 7000, when, dest: bus });
        if (i % 2 === 0) tone(hz(root - 12 + chord[0]), s16 * 1.8, { type: 'sawtooth', vol: 0.06, when, dest: lp });
        tone(hz(root + 12 + (chord[i % 3] ?? 0) + (i % 6 === 5 ? 12 : 0)), s16 * 0.9, {
          type: 'square',
          vol: 0.025,
          when,
          dest: lp,
        });
        if (i === 0)
          for (const n of chord)
            tone(hz(root + n), s16 * 15, { type: 'triangle', vol: 0.03, when, attack: 0.08, dest: lp });
        this.step++;
        this.next += s16;
      }
    };
    tick();
    this.timer = setInterval(tick, 40);
  },
  stop(): void {
    this.playing = false;
    clearInterval(this.timer);
    if (this.bus) {
      try {
        this.bus.gain.value = 0;
        this.bus.disconnect();
      } catch {
        // Already disconnected.
      }
      this.bus = null;
    }
  },
};
