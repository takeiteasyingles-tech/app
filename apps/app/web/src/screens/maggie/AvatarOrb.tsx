// ElevenLabs agent as the Mic avatar (PROD deviation, docs/spec/05-foundation-notes.md § "Mic avatar per
// assistant"): an assistant whose Mic avatar is an ElevenLabs agent shows an orb, the agent's look in
// ElevenLabs' own widget, instead of a face. Colour patches drift inside a sphere (maggie.css, .avorb);
// the sphere swells with the voice. It follows every voice the Mic plays through core/speech: the
// agent's (mouth shapes from its loudness), the HD voice (the decoded audio, read where it is playing)
// and the browser voice (flap visemes), so it moves the same in the modes the agent does not hold.
import { useEffect, useRef } from 'preact/hooks';
import { onSpeech, type SpeechEvent, type Viseme } from '../../core/speech';
import type { AvatarAssistant } from './Avatar';

/** Mouth shape → how far the orb swells (0…1). */
const LEVEL: Readonly<Record<Viseme, number>> = { a: 1, e: 0.75, o: 0.6, m: 0.3, rest: 0 };
/** Samples read around the playhead of an HD line (~20 ms at 48 kHz). */
const WINDOW = 1024;

type AudioLine = Extract<SpeechEvent, { type: 'audio' }>;

/** Loudness (0…1) of an HD line where it is playing now; null once it is over. */
export function lineLevel(line: AudioLine, samples: Float32Array, now: number): number | null {
  const at = Math.floor((now - line.startAt) * line.rate * line.buffer.sampleRate);
  if (at >= samples.length) return null;
  if (at < 0) return 0;
  const end = Math.min(samples.length, at + WINDOW);
  let sum = 0;
  for (let i = at; i < end; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, end - at)) * 4);
}

export function AvatarOrb({ a, talking }: { a: AvatarAssistant; talking: boolean }) {
  const ball = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target = 0;
    let shown = 0;
    let line: AudioLine | null = null;
    let samples: Float32Array | null = null;
    let raf = 0;
    const tick = () => {
      if (line && samples) {
        const v = lineLevel(line, samples, line.ctx.currentTime);
        if (v === null) {
          line = null;
          samples = null;
          target = 0;
        } else target = v;
      }
      let next = shown + (target - shown) * 0.3;
      if (Math.abs(next - target) < 0.004) next = target;
      // The custom property only changes while the swell does (no style work while quiet).
      if (next !== shown) {
        shown = next;
        ball.current?.style.setProperty('--lvl', shown.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const off = onSpeech((e) => {
      if (e.type === 'audio') {
        line = e;
        samples = e.buffer.getChannelData(0);
      } else if (e.type === 'mouth') {
        line = null;
        samples = null;
        target = LEVEL[e.v];
      } else {
        line = null;
        samples = null;
        target = 0;
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, []);

  // data-a / data-talking: the same hooks as the other avatars (framing, e2e).
  return (
    <div class="av2d avorb" data-a={a.k} data-talking={talking ? '1' : '0'}>
      <div class="avorb-ball" ref={ball} role="img" aria-label={a.full}>
        <span class="avorb-blob b1" />
        <span class="avorb-blob b2" />
        <span class="avorb-blob b3" />
        <span class="avorb-blob b4" />
      </div>
    </div>
  );
}
