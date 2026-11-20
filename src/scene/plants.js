// Vegetation: coconut palms, rainforest canopy trees, shrubs, ferns, banana plants.
import { MAT } from './catalog.js';
import { MeshBuilder as MB, add, sub, mul, cross, norm, len, rng, vnoise, icosphere } from './geometry.js';

// ------------------------------------------------------------------ palms
export function palm(lod) {
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
export function tree(lod) {
  const mb = new MB();
  const R = rng(lod === 0 ? 21 : 22);
  const H = 0.62;
  const trunk = (t) => [0.015 * Math.sin(t * 4), t * H, 0.01 * Math.cos(t * 3)];
  mb.tube(trunk, (t, a) => 0.016 * (1 - 0.35 * t) * (1 + 2.6 * Math.exp(-t * 22) * Math.pow(0.5 + 0.5 * Math.cos(5 * a), 3)),
    lod === 0 ? 10 : 4, lod === 0 ? 10 : 5, (t) => [MAT.bark, 0.35 + 0.5 * t, 0, t]);
  const crownC = [0, 0.8, 0];
  const nb = lod === 0 ? 11 : 6;
  const blobs = [];
  for (let k = 0; k < nb; k++) {
    const a = k * 2.39996 + R() * 0.6;
    const r = k === 0 ? 0 : 0.08 + Math.sqrt(k / nb) * 0.2 + R() * 0.04;
    const y = 0.86 - r * 0.55 + (R() - 0.5) * 0.06;
    blobs.push([[Math.cos(a) * r, y, Math.sin(a) * r], (lod === 0 ? 0.085 : 0.11) + R() * 0.05]);
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
      const d = blobDeform(c, crownC, r * 0.7, 22)(p, v);
      d.p[1] = c[1] + (d.p[1] - c[1]) * 0.78;
      return d;
    });
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
