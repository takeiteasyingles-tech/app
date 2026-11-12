import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  state: { value: { settings: { hd: false }, profile: { assistant: 'margaret' } } },
  online: { value: true },
  tts: vi.fn(),
  ac: vi.fn(),
}));
vi.mock('../src/store/state', () => ({ state: f.state }));
vi.mock('../src/store/content', () => ({
  catalog: {
    value: {
      assistants: [
        {
          k: 'margaret',
          name: 'Maggie',
          aka: ['Maggie', 'Margaret'],
          art: 'a',
          voice: { gender: 'female', pitch: 1, rate: 1, tts: 'asteria' },
        },
      ],
    },
  },
}));
vi.mock('../src/core/aiClient', () => ({ aiOnline: f.online, tts: f.tts }));
vi.mock('../src/core/sound', () => ({ ac: f.ac }));

describe('assistant speech', () => {
  let speak: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    f.state.value.settings.hd = false;
    f.online.value = true;
    f.tts.mockReset().mockResolvedValue({
      audio: new ArrayBuffer(8),
      words: [
        { s: 0.1, e: 0.4 },
        { s: 0.45, e: 0.9 },
      ],
    });
    speak = vi.fn((u: SpeechSynthesisUtterance) => u.onend?.(new Event('end') as SpeechSynthesisEvent));
    vi.stubGlobal('window', { speechSynthesis: { getVoices: () => [], cancel: vi.fn(), speak } });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const source = {
      buffer: null,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      onended: null as (() => void) | null,
      start: () => queueMicrotask(() => source.onended?.()),
      stop: vi.fn(),
    };
    f.ac.mockReturnValue({
      currentTime: 1,
      destination: {},
      decodeAudioData: async () => ({ duration: 1 }),
      createBufferSource: () => source,
      createAnalyser: () => ({ fftSize: 512, connect: vi.fn(), getByteTimeDomainData: (b: Uint8Array) => b.fill(128) }),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses Maggie’s server voice and sends audio to lip sync with profile HD off', async () => {
    const speech = await import('../src/core/speech');
    const events: import('../src/core/speech').SpeechEvent[] = [];
    const off = speech.onSpeech((e) => events.push(e));
    const saying = speech.say('Good morning.', { who: 'Maggie', hd: true, rate: 0.7 });
    await vi.runAllTimersAsync();
    await saying;
    off();
    expect(f.tts).toHaveBeenCalledWith('Good morning.', 'female', 'margaret');
    expect(speak).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        type: 'audio',
        text: 'Good morning.',
        rate: 0.7,
        words: [
          { s: 0.1, e: 0.4 },
          { s: 0.45, e: 0.9 },
        ],
      }),
      { type: 'end' },
    ]);
    expect(f.state.value.settings.hd).toBe(false);
  });

  it('inside a lesson asks for its voice: the narration, or the character by name (spec 05 "Lesson voices")', async () => {
    const speech = await import('../src/core/speech');
    speech.setLesson(7);
    try {
      const word = speech.say('Kitchen.', { hd: true });
      await vi.runAllTimersAsync();
      await word;
      expect(f.tts).toHaveBeenLastCalledWith('Kitchen.', 'female', 'margaret', { ep: 7, role: 'narrator' });
      const line = speech.say('Hello! I’m Margaret.', { who: 'Margaret', hd: true });
      await vi.runAllTimersAsync();
      await line;
      expect(f.tts).toHaveBeenLastCalledWith('Hello! I’m Margaret.', 'female', 'margaret', { ep: 7, role: 'Margaret' });
    } finally {
      speech.setLesson(null);
    }
  });

  it('keeps the profile preference for speech outside the Mic', async () => {
    const speech = await import('../src/core/speech');
    await speech.say('Hello.');
    expect(f.tts).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledOnce();
  });

  it('falls back to the browser when the server voice is unavailable', async () => {
    f.tts.mockResolvedValue(null);
    const speech = await import('../src/core/speech');
    await speech.say('Hello.', { who: 'Margaret', hd: true });
    expect(f.tts).toHaveBeenCalledWith('Hello.', 'female', 'margaret');
    expect(speak).toHaveBeenCalledOnce();
  });

  describe('external voice (Mic Assistia embed)', () => {
    it('speaks the assistant’s lines, under any of its names, instead of our voices', async () => {
      const speech = await import('../src/core/speech');
      const ext = {
        k: 'margaret',
        say: vi.fn((_t: string, onStart: () => void) => {
          onStart();
          return Promise.resolve(true);
        }),
        stop: vi.fn(),
      };
      const off = speech.setExternalVoice(ext);
      const events: import('../src/core/speech').SpeechEvent[] = [];
      const offTap = speech.onSpeech((e) => events.push(e));
      const onStart = vi.fn();
      await speech.say('Good morning.', { who: 'Margaret', hd: true, onStart });
      offTap();
      expect(ext.say).toHaveBeenCalledWith('Good morning.', expect.any(Function));
      expect(onStart).toHaveBeenCalledOnce();
      expect(f.tts).not.toHaveBeenCalled();
      expect(speak).not.toHaveBeenCalled();
      expect(events).toEqual([{ type: 'end' }]);
      off();
      await speech.say('Hello.', { who: 'Maggie' });
      expect(ext.say).toHaveBeenCalledOnce();
      expect(speak).toHaveBeenCalledOnce();
    });

    it('leaves other speakers alone', async () => {
      const speech = await import('../src/core/speech');
      const ext = { k: 'robert', say: vi.fn(() => Promise.resolve(true)), stop: vi.fn() };
      speech.setExternalVoice(ext);
      await speech.say('Hello.', { who: 'Maggie' });
      expect(ext.say).not.toHaveBeenCalled();
      expect(speak).toHaveBeenCalledOnce();
    });

    it('falls back to our voice when the line cannot start', async () => {
      const speech = await import('../src/core/speech');
      speech.setExternalVoice({ k: 'margaret', say: () => Promise.resolve(false), stop: vi.fn() });
      const saying = speech.say('Hello.', { who: 'Maggie', hd: true });
      await vi.runAllTimersAsync();
      await saying;
      expect(f.tts).toHaveBeenCalledWith('Hello.', 'female', 'margaret');
    });

    it('stop() stops the external voice and resolves the line', async () => {
      const speech = await import('../src/core/speech');
      const ext = { k: 'margaret', say: vi.fn(() => new Promise<boolean>(() => {})), stop: vi.fn() };
      speech.setExternalVoice(ext);
      const saying = speech.say('A long line.', { who: 'Maggie' });
      await Promise.resolve();
      speech.stop();
      await saying;
      expect(ext.stop).toHaveBeenCalled();
      expect(speak).not.toHaveBeenCalled();
    });
  });
});
