// core/elevenAgent.ts: the ElevenLabs agent protocol over a fake WebSocket and a fake Web Audio graph.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentEvents,
  base64ToSamples,
  cleanAgentText,
  connectAgent,
  pcmRate,
  pcmToBase64,
} from '../src/core/elevenAgent';

type Listener = (e: unknown) => void;

class FakeWS {
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeWS | null = null;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  private ls = new Map<string, Set<Listener>>();
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeWS.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }
  addEventListener(t: string, fn: Listener, opts?: { once?: boolean }) {
    const wrapped: Listener = opts?.once
      ? (e) => {
          this.removeEventListener(t, wrapped);
          fn(e);
        }
      : fn;
    if (!this.ls.has(t)) this.ls.set(t, new Set());
    this.ls.get(t)?.add(wrapped);
  }
  removeEventListener(t: string, fn: Listener) {
    this.ls.get(t)?.delete(fn);
  }
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code;
    this.emit('close', { code, reason });
  }
  emit(t: string, e: unknown) {
    for (const fn of [...(this.ls.get(t) ?? [])]) fn(e);
  }
  msg(o: unknown) {
    this.emit('message', { data: JSON.stringify(o) });
  }
}

const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

interface FakeSource {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}

class FakeCtx {
  static last: FakeCtx | null = null;
  state = 'running';
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  sources: FakeSource[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  constructor() {
    FakeCtx.last = this;
  }
  createMediaStreamSource() {
    return node();
  }
  createGain() {
    return { ...node(), gain: { value: 1 } };
  }
  createAnalyser() {
    return { ...node(), fftSize: 512, getFloatTimeDomainData: (a: Float32Array) => a.fill(0.1) };
  }
  createBuffer(_ch: number, len: number, rate: number) {
    return { duration: len / rate, copyToChannel: vi.fn() };
  }
  createBufferSource() {
    const s = { ...node(), buffer: null, onended: null, start: vi.fn(), stop: vi.fn() } as FakeSource;
    this.sources.push(s);
    return s;
  }
}

class FakeWorklet {
  static last: FakeWorklet | null = null;
  port: { onmessage: ((e: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    _ctx: unknown,
    readonly name: string,
    readonly opts: { processorOptions: { rate: number } },
  ) {
    FakeWorklet.last = this;
  }
}

const track = { stop: vi.fn(), enabled: true };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
const META = {
  type: 'conversation_initiation_metadata',
  conversation_initiation_metadata_event: {
    conversation_id: 'conv_test',
    agent_output_audio_format: 'pcm_16000',
    user_input_audio_format: 'pcm_16000',
  },
};

function events(): AgentEvents & { log: unknown[][] } {
  const log: unknown[][] = [];
  return {
    log,
    onUser: (t) => log.push(['user', t]),
    onAgent: (t) => log.push(['agent', t]),
    onAgentCorrection: (a, b) => log.push(['correction', a, b]),
    onSpeaking: (on) => log.push(['speaking', on]),
    onLevel: () => {},
    onEnd: (r) => log.push(['end', r]),
  };
}

/** connectAgent up to the agent's metadata. */
async function connected(ev = events()) {
  const p = connectAgent(
    { url: 'wss://api.elevenlabs.io/v1/convai/conversation?x=1', variables: { student_name: 'Ana' }, stream },
    ev,
  );
  await vi.waitFor(() => expect(FakeWS.last?.readyState).toBe(1));
  FakeWS.last?.msg(META);
  const call = await p;
  return { call, ws: FakeWS.last as FakeWS, ctx: FakeCtx.last as FakeCtx, ev };
}

beforeEach(() => {
  FakeWS.last = null;
  FakeCtx.last = null;
  track.stop.mockReset();
  track.enabled = true;
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('AudioWorkletNode', FakeWorklet);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent helpers', () => {
  it('drops ElevenLabs audio tags from the transcript', () => {
    expect(cleanAgentText('[laughs] Oh, really?  [sighs]Tell me more.')).toBe('Oh, really? Tell me more.');
  });

  it('reads PCM rates and refuses μ-law', () => {
    expect(pcmRate('pcm_16000')).toBe(16000);
    expect(pcmRate(undefined)).toBe(16000);
    expect(() => pcmRate('ulaw_8000')).toThrow();
  });

  it('round-trips 16-bit little-endian PCM through base64', () => {
    const pcm = new Int16Array([0, 16384, -16384, 32767, -32768]);
    const samples = base64ToSamples(pcmToBase64(pcm.buffer));
    expect([...samples]).toEqual([0, 0.5, -0.5, 32767 / 32768, -1]);
  });
});

describe('connectAgent', () => {
  it('speaks the convai protocol: client data, microphone chunks, pong, transcript and audio', async () => {
    const { call, ws, ctx, ev } = await connected();
    expect(ws.protocols).toEqual(['convai']);
    expect(ws.sent[0]).toEqual({
      type: 'conversation_initiation_client_data',
      dynamic_variables: { student_name: 'Ana' },
    });
    expect(call.conversationId).toBe('conv_test');
    expect(FakeWorklet.last?.opts.processorOptions.rate).toBe(16000);

    FakeWorklet.last?.port.onmessage?.({ data: new Int16Array([1, 2]).buffer });
    expect(ws.sent.at(-1)).toEqual({ user_audio_chunk: pcmToBase64(new Int16Array([1, 2]).buffer) });

    ws.msg({ type: 'ping', ping_event: { event_id: 7 } });
    expect(ws.sent.at(-1)).toEqual({ type: 'pong', event_id: 7 });

    ws.msg({ type: 'agent_response', agent_response_event: { agent_response: '[warmly] Hello! What’s your name?' } });
    ws.msg({ type: 'user_transcript', user_transcription_event: { user_transcript: ' My name is Ana. ' } });
    const chunk = pcmToBase64(new Int16Array(160).buffer);
    ws.msg({ type: 'audio', audio_event: { audio_base_64: chunk, event_id: 3 } });
    expect(ctx.sources).toHaveLength(1);
    expect(ev.log).toEqual([
      ['agent', 'Hello! What’s your name?'],
      ['user', 'My name is Ana.'],
      ['speaking', true],
    ]);

    // The learner talks over the agent: queued audio stops, and late chunks of the cut line are dropped.
    ws.msg({ type: 'interruption', interruption_event: { event_id: 5 } });
    expect(ctx.sources[0]?.stop).toHaveBeenCalled();
    ws.msg({ type: 'audio', audio_event: { audio_base_64: chunk, event_id: 4 } });
    expect(ctx.sources).toHaveLength(1);
    ws.msg({ type: 'audio', audio_event: { audio_base_64: chunk, event_id: 5 } });
    expect(ctx.sources).toHaveLength(2);

    call.sendText('Slowly, please.');
    expect(ws.sent.at(-1)).toEqual({ type: 'user_message', text: 'Slowly, please.' });
    call.setMuted(true);
    expect(track.enabled).toBe(false);

    await call.end();
    expect(ws.closedWith).toBe(1000);
    expect(track.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    // Hanging up ourselves is not an "end" event.
    expect(ev.log.some(([k]) => k === 'end')).toBe(false);
    await call.end();
  });

  it('reports a dropped connection, and an agent hang-up', async () => {
    const a = await connected();
    a.ws.close(1006, 'gone');
    expect(a.ev.log.at(-1)).toEqual(['end', 'error']);
    expect(track.stop).toHaveBeenCalled();

    const b = await connected();
    b.ws.close(1000);
    expect(b.ev.log.at(-1)).toEqual(['end', 'agent']);
  });

  it('fails and releases the audio when the socket closes before the agent answers', async () => {
    const p = connectAgent({ url: 'wss://api.elevenlabs.io/x', variables: {}, stream }, events());
    await vi.waitFor(() => expect(FakeWS.last?.readyState).toBe(1));
    FakeWS.last?.close(1008, 'invalid signature');
    await expect(p).rejects.toThrow('invalid signature');
    expect(FakeCtx.last?.close).toHaveBeenCalled();
  });
});
