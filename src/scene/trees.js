// Rainforest trees grown by space colonisation: attraction points fill the
// crown envelope and the branches grow towards them from the trunk, so limbs
// spread, fork and thin out the way real crowns do. Branch radii follow
// da Vinci's rule (a parent's cross-section is the sum of its children's).
// Leaves are textured cluster cards (see shaders/leaves.js) hung on the twigs,
// with normals bent outwards from the crown centre so the crown shades as one
// soft volume, and an occlusion term that darkens the crown's interior.
//
// Vertex extra = [material, occlusion, flex, t]; flex is the branch's bend
// weight for the wind (0 on the trunk), and foliage cards pack their texture
// coordinates into t.
//
// Skeleton nodes are { children, depth (path length from the root), p, parent, r }.
import { LEAF, MAT } from './catalog.js';
import { MeshBuilder, add, cross, len as magnitude, mul, norm, rng, sub, vnoise } from './geometry.js';

// Species. Lengths are in mesh units: a tree is about one unit tall and the
// scatter scales it to metres. The id seeds the skeleton.
const SPECIES = {
    // Broad, rounded canopy tree: the bulk of the forest
    canopy: {
      buttress: 1.6,
      card: 0.085,
      crown: [0, 0.64, 0],
      epiphytes: 5,
      flatBottom: 0.55,
      id: 0,
      influence: 0.16,
      kill: 0.04,
      leaf: LEAF.broad,
      lianas: 4,
      lumps: 0.35,
      points: 560,
      radii: [0.44, 0.3, 0.44],
      step: 0.022,
      tropism: 0.12,
      trunk: 0.3,
    },
    // Emergent giant: a tall bare bole with buttress roots and a flat umbrella crown
    emergent: {
      buttress: 3.2,
      card: 0.07,
      crown: [0, 0.86, 0],
      epiphytes: 6,
      flatBottom: 0.75,
      id: 1,
      influence: 0.17,
      kill: 0.04,
      leaf: LEAF.small,
      lianas: 3,
      lumps: 0.35,
      points: 480,
      radii: [0.46, 0.14, 0.46],
      step: 0.02,
      tropism: 0.1,
      trunk: 0.64,
    },
    // Slender understory tree with feathery compound leaves
    understory: {
      buttress: 0.6,
      card: 0.14,
      crown: [0, 0.72, 0],
      epiphytes: 0,
      flatBottom: 0.3,
      id: 2,
      influence: 0.15,
      kill: 0.045,
      leaf: LEAF.pinnate,
      lianas: 0,
      lumps: 0.2,
      points: 260,
      radii: [0.2, 0.27, 0.2],
      step: 0.026,
      tropism: 0.45,
      trunk: 0.42,
    },
  },
  // Exponent of the branch radius rule.
  DA_VINCI = 2.4,
  // Radius of a terminal twig.
  TWIG = 0.0022,
  GOLDEN_ANGLE = 2.39996,
  // ------------------------------------------------------------------ skeleton
  addNode = (nodes, parent, p) => {
    const pn = nodes[parent];
    nodes.push({ children: [], depth: pn.depth + magnitude(sub(p, pn.p)), p, parent, r: 0 });
    pn.children.push(nodes.length - 1);
    return nodes.length - 1;
  },
  // Unit vector from b towards a.
  towards = (a, b) => norm(sub(a, b)),
  // Whether the unit-cube sample d (of length distance) lies in the lumpy crown envelope above its flat underside.
  inEnvelope = (sp, d, distance, lumpSeed) => {
    if (distance > 1 || distance < 1e-3) return false;
    const u = mul(d, 1 / distance),
      edge = 1 + sp.lumps * (vnoise(u[0] * 2 + lumpSeed, u[1] * 2, u[2] * 2) - 0.5) * 2;
    return distance <= edge && d[1] >= -sp.flatBottom;
  },
  // Attraction points in a lumpy ellipsoid, with a flattened underside, denser
  // towards the envelope: leaves live on the outside of a crown.
  attractors = (sp, rand, lumpSeed) => {
    const [cx, cy, cz] = sp.crown,
      [rx, ry, rz] = sp.radii,
      pts = [];
    while (pts.length < sp.points) {
      const d = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1],
        distance = magnitude(d);
      if (inEnvelope(sp, d, distance, lumpSeed) && rand() <= distance * distance)
        pts.push([cx + d[0] * rx, cy + d[1] * ry, cz + d[2] * rz]);
    }
    return pts;
  },
  // The trunk: a slightly wandering column up to the crown, past its nominal
  // height until the crown's attraction points are in reach.
  trunk = (sp, rand, pts, lumpSeed) => {
    const nodes = [{ children: [], depth: 0, p: [0, 0, 0], parent: -1, r: 0 }],
      lean = [(rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.04],
      isReached = (q) => pts.some((a) => magnitude(sub(a, q)) < sp.influence * 0.9);
    while (nodes.at(-1).p[1] < sp.trunk || (!isReached(nodes.at(-1).p) && nodes.at(-1).p[1] < sp.crown[1])) {
      const y = nodes.at(-1).p[1] + sp.step * 1.5;
      addNode(nodes, nodes.length - 1, [
        lean[0] * y + 0.006 * Math.sin(y * 9 + lumpSeed),
        y,
        lean[2] * y + 0.006 * Math.cos(y * 7),
      ]);
    }
    return nodes;
  },
  distanceSquared = (a, b) => {
    const dx = a[0] - b[0],
      dy = a[1] - b[1],
      dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  },
  // The node nearest to point within reach, or -1.
  nearest = (sp, point, nodes) => {
    let best = -1,
      bd = sp.influence * sp.influence;
    for (const [n, node] of nodes.entries()) {
      const d2 = distanceSquared(point, node.p);
      if (d2 < bd) [bd, best] = [d2, n];
    }
    return best;
  },
  // Every live point pulls on its nearest node within reach.
  pulls = (sp, live, nodes) => {
    const pull = new Map();
    for (const point of live) {
      const best = nearest(sp, point, nodes);
      if (best >= 0) pull.set(best, add(pull.get(best) ?? [0, 0, 0], towards(point, nodes[best].p)));
    }
    return pull;
  },
  // A new node towards the summed pull on each pulled node.
  extend = (sp, nodes, pull) => {
    const fresh = [];
    for (const [n, v] of pull) {
      const direction = norm(add(norm(v), [0, sp.tropism, 0])),
        p = add(nodes[n].p, mul(direction, sp.step));
      // Avoid growing a node on top of an existing child
      if (nodes[n].children.every((c) => magnitude(sub(nodes[c].p, p)) >= sp.step * 0.3))
        fresh.push(addNode(nodes, n, p));
    }
    return fresh;
  },
  // Colonisation: grow towards the points until none pulls, killing the points the new nodes reach.
  colonise = (sp, pts, nodes) => {
    let live = pts,
      isGrowing = true;
    for (let iter = 0; isGrowing && iter < 120; iter += 1) {
      const fresh = extend(sp, nodes, pulls(sp, live, nodes));
      live = live.filter((point) => fresh.every((n) => magnitude(sub(point, nodes[n].p)) >= sp.kill));
      isGrowing = fresh.length > 0;
    }
    return nodes;
  },
  // Radii from the twigs down (children always come after their parent); a
  // twig has no children, so its sum is zero and it gets the twig radius.
  assignRadii = (nodes) => {
    for (const node of nodes.toReversed())
      node.r = node.children.reduce((s, c) => s + nodes[c].r ** DA_VINCI, 0) ** (1 / DA_VINCI) || TWIG;
    return nodes;
  },
  grow = (sp, rand) => {
    const lumpSeed = rand() * 100,
      pts = attractors(sp, rand, lumpSeed);
    return assignRadii(colonise(sp, pts, trunk(sp, rand, pts, lumpSeed)));
  },
  // Every LOD of a tree is built from the same skeleton.
  skeletons = new Map(),
  skeleton = (kind, variant) => {
    const key = `${kind}/${variant}`;
    if (!skeletons.has(key)) skeletons.set(key, grow(SPECIES[kind], rng(1000 + variant * 97 + SPECIES[kind].id * 13)));
    return skeletons.get(key);
  },
  // Splits the skeleton into chains: each node continues into its thickest
  // child; the other children start chains of their own (from their parent).
  chains = (nodes) => {
    const out = [],
      walk = (chain) => {
        let n = chain.at(-1);
        while (nodes[n].children.length > 0) {
          const [thickest, ...others] = nodes[n].children.toSorted((a, b) => nodes[b].r - nodes[a].r);
          for (const k of others) walk([n, k]);
          n = thickest;
          chain.push(n);
        }
        out.push(chain);
      };
    walk([0]);
    return out;
  },
  // ------------------------------------------------------------------ mesh
  // Crown-space helpers: the occlusion and the crown normal, which points outwards from the centre.
  crownFrame = (sp) => {
    const [cx, cy, cz] = sp.crown,
      [rx, ry, rz] = sp.radii,
      local = (p) => [(p[0] - cx) / rx, (p[1] - cy) / ry, (p[2] - cz) / rz];
    return {
      // Interior occlusion: dark in the core and underneath, open on the outside
      ao: (p) => {
        const q = local(p),
          rho = magnitude(q);
        return Math.min(
          1,
          0.22 + 0.78 * Math.min(rho, 1) ** 1.6 * (0.7 + 0.3 * Math.max(-1, Math.min(1, q[1] * 0.7 + 0.3))),
        );
      },
      normal: (p) => {
        const q = local(p);
        return norm([q[0] / rx, q[1] / ry + 0.4, q[2] / rz]);
      },
    };
  },
  // Foliage card uv + layer, packed into one float (see foliageLibrary in shaders/leaves.js).
  packUV = (u, v, layer) => layer * 1_048_576 + Math.round(u * 1023) * 1024 + Math.round(v * 1023),
  // Per LOD: smallest branch radius drawn, radial segments by branch radius (the first band the radius exceeds),
  // share and size of the foliage cards. Coarser LODs keep a subset of the very same cards (same place, orientation
  // and centre), enlarged to keep the crown's volume and silhouette, so switching LOD does not change the tree's shape.
  LOD = [
    {
      cards: 1,
      extras: true,
      minR: 0,
      perTip: 2,
      radial: [
        [0.01, 7],
        [0.004, 4],
        [0, 3],
      ],
      size: 1,
    },
    {
      cards: 0.7,
      extras: false,
      minR: 0.0045,
      perTip: 1,
      radial: [
        [0.012, 5],
        [0, 3],
      ],
      size: 1.4,
    },
    { cards: 0.4, extras: false, minR: 0.009, perTip: 1, radial: [[0, 3]], size: 1.8 },
  ],
  // Everything the parts of one tree mesh share.
  treeParts = (kind, variant, lod) => {
    const sp = SPECIES[kind],
      nodes = skeleton(kind, variant),
      span = Math.max(Math.max(...nodes.map((n) => n.depth)) - sp.trunk, 1e-3);
    return {
      crown: crownFrame(sp),
      // Wind bend weight: grows along the limbs, zero on the trunk
      flex: (n) => Math.max(0, (nodes[n].depth - sp.trunk) / span),
      level: LOD[lod],
      lod,
      mb: new MeshBuilder(),
      nodes,
      rand: rng(2000 + variant * 31),
      sp,
      variant,
    };
  },
  catmullSegment = (pts, seg, f) => {
    const p0 = pts[Math.max(seg - 1, 0)],
      p1 = pts[seg],
      p2 = pts[seg + 1],
      p3 = pts[Math.min(seg + 2, pts.length - 1)],
      f2 = f * f,
      f3 = f2 * f;
    return [0, 1, 2].map(
      (k) =>
        0.5 *
        (2 * p1[k] +
          (-p0[k] + p2[k]) * f +
          (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 +
          (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3),
    );
  },
  // Catmull-Rom spline through the points, t in [0, 1].
  catmullRom = (pts) => (t) => {
    const x = t * (pts.length - 1),
      seg = Math.min(Math.floor(x), pts.length - 2);
    return catmullSegment(pts, seg, x - seg);
  },
  // One branch chain as a tube along a spline through its nodes; the trunk
  // flares at the base into buttress fins.
  branch = ({ crown, flex, level, lod, mb, nodes, sp }, chain) => {
    const at = catmullRom(chain.map((n) => nodes[n].p)),
      isTrunk = chain[0] === 0,
      node = (t) => chain[Math.min(Math.round(t * (chain.length - 1)), chain.length - 1)],
      r0 = nodes[chain[1]].r,
      radius = (t, a) => {
        let { r } = nodes[node(t)];
        if (isTrunk) {
          const [, h] = at(t);
          r *= 1 + 0.6 * Math.exp(-h * 30);
          r *= 1 + sp.buttress * Math.exp(-h * 18) * (0.5 + 0.5 * Math.cos(5 * a + 1.3)) ** 3;
        }
        return Math.max(r, TWIG);
      },
      segs = Math.max(2, Math.ceil((chain.length - 1) / (lod + 1))),
      [, radial] = level.radial.find(([above]) => r0 > above);
    mb.tube(at, radius, segs, radial, (t) => {
      const p = at(t),
        // The bare trunk below the crown brightens with height
        bole = [crown.ao(p) * 0.9, 0.75 + (0.25 * p[1]) / sp.trunk][Number(isTrunk && p[1] < sp.trunk)];
      return [MAT.bark, bole, flex(node(t)), p[1]];
    });
  },
  // The corners (with uv) and half-width of a foliage card of size, grown
  // around the centre of its full-detail size0 version.
  cardCorners = (p, direction, face, [size0, size]) => {
    const across = cross(face, direction),
      fallback = cross([1, 0, 0], direction),
      isDegenerate = magnitude(across) < 1e-3,
      side = mul(norm([across, fallback][Number(isDegenerate)]), size * 0.5),
      centre = add(p, mul(direction, size0 * 0.38)),
      base = add(centre, mul(direction, -size * 0.5)),
      tip = add(centre, mul(direction, size * 0.5));
    return {
      corners: [
        [sub(base, side), 0, 1],
        [add(base, side), 1, 1],
        [add(tip, side), 1, 0],
        [sub(tip, side), 0, 0],
      ],
      side,
    };
  },
  card = (parts, id, [size0, direction, face]) => {
    const { crown, flex, level, mb, nodes, sp } = parts,
      { corners, side } = cardCorners(nodes[id].p, direction, face, [size0, size0 * level.size]),
      // Crown normal, a little of the card's own orientation for variety
      own = mul(norm(cross(direction, side)), 0.25),
      sway = Math.min(1, flex(id) + 0.15),
      ids = corners.map(([p, u, v]) => {
        const bend = mul(crown.normal(p), 0.75);
        return mb.vert(p, norm(add(bend, own)), [MAT.foliage, crown.ao(p), sway, packUV(u, v, sp.leaf)]);
      });
    mb.quad(...ids);
  },
  // The clusters on one twig point along it and outwards, droop a little, and
  // face mostly up (leaves turn to the light).
  twigCards = (parts, id, draw) => {
    const { crown, level, nodes, sp } = parts,
      nd = nodes[id],
      twig = towards(nd.p, nodes[nd.parent].p),
      out = mul(crown.normal(nd.p), 0.5),
      lean = add(mul(twig, 0.6), out);
    for (let c = 0; c < level.perTip; c += 1) {
      const size0 = sp.card * (0.75 + 0.5 * draw()),
        direction = norm(add(lean, [(draw() - 0.5) * 0.8, -0.25 + (draw() - 0.5) * 0.4, (draw() - 0.5) * 0.8])),
        tilt = add(out, [draw() - 0.5, 0, draw() - 0.5]),
        face = norm(add([0, 0.9, 0], tilt));
      card(parts, id, [size0, direction, face]);
    }
  },
  // Foliage cards on the twigs; every card's randomness comes from its own
  // twig, so all LODs agree on it.
  foliage = (parts) => {
    const { level, nodes, sp, variant } = parts;
    for (const [id, nd] of nodes.entries()) {
      const draw = rng(id * 7919 + variant * 31 + 5);
      if (nd.r < TWIG * 2.2 && nd.p[1] > sp.trunk * 0.9 && draw() <= level.cards) twigCards(parts, id, draw);
    }
  },
  // Vines hanging from the lower limbs in sagging loops.
  lianas = ({ crown, mb, nodes, rand, sp }) => {
    const anchors = nodes.filter((n) => n.r > 0.004 && n.r < 0.012 && n.p[1] > sp.trunk);
    for (let k = 0; k < sp.lianas && anchors.length > 0; k += 1) {
      const a = anchors[Math.floor(rand() * anchors.length)].p,
        drop = 0.25 + rand() * (a[1] - 0.15),
        swing = [(rand() - 0.5) * 0.12, 0, (rand() - 0.5) * 0.12],
        path = (t) => {
          const sway = mul(swing, Math.sin(t * Math.PI));
          return add(a, add(sway, [0.01 * Math.sin(t * 17), -drop * t, 0.01 * Math.cos(t * 13)]));
        };
      mb.tube(
        path,
        (t) => 0.0022 * (1 - 0.4 * t),
        10,
        3,
        (t) => [MAT.stem, crown.ao(path(t)) * 0.8, 0.4 + 0.6 * t, t],
      );
    }
  },
  // One bromeliad leaf from c along phi, its tip tinted by hue.
  rosetteLeaf = (mb, c, hue, [phi, length]) => {
    const direction = [Math.cos(phi), 0, Math.sin(phi)],
      side = [-Math.sin(phi) * 0.004, 0, Math.cos(phi) * 0.004],
      mid = add(c, add(mul(direction, length * 0.5), [0, length * 0.6, 0])),
      tip = add(c, add(mul(direction, length), [0, length * 0.35, 0])),
      base = [MAT.bananaLeaf, 0.7, 0.3, 0.5],
      bright = [MAT.bananaLeaf, 0.9, 0.5, hue];
    mb.flatTri(sub(c, side), add(c, side), add(mid, side), base, base, bright);
    mb.flatTri(sub(c, side), add(mid, side), sub(mid, side), base, bright, bright);
    mb.flatTri(sub(mid, side), add(mid, side), tip, bright, bright, bright);
  },
  // Bromeliad-like rosettes sitting in the forks of the big limbs.
  epiphytes = ({ mb, nodes, rand, sp }) => {
    const forks = nodes.filter((n) => n.children.length > 1 && n.r > 0.006 && n.p[1] > sp.trunk * 0.95);
    for (let k = 0; k < sp.epiphytes && forks.length > 0; k += 1) {
      const c = add(forks[Math.floor(rand() * forks.length)].p, [0, 0.006, 0]),
        hue = rand();
      for (let leaf = 0; leaf < 9; leaf += 1)
        rosetteLeaf(mb, c, hue, [leaf * GOLDEN_ANGLE + rand() * 0.4, 0.02 + 0.012 * rand()]);
    }
  },
  tree = (kind, variant, lod) => {
    const parts = treeParts(kind, variant, lod);
    for (const chain of chains(parts.nodes))
      if (chain.length > 1 && parts.nodes[chain[1]].r >= parts.level.minR) branch(parts, chain);
    foliage(parts);
    if (parts.level.extras) {
      lianas(parts);
      epiphytes(parts);
    }
    return parts.mb.build();
  },
  // Smallest radius b such that the sphere of radius b around (0, b / 2, 0)
  // holds every vertex (the scatter's culling sphere, in mesh units).
  bound = (mesh) => {
    let b = 0.05;
    for (let at = 0; at < mesh.v.length; at += 10) {
      const x = mesh.v[at],
        y = mesh.v[at + 1],
        z = mesh.v[at + 2];
      while (Math.hypot(x, y - b / 2, z) > b) b *= 1.02;
    }
    return b;
  };

export { bound, tree };
