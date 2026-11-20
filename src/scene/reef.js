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
