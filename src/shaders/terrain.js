import { frameStruct, commonLib, shadowLib, hizLib, LEVELS } from './common.js';

export const GRID_M = 96; // half-size of a clipmap level in cells
export const SIDE = GRID_M * 2 + 1; // vertices per level side
export const TILES = 4; // each level is split into TILES x TILES clusters for culling
export const TILE = (GRID_M * 2) / TILES;

// The clipmap cache is addressed toroidally: a world lattice point keeps its
// texel while its level moves, so a move only re-bakes the rows and columns
// that scrolled into view (see terrainCacheWGSL).
export const cacheLib = /* wgsl */ `
@group(0) @binding(1) var cacheTex: texture_2d_array<f32>;
// texel of grid point g (-GRID_M..GRID_M around the level centre) of a level
fn cacheTexel(lvl: u32, g: vec2i) -> vec2i {
  let Lv = F.levels[lvl];
  let G = vec2i(round(Lv.xy / Lv.z)) + clamp(g, vec2i(-${GRID_M}), vec2i(${GRID_M}));
  return ((G % ${SIDE}) + ${SIDE}) % ${SIDE};
}
fn cacheFetch(lvl: u32, g: vec2i) -> vec4f { return textureLoad(cacheTex, cacheTexel(lvl, g), lvl, 0); }

// Terrain height as drawn: bilinear lookup in the finest clipmap level that
// covers the point (used to place distant instances without any noise).
fn cacheHeight(p: vec2f) -> f32 {
  for (var l = 0u; l < ${LEVELS}u; l++) {
    let Lv = F.levels[l];
    let g = (p - Lv.xy) / Lv.z;
    if (any(abs(g) > vec2f(${GRID_M - 1}.0))) { continue; }
    let i = vec2i(floor(g)); let f = g - floor(g);
    let h00 = cacheFetch(l, i).x;
    let h10 = cacheFetch(l, i + vec2i(1, 0)).x;
    let h01 = cacheFetch(l, i + vec2i(0, 1)).x;
    let h11 = cacheFetch(l, i + vec2i(1, 1)).x;
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }
  return terrainHeight(p);
}
`;

// Compute: bake heights, normals and far horizon shadows into a clipmap texture
// array. Only texels that are new to a level's window are computed, plus a band
// of rows per frame that is refreshed so horizon shadows follow the sun.
export const BAKE_BYTES = (LEVELS + 1) * 16;
export const terrainCacheWGSL = frameStruct + commonLib + /* wgsl */ `
@group(0) @binding(1) var cacheOut: texture_storage_2d_array<rgba32float, write>;
struct Bake {
  prev: array<vec4f, ${LEVELS}>, // xy previous level centre, z mode (0 keep, 1 new texels, 2 everything)
  band: vec4f,                   // refresh: x level, rows [y, z)
};
@group(0) @binding(2) var<uniform> B: Bake;

fn needsBake(lvl: u32, row: u32, g: vec2f) -> bool {
  let Lv = F.levels[lvl];
  let pv = B.prev[lvl];
  if (pv.z > 1.5) { return true; }
  if (u32(B.band.x) == lvl && f32(row) >= B.band.y && f32(row) < B.band.z) { return true; }
  if (pv.z < 0.5) { return false; }
  let old = round((Lv.xy - pv.xy) / Lv.z) + g; // the same point in the previous window
  return any(abs(old) > vec2f(${GRID_M}.0));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let lvl = gid.z;
  if (gid.x > ${GRID_M * 2}u || gid.y > ${GRID_M * 2}u) { return; }
  let g = vec2f(f32(gid.x), f32(gid.y)) - ${GRID_M}.0;
  if (!needsBake(lvl, gid.y, g)) { return; }
  let Lv = F.levels[lvl];
  let p = Lv.xy + g * Lv.z;
  let h = terrainHeight(p);
  let e = max(Lv.z, 0.35);
  let hx0 = terrainHeight(p - vec2f(e, 0.0));
  let hx1 = terrainHeight(p + vec2f(e, 0.0));
  let hz0 = terrainHeight(p - vec2f(0.0, e));
  let hz1 = terrainHeight(p + vec2f(0.0, e));
  let n = normalize(vec3f(hx0 - hx1, 2.0 * e, hz0 - hz1));
  var sh = 1.0;
  let L = F.lightDir.xyz;
  if (lvl >= 2u && L.y > -0.05) {
    let dir = normalize(L.xz + vec2f(1e-5));
    let slope = L.y / max(length(L.xz), 1e-3);
    var t = Lv.z * 2.0;
    for (var i = 0; i < 12; i++) {
      let q = p + dir * t;
      let th = baseHeight(q);
      let ry = max(h, 0.0) + 2.0 + t * slope;
      sh = min(sh, sat((ry - th) / (t * 0.06) + 0.5));
      t *= 1.55;
      if (t > 4000.0 || sh < 0.01) { break; }
    }
  }
  let G = vec2i(round(Lv.xy / Lv.z)) + vec2i(g);
  textureStore(cacheOut, ((G % ${SIDE}) + ${SIDE}) % ${SIDE}, i32(lvl), vec4f(h, n.x, n.z, sh));
}
`;

const terrainVS = cacheLib + /* wgsl */ `

struct TV {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) misc: vec4f, // horizon shadow, canopy shell factor, forest, unused
  @location(3) region: vec2f, // dry / volcanic (large scale, so per vertex is plenty)
};

// Grid vertex from vertex_index: draws pass level * SIDE^2 as base vertex, so
// no vertex buffer (and no first-instance support) is needed.
fn gridPoint(vi: u32) -> vec3f {
  let lvl = vi / ${SIDE * SIDE}u;
  let k = vi - lvl * ${SIDE * SIDE}u;
  return vec3f(f32(k % ${SIDE}u) - ${GRID_M}.0, f32(k / ${SIDE}u) - ${GRID_M}.0, f32(lvl));
}

fn terrainVertex(g: vec2f, lvl: u32) -> TV {
  let Lv = F.levels[lvl];
  let a = max(abs(g.x), abs(g.y)) / ${GRID_M}.0;
  var morph = smoothstep(0.70, 0.90, a);
  if (Lv.w > 0.5) { morph = 0.0; }
  let odd = g - 2.0 * floor(g * 0.5);
  let t0 = cacheFetch(lvl, vec2i(g));
  let t1 = cacheFetch(lvl, vec2i(g - odd));
  let tt = mix(t0, t1, morph);
  let gm = g - odd * morph;
  let xz = Lv.xy + gm * Lv.z;
  var h = tt.x;
  let nxz = tt.yz;
  let n = vec3f(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
  var rel = vec3f(xz.x - F.camPos.x, h - F.camPos.y, xz.y - F.camPos.z);
  let dist = length(rel.xz);
  let rg = region(xz);
  let forest = smoothstep(-0.28, 0.05, fbm(xz, 64, 3, 97u)) * (1.0 - 0.75 * rg.x) * smoothstep(3.5, 9.0, h);
  // beyond the scattered trees the forest becomes a raised, lumpy canopy shell
  let shell = smoothstep(F.fx.z * 0.54, F.fx.z * 1.03, dist);
  let lump = 0.75 + 0.5 * gnoise(xz * (1024.0 / W), 1024, 191u);
  rel.y += shell * forest * 17.0 * lump;
  var o: TV;
  o.rel = rel;
  o.n = n;
  o.misc = vec4f(select(1.0, tt.w, lvl >= 2u), shell, forest, 0.0);
  o.region = rg;
  return o;
}
`;

export const terrainWGSL = frameStruct + commonLib + shadowLib + terrainVS + /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) vi: u32) -> TV {
  let gp = gridPoint(vi);
  var o = terrainVertex(gp.xy, u32(gp.z));
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  return o;
}

@fragment fn fs(in: TV) -> @location(0) vec4f {
  let pw = in.rel + F.camPos.xyz;
  let h = pw.y;
  let dist = length(in.rel);
  var n = normalize(in.n);
  let near = 1.0 - smoothstep(30.0, 160.0, dist);
  // micro relief
  let q = pw.xz * (4096.0 / W);
  let d1 = vec2f(gnoise(q, 4096, 201u), gnoise(q + 17.0, 4096, 203u));
  let d2 = vec2f(gnoise(q * 4.0, 16384, 205u), gnoise(q * 4.0 + 9.0, 16384, 207u));
  n = normalize(n + vec3f(d1.x + d2.x * 0.5, 0.0, d1.y + d2.y * 0.5) * 0.35 * near);
  // distant rainforest: per-pixel tree crowns (bumps that catch the light, dark gaps between)
  let crownW = in.misc.z * smoothstep(120.0, 450.0, dist) * smoothstep(-0.5, 3.0, h);
  var crownShade = 1.0;
  if (crownW > 0.01) {
    let cq = pw.xz * (2048.0 / W);
    let c0 = gnoise(cq, 2048, 231u) + 0.5 * gnoise(cq * 2.0, 4096, 233u);
    let cx = gnoise(cq + vec2f(0.12, 0.0), 2048, 231u) + 0.5 * gnoise(cq * 2.0 + vec2f(0.24, 0.0), 4096, 233u);
    let cz = gnoise(cq + vec2f(0.0, 0.12), 2048, 231u) + 0.5 * gnoise(cq * 2.0 + vec2f(0.0, 0.24), 4096, 233u);
    n = normalize(n - vec3f(cx - c0, 0.0, cz - c0) * 9.0 * crownW);
    crownShade = mix(1.0, 0.45 + 0.9 * smoothstep(-0.4, 0.5, c0), crownW);
  }
  let slope = 1.0 - n.y;
  let shell = in.misc.y;
  let forest = in.misc.z;

  let mn = fbm(pw.xz, 2048, 3, 211u);
  let big = fbm(pw.xz, 256, 3, 213u);
  // palette
  // palette shifts with the island's character
  let rg = in.region;
  let sandTone = mix(mix(vec3f(0.86, 0.80, 0.66), vec3f(0.80, 0.66, 0.44), rg.x), vec3f(0.16, 0.15, 0.15), rg.y);
  let sand = sandTone * (0.92 + 0.16 * mn);
  let wetSand = sandTone * vec3f(0.55, 0.53, 0.52);
  let uwSand = mix(vec3f(0.80, 0.75, 0.62), vec3f(0.30, 0.28, 0.27), rg.y * 0.8) * (0.9 + 0.2 * mn);
  var grass = mix(vec3f(0.11, 0.17, 0.05), vec3f(0.20, 0.22, 0.08), sat(big * 2.0 + 0.5));
  grass = mix(grass, mix(vec3f(0.36, 0.30, 0.13), vec3f(0.27, 0.27, 0.12), sat(big * 2.0 + 0.5)), rg.x);
  // near the camera, break the lawn up with leaf litter and bare soil
  let litter = smoothstep(-0.05, 0.25, gnoise(pw.xz * (4096.0 / W), 4096, 241u) + 0.5 * gnoise(pw.xz * (16384.0 / W), 16384, 243u));
  grass = mix(grass, mix(vec3f(0.20, 0.15, 0.08), vec3f(0.14, 0.15, 0.06), mn + 0.5), litter * 0.55);
  let floorC = mix(vec3f(0.17, 0.12, 0.07), vec3f(0.12, 0.17, 0.05), sat(mn * 2.0 + 0.5));
  let rock = mix(mix(vec3f(0.30, 0.27, 0.24), vec3f(0.22, 0.20, 0.19), sat(mn * 2.0 + 0.5)), vec3f(0.09, 0.085, 0.085), rg.y);
  let canopy = mix(vec3f(0.035, 0.09, 0.025), vec3f(0.09, 0.16, 0.04), sat(gnoise(pw.xz * (2048.0 / W), 2048, 217u) * 1.6 + 0.5));

  let beachH = 2.2 + mn * 1.2 + big * 0.8;
  var alb: vec3f;
  if (h < -0.4) {
    let reef = reefMask(pw.xz);
    alb = mix(uwSand, uwSand * vec3f(0.65, 0.6, 0.55), reef * 0.6);
    alb = mix(alb, rock * 0.8, smoothstep(0.35, 0.6, slope));
  } else {
    let landW = smoothstep(beachH - 0.4, beachH + 0.6, h);
    let wet = 1.0 - smoothstep(0.1, 0.9, h);
    var land = mix(grass, floorC, forest * (1.0 - shell) * 0.9);
    land = mix(land, canopy, sat(shell * forest * 1.2));
    land = mix(land, rock, smoothstep(0.42, 0.62, slope + mn * 0.2));
    land = mix(land, rock * 1.1, smoothstep(160.0, 260.0, h + big * 40.0) * 0.7);
    alb = mix(mix(sand, wetSand, wet), land, landW);
  }

  let rd = in.rel / max(dist, 1e-4);
  let V = -rd;
  let L = F.lightDir.xyz;
  var sh = min(shadowAt(in.rel, n, in.pos.xy), in.misc.x) * cloudShadow(pw);
  let nl = max(dot(n, L), 0.0);
  let ao = 1.0 - 0.3 * forest * (1.0 - shell) * smoothstep(1.0, 5.0, h);
  var col = alb * crownShade * (lightAt(pw) * nl * sh + ambientAt(n, pw) * ao);
  // wet sand sheen
  let wetS = (1.0 - smoothstep(0.0, 0.7, h)) * step(-0.4, h);
  col += lightAt(pw) * ggx(n, V, L, 0.25) * wetS * 0.25 * sh;
  // canopy translucency glow at grazing light (far forest)
  col += canopy * F.lightColor.rgb * pow(max(dot(-rd, -L), 0.0), 3.0) * shell * forest * 0.6 * sh;
  col = applyFog(col, in.rel);
  return vec4f(col, 1.0);
}
`;

export const terrainShadowWGSL = frameStruct + commonLib + terrainVS + /* wgsl */ `
struct Cascade { vp: mat4x4f };
@group(1) @binding(0) var<uniform> CS: Cascade;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let gp = gridPoint(vi);
  let o = terrainVertex(gp.xy, u32(gp.z));
  return CS.vp * vec4f(o.rel, 1.0);
}
`;

// Cluster culling: one workgroup per terrain tile finds the tile's exact height
// range in the cache and tests the box against the frustum and last frame's
// depth pyramid. Visible tiles append their indices (made absolute: the level
// is folded into the vertex index) to one compact list, so the whole terrain,
// and the water on the same grid, is a single indexed indirect draw.
export const terrainCullWGSL = frameStruct + commonLib + hizLib + cacheLib + /* wgsl */ `
struct Cluster { first: u32, count: u32, level: u32, tile: u32 };
@group(1) @binding(0) var<storage, read> clusters: array<Cluster>;
@group(1) @binding(1) var<storage, read_write> args: array<atomic<u32>>; // indexed indirect args, cleared each frame
@group(1) @binding(2) var hiz: texture_2d<f32>;
@group(1) @binding(3) var<storage, read> gridIdx: array<u32>;
@group(1) @binding(4) var<storage, read_write> drawIdx: array<u32>;
var<workgroup> lo: array<f32, 64>;
var<workgroup> hi: array<f32, 64>;
var<workgroup> dst: u32;
const T: u32 = ${TILE}u;
const HIDDEN: u32 = 0xffffffffu;

fn tileVisible(cl: Cluster, t0: vec2u, hmin: f32, hmax: f32) -> bool {
  let Lv = F.levels[cl.level];
  // waves (the water uses the same tiles) and the raised canopy shell
  let y0 = min(hmin, -3.0) - 1.0;
  let y1 = max(hmax, 3.0) + 23.0;
  let x0 = Lv.xy + (vec2f(t0) - ${GRID_M}.0) * Lv.z - F.camPos.xz;
  let x1 = x0 + f32(T) * Lv.z;
  let c = vec3f((x0.x + x1.x) * 0.5, (y0 + y1) * 0.5 - F.camPos.y, (x0.y + x1.y) * 0.5);
  let e = vec3f((x1.x - x0.x) * 0.5, (y1 - y0) * 0.5, (x1.y - x0.y) * 0.5);
  for (var i = 0; i < 6; i++) {
    let pl = F.frustum[i];
    if (dot(pl.xyz, c) + dot(abs(pl.xyz), e) + pl.w < 0.0) { return false; }
  }
  // demand clearance: a wrongly hidden tile would leave a hole, not a missing plant
  return !occludedBox(hiz, c, e, 1.05);
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let cl = clusters[wg.x];
  let t0 = vec2u(cl.tile % ${TILES}u, cl.tile / ${TILES}u) * T;
  var mn = 1e9; var mx = -1e9;
  for (var i = li; i < (T + 1u) * (T + 1u); i += 64u) {
    let g = vec2i(t0 + vec2u(i % (T + 1u), i / (T + 1u))) - ${GRID_M};
    let h = cacheFetch(cl.level, g).x;
    mn = min(mn, h); mx = max(mx, h);
  }
  lo[li] = mn; hi[li] = mx;
  for (var s = 32u; s > 0u; s >>= 1u) {
    workgroupBarrier();
    if (li < s) { lo[li] = min(lo[li], lo[li + s]); hi[li] = max(hi[li], hi[li + s]); }
  }
  if (li == 0u) {
    dst = HIDDEN;
    if (cl.count > 0u && tileVisible(cl, t0, lo[0], hi[0])) {
      dst = atomicAdd(&args[0], cl.count);
      atomicStore(&args[1], 1u);
    }
  }
  let base = workgroupUniformLoad(&dst);
  if (base == HIDDEN) { return; }
  let vbase = cl.level * ${SIDE * SIDE}u;
  for (var i = li; i < cl.count; i += 64u) { drawIdx[base + i] = gridIdx[cl.first + i] + vbase; }
}
`;
