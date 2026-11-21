// The camera path: x as a sum of three sines of z. Every visit draws its own
// path (frequencies, amplitudes, phases and a sideways offset), so the flight
// crosses a different part of the archipelago each time. `?path=N` repeats one.
// Frequencies are whole numbers of waves per world period, so the path wraps
// seamlessly with the world. Shared with the WGSL in shaders/common.js.
import { W, hashu } from './noise.js';

const TAU = Math.PI * 2;
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const PATH_SEED = query && query.has('path') ? Number(query.get('path')) >>> 0 : Math.floor(Math.random() * 2 ** 31);

const rnd = (i) => hashu((PATH_SEED * 31 + i * 7919 + 17) >>> 0) / 4294967296;
const pick = (i, lo, hi) => lo + Math.floor(rnd(i) * (hi - lo + 1));

// [amplitude m, waves per world period, phase]
export const PATH_TERMS = [
  [140 * (0.8 + 0.4 * rnd(1)), pick(2, 5, 9), rnd(3) * TAU],
  [50 * (0.7 + 0.6 * rnd(4)), pick(5, 15, 23), rnd(6) * TAU],
  [18 * (0.6 + 0.8 * rnd(7)), pick(8, 35, 47), rnd(9) * TAU],
];
export const PATH_OFFSET = rnd(10) * W;
