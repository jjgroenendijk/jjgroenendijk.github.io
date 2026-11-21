// Vegetation: coconut palms, shrubs, ferns, banana plants and flowering shrubs (trees are in trees.js). Leaves fan out
// around the stem at the golden angle and hang from drooping spines, either as strips of quads between cross-section
// rows or as midribs lined with leaflets.
import { MeshBuilder, add, cross, mul, norm, rng, sub } from './geometry.js';
import { MAT } from './catalog.js';

// Shared leaf helpers come first, then each plant's parts and the plants themselves.
const BANANA_HEIGHT = 0.42,
  // Vertex t of the banana blade's four strips: the two beside the midrib are marked
  BANANA_MIDRIB = [0, 0.5, 0.5, 0],
  // Width of each banana blade row: the edge is notched every third row past the first
  BANANA_TEAR = [1, 1, 1, 1, 0.92, 1, 1, 0.92, 1, 1],
  BANANA_TOP = [0, BANANA_HEIGHT, 0],
  GOLDEN_ANGLE = 2.39996,
  // Per LOD: frond count, trunk tube resolution, rows per frond (leaflets at full detail) and the random seed.
  PALM_LODS = [
    { fronds: 13, radial: 7, rows: 18, seed: 11, segs: 12 },
    { fronds: 9, radial: 5, rows: 6, seed: 12, segs: 5 },
    { fronds: 7, radial: 3, rows: 2, seed: 12, segs: 3 },
  ],
  PALM_MIDRIB_HALF_WIDTH = 0.004,
  PETIOLE = 0.12,
  // The horizontal outward and sideways axes of a leaf at angle around the stem.
  axes = (angle) => [
    [Math.cos(angle), 0, Math.sin(angle)],
    [-Math.sin(angle), 0, Math.cos(angle)],
  ],
  // A leaf blade: quads between the cross-section rows row(s, step), s = step / count for step = 0..count; extra(s,
  // cell) is the vertex extra of the quads between row points cell and cell + 1.
  blade = (mb, count, row, extra) => {
    let previous = row(0, 0);
    for (let step = 1; step <= count; step += 1) {
      const along = step / count,
        current = row(along, step);
      for (let cell = 0; cell < current.length - 1; cell += 1) {
        const tint = extra(along, cell);
        mb.flatTri(previous[cell], current[cell], current[cell + 1], tint);
        mb.flatTri(previous[cell], current[cell + 1], previous[cell + 1], tint);
      }
      previous = current;
    }
  },
  // Hibiscus-like bloom: five petals around heart, tilted outwards by tilt and turned by twist, and a stamen.
  bloom = (mb, heart, tilt, twist) => {
    const axis = norm([Math.cos(tilt) * 0.5, 1, Math.sin(tilt) * 0.5]),
      base = [MAT.petal, 0.9, 0.3, 0],
      rim = [MAT.petal, 1, 0.5, 1],
      t1 = norm(cross(axis, [0, 0, 1])),
      t2 = cross(axis, t1);
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = (petal / 5) * Math.PI * 2 + twist,
        ray = add(mul(t1, Math.cos(angle)), mul(t2, Math.sin(angle))),
        ray2 = add(mul(t1, Math.cos(angle + 0.62)), mul(t2, Math.sin(angle + 0.62))),
        tip = add(add(heart, mul(ray, 0.11)), mul(axis, 0.045)),
        tip2 = add(add(heart, mul(ray2, 0.11)), mul(axis, 0.045)),
        vein = norm(add(ray, ray2)),
        waist = add(add(heart, mul(vein, 0.115)), mul(axis, 0.05));
      mb.flatTri(heart, tip, waist, base, rim, rim, axis);
      mb.flatTri(heart, waist, tip2, base, rim, rim, axis);
    }
    mb.tube(
      (t) => add(heart, mul(axis, t * 0.06)),
      () => 0.004,
      1,
      3,
      () => [MAT.petal, 1, 0.3, 0.05],
    );
  },
  // Banana leaf: a petiole, then a wide blade of five points across.
  bananaLeaf = (mb, angle, elevation, length) => {
    const [outward, side] = axes(angle),
      stalk = add(BANANA_TOP, add(mul(outward, PETIOLE * 0.5), [0, PETIOLE * 0.8, 0])),
      spine = (s) =>
        add(
          stalk,
          add(mul(outward, length * s * 0.85), [0, length * (Math.sin(elevation) * s * 0.7 - 0.85 * s * s), 0]),
        );
    mb.tube(
      (t) => add(BANANA_TOP, mul(sub(stalk, BANANA_TOP), t)),
      () => 0.008,
      2,
      4,
      () => [MAT.stem, 0.7, 0.3, 0.5],
    );
    blade(
      mb,
      9,
      (s, step) => {
        const c = spine(s),
          tear = BANANA_TEAR[step],
          wd = 0.13 * Math.sin(Math.PI * Math.min(s * 1.02 + 0.02, 1)) ** 0.65,
          droop = wd * 0.45;
        return [
          add(add(c, mul(side, -wd * tear)), [0, -droop, 0]),
          add(add(c, mul(side, -wd * 0.5)), [0, -droop * 0.15, 0]),
          add(c, [0, 0.01, 0]),
          add(add(c, mul(side, wd * 0.5)), [0, -droop * 0.15, 0]),
          add(add(c, mul(side, wd * tear)), [0, -droop, 0]),
        ];
      },
      (s, cell) => [MAT.bananaLeaf, 0.65 + 0.35 * s, 0.4 + s * 0.6, BANANA_MIDRIB[cell]],
    );
  },
  // Understory shrub leaf: lift raises it up the rosette, flattens its droop and shades it lighter.
  bushLeaf = (mb, angle, lift, reach) => {
    const [outward, side] = axes(angle),
      base = [outward[0] * 0.05, 0.1 + lift * 0.45, outward[2] * 0.05],
      sag = 1.2 - lift * 0.6,
      spine = (s) => add(base, add(mul(outward, reach * s), [0, reach * (0.45 * s - 0.7 * s * s) * sag, 0]));
    blade(
      mb,
      4,
      (s) => {
        const c = spine(s),
          wd = 0.11 * Math.sin(Math.PI * Math.min(s * 0.95 + 0.05, 1)) ** 0.7;
        return [
          add(add(c, mul(side, -wd)), [0, -wd * 0.35, 0]),
          add(c, [0, 0.008, 0]),
          add(add(c, mul(side, wd)), [0, -wd * 0.35, 0]),
        ];
      },
      (s) => [MAT.bush, 0.45 + 0.5 * lift, 0.3 + s * 0.7, s],
    );
  },
  // Coconuts hanging under the palm crown.
  coconuts = (mb, rand, top) => {
    for (let k = 0; k < 5; k += 1) {
      const a = k * 2.4;
      mb.ico(add(top, [Math.cos(a) * 0.03, -0.03 - rand() * 0.01, Math.sin(a) * 0.03]), 0.017, 1, () => [
        MAT.coconut,
        0.5,
        0.05,
        1,
      ]);
    }
  },
  // Two pinnae on the fern rachis segment a-b, one to each side.
  fernPinnae = (mb, [a, b], s0, side) => {
    const inner = [MAT.fern, 0.6 + 0.4 * s0, s0, s0],
      reach = 0.03 + 0.11 * Math.sin(Math.PI * s0) * (1 - s0 * 0.4),
      tangent = norm(sub(b, a));
    for (const hand of [-1, 1]) {
      const splay = add(mul(side, hand), mul(tangent, 0.35)),
        vein = norm(add(splay, [0, -0.1, 0])),
        veinMid = add(add(a, mul(vein, reach * 0.5)), mul(tangent, 0.03)),
        veinTip = add(a, mul(vein, reach)),
        wingBase = add(a, mul(tangent, 0.05));
      mb.flatTri(a, wingBase, veinMid, inner, [MAT.fern, 0.7, s0, s0], [MAT.fern, 0.9, s0, s0]);
      mb.flatTri(a, veinMid, veinTip, inner, [MAT.fern, 0.9, s0, s0], [MAT.fern, 1, s0, s0]);
    }
  },
  // Fern frond: a rachis arching out at elevation, lined with pinnae.
  fernFrond = (mb, angle, elevation, length) => {
    const [outward, side] = axes(angle),
      spine = (s) =>
        add(mul(outward, length * s * 0.8), [0, length * (Math.sin(elevation) * s * 0.9 - 0.75 * s * s), 0]);
    for (let step = 1; step < 12; step += 1)
      fernPinnae(mb, [spine(step / 12), spine((step + 1) / 12)], step / 12, side);
  },
  // Flowering shrub leaf.
  flowerLeaf = (mb, angle, reach, lift) => {
    const [outward, side] = axes(angle),
      base = [0, 0.1 + lift * 0.35, 0],
      spine = (s) => add(base, add(mul(outward, reach * s), [0, reach * (0.5 * s - 0.6 * s * s), 0]));
    blade(
      mb,
      3,
      (s) => {
        const c = spine(s),
          wd = 0.07 * Math.sin(Math.PI * Math.min(s * 0.9 + 0.1, 1));
        return [add(c, mul(side, -wd)), add(c, [0, 0.006, 0]), add(c, mul(side, wd))];
      },
      (s) => [MAT.bush, 0.5 + 0.5 * lift, 0.3 + s * 0.6, s],
    );
  },
  // Coarse palm frond: one solid card of three points across.
  frondCard = (mb, midrib, side, rows) => {
    blade(
      mb,
      rows,
      (s) => {
        const c = midrib(s),
          wd = 0.11 * Math.sin(Math.PI * Math.min(s * 1.05, 1)) ** 0.7 + 0.005;
        return [add(add(c, mul(side, -wd)), [0, -wd * 0.5, 0]), c, add(add(c, mul(side, wd)), [0, -wd * 0.5, 0])];
      },
      (s) => [MAT.palmFrond, 0.8, s, 1],
    );
  },
  // Two leaflets hanging off the palm midrib segment a-b, one to each side.
  frondLeaflets = (mb, [a, b], s0, side) => {
    const base = [MAT.palmFrond, 0.75, s0, 1],
      reach = 0.025 + 0.14 * Math.sin(Math.PI * Math.min(s0 * 1.1, 1)) ** 0.6,
      tangent = norm(sub(b, a));
    for (const hand of [-1, 1]) {
      const splay = add(mul(side, hand * 0.85), mul(tangent, 0.5)),
        vein = norm(add(splay, [0, -0.38 - s0 * 0.3, 0]));
      mb.flatTri(a, add(a, mul(tangent, 0.022)), add(a, mul(vein, reach)), base, base, [
        MAT.palmFrond,
        0.95,
        Math.min(s0 + 0.15, 1),
        1,
      ]);
    }
  },
  // Full-detail palm frond: a thin midrib strip lined with leaflets.
  frondPinnate = (mb, midrib, side, rows) => {
    const inner = mul(side, -PALM_MIDRIB_HALF_WIDTH),
      outer = mul(side, PALM_MIDRIB_HALF_WIDTH);
    for (let step = 0; step < rows; step += 1) {
      const a = midrib(step / rows),
        b = midrib((step + 1) / rows),
        s0 = step / rows,
        s1 = (step + 1) / rows,
        tint0 = [MAT.palmFrond, 0.8, s0, 1],
        tint1 = [MAT.palmFrond, 0.8, s1, 1];
      mb.flatTri(add(a, outer), add(b, outer), add(a, inner), tint0, tint1, tint0);
      mb.flatTri(add(b, outer), add(b, inner), add(a, inner), tint1, tint1, tint0);
      if (step > 0) frondLeaflets(mb, [a, b], s0, side);
    }
  },
  palmTrunk = (t) => [0.05 * Math.sin(t * 2.4) * t, t, 0.02 * Math.sin(t * 3.1)],
  // Banana / big leaf plant.
  banana = () => {
    const mb = new MeshBuilder(),
      rand = rng(51);
    mb.tube(
      (t) => [0, t * BANANA_HEIGHT, 0],
      (t) => 0.035 * (1 - 0.3 * t),
      4,
      6,
      (t) => [MAT.stem, 0.5 + 0.5 * t, 0.1 * t, t],
    );
    for (let k = 0; k < 7; k += 1)
      bananaLeaf(mb, k * GOLDEN_ANGLE + rand() * 0.3, 1.1 - k * 0.08 + (rand() - 0.5) * 0.2, 0.5 + rand() * 0.15);
    return mb.build();
  },
  // Understory shrub: a dense rosette of broad, drooping leaves on short stems.
  bush = () => {
    const mb = new MeshBuilder(),
      rand = rng(31);
    for (let k = 0; k < 30; k += 1)
      bushLeaf(mb, k * GOLDEN_ANGLE + rand() * 0.5, 0.25 + rand() * 0.75, 0.35 + rand() * 0.25);
    return mb.build();
  },
  fern = () => {
    const mb = new MeshBuilder(),
      rand = rng(41);
    for (let k = 0; k < 9; k += 1)
      fernFrond(mb, k * GOLDEN_ANGLE + rand() * 0.4, 1 + rand() * 0.3, 0.55 + rand() * 0.25);
    return mb.build();
  },
  // Flowering shrub: a low leafy rosette crowned with hibiscus-like blooms.
  flowerBush = () => {
    const mb = new MeshBuilder(),
      rand = rng(81);
    for (let k = 0; k < 18; k += 1) flowerLeaf(mb, k * GOLDEN_ANGLE + rand() * 0.4, 0.3 + rand() * 0.2, rand());
    for (let f = 0; f < 12; f += 1) {
      const angle = f * GOLDEN_ANGLE + rand(),
        distance = 0.12 + rand() * 0.22,
        heart = [Math.cos(angle) * distance, 0.42 + rand() * 0.25 - distance * 0.4, Math.sin(angle) * distance];
      bloom(mb, heart, angle, f);
    }
    return mb.build();
  },
  // Coconut palm: a leaning trunk, a crown of coconuts and arching fronds.
  palm = (lod) => {
    const { fronds, radial, rows, seed, segs } = PALM_LODS[lod],
      mb = new MeshBuilder(),
      rand = rng(seed),
      top = palmTrunk(1);
    mb.tube(
      palmTrunk,
      (t) => 0.019 * (1 + 0.7 * Math.exp(-t * 14)) * (1 - 0.25 * t),
      segs,
      radial,
      (t) => [MAT.palmBark, 0.55 + 0.45 * t, 0, t],
    );
    if (lod < 2) mb.ico(add(top, [0, 0.005, 0]), 0.032, 1, () => [MAT.coconut, 0.6, 0.1, 1]);
    if (lod === 0) coconuts(mb, rand, top);
    for (let k = 0; k < fronds; k += 1) {
      const angle = k * GOLDEN_ANGLE + rand() * 0.3,
        [outward, side] = axes(angle),
        elevation = 0.75 - k / fronds + (rand() - 0.5) * 0.2,
        lean = Math.cos(elevation * 0.6),
        length = 0.38 + rand() * 0.1,
        lift = Math.sin(elevation),
        midrib = (s) => add(top, add(mul(outward, length * s * lean), [0, length * (lift * s - 0.55 * s * s), 0]));
      if (lod === 0) frondPinnate(mb, midrib, side, rows);
      else frondCard(mb, midrib, side, rows);
    }
    return mb.build();
  };

export { banana, bush, fern, flowerBush, palm };
