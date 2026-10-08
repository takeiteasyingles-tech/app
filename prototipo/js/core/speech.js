// Voz: falar (voz gratuita do navegador, com boca sincronizada), ouvir (Web Speech API) e gravar WAV.
window.TIE = window.TIE || {};
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasTTS = 'speechSynthesis' in window;
  const MALE = /^(Lucas|Zach|Rafael|Kenji|Sam|Conductor|Stranger|Robert|Bean)$/i;
  let voices = [];
  function loadVoices() { if (hasTTS) voices = window.speechSynthesis.getVoices().filter((v) => /^en(-|_)US/i.test(v.lang) || /^en$/i.test(v.lang)); }
  if (hasTTS) { loadVoices(); window.speechSynthesis.onvoiceschanged = loadVoices; }
  function pickVoice(gender) {
    if (!voices.length) loadVoices();
    const prefs = gender === 'male' ? [/Andrew.*Natural|Guy.*Natural|Christopher.*Natural|Brian.*Natural/i, /Google US English Male|Guy|Davis|David|Mark|Alex|Fred/i] : [/Aria.*Natural|Jenny.*Natural|Ava.*Natural|Emma.*Natural|Michelle.*Natural/i, /Google US English|Samantha|Zira|Allison|Victoria/i];
    for (const re of prefs) { const v = voices.find((x) => re.test(x.name)); if (v) return v; }
    return voices[0] || null;
  }
  const VIS = (ch) => { ch = (ch || '').toLowerCase(); if ('aá'.includes(ch)) return 'a'; if ('oóuú'.includes(ch)) return 'o'; if ('eéiíy'.includes(ch)) return 'e'; if ('mbp'.includes(ch)) return 'm'; if (/[a-z]/.test(ch)) return 'e'; return 'rest'; };
  let current = null;
  function stop() { if (current) { current.cancelled = true; clearInterval(current.timer); cancelAnimationFrame(current.raf || 0); try { current.src && current.src.stop(); } catch (e) {} current.mouth && current.mouth('rest'); current.resolve && current.resolve(); current = null; } if (hasTTS) window.speechSynthesis.cancel(); }
  async function say(text, opt) {
    stop();
    // Personagens da série (assistentes do Mic e falas dos episódios) têm tom e voz HD próprios; o padrão é o assistente escolhido.
    const o = Object.assign({ rate: 1, who: TIE.assist ? TIE.assist.cur().name : 'Maggie' }, opt), prof = TIE.assist && TIE.assist.byName(o.who), vo = prof ? prof.voice : null, gender = vo ? vo.gender : MALE.test(o.who) ? 'male' : 'female';
    const job = { mouth: o.mouth, cancelled: false }; current = job;
    if (TIE.store.s.settings.hd && TIE.ai && TIE.ai.online) { try { const buf = await TIE.ai.tts(text, gender, vo && vo.tts); if (job.cancelled) return; if (buf) return await playBuffer(buf, job, o); } catch (e) {} }
    return new Promise((resolve) => {
      job.resolve = resolve;
      const end = () => { if (job.cancelled) return; clearInterval(job.timer); o.mouth && o.mouth('rest'); if (current === job) current = null; resolve(); };
      const cps = 13.5 * o.rate; let base = 0, t0 = 0;
      const flap = () => { if (!o.mouth) return; const pos = Math.floor(base + (performance.now() - t0) / 1000 * cps); const ch = text[pos]; o.mouth(ch == null ? 'rest' : (pos % 3 === 2 ? 'm' : VIS(ch))); };
      const startFlap = () => { t0 = performance.now(); o.onStart && o.onStart(); job.timer = setInterval(flap, 85); };
      if (!hasTTS) { startFlap(); setTimeout(end, Math.max(900, text.length / cps * 1000)); return; }
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.95 * o.rate * (vo ? vo.rate : 1); u.pitch = vo ? vo.pitch : gender === 'male' ? .95 : 1.05;
      const pref = vo && vo.prefer ? voices.find((x) => new RegExp(vo.prefer, 'i').test(x.name)) : null, v = pref || pickVoice(gender); if (v) u.voice = v; if (pref) { u.pitch = vo.preferPitch; u.rate = 0.95 * o.rate * vo.preferRate; }
      u.onstart = startFlap; u.onboundary = (e) => { if (typeof e.charIndex === 'number') { base = e.charIndex; t0 = performance.now(); } }; u.onend = end; u.onerror = end;
      setTimeout(() => { if (current === job && !window.speechSynthesis.speaking) end(); }, Math.max(2500, text.length / cps * 1000 + 2500));
      window.speechSynthesis.speak(u);
    });
  }
  function playBuffer(arrayBuf, job, o) {
    return new Promise(async (resolve) => {
      const c = TIE.sound.ac(); const audio = await c.decodeAudioData(arrayBuf.slice(0)); if (job.cancelled) return resolve();
      const src = c.createBufferSource(); src.buffer = audio; src.playbackRate.value = o.rate;
      const an = c.createAnalyser(); an.fftSize = 512; src.connect(an); an.connect(c.destination); job.src = src; job.resolve = resolve;
      const data = new Uint8Array(an.fftSize);
      const loop = () => { an.getByteTimeDomainData(data); let sum = 0; for (let i = 0; i < data.length; i++) { const x = (data[i] - 128) / 128; sum += x * x; } const rms = Math.sqrt(sum / data.length); o.mouth && o.mouth(rms < .02 ? 'rest' : rms < .06 ? 'e' : rms < .11 ? 'o' : 'a'); job.raf = requestAnimationFrame(loop); };
      src.onended = () => { cancelAnimationFrame(job.raf); o.mouth && o.mouth('rest'); if (current === job) current = null; resolve(); };
      o.onStart && o.onStart(); src.start(); loop();
    });
  }
  function listen(h) {
    if (!SR) { h.onError && h.onError('unsupported'); return { stop() {} }; }
    const r = new SR(); r.lang = 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1; let finalText = '';
    r.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; } h.onInterim && h.onInterim((finalText + ' ' + interim).trim()); };
    r.onerror = (e) => { h.onError && h.onError(e.error || 'error'); };
    r.onend = () => { h.onEnd && h.onEnd(finalText.trim()); if (finalText.trim()) h.onFinal && h.onFinal(finalText.trim()); };
    try { r.start(); } catch (e) { h.onError && h.onError('busy'); }
    return { stop() { try { r.stop(); } catch (e) {} } };
  }
  async function record(h) {
    const o = Object.assign({ maxMs: 8000 }, h);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const c = TIE.sound.ac(), srcNode = c.createMediaStreamSource(stream), an = c.createAnalyser(); an.fftSize = 1024; srcNode.connect(an);
    const data = new Uint8Array(an.fftSize); let raf = 0;
    const meter = () => { an.getByteTimeDomainData(data); let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128); o.onLevel && o.onLevel(Math.min(1, peak * 1.6)); raf = requestAnimationFrame(meter); };
    meter();
    const chunks = [], mr = new MediaRecorder(stream); mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const t0 = performance.now(); mr.start(); let resolveStop; const stopped = new Promise((r) => { resolveStop = r; });
    mr.onstop = async () => {
      cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); srcNode.disconnect();
      try { const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' }); const audio = await c.decodeAudioData(await blob.arrayBuffer()); resolveStop({ b64: await b64(await toWav16k(audio)), secs: (performance.now() - t0) / 1000 }); }
      catch (e) { resolveStop({ b64: '', secs: 0, error: String(e) }); }
    };
    const timer = setTimeout(() => mr.state === 'recording' && mr.stop(), o.maxMs);
    return { stop() { clearTimeout(timer); if (mr.state === 'recording') mr.stop(); return stopped; } };
  }
  async function toWav16k(audio) {
    const rate = 16000, len = Math.ceil(audio.duration * rate), off = new OfflineAudioContext(1, len, rate), s = off.createBufferSource(); s.buffer = audio; s.connect(off.destination); s.start();
    const pcm = (await off.startRendering()).getChannelData(0), buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new Blob([buf], { type: 'audio/wav' });
  }
  const b64 = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
  TIE.speech = { say, stop, listen, record, canListen: !!SR, canRecord: !!(navigator.mediaDevices && window.MediaRecorder), hasTTS, VIS };
})();
