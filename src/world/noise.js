// Periodic gradient noise, bit-exact with the WGSL version in shaders/common.js.
// The world repeats every W metres in x and z and every lattice wraps with it, so no float precision is ever lost.

// Length of one "shot cycle" along the path (m).
const CYCLE = 2048,
  // Maps the 16-bit halves of a hash onto [-1, 1].
  HALF_U16 = 32_767.5,
  // Seed offset between successive fbm octaves.
  OCTAVE_SEED_STEP = 101,
  // World period (m).
  WORLD_PERIOD = 16_384,
  // Integer lattice cell holding p and the position inside it: [cell, fraction].
  cell = (p) => {
    const floor = Math.floor(p);
    return [floor, p - floor];
  },
  dot = (g, x, y) => g[0] * x + g[1] * y,
  // Quintic fade curve and its derivative.
  fade = (t) => t * t * t * (t * (t * 6 - 15) + 10),
  fadeD = (t) => 30 * t * t * (t - 1) * (t - 1),
  hashu = (x) => {
    // eslint-disable-next-line no-bitwise -- integer hash must match the WGSL twin bit for bit
    const h = (Math.imul(x >>> 0, 747_796_405) + 2_891_336_453) >>> 0,
      // eslint-disable-next-line no-bitwise -- integer hash must match the WGSL twin bit for bit
      m = Math.imul(((h >>> ((h >>> 28) + 4)) ^ h) >>> 0, 277_803_737) >>> 0;
    // eslint-disable-next-line no-bitwise -- integer hash must match the WGSL twin bit for bit
    return ((m >>> 22) ^ m) >>> 0;
  },
  lerp = (a, b, t) => a + (b - a) * t,
  // Bilinear blend of four corners [x0y0, x1y0, x0y1, x1y1] with the x and y fade weights.
  mix4 = ([a, b, c, d], ux, uy) => a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy,
  wrapi = (a, p) => ((a % p) + p) % p,
  gradVec = (ix, iy, per, seed) => {
    // eslint-disable-next-line no-bitwise -- integer hash must match the WGSL twin bit for bit
    const h = hashu((wrapi(ix, per) + hashu((wrapi(iy, per) + seed) >>> 0)) >>> 0);
    // eslint-disable-next-line no-bitwise -- unpacks the two 16-bit halves of the hash, as the WGSL twin does
    return [(h & 0xff_ff) / HALF_U16 - 1, (h >>> 16) / HALF_U16 - 1];
  },
  gnoise = (px, py, per, seed) => {
    const [ix, fx] = cell(px),
      [iy, fy] = cell(py),
      a = dot(gradVec(ix, iy, per, seed), fx, fy),
      b = dot(gradVec(ix + 1, iy, per, seed), fx - 1, fy),
      c = dot(gradVec(ix, iy + 1, per, seed), fx, fy - 1),
      d = dot(gradVec(ix + 1, iy + 1, per, seed), fx - 1, fy - 1),
      ux = fade(fx);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), fade(fy));
  },
  // Gradient noise and its derivative: [value, d/dx, d/dy] in lattice units.
  gnoiseD = (px, py, per, seed) => {
    const [ix, fx] = cell(px),
      [iy, fy] = cell(py),
      g = [
        gradVec(ix, iy, per, seed),
        gradVec(ix + 1, iy, per, seed),
        gradVec(ix, iy + 1, per, seed),
        gradVec(ix + 1, iy + 1, per, seed),
      ],
      h = [dot(g[0], fx, fy), dot(g[1], fx - 1, fy), dot(g[2], fx, fy - 1), dot(g[3], fx - 1, fy - 1)],
      k = h[0] - h[1] - h[2] + h[3],
      ux = fade(fx),
      uy = fade(fy),
      // The corner gradients blended across the cell: one component of the derivative before its fade term.
      blendD = (axis) =>
        mix4(
          g.map((v) => v[axis]),
          ux,
          uy,
        );
    return [
      mix4(h, ux, uy),
      blendD(0) + fadeD(fx) * (h[1] - h[0] + k * uy),
      blendD(1) + fadeD(fy) * (h[2] - h[0] + k * ux),
    ];
  },
  // Fractal sum of `oct` octaves, starting at `per` lattice cells per world period.
  fbm = (x, z, { oct, per: per0, seed }) => {
    let a = 0.5,
      per = per0,
      qx = x * (per0 / WORLD_PERIOD),
      qz = z * (per0 / WORLD_PERIOD),
      s = 0;
    for (let octave = 0; octave < oct; octave += 1) {
      // eslint-disable-next-line no-bitwise -- u32 seed, as in the WGSL twin
      s += a * gnoise(qx, qz, per, (seed + octave * OCTAVE_SEED_STEP) >>> 0);
      qx *= 2;
      qz *= 2;
      per *= 2;
      a *= 0.5;
    }
    return s;
  };

export { CYCLE, WORLD_PERIOD as W, fbm, gnoise, gnoiseD, hashu, wrapi };
