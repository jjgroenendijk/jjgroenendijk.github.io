// Mesh building blocks shared by all procedural models.
// Vertex format: pos(3) normal(3) extra(4) = 10 floats,
// extra = [material, ambient occlusion, flex (animation weight), t (param)].

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// deterministic random generator
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function vnoise(x, y, z) {
  const h = (i, j, k) => {
    let n = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy),
    w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h(ix, iy, iz), h(ix + 1, iy, iz), u), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u), v),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}

const icoCache = new Map();
export function icosphere(subd) {
  if (icoCache.has(subd)) return icoCache.get(subd);
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map(norm);
  let faces = [
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
  ];
  for (let s = 0; s < subd; s++) {
    const mid = new Map();
    const m = (a, b) => {
      const k = a < b ? a * 100000 + b : b * 100000 + a;
      if (!mid.has(k)) {
        mid.set(k, verts.length);
        verts.push(norm(mul(add(verts[a], verts[b]), 0.5)));
      }
      return mid.get(k);
    };
    const nf = [];
    for (const [a, b, c] of faces) {
      const ab = m(a, b),
        bc = m(b, c),
        ca = m(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  const r = { verts, faces };
  icoCache.set(subd, r);
  return r;
}

export class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
  }

  vert(p, n, e) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], e[0], e[1], e[2], e[3]);
    return this.v.length / 10 - 1;
  }
  tri(a, b, c) {
    this.i.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.i.push(a, b, c, a, c, d);
  }

  // triangle with a computed normal, oriented towards `up`
  flatTri(p0, p1, p2, e0, e1 = e0, e2 = e0, up = [0, 1, 0]) {
    let n = norm(cross(sub(p1, p0), sub(p2, p0)));
    if (dot(n, up) < 0) n = mul(n, -1);
    this.tri(this.vert(p0, n, e0), this.vert(p1, n, e1), this.vert(p2, n, e2));
  }
  flatQuad(a, b, c, d, e, up) {
    this.flatTri(a, b, c, e, e, e, up);
    this.flatTri(a, c, d, e, e, e, up);
  }

  // grid surface: f(u, v) -> point, smooth normals from finite differences
  surface(f, nu, nv, ex) {
    const base = this.v.length / 10;
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const u = i / nu,
          v = j / nv;
        const p = f(u, v);
        const du = sub(f(Math.min(u + 1e-3, 1), v), f(Math.max(u - 1e-3, 0), v));
        const dv = sub(f(u, Math.min(v + 1e-3, 1)), f(u, Math.max(v - 1e-3, 0)));
        this.vert(p, norm(cross(du, dv)), ex(u, v, p));
      }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        this.quad(a, a + 1, a + nu + 2, a + nu + 1);
      }
  }

  // tube along path(t), t in [0,1]
  tube(path, radius, segs, radial, ex) {
    const base = this.v.length / 10;
    let prevN = null;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const p = path(t);
      const T = norm(sub(path(Math.min(t + 0.01, 1)), path(Math.max(t - 0.01, 0))));
      const N = prevN
        ? norm(sub(prevN, mul(T, dot(prevN, T))))
        : norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      prevN = N;
      const B = cross(T, N);
      for (let r = 0; r <= radial; r++) {
        const a = (r / radial) * Math.PI * 2;
        const dir = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
        this.vert(add(p, mul(dir, radius(t, a))), dir, ex(t, a));
      }
    }
    for (let s = 0; s < segs; s++)
      for (let r = 0; r < radial; r++) {
        const a = base + s * (radial + 1) + r,
          b = a + radial + 1;
        this.quad(a, a + 1, b + 1, b);
      }
  }

  // axis-aligned box (min corner, max corner)
  box(lo, hi, e) {
    const [x0, y0, z0] = lo,
      [x1, y1, z1] = hi;
    const f = (n, ps) => {
      const b = this.v.length / 10;
      ps.forEach((p) => this.vert(p, n, e));
      this.quad(b, b + 1, b + 2, b + 3);
    };
    f(
      [0, 1, 0],
      [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
    );
    f(
      [0, -1, 0],
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
    );
    f(
      [1, 0, 0],
      [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
    );
    f(
      [-1, 0, 0],
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
    );
    f(
      [0, 0, 1],
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
    );
    f(
      [0, 0, -1],
      [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
      ],
    );
  }

  ico(center, radius, subd, ex, deform) {
    const { verts, faces } = icosphere(subd);
    const base = this.v.length / 10;
    for (const v of verts) {
      let p = add(center, mul(v, radius));
      let n = v;
      if (deform) {
        const r = deform(p, v);
        p = r.p;
        n = r.n;
      }
      this.vert(p, n, ex(p, v));
    }
    for (const f of faces) this.tri(base + f[0], base + f[1], base + f[2]);
  }

  build() {
    return { v: new Float32Array(this.v), i: new Uint32Array(this.i) };
  }
}
