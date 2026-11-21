import { frameStruct, commonLib, shadowLib, hizLib, LEVELS } from './common.js';
import { shoreLib } from './shore.js';
import { groundSampleLib, groundShadingLib } from './ground.js';
import { GROUND_COUNT } from './materials.js';

export const GRID_M = 96; // half-size of a clipmap level in cells
export const SIDE = GRID_M * 2 + 1; // vertices per level side
export const TILES = 4; // each level is split into TILES x TILES clusters for culling
export const TILE = (GRID_M * 2) / TILES;
// cache layers: one per level with (height, normal x, normal z, horizon shadow),
// then one per level with the ground's shape (horizon occlusion, curvature)
export const CACHE_LAYERS = LEVELS * 2;

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
// x: sky visibility (horizon based occlusion), y: curvature (1/m, > 0 in hollows)
fn cacheShape(lvl: u32, g: vec2i) -> vec2f { return textureLoad(cacheTex, cacheTexel(lvl, g), lvl + ${LEVELS}u, 0).xy; }

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
export const terrainCacheWGSL =
  frameStruct +
  commonLib +
  /* wgsl */ `
@group(0) @binding(1) var cacheOut: texture_storage_2d_array<rgba32float, write>;
struct Bake {
  prev: array<vec4f, ${LEVELS}>, // xy previous level centre, z mode (0 keep, 1 new texels, 2 everything)
  band: vec4f,                   // refresh: x level, rows [y, z)
};
@group(0) @binding(6) var<uniform> B: Bake;

// texels the level's window did not cover before (or all, after a reset)
fn isNew(lvl: u32, g: vec2f) -> bool {
  let pv = B.prev[lvl];
  if (pv.z > 1.5) { return true; }
  if (pv.z < 0.5) { return false; }
  let old = round((F.levels[lvl].xy - pv.xy) / F.levels[lvl].z) + g; // the same point in the previous window
  return any(abs(old) > vec2f(${GRID_M}.0));
}
// rows whose sun-dependent shadow is refreshed this frame
fn inBand(lvl: u32, row: u32) -> bool {
  return u32(B.band.x) == lvl && f32(row) >= B.band.y && f32(row) < B.band.z;
}

fn horizonShadow(p: vec2f, h: f32, spacing: f32) -> f32 {
  let L = F.lightDir.xyz;
  if (L.y < -0.05) { return 1.0; }
  var sh = 1.0;
  let dir = normalize(L.xz + vec2f(1e-5));
  let slope = L.y / max(length(L.xz), 1e-3);
  var t = spacing * 2.0;
  for (var i = 0; i < 12; i++) {
    let q = p + dir * t;
    let th = baseHeight(q);
    let ry = max(h, 0.0) + 2.0 + t * slope;
    sh = min(sh, sat((ry - th) / (t * 0.06) + 0.5));
    t *= 1.55;
    if (t > 4000.0 || sh < 0.01) { break; }
  }
  return sh;
}

// Sky visibility from the horizon in 6 directions, out to ~15 grid cells.
fn horizonOcclusion(p: vec2f, h: f32, spacing: f32) -> f32 {
  var vis = 0.0;
  for (var d = 0; d < 6; d++) {
    let a = f32(d) * (TAU / 6.0) + 0.3;
    let dir = vec2f(cos(a), sin(a));
    var t = max(spacing, 0.5) * 2.0;
    var top = 0.0;
    for (var i = 0; i < 4; i++) {
      top = max(top, (terrainHeight(p + dir * t) - h) / t);
      t *= 2.0;
    }
    vis += 1.0 - top / sqrt(1.0 + top * top); // 1 - sin(horizon elevation)
  }
  return vis / 6.0;
}

// Laplacian of the height over a few metres: > 0 in hollows, < 0 on ridges.
fn curvature(p: vec2f, h: f32, spacing: f32) -> f32 {
  let r = max(spacing * 2.0, 3.0);
  let s = terrainHeight(p + vec2f(r, 0.0)) + terrainHeight(p - vec2f(r, 0.0))
        + terrainHeight(p + vec2f(0.0, r)) + terrainHeight(p - vec2f(0.0, r));
  return (s - 4.0 * h) / (r * r);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let lvl = gid.z;
  if (gid.x > ${GRID_M * 2}u || gid.y > ${GRID_M * 2}u) { return; }
  let g = vec2f(f32(gid.x), f32(gid.y)) - ${GRID_M}.0;
  let fresh = isNew(lvl, g);
  if (!fresh && !inBand(lvl, gid.y)) { return; }
  let Lv = F.levels[lvl];
  let p = Lv.xy + g * Lv.z;
  let h = terrainHeight(p);
  let e = max(Lv.z, 0.35);
  let hx0 = terrainHeight(p - vec2f(e, 0.0));
  let hx1 = terrainHeight(p + vec2f(e, 0.0));
  let hz0 = terrainHeight(p - vec2f(0.0, e));
  let hz1 = terrainHeight(p + vec2f(0.0, e));
  let n = normalize(vec3f(hx0 - hx1, 2.0 * e, hz0 - hz1));
  let sh = select(1.0, horizonShadow(p, h, Lv.z), lvl >= 2u);
  let G = vec2i(round(Lv.xy / Lv.z)) + vec2i(g);
  let texel = ((G % ${SIDE}) + ${SIDE}) % ${SIDE};
  textureStore(cacheOut, texel, i32(lvl), vec4f(h, n.x, n.z, sh));
  // the shape does not depend on the sun: only new texels need it
  if (fresh) {
    textureStore(cacheOut, texel, i32(lvl + ${LEVELS}u), vec4f(horizonOcclusion(p, h, Lv.z), curvature(p, h, Lv.z), 0.0, 0.0));
  }
}
`;

const terrainVS =
  cacheLib +
  /* wgsl */ `

struct TV {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) misc: vec4f, // horizon shadow, canopy shell factor, forest, unused
  @location(3) region: vec2f, // dry / volcanic (large scale, so per vertex is plenty)
  @location(4) shape: vec2f,  // sky visibility, curvature (from the cache)
};

// Grid vertex from vertex_index: indices carry the level (level * SIDE^2 +
// local index), so no vertex buffer is needed.
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
  let shape = mix(cacheShape(lvl, vec2i(g)), cacheShape(lvl, vec2i(g - odd)), morph);
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
  o.shape = shape;
  return o;
}
`;

// Ground materials blended from slope, curvature, height and region; at most
// two per pixel (see ground.js for the texture budget).
const groundChoice = /* wgsl */ `
struct Pick { m0: u32, m1: u32, w0: f32, w1: f32 };
// the two strongest of the material weights, renormalised
fn pickTwo(w: array<f32, ${GROUND_COUNT}>) -> Pick {
  var a = 0u; var b = 1u;
  if (w[1] > w[0]) { a = 1u; b = 0u; }
  for (var i = 2u; i < GROUND_COUNT; i++) {
    if (w[i] > w[a]) { b = a; a = i; } else if (w[i] > w[b]) { b = i; }
  }
  let s = max(w[a] + w[b], 1e-5);
  return Pick(a, b, w[a] / s, w[b] / s);
}
fn isRocky(m: u32) -> bool { return m == G_ROCK || m == G_BASALT; }
`;

export const terrainWGSL =
  frameStruct +
  commonLib +
  shadowLib +
  terrainVS +
  shoreLib +
  groundSampleLib +
  groundShadingLib +
  groundChoice +
  /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) vi: u32) -> TV {
  let gp = gridPoint(vi);
  var o = terrainVertex(gp.xy, u32(gp.z));
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  return o;
}

@fragment fn fs(in: TV) -> @location(0) vec4f {
  // screen derivatives for texture filtering, before any branching
  let pw = in.rel + F.camPos.xyz;
  let dpx = dpdx(pw);
  let dpy = dpdy(pw);
  let h = pw.y;
  let dist = length(in.rel);
  var n = normalize(in.n);
  let rg = in.region;
  let skyVis = in.shape.x;
  let curv = in.shape.y;
  let shell = in.misc.y;
  let forest = in.misc.z;

  // distant rainforest: per-pixel tree crowns (bumps that catch the light, dark gaps between)
  // (materials are chosen from the true slope, before the crown bumps below)
  let slope = 1.0 - n.y;
  let crownW = forest * smoothstep(120.0, 450.0, dist) * smoothstep(-0.5, 3.0, h);
  var crownShade = 1.0;
  if (crownW > 0.01) {
    let cq = pw.xz * (2048.0 / W);
    let c0 = gnoise(cq, 2048, 231u) + 0.5 * gnoise(cq * 2.0, 4096, 233u);
    let cx = gnoise(cq + vec2f(0.12, 0.0), 2048, 231u) + 0.5 * gnoise(cq * 2.0 + vec2f(0.24, 0.0), 4096, 233u);
    let cz = gnoise(cq + vec2f(0.0, 0.12), 2048, 231u) + 0.5 * gnoise(cq * 2.0 + vec2f(0.0, 0.24), 4096, 233u);
    n = normalize(n - vec3f(cx - c0, 0.0, cz - c0) * 9.0 * crownW);
    crownShade = mix(1.0, 0.45 + 0.9 * smoothstep(-0.4, 0.5, c0), crownW);
  }
  // low-frequency variation: metres (mn), tens of metres (big), half a kilometre (macroV)
  let mn = fbm(pw.xz, 2048, 2, 211u);
  let big = fbm(pw.xz, 256, 3, 213u);
  let macroV = fbm(pw.xz, 32, 3, 215u);

  let beachH = 2.2 + mn * 1.2 + big * 0.8;
  let swash = swashAt(pw.xz, h);
  // footprints on the dry sand near the camera (the swash washes them away)
  let sandy = (1.0 - smoothstep(beachH - 0.8, beachH - 0.3, h)) * smoothstep(-0.2, 0.3, h) * (1.0 - rg.y);
  var printK = 0.0;
  if (dist < 70.0 && sandy > 0.0 && abs(pw.x - pathX(pw.z) - 2.2) < 1.5) {
    let fp = footprints(pw.xz);
    let k = sandy * (1.0 - swash.wet) * (1.0 - smoothstep(35.0, 70.0, dist));
    n = normalize(n + vec3f(fp.x, 0.0, fp.y) * k * 1.6);
    printK = fp.z * k;
  }

  // ---- material weights
  let underwater = h < -0.4;
  let convex = sat(-curv * 6.0);
  let hollow = sat(curv * 6.0);
  var w: array<f32, ${GROUND_COUNT}>;
  let landW = select(smoothstep(beachH - 0.4, beachH + 0.6, h), 0.0, underwater);
  let beach = 1.0 - landW;
  // tropical hillsides stay green under forest; only cliffs and the highest peaks are bare
  let rockness = sat(smoothstep(0.42 + 0.2 * forest, 0.62 + 0.2 * forest, slope + mn * 0.2 + convex * 0.25 - hollow * 0.2)
                   + smoothstep(160.0, 260.0, h + big * 40.0) * 0.7);
  let rockOnShore = smoothstep(0.35, 0.6, slope);
  w[G_SAND] = beach * (1.0 - rg.y) * (1.0 - rockOnShore);
  w[G_BLACK_SAND] = beach * rg.y * (1.0 - rockOnShore);
  let floorK = sat(forest * (1.0 - shell) * 0.9 + hollow * 0.4);
  w[G_GRASS] = landW * (1.0 - rockness) * (1.0 - floorK);
  w[G_LITTER] = landW * (1.0 - rockness) * floorK;
  let rocky = max(landW * rockness, beach * rockOnShore);
  w[G_ROCK] = rocky * (1.0 - rg.y);
  w[G_BASALT] = rocky * rg.y;
  let pick = pickTwo(w);

  // ---- sample the two materials and blend them by height
  let k = sat(gnoise(pw.xz * (1024.0 / W), 1024, 219u) * 0.7 + 0.5); // tile variant index
  let s0 = groundSurface(pick.m0, pw, n, dpx, dpy, k, isRocky(pick.m0) && n.y < 0.85);
  var g = s0;
  if (pick.w1 > 0.01) {
    let s1 = groundSurface(pick.m1, pw, n, dpx, dpy, k, isRocky(pick.m1) && n.y < 0.85);
    g = blendSurf(s0, s1, heightBlend(s0.h, pick.w0, s1.h, pick.w1));
  }

  // ---- colour variation by region and over large distances
  var alb = g.alb;
  let sandiness = (w[G_SAND] + w[G_BLACK_SAND]) / max(w[G_SAND] + w[G_BLACK_SAND] + w[G_GRASS] + w[G_LITTER] + w[G_ROCK] + w[G_BASALT], 1e-5);
  alb *= mix(vec3f(1.0), vec3f(0.93, 0.825, 0.667), rg.x * sandiness);           // golden sand on the dry side
  let grassiness = w[G_GRASS] / max(w[G_GRASS] + w[G_LITTER] + w[G_ROCK] + w[G_BASALT] + w[G_SAND], 1e-5);
  alb = mix(alb, luma(alb) * vec3f(1.6, 1.3, 0.62), rg.x * grassiness * 0.75);   // dry golden grass
  alb *= mix(vec3f(0.92, 1.0, 0.9), vec3f(1.06, 0.97, 0.9), sat(macroV * 2.0 + 0.5)) * (0.9 + 0.2 * sat(big * 2.0 + 0.5));
  if (underwater) {
    alb = mix(alb, alb * vec3f(0.65, 0.6, 0.55), reefMask(pw.xz) * 0.6);
  }
  // far forest: the raised canopy shell
  let canopy = mix(vec3f(0.035, 0.09, 0.025), vec3f(0.09, 0.16, 0.04), sat(gnoise(pw.xz * (2048.0 / W), 2048, 217u) * 1.6 + 0.5));
  let canopyW = sat(shell * forest * 1.2) * landW;
  alb = mix(alb, canopy, canopyW);
  var rough = mix(g.rough, 0.8, canopyW);
  n = normalize(mix(g.n, n, canopyW));

  // ---- wetness: the swash on the beach, and rain soaking in (most in hollows)
  let rain = F.fx.w * select(1.0, 0.0, underwater) * (1.0 - 0.6 * forest * (1.0 - shell));
  var wet = max(max(swash.wet * step(-0.4, h), printK * 0.4), rain * (0.55 + 0.45 * hollow));
  let porous = sandiness;
  alb *= mix(1.0, mix(0.72, 0.5, porous), wet);
  rough = mix(rough, mix(0.2, 0.3, porous), wet);
  // puddles in flat hollows after heavy rain
  let puddle = smoothstep(0.55, 0.9, rain) * smoothstep(0.01, 0.06, curv) * smoothstep(0.9, 0.98, n.y) * (1.0 - smoothstep(0.35, 0.55, g.h));
  n = normalize(mix(n, normalize(in.n), puddle));
  rough = mix(rough, 0.04, puddle);
  alb *= 1.0 - 0.35 * puddle;

  // ---- light: occlusion from the material, the surrounding terrain and its hollows
  let cavity = clamp(1.0 - curv * 3.0, 0.6, 1.1);
  let forestAO = 1.0 - 0.3 * forest * (1.0 - shell) * smoothstep(1.0, 5.0, h);
  let ao = g.ao * mix(1.0, skyVis, 0.85) * cavity * forestAO;
  let sh = min(shadowAt(in.rel, n, in.pos.xy), in.misc.x) * cloudShadow(pw);
  var col = shadeGround(alb * crownShade, n, rough, in.rel, GroundLight(sh, ao));

  // the thin sheet of a running-up wave with its foam edge
  let V = -in.rel / max(dist, 1e-4);
  let L = F.lightDir.xyz;
  if (swash.sheet > 0.0 && h > -0.4) {
    let nf = normalize(mix(n, vec3f(0.0, 1.0, 0.0), 0.8));
    let fres = 0.02 + 0.98 * pow(1.0 - max(dot(nf, V), 0.0), 5.0);
    col = mix(col, col * vec3f(0.75, 0.88, 0.9), swash.sheet * 0.5);
    col += (skyBase(reflect(-V, nf)) * fres + lightAt(pw) * ggx(nf, V, L, 0.08) * sh) * swash.sheet * 0.8;
    let foam = swash.edge * smoothstep(0.35, 0.65, gnoise(pw.xz * (16384.0 / W) * 2.0, 32768, 331u) + 0.5);
    col = mix(col, (lightAt(pw) * max(L.y, 0.0) * sh + ambientAt(vec3f(0.0, 1.0, 0.0), pw)) * 0.8, foam * 0.8);
  }
  // canopy translucency glow at grazing light (far forest)
  col += canopy * F.lightColor.rgb * pow(max(dot(V, -L), 0.0), 3.0) * shell * forest * 0.6 * sh;
  col = applyFog(col, in.rel);
  return vec4f(col, 1.0);
}
`;

export const terrainShadowWGSL =
  frameStruct +
  commonLib +
  terrainVS +
  /* wgsl */ `
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
export const terrainCullWGSL =
  frameStruct +
  commonLib +
  hizLib +
  cacheLib +
  /* wgsl */ `
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
