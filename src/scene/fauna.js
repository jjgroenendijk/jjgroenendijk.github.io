// Wildlife: reef fish, sea birds, manta rays, sea turtles, dolphins, butterflies, sharks, jellyfish and crabs.
import { MeshBuilder as MB, add, norm, rng } from './geometry.js';
import { MAT } from './catalog.js';

// Segments around the lathe-built bodies (fish, dolphin, shark).
const BODY_RADIAL = 8,
  // Vertex extra attributes per animal: [material, ambient occlusion, flex, t].
  EXTRA = {
    bird: (f) => [MAT.bird, 0.9, f, 0],
    // Flex marks how far from the body (flapping); t marks the left wing.
    butterfly: (x) => [MAT.butterfly, 1, Math.min(Math.abs(x) * 2.2, 1), Number(x < 0)],
    dolphin: (f) => [MAT.dolphin, 0.8, f, 0],
    shark: (f, tip) => [MAT.shark, 0.8, f, tip],
  },
  // Turtle flippers: [x, z, reach, sweep back of the tip].
  FLIPPERS = [
    [0.3, 0.22, 0.42, -0.08],
    [-0.3, 0.22, 0.42, -0.08],
    [0.25, -0.32, 0.18, -0.15],
    [-0.25, -0.32, 0.18, -0.15],
  ],
  // Cross-section rings of the lathe-built bodies, s = 0 at the nose, 1 at the tail. Each returns the ring's
  // vertex at angle a as [position, normal, extra].
  PROFILE = {
    dolphin: (s) => {
      let snout = 1;
      if (s < 0.12) snout = 0.55 + s * 3.7;
      const r =
          0.13 *
          Math.sin(Math.PI * Math.min(0.06 + s * 0.94, 1)) ** 0.6 *
          snout *
          (1 - (0.55 * Math.max(s - 0.6, 0)) / 0.4),
        z = 0.5 - s;
      return (a) => [
        [Math.cos(a) * r * 0.85, Math.sin(a) * r, z],
        norm([Math.cos(a), Math.sin(a) * 0.9, 0]),
        [MAT.dolphin, 0.6 + 0.4 * Math.max(Math.sin(a), 0), Math.max(0, s - 0.45), 0],
      ];
    },
    fish: (s) => {
      const r = 0.2 * Math.sin(Math.PI * Math.min(s * 0.92 + 0.04, 1)) ** 0.75,
        z = 0.5 - s;
      return (a) => [
        [Math.cos(a) * r * 0.42, Math.sin(a) * r, z],
        norm([Math.cos(a) * 1.6, Math.sin(a), 0]),
        [MAT.fish, 0.6 + 0.4 * Math.max(0, Math.sin(a)), Math.max(0, -z + 0.2), 0],
      ];
    },
    shark: (s) => {
      const r =
          0.09 * Math.sin(Math.PI * Math.min(0.04 + s * 0.96, 1)) ** 0.7 * (1 - (0.6 * Math.max(s - 0.6, 0)) / 0.4),
        z = 0.5 - s;
      return (a) => [
        [Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.9, z],
        norm([Math.cos(a), Math.sin(a), 0]),
        [MAT.shark, 0.6 + 0.4 * Math.max(Math.sin(a), 0), Math.max(0, s - 0.35), 0],
      ];
    },
  },
  VERTEX_FLOATS = 10,
  // A body of revolution along -z: rings + 1 rings of BODY_RADIAL + 1 vertices from ringAt(s), stitched into quads.
  addBody = (mb, rings, ringAt) => {
    const base = mb.v.length / VERTEX_FLOATS;
    for (let ring = 0; ring <= rings; ring += 1) {
      const vertexAt = ringAt(ring / rings);
      for (let step = 0; step <= BODY_RADIAL; step += 1) mb.vert(...vertexAt((step / BODY_RADIAL) * Math.PI * 2));
    }
    for (let ring = 0; ring < rings; ring += 1)
      for (let step = 0; step < BODY_RADIAL; step += 1) {
        const a = base + ring * (BODY_RADIAL + 1) + step,
          b = a + BODY_RADIAL + 1;
        mb.quad(a, b, b + 1, a + 1);
      }
  },
  addFlipper = (mb, [x, z, reach, sweep]) => {
    const direction = Math.sign(x),
      front = [x + direction * reach * 0.4, 0, z + 0.09],
      root = [x * 0.8, 0, z],
      tip = [x + direction * reach, -0.02, z + sweep];
    mb.flatTri(root, front, tip, [MAT.skin, 0.8, 0, 0], [MAT.skin, 0.8, 0.5, 0], [MAT.skin, 0.8, 1, 0]);
    mb.flatTri(root, tip, [x * 0.8, 0, z - 0.1], [MAT.skin, 0.8, 0, 0], [MAT.skin, 0.8, 1, 0], [MAT.skin, 0.8, 0, 0]);
  },
  // Jellyfish bell, frilled at the rim.
  bell = (u, v) => {
    const a = u * Math.PI * 2,
      theta = v * Math.PI * 0.55;
    let frill = 0;
    if (v > 0.85) frill = Math.sin(a * 16) * 0.02;
    return [
      Math.cos(a) * Math.sin(theta) * 0.5 + frill * Math.cos(a),
      Math.cos(theta) * 0.32,
      Math.sin(a) * Math.sin(theta) * 0.5 + frill * Math.sin(a),
    ];
  },
  bird = () => {
    const mb = new MB();
    // Body
    mb.flatTri([0, 0, 0.35], [0.05, 0, -0.1], [-0.05, 0, -0.1], EXTRA.bird(0), EXTRA.bird(0), EXTRA.bird(0));
    mb.flatTri([0.05, 0, -0.1], [0, 0, -0.35], [-0.05, 0, -0.1], EXTRA.bird(0), EXTRA.bird(0), EXTRA.bird(0));
    mb.flatTri([0, 0.04, 0.2], [0, -0.03, 0.2], [0, 0, -0.3], EXTRA.bird(0), EXTRA.bird(0), EXTRA.bird(0), [1, 0, 0]);
    for (const s of [-1, 1]) {
      const a = [s * 0.04, 0, 0.12],
        b = [s * 0.04, 0, -0.08],
        c = [s * 0.33, 0.03, 0.06],
        d = [s * 0.33, 0.03, -0.08],
        tip = [s * 0.65, 0, -0.12];
      mb.flatTri(a, c, b, EXTRA.bird(0), EXTRA.bird(0.5), EXTRA.bird(0));
      mb.flatTri(b, c, d, EXTRA.bird(0), EXTRA.bird(0.5), EXTRA.bird(0.5));
      mb.flatTri(c, tip, d, EXTRA.bird(0.5), EXTRA.bird(1), EXTRA.bird(0.5));
    }
    return mb.build();
  },
  // Butterfly: wingspan 1 unit.
  butterfly = () => {
    const mb = new MB();
    for (const s of [-1, 1]) {
      const fore = [
          [0, 0, 0.05],
          [s * 0.5, 0.02, 0.22],
          [s * 0.46, 0.01, -0.02],
          [0, 0, -0.03],
        ],
        hind = [
          [0, 0, -0.02],
          [s * 0.36, 0, -0.08],
          [s * 0.22, -0.01, -0.3],
          [0, 0, -0.12],
        ];
      for (const q of [fore, hind]) {
        mb.flatTri(q[0], q[1], q[2], EXTRA.butterfly(q[0][0]), EXTRA.butterfly(q[1][0]), EXTRA.butterfly(q[2][0]));
        mb.flatTri(q[0], q[2], q[3], EXTRA.butterfly(q[0][0]), EXTRA.butterfly(q[2][0]), EXTRA.butterfly(q[3][0]));
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
  },
  // Beach crab: body width ~1 unit, legs flex for scuttling.
  crab = () => {
    const mb = new MB();
    mb.ico(
      [0, 0.18, 0],
      1,
      1,
      () => [MAT.crab, 0.8, 0, 0],
      (p, v) => ({ n: v, p: [v[0] * 0.4, 0.18 + v[1] * 0.14, v[2] * 0.3] }),
    );
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k += 1) {
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
  },
  dolphin = () => {
    const mb = new MB();
    addBody(mb, 14, PROFILE.dolphin);
    // Dorsal fin
    mb.flatTri(
      [0, 0.11, 0.05],
      [0, 0.26, -0.12],
      [0, 0.11, -0.16],
      EXTRA.dolphin(0.2),
      EXTRA.dolphin(0.3),
      EXTRA.dolphin(0.3),
      [1, 0, 0],
    );
    // Flukes
    mb.flatTri(
      [0, 0, -0.48],
      [0.2, 0.01, -0.62],
      [0.05, 0, -0.55],
      EXTRA.dolphin(1),
      EXTRA.dolphin(1),
      EXTRA.dolphin(1),
    );
    mb.flatTri(
      [0, 0, -0.48],
      [-0.05, 0, -0.55],
      [-0.2, 0.01, -0.62],
      EXTRA.dolphin(1),
      EXTRA.dolphin(1),
      EXTRA.dolphin(1),
    );
    for (const s of [-1, 1])
      mb.flatTri(
        [s * 0.08, -0.06, 0.22],
        [s * 0.22, -0.12, 0.1],
        [s * 0.08, -0.07, 0.12],
        EXTRA.dolphin(0.1),
        EXTRA.dolphin(0.1),
        EXTRA.dolphin(0.1),
      );
    return mb.build();
  },
  fish = () => {
    const fin = [MAT.fish, 0.8, 1, 0],
      mb = new MB();
    addBody(mb, 9, PROFILE.fish);
    mb.flatTri([0, 0, -0.45], [0, 0.2, -0.72], [0, -0.2, -0.72], fin, fin, fin, [1, 0, 0]);
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
  },
  // Manta wing surface: wingspan 1 unit, flat diamond with a thicker centre; lift scales the thickness per side.
  flatWing = (u, v, lift) => {
    const across = u - 0.5,
      ax = Math.abs(across) * 2,
      chord = 0.55 * (1 - ax ** 1.6) ** 0.8 + 0.02,
      lead = 0.28 - 0.18 * ax * ax,
      thickness = 0.05 * (1 - ax) ** 2 * Math.sin(Math.PI * v) + 0.004,
      z = lead - v * chord;
    return [across, thickness * lift, z];
  },
  // Jellyfish: a soft bell with a frilled rim, oral arms and long tentacles.
  jellyfish = () => {
    const mb = new MB(),
      random = rng(111);
    mb.surface(bell, 20, 6, (u, v) => [MAT.jelly, 1, v, v]);
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2,
        hang = 1 + random() * 0.8,
        p = [Math.cos(a) * 0.42, 0.02, Math.sin(a) * 0.42];
      mb.tube(
        (t) => add(p, [Math.sin(t * 6 + k) * 0.03, -t * hang, Math.cos(t * 5 + k) * 0.03]),
        () => 0.008,
        8,
        3,
        (t) => [MAT.jelly, 1, t, 1],
      );
    }
    for (let k = 0; k < 4; k += 1) {
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
  },
  // Flex grows towards the wing tips; t marks the top side.
  manta = () => {
    const mb = new MB();
    for (const [lift, top] of [
      [1, 1],
      [-0.6, 0],
    ])
      mb.surface(
        (u, v) => flatWing(u, v, lift),
        16,
        6,
        (u) => [MAT.manta, 0.8, Math.abs(u - 0.5) * 2, top],
      );
    mb.tube(
      (t) => [0, 0, -0.25 - t * 0.5],
      (t) => 0.012 * (1 - t),
      4,
      3,
      () => [MAT.manta, 0.8, 0, 1],
    );
    return mb.build();
  },
  // Blacktip reef shark, length 1 unit along +z.
  shark = () => {
    const mb = new MB();
    addBody(mb, 14, PROFILE.shark);
    // Dorsal fin, then upper and lower tail lobes
    mb.flatTri(
      [0, 0.07, 0.12],
      [0, 0.22, -0.02],
      [0, 0.07, -0.08],
      EXTRA.shark(0.2, 0),
      EXTRA.shark(0.2, 1),
      EXTRA.shark(0.25, 0),
      [1, 0, 0],
    );
    mb.flatTri(
      [0, 0, -0.46],
      [0, 0.2, -0.62],
      [0, 0.02, -0.52],
      EXTRA.shark(1, 0),
      EXTRA.shark(1, 1),
      EXTRA.shark(1, 0),
      [1, 0, 0],
    );
    mb.flatTri(
      [0, 0, -0.46],
      [0, -0.1, -0.56],
      [0, 0, -0.52],
      EXTRA.shark(1, 0),
      EXTRA.shark(1, 1),
      EXTRA.shark(1, 0),
      [1, 0, 0],
    );
    for (const s of [-1, 1])
      mb.flatTri(
        [s * 0.06, -0.04, 0.15],
        [s * 0.26, -0.1, 0],
        [s * 0.06, -0.05, 0.03],
        EXTRA.shark(0.1, 0),
        EXTRA.shark(0.1, 1),
        EXTRA.shark(0.1, 0),
      );
    return mb.build();
  },
  turtle = () => {
    const mb = new MB();
    // Shell: an icosphere squashed into a dome on top and a flatter plastron underneath
    mb.ico(
      [0, 0, 0],
      1,
      2,
      (p) => [MAT.shell, 0.6 + 0.4 * Math.max(p[1] * 4, 0), 0, 0],
      (p, v) => ({
        n: norm([v[0] * 0.5, v[1] * 2, v[2] * 0.4]),
        p: [v[0] * 0.38, Math.max(v[1] * 0.16, v[1] * 0.06), v[2] * 0.48],
      }),
    );
    mb.ico([0, 0.01, 0.52], 0.09, 1, () => [MAT.skin, 0.8, 0, 0]);
    for (const flipper of FLIPPERS) addFlipper(mb, flipper);
    return mb.build();
  };

export { bird, butterfly, crab, dolphin, fish, jellyfish, manta, shark, turtle };
