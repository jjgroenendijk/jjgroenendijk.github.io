// Environment state: time of day, sun/moon light, ambient sky light, weather,
// fog and exposure. Everything evolves slowly so no two minutes look alike.
import { W } from './noise.js';
import { smoothstep } from './terrain.js';
import { celestial, todRate, sunTransmittance, skyRadiance, SKY_E } from './sky.js';

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

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
    this.wetness = null; // how soaked the ground is after the last shower
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

    // weather: mostly fair, with fair-weather cumulus drifting by
    const s = this.seed * 100;
    const coverage = -0.15 + 0.08 * Math.sin(t / 530 + s) + 0.07 * Math.sin(t / 233 + s * 1.7) + 0.04 * Math.sin(t / 97 + s * 2.3);
    const wind = [(t * 7 + s * 1000) % W, (t * 3 + s * 700) % W];
    // passing showers leave a rainbow opposite a low sun now and then
    const shower = Math.max(0, Math.sin(t / 151 + s * 3.1)) * smoothstep(-0.08, 0.06, coverage);
    // the ground soaks up quickly in a shower and dries slowly (faster in the sun)
    const raining = smoothstep(0.35, 0.75, shower);
    if (this.wetness === null) this.wetness = raining;
    const tau = raining > this.wetness ? 40 : 300 / (1 + 2 * Math.max(sun[1], 0));
    this.wetness += (raining - this.wetness) * (1 - Math.exp(-dt / tau));
    const rainbow = Math.pow(shower, 3) * smoothstep(0.03, 0.12, sun[1]) * smoothstep(0.75, 0.4, sun[1]);
    // mist settles before sunrise and burns off in the morning; stronger on some days
    const dayIndex = Math.floor((t + this.tod * 1320) / 1320);
    const mistDay = 0.2 + 0.4 * ((Math.sin(dayIndex * 12.9898 + s) * 43758.5453) % 1 + 1) % 1;
    const mist = mistDay * smoothstep(-0.25, -0.02, sun[1]) * smoothstep(0.3, 0.06, sun[1]) * (this.tod < 0.5 ? 1 : 0);

    // exposure from the light actually falling on the scene
    // (the constant light term accounts for low suns glaring straight into view)
    const sceneLum = lum(lightColor) * (Math.max(lightDir[1], 0.12) * 0.55 + 0.14) + lum(skyAmb) * 1.1;
    // eyes adapt, but not fully: nights stay dark and blue
    let exposure = 0.6 / Math.pow(Math.max(sceneLum, 1e-5), 0.8) * Math.pow(0.4, 0.2);
    exposure = Math.min(exposure, 40);
    // our eyes adapt to the shade under the canopy
    exposure *= 1 + 2.6 * shot.modes.land + 0.6 * shot.modes.und;
    if (this.exposure === null) this.exposure = exposure;
    this.exposure *= Math.pow(exposure / this.exposure, 1 - Math.exp(-dt * 1.5));

    const waterLight = lightColor.map((v, i) => v * Math.max(lightDir[1], 0) * 0.55 + skyAmb[i] * 0.9);
    // clear tropical water: bright turquoise in-scatter, not a dark navy
    const waterFog = waterLight.map((v, i) => v * [0.025, 0.12, 0.17][i]);

    return {
      tod: this.tod, sun, moon, lightDir, lightColor, isSun: useSun ? 1 : 0, night,
      stars: smoothstep(-0.05, -0.25, sun[1]),
      skyAmb, groundAmb, exposure: this.exposure,
      fog: [0.000028 * (1 + Math.max(coverage, 0) * 3), 1 / 650, shot.haze, SKY_E],
      waterFog, coverage, wind, rainbow, mist, wetness: this.wetness,
    };
  }
}
