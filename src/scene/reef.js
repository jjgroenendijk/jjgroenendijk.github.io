// Rocks, corals and seagrass.
import { MeshBuilder, add, cross, icosphere, mul, norm, rng, sub, vnoise } from './geometry.js';
import { MAT } from './catalog.js';

// Branch coral forks four times from the trunk, then two or three times; the trunk's forks spread widest.
const CORAL_FORKS = [4],
  CORAL_SPREAD = [0.8, 0.45, 0.45],
  FAN_RINGS = 7,
  FAN_SEGS = 14,
  VERTEX_FLOATS = 10,
  // The quads of a sea fan net whose vertices start at first.
  fanQuads = (mb, first) => {
    for (let r = 0; r < FAN_RINGS; r += 1)
      for (let s = 0; s < FAN_SEGS; s += 1) {
        const a = first + r * (FAN_SEGS + 1) + s;
        mb.quad(a, a + 1, a + FAN_SEGS + 2, a + FAN_SEGS + 1);
      }
  },
  // Second sea fan net: a copy of the first one's vertices from first on, turned for volume.
  fanCopy = (mb, first) => {
    const c = Math.cos(1.1),
      copy = mb.v.length / VERTEX_FLOATS,
      s = Math.sin(1.1);
    for (let k = 0; k < (FAN_RINGS + 1) * (FAN_SEGS + 1); k += 1) {
      const at = (first + k) * VERTEX_FLOATS,
        x = mb.v[at];
      mb.vert(
        [x * c * 0.8 + 0.05, mb.v[at + 1] * 0.85, -x * s * 0.8 + 0.08],
        [s, 0, c],
        [MAT.seaFan, 0.6, mb.v[at + 8], mb.v[at + 9]],
      );
    }
    fanQuads(mb, copy);
  },
  // Sea fan net: a fan of (FAN_RINGS + 1) x (FAN_SEGS + 1) vertices; returns the first one's index.
  fanNet = (mb) => {
    const first = mb.v.length / VERTEX_FLOATS;
    for (let r = 0; r <= FAN_RINGS; r += 1)
      for (let s = 0; s <= FAN_SEGS; s += 1) {
        const a = Math.PI * (0.08 + (0.84 * s) / FAN_SEGS),
          rr = 0.05 + (0.6 * r) / FAN_RINGS;
        mb.vert(
          [Math.cos(a) * rr, 0.12 + Math.sin(a) * rr * 1.05, (Math.sin(a * 3 + r) * 0.02 * r) / FAN_RINGS],
          [0, 0, 1],
          [MAT.seaFan, 0.7, r / FAN_RINGS, r / FAN_RINGS],
        );
      }
    fanQuads(mb, first);
    return first;
  },
  // Seagrass blade: a ribbon from base that rises to height and bends over along bend.
  grassBlade = (mb, base, bend, [height, side]) => {
    const strips = Array.from({ length: 7 }, (_, step) => {
      const along = step / 6,
        centre = add(add(base, [0, height * along, 0]), mul(bend, along * along)),
        width = 0.018 * (1 - along * 0.6);
      return [add(centre, mul(side, -width)), add(centre, mul(side, width))];
    });
    for (let step = 1; step < strips.length; step += 1) {
      const [p0, p1] = strips[step - 1],
        [r0, r1] = strips[step],
        s = step / 6,
        tint = [MAT.seagrass, 0.5 + 0.5 * s, s, s];
      mb.flatTri(p0, p1, r1, tint, tint, tint, side);
      mb.flatTri(p0, r1, r0, tint, tint, tint, side);
    }
  },
  // Tube sponge: an outer and an inner tube, rising to height and leaning out along angle.
  sponge = (mb, angle, reach, height) => {
    const base = [Math.cos(angle) * reach, 0, Math.sin(angle) * reach],
      lean = [Math.cos(angle) * 0.12, 0, Math.sin(angle) * 0.12];
    for (const [scale, shade] of [
      [1, (t) => 0.6 + 0.4 * t],
      [0.8, (t) => 0.3 + 0.3 * t],
    ])
      mb.tube(
        (t) => add(add(base, [0, t * height, 0]), mul(lean, t * t)),
        (t) => (0.07 + 0.03 * t * t) * scale,
        4,
        8,
        (t) => [MAT.sponge, shade(t), 0.2 * t, t],
      );
  },
  // Sea anemone: a disc of long swaying tentacles.
  anemone = () => {
    const mb = new MeshBuilder(),
      rand = rng(101);
    mb.tube(
      (t) => [0, t * 0.1, 0],
      () => 0.16,
      1,
      10,
      () => [MAT.anemone, 0.5, 0, 0],
    );
    for (let k = 0; k < 46; k += 1) {
      const angle = rand() * Math.PI * 2,
        distance = Math.sqrt(rand()) * 0.15,
        out = [Math.cos(angle), 0, Math.sin(angle)],
        root = [out[0] * distance, 0.1, out[2] * distance],
        tentacle = 0.18 + rand() * 0.14;
      mb.tube(
        (t) => add(root, [out[0] * t * tentacle * 0.6, t * tentacle, out[2] * t * tentacle * 0.6]),
        (t) => 0.018 * (1 - 0.5 * t),
        3,
        4,
        (t) => [MAT.anemone, 0.7 + 0.3 * t, t, t],
      );
    }
    return mb.build();
  },
  coralBrain = () => {
    const mb = new MeshBuilder(),
      { verts, faces } = icosphere(3);
    for (const v of verts) {
      const d = 1 + (vnoise(v[0] * 3 + 1, v[1] * 3, v[2] * 3) - 0.5) * 0.25,
        y = Math.max(v[1], -0.05);
      mb.vert([v[0] * 0.5 * d, (y * 0.38 + 0.02) * d, v[2] * 0.5 * d], norm([v[0], Math.max(v[1], 0.2) * 1.3, v[2]]), [
        MAT.coralBrain,
        0.45 + 0.55 * Math.max(v[1], 0),
        0,
        0,
      ]);
    }
    for (const [a, b, c] of faces) mb.tri(a, b, c);
    return mb.build();
  },
  // Branch coral: forking tubes that end in rounded tips.
  coralBranch = () => {
    const mb = new MeshBuilder(),
      rand = rng(61),
      grow = (start, heading, [length, radius], depth) => {
        const end = add(start, mul(heading, length));
        mb.tube(
          (t) => add(start, mul(heading, length * t)),
          (t) => radius * (1 - 0.35 * t),
          2,
          5,
          (t) => [MAT.coralBranch, 0.4 + 0.15 * depth + 0.1 * t, 0, Math.min(1, (depth + t) / 3.5)],
        );
        if (depth >= 3) mb.ico(end, radius * 0.75, 0, () => [MAT.coralBranch, 1, 0, 1]);
        else {
          const forks = CORAL_FORKS[depth] ?? 2 + Number(rand() < 0.5);
          for (let k = 0; k < forks; k += 1) {
            const a = rand() * Math.PI * 2,
              child = norm(add(heading, [Math.cos(a) * CORAL_SPREAD[depth], 0.15, Math.sin(a) * CORAL_SPREAD[depth]]));
            grow(end, child, [length * (0.7 + rand() * 0.15), radius * 0.72], depth + 1);
          }
        }
      };
    grow([0, 0, 0], [0, 1, 0], [0.22, 0.05], 0);
    return mb.build();
  },
  seaFan = () => {
    const mb = new MeshBuilder();
    mb.tube(
      (t) => [0, t * 0.15, 0],
      () => 0.02,
      1,
      4,
      () => [MAT.seaFan, 0.5, 0, 0],
    );
    fanCopy(mb, fanNet(mb));
    return mb.build();
  },
  rock = () => {
    const mb = new MeshBuilder(),
      { verts, faces } = icosphere(2),
      pos = verts.map((v) => {
        const d =
          1 +
          (vnoise(v[0] * 2.2 + 5, v[1] * 2.2, v[2] * 2.2) - 0.5) * 0.7 +
          (vnoise(v[0] * 6, v[1] * 6 + 3, v[2] * 6) - 0.5) * 0.2;
        return [v[0] * d * 0.55, v[1] * d * 0.38 + 0.18, v[2] * d * 0.5];
      }),
      sums = pos.map(() => [0, 0, 0]);
    for (const [a, b, c] of faces) {
      const n = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]));
      for (const k of [a, b, c]) sums[k] = add(sums[k], n);
    }
    for (const [k, p] of pos.entries()) mb.vert(p, norm(sums[k]), [MAT.rock, 0.5 + 0.5 * Math.min(1, p[1] * 2), 0, 0]);
    for (const [a, b, c] of faces) mb.tri(a, b, c);
    return mb.build();
  },
  seagrass = () => {
    const mb = new MeshBuilder(),
      rand = rng(71);
    for (let k = 0; k < 11; k += 1) {
      const angle = rand() * Math.PI * 2,
        base = [Math.cos(angle) * rand() * 0.12, 0, Math.sin(angle) * rand() * 0.12],
        bend = [Math.cos(angle + 1) * 0.15, 0, Math.sin(angle + 1) * 0.15],
        height = 0.45 + rand() * 0.5;
      grassBlade(mb, base, bend, [height, norm([-Math.sin(angle), 0, Math.cos(angle)])]);
    }
    return mb.build();
  },
  // Soft coral: swaying stalks covered in polyp clusters.
  softCoral = () => {
    const mb = new MeshBuilder(),
      rand = rng(97),
      grow = (start, heading, length, depth) => {
        const end = add(start, mul(heading, length));
        mb.tube(
          (t) => add(start, mul(heading, length * t)),
          () => 0.03 * (1 - depth * 0.25),
          2,
          5,
          (t) => [MAT.softCoral, 0.5, (depth + t) / 3, 0.2],
        );
        if (depth >= 2) {
          for (let k = 0; k < 4; k += 1)
            mb.ico(
              add(end, [(rand() - 0.5) * 0.08, rand() * 0.06, (rand() - 0.5) * 0.08]),
              0.05 + rand() * 0.03,
              1,
              () => [MAT.softCoral, 0.9, 1, 1],
            );
          return;
        }
        for (let k = 0; k < 3; k += 1) {
          const a = rand() * Math.PI * 2,
            child = norm(add(heading, [Math.cos(a) * 0.6, 0.2, Math.sin(a) * 0.6]));
          grow(end, child, length * 0.75, depth + 1);
        }
      };
    grow([0, 0, 0], [0, 1, 0], 0.28, 0);
    return mb.build();
  },
  // Starfish: five tapered arms, each two triangles on the domed top and two on the flat underside.
  starfish = () => {
    const mb = new MeshBuilder();
    for (const [rim, peak, up] of [
      [0.06, 0.08, [0, 1, 0]],
      [0, 0, [0, -1, 0]],
    ])
      for (let k = 0; k < 5; k += 1) {
        const a0 = (k / 5) * Math.PI * 2,
          centre = [0, peak, 0],
          left = [Math.cos(a0 - 0.63) * 0.12, rim, Math.sin(a0 - 0.63) * 0.12],
          right = [Math.cos(a0 + 0.63) * 0.12, rim, Math.sin(a0 + 0.63) * 0.12],
          tint = [MAT.starfish, 0.8, 0, 0],
          tip = [Math.cos(a0) * 0.5, 0.01, Math.sin(a0) * 0.5];
        mb.flatTri(centre, left, tip, tint, tint, tint, up);
        mb.flatTri(centre, tip, right, tint, tint, tint, up);
      }
    return mb.build();
  },
  // Table coral: a wide wavy plate on a short stem, lit brighter on top.
  coralTable = () => {
    const mb = new MeshBuilder();
    mb.tube(
      (t) => [0, t * 0.3, 0],
      (t) => 0.06 * (1 - 0.3 * t),
      2,
      6,
      () => [MAT.coralBranch, 0.5, 0, 0.3],
    );
    for (const [side, shade] of [
      [1, (v) => 0.6 + 0.4 * v],
      [-1, () => 0.35],
    ])
      mb.surface(
        (u, v) => {
          const a = u * Math.PI * 2,
            r = 0.06 + v * 0.55,
            wav = Math.sin(a * 5) * 0.03 * v + Math.sin(a * 11) * 0.015 * v;
          return [Math.cos(a) * r, 0.3 + v * 0.06 + wav + side * 0.012 * (1 - v), Math.sin(a) * r * side];
        },
        24,
        4,
        (u, v) => [MAT.coralBranch, shade(v), 0, 0.4 + 0.6 * v],
      );
    return mb.build();
  },
  // Tube sponges: a clump of open, slightly flared tubes around a central one.
  tubeSponge = () => {
    const mb = new MeshBuilder(),
      rand = rng(91);
    sponge(mb, 0, 0, 0.4 + rand() * 0.6);
    for (let k = 1; k < 6; k += 1) sponge(mb, k * 2.4, 0.12 + rand() * 0.1, 0.4 + rand() * 0.6);
    return mb.build();
  };

export { anemone, coralBrain, coralBranch, coralTable, rock, seaFan, seagrass, softCoral, starfish, tubeSponge };
