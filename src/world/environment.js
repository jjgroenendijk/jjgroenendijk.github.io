// Environment state: time of day, sun/moon light, ambient sky light, weather,
// fog and exposure. Everything evolves slowly so no two minutes look alike.
import { W } from './noise.js';
import { smoothstep } from './terrain.js';
import { celestial, todRate, sunTransmittance, skyRadiance, SKY_E } from './sky.js';

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// cosine-weighted average radiance of the sky dome
function skyIrradiance(sun, moon, E) {
  const out = [0, 0, 0];
  let wsum = 0;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
    const az = (i / 6) * Math.PI * 2, el = ((j + 0.5) / 4) * Math.PI / 2;
    const d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
    const w = Math.sin(el);
    const s = skyRadiance(d, sun, E), m = skyRadiance(d, moon, E * 0.0035);
    for (let k = 0; k < 3; k++) out[k] += (s[k] + m[k] * [0.75, 0.85, 1.1][k]) * w;
    wsum += w;
  }
  const night = [0.0009, 0.0016, 0.0034];
  return out.map((v, k) => v / wsum + night[k] * smoothstep(0.0, -0.2, sun[1]));
}

export class Environment {
  constructor({ tod = 0.68, seed = Math.random() } = {}) {
    this.tod = tod;
    this.seed = seed;
    this.exposure = null;
  }

  update(dt, t, shot) {
    this.tod = (this.tod + todRate(this.tod) * dt) % 1;
    const { sun, moon } = celestial(this.tod);

    // direct light: the sun by day, the moon by night (they cross near zero intensity)
    const ts = sunTransmittance(sun[1]);
    const sunColor = ts.map((v) => v * SKY_E * 0.19);
    const moonUp = smoothstep(-0.05, 0.2, moon[1]) * smoothstep(0.05, -0.15, sun[1]);
    const moonColor = [0.55, 0.65, 0.9].map((v) => v * 0.022 * moonUp);
    const useSun = lum(sunColor) >= lum(moonColor);
    const lightDir = useSun ? sun : moon;
    const lightColor = useSun ? sunColor : moonColor;

    const skyAmb = skyIrradiance(sun, moon, SKY_E);
    const groundAmb = skyAmb.map((v, i) => v * [0.32, 0.36, 0.28][i] + lightColor[i] * Math.max(lightDir[1], 0) * 0.06);
    const night = smoothstep(0.02, -0.18, sun[1]);

    // weather: slowly drifting cloud cover
    const s = this.seed * 100;
    const coverage = -0.05 + 0.08 * Math.sin(t / 530 + s) + 0.07 * Math.sin(t / 233 + s * 1.7) + 0.04 * Math.sin(t / 97 + s * 2.3);
    const wind = [(t * 7 + s * 1000) % W, (t * 3 + s * 700) % W];

    // exposure from the light actually falling on the scene
    const sceneLum = lum(lightColor) * Math.max(lightDir[1], 0.12) * 0.55 + lum(skyAmb) * 1.1;
    // eyes adapt, but not fully: nights stay dark and blue
    let exposure = 0.5 / Math.pow(Math.max(sceneLum, 1e-5), 0.82) * Math.pow(0.4, 0.18);
    exposure = Math.min(exposure, 40);
    if (shot.modes.und > 0.5) exposure *= 1.25;
    if (this.exposure === null) this.exposure = exposure;
    this.exposure *= Math.pow(exposure / this.exposure, 1 - Math.exp(-dt * 1.5));

    const waterLight = lightColor.map((v, i) => v * Math.max(lightDir[1], 0) * 0.55 + skyAmb[i] * 0.9);
    const waterFog = waterLight.map((v, i) => v * [0.008, 0.06, 0.115][i]);

    return {
      tod: this.tod, sun, moon, lightDir, lightColor, isSun: useSun ? 1 : 0, night,
      stars: smoothstep(-0.05, -0.25, sun[1]),
      skyAmb, groundAmb, exposure: this.exposure,
      fog: [0.00011 * (1 + Math.max(coverage, 0) * 3), 1 / 650, shot.haze, SKY_E],
      waterFog, coverage, wind,
    };
  }
}

export { lum, mix3 };
