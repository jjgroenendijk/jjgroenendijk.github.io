// Procedural ambient soundscape (Web Audio, no sound files): surf, wind,
// birds and insects in the jungle, muffled rumble and bubbles underwater.
// Starts muted; browsers only allow audio after a user gesture anyway.

function noiseBuffer(ctx, seconds = 3) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  let pink = 0;
  for (let i = 0; i < d.length; i++) {
    pink = 0.97 * pink + 0.03 * (Math.random() * 2 - 1);
    d[i] = pink * 3 + (Math.random() * 2 - 1) * 0.15;
  }
  return b;
}

export class Ambience {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.nextBird = 0;
    this.nextBubble = 0;
  }

  start() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const noise = noiseBuffer(ctx);
    const src = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.loopStart = Math.random();
      s.start(0, Math.random() * 2);
      return s;
    };
    const filter = (type, f, q = 0.7) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    };
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };

    this.master = gain(0);
    this.muffle = filter('lowpass', 18000, 0.5);
    this.muffle.connect(this.master).connect(ctx.destination);

    // surf: two detuned noise layers with slowly breathing gain
    this.surf = gain(0);
    src().connect(filter('lowpass', 520)).connect(this.surf);
    src()
      .connect(filter('bandpass', 1400, 0.4))
      .connect(gain(0.25))
      .connect(this.surf);
    this.surf.connect(this.muffle);

    this.wind = gain(0);
    src()
      .connect(filter('bandpass', 380, 0.6))
      .connect(this.wind)
      .connect(this.muffle);

    this.insects = gain(0);
    const ins = filter('bandpass', 5200, 9);
    const trem = gain(0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 13;
    const lfoAmt = gain(0.5);
    lfo.connect(lfoAmt).connect(trem.gain);
    lfo.start();
    src().connect(ins).connect(trem).connect(this.insects).connect(this.muffle);

    this.rumble = gain(0);
    src().connect(filter('lowpass', 140)).connect(this.rumble).connect(this.master);

    this.birdBus = gain(0.0);
    this.birdBus.connect(this.muffle);
    this.bubbleBus = gain(0.0);
    this.bubbleBus.connect(this.master);
  }

  toggle() {
    if (!this.ctx) this.start();
    this.on = !this.on;
    this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, t, 0.6);
    return this.on;
  }

  chirp(t, base) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    const notes = 2 + Math.floor(Math.random() * 4);
    o.type = 'sine';
    g.gain.value = 0;
    for (let i = 0; i < notes; i++) {
      const s = t + i * (0.09 + Math.random() * 0.05);
      const f = base * (1 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.8), s + 0.07);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.05, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, s + 0.08);
    }
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = Math.random() * 1.6 - 0.8;
      o.connect(g).connect(pan).connect(this.birdBus);
    } else o.connect(g).connect(this.birdBus);
    o.start(t);
    o.stop(t + notes * 0.15 + 0.2);
  }

  bubble(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    const f = 300 + Math.random() * 500;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 2.5, t + 0.12);
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.04, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
    o.connect(g).connect(this.bubbleBus);
    o.start(t);
    o.stop(t + 0.2);
  }

  update(dt, shot, env) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const m = shot.modes;
    const uw = shot.underwater ? 1 : 0;
    const swell = 0.6 + 0.4 * Math.sin(t * 0.55) * Math.sin(t * 0.21 + 1);
    const nearSea = 1 - m.aer * 0.6;
    const set = (p, v) => p.setTargetAtTime(v, t, 0.5);
    set(this.surf.gain, (0.5 * nearSea * swell + 0.08) * (1 - uw * 0.7));
    set(this.wind.gain, 0.08 + m.aer * 0.35 + m.glide * 0.1);
    set(this.insects.gain, m.land * (0.03 + env.night * 0.09) * (1 - uw));
    set(this.rumble.gain, uw * 0.5);
    set(this.muffle.frequency, uw ? 420 : 18000);
    set(this.birdBus.gain, m.land * (1 - env.night * 0.85) + m.glide * 0.2);
    set(this.bubbleBus.gain, uw);
    if (t > this.nextBird) {
      if (m.land > 0.2 || m.glide > 0.5) this.chirp(t + 0.05, 1800 + Math.random() * 2200);
      this.nextBird = t + 0.8 + Math.random() * 3.5;
    }
    if (uw && t > this.nextBubble) {
      const n = 1 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this.bubble(t + i * (0.05 + Math.random() * 0.1));
      this.nextBubble = t + 1.5 + Math.random() * 5;
    }
  }
}
