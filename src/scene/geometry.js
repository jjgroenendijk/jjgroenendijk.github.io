// Mesh building blocks shared by all procedural models.
// Vertex format: pos(3) normal(3) extra(4) = 10 floats,
// extra = [material, ambient occlusion, flex (animation weight), t (param)].

// The six faces of a box as [outward normal, corners], each corner picking the min (0) or max (1) coordinate per axis.
const BOX_FACES = [
    [
      [0, 1, 0],
      [
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 0],
      ],
    ],
    [
      [0, -1, 0],
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
    ],
    [
      [1, 0, 0],
      [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [0, 0, 0],
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
      ],
    ],
    [
      [0, 0, 1],
      [
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ],
    ],
    [
      [0, 0, -1],
      [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
    ],
  ],
  // Offset of the finite differences that give surface normals.
  DIFF_STEP = 1e-3,
  // Axes to start a tube's frame from, indexed by whether the tangent is far from vertical.
  FRAME_SEEDS = [
    [1, 0, 0],
    [0, 1, 0],
  ],
  GOLDEN = (1 + Math.sqrt(5)) / 2,
  // Icosahedron corners (unnormalised) and faces, the level-0 icosphere.
  ICO_CORNERS = [
    [-1, GOLDEN, 0],
    [1, GOLDEN, 0],
    [-1, -GOLDEN, 0],
    [1, -GOLDEN, 0],
    [0, -1, GOLDEN],
    [0, 1, GOLDEN],
    [0, -1, -GOLDEN],
    [0, 1, -GOLDEN],
    [GOLDEN, 0, -1],
    [GOLDEN, 0, 1],
    [-GOLDEN, 0, -1],
    [-GOLDEN, 0, 1],
  ],
  ICO_FACES = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ],
  // Edge key stride: more than any vertex index, so (min, max) index pairs map to unique keys.
  ICO_KEY_STRIDE = 100_000,
  // Offset of the finite differences that give tube tangents.
  TANGENT_STEP = 0.01,
  // Turns a uint32 into [0, 1).
  UINT32_RANGE = 4_294_967_296,
  VERTEX_FLOATS = 10,
  add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  // Smoothstep weight of the value-noise interpolation.
  fade = (f) => f * f * (3 - 2 * f),
  // Lattice hash of value noise, in [0, 1).
  hash3 = (x, y, z) => {
    // eslint-disable-next-line no-bitwise -- integer hash relies on exact int32 wraparound
    let n = Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791);
    // eslint-disable-next-line no-bitwise -- integer hash relies on exact int32 wraparound
    n = Math.imul(n ^ (n >>> 13), 1_274_126_177);
    // eslint-disable-next-line no-bitwise -- integer hash relies on exact uint32 conversion
    return ((n ^ (n >>> 16)) >>> 0) / UINT32_RANGE;
  },
  lerp = (a, b, t) => a + (b - a) * t,
  magnitude = (a) => Math.hypot(a[0], a[1], a[2]),
  mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  norm = (a) => {
    const size = magnitude(a) || 1;
    return [a[0] / size, a[1] / size, a[2] / size];
  },
  // Deterministic random generator (mulberry32).
  rng = (seed) => {
    // eslint-disable-next-line no-bitwise -- the generator state is a uint32
    let s = seed >>> 0;
    return () => {
      // eslint-disable-next-line no-bitwise -- the generator state is a uint32
      s = (s + 0x6d_2b_79_f5) >>> 0;
      let t = s;
      // eslint-disable-next-line no-bitwise -- integer hash relies on exact int32 wraparound
      t = Math.imul(t ^ (t >>> 15), t | 1);
      // eslint-disable-next-line no-bitwise -- integer hash relies on exact int32 wraparound
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      // eslint-disable-next-line no-bitwise -- integer hash relies on exact uint32 conversion
      return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
    };
  },
  icoCache = new Map(),
  sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  // A minus its projection onto axis.
  subProjection = (a, axis) => sub(a, mul(axis, dot(a, axis))),
  // Splits every face into four, appending the shared edge midpoints (on the unit sphere) to verts.
  subdivide = (verts, faces) => {
    const cache = new Map(),
      midpoint = (a, b) => {
        const key = Math.min(a, b) * ICO_KEY_STRIDE + Math.max(a, b);
        if (!cache.has(key)) {
          const sum = add(verts[a], verts[b]);
          cache.set(key, verts.length);
          verts.push(norm(mul(sum, 0.5)));
        }
        return cache.get(key);
      };
    return faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      return [
        [a, ab, ca],
        [b, bc, ab],
        [c, ca, bc],
        [ab, bc, ca],
      ];
    });
  },
  // Next normal of a tube's rotation-minimising frame: the first ring (no previous normal yet) takes any
  // perpendicular, later rings parallel-transport the previous one.
  transport = (previous, tangent) => {
    const seed = FRAME_SEEDS[Number(Math.abs(tangent[1]) < 0.9)];
    if (previous.length === 0) return norm(cross(tangent, seed));
    return norm(subProjection(previous, tangent));
  },
  // Unit icosphere subdivided `subd` times, cached per level.
  icosphere = (subd) => {
    if (!icoCache.has(subd)) {
      const verts = ICO_CORNERS.map((corner) => norm(corner));
      let faces = ICO_FACES;
      for (let s = 0; s < subd; s += 1) faces = subdivide(verts, faces);
      icoCache.set(subd, { faces, verts });
    }
    return icoCache.get(subd);
  },
  vnoise = (x, y, z) => {
    const cellX = Math.floor(x),
      cellY = Math.floor(y),
      cellZ = Math.floor(z),
      fx = x - cellX,
      fy = y - cellY,
      fz = z - cellZ,
      h000 = hash3(cellX, cellY, cellZ),
      h001 = hash3(cellX, cellY, cellZ + 1),
      h010 = hash3(cellX, cellY + 1, cellZ),
      h011 = hash3(cellX, cellY + 1, cellZ + 1),
      h100 = hash3(cellX + 1, cellY, cellZ),
      h101 = hash3(cellX + 1, cellY, cellZ + 1),
      h110 = hash3(cellX + 1, cellY + 1, cellZ),
      h111 = hash3(cellX + 1, cellY + 1, cellZ + 1),
      u = fade(fx),
      v = fade(fy),
      w = fade(fz),
      x00 = lerp(h000, h100, u),
      x01 = lerp(h001, h101, u),
      x10 = lerp(h010, h110, u),
      x11 = lerp(h011, h111, u),
      y0 = lerp(x00, x10, v),
      y1 = lerp(x01, x11, v);
    return lerp(y0, y1, w);
  };

export { add, cross, magnitude as len, mul, norm, rng, sub, icosphere, vnoise };

export class MeshBuilder {
  v = [];
  i = [];

  // One vertex of surface(), its normal from central differences.
  #surfaceVertex(f, u, v, ex) {
    const centre = f(u, v),
      du = sub(f(Math.min(u + DIFF_STEP, 1), v), f(Math.max(u - DIFF_STEP, 0), v)),
      dv = sub(f(u, Math.min(v + DIFF_STEP, 1)), f(u, Math.max(v - DIFF_STEP, 0)));
    this.vert(centre, norm(cross(du, dv)), ex(u, v, centre));
  }

  // One ring of tube() vertices around centre.
  #tubeRing({ binormal, centre, ex, normal, radial, radius, t }) {
    for (let r = 0; r <= radial; r += 1) {
      const a = (r / radial) * Math.PI * 2,
        direction = add(mul(normal, Math.cos(a)), mul(binormal, Math.sin(a))),
        offset = mul(direction, radius(t, a));
      this.vert(add(centre, offset), direction, ex(t, a));
    }
  }

  vert(p, n, extra) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], extra[0], extra[1], extra[2], extra[3]);
    return this.v.length / VERTEX_FLOATS - 1;
  }

  tri(a, b, c) {
    this.i.push(a, b, c);
  }

  quad(a, b, c, d) {
    this.i.push(a, b, c, a, c, d);
  }

  // Triangle with a computed normal, oriented towards `up`.
  // eslint-disable-next-line max-params -- positional signature used by every mesh module
  flatTri(p0, p1, p2, extra0, extra1 = extra0, extra2 = extra0, up = [0, 1, 0]) {
    let n = norm(cross(sub(p1, p0), sub(p2, p0)));
    if (dot(n, up) < 0) n = mul(n, -1);
    this.tri(this.vert(p0, n, extra0), this.vert(p1, n, extra1), this.vert(p2, n, extra2));
  }

  // eslint-disable-next-line max-params -- positional signature used by every mesh module
  flatQuad(a, b, c, d, extra, up) {
    this.flatTri(a, b, c, extra, extra, extra, up);
    this.flatTri(a, c, d, extra, extra, extra, up);
  }

  // Grid surface: f(u, v) -> point, smooth normals from finite differences.
  surface(f, nu, nv, ex) {
    const base = this.v.length / VERTEX_FLOATS;
    for (let iv = 0; iv <= nv; iv += 1)
      for (let iu = 0; iu <= nu; iu += 1) this.#surfaceVertex(f, iu / nu, iv / nv, ex);
    for (let iv = 0; iv < nv; iv += 1)
      for (let iu = 0; iu < nu; iu += 1) {
        const a = base + iv * (nu + 1) + iu;
        this.quad(a, a + 1, a + nu + 2, a + nu + 1);
      }
  }

  // Tube along path(t), t in [0,1].
  // eslint-disable-next-line max-params -- positional signature used by every mesh module
  tube(path, radius, segs, radial, ex) {
    const base = this.v.length / VERTEX_FLOATS;
    let normal = [];
    for (let s = 0; s <= segs; s += 1) {
      const t = s / segs,
        centre = path(t),
        ahead = path(Math.min(t + TANGENT_STEP, 1)),
        behind = path(Math.max(t - TANGENT_STEP, 0)),
        tangent = norm(sub(ahead, behind));
      normal = transport(normal, tangent);
      this.#tubeRing({ binormal: cross(tangent, normal), centre, ex, normal, radial, radius, t });
    }
    for (let s = 0; s < segs; s += 1)
      for (let r = 0; r < radial; r += 1) {
        const a = base + s * (radial + 1) + r,
          b = a + radial + 1;
        this.quad(a, a + 1, b + 1, b);
      }
  }

  // Axis-aligned box (min corner, max corner).
  box(lo, hi, extra) {
    const bounds = [lo, hi];
    for (const [n, corners] of BOX_FACES) {
      const first = this.v.length / VERTEX_FLOATS;
      for (const corner of corners)
        this.vert(
          corner.map((side, axis) => bounds[side][axis]),
          n,
          extra,
        );
      this.quad(first, first + 1, first + 2, first + 3);
    }
  }

  // eslint-disable-next-line max-params -- positional signature used by every mesh module
  ico(center, radius, subd, ex, deform) {
    const { verts, faces } = icosphere(subd),
      base = this.v.length / VERTEX_FLOATS;
    for (const v of verts) {
      let p = add(center, mul(v, radius)),
        n = v;
      if (deform) ({ p, n } = deform(p, v));
      this.vert(p, n, ex(p, v));
    }
    for (const f of faces) this.tri(base + f[0], base + f[1], base + f[2]);
  }

  build() {
    return { i: new Uint32Array(this.i), v: new Float32Array(this.v) };
  }
}
