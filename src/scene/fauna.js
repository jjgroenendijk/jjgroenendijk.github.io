// Wildlife: reef fish, sea birds, manta rays and sea turtles.
import { MAT } from './catalog.js';
import { MeshBuilder as MB, add, sub, mul, cross, norm, len, rng, vnoise, icosphere } from './geometry.js';

// ------------------------------------------------------------------ fauna
export function fish() {
  const mb = new MB();
  const rings = 9,
    rad = 8;
  const base = mb.v.length / 10;
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    const z = 0.5 - s;
    const r = 0.2 * Math.pow(Math.sin(Math.PI * Math.min(s * 0.92 + 0.04, 1)), 0.75);
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const n = norm([Math.cos(a) * 1.6, Math.sin(a), 0]);
      mb.vert([Math.cos(a) * r * 0.42, Math.sin(a) * r, z], n, [
        MAT.fish,
        0.6 + 0.4 * Math.max(0, Math.sin(a)),
        Math.max(0, -z + 0.2),
        0,
      ]);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < rad; j++) {
      const a = base + i * (rad + 1) + j,
        b = a + rad + 1;
      mb.quad(a, b, b + 1, a + 1);
    }
  const e = [MAT.fish, 0.8, 1, 0];
  mb.flatTri([0, 0, -0.45], [0, 0.2, -0.72], [0, -0.2, -0.72], e, e, e, [1, 0, 0]);
  mb.flatTri(
    [0, 0.16, 0.15],
    [0, 0.32, -0.1],
    [0, 0.15, -0.25],
    [MAT.fish, 0.8, 0.3, 0],
    [MAT.fish, 0.8, 0.5, 0],
    [MAT.fish, 0.8, 0.6, 0],
    [1, 0, 0],
  );
  return mb.build();
}
export function bird() {
  const mb = new MB();
  const e = (f) => [MAT.bird, 0.9, f, 0];
  // body
  mb.flatTri([0, 0, 0.35], [0.05, 0, -0.1], [-0.05, 0, -0.1], e(0), e(0), e(0));
  mb.flatTri([0.05, 0, -0.1], [0, 0, -0.35], [-0.05, 0, -0.1], e(0), e(0), e(0));
  mb.flatTri([0, 0.04, 0.2], [0, -0.03, 0.2], [0, 0, -0.3], e(0), e(0), e(0), [1, 0, 0]);
  for (const s of [-1, 1]) {
    const a = [s * 0.04, 0, 0.12],
      b = [s * 0.04, 0, -0.08];
    const c = [s * 0.33, 0.03, 0.06],
      d = [s * 0.33, 0.03, -0.08];
    const tip = [s * 0.65, 0.0, -0.12];
    mb.flatTri(a, c, b, e(0), e(0.5), e(0));
    mb.flatTri(b, c, d, e(0), e(0.5), e(0.5));
    mb.flatTri(c, tip, d, e(0.5), e(1), e(0.5));
  }
  return mb.build();
}

export function manta() {
  const mb = new MB();
  // wingspan 1 unit, flat diamond with a thicker centre; flex grows towards the wing tips
  const shape = (u, v, top) => {
    const x = u - 0.5;
    const ax = Math.abs(x) * 2;
    const chord = 0.55 * Math.pow(1 - Math.pow(ax, 1.6), 0.8) + 0.02;
    const lead = 0.28 - 0.18 * ax * ax;
    const z = lead - v * chord;
    const th = 0.05 * Math.pow(1 - ax, 2) * Math.sin(Math.PI * v) + 0.004;
    return [x, top ? th : -th * 0.6, z];
  };
  for (const top of [true, false]) {
    mb.surface(
      (u, v) => shape(u, v, top),
      16,
      6,
      (u) => [MAT.manta, 0.8, Math.abs(u - 0.5) * 2, top ? 1 : 0],
    );
  }
  mb.tube(
    (t) => [0, 0, -0.25 - t * 0.5],
    (t) => 0.012 * (1 - t),
    4,
    3,
    () => [MAT.manta, 0.8, 0, 1],
  );
  return mb.build();
}

export function turtle() {
  const mb = new MB();
  mb.ico(
    [0, 0, 0],
    1,
    2,
    (p) => [MAT.shell, 0.6 + 0.4 * Math.max(p[1] * 4, 0), 0, 0],
    (p, v) => ({
      p: [v[0] * 0.38, v[1] > 0 ? v[1] * 0.16 : v[1] * 0.06, v[2] * 0.48],
      n: norm([v[0] * 0.5, v[1] * 2, v[2] * 0.4]),
    }),
  );
  mb.ico([0, 0.01, 0.52], 0.09, 1, () => [MAT.skin, 0.8, 0, 0]);
  const flipper = (x, z, len, back) => {
    const s = Math.sign(x);
    const root = [x * 0.8, 0, z];
    const tip = [x + s * len, -0.02, z + (back ? -0.15 : -0.08)];
    const front = [x + s * len * 0.4, 0, z + 0.09];
    mb.flatTri(root, front, tip, [MAT.skin, 0.8, 0, 0], [MAT.skin, 0.8, 0.5, 0], [MAT.skin, 0.8, 1, 0]);
    mb.flatTri(root, tip, [x * 0.8, 0, z - 0.1], [MAT.skin, 0.8, 0, 0], [MAT.skin, 0.8, 1, 0], [MAT.skin, 0.8, 0, 0]);
  };
  flipper(0.3, 0.22, 0.42, false);
  flipper(-0.3, 0.22, 0.42, false);
  flipper(0.25, -0.32, 0.18, true);
  flipper(-0.25, -0.32, 0.18, true);
  return mb.build();
}

export function dolphin() {
  const mb = new MB();
  const rings = 14,
    rad = 8;
  const base = mb.v.length / 10;
  for (let i = 0; i <= rings; i++) {
    const s = i / rings; // 0 = beak, 1 = tail stock
    const z = 0.5 - s;
    const r =
      0.13 *
      Math.pow(Math.sin(Math.PI * Math.min(0.06 + s * 0.94, 1)), 0.6) *
      (s < 0.12 ? 0.55 + s * 3.7 : 1) *
      (1 - (0.55 * Math.max(s - 0.6, 0)) / 0.4);
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const n = norm([Math.cos(a), Math.sin(a) * 0.9, 0]);
      mb.vert([Math.cos(a) * r * 0.85, Math.sin(a) * r, z], n, [
        MAT.dolphin,
        0.6 + 0.4 * Math.max(Math.sin(a), 0),
        Math.max(0, s - 0.45),
        0,
      ]);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < rad; j++) {
      const a = base + i * (rad + 1) + j,
        b = a + rad + 1;
      mb.quad(a, b, b + 1, a + 1);
    }
  const e = (f) => [MAT.dolphin, 0.8, f, 0];
  mb.flatTri([0, 0.11, 0.05], [0, 0.26, -0.12], [0, 0.11, -0.16], e(0.2), e(0.3), e(0.3), [1, 0, 0]); // dorsal fin
  mb.flatTri([0, 0, -0.48], [0.2, 0.01, -0.62], [0.05, 0, -0.55], e(1), e(1), e(1)); // flukes
  mb.flatTri([0, 0, -0.48], [-0.05, 0, -0.55], [-0.2, 0.01, -0.62], e(1), e(1), e(1));
  for (const s of [-1, 1])
    mb.flatTri([s * 0.08, -0.06, 0.22], [s * 0.22, -0.12, 0.1], [s * 0.08, -0.07, 0.12], e(0.1), e(0.1), e(0.1));
  return mb.build();
}

// butterfly: wingspan 1 unit; flex marks how far from the body (flapping)
export function butterfly() {
  const mb = new MB();
  const e = (x) => [MAT.butterfly, 1, Math.min(Math.abs(x) * 2.2, 1), x < 0 ? 1 : 0];
  for (const s of [-1, 1]) {
    const fore = [
      [0, 0, 0.05],
      [s * 0.5, 0.02, 0.22],
      [s * 0.46, 0.01, -0.02],
      [0, 0, -0.03],
    ];
    const hind = [
      [0, 0, -0.02],
      [s * 0.36, 0.0, -0.08],
      [s * 0.22, -0.01, -0.3],
      [0, 0, -0.12],
    ];
    for (const q of [fore, hind]) {
      mb.flatTri(q[0], q[1], q[2], e(q[0][0]), e(q[1][0]), e(q[2][0]));
      mb.flatTri(q[0], q[2], q[3], e(q[0][0]), e(q[2][0]), e(q[3][0]));
    }
  }
  mb.tube(
    (t) => [0, 0, 0.1 - t * 0.28],
    () => 0.015,
    2,
    4,
    () => [MAT.butterfly, 0.6, 0, 0.5],
  );
  return mb.build();
}

// blacktip reef shark, length 1 unit along +z
export function shark() {
  const mb = new MB();
  const rings = 14,
    rad = 8;
  const base = mb.v.length / 10;
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    const z = 0.5 - s;
    const r =
      0.09 * Math.pow(Math.sin(Math.PI * Math.min(0.04 + s * 0.96, 1)), 0.7) * (1 - (0.6 * Math.max(s - 0.6, 0)) / 0.4);
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      mb.vert([Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.9, z], norm([Math.cos(a), Math.sin(a), 0]), [
        MAT.shark,
        0.6 + 0.4 * Math.max(Math.sin(a), 0),
        Math.max(0, s - 0.35),
        0,
      ]);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < rad; j++) {
      const a = base + i * (rad + 1) + j,
        b = a + rad + 1;
      mb.quad(a, b, b + 1, a + 1);
    }
  const e = (f, tip) => [MAT.shark, 0.8, f, tip];
  mb.flatTri([0, 0.07, 0.12], [0, 0.22, -0.02], [0, 0.07, -0.08], e(0.2, 0), e(0.2, 1), e(0.25, 0), [1, 0, 0]); // dorsal
  mb.flatTri([0, 0, -0.46], [0, 0.2, -0.62], [0, 0.02, -0.52], e(1, 0), e(1, 1), e(1, 0), [1, 0, 0]); // tail upper
  mb.flatTri([0, 0, -0.46], [0, -0.1, -0.56], [0, 0.0, -0.52], e(1, 0), e(1, 1), e(1, 0), [1, 0, 0]); // tail lower
  for (const s of [-1, 1])
    mb.flatTri(
      [s * 0.06, -0.04, 0.15],
      [s * 0.26, -0.1, 0.0],
      [s * 0.06, -0.05, 0.03],
      e(0.1, 0),
      e(0.1, 1),
      e(0.1, 0),
    );
  return mb.build();
}

// jellyfish: a soft bell with a frilled rim, oral arms and long tentacles
export function jellyfish() {
  const mb = new MB();
  mb.surface(
    (u, v) => {
      const a = u * Math.PI * 2,
        th = v * Math.PI * 0.55;
      const frill = v > 0.85 ? Math.sin(a * 16) * 0.02 : 0;
      return [
        Math.cos(a) * Math.sin(th) * 0.5 + frill * Math.cos(a),
        Math.cos(th) * 0.32,
        Math.sin(a) * Math.sin(th) * 0.5 + frill * Math.sin(a),
      ];
    },
    20,
    6,
    (u, v) => [MAT.jelly, 1, v, v],
  );
  const R = rng(111);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const p = [Math.cos(a) * 0.42, 0.02, Math.sin(a) * 0.42];
    const L = 1.0 + R() * 0.8;
    mb.tube(
      (t) => add(p, [Math.sin(t * 6 + k) * 0.03, -t * L, Math.cos(t * 5 + k) * 0.03]),
      () => 0.008,
      8,
      3,
      (t) => [MAT.jelly, 1, t, 1],
    );
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    mb.tube(
      (t) => [Math.cos(a) * 0.06 + Math.sin(t * 4) * 0.05, 0.05 - t * 0.7, Math.sin(a) * 0.06],
      (t) => 0.04 * (1 - 0.6 * t),
      6,
      5,
      (t) => [MAT.jelly, 1, t, 0.7],
    );
  }
  return mb.build();
}

// beach crab: body width ~1 unit, legs flex for scuttling
export function crab() {
  const mb = new MB();
  mb.ico(
    [0, 0.18, 0],
    1,
    1,
    () => [MAT.crab, 0.8, 0, 0],
    (p, v) => ({ p: [v[0] * 0.4, 0.18 + v[1] * 0.14, v[2] * 0.3], n: v }),
  );
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const z = -0.18 + k * 0.12;
      mb.tube(
        (t) => [s * (0.3 + t * 0.35), 0.18 + Math.sin(t * Math.PI) * 0.12 - t * 0.18, z + (k - 1.5) * 0.05 * t],
        () => 0.025,
        3,
        3,
        (t) => [MAT.crab, 0.7, t, 0],
      );
    }
    mb.tube(
      (t) => [s * (0.15 + t * 0.12), 0.2 + t * 0.06, 0.25 + t * 0.2],
      () => 0.04,
      2,
      4,
      () => [MAT.crab, 0.8, 0.2, 0],
    );
    mb.ico([s * 0.3, 0.27, 0.5], 0.09, 1, () => [MAT.crab, 0.9, 0.2, 0]);
  }
  return mb.build();
}
