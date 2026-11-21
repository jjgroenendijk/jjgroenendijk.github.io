// Terrain height field: an endless archipelago, plus a "corridor" along the
// camera path that guarantees lagoon -> beach -> jungle -> beach -> reef.
import { W, CYCLE, fbm, gnoise, gnoiseD, hashu, wrapi } from './noise.js';
import { PATH_TERMS, PATH_OFFSET } from './path.js';

const TAU = Math.PI * 2;
export const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

export function pathX(z) {
  const k = TAU / W;
  let x = PATH_OFFSET;
  for (const [a, f, ph] of PATH_TERMS) x += a * Math.sin(k * f * z + ph);
  return x;
}
export function pathDX(z) {
  const k = TAU / W;
  let dx = 0;
  for (const [a, f, ph] of PATH_TERMS) dx += a * k * f * Math.cos(k * f * z + ph);
  return dx;
}

// Corridor knots along one cycle: [u, targetHeight, strength, valley, width]
// The terrain is gently forced to these heights near the camera path so the
// director can rely on: lagoon -> beach -> jungle -> beach -> reef -> open sea.
export const KNOTS = [
  [0.0, -22, 0.0, 0.0, 300],
  [0.13, -22, 0.0, 0.0, 300],
  [0.19, -13, 1.0, 0.0, 300],
  [0.245, -3.2, 1.0, 0.0, 280],
  [0.285, -0.6, 1.0, 0.0, 260],
  [0.3, 1.4, 1.0, 0.3, 250],
  [0.32, 3.2, 1.0, 0.8, 250],
  [0.36, 6.0, 1.0, 1.0, 240],
  [0.42, 9.0, 1.0, 1.0, 240],
  [0.48, 6.5, 1.0, 1.0, 240],
  [0.515, 3.0, 1.0, 0.7, 250],
  [0.535, 1.0, 1.0, 0.2, 260],
  [0.55, -0.9, 1.0, 0.0, 270],
  [0.575, -6.0, 1.0, -0.05, 280],
  [0.61, -9.5, 1.0, -0.12, 300],
  [0.7, -10.5, 1.0, -0.14, 300],
  [0.78, -8.5, 1.0, -0.12, 300],
  [0.82, -6.5, 1.0, -0.08, 300],
  [0.85, -3.4, 1.0, -0.03, 300],
  [0.88, -10.0, 0.6, 0.0, 300],
  [0.94, -22, 0.0, 0.0, 300],
  [1.0, -22, 0.0, 0.0, 300],
];

function corridorAt(z) {
  let u = z / CYCLE;
  u -= Math.floor(u);
  let i = 0;
  for (let k = 0; k < KNOTS.length - 1; k++) if (u >= KNOTS[k + 1][0]) i = k + 1;
  const a = KNOTS[i],
    b = KNOTS[Math.min(i + 1, KNOTS.length - 1)];
  let t = Math.min(Math.max((u - a[0]) / Math.max(b[0] - a[0], 1e-5), 0), 1);
  t = t * t * (3 - 2 * t);
  return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
}

// Mirrors of the WGSL in shaders/common.js (fbmD, gullies, baseHeight).
const sat = (x) => Math.min(Math.max(x, 0), 1);
const hf = (x) => hashu(x >>> 0) / 4294967295;

// fbm with its derivative (world units); octaves from damp0 on are damped by the slope below
function fbmD(x, z, per0, oct, seed, damp0) {
  const s = [0, 0, 0];
  let a = 0.5,
    per = per0,
    sx = 0,
    sz = 0;
  for (let i = 0; i < oct; i++) {
    const n = gnoiseD(x * (per / W), z * (per / W), per, (seed + i * 101) >>> 0);
    const damp = i >= damp0 ? 1 / (1 + 0.35 * (sx * sx + sz * sz)) : 1;
    s[0] += n[0] * a * damp;
    s[1] += n[1] * (per / W) * a * damp;
    s[2] += n[2] * (per / W) * a * damp;
    sx += n[1];
    sz += n[2];
    per *= 2;
    a *= 0.5;
  }
  return s;
}

function gullyOctave(x, z, gx, gz, cell) {
  const n = Math.round(W / cell);
  const qx = x / cell,
    qz = z / cell;
  const cx = Math.floor(qx),
    cz = Math.floor(qz);
  let ax = -gz + 1e-6,
    az = gx;
  const al = Math.hypot(ax, az);
  ax /= al;
  az /= al;
  let v = 0,
    dvx = 0,
    dvz = 0,
    wsum = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const h = hashu((Math.imul(wrapi(cx + i, n), 3) + hashu((wrapi(cz + j, n) + 977) >>> 0)) >>> 0);
      const dx = qx - (cx + i) - hf(h),
        dz = qz - (cz + j) - hf(h + 1);
      const wt = Math.exp(-(dx * dx + dz * dz) * 1.5);
      const ph = (dx * ax + dz * az) * Math.PI * 2;
      v += Math.cos(ph) * wt;
      dvx -= Math.sin(ph) * Math.PI * 2 * ax * wt;
      dvz -= Math.sin(ph) * Math.PI * 2 * az * wt;
      wsum += wt;
    }
  }
  return [v / wsum, dvx / cell / wsum, dvz / cell / wsum];
}

function gullies(x, z, gx, gz) {
  const steep = sat(Math.hypot(gx, gz) * 1.5);
  if (steep < 0.01) return 0;
  const o1 = gullyOctave(x, z, gx, gz, 32);
  const o2 = gullyOctave(x, z, gx + o1[1] * 3.5, gz + o1[2] * 3.5, 8);
  return (o1[0] * 3.5 + o2[0] * 1.2 - 1) * steep;
}

function baseHeight(x, z) {
  const c = fbmD(x, z, 8, 3, 11, 99);
  const n = fbmD(x, z, 32, 6, 23, 2);
  const e = n[0] * 1.5 + c[0] * 1.2 - 0.1;
  const r = 1 - Math.abs(gnoise(x * (64 / W), z * (64 / W), 64, 37));
  const r2 = 1 - Math.abs(gnoise(x * (128 / W), z * (128 / W), 128, 41));
  const ridge = r * r * 0.7 + r2 * r2 * 0.3;
  let h;
  // gentle profile around sea level gives wide beaches and shallow shelves
  if (e > 0) {
    const hill = 950 * (0.35 + 0.65 * ridge);
    h = Math.min(e, 0.12) * 14 + Math.max(e - 0.12, 0) * 45 + Math.pow(Math.max(e - 0.14, 0), 1.5) * hill;
    // erosion on the hillsides (beaches and shelves stay smooth)
    const dhde = (e > 0.12 ? 45 : 14) + 1.5 * Math.sqrt(Math.max(e - 0.14, 0)) * hill;
    h += gullies(x, z, (n[1] * 1.5 + c[1] * 1.2) * dhde, (n[2] * 1.5 + c[2] * 1.2) * dhde) * smoothstep(0.12, 0.2, e);
  } else h = Math.max(e, -0.08) * 30 + Math.min(e + 0.08, 0) * 90;
  return Math.max(h, -48 + 8 * n[0]);
}

export function terrainHeight(x, z) {
  let h = baseHeight(x, z);
  const d = Math.abs(x - pathX(z));
  h = smin(h, 30 + d * 0.55, 25);
  const land = smoothstep(-2, 4, h);
  h += fbm(x, z, 512, 4, 59) * 6 * land;
  h += gnoise(x * (2048 / W), z * (2048 / W), 2048, 71) * 0.4;
  const k = corridorAt(z);
  const w = k[1] * (1 - smoothstep(k[3] * 0.35, k[3], d));
  if (w > 0) {
    const t = k[0] + k[2] * Math.pow(Math.max(d - 14, 0), 1.35) * 0.22 + fbm(x, z, 512, 3, 83) * 2.5;
    h = h + (t - h) * w;
  }
  return h;
}
