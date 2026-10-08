// Sons de interface sintetizados (sem arquivos) e uma trilha simples para músicas sem gravação.
window.TIE = window.TIE || {};
(function () {
  let ctx = null, master = null;
  function ac() { if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); master = ctx.createGain(); master.gain.value = .9; master.connect(ctx.destination); } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const on = () => TIE.store && TIE.store.s.settings.sound;
  function tone(freq, dur, o) {
    const c = ac(); if (!c) return; o = Object.assign({ type: 'sine', vol: .05, when: 0, to: null, attack: .005, dest: master }, o);
    const t = c.currentTime + o.when, osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type; osc.frequency.setValueAtTime(freq, t); if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.vol, t + o.attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    osc.connect(g); g.connect(o.dest); osc.start(t); osc.stop(t + dur + .02);
  }
  let nb = null;
  function noise(dur, o) {
    const c = ac(); if (!c) return; o = Object.assign({ vol: .05, when: 0, hp: 1000, dest: master }, o);
    if (!nb) { nb = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t = c.currentTime + o.when, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = nb; f.type = 'highpass'; f.frequency.value = o.hp; g.gain.setValueAtTime(o.vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(o.dest); s.start(t); s.stop(t + dur + .02);
  }
  const sfx = {
    tick() { if (on()) tone(1800, .03, { vol: .015 }); },
    ok() { if (!on()) return; tone(660, .12, { type: 'triangle', vol: .07 }); tone(990, .2, { type: 'triangle', vol: .07, when: .09 }); },
    soft() { if (on()) tone(520, .16, { type: 'triangle', vol: .05, to: 440 }); },
    points() { if (!on()) return; [880, 1175, 1480].forEach((f, i) => tone(f, .12, { type: 'triangle', vol: .06, when: i * .07 })); },
    level() { if (!on()) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, .25, { type: 'triangle', vol: .07, when: i * .12 })); },
    rec() { if (on()) tone(880, .08, { vol: .06 }); },
    done() { if (!on()) return; tone(440, .3, { type: 'triangle', vol: .06 }); tone(554, .3, { type: 'triangle', vol: .06, when: .1 }); tone(659, .5, { type: 'triangle', vol: .06, when: .2 }); }
  };
  // Trilha I–V–vi–IV com bateria eletrônica, para músicas sem mp3.
  const synth = {
    playing: false, timer: 0, step: 0, next: 0, bus: null,
    play(opt) {
      const c = ac(); if (!c) return; this.stop();
      const bpm = opt.bpm || 110, root = 45 + (opt.key || 0), s16 = 60 / bpm / 4;
      this.playing = true; this.step = 0; this.next = c.currentTime + .08;
      const bus = c.createGain(); bus.gain.value = on() ? .7 : 0; bus.connect(master); this.bus = bus;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(bus);
      const hz = (m) => 440 * Math.pow(2, (m - 69) / 12), CH = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];
      const tick = () => {
        while (this.next < c.currentTime + .12) {
          const st = this.step, when = this.next - c.currentTime, chord = CH[Math.floor(st / 16) % 4], i = st % 16;
          if (i % 4 === 0) tone(150, .18, { vol: .3, to: 42, when, dest: bus });
          if (i === 4 || i === 12) noise(.16, { vol: .14, hp: 1400, when, dest: bus });
          if (i % 2 === 0) noise(.035, { vol: .04, hp: 7000, when, dest: bus });
          if (i % 2 === 0) tone(hz(root - 12 + chord[0]), s16 * 1.8, { type: 'sawtooth', vol: .06, when, dest: lp });
          tone(hz(root + 12 + chord[i % 3] + (i % 6 === 5 ? 12 : 0)), s16 * .9, { type: 'square', vol: .025, when, dest: lp });
          if (i === 0) chord.forEach((n) => tone(hz(root + n), s16 * 15, { type: 'triangle', vol: .03, when, attack: .08, dest: lp }));
          this.step++; this.next += s16;
        }
      };
      tick(); this.timer = setInterval(tick, 40);
    },
    stop() { this.playing = false; clearInterval(this.timer); if (this.bus) { try { this.bus.gain.value = 0; this.bus.disconnect(); } catch (e) {} this.bus = null; } }
  };
  TIE.sound = { sfx, synth, ac };
})();
