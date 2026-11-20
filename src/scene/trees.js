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
import { MAT } from './catalog.js';
import { MeshBuilder, add, sub, mul, cross, norm, len, rng, vnoise } from './geometry.js';
import { LEAF } from '../shaders/leaves.js';

// Species. Lengths are in mesh units: a tree is about one unit tall and the
// scatter scales it to metres.
export const SPECIES = {
  // broad, rounded canopy tree: the bulk of the forest
  canopy: {
    trunk: 0.3, crown: [0, 0.64, 0], radii: [0.44, 0.3, 0.44], lumps: 0.35, flatBottom: 0.55,
    points: 560, step: 0.022, influence: 0.16, kill: 0.04, tropism: 0.12,
    leaf: LEAF.broad, card: 0.085, buttress: 1.6, lianas: 4, epiphytes: 5,
  },
  // emergent giant: a tall bare bole with buttress roots and a flat umbrella crown
  emergent: {
    trunk: 0.64, crown: [0, 0.86, 0], radii: [0.46, 0.14, 0.46], lumps: 0.35, flatBottom: 0.75,
    points: 480, step: 0.02, influence: 0.17, kill: 0.04, tropism: 0.1,
    leaf: LEAF.small, card: 0.07, buttress: 3.2, lianas: 3, epiphytes: 6,
  },
  // slender understory tree with feathery compound leaves
  understory: {
    trunk: 0.42, crown: [0, 0.72, 0], radii: [0.2, 0.27, 0.2], lumps: 0.2, flatBottom: 0.3,
    points: 260, step: 0.026, influence: 0.15, kill: 0.045, tropism: 0.45,
    leaf: LEAF.pinnate, card: 0.14, buttress: 0.6, lianas: 0, epiphytes: 0,
  },
};

const DA_VINCI = 2.4;  // exponent of the branch radius rule
const TWIG = 0.0022;   // radius of a terminal twig

// ------------------------------------------------------------------ skeleton
// Nodes: { p, parent, children, r, depth (path length from the root) }.
function grow(sp, R) {
  const [cx, cy, cz] = sp.crown, [rx, ry, rz] = sp.radii;
  // attraction points in a lumpy ellipsoid, with a flattened underside
  const pts = [];
  const lumpSeed = R() * 100;
  while (pts.length < sp.points) {
    const d = [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1];
    const l = len(d);
    if (l > 1 || l < 1e-3) continue;
    const u = mul(d, 1 / l);
    const edge = 1 + sp.lumps * (vnoise(u[0] * 2 + lumpSeed, u[1] * 2, u[2] * 2) - 0.5) * 2;
    if (l > edge) continue;
    if (d[1] < -sp.flatBottom) continue;
    // denser towards the envelope: leaves live on the outside of a crown
    if (R() > l * l) continue;
    pts.push([cx + d[0] * rx, cy + d[1] * ry, cz + d[2] * rz]);
  }
  // the trunk: a slightly wandering column up to the crown
  const nodes = [{ p: [0, 0, 0], parent: -1, children: [], r: 0, depth: 0 }];
  const lean = [(R() - 0.5) * 0.04, 0, (R() - 0.5) * 0.04];
  // (past its nominal height until the crown's attraction points are in reach)
  const reached = (q) => pts.some((a) => len(sub(a, q)) < sp.influence * 0.9);
  while (nodes[nodes.length - 1].p[1] < sp.trunk || (!reached(nodes[nodes.length - 1].p) && nodes[nodes.length - 1].p[1] < cy)) {
    const last = nodes[nodes.length - 1];
    const y = last.p[1] + sp.step * 1.5;
    const p = [lean[0] * y + 0.006 * Math.sin(y * 9 + lumpSeed), y, lean[2] * y + 0.006 * Math.cos(y * 7)];
    add_(nodes, nodes.length - 1, p);
  }
  // colonisation: every point pulls on its nearest node within reach
  const alive = pts.map(() => true);
  for (let iter = 0; iter < 120; iter++) {
    const pull = new Map();
    let any = false;
    for (let a = 0; a < pts.length; a++) {
      if (!alive[a]) continue;
      let best = -1, bd = sp.influence * sp.influence;
      for (let n = 0; n < nodes.length; n++) {
        const q = nodes[n].p;
        const dx = pts[a][0] - q[0], dy = pts[a][1] - q[1], dz = pts[a][2] - q[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = n; }
      }
      if (best < 0) continue;
      any = true;
      const v = norm(sub(pts[a], nodes[best].p));
      pull.set(best, add(pull.get(best) || [0, 0, 0], v));
    }
    if (!any) break;
    const fresh = [];
    for (const [n, v] of pull) {
      const dir = norm(add(norm(v), [0, sp.tropism, 0]));
      const p = add(nodes[n].p, mul(dir, sp.step));
      // avoid growing a node on top of an existing child
      if (nodes[n].children.some((c) => len(sub(nodes[c].p, p)) < sp.step * 0.3)) continue;
      fresh.push(add_(nodes, n, p));
    }
    if (!fresh.length) break;
    for (let a = 0; a < pts.length; a++) {
      if (!alive[a]) continue;
      for (const n of fresh) if (len(sub(pts[a], nodes[n].p)) < sp.kill) { alive[a] = false; break; }
    }
  }
  // radii from the twigs down (children always come after their parent)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const nd = nodes[i];
    nd.r = nd.children.length ? Math.pow(nd.children.reduce((s, c) => s + Math.pow(nodes[c].r, DA_VINCI), 0), 1 / DA_VINCI) : TWIG;
  }
  return nodes;
}
function add_(nodes, parent, p) {
  const pn = nodes[parent];
  nodes.push({ p, parent, children: [], r: 0, depth: pn.depth + len(sub(p, pn.p)) });
  pn.children.push(nodes.length - 1);
  return nodes.length - 1;
}

// Splits the skeleton into chains: each node continues into its thickest
// child; the other children start chains of their own (from their parent).
function chains(nodes) {
  const out = [];
  const walk = (start, first) => {
    const chain = first >= 0 ? [first, start] : [start];
    let n = start;
    while (nodes[n].children.length) {
      const kids = [...nodes[n].children].sort((a, b) => nodes[b].r - nodes[a].r);
      for (const k of kids.slice(1)) walk(k, n);
      n = kids[0];
      chain.push(n);
    }
    out.push(chain);
  };
  walk(0, -1);
  return out;
}

// ------------------------------------------------------------------ mesh
// Crown-space helpers: rho is the normalised distance from the crown centre
// (1 on the envelope); the crown normal points outwards from the centre.
function crownFrame(sp) {
  const [cx, cy, cz] = sp.crown, [rx, ry, rz] = sp.radii;
  const local = (p) => [(p[0] - cx) / rx, (p[1] - cy) / ry, (p[2] - cz) / rz];
  return {
    rho: (p) => len(local(p)),
    normal: (p) => { const l = local(p); return norm([l[0] / rx, l[1] / ry + 0.4, l[2] / rz]); },
    // interior occlusion: dark in the core and underneath, open on the outside
    ao: (p) => {
      const l = local(p);
      const rho = len(l);
      return Math.min(1, 0.22 + 0.78 * Math.pow(Math.min(rho, 1), 1.6) * (0.7 + 0.3 * Math.max(-1, Math.min(1, l[1] * 0.7 + 0.3))));
    },
  };
}

// foliage card uv + layer, packed into one float (see foliageLib)
const packUV = (u, v, layer) => layer * 1048576 + Math.round(u * 1023) * 1024 + Math.round(v * 1023);

// Per LOD: smallest branch radius drawn, radial segments by size, share and
// size of the foliage cards. Coarser LODs keep a subset of the very same
// cards (same place, orientation and centre), enlarged to keep the crown's
// volume and silhouette, so switching LOD does not change the tree's shape.
const LOD = [
  { minR: 0, radial: (r) => (r > 0.01 ? 7 : r > 0.004 ? 4 : 3), cards: 1, size: 1, perTip: 2, extras: true },
  { minR: 0.0045, radial: (r) => (r > 0.012 ? 5 : 3), cards: 0.7, size: 1.4, perTip: 1, extras: false },
  { minR: 0.009, radial: () => 3, cards: 0.4, size: 1.8, perTip: 1, extras: false },
];

// every LOD of a tree is built from the same skeleton
const skeletons = new Map();
function skeleton(kind, variant) {
  const key = `${kind}/${variant}`;
  if (!skeletons.has(key)) skeletons.set(key, grow(SPECIES[kind], rng(1000 + variant * 97 + Object.keys(SPECIES).indexOf(kind) * 13)));
  return skeletons.get(key);
}

export function tree(kind, variant, lod) {
  const sp = SPECIES[kind];
  const R = rng(2000 + variant * 31);
  const nodes = skeleton(kind, variant);
  const crown = crownFrame(sp);
  const L = LOD[lod];
  const mb = new MeshBuilder();
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  // wind bend weight: grows along the limbs, zero on the trunk
  const flexOf = (n) => Math.max(0, (nodes[n].depth - sp.trunk) / Math.max(maxDepth - sp.trunk, 1e-3));

  // branches
  for (const ch of chains(nodes)) {
    if (nodes[ch[1] ?? ch[0]].r < L.minR) continue;
    const pts = ch.map((n) => nodes[n].p);
    if (pts.length < 2) continue;
    const isTrunk = ch[0] === 0;
    const at = (t) => {
      const x = t * (pts.length - 1);
      const i = Math.min(Math.floor(x), pts.length - 2), f = x - i;
      // Catmull-Rom through the nodes
      const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
      const f2 = f * f, f3 = f2 * f;
      return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3));
    };
    const node = (t) => ch[Math.min(Math.round(t * (ch.length - 1)), ch.length - 1)];
    const r0 = nodes[ch[1]].r;
    const radius = (t, a) => {
      let r = nodes[node(t)].r;
      if (isTrunk) {
        // flared base and buttress fins
        const h = at(t)[1];
        r *= 1 + 0.6 * Math.exp(-h * 30);
        r *= 1 + sp.buttress * Math.exp(-h * 18) * Math.pow(0.5 + 0.5 * Math.cos(5 * a + 1.3), 3);
      }
      return Math.max(r, TWIG);
    };
    const segs = Math.max(2, Math.ceil((ch.length - 1) / (lod + 1)));
    mb.tube(at, radius, segs, L.radial(r0), (t) => {
      const p = at(t);
      return [MAT.bark, isTrunk && p[1] < sp.trunk ? 0.75 + 0.25 * p[1] / sp.trunk : crown.ao(p) * 0.9, flexOf(node(t)), p[1]];
    });
  }

  // foliage cards on the twigs; every card's randomness comes from its own
  // twig, so all LODs agree on it
  const tips = nodes.map((n, i) => i).filter((i) => nodes[i].r < TWIG * 2.2 && nodes[i].p[1] > sp.trunk * 0.9);
  for (const i of tips) {
    const T = rng(i * 7919 + variant * 31 + 5);
    if (T() > L.cards) continue;
    const nd = nodes[i];
    const twig = norm(sub(nd.p, nodes[nd.parent].p));
    const out = crown.normal(nd.p);
    for (let c = 0; c < 2; c++) {
      const size0 = sp.card * (0.75 + 0.5 * T());
      // the cluster points along the twig and outwards, droops a little,
      // and faces mostly up (leaves turn to the light)
      const dir = norm(add(add(mul(twig, 0.6), mul(out, 0.5)), [(T() - 0.5) * 0.8, -0.25 + (T() - 0.5) * 0.4, (T() - 0.5) * 0.8]));
      const face = norm(add([0, 0.9, 0], add(mul(out, 0.5), [(T() - 0.5), 0, (T() - 0.5)])));
      if (c >= L.perTip) break;
      const size = size0 * L.size;
      let side = cross(face, dir);
      if (len(side) < 1e-3) side = cross([1, 0, 0], dir);
      side = mul(norm(side), size * 0.5);
      // grown around the full-detail card's centre
      const centre = add(nd.p, mul(dir, size0 * 0.38));
      const base = add(centre, mul(dir, -size * 0.5));
      const tip = add(centre, mul(dir, size * 0.5));
      const corners = [[sub(base, side), 0, 1], [add(base, side), 1, 1], [add(tip, side), 1, 0], [sub(tip, side), 0, 0]];
      const ids = corners.map(([p, u, v]) => {
        // crown normal, a little of the card's own orientation for variety
        const n = norm(add(mul(crown.normal(p), 0.75), mul(norm(cross(dir, side)), 0.25)));
        return mb.vert(p, n, [MAT.foliage, crown.ao(p), Math.min(1, flexOf(i) + 0.15), packUV(u, v, sp.leaf)]);
      });
      mb.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  if (L.extras) {
    lianas(mb, nodes, sp, R, crown);
    epiphytes(mb, nodes, sp, R);
  }
  return mb.build();
}

// Vines hanging from the lower limbs in sagging loops.
function lianas(mb, nodes, sp, R, crown) {
  const anchors = nodes.map((n, i) => i).filter((i) => nodes[i].r > 0.004 && nodes[i].r < 0.012 && nodes[i].p[1] > sp.trunk);
  for (let k = 0; k < sp.lianas && anchors.length; k++) {
    const a = nodes[anchors[Math.floor(R() * anchors.length)]].p;
    const drop = 0.25 + R() * (a[1] - 0.15);
    const swing = [(R() - 0.5) * 0.12, 0, (R() - 0.5) * 0.12];
    const path = (t) => add(a, add(mul(swing, Math.sin(t * Math.PI)), [0.01 * Math.sin(t * 17), -drop * t, 0.01 * Math.cos(t * 13)]));
    mb.tube(path, (t) => 0.0022 * (1 - 0.4 * t), 10, 3, (t) => [MAT.stem, crown.ao(path(t)) * 0.8, 0.4 + 0.6 * t, t]);
  }
}

// Bromeliad-like rosettes sitting in the forks of the big limbs.
function epiphytes(mb, nodes, sp, R) {
  const forks = nodes.map((n, i) => i).filter((i) => nodes[i].children.length > 1 && nodes[i].r > 0.006 && nodes[i].p[1] > sp.trunk * 0.95);
  for (let k = 0; k < sp.epiphytes && forks.length; k++) {
    const c = add(nodes[forks[Math.floor(R() * forks.length)]].p, [0, 0.006, 0]);
    const hue = R();
    const n = 9;
    for (let j = 0; j < n; j++) {
      const phi = j * 2.39996 + R() * 0.4;
      const dir = [Math.cos(phi), 0, Math.sin(phi)];
      const side = [-Math.sin(phi) * 0.004, 0, Math.cos(phi) * 0.004];
      const L = 0.02 + 0.012 * R();
      const mid = add(c, add(mul(dir, L * 0.5), [0, L * 0.6, 0]));
      const tip = add(c, add(mul(dir, L), [0, L * 0.35, 0]));
      const e = [MAT.bananaLeaf, 0.7, 0.3, 0.5];
      const e2 = [MAT.bananaLeaf, 0.9, 0.5, hue];
      mb.flatTri(sub(c, side), add(c, side), add(mid, side), e, e, e2);
      mb.flatTri(sub(c, side), add(mid, side), sub(mid, side), e, e2, e2);
      mb.flatTri(sub(mid, side), add(mid, side), tip, e2, e2, e2);
    }
  }
}

// Smallest radius b such that the sphere of radius b around (0, b / 2, 0)
// holds every vertex (the scatter's culling sphere, in mesh units).
export function bound(mesh) {
  let b = 0.05;
  for (let i = 0; i < mesh.v.length; i += 10) {
    const x = mesh.v[i], y = mesh.v[i + 1], z = mesh.v[i + 2];
    while (Math.hypot(x, y - b / 2, z) > b) b *= 1.02;
  }
  return b;
}
