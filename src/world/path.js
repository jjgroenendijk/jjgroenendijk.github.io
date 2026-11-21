// The camera path: x as a sum of three sines of z. Every visit draws its own path (frequencies, amplitudes, phases and
// a sideways offset), so the flight crosses a different part of the archipelago each time. `?path=N` repeats one.
// Frequencies are whole numbers of waves per world period, so the path wraps seamlessly with the world.
// Shared with the WGSL in shaders/common.js.
import { W as WORLD_PERIOD, hashu } from './noise.js';

const TAU = Math.PI * 2,
  // Number of distinct u32 hash values, mapping a hash onto [0, 1).
  U32_RANGE = 4_294_967_296,
  // The seed from `?path=N`, else a fresh one per visit. Read through globalThis because this layer also runs where
  // there is no page location.
  readSeed = () => {
    const query = new URLSearchParams(globalThis.location?.search),
      parameter = query.get('path');
    // eslint-disable-next-line no-bitwise -- u32 seed, wrapped exactly as the hash expects
    if (parameter !== null) return Number(parameter) >>> 0;
    // eslint-disable-next-line sonarjs/pseudo-random -- picks a scenic flight, not a secret
    return Math.floor(Math.random() * 2 ** 31);
  },
  // The path for one seed: [amplitude m, waves per world period, phase] terms and a sideways offset.
  drawPath = (seed) => {
    // eslint-disable-next-line no-bitwise -- u32 hash input, as in the WGSL twin
    const rand = (n) => hashu((seed * 31 + n * 7919 + 17) >>> 0) / U32_RANGE,
      randInt = (n, lo, hi) => lo + Math.floor(rand(n) * (hi - lo + 1));
    return {
      PATH_OFFSET: rand(10) * WORLD_PERIOD,
      PATH_SEED: seed,
      PATH_TERMS: [
        [140 * (0.8 + 0.4 * rand(1)), randInt(2, 5, 9), rand(3) * TAU],
        [50 * (0.7 + 0.6 * rand(4)), randInt(5, 15, 23), rand(6) * TAU],
        [18 * (0.6 + 0.8 * rand(7)), randInt(8, 35, 47), rand(9) * TAU],
      ],
    };
  },
  { PATH_OFFSET, PATH_SEED, PATH_TERMS } = drawPath(readSeed());

export { PATH_OFFSET, PATH_SEED, PATH_TERMS };
