// PROD (spec 05 "Mic avatar per assistant"): a Mic conversation held by the assistant's ElevenLabs agent,
// spoken over the agent's WebSocket protocol (subprotocol "convai") without the SDK: the official client
// pulls in WebRTC and loads its audio worklets from blob: URLs, which the CSP forbids. The server hands
// out a one-time signed URL (POST /api/mic/sessions/:id/agent); this file streams the microphone up as
// 16-bit PCM (agentWorklet.js), plays the agent's PCM through Web Audio and reports the transcript. When
// the learner talks over the agent, the interruption drops the queued audio, as the SDK does.
import workletUrl from './agentWorklet.js?url';

export interface AgentEvents {
  /** The learner's words, as the agent's speech recognition heard them. */
  onUser(text: string): void;
  /** One line of the agent (audio tags such as "[laughs]" removed). */
  onAgent(text: string): void;
  /** The learner cut the agent's line short: what was really said of it. */
  onAgentCorrection(original: string, corrected: string): void;
  /** The agent's voice started or stopped. */
  onSpeaking(on: boolean): void;
  /** Loudness of the agent's voice, 0…1, every ~80 ms while it talks (the avatar's mouth). */
  onLevel(v: number): void;
  /** The call ended by itself: 'agent' hung up, or 'error' (connection lost). Never after end(). */
  onEnd(reason: 'agent' | 'error', detail?: string): void;
}

export interface AgentCall {
  readonly conversationId: string;
  /** Silences the microphone (the agent hears silence, so its own timeouts still apply). */
  setMuted(muted: boolean): void;
  /** A typed line, answered like a spoken one. */
  sendText(text: string): void;
  /** Hangs up; resolves once the socket closed (or after a short wait). Safe to call twice. */
  end(): Promise<void>;
}

/** From the socket opening to the agent's metadata. */
const CONNECT_MS = 15_000;
const METER_MS = 80;
const TAGS = /\[[^\]\n]{1,40}\]\s*/g;

/** Agent text without ElevenLabs audio tags ("[laughs] Oh, really?" → "Oh, really?"). */
export function cleanAgentText(t: string): string {
  return t
    .replace(TAGS, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** "pcm_16000" → 16000. Anything else (μ-law) is not spoken here. */
export function pcmRate(fmt: unknown): number {
  const m = /^pcm_(\d{4,5})$/.exec(String(fmt ?? 'pcm_16000'));
  if (!m) throw new Error(`unsupported agent audio format: ${String(fmt)}`);
  return Number(m[1]);
}

/** Little-endian 16-bit PCM bytes → base64 (user_audio_chunk). */
export function pcmToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** base64 little-endian 16-bit PCM (audio_event) → samples in −1…1. */
export function base64ToSamples(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

/** Microphone, WebSocket and AudioWorklet: what an agent conversation needs from the browser. */
export function agentSupported(): boolean {
  return (
    typeof WebSocket !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

let primed: AudioContext | null = null;

/**
 * Creates the next call's AudioContext inside the tap that starts it: iOS keeps a context created after
 * an await (the session and signed-URL requests) suspended, and the agent would be mute.
 */
export function primeAgentAudio(): void {
  if (primed && primed.state !== 'closed') return;
  try {
    primed = new AudioContext();
    void primed.resume().catch(() => {});
  } catch {
    primed = null;
  }
}

/** Drops a primed context that no call took (the agent could not start). */
export function releaseAgentAudio(): void {
  void primed?.close().catch(() => {});
  primed = null;
}

export function openMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
}

export function closeMicrophone(stream: MediaStream | null | undefined): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
}

interface InitMeta {
  conversation_id?: unknown;
  agent_output_audio_format?: unknown;
  user_input_audio_format?: unknown;
}

/** Opens the socket, sends the client data and waits for the agent's metadata. */
function handshake(ws: WebSocket, variables: Record<string, string>): Promise<InitMeta> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      fn();
    };
    const timer = setTimeout(
      () =>
        done(() => {
          try {
            ws.close();
          } catch {
            // Already closing.
          }
          reject(new Error('agent: no answer'));
        }),
      CONNECT_MS,
    );
    const onOpen = () =>
      ws.send(JSON.stringify({ type: 'conversation_initiation_client_data', dynamic_variables: variables }));
    const onMessage = (e: MessageEvent) => {
      let m: { type?: string; conversation_initiation_metadata_event?: InitMeta } | null = null;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m?.type === 'conversation_initiation_metadata') {
        const meta = m.conversation_initiation_metadata_event ?? {};
        done(() => resolve(meta));
      }
    };
    const onClose = (e: CloseEvent) => done(() => reject(new Error(e.reason || `agent: closed (${e.code})`)));
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
  });
}

interface AgentMsg {
  type?: string;
  audio_event?: { audio_base_64?: string; event_id?: number };
  agent_response_event?: { agent_response?: string };
  agent_response_correction_event?: { original_agent_response?: string; corrected_agent_response?: string };
  user_transcription_event?: { user_transcript?: string };
  interruption_event?: { event_id?: number };
  ping_event?: { event_id?: number };
}

/**
 * Starts the conversation: the microphone stream must already be open (openMicrophone), so a refused
 * permission never spends a signed URL. Throws when the agent cannot be reached.
 */
export async function connectAgent(
  opts: { url: string; variables: Record<string, string>; stream: MediaStream },
  ev: AgentEvents,
): Promise<AgentCall> {
  const ctx = primed && primed.state !== 'closed' ? primed : new AudioContext();
  primed = null;
  let ws: WebSocket | null = null;
  try {
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    await ctx.audioWorklet.addModule(workletUrl);
    ws = new WebSocket(opts.url, ['convai']);
    const meta = await handshake(ws, opts.variables);
    return wire(ctx, ws, meta, opts.stream, ev);
  } catch (err) {
    try {
      ws?.close();
    } catch {
      // Not open.
    }
    void ctx.close().catch(() => {});
    throw err;
  }
}

/** Everything after the handshake, set up in one go so no message arrives before its listener. */
function wire(ctx: AudioContext, ws: WebSocket, meta: InitMeta, stream: MediaStream, ev: AgentEvents): AgentCall {
  const inRate = pcmRate(meta.user_input_audio_format);
  const outRate = pcmRate(meta.agent_output_audio_format);
  const conversationId = typeof meta.conversation_id === 'string' ? meta.conversation_id : '';

  // Up: microphone → worklet (16-bit PCM at inRate) → user_audio_chunk. The worklet must reach the
  // destination to be pulled, through a muted gain so the learner never hears themselves.
  const mic = ctx.createMediaStreamSource(stream);
  const cap = new AudioWorkletNode(ctx, 'tie-pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    processorOptions: { rate: inRate },
  });
  const sink = ctx.createGain();
  sink.gain.value = 0;
  mic.connect(cap);
  cap.connect(sink);
  sink.connect(ctx.destination);
  cap.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ user_audio_chunk: pcmToBase64(e.data) }));
  };

  // Down: each audio_event is queued right after the previous one; an analyser drives the mouth.
  const out = ctx.createGain();
  const meter = ctx.createAnalyser();
  meter.fftSize = 512;
  out.connect(meter);
  meter.connect(ctx.destination);
  const frame = new Float32Array(meter.fftSize);
  const live = new Set<AudioBufferSourceNode>();
  let nextAt = 0;
  let lastCut = 0;
  let speaking = false;
  let meterTimer: ReturnType<typeof setInterval> | undefined;
  let ended = false;
  let closing: Promise<void> | null = null;

  const setSpeaking = (on: boolean) => {
    if (on === speaking) return;
    speaking = on;
    clearInterval(meterTimer);
    if (on) {
      meterTimer = setInterval(() => {
        meter.getFloatTimeDomainData(frame);
        let sum = 0;
        for (const v of frame) sum += v * v;
        ev.onLevel(Math.min(1, Math.sqrt(sum / frame.length) * 4));
      }, METER_MS);
    } else ev.onLevel(0);
    ev.onSpeaking(on);
  };
  const play = (b64: string) => {
    const pcm = base64ToSamples(b64);
    if (!pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, outRate);
    buf.copyToChannel(pcm, 0);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(out);
    const at = Math.max(ctx.currentTime + 0.03, nextAt);
    node.start(at);
    nextAt = at + buf.duration;
    live.add(node);
    node.onended = () => {
      live.delete(node);
      if (!live.size) setSpeaking(false);
    };
    setSpeaking(true);
  };
  const cut = () => {
    for (const n of live) {
      n.onended = null;
      try {
        n.stop();
      } catch {
        // Not started yet.
      }
    }
    live.clear();
    nextAt = 0;
    setSpeaking(false);
  };

  const teardown = () => {
    cut();
    clearInterval(meterTimer);
    cap.port.onmessage = null;
    try {
      mic.disconnect();
      cap.disconnect();
      sink.disconnect();
      out.disconnect();
      meter.disconnect();
    } catch {
      // Already disconnected.
    }
    closeMicrophone(stream);
    void ctx.close().catch(() => {});
  };

  const send = (msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.addEventListener('message', (e: MessageEvent) => {
    let m: AgentMsg;
    try {
      m = JSON.parse(String(e.data)) as AgentMsg;
    } catch {
      return;
    }
    switch (m.type) {
      case 'audio': {
        const a = m.audio_event;
        if (a?.audio_base_64 && lastCut <= (a.event_id ?? 0)) play(a.audio_base_64);
        break;
      }
      case 'agent_response': {
        const t = cleanAgentText(m.agent_response_event?.agent_response ?? '');
        if (t) ev.onAgent(t);
        break;
      }
      case 'agent_response_correction': {
        const c = m.agent_response_correction_event;
        if (c)
          ev.onAgentCorrection(
            cleanAgentText(c.original_agent_response ?? ''),
            cleanAgentText(c.corrected_agent_response ?? ''),
          );
        break;
      }
      case 'user_transcript': {
        const t = (m.user_transcription_event?.user_transcript ?? '').trim();
        if (t) ev.onUser(t);
        break;
      }
      case 'interruption':
        lastCut = m.interruption_event?.event_id ?? lastCut;
        cut();
        break;
      case 'ping':
        send({ type: 'pong', event_id: m.ping_event?.event_id });
        break;
    }
  });
  ws.addEventListener('close', (e: CloseEvent) => {
    if (ended) return;
    ended = true;
    teardown();
    ev.onEnd(e.code === 1000 ? 'agent' : 'error', e.reason || undefined);
  });

  return {
    conversationId,
    setMuted(muted) {
      for (const t of stream.getAudioTracks()) t.enabled = !muted;
    },
    sendText(text) {
      const t = text.trim();
      if (t) send({ type: 'user_message', text: t });
    },
    end() {
      if (closing) return closing;
      closing = new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(wait);
          if (!ended) {
            ended = true;
            teardown();
          }
          resolve();
        };
        const wait = setTimeout(finish, 1200);
        if (ws.readyState === WebSocket.CLOSED) return finish();
        ws.addEventListener('close', finish, { once: true });
        ended = true;
        teardown();
        try {
          ws.close(1000, 'User ended conversation');
        } catch {
          finish();
        }
      });
      return closing;
    },
  };
}
