// Vegetation: coconut palms, rainforest canopy trees, shrubs, ferns, banana plants.
import { MAT } from './catalog.js';
import { MeshBuilder as MB, add, sub, mul, cross, norm, len, dot, rng, vnoise, icosphere } from './geometry.js';

// ------------------------------------------------------------------ palms
export function palm(lod) {
  const mb = new MB();
  const R = rng(lod === 0 ? 11 : 12);
  const trunk = (t) => [0.05 * Math.sin(t * 2.4) * t, t, 0.02 * Math.sin(t * 3.1)];
  mb.tube(trunk, (t) => 0.019 * (1 + 0.7 * Math.exp(-t * 14)) * (1 - 0.25 * t), [12, 5, 3][lod], [7, 5, 3][lod],
    (t) => [MAT.palmBark, 0.55 + 0.45 * t, 0, t]);
  const top = trunk(1);
  if (lod < 2) mb.ico(add(top, [0, 0.005, 0]), 0.032, 1, () => [MAT.coconut, 0.6, 0.1, 1]);
  if (lod === 0) for (let k = 0; k < 5; k++) {
    const a = k * 2.4;
    mb.ico(add(top, [Math.cos(a) * 0.03, -0.03 - R() * 0.01, Math.sin(a) * 0.03]), 0.017, 1, () => [MAT.coconut, 0.5, 0.05, 1]);
  }
  const nf = [13, 9, 7][lod];
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
      const N = lod === 1 ? 6 : 2;
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
export function tree(lod) {
  const mb = new MB();
  const R = rng(lod === 0 ? 21 : 22);
  const H = 0.62;
  const trunk = (t) => [0.015 * Math.sin(t * 4), t * H, 0.01 * Math.cos(t * 3)];
  mb.tube(trunk, (t, a) => 0.016 * (1 - 0.35 * t) * (1 + 2.6 * Math.exp(-t * 22) * Math.pow(0.5 + 0.5 * Math.cos(5 * a), 3)),
    [10, 4, 2][lod], [10, 5, 3][lod], (t) => [MAT.bark, 0.35 + 0.5 * t, 0, t]);
  const crownC = [0, 0.8, 0];
  const nb = [11, 6, 4][lod];
  const blobs = [];
  for (let k = 0; k < nb; k++) {
    const a = k * 2.39996 + R() * 0.6;
    const r = k === 0 ? 0 : 0.08 + Math.sqrt(k / nb) * 0.2 + R() * 0.04;
    const y = 0.86 - r * 0.55 + (R() - 0.5) * 0.06;
    blobs.push([[Math.cos(a) * r, y, Math.sin(a) * r], [0.085, 0.11, 0.135][lod] + R() * 0.05]);
  }
  // branches
  if (lod === 0) for (let k = 1; k < nb; k++) {
    const [c] = blobs[k];
    const s = trunk(0.85);
    mb.tube((t) => add(s, mul(sub(add(c, [0, -0.04, 0]), s), t)), (t) => 0.007 * (1 - 0.6 * t), 3, 4, (t) => [MAT.bark, 0.5, 0, 0.8 + 0.2 * t]);
  }
  for (const [c, r] of blobs) {
    // a dense core keeps the crown opaque...
    mb.ico(c, lod === 0 ? r * 0.82 : r, lod === 2 ? 0 : 1, (p, v) => {
      const out = Math.min(1, len(sub(p, crownC)) / 0.25);
      return [MAT.canopy, Math.min(1, (lod === 0 ? 0.2 : 0.3) + 0.45 * (v[1] * 0.5 + 0.5) + 0.35 * out), 1, p[1]];
    }, (p, v) => {
      const d = blobDeform(c, crownC, r * 0.7, 22)(p, v);
      d.p[1] = c[1] + (d.p[1] - c[1]) * 0.78;
      return d;
    });
    if (lod !== 0) continue;
    // ...and individual leaf clusters break up its silhouette and catch the light
    for (let k = 0; k < 70; k++) {
      const z = R() * 2 - 1, a = R() * Math.PI * 2;
      const v = [Math.sqrt(1 - z * z) * Math.cos(a), z * 0.8 + 0.2, Math.sqrt(1 - z * z) * Math.sin(a)];
      const pos = add(c, mul(norm(v), r * (0.85 + 0.35 * R())));
      pos[1] = c[1] + (pos[1] - c[1]) * 0.8;
      const ln = norm(add(norm(v), [R() - 0.5, R() - 0.3, R() - 0.5]));
      const t1 = norm(cross(ln, Math.abs(ln[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const t2 = cross(ln, t1);
      const sz = 0.026 * (0.7 + 0.6 * R());
      const radial = norm(sub(pos, crownC));
      const n = norm(add(mul(radial, 0.65), mul(ln, 0.35)));
      const ao = 0.5 + 0.5 * (norm(v)[1] * 0.5 + 0.5);
      const e = [MAT.canopy, ao, 1, pos[1]];
      const q = [add(pos, mul(t1, sz)), add(pos, mul(t2, sz * 0.55)), add(pos, mul(t1, -sz)), add(pos, mul(t2, -sz * 0.55))];
      const i0 = mb.vert(q[0], n, e), i1 = mb.vert(q[1], n, e), i2 = mb.vert(q[2], n, e), i3 = mb.vert(q[3], n, e);
      mb.quad(i0, i1, i2, i3);
    }
  }
  return mb.build();
}

// understory shrub: a dense rosette of broad, drooping leaves on short stems
export function bush() {
  const mb = new MB();
  const R = rng(31);
  const leaves = 30;
  for (let k = 0; k < leaves; k++) {
    const phi = k * 2.39996 + R() * 0.5;
    const rise = 0.25 + R() * 0.75;
    const L = 0.35 + R() * 0.25;
    const dir = [Math.cos(phi), 0, Math.sin(phi)];
    const side = [-Math.sin(phi), 0, Math.cos(phi)];
    const start = [dir[0] * 0.05, 0.1 + rise * 0.45, dir[2] * 0.05];
    const spine = (s) => add(start, add(mul(dir, L * s), [0, L * (0.45 * s - 0.7 * s * s) * (1.2 - rise * 0.6), 0]));
    let prev = null;
    for (let i = 0; i <= 4; i++) {
      const s = i / 4;
      const c = spine(s);
      const wd = 0.11 * Math.pow(Math.sin(Math.PI * Math.min(s * 0.95 + 0.05, 1)), 0.7);
      const row = [add(add(c, mul(side, -wd)), [0, -wd * 0.35, 0]), add(c, [0, 0.008, 0]), add(add(c, mul(side, wd)), [0, -wd * 0.35, 0])];
      if (prev) for (let j = 0; j < 2; j++) {
        const e = [MAT.bush, 0.45 + 0.5 * rise, 0.3 + s * 0.7, s];
        mb.flatTri(prev[j], row[j], row[j + 1], e);
        mb.flatTri(prev[j], row[j + 1], prev[j + 1], e);
      }
      prev = row;
    }
  }
  return mb.build();
}

// ------------------------------------------------------------------ fern
export function fern() {
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
export function banana() {
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

// flowering shrub: a low leafy rosette crowned with hibiscus-like blooms
export function flowerBush() {
  const mb = new MB();
  const R = rng(81);
  for (let k = 0; k < 18; k++) {
    const phi = k * 2.39996 + R() * 0.4;
    const L = 0.3 + R() * 0.2;
    const dir = [Math.cos(phi), 0, Math.sin(phi)];
    const side = [-Math.sin(phi), 0, Math.cos(phi)];
    const rise = R();
    const start = [0, 0.1 + rise * 0.35, 0];
    const spine = (s) => add(start, add(mul(dir, L * s), [0, L * (0.5 * s - 0.6 * s * s), 0]));
    let prev = null;
    for (let i = 0; i <= 3; i++) {
      const s = i / 3;
      const c = spine(s);
      const wd = 0.07 * Math.sin(Math.PI * Math.min(s * 0.9 + 0.1, 1));
      const row = [add(c, mul(side, -wd)), add(c, [0, 0.006, 0]), add(c, mul(side, wd))];
      if (prev) for (let j = 0; j < 2; j++) {
        const e = [MAT.bush, 0.5 + 0.5 * rise, 0.3 + s * 0.6, s];
        mb.flatTri(prev[j], row[j], row[j + 1], e);
        mb.flatTri(prev[j], row[j + 1], prev[j + 1], e);
      }
      prev = row;
    }
  }
  for (let f = 0; f < 12; f++) {
    const a = f * 2.39996 + R();
    const r = 0.12 + R() * 0.22;
    const c = [Math.cos(a) * r, 0.42 + R() * 0.25 - r * 0.4, Math.sin(a) * r];
    const up = norm([Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5]);
    const t1 = norm(cross(up, [0, 0, 1])), t2 = cross(up, t1);
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2 + f;
      const pd = add(mul(t1, Math.cos(pa)), mul(t2, Math.sin(pa)));
      const pd2 = add(mul(t1, Math.cos(pa + 0.62)), mul(t2, Math.sin(pa + 0.62)));
      const tip = add(add(c, mul(pd, 0.11)), mul(up, 0.045));
      const mid = add(add(c, mul(norm(add(pd, pd2)), 0.115)), mul(up, 0.05));
      mb.flatTri(c, tip, mid, [MAT.petal, 0.9, 0.3, 0], [MAT.petal, 1, 0.5, 1], [MAT.petal, 1, 0.5, 1], up);
      mb.flatTri(c, mid, add(add(c, mul(pd2, 0.11)), mul(up, 0.045)), [MAT.petal, 0.9, 0.3, 0], [MAT.petal, 1, 0.5, 1], [MAT.petal, 1, 0.5, 1], up);
    }
    mb.tube((t) => add(c, mul(up, t * 0.06)), () => 0.004, 1, 3, () => [MAT.petal, 1, 0.3, 0.05]);
  }
  return mb.build();
}
