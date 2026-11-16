// Procedural sound: every effect is synthesised with WebAudio, no audio files.
// A shared noise buffer plus small oscillator envelopes cover shots, reloads,
// hits, the plant beep, the explosion and the round sting.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(dur, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gainValue, type = 'square', slideTo = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    shot(kind) {
      if (kind === 'sniper') {
        noise(0.22, 900, 0.9);
        tone(160, 0.16, 0.5, 'sawtooth', 55);
      } else if (kind === 'shotgun') {
        noise(0.28, 700, 1.0);
        tone(120, 0.2, 0.55, 'sawtooth', 45);
      } else if (kind === 'smg') {
        noise(0.09, 1400, 0.55);
        tone(210, 0.07, 0.3, 'square', 90);
      } else if (kind === 'pistol') {
        noise(0.12, 1100, 0.7);
        tone(190, 0.09, 0.35, 'square', 80);
      } else {
        noise(0.13, 1000, 0.8);
        tone(170, 0.11, 0.4, 'sawtooth', 60);
      }
    },
    distantShot() {
      noise(0.14, 500, 0.28);
    },
    dryClick() {
      tone(1400, 0.04, 0.2, 'square');
    },
    reload() {
      tone(700, 0.05, 0.22, 'square');
      setTimeout(() => tone(500, 0.05, 0.22, 'square'), 260);
      setTimeout(() => tone(900, 0.05, 0.25, 'square'), 520);
    },
    hit(kill) {
      tone(kill ? 1180 : 880, 0.07, 0.3, 'sine');
      if (kill) setTimeout(() => tone(1560, 0.09, 0.3, 'sine'), 70);
    },
    hurt() {
      tone(140, 0.18, 0.4, 'sawtooth', 70);
      noise(0.12, 400, 0.3);
    },
    beep(final) {
      tone(final ? 1320 : 990, final ? 0.3 : 0.12, 0.3, 'sine');
    },
    plant() {
      tone(660, 0.1, 0.3, 'sine');
      setTimeout(() => tone(660, 0.1, 0.3, 'sine'), 140);
      setTimeout(() => tone(990, 0.18, 0.3, 'sine'), 280);
    },
    explosion() {
      noise(0.9, 320, 1.0);
      tone(90, 0.7, 0.7, 'sine', 32);
    },
    roundStart() {
      tone(523, 0.12, 0.25, 'triangle');
      setTimeout(() => tone(784, 0.18, 0.25, 'triangle'), 130);
    },
    roundEnd(win) {
      if (win) {
        tone(523, 0.14, 0.25, 'triangle');
        setTimeout(() => tone(659, 0.14, 0.25, 'triangle'), 140);
        setTimeout(() => tone(784, 0.26, 0.28, 'triangle'), 280);
      } else {
        tone(392, 0.18, 0.25, 'triangle');
        setTimeout(() => tone(311, 0.3, 0.25, 'triangle'), 180);
      }
    },
    buy() {
      tone(1046, 0.06, 0.22, 'sine');
      setTimeout(() => tone(1318, 0.08, 0.22, 'sine'), 60);
    },
    deny() {
      tone(220, 0.12, 0.25, 'square', 160);
    },
  };
}
