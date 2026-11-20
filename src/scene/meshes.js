// Procedural mesh generation. Vertex format: pos(3) normal(3) extra(4) = 10 floats.
// extra = [material, ambient occlusion, flex (wind weight), t (param)]
import { MAT } from './catalog.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// deterministic random
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function vnoise(x, y, z) {
  const h = (i, j, k) => { let n = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(ix, iy, iz), h(ix + 1, iy, iz), u), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u), v),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u), v), w);
}

class MB {
  constructor() { this.v = []; this.i = []; }
  vert(p, n, e) { this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], e[0], e[1], e[2], e[3]); return this.v.length / 10 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // two-sided triangle with computed normal
  flatTri(p0, p1, p2, e0, e1, e2, up = [0, 1, 0]) {
    let n = norm(cross(sub(p1, p0), sub(p2, p0)));
    if (dot(n, up) < 0) n = mul(n, -1);
    const a = this.vert(p0, n, e0), b = this.vert(p1, n, e1), c = this.vert(p2, n, e2);
    this.tri(a, b, c);
  }
  // tube along path(t) t in [0,1]
  tube(path, radius, segs, radial, ex) {
    const base = this.v.length / 10;
    let prevN = null;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const p = path(t);
      const p2 = path(Math.min(t + 0.01, 1)), p1 = path(Math.max(t - 0.01, 0));
      const T = norm(sub(p2, p1));
      let N = prevN ? norm(sub(prevN, mul(T, dot(prevN, T)))) : norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      prevN = N;
      const B = cross(T, N);
      for (let r = 0; r <= radial; r++) {
        const a = (r / radial) * Math.PI * 2;
        const rr = radius(t, a);
        const dir = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
        this.vert(add(p, mul(dir, rr)), dir, ex(t, a));
      }
    }
    for (let s = 0; s < segs; s++) for (let r = 0; r < radial; r++) {
      const a = base + s * (radial + 1) + r, b = a + radial + 1;
      this.quad(a, a + 1, b + 1, b);
    }
  }
  ico(center, radius, sub, ex, deform) {
    const { verts, faces } = icosphere(sub);
    const base = this.v.length / 10;
    for (const v of verts) {
      let p = add(center, mul(v, radius));
      let n = v;
      if (deform) { const r = deform(p, v); p = r.p; n = r.n; }
      this.vert(p, n, ex(p, v));
    }
    for (const f of faces) this.tri(base + f[0], base + f[1], base + f[2]);
  }
  build() { return { v: new Float32Array(this.v), i: new Uint32Array(this.i) }; }
}

const icoCache = new Map();
function icosphere(subd) {
  if (icoCache.has(subd)) return icoCache.get(subd);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < subd; s++) {
    const mid = new Map();
    const m = (a, b) => { const k = a < b ? a * 100000 + b : b * 100000 + a; if (!mid.has(k)) { mid.set(k, verts.length); verts.push(norm(mul(add(verts[a], verts[b]), 0.5))); } return mid.get(k); };
    const nf = [];
    for (const [a, b, c] of faces) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = nf;
  }
  const r = { verts, faces };
  icoCache.set(subd, r);
  return r;
}

// ------------------------------------------------------------------ palms
function palm(lod) {
  const mb = new MB();
  const R = rng(lod === 0 ? 11 : 12);
  const trunk = (t) => [0.05 * Math.sin(t * 2.4) * t, t, 0.02 * Math.sin(t * 3.1)];
  mb.tube(trunk, (t) => 0.019 * (1 + 0.7 * Math.exp(-t * 14)) * (1 - 0.25 * t), lod === 0 ? 12 : 5, lod === 0 ? 7 : 5,
    (t) => [MAT.palmBark, 0.55 + 0.45 * t, 0, t]);
  const top = trunk(1);
  mb.ico(add(top, [0, 0.005, 0]), 0.032, 1, () => [MAT.coconut, 0.6, 0.1, 1]);
  if (lod === 0) for (let k = 0; k < 5; k++) {
    const a = k * 2.4;
    mb.ico(add(top, [Math.cos(a) * 0.03, -0.03 - R() * 0.01, Math.sin(a) * 0.03]), 0.017, 1, () => [MAT.coconut, 0.5, 0.05, 1]);
  }
  const nf = lod === 0 ? 13 : 9;
  for (let k = 0; k < nf; k++) {
    const phi = k * 2.39996 + R() * 0.3;
    const el = 0.75 - (k / nf) * 1.0 + (R() - 0.5) * 0.2;
    const Lf = 0.38 + R() * 0.1;
    const dirH = [Math.cos(phi), 0, Math.sin(phi)];
    const side = [-Math.sin(phi), 0, Math.cos(phi)];
    const spine = (s) => add(top, add(mul(dirH, Lf * s * Math.cos(el * 0.6)), [0, Lf * (Math.sin(el) * s - 0.55 * s * s), 0]));
    if (lod === 0) {
      const N = 18;
      for (let i = 0; i < N; i++) {
        const s0 = i / N, s1 = (i + 1) / N;
        const a = spine(s0), b = spine(s1);
        // spine strip
        const w = 0.004;
        mb.flatTri(add(a, mul(side, w)), add(b, mul(side, w)), add(a, mul(side, -w)), [MAT.palmFrond, 0.8, s0, 1], [MAT.palmFrond, 0.8, s1, 1], [MAT.palmFrond, 0.8, s0, 1]);
        mb.flatTri(add(b, mul(side, w)), add(b, mul(side, -w)), add(a, mul(side, -w)), [MAT.palmFrond, 0.8, s1, 1], [MAT.palmFrond, 0.8, s1, 1], [MAT.palmFrond, 0.8, s0, 1]);
        if (i === 0) continue;
        const T = norm(sub(b, a));
        const ll = 0.025 + 0.14 * Math.pow(Math.sin(Math.PI * Math.min(s0 * 1.1, 1)), 0.6);
        for (const sg of [-1, 1]) {
          const dir = norm(add(add(mul(side, sg * 0.85), mul(T, 0.5)), [0, -0.38 - s0 * 0.3, 0]));
          const tip = add(a, mul(dir, ll));
          mb.flatTri(a, add(a, mul(T, 0.022)), tip, [MAT.palmFrond, 0.75, s0, 1], [MAT.palmFrond, 0.75, s0, 1], [MAT.palmFrond, 0.95, Math.min(s0 + 0.15, 1), 1]);
        }
      }
    } else {
      const N = 6;
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const c = spine(s);
        const wd = 0.11 * Math.pow(Math.sin(Math.PI * Math.min(s * 1.05, 1)), 0.7) + 0.005;
        const l = add(add(c, mul(side, -wd)), [0, -wd * 0.5, 0]);
        const r = add(add(c, mul(side, wd)), [0, -wd * 0.5, 0]);
        const row = [l, c, r];
        if (prev) {
          for (let j = 0; j < 2; j++) {
            mb.flatTri(prev[j], row[j], row[j + 1], [MAT.palmFrond, 0.8, s, 1], [MAT.palmFrond, 0.8, s, 1], [MAT.palmFrond, 0.8, s, 1]);
            mb.flatTri(prev[j], row[j + 1], prev[j + 1], [MAT.palmFrond, 0.8, s, 1], [MAT.palmFrond, 0.8, s, 1], [MAT.palmFrond, 0.8, s, 1]);
          }
        }
        prev = row;
      }
    }
  }
  return mb.build();
}

// ------------------------------------------------------------------ rainforest canopy tree
function blobDeform(center, crownC, amp, freq) {
  return (p, v) => {
    const nz = vnoise(p[0] * freq + 3.1, p[1] * freq, p[2] * freq + 7.7) - 0.5;
    const nz2 = vnoise(p[0] * freq * 2.7, p[1] * freq * 2.7 + 1.3, p[2] * freq * 2.7) - 0.5;
    const pp = add(p, mul(v, (nz + nz2 * 0.5) * amp));
    const radial = norm(sub(pp, crownC));
    return { p: pp, n: norm(add(mul(v, 0.55), mul(radial, 0.45))) };
  };
}
function tree(lod) {
  const mb = new MB();
  const R = rng(lod === 0 ? 21 : 22);
  const H = 0.62;
  const trunk = (t) => [0.015 * Math.sin(t * 4), t * H, 0.01 * Math.cos(t * 3)];
  mb.tube(trunk, (t, a) => 0.016 * (1 - 0.35 * t) * (1 + 2.6 * Math.exp(-t * 22) * Math.pow(0.5 + 0.5 * Math.cos(5 * a), 3)),
    lod === 0 ? 10 : 4, lod === 0 ? 10 : 5, (t) => [MAT.bark, 0.35 + 0.5 * t, 0, t]);
  const crownC = [0, 0.78, 0];
  const nb = lod === 0 ? 7 : 5;
  const blobs = [];
  for (let k = 0; k < nb; k++) {
    const a = k * 2.4 + R() * 0.5;
    const r = k === 0 ? 0 : 0.13 + R() * 0.07;
    const y = k === 0 ? 0.86 : 0.70 + R() * 0.1;
    blobs.push([[Math.cos(a) * r, y, Math.sin(a) * r], 0.12 + R() * 0.05]);
  }
  // branches
  if (lod === 0) for (let k = 1; k < nb; k++) {
    const [c] = blobs[k];
    const s = trunk(0.85);
    mb.tube((t) => add(s, mul(sub(add(c, [0, -0.04, 0]), s), t)), (t) => 0.007 * (1 - 0.6 * t), 3, 4, (t) => [MAT.bark, 0.5, 0, 0.8 + 0.2 * t]);
  }
  for (const [c, r] of blobs) {
    mb.ico(c, r, lod === 0 ? 2 : 1, (p, v) => {
      const out = Math.min(1, len(sub(p, crownC)) / 0.25);
      return [MAT.canopy, Math.min(1, 0.3 + 0.45 * (v[1] * 0.5 + 0.5) + 0.35 * out), 1, p[1]];
    }, (p, v) => {
      const d = blobDeform(c, crownC, r * 0.55, 18)(p, v);
      d.p[1] = c[1] + (d.p[1] - c[1]) * 0.78;
      return d;
    });
  }
  return mb.build();
}

function bush() {
  const mb = new MB();
  const R = rng(31);
  const C = [0, 0.4, 0];
  for (let k = 0; k < 4; k++) {
    const a = k * 2.1;
    const c = k === 0 ? [0, 0.45, 0] : [Math.cos(a) * 0.3, 0.3 + R() * 0.15, Math.sin(a) * 0.3];
    const r = 0.32 + R() * 0.12;
    mb.ico(c, r, 1, (p, v) => [MAT.bush, 0.35 + 0.65 * (v[1] * 0.5 + 0.5), 0.8, p[1]], blobDeform(c, C, r * 0.5, 5));
  }
  return mb.build();
}

// ------------------------------------------------------------------ fern
function fern() {
  const mb = new MB();
  const R = rng(41);
  const nf = 9;
  for (let k = 0; k < nf; k++) {
    const phi = k * 2.39996 + R() * 0.4;
    const el = 1.0 + R() * 0.3;
    const Lf = 0.55 + R() * 0.25;
    const dirH = [Math.cos(phi), 0, Math.sin(phi)];
    const side = [-Math.sin(phi), 0, Math.cos(phi)];
    const spine = (s) => add(mul(dirH, Lf * s * 0.8), [0, Lf * (Math.sin(el) * s * 0.9 - 0.75 * s * s), 0]);
    const N = 12;
    for (let i = 1; i < N; i++) {
      const s0 = i / N, s1 = (i + 1) / N;
      const a = spine(s0), b = spine(s1);
      const T = norm(sub(b, a));
      const ll = 0.03 + 0.11 * Math.sin(Math.PI * s0) * (1 - s0 * 0.4);
      for (const sg of [-1, 1]) {
        const dir = norm(add(add(mul(side, sg), mul(T, 0.35)), [0, -0.1, 0]));
        const tip = add(a, mul(dir, ll));
        const w = add(a, mul(T, 0.05));
        const mid = add(add(a, mul(dir, ll * 0.5)), mul(T, 0.03));
        mb.flatTri(a, w, mid, [MAT.fern, 0.6 + 0.4 * s0, s0, s0], [MAT.fern, 0.7, s0, s0], [MAT.fern, 0.9, s0, s0]);
        mb.flatTri(a, mid, tip, [MAT.fern, 0.6 + 0.4 * s0, s0, s0], [MAT.fern, 0.9, s0, s0], [MAT.fern, 1, s0, s0]);
      }
    }
  }
  return mb.build();
}

// ------------------------------------------------------------------ banana / big leaf plant
function banana() {
  const mb = new MB();
  const R = rng(51);
  const H = 0.42;
  mb.tube((t) => [0, t * H, 0], (t) => 0.035 * (1 - 0.3 * t), 4, 6, (t) => [MAT.stem, 0.5 + 0.5 * t, 0.1 * t, t]);
  const top = [0, H, 0];
  const nl = 7;
  for (let k = 0; k < nl; k++) {
    const phi = k * 2.39996 + R() * 0.3;
    const el = 1.1 - k * 0.08 + (R() - 0.5) * 0.2;
    const Lf = 0.5 + R() * 0.15;
    const dirH = [Math.cos(phi), 0, Math.sin(phi)];
    const side = [-Math.sin(phi), 0, Math.cos(phi)];
    // petiole
    const pet = 0.12;
    const p0 = add(top, add(mul(dirH, pet * 0.5), [0, pet * 0.8, 0]));
    mb.tube((t) => add(top, mul(sub(p0, top), t)), () => 0.008, 2, 4, () => [MAT.stem, 0.7, 0.3, 0.5]);
    const spine = (s) => add(p0, add(mul(dirH, Lf * s * 0.85), [0, Lf * (Math.sin(el) * s * 0.7 - 0.85 * s * s), 0]));
    const N = 9;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const c = spine(s);
      const wd = 0.13 * Math.pow(Math.sin(Math.PI * Math.min(s * 1.02 + 0.02, 1)), 0.65);
      const droop = wd * 0.45;
      const tear = (i % 3 === 1 && i > 1) ? 0.92 : 1;
      const row = [
        add(add(c, mul(side, -wd * tear)), [0, -droop, 0]),
        add(add(c, mul(side, -wd * 0.5)), [0, -droop * 0.15, 0]),
        add(c, [0, 0.01, 0]),
        add(add(c, mul(side, wd * 0.5)), [0, -droop * 0.15, 0]),
        add(add(c, mul(side, wd * tear)), [0, -droop, 0]),
      ];
      if (prev) for (let j = 0; j < 4; j++) {
        const e = [MAT.bananaLeaf, 0.65 + 0.35 * s, 0.4 + s * 0.6, j === 1 || j === 2 ? 0.5 : 0];
        mb.flatTri(prev[j], row[j], row[j + 1], e, e, e);
        mb.flatTri(prev[j], row[j + 1], prev[j + 1], e, e, e);
      }
      prev = row;
    }
  }
  return mb.build();
}

// ------------------------------------------------------------------ rock
function rock() {
  const mb = new MB();
  const { verts, faces } = icosphere(2);
  const pos = verts.map((v) => {
    const d = 1 + (vnoise(v[0] * 2.2 + 5, v[1] * 2.2, v[2] * 2.2) - 0.5) * 0.7 + (vnoise(v[0] * 6, v[1] * 6 + 3, v[2] * 6) - 0.5) * 0.2;
    return [v[0] * d * 0.55, v[1] * d * 0.38 + 0.18, v[2] * d * 0.5];
  });
  const nrm = pos.map(() => [0, 0, 0]);
  for (const [a, b, c] of faces) {
    const n = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]));
    for (const k of [a, b, c]) nrm[k] = add(nrm[k], n);
  }
  pos.forEach((p, k) => mb.vert(p, norm(nrm[k]), [MAT.rock, 0.5 + 0.5 * Math.min(1, p[1] * 2), 0, 0]));
  for (const f of faces) mb.tri(f[0], f[1], f[2]);
  return mb.build();
}

// ------------------------------------------------------------------ corals
function coralBranch() {
  const mb = new MB();
  const R = rng(61);
  const grow = (p, dir, l, r, depth) => {
    const end = add(p, mul(dir, l));
    mb.tube((t) => add(p, mul(dir, l * t)), (t) => r * (1 - 0.35 * t), 2, 5, (t) => [MAT.coralBranch, 0.4 + 0.15 * depth + 0.1 * t, 0, Math.min(1, (depth + t) / 3.5)]);
    if (depth >= 3) { mb.ico(end, r * 0.75, 0, () => [MAT.coralBranch, 1, 0, 1]); return; }
    const n = depth === 0 ? 4 : 2 + (R() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const a = R() * Math.PI * 2;
      const spread = depth === 0 ? 0.8 : 0.45;
      const nd = norm(add(dir, [Math.cos(a) * spread, 0.15, Math.sin(a) * spread]));
      grow(end, nd, l * (0.7 + R() * 0.15), r * 0.72, depth + 1);
    }
  };
  grow([0, 0, 0], [0, 1, 0], 0.22, 0.05, 0);
  return mb.build();
}
function coralBrain() {
  const mb = new MB();
  const { verts, faces } = icosphere(3);
  const base = 0;
  verts.forEach((v) => {
    const y = Math.max(v[1], -0.05);
    const d = 1 + (vnoise(v[0] * 3 + 1, v[1] * 3, v[2] * 3) - 0.5) * 0.25;
    mb.vert([v[0] * 0.5 * d, (y * 0.38 + 0.02) * d, v[2] * 0.5 * d], norm([v[0], Math.max(v[1], 0.2) * 1.3, v[2]]), [MAT.coralBrain, 0.45 + 0.55 * Math.max(v[1], 0), 0, 0]);
  });
  for (const f of faces) mb.tri(base + f[0], base + f[1], base + f[2]);
  return mb.build();
}
function seaFan() {
  const mb = new MB();
  mb.tube((t) => [0, t * 0.15, 0], () => 0.02, 1, 4, () => [MAT.seaFan, 0.5, 0, 0]);
  const rings = 7, segs = 14;
  const idx = [];
  for (let r = 0; r <= rings; r++) {
    const row = [];
    for (let s = 0; s <= segs; s++) {
      const a = Math.PI * (0.08 + 0.84 * s / segs);
      const rr = 0.05 + 0.6 * r / rings;
      const p = [Math.cos(a) * rr, 0.12 + Math.sin(a) * rr * 1.05, Math.sin(a * 3 + r) * 0.02 * r / rings];
      row.push(mb.vert(p, [0, 0, 1], [MAT.seaFan, 0.7, r / rings, r / rings]));
    }
    idx.push(row);
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) mb.quad(idx[r][s], idx[r][s + 1], idx[r + 1][s + 1], idx[r + 1][s]);
  // second fan rotated for volume
  const n0 = mb.v.length / 10;
  const extra = [];
  for (let k = 0; k < (rings + 1) * (segs + 1); k++) {
    const o = (idx[0][0] + k) * 10;
    const p = [mb.v[o], mb.v[o + 1], mb.v[o + 2]];
    const c = Math.cos(1.1), s = Math.sin(1.1);
    extra.push(mb.vert([p[0] * c * 0.8 + 0.05, p[1] * 0.85, -p[0] * s * 0.8 + 0.08], [s, 0, c], [MAT.seaFan, 0.6, mb.v[o + 8], mb.v[o + 9]]));
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = n0 + r * (segs + 1) + s;
    mb.quad(a, a + 1, a + segs + 2, a + segs + 1);
  }
  return mb.build();
}
function seagrass() {
  const mb = new MB();
  const R = rng(71);
  for (let k = 0; k < 11; k++) {
    const a = R() * Math.PI * 2;
    const o = [Math.cos(a) * R() * 0.12, 0, Math.sin(a) * R() * 0.12];
    const h = 0.45 + R() * 0.5;
    const bend = [Math.cos(a + 1) * 0.15, 0, Math.sin(a + 1) * 0.15];
    const side = norm([-Math.sin(a), 0, Math.cos(a)]);
    let prev = null;
    for (let i = 0; i <= 6; i++) {
      const s = i / 6;
      const c = add(add(o, [0, h * s, 0]), mul(bend, s * s));
      const w = 0.018 * (1 - s * 0.6);
      const row = [add(c, mul(side, -w)), add(c, mul(side, w))];
      if (prev) {
        mb.flatTri(prev[0], prev[1], row[1], [MAT.seagrass, 0.5 + 0.5 * s, s, s], [MAT.seagrass, 0.5 + 0.5 * s, s, s], [MAT.seagrass, 0.5 + 0.5 * s, s, s], side);
        mb.flatTri(prev[0], row[1], row[0], [MAT.seagrass, 0.5 + 0.5 * s, s, s], [MAT.seagrass, 0.5 + 0.5 * s, s, s], [MAT.seagrass, 0.5 + 0.5 * s, s, s], side);
      }
      prev = row;
    }
  }
  return mb.build();
}

// ------------------------------------------------------------------ fauna
function fish() {
  const mb = new MB();
  const rings = 9, rad = 8;
  const base = mb.v.length / 10;
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    const z = 0.5 - s;
    const r = 0.2 * Math.pow(Math.sin(Math.PI * Math.min(s * 0.92 + 0.04, 1)), 0.75);
    for (let j = 0; j <= rad; j++) {
      const a = j / rad * Math.PI * 2;
      const n = norm([Math.cos(a) * 1.6, Math.sin(a), 0]);
      mb.vert([Math.cos(a) * r * 0.42, Math.sin(a) * r, z], n, [MAT.fish, 0.6 + 0.4 * Math.max(0, Math.sin(a)), Math.max(0, -z + 0.2), 0]);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < rad; j++) {
    const a = base + i * (rad + 1) + j, b = a + rad + 1;
    mb.quad(a, b, b + 1, a + 1);
  }
  const e = [MAT.fish, 0.8, 1, 0];
  mb.flatTri([0, 0, -0.45], [0, 0.2, -0.72], [0, -0.2, -0.72], e, e, e, [1, 0, 0]);
  mb.flatTri([0, 0.16, 0.15], [0, 0.32, -0.1], [0, 0.15, -0.25], [MAT.fish, 0.8, 0.3, 0], [MAT.fish, 0.8, 0.5, 0], [MAT.fish, 0.8, 0.6, 0], [1, 0, 0]);
  return mb.build();
}
function bird() {
  const mb = new MB();
  const e = (f) => [MAT.bird, 0.9, f, 0];
  // body
  mb.flatTri([0, 0, 0.35], [0.05, 0, -0.1], [-0.05, 0, -0.1], e(0), e(0), e(0));
  mb.flatTri([0.05, 0, -0.1], [0, 0, -0.35], [-0.05, 0, -0.1], e(0), e(0), e(0));
  mb.flatTri([0, 0.04, 0.2], [0, -0.03, 0.2], [0, 0, -0.3], e(0), e(0), e(0), [1, 0, 0]);
  for (const s of [-1, 1]) {
    const a = [s * 0.04, 0, 0.12], b = [s * 0.04, 0, -0.08];
    const c = [s * 0.33, 0.03, 0.06], d = [s * 0.33, 0.03, -0.08];
    const tip = [s * 0.65, 0.0, -0.12];
    mb.flatTri(a, c, b, e(0), e(0.5), e(0));
    mb.flatTri(b, c, d, e(0), e(0.5), e(0.5));
    mb.flatTri(c, tip, d, e(0.5), e(1), e(0.5));
  }
  return mb.build();
}

// mesh registry: name -> { v, i, bound }
export function buildMeshes() {
  return {
    palm0: { ...palm(0), bound: 0.75 },
    palm1: { ...palm(1), bound: 0.75 },
    tree0: { ...tree(0), bound: 0.6 },
    tree1: { ...tree(1), bound: 0.6 },
    bush: { ...bush(), bound: 0.8 },
    fern: { ...fern(), bound: 0.9 },
    banana: { ...banana(), bound: 0.8 },
    rock: { ...rock(), bound: 0.8 },
    coralA: { ...coralBranch(), bound: 1.0 },
    coralB: { ...coralBrain(), bound: 0.7 },
    coralC: { ...seaFan(), bound: 1.0 },
    seagrass: { ...seagrass(), bound: 1.2 },
    fish: { ...fish(), bound: 0.8 },
    bird: { ...bird(), bound: 0.8 },
  };
}
