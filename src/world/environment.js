// Environment state: time of day, sun and moon light, ambient sky light, weather, fog and exposure.
// Everything evolves slowly so no two minutes look alike.
import { SKY_E, celestial, skyRadiance, sunTransmittance, todRate } from './sky.js';
import { W as WORLD_PERIOD } from './noise.js';
import { smoothstep } from './terrain.js';

// Colour triples are indexed by RGB channel.
const LUMA = { b: 0.0722, g: 0.7152, r: 0.2126 },
  // Sky dome samples for the ambient light.
  DOME = { azimuths: 6, elevations: 4 },
  // Moonlight relative to sunlight, its colour, and the tint of the moonlit sky.
  MOON = { light: 0.022, sky: 0.0035 },
  MOON_COLOR = { 0: 0.55, 1: 0.65, 2: 0.9 },
  MOON_SKY_TINT = { 0: 0.75, 1: 0.85, 2: 1.1 },
  // Faint skyglow that keeps nights from going black.
  NIGHT_SKY = { 0: 0.0009, 1: 0.0016, 2: 0.0034 },
  // Share of the sky light the ground bounces back, and how much of the direct light adds to it.
  GROUND_TINT = { 0: 0.32, 1: 0.36, 2: 0.28 },
  GROUND_DIRECT = 0.06,
  SUN_SCALE = 0.19,
  // Spreads the weather seed over the slow sines below.
  SEED_SPREAD = 100,
  // Cloud coverage: a base plus three slow sines of time (period s, seed phase).
  COVERAGE = {
    base: -0.15,
    fast: { amp: 0.04, period: 97, phase: 2.3 },
    mid: { amp: 0.07, period: 233, phase: 1.7 },
    slow: { amp: 0.08, period: 530 },
  },
  // Wind drift (m/s) and its seed offsets (m).
  WIND = { x: 7, xSeed: 1000, z: 3, zSeed: 700 },
  // Showers: a slow sine that only rains under enough cloud, and the shower strength where it really rains.
  SHOWER = {
    clouds: { from: -0.08, to: 0.06 },
    period: 151,
    phase: 3.1,
    rain: { from: 0.35, to: 0.75 },
    rainbowPower: 3,
  },
  // Wetness time constants (s): soaking up in a shower, and drying, which the sun speeds up.
  DRYING = { dry: 300, soak: 40, sun: 2 },
  // Morning mist: day length (s), and a per-day strength from a sine hash.
  MIST = { base: 0.2, day: 1320, hashPhase: 12.9898, hashScale: 43_758.5453, range: 0.4 },
  // Eye adaptation: target, response to the scene luminance, how far it adapts and its limits.
  EXPOSURE = { canopy: 2.6, key: 0.6, max: 40, min: 1e-5, rate: 1.5, response: 0.8, under: 0.6 },
  // Eyes adapt, but not fully: nights stay dark and blue.
  PARTIAL = { base: 0.4, power: 0.2 },
  PARTIAL_ADAPTATION = PARTIAL.base ** PARTIAL.power,
  // Fog: base density (1/m) that clouds raise, and the fog distance (m).
  FOG = { cloud: 3, density: 2.8e-5, distance: 650 },
  // Sun (or moon) heights over which each effect fades in, as smoothstep edges.
  FADES = {
    mistDawn: { from: -0.25, to: -0.02 },
    mistMorning: { from: 0.3, to: 0.06 },
    moonRise: { from: -0.05, to: 0.2 },
    moonSunset: { from: 0.05, to: -0.15 },
    night: { from: 0.02, to: -0.18 },
    nightSky: { from: 0, to: -0.2 },
    rainbowHigh: { from: 0.75, to: 0.4 },
    rainbowLow: { from: 0.03, to: 0.12 },
    stars: { from: -0.05, to: -0.25 },
  },
  // Light on the scene: the lowest sun height counted, direct and glare terms, and the weight of the sky light.
  SCENE = { direct: 0.55, glare: 0.14, minHeight: 0.12, sky: 1.1 },
  WATER_LIGHT = { direct: 0.55, sky: 0.9 },
  // Clear tropical water: bright turquoise in-scatter, not a dark navy.
  WATER_TINT = { 0: 0.025, 1: 0.12, 2: 0.17 },
  fadeAt = ({ from, to }, x) => smoothstep(from, to, x),
  lum = (c) => LUMA.r * c[0] + LUMA.g * c[1] + LUMA.b * c[2],
  // Sun- and moonlit sky radiance in one direction.
  skyAt = (direction, sun, moon, intensity) => {
    const s = skyRadiance(direction, sun, intensity),
      m = skyRadiance(direction, moon, intensity * MOON.sky);
    return s.map((v, channel) => v + m[channel] * MOON_SKY_TINT[channel]);
  },
  // Cosine-weighted average radiance of the sky dome.
  skyIrradiance = (sun, moon, intensity) => {
    const out = [0, 0, 0];
    let wsum = 0;
    for (let ia = 0; ia < DOME.azimuths; ia += 1) {
      for (let ie = 0; ie < DOME.elevations; ie += 1) {
        const az = (ia / DOME.azimuths) * Math.PI * 2,
          elevation = (((ie + 0.5) / DOME.elevations) * Math.PI) / 2,
          w = Math.sin(elevation),
          direction = [Math.cos(az) * Math.cos(elevation), Math.sin(elevation), Math.sin(az) * Math.cos(elevation)];
        for (const [channel, v] of skyAt(direction, sun, moon, intensity).entries()) out[channel] += v * w;
        wsum += w;
      }
    }
    return out.map((v, channel) => v / wsum + NIGHT_SKY[channel] * fadeAt(FADES.nightSky, sun[1]));
  },
  // Direct light: the sun by day, the moon by night (they cross near zero intensity).
  directLight = (sun, moon) => {
    const moonUp = fadeAt(FADES.moonRise, moon[1]) * fadeAt(FADES.moonSunset, sun[1]),
      sunlight = sunTransmittance(sun[1]).map((v) => v * SKY_E * SUN_SCALE),
      moonlight = [0, 1, 2].map((channel) => MOON_COLOR[channel] * MOON.light * moonUp);
    if (lum(sunlight) >= lum(moonlight)) return { color: sunlight, dir: sun, isSun: 1 };
    return { color: moonlight, dir: moon, isSun: 0 };
  },
  // Weather: mostly fair, with fair-weather cumulus drifting by and passing showers.
  weather = (t, s, sunY) => {
    const coverage =
        COVERAGE.base +
        COVERAGE.slow.amp * Math.sin(t / COVERAGE.slow.period + s) +
        COVERAGE.mid.amp * Math.sin(t / COVERAGE.mid.period + s * COVERAGE.mid.phase) +
        COVERAGE.fast.amp * Math.sin(t / COVERAGE.fast.period + s * COVERAGE.fast.phase),
      shower = Math.max(0, Math.sin(t / SHOWER.period + s * SHOWER.phase)) * fadeAt(SHOWER.clouds, coverage);
    return {
      coverage,
      // Passing showers leave a rainbow opposite a low sun now and then.
      rainbow: shower ** SHOWER.rainbowPower * fadeAt(FADES.rainbowLow, sunY) * fadeAt(FADES.rainbowHigh, sunY),
      raining: fadeAt(SHOWER.rain, shower),
      wind: [(t * WIND.x + s * WIND.xSeed) % WORLD_PERIOD, (t * WIND.z + s * WIND.zSeed) % WORLD_PERIOD],
    };
  },
  // Mist settles before sunrise and burns off in the morning; stronger on some days.
  mistAt = (t, tod, s, sunY) => {
    const dayIndex = Math.floor((t + tod * MIST.day) / MIST.day),
      mistDay = MIST.base + ((MIST.range * (((Math.sin(dayIndex * MIST.hashPhase + s) * MIST.hashScale) % 1) + 1)) % 1);
    return mistDay * fadeAt(FADES.mistDawn, sunY) * fadeAt(FADES.mistMorning, sunY) * Number(tod < 0.5);
  },
  // Luminance of the light falling on the scene; the constant light term accounts for low suns glaring into view.
  sceneLuminance = (light, skyAmb) =>
    lum(light.color) * (Math.max(light.dir[1], SCENE.minHeight) * SCENE.direct + SCENE.glare) + lum(skyAmb) * SCENE.sky;

export class Environment {
  // Until the first update, which starts exposure and wetness where they would settle.
  #fresh = true;
  exposure;
  seed;
  tod;
  // How soaked the ground is after the last shower.
  wetness;

  // eslint-disable-next-line sonarjs/pseudo-random -- picks the weather of this visit, not a secret
  constructor({ tod = 0.68, seed = Math.random() } = {}) {
    this.tod = tod;
    this.seed = seed;
  }

  // The ground soaks up quickly in a shower and dries slowly (faster in the sun).
  #soak(dt, raining, sunY) {
    let tau = DRYING.dry / (1 + DRYING.sun * Math.max(sunY, 0));
    if (this.#fresh) this.wetness = raining;
    if (raining > this.wetness) tau = DRYING.soak;
    this.wetness += (raining - this.wetness) * (1 - Math.exp(-dt / tau));
  }

  // Exposure from the light actually falling on the scene; our eyes also adapt to the shade under the canopy.
  #adapt(dt, sceneLum, modes) {
    const exposure =
      Math.min(
        (EXPOSURE.key / Math.max(sceneLum, EXPOSURE.min) ** EXPOSURE.response) * PARTIAL_ADAPTATION,
        EXPOSURE.max,
      ) *
      (1 + EXPOSURE.canopy * modes.land + EXPOSURE.under * modes.und);
    if (this.#fresh) this.exposure = exposure;
    this.exposure *= (exposure / this.exposure) ** (1 - Math.exp(-dt * EXPOSURE.rate));
  }

  update(dt, t, shot) {
    this.tod = (this.tod + todRate(this.tod) * dt) % 1;
    const { moon, sun } = celestial(this.tod),
      light = directLight(sun, moon),
      skyAmb = skyIrradiance(sun, moon, SKY_E),
      s = this.seed * SEED_SPREAD,
      sky = weather(t, s, sun[1]),
      lit = Math.max(light.dir[1], 0);
    this.#soak(dt, sky.raining, sun[1]);
    this.#adapt(dt, sceneLuminance(light, skyAmb), shot.modes);
    this.#fresh = false;
    return {
      coverage: sky.coverage,
      exposure: this.exposure,
      fog: [FOG.density * (1 + Math.max(sky.coverage, 0) * FOG.cloud), 1 / FOG.distance, shot.haze, SKY_E],
      groundAmb: skyAmb.map((v, channel) => v * GROUND_TINT[channel] + light.color[channel] * lit * GROUND_DIRECT),
      isSun: light.isSun,
      lightColor: light.color,
      lightDir: light.dir,
      mist: mistAt(t, this.tod, s, sun[1]),
      moon,
      night: fadeAt(FADES.night, sun[1]),
      rainbow: sky.rainbow,
      skyAmb,
      stars: fadeAt(FADES.stars, sun[1]),
      sun,
      tod: this.tod,
      waterFog: light.color.map(
        (v, channel) => (v * lit * WATER_LIGHT.direct + skyAmb[channel] * WATER_LIGHT.sky) * WATER_TINT[channel],
      ),
      wetness: this.wetness,
      wind: sky.wind,
    };
  }
}
