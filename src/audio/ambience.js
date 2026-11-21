// Procedural ambient soundscape (Web Audio, no sound files): surf, wind,
// birds and insects in the jungle, muffled rumble and bubbles underwater.
// Starts muted; browsers only allow audio after a user gesture anyway.

// Muffle low-pass cutoff (Hz), indexed by the underwater flag: open air, then underwater.
const MUFFLE_CUTOFF = [18_000, 420],
  // Uniform draws in [0, 1); they only jitter the sound (noise, loop offsets, bird and bubble timing, pitch and pan).
  // eslint-disable-next-line sonarjs/pseudo-random -- audio jitter only, nothing secret or reproducible depends on it
  chance = () => Math.random(),
  // One chirp note: a pitch glide under a short attack and exponential decay.
  chirpNote = (oscillator, envelope, start, pitch) => {
    oscillator.frequency.setValueAtTime(pitch, start);
    oscillator.frequency.exponentialRampToValueAtTime(pitch * (0.7 + chance() * 0.8), start + 0.07);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(0.05, start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0005, start + 0.08);
  },
  noiseBuffer = (context, seconds = 3) => {
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate),
      data = buffer.getChannelData(0);
    let pink = 0;
    for (let index = 0; index < data.length; index += 1) {
      pink = 0.97 * pink + 0.03 * (chance() * 2 - 1);
      data[index] = pink * 3 + (chance() * 2 - 1) * 0.15;
    }
    return buffer;
  };

class Ambience {
  #noise;
  context;
  on = false;
  nextBird = 0;
  nextBubble = 0;
  master;
  muffle;
  surf;
  wind;
  insects;
  rumble;
  birdBus;
  bubbleBus;

  // A looping noise source starting at a random point of the shared buffer.
  #source() {
    const source = this.context.createBufferSource();
    source.buffer = this.#noise;
    source.loop = true;
    source.loopStart = chance();
    source.start(0, chance() * 2);
    return source;
  }

  #filter(type, frequency, q = 0.7) {
    const node = this.context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  #gain(value = 0) {
    const node = this.context.createGain();
    node.gain.value = value;
    return node;
  }

  // Surf: two detuned noise layers with slowly breathing gain; wind: one band of noise.
  #startSurfAndWind() {
    this.surf = this.#gain();
    this.#source().connect(this.#filter('lowpass', 520)).connect(this.surf);
    this.#source()
      .connect(this.#filter('bandpass', 1400, 0.4))
      .connect(this.#gain(0.25))
      .connect(this.surf);
    this.surf.connect(this.muffle);

    this.wind = this.#gain();
    this.#source()
      .connect(this.#filter('bandpass', 380, 0.6))
      .connect(this.wind)
      .connect(this.muffle);
  }

  // Insects: a narrow high band of noise under a 13 Hz tremolo.
  #startInsects() {
    this.insects = this.#gain();
    const band = this.#filter('bandpass', 5200, 9),
      lfo = this.context.createOscillator(),
      tremolo = this.#gain(0.5),
      tremoloDepth = this.#gain(0.5);
    lfo.frequency.value = 13;
    lfo.connect(tremoloDepth).connect(tremolo.gain);
    lfo.start();
    this.#source().connect(band).connect(tremolo).connect(this.insects).connect(this.muffle);
  }

  #setLevels(t, m, underwater, night) {
    const nearSea = 1 - m.aer * 0.6,
      set = (parameter, value) => parameter.setTargetAtTime(value, t, 0.5),
      swell = 0.6 + 0.4 * Math.sin(t * 0.55) * Math.sin(t * 0.21 + 1);
    set(this.surf.gain, (0.5 * nearSea * swell + 0.08) * (1 - underwater * 0.7));
    set(this.wind.gain, 0.08 + m.aer * 0.35 + m.glide * 0.1);
    set(this.insects.gain, m.land * (0.03 + night * 0.09) * (1 - underwater));
    set(this.rumble.gain, underwater * 0.5);
    set(this.muffle.frequency, MUFFLE_CUTOFF[underwater]);
    set(this.birdBus.gain, m.land * (1 - night * 0.85) + m.glide * 0.2);
    set(this.bubbleBus.gain, underwater);
  }

  #scheduleBirds(t, m) {
    if (t <= this.nextBird) return;
    if (m.land > 0.2 || m.glide > 0.5) this.chirp(t + 0.05, 1800 + chance() * 2200);
    this.nextBird = t + 0.8 + chance() * 3.5;
  }

  #scheduleBubbles(t) {
    if (t <= this.nextBubble) return;
    const count = 1 + Math.floor(chance() * 4);
    for (let index = 0; index < count; index += 1) this.bubble(t + index * (0.05 + chance() * 0.1));
    this.nextBubble = t + 1.5 + chance() * 5;
  }

  start() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.context = new AudioContextClass();
    this.#noise = noiseBuffer(this.context);

    this.master = this.#gain();
    this.muffle = this.#filter('lowpass', MUFFLE_CUTOFF[0], 0.5);
    this.muffle.connect(this.master).connect(this.context.destination);

    this.#startSurfAndWind();
    this.#startInsects();

    this.rumble = this.#gain();
    this.#source().connect(this.#filter('lowpass', 140)).connect(this.rumble).connect(this.master);

    this.birdBus = this.#gain();
    this.birdBus.connect(this.muffle);
    this.bubbleBus = this.#gain();
    this.bubbleBus.connect(this.master);
  }

  toggle() {
    if (!this.context) this.start();
    this.on = !this.on;
    this.context.resume();
    const t = this.context.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(Number(this.on) * 0.9, t, 0.6);
    return this.on;
  }

  chirp(t, base) {
    const { context } = this,
      envelope = context.createGain(),
      notes = 2 + Math.floor(chance() * 4),
      oscillator = context.createOscillator();
    oscillator.type = 'sine';
    envelope.gain.value = 0;
    for (let note = 0; note < notes; note += 1) {
      const start = t + note * (0.09 + chance() * 0.05);
      chirpNote(oscillator, envelope, start, base * (1 + chance() * 0.4));
    }
    let output = oscillator.connect(envelope);
    if (context.createStereoPanner) {
      const panner = context.createStereoPanner();
      panner.pan.value = chance() * 1.6 - 0.8;
      output = output.connect(panner);
    }
    output.connect(this.birdBus);
    oscillator.start(t);
    oscillator.stop(t + notes * 0.15 + 0.2);
  }

  bubble(t) {
    const { context } = this,
      envelope = context.createGain(),
      oscillator = context.createOscillator(),
      pitch = 300 + chance() * 500;
    oscillator.frequency.setValueAtTime(pitch, t);
    oscillator.frequency.exponentialRampToValueAtTime(pitch * 2.5, t + 0.12);
    envelope.gain.setValueAtTime(0, t);
    envelope.gain.linearRampToValueAtTime(0.04, t + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
    oscillator.connect(envelope).connect(this.bubbleBus);
    oscillator.start(t);
    oscillator.stop(t + 0.2);
  }

  update(dt, shot, environment) {
    if (!this.context || !this.on) return;
    const t = this.context.currentTime,
      underwater = Number(Boolean(shot.underwater));
    this.#setLevels(t, shot.modes, underwater, environment.night);
    this.#scheduleBirds(t, shot.modes);
    if (underwater) this.#scheduleBubbles(t);
  }
}

export { Ambience };
