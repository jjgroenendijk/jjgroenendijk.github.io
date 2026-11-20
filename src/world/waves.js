// Ocean waves: Gerstner wave set with integer wave numbers over the world
// period (spatially periodic) and frequencies quantised to WAVE_T seconds.
import { W } from './noise.js';

const TAU = Math.PI * 2;
export const WAVE_T = 3600;
const G = 9.81;
function mkWaves(list) {
  return list.map(([nx, nz, amp, q]) => {
    const kx = TAU * nx / W, kz = TAU * nz / W;
    const k = Math.hypot(kx, kz);
    let w = Math.sqrt(G * k);
    w = TAU * Math.max(1, Math.round(w * WAVE_T / TAU)) / WAVE_T;
    return [kx, kz, amp, q, w];
  });
}
export const WAVES = mkWaves([
  [150, 140, 0.42, 0.5], [300, 220, 0.26, 0.75], [-180, 350, 0.19, 0.7], [520, -130, 0.14, 0.7],
  [410, 600, 0.09, 0.65], [-700, 520, 0.065, 0.6], [1100, 300, 0.045, 0.55], [-600, -1300, 0.035, 0.5],
  [1900, 1100, 0.022, 0.45], [-2300, 900, 0.015, 0.4],
]);
export const RIPPLES = mkWaves([
  [2600, -1500, 0.012, 0], [-3100, 2200, 0.010, 0], [4200, 2900, 0.007, 0], [-5200, -3900, 0.005, 0],
  [6900, -1800, 0.004, 0], [-2300, 7600, 0.0035, 0], [9100, 5200, 0.0025, 0], [-11000, 4100, 0.002, 0],
]);
export function waveHeight(x, z, t) {
  let y = 0;
  const tt = t % WAVE_T;
  for (const [kx, kz, a, , w] of WAVES) y += a * Math.sin(kx * x + kz * z - w * tt);
  return y;
}
