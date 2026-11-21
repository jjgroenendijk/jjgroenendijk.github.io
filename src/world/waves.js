// Ocean waves: Gerstner wave set with integer wave numbers over the world period (spatially periodic) and frequencies
// quantised to WAVE_T seconds.
import { W as WORLD_PERIOD } from './noise.js';

// Gravitational acceleration (m/s²) for the deep-water dispersion relation.
const GRAVITY = 9.81,
  TAU = Math.PI * 2,
  // Period (s) every wave frequency is quantised to, so the surface repeats exactly.
  WAVE_T = 3600,
  // [waves per world period along x, along z, amplitude m, steepness] to [kx, kz, amplitude, steepness, omega].
  gerstner = ([nx, nz, amp, q]) => {
    const kx = (TAU * nx) / WORLD_PERIOD,
      kz = (TAU * nz) / WORLD_PERIOD,
      w = Math.sqrt(GRAVITY * Math.hypot(kx, kz));
    return [kx, kz, amp, q, (TAU * Math.max(1, Math.round((w * WAVE_T) / TAU))) / WAVE_T];
  },
  [WAVES, RIPPLES, CAUSTIC_WAVES] = [
    // The visible swell.
    [
      [150, 140, 0.42, 0.5],
      [300, 220, 0.26, 0.75],
      [-180, 350, 0.19, 0.7],
      [520, -130, 0.14, 0.7],
      [410, 600, 0.09, 0.65],
      [-700, 520, 0.065, 0.6],
      [1100, 300, 0.045, 0.55],
      [-600, -1300, 0.035, 0.5],
      [1900, 1100, 0.022, 0.45],
      [-2300, 900, 0.015, 0.4],
    ],
    // Ripples on top of it.
    [
      [2600, -1500, 0.012, 0],
      [-3100, 2200, 0.01, 0],
      [4200, 2900, 0.007, 0],
      [-5200, -3900, 0.005, 0],
      [6900, -1800, 0.004, 0],
      [-2300, 7600, 0.0035, 0],
      [9100, 5200, 0.0025, 0],
      [-11_000, 4100, 0.002, 0],
    ],
    // Short waves that only steer the caustic photons: too small to see on the surface, but curved enough to focus
    // sunlight a few metres down.
    [
      [9000, 4100, 0.03, 0],
      [-7600, 8300, 0.026, 0],
      [11_800, -6900, 0.022, 0],
      [-12_600, -3300, 0.02, 0],
      [3100, 14_200, 0.017, 0],
      [15_800, 9400, 0.013, 0],
    ],
  ].map((list) => list.map((wave) => gerstner(wave))),
  waveHeight = (x, z, t) => {
    const tt = t % WAVE_T;
    let y = 0;
    for (const [kx, kz, a, , w] of WAVES) y += a * Math.sin(kx * x + kz * z - w * tt);
    return y;
  };

export { CAUSTIC_WAVES, RIPPLES, WAVES, WAVE_T, waveHeight };
