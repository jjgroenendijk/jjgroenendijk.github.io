// Periodic gradient noise, bit-exact with the WGSL version in shaders/common.js.
// The whole world repeats every W metres in x and z; noise lattices are
// wrapped so the camera can fly forever without losing float precision.

export const W = 16384;      // world period (m)
export const CYCLE = 2048;   // length of one "shot cycle" along the path (m)

export function hashu(x) {
  let h = (Math.imul(x >>> 0, 747796405) + 2891336453) >>> 0;
  h = Math.imul(((h >>> ((h >>> 28) + 4)) ^ h) >>> 0, 277803737) >>> 0;
  return ((h >>> 22) ^ h) >>> 0;
}
export const wrapi = (a, p) => ((a % p) + p) % p;

function gradVec(ix, iy, per, seed) {
  const h = hashu((wrapi(ix, per) + hashu((wrapi(iy, per) + seed) >>> 0)) >>> 0);
  return [(h & 0xffff) / 32767.5 - 1, (h >>> 16) / 32767.5 - 1];
}

function gradDot(ix, iy, per, seed, fx, fy) {
  const g = gradVec(ix, iy, per, seed);
  return g[0] * fx + g[1] * fy;
}

export function gnoise(px, py, per, seed) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = gradDot(ix, iy, per, seed, fx, fy);
  const b = gradDot(ix + 1, iy, per, seed, fx - 1, fy);
  const c = gradDot(ix, iy + 1, per, seed, fx, fy - 1);
  const d = gradDot(ix + 1, iy + 1, per, seed, fx - 1, fy - 1);
  const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

// gradient noise and its derivative: [value, d/dx, d/dy] in lattice units
export function gnoiseD(px, py, per, seed) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx - 1) * (fx - 1), duy = 30 * fy * fy * (fy - 1) * (fy - 1);
  const ga = gradVec(ix, iy, per, seed), gb = gradVec(ix + 1, iy, per, seed);
  const gc = gradVec(ix, iy + 1, per, seed), gd = gradVec(ix + 1, iy + 1, per, seed);
  const a = ga[0] * fx + ga[1] * fy;
  const b = gb[0] * (fx - 1) + gb[1] * fy;
  const c = gc[0] * fx + gc[1] * (fy - 1);
  const d = gd[0] * (fx - 1) + gd[1] * (fy - 1);
  const k = a - b - c + d;
  const v = a + (b - a) * ux + (c - a) * uy + k * ux * uy;
  const dv = (j) => ga[j] + (gb[j] - ga[j]) * ux + (gc[j] - ga[j]) * uy + (ga[j] - gb[j] - gc[j] + gd[j]) * ux * uy;
  return [v, dv(0) + dux * (b - a + k * uy), dv(1) + duy * (c - a + k * ux)];
}


export function fbm(x, z, per0, oct, seed) {
  let s = 0, a = 0.5, per = per0;
  let qx = x * (per0 / W), qz = z * (per0 / W);
  for (let i = 0; i < oct; i++) {
    s += a * gnoise(qx, qz, per, (seed + i * 101) >>> 0);
    qx *= 2; qz *= 2; per *= 2; a *= 0.5;
  }
  return s;
}
