// core/agentWorklet.js: the microphone capture keeps streaming. Its first version posted one chunk and
// went quiet (a transferred buffer reads length 0), so the agent never heard the learner.
import { beforeAll, describe, expect, it } from 'vitest';

interface Processor {
  process(inputs: Float32Array[][]): boolean;
}
type ProcessorClass = new (options: unknown) => Processor;

const posted: ArrayBuffer[] = [];
let Capture: ProcessorClass;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = 48_000;
  g.AudioWorkletProcessor = class {
    port = {
      // Like the real port: the transferred buffer is detached on this side.
      postMessage: (buf: ArrayBuffer, transfer: ArrayBuffer[]) => posted.push(structuredClone(buf, { transfer })),
    };
  };
  g.registerProcessor = (_name: string, cls: ProcessorClass) => {
    Capture = cls;
  };
  // @ts-expect-error -- a plain JS worklet module (registerProcessor), with no type declarations.
  await import('../src/core/agentWorklet.js');
});

/** One second of a 220 Hz tone at 48 kHz, in 128-sample render quanta. */
function feed(p: Processor, seconds: number): void {
  const quantum = 128;
  for (let at = 0; at < 48_000 * seconds; at += quantum) {
    const ch = new Float32Array(quantum);
    for (let i = 0; i < quantum; i++) ch[i] = 0.3 * Math.sin((2 * Math.PI * 220 * (at + i)) / 48_000);
    p.process([[ch]]);
  }
}

describe('agentWorklet (tie-pcm-capture)', () => {
  it('streams 16 kHz PCM continuously in 25 ms chunks', () => {
    posted.length = 0;
    const p = new Capture({ processorOptions: { rate: 16_000 } });
    feed(p, 1);
    expect(posted.length).toBe(40);
    for (const buf of posted) expect(buf.byteLength).toBe(400 * 2);
    const peak = Math.max(...posted.flatMap((b) => [...new Int16Array(b)].map(Math.abs)));
    expect(peak).toBeGreaterThan(9000);
  });
});
