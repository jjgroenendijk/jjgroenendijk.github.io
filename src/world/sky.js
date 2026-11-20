// Analytic atmosphere (mirrors skyBase() in WGSL) and the day/night cycle.
import { smoothstep } from './terrain.js';

const TAU = Math.PI * 2;
const BR = [5.8e-6, 13.5e-6, 33.1e-6], BM = 21e-6;
function airmass(c) {
  const zd = Math.acos(Math.min(Math.max(c, -1), 1)) * 180 / Math.PI;
  return 1 / (Math.max(c, 0) + 0.50572 * Math.pow(Math.max(96.07995 - zd, 0.1), -1.6364));
}
export function sunTransmittance(sy) {
  const m = airmass(sy);
  const fade = smoothstep(-0.12, 0.02, sy);
  return BR.map((b) => Math.exp(-(b * 8000 + BM * 1200) * m) * fade);
}
export const SKY_E = 22;
export function skyRadiance(rd, sun, E) {
  const mu = rd[0] * sun[0] + rd[1] * sun[1] + rd[2] * sun[2];
  const pR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const g = 0.76;
  const pM = (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  const mv = airmass(Math.max(rd[1], 0));
  const Ts0 = sunTransmittance(sun[1]);
  const thin = 1 - 0.7 * Math.min(Math.max(rd[1] * 1.6, 0), 1);
  const fade = smoothstep(-0.12, 0.02, sun[1]);
  const Ts = Ts0.map((v) => Math.pow(Math.max(v / Math.max(fade, 1e-6), 1e-6), thin) * fade);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const dR = 8000 * mv, dM = 1200 * mv;
    const ext = BR[i] * dR + BM * dM;
    const sc = (BR[i] * pR * dR + BM * pM * dM) / ext * (1 - Math.exp(-ext));
    out[i] = E * Ts[i] * sc;
  }
  // twilight glow
  const tw = smoothstep(-0.25, 0.0, sun[1]) * (1 - smoothstep(0.0, 0.25, sun[1]));
  const twc = [0.10, 0.07, 0.12];
  for (let i = 0; i < 3; i++) out[i] += E * 0.012 * tw * twc[i] * (1 - rd[1] * 0.5);
  return out;
}


// tod in [0,1): 0 = midnight. Returns sun and moon directions.
export function celestial(tod) {
  const el = Math.asin(0.93 * Math.sin((tod - 0.25) * TAU));
  const az = tod * TAU + Math.PI - 0.35;
  const sun = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
  const mel = Math.asin(0.8 * Math.sin((tod - 0.25 + 0.47) * TAU));
  const maz = az + Math.PI + 0.4;
  const moon = [Math.cos(maz) * Math.cos(mel), Math.sin(mel), Math.sin(maz) * Math.cos(mel)];
  return { sun, moon };
}
// Time of day progresses slower around sunrise/sunset (the pretty part).
export function todRate(tod) {
  const { sun } = celestial(tod);
  const e = sun[1];
  const golden = Math.exp(-Math.pow((e - 0.06) / 0.16, 2));
  const night = smoothstep(-0.05, -0.3, e);
  const base = 1 / (22 * 60); // ~22 min per full day before warping
  // nights pass quickly: the island is mostly seen in the sun
  return base * (1.25 - 0.8 * golden + 1.6 * night);
}
