// Rocks, corals and seagrass.
import { MAT } from './catalog.js';
import { MeshBuilder as MB, add, sub, mul, cross, norm, len, rng, vnoise, icosphere } from './geometry.js';

// ------------------------------------------------------------------ rock
export function rock() {
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
export function coralBranch() {
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
export function coralBrain() {
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
export function seaFan() {
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
export function seagrass() {
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

// table coral: a wide wavy plate on a short stem
export function coralTable() {
  const mb = new MB();
  mb.tube((t) => [0, t * 0.3, 0], (t) => 0.06 * (1 - 0.3 * t), 2, 6, () => [MAT.coralBranch, 0.5, 0, 0.3]);
  for (const side of [1, -1]) {
    mb.surface((u, v) => {
      const a = u * Math.PI * 2, r = 0.06 + v * 0.55;
      const wav = Math.sin(a * 5) * 0.03 * v + Math.sin(a * 11) * 0.015 * v;
      return [Math.cos(a) * r, 0.3 + v * 0.06 + wav + side * 0.012 * (1 - v), Math.sin(a) * r * side];
    }, 24, 4, (u, v) => [MAT.coralBranch, side > 0 ? 0.6 + 0.4 * v : 0.35, 0, 0.4 + 0.6 * v]);
  }
  return mb.build();
}

// tube sponges: a clump of open, slightly flared tubes
export function tubeSponge() {
  const mb = new MB();
  const R = rng(91);
  for (let k = 0; k < 6; k++) {
    const a = k * 2.4, r = k === 0 ? 0 : 0.12 + R() * 0.1;
    const base = [Math.cos(a) * r, 0, Math.sin(a) * r];
    const h = 0.4 + R() * 0.6;
    const lean = [Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12];
    for (const inner of [false, true]) {
      mb.tube((t) => add(add(base, [0, t * h, 0]), mul(lean, t * t)), (t) => (0.07 + 0.03 * t * t) * (inner ? 0.8 : 1), 4, 8,
        (t) => [MAT.sponge, inner ? 0.3 + 0.3 * t : 0.6 + 0.4 * t, 0.2 * t, t]);
    }
  }
  return mb.build();
}

// soft coral: swaying stalks covered in polyp clusters
export function softCoral() {
  const mb = new MB();
  const R = rng(97);
  const grow = (p, dir, l, depth) => {
    const end = add(p, mul(dir, l));
    mb.tube((t) => add(p, mul(dir, l * t)), () => 0.03 * (1 - depth * 0.25), 2, 5, (t) => [MAT.softCoral, 0.5, (depth + t) / 3, 0.2]);
    if (depth >= 2) {
      for (let k = 0; k < 4; k++) mb.ico(add(end, [(R() - 0.5) * 0.08, R() * 0.06, (R() - 0.5) * 0.08]), 0.05 + R() * 0.03, 1, () => [MAT.softCoral, 0.9, 1, 1]);
      return;
    }
    for (let k = 0; k < 3; k++) {
      const a = R() * Math.PI * 2;
      grow(end, norm(add(dir, [Math.cos(a) * 0.6, 0.2, Math.sin(a) * 0.6])), l * 0.75, depth + 1);
    }
  };
  grow([0, 0, 0], [0, 1, 0], 0.28, 0);
  return mb.build();
}

// sea anemone: a disc of long swaying tentacles
export function anemone() {
  const mb = new MB();
  const R = rng(101);
  mb.tube((t) => [0, t * 0.1, 0], () => 0.16, 1, 10, () => [MAT.anemone, 0.5, 0, 0]);
  for (let k = 0; k < 46; k++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.15;
    const out = [Math.cos(a), 0, Math.sin(a)];
    const base = [out[0] * r, 0.1, out[2] * r];
    const L = 0.18 + R() * 0.14;
    mb.tube((t) => add(base, [out[0] * t * L * 0.6, t * L, out[2] * t * L * 0.6]), (t) => 0.018 * (1 - 0.5 * t), 3, 4,
      (t) => [MAT.anemone, 0.7 + 0.3 * t, t, t]);
  }
  return mb.build();
}

// starfish: five tapered arms
export function starfish() {
  const mb = new MB();
  for (const top of [true, false]) {
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * Math.PI * 2;
      const tip = [Math.cos(a0) * 0.5, 0.01, Math.sin(a0) * 0.5];
      const l = [Math.cos(a0 - 0.63) * 0.12, top ? 0.06 : 0.0, Math.sin(a0 - 0.63) * 0.12];
      const r = [Math.cos(a0 + 0.63) * 0.12, top ? 0.06 : 0.0, Math.sin(a0 + 0.63) * 0.12];
      const c = [0, top ? 0.08 : 0, 0];
      const e = [MAT.starfish, 0.8, 0, 0];
      mb.flatTri(c, l, tip, e, e, e, top ? [0, 1, 0] : [0, -1, 0]);
      mb.flatTri(c, tip, r, e, e, e, top ? [0, 1, 0] : [0, -1, 0]);
    }
  }
  return mb.build();
}
