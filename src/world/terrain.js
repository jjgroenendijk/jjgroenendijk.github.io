// Terrain height field: an endless archipelago, plus a "corridor" along the
// camera path that guarantees lagoon -> beach -> jungle -> beach -> reef.
import { W, CYCLE, fbm, gnoise } from './noise.js';

const TAU = Math.PI * 2;
export const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

export function pathX(z) {
  const k = TAU / W;
  return 140 * Math.sin(k * 7 * z) + 50 * Math.sin(k * 19 * z + 1.3) + 18 * Math.sin(k * 41 * z + 0.4);
}
export function pathDX(z) {
  const k = TAU / W;
  return 140 * k * 7 * Math.cos(k * 7 * z) + 50 * k * 19 * Math.cos(k * 19 * z + 1.3) + 18 * k * 41 * Math.cos(k * 41 * z + 0.4);
}

// Corridor knots along one cycle: [u, targetHeight, strength, valley, width]
// The terrain is gently forced to these heights near the camera path so the
// director can rely on: lagoon -> beach -> jungle -> beach -> reef -> open sea.
export const KNOTS = [
  [0.00, -22, 0.0, 0.0, 300],
  [0.13, -22, 0.0, 0.0, 300],
  [0.19, -13, 1.0, 0.0, 300],
  [0.245, -3.2, 1.0, 0.0, 280],
  [0.285, -0.6, 1.0, 0.0, 260],
  [0.300, 1.4, 1.0, 0.3, 250],
  [0.320, 3.2, 1.0, 0.8, 250],
  [0.360, 6.0, 1.0, 1.0, 240],
  [0.420, 9.0, 1.0, 1.0, 240],
  [0.480, 6.5, 1.0, 1.0, 240],
  [0.515, 3.0, 1.0, 0.7, 250],
  [0.535, 1.0, 1.0, 0.2, 260],
  [0.550, -0.9, 1.0, 0.0, 270],
  [0.575, -6.0, 1.0, -0.05, 280],
  [0.610, -9.5, 1.0, -0.12, 300],
  [0.700, -10.5, 1.0, -0.14, 300],
  [0.780, -8.5, 1.0, -0.12, 300],
  [0.820, -6.5, 1.0, -0.08, 300],
  [0.850, -3.4, 1.0, -0.03, 300],
  [0.880, -10.0, 0.6, 0.0, 300],
  [0.940, -22, 0.0, 0.0, 300],
  [1.000, -22, 0.0, 0.0, 300],
];

function corridorAt(z) {
  let u = z / CYCLE; u -= Math.floor(u);
  let i = 0;
  for (let k = 0; k < KNOTS.length - 1; k++) if (u >= KNOTS[k + 1][0]) i = k + 1;
  const a = KNOTS[i], b = KNOTS[Math.min(i + 1, KNOTS.length - 1)];
  let t = Math.min(Math.max((u - a[0]) / Math.max(b[0] - a[0], 1e-5), 0), 1);
  t = t * t * (3 - 2 * t);
  return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
}


export function baseHeight(x, z) {
  const c = fbm(x, z, 8, 3, 11);
  const n = fbm(x, z, 32, 6, 23);
  const e = n * 1.5 + c * 1.2 - 0.1;
  const r = 1 - Math.abs(gnoise(x * (64 / W), z * (64 / W), 64, 37));
  const r2 = 1 - Math.abs(gnoise(x * (128 / W), z * (128 / W), 128, 41));
  const ridge = r * r * 0.7 + r2 * r2 * 0.3;
  let h;
  if (e > 0) h = e * 40 + Math.pow(Math.max(e - 0.06, 0), 1.5) * 900 * (0.35 + 0.65 * ridge);
  else h = e * 90;
  return Math.max(h, -48 + 8 * n);
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
