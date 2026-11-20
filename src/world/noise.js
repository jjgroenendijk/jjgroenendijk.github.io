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
const wrapi = (a, p) => ((a % p) + p) % p;

function gradDot(ix, iy, per, seed, fx, fy) {
  const h = hashu((wrapi(ix, per) + hashu((wrapi(iy, per) + seed) >>> 0)) >>> 0);
  const gx = (h & 0xffff) / 32767.5 - 1;
  const gy = (h >>> 16) / 32767.5 - 1;
  return gx * fx + gy * fy;
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

export function fbm(x, z, per0, oct, seed) {
  let s = 0, a = 0.5, per = per0;
  let qx = x * (per0 / W), qz = z * (per0 / W);
  for (let i = 0; i < oct; i++) {
    s += a * gnoise(qx, qz, per, (seed + i * 101) >>> 0);
    qx *= 2; qz *= 2; per *= 2; a *= 0.5;
  }
  return s;
}
