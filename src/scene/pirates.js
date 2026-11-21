// Hints of pirates: an anchored galleon flying the skull and crossbones, a broken wreck on the reef, a treasure chest,
// and a rowboat with barrels. All dimensions in metres; ships point along +z (bow) with the waterline at y = 0.
import { MeshBuilder, add, mul } from './geometry.js';
import { MAT } from './catalog.js';

// Lofted hull. s runs stern (0) to bow (1); v runs keel (0) to gunwale (1).
class Hull {
  dims;

  constructor(dims) {
    this.dims = dims;
  }

  // Deck height at s.
  deck(s) {
    const { bowRise, sheer, sternRise } = this.dims;
    return sheer + sternRise * (1 - s) ** 4 + bowRise * s ** 3;
  }

  halfBeam(s) {
    return this.dims.beam * Math.min(0.86 + 0.5 * s, 1) * (1 - (Math.max(s - 0.42, 0) / 0.58) ** 2.2) + 0.05;
  }

  keelY(s) {
    return -this.dims.keel * Math.sin(Math.PI * Math.min(1, 0.05 + s * 1.05)) ** 0.25;
  }

  // Point on the planking of one side (1 starboard, -1 port).
  point(s, v, side) {
    const w = this.halfBeam(s),
      x = w * Math.sin((v * Math.PI) / 2) ** 0.55 * (1 - 0.1 * v ** 4) * side,
      y = this.keelY(s) + (this.deck(s) - this.keelY(s)) * v ** 1.25,
      z = (s - 0.45) * this.dims.length;
    return [x, y, z];
  }
}

// Both sides, the transom and (optionally) the deck; sMax < 1 cuts the hull short of the bow.
const addHull = (mb, hull, material, { hasDeck = true, sMax = 1 } = {}) => {
    for (const side of [1, -1]) {
      mb.surface(
        (u, v) => hull.point(u * sMax, v, side),
        24,
        8,
        (u, v) => [material, 0.45 + 0.55 * v, 0, v],
      );
    }
    // Transom
    mb.surface(
      (u, v) => {
        const port = hull.point(0, v, -1),
          starboard = hull.point(0, v, 1);
        return add(mul(port, 1 - u), mul(starboard, u));
      },
      4,
      6,
      () => [material, 0.7, 0, 1],
    );
    if (hasDeck) {
      mb.surface(
        (u, v) => {
          const s = u * sMax,
            p = hull.point(s, 0.97, 1);
          return [p[0] * (2 * v - 1), hull.deck(s) - 0.35, p[2]];
        },
        20,
        3,
        () => [MAT.deck, 0.75, 0, 0],
      );
    }
  },
  // Lateen sail on the mizzen mast of height h at z.
  addLateen = (mb, h, z) => {
    mb.surface(
      (u, v) => {
        const footAft = [0, 5.5, z - 5],
          footFore = [0, 5, z + 4],
          footPoint = add(mul(footAft, 1 - u), mul(footFore, u)),
          peak = [0, h * 0.95, z + 3.5],
          point = add(mul(footPoint, 1 - v), mul(peak, v));
        return [point[0] + Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 1.1, point[1], point[2]];
      },
      6,
      6,
      (u, v) => [MAT.sail, 0.95, Math.sin(Math.PI * u) * Math.sin(Math.PI * v), v],
    );
  },
  // Square sail hanging from (x, y, z), bellied forward.
  addSail = (mb, { belly, height, width, x, y, z }) => {
    mb.surface(
      (u, v) => {
        const b = Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + 0.85 * v));
        return [x + (u - 0.5) * width * (1 - 0.12 * v), y + v * height, z + b * belly];
      },
      8,
      6,
      (u, v) => [MAT.sail, 0.95, Math.sin(Math.PI * u) * Math.sin(Math.PI * v), v],
    );
  },
  // Two yards with their square sails on a mast of height h at z; sw is the lower yard's span, k the sails' belly.
  addYards = (mb, { h, k, sw, z }) => {
    for (const [y, sh, w] of [
      [h * 0.32, h * 0.3, sw],
      [h * 0.66, h * 0.24, sw * 0.78],
    ]) {
      mb.tube(
        (t) => [(t - 0.5) * w * 1.08, y + sh + 0.2, z],
        () => 0.13,
        1,
        4,
        () => [MAT.wood, 0.8, 0, 0],
      );
      addSail(mb, { belly: 1.6 * k, height: sh, width: w, x: 0, y, z: z + 0.25 });
    }
  },
  barrel = () => {
    const height = 0.9,
      mb = new MeshBuilder();
    mb.tube(
      (t) => [0, t * height, 0],
      (t) => 0.3 + 0.05 * Math.sin(Math.PI * t),
      8,
      12,
      (t) => [MAT.wood, 0.75, 0, t * 6],
    );
    for (const y of [0.12, 0.3, 0.6, 0.78]) {
      mb.tube(
        (t) => [0, y + t * 0.05, 0],
        () => 0.3 + 0.05 * Math.sin(Math.PI * (y / height)) + 0.008,
        1,
        12,
        () => [MAT.iron, 0.7, 0, 0],
      );
    }
    mb.surface(
      (u, v) => [Math.cos(u * Math.PI * 2) * 0.3 * v, height, Math.sin(u * Math.PI * 2) * 0.3 * v],
      12,
      1,
      () => [MAT.wood, 0.8, 0, 0],
    );
    return mb.build();
  },
  chest = () => {
    // Lid opening angle, and the box's half width, half depth and height
    const angle = 1.95,
      d = 0.36,
      h = 0.42,
      mb = new MeshBuilder(),
      w = 0.55;
    mb.box([-w, 0, -d], [w, h, d], [MAT.wood, 0.8, 0, 0]);
    // Iron bands
    for (const x of [-w * 0.7, w * 0.7])
      mb.box([x - 0.04, -0.005, -d - 0.01], [x + 0.04, h + 0.005, d + 0.01], [MAT.iron, 0.7, 0, 0]);
    // Lid: half cylinder hinged along the back edge, swung open
    mb.surface(
      (u, v) => {
        // Z is measured from the hinge
        const a = Math.PI * v,
          y = Math.sin(a) * d * 0.55,
          z = d - Math.cos(a) * d;
        return [
          (u - 0.5) * 2 * w,
          h + y * Math.cos(angle) + z * Math.sin(angle),
          -d - y * Math.sin(angle) + z * Math.cos(angle),
        ];
      },
      6,
      6,
      () => [MAT.wood, 0.8, 0, 0],
    );
    // A heap of gold
    mb.ico(
      [0, h - 0.02, 0],
      1,
      2,
      () => [MAT.gold, 1, 0, 0],
      (p, v) => ({ n: v, p: [v[0] * w * 0.85, h - 0.02 + Math.max(v[1], 0) * 0.16, v[2] * d * 0.85] }),
    );
    for (let k = 0; k < 7; k += 1) {
      const a = k * 2.3;
      mb.ico(
        [Math.cos(a) * (0.75 + k * 0.05), 0.02, Math.sin(a) * 0.5],
        0.05,
        0,
        () => [MAT.gold, 1, 0, 0],
        (p, v) => ({ n: v, p: [p[0], 0.01 + v[1] * 0.012, p[2]] }),
      );
    }
    return mb.build();
  },
  galleon = () => {
    // The flag flies from the main mast top
    const flagY = 26.3,
      flagZ = 0.5,
      hull = new Hull({ beam: 4.4, bowRise: 1.2, keel: 2.6, length: 30, sheer: 2.6, sternRise: 3 }),
      mb = new MeshBuilder();
    addHull(mb, hull, MAT.wood);
    // Stern castle and forecastle
    mb.box([-3.6, 4.2, -13.6], [3.6, 6.4, -8.5], [MAT.wood, 0.85, 0, 0]);
    mb.box([-3, 3, 9], [3, 4.2, 12.5], [MAT.wood, 0.85, 0, 0]);
    // Masts as [z, height, lower yard span, sail belly], with yards and sails; the mizzen carries a lateen
    for (const [z, h, sw, k] of [
      [9.5, 21, 9, 0.75],
      [0.5, 26, 12, 1],
      [-8, 18, 0, 0.6],
    ]) {
      mb.tube(
        (t) => [0, 2 + t * h, z],
        (t) => 0.32 * (1 - 0.5 * t),
        4,
        6,
        () => [MAT.wood, 0.8, 0, 0],
      );
      if (sw > 0) addYards(mb, { h, k, sw, z });
      else addLateen(mb, h, z);
    }
    // Bowsprit
    mb.tube(
      (t) => [0, 4 + t * 3.5, 14 + t * 9],
      (t) => 0.25 * (1 - 0.6 * t),
      2,
      5,
      () => [MAT.wood, 0.8, 0, 0],
    );
    // The flag, streaming forward (u along, v across)
    mb.surface(
      (u, v) => [Math.sin(u * 5) * 0.12 * u, flagY + 0.3 + v * 1.9, flagZ + 0.3 + u * 3],
      10,
      4,
      (u, v) => [MAT.flag, v, u, u],
    );
    return mb.build();
  },
  rowboat = () => {
    const hull = new Hull({ beam: 0.78, bowRise: 0.18, keel: 0.38, length: 4.2, sheer: 0.3, sternRise: 0.08 }),
      mb = new MeshBuilder();
    addHull(mb, hull, MAT.wood, { hasDeck: false });
    for (const z of [-0.6, 0.5]) mb.box([-0.66, 0.08, z - 0.13], [0.66, 0.13, z + 0.13], [MAT.wood, 0.8, 0, 0]);
    // Oars resting across the boat
    for (const s of [-1, 1]) {
      mb.tube(
        (t) => [s * (0.2 + t * 0.2), 0.18 + t * 0.05, -1.4 + t * 2.6],
        () => 0.025,
        2,
        4,
        () => [MAT.wood, 0.8, 0, 0],
      );
      mb.box([s * 0.4 - 0.08, 0.22, 1.1], [s * 0.4 + 0.08, 0.24, 1.55], [MAT.wood, 0.8, 0, 0]);
    }
    return mb.build();
  },
  wreck = () => {
    const hull = new Hull({ beam: 3.6, bowRise: 0.5, keel: 2.2, length: 22, sheer: 2, sternRise: 2 }),
      mb = new MeshBuilder();
    addHull(mb, hull, MAT.wreck, { hasDeck: false, sMax: 0.68 });
    // Fallen mast and a few loose ribs
    mb.tube(
      (t) => [1.8 - t * 3, -0.6 + t * 0.4, -2 + t * 16],
      () => 0.28,
      4,
      6,
      () => [MAT.wreck, 0.7, 0, 0],
    );
    for (let k = 0; k < 5; k += 1) {
      const z = 2 + k * 1.6;
      mb.tube(
        (t) => [Math.cos(Math.PI * t) * 2.6, -1.6 + Math.sin(Math.PI * t) * 2.6 * (0.8 - k * 0.12), z],
        () => 0.12,
        6,
        4,
        () => [MAT.wreck, 0.7, 0, 0],
      );
    }
    // A cannon in the sand
    mb.tube(
      (t) => [-3.2, -1.4 + t * 0.25, 3 + t * 2.2],
      (t) => 0.22 - 0.06 * t,
      3,
      8,
      () => [MAT.iron, 0.6, 0, 0],
    );
    return mb.build();
  };

export { barrel, chest, galleon, rowboat, wreck };
