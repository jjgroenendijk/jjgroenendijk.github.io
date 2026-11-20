// Hints of pirates: an anchored galleon flying the skull and crossbones, a
// broken wreck on the reef, a treasure chest, and a rowboat with barrels.
// All dimensions in metres; ships point along +z (bow) with the waterline at y = 0.
import { MAT } from './catalog.js';
import { MeshBuilder, add, mul } from './geometry.js';

const wood = (ao = 0.8, t = 0) => [MAT.wood, ao, 0, t];

// Lofted hull. s runs stern (0) to bow (1); v runs keel (0) to gunwale (1).
function hullShape({ length, beam, keel, sheer, sternRise, bowRise }) {
  const halfBeam = (s) => beam * Math.min(0.86 + 0.5 * s, 1) * (1 - Math.pow(Math.max(s - 0.42, 0) / 0.58, 2.2)) + 0.05;
  const deck = (s) => sheer + sternRise * Math.pow(1 - s, 4) + bowRise * Math.pow(s, 3);
  const keelY = (s) => -keel * Math.pow(Math.sin(Math.PI * Math.min(1, 0.05 + s * 1.05)), 0.25);
  const point = (s, v, side) => {
    const z = (s - 0.45) * length;
    const w = halfBeam(s);
    const x = w * Math.pow(Math.sin((v * Math.PI) / 2), 0.55) * (1 - 0.1 * Math.pow(v, 4)) * side;
    const y = keelY(s) + (deck(s) - keelY(s)) * Math.pow(v, 1.25);
    return [x, y, z];
  };
  return { halfBeam, deck, keelY, point };
}

function addHull(mb, hull, material, sMax = 1, deckOn = true) {
  for (const side of [1, -1]) {
    mb.surface((u, v) => hull.point(u * sMax, v, side), 24, 8, (u, v) => [material, 0.45 + 0.55 * v, 0, v]);
  }
  // transom
  mb.surface((u, v) => {
    const l = hull.point(0, v, -1), r = hull.point(0, v, 1);
    return add(mul(l, 1 - u), mul(r, u));
  }, 4, 6, () => [material, 0.7, 0, 1]);
  if (deckOn) {
    mb.surface((u, v) => {
      const s = u * sMax;
      const p = hull.point(s, 0.97, 1);
      return [p[0] * (2 * v - 1), hull.deck(s) - 0.35, p[2]];
    }, 20, 3, () => [MAT.deck, 0.75, 0, 0]);
  }
}

function sail(mb, cx, y0, z, width, height, belly) {
  mb.surface((u, v) => {
    const b = Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + 0.85 * v));
    return [cx + (u - 0.5) * width * (1 - 0.12 * v), y0 + v * height, z + b * belly];
  }, 8, 6, (u, v) => [MAT.sail, 0.95, Math.sin(Math.PI * u) * Math.sin(Math.PI * v), v]);
}

export function galleon() {
  const mb = new MeshBuilder();
  const hull = hullShape({ length: 30, beam: 4.4, keel: 2.6, sheer: 2.6, sternRise: 3.0, bowRise: 1.2 });
  addHull(mb, hull, MAT.wood);
  // stern castle and forecastle
  mb.box([-3.6, 4.2, -13.6], [3.6, 6.4, -8.5], wood(0.85));
  mb.box([-3.0, 3.0, 9.0], [3.0, 4.2, 12.5], wood(0.85));
  // masts, yards and sails
  const masts = [[9.5, 21, 9, 0.75], [0.5, 26, 12, 1], [-8.0, 18, 0, 0.6]];
  for (const [z, h, sw, k] of masts) {
    mb.tube((t) => [0, 2 + t * h, z], (t) => 0.32 * (1 - 0.5 * t), 4, 6, () => [MAT.wood, 0.8, 0, 0]);
    if (sw > 0) {
      for (const [y, sh, w] of [[h * 0.32, h * 0.3, sw], [h * 0.66, h * 0.24, sw * 0.78]]) {
        mb.tube((t) => [(t - 0.5) * w * 1.08, y + sh + 0.2, z], () => 0.13, 1, 4, () => [MAT.wood, 0.8, 0, 0]);
        sail(mb, 0, y, z + 0.25, w, sh, 1.6 * k);
      }
    } else {
      // lateen sail on the mizzen
      mb.surface((u, v) => {
        const top = [0, h * 0.95, z + 3.5], foot0 = [0, 5.5, z - 5], foot1 = [0, 5, z + 4];
        const a = add(mul(foot0, 1 - u), mul(foot1, u));
        const p = add(mul(a, 1 - v), mul(top, v));
        return [p[0] + Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 1.1, p[1], p[2]];
      }, 6, 6, (u, v) => [MAT.sail, 0.95, Math.sin(Math.PI * u) * Math.sin(Math.PI * v), v]);
    }
  }
  // bowsprit
  mb.tube((t) => [0, 4 + t * 3.5, 14 + t * 9], (t) => 0.25 * (1 - 0.6 * t), 2, 5, () => [MAT.wood, 0.8, 0, 0]);
  // the flag, streaming forward from the main mast top (u along, v across)
  const fy = 26.3, fz = 0.5;
  mb.surface((u, v) => [Math.sin(u * 5) * 0.12 * u, fy + 0.3 + v * 1.9, fz + 0.3 + u * 3.0], 10, 4, (u, v) => [MAT.flag, v, u, u]);
  return mb.build();
}

export function wreck() {
  const mb = new MeshBuilder();
  const hull = hullShape({ length: 22, beam: 3.6, keel: 2.2, sheer: 2.0, sternRise: 2.0, bowRise: 0.5 });
  addHull(mb, hull, MAT.wreck, 0.68, false);
  // fallen mast and a few loose ribs
  mb.tube((t) => [1.8 - t * 3, -0.6 + t * 0.4, -2 + t * 16], () => 0.28, 4, 6, () => [MAT.wreck, 0.7, 0, 0]);
  for (let k = 0; k < 5; k++) {
    const z = 2 + k * 1.6;
    mb.tube((t) => [Math.cos(Math.PI * t) * 2.6, -1.6 + Math.sin(Math.PI * t) * 2.6 * (0.8 - k * 0.12), z], () => 0.12, 6, 4, () => [MAT.wreck, 0.7, 0, 0]);
  }
  // a cannon in the sand
  mb.tube((t) => [-3.2, -1.4 + t * 0.25, 3 + t * 2.2], (t) => 0.22 - 0.06 * t, 3, 8, () => [MAT.iron, 0.6, 0, 0]);
  return mb.build();
}

export function chest() {
  const mb = new MeshBuilder();
  const w = 0.55, d = 0.36, h = 0.42;
  mb.box([-w, 0, -d], [w, h, d], wood(0.8));
  // iron bands
  for (const x of [-w * 0.7, w * 0.7]) mb.box([x - 0.04, -0.005, -d - 0.01], [x + 0.04, h + 0.005, d + 0.01], [MAT.iron, 0.7, 0, 0]);
  // lid: half cylinder hinged along the back edge, swung open
  const ang = 1.95;
  mb.surface((u, v) => {
    const a = Math.PI * v;
    const y = Math.sin(a) * d * 0.55, z = d - Math.cos(a) * d; // z measured from the hinge
    return [(u - 0.5) * 2 * w, h + y * Math.cos(ang) + z * Math.sin(ang), -d - y * Math.sin(ang) + z * Math.cos(ang)];
  }, 6, 6, () => [MAT.wood, 0.8, 0, 0]);
  // a heap of gold
  mb.ico([0, h - 0.02, 0], 1, 2, () => [MAT.gold, 1, 0, 0], (p, v) => ({ p: [v[0] * w * 0.85, h - 0.02 + Math.max(v[1], 0) * 0.16, v[2] * d * 0.85], n: v }));
  for (let k = 0; k < 7; k++) {
    const a = k * 2.3;
    mb.ico([Math.cos(a) * (0.75 + k * 0.05), 0.02, Math.sin(a) * 0.5], 0.05, 0, () => [MAT.gold, 1, 0, 0], (p, v) => ({ p: [p[0], 0.01 + v[1] * 0.012, p[2]], n: v }));
  }
  return mb.build();
}

export function rowboat() {
  const mb = new MeshBuilder();
  const hull = hullShape({ length: 4.2, beam: 0.78, keel: 0.38, sheer: 0.3, sternRise: 0.08, bowRise: 0.18 });
  addHull(mb, hull, MAT.wood, 1, false);
  for (const z of [-0.6, 0.5]) mb.box([-0.66, 0.08, z - 0.13], [0.66, 0.13, z + 0.13], wood(0.8));
  // oars resting across the boat
  for (const s of [-1, 1]) {
    mb.tube((t) => [s * (0.2 + t * 0.2), 0.18 + t * 0.05, -1.4 + t * 2.6], () => 0.025, 2, 4, () => [MAT.wood, 0.8, 0, 0]);
    mb.box([s * 0.4 - 0.08, 0.22, 1.1], [s * 0.4 + 0.08, 0.24, 1.55], wood(0.8));
  }
  return mb.build();
}

export function barrel() {
  const mb = new MeshBuilder();
  const H = 0.9;
  mb.tube((t) => [0, t * H, 0], (t) => 0.3 + 0.05 * Math.sin(Math.PI * t), 8, 12, (t) => [MAT.wood, 0.75, 0, t * 6]);
  for (const y of [0.12, 0.3, 0.6, 0.78]) {
    mb.tube((t) => [0, y + t * 0.05, 0], () => 0.3 + 0.05 * Math.sin(Math.PI * (y / H)) + 0.008, 1, 12, () => [MAT.iron, 0.7, 0, 0]);
  }
  mb.surface((u, v) => [Math.cos(u * Math.PI * 2) * 0.3 * v, H, Math.sin(u * Math.PI * 2) * 0.3 * v], 12, 1, () => [MAT.wood, 0.8, 0, 0]);
  return mb.build();
}
