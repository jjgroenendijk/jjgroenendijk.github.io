// Ground materials, generated on the GPU at start-up (there are no image
// files): each material is a seamlessly tiling patch, stored in two texture
// arrays with full mip chains:
//   A: albedo (stored as sqrt, i.e. gamma 2, for 8-bit precision) + height
//   B: tangent-space normal xy + roughness + ambient occlusion
// The height channel drives height-based blending between materials.
import { noiseLib } from './common.js';

export const MAT_TEX = 512; // texels per side
// id, metres covered by one tile (a power of two so it tiles the 16 km world),
// relief depth in metres (scales the baked normals)
export const GROUND = {
  sand: { id: 0, tile: 4, depth: 0.025 },
  blackSand: { id: 1, tile: 4, depth: 0.025 },
  grass: { id: 2, tile: 2, depth: 0.05 },
  litter: { id: 3, tile: 4, depth: 0.03 },
  rock: { id: 4, tile: 8, depth: 0.35 },
  basalt: { id: 5, tile: 4, depth: 0.12 },
};
export const GROUND_COUNT = Object.keys(GROUND).length;
const list = Object.values(GROUND).sort((a, b) => a.id - b.id);
const arr = (k) => `array<f32, ${GROUND_COUNT}>(${list.map((m) => m[k].toFixed(4)).join(', ')})`;

// shared by the bake and the terrain shader
export const groundLib = /* wgsl */ `
const GROUND_COUNT: u32 = ${GROUND_COUNT}u;
const G_SAND: u32 = ${GROUND.sand.id}u;
const G_BLACK_SAND: u32 = ${GROUND.blackSand.id}u;
const G_GRASS: u32 = ${GROUND.grass.id}u;
const G_LITTER: u32 = ${GROUND.litter.id}u;
const G_ROCK: u32 = ${GROUND.rock.id}u;
const G_BASALT: u32 = ${GROUND.basalt.id}u;
var<private> GROUND_TILE: array<f32, ${GROUND_COUNT}> = ${arr('tile')};
var<private> GROUND_DEPTH: array<f32, ${GROUND_COUNT}> = ${arr('depth')};
`;

// ---------------------------------------------------------------- generation
const patterns = /* wgsl */ `
struct Mat { alb: vec3f, h: f32, rough: f32 };

// periodic noise over the unit tile
fn pn(u: vec2f, per: i32, seed: u32) -> f32 { return gnoise(u * f32(per), per, seed); }
fn pfbm(u: vec2f, per0: i32, oct: i32, seed: u32) -> f32 {
  var s = 0.0; var a = 0.5; var per = per0;
  for (var i = 0; i < oct; i++) { s += a * pn(u, per, seed + u32(i) * 101u); per *= 2; a *= 0.5; }
  return s;
}
fn rot2(v: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * v.x - s * v.y, s * v.x + c * v.y); }

// jittered cells on an n x n wrapped grid: distances in cell units
struct Cell { f1: f32, f2: f32, id: u32, d: vec2f };
fn cells(u: vec2f, n: i32, seed: u32) -> Cell {
  let p = u * f32(n);
  let c = vec2i(floor(p));
  var o = Cell(9.0, 9.0, 0u, vec2f(0.0));
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cc = c + vec2i(i, j);
      let id = hashu(u32(wrapi(cc.x, n)) + hashu(u32(wrapi(cc.y, n)) + seed));
      let d = p - (vec2f(cc) + vec2f(hf(id), hf(id + 7u)) * 0.8 + 0.1);
      let l = length(d);
      if (l < o.f1) { o.f2 = o.f1; o.f1 = l; o.id = id; o.d = d; }
      else if (l < o.f2) { o.f2 = l; }
    }
  }
  return o;
}

fn sandMat(u: vec2f, black: bool) -> Mat {
  // wind ripples (asymmetric: gentle windward, steep lee side), wandering a little
  let warp = pfbm(u, 4, 3, 11u);
  let rp = fract(u.x * 24.0 + u.y * 6.0 + warp * 3.0);
  let ripple = smoothstep(0.0, 0.75, rp) * (1.0 - smoothstep(0.75, 1.0, rp));
  let amp = sat(0.55 + pfbm(u, 2, 2, 13u) * 1.5);
  let grain = pn(u, 512, 17u) * 0.5 + pn(u, 256, 19u) * 0.5;
  let c = cells(u, 160, 23u);
  let hc = hf(c.id);
  var h = 0.3 + 0.38 * ripple * amp + 0.2 * pfbm(u, 16, 3, 29u) + 0.06 * grain + 0.05 * sat(1.0 - c.f1 * 2.0);
  var alb: vec3f;
  if (black) {
    alb = vec3f(0.075, 0.07, 0.068) * (0.85 + 0.3 * sat(pfbm(u, 8, 2, 31u) + 0.5));
    if (hc < 0.15 && c.f1 < 0.4) { alb = vec3f(0.16, 0.17, 0.11); }       // olivine grains
  } else {
    alb = vec3f(0.80, 0.74, 0.60) * (0.9 + 0.14 * sat(pfbm(u, 8, 2, 31u) + 0.5));
    if (hc < 0.10 && c.f1 < 0.35) { alb = vec3f(0.33, 0.29, 0.25); }      // dark mineral grains
    if (hc > 0.97 && c.f1 < 0.45) { alb = vec3f(0.93, 0.90, 0.84); h += 0.05; } // shell fragments
  }
  alb *= 0.93 + 0.07 * ripple;
  return Mat(alb, sat(h), select(0.9, 0.8, black));
}

fn grassMat(u: vec2f) -> Mat {
  // tufts on a warped lattice, so they do not read as cells
  let wu = u + vec2f(pfbm(u, 8, 2, 37u), pfbm(u, 8, 2, 39u)) * 0.05;
  let c = cells(wu, 28, 41u);
  let tuft = sat(1.0 - c.f1 * 0.9);
  let q = rot2(c.d, hf(c.id) * TAU);
  // blades: thin streaks along the tuft's lean
  let blades = 0.5 + 0.5 * sin(q.y * 34.0 + pn(u, 64, 43u) * 6.0 + q.x * 3.0);
  let h = sat(tuft * (0.5 + 0.5 * blades) + 0.2 * pfbm(u, 8, 2, 47u) + 0.12);
  let soil = vec3f(0.19, 0.14, 0.09) * (0.8 + 0.4 * sat(pfbm(u, 32, 2, 49u) + 0.5));
  let tone = 0.35 * hf(c.id + 1u) + 0.65 * sat(pfbm(u, 4, 3, 45u) * 1.4 + 0.5);
  let green = mix(vec3f(0.10, 0.19, 0.04), vec3f(0.25, 0.30, 0.09), tone);
  let alb = mix(soil, green * (0.7 + 0.5 * h), smoothstep(0.12, 0.32, h));
  return Mat(alb, h, mix(0.9, 0.75, h));
}

fn leafColor(k: f32) -> vec3f {
  if (k < 0.3) { return vec3f(0.30, 0.18, 0.08); }
  if (k < 0.5) { return vec3f(0.42, 0.30, 0.12); }
  if (k < 0.65) { return vec3f(0.28, 0.11, 0.06); }
  if (k < 0.85) { return vec3f(0.22, 0.18, 0.13); }
  return vec3f(0.19, 0.21, 0.08);
}

fn litterMat(u: vec2f) -> Mat {
  var alb = vec3f(0.12, 0.09, 0.06) * (0.8 + 0.4 * sat(pfbm(u, 16, 2, 51u) + 0.5));
  var h = 0.1 + 0.1 * pfbm(u, 16, 2, 53u);
  var rough = 0.85;
  // three overlapping layers of fallen leaves, the upper ones on top
  for (var layer = 0u; layer < 3u; layer++) {
    let n = i32(12u + layer * 5u);
    let c = cells(u, n, 57u + layer * 13u);
    let q = rot2(c.d, hf(c.id + 3u) * TAU);
    let size = 0.75 + 0.5 * hf(c.id + 4u);
    let e = length(q / (vec2f(0.55, 0.26) * size));
    if (e < 1.0 && hf(c.id + 5u) > 0.15) {
      let rib = smoothstep(0.035, 0.0, abs(q.y)) * 0.25;
      alb = leafColor(hf(c.id + 6u)) * (0.8 + 0.35 * (1.0 - e)) * (1.0 - rib);
      h = 0.35 + f32(layer) * 0.2 + (1.0 - e) * 0.08 - rib * 0.1;
      rough = 0.7;
    }
  }
  // twigs
  let t = cells(u, 6, 71u);
  let dir = rot2(vec2f(1.0, 0.0), hf(t.id) * TAU);
  let along = dot(t.d, dir);
  let across = abs(dot(t.d, vec2f(-dir.y, dir.x)));
  if (hf(t.id + 1u) > 0.4 && abs(along) < 0.7 && across < 0.035) {
    alb = vec3f(0.17, 0.11, 0.07);
    h = 0.95 - across * 4.0;
    rough = 0.8;
  }
  return Mat(alb, sat(h), rough);
}

fn rockMat(u: vec2f) -> Mat {
  let base = pfbm(u, 4, 5, 61u);
  let strata = sin((u.y * 6.0 + base * 1.5) * TAU);
  // irregular, broken joints: warped cells, cracks that fade in and out
  let wu = u + vec2f(pfbm(u, 4, 3, 63u), pfbm(u, 4, 3, 65u)) * 0.12;
  let cr = cells(wu, 5, 67u);
  let cr2 = cells(wu * 1.0 + 0.37, 11, 69u);
  let open = smoothstep(-0.05, 0.2, pfbm(u, 8, 3, 75u));
  let crack = max((1.0 - smoothstep(0.0, 0.05, cr.f2 - cr.f1)) * open,
                  (1.0 - smoothstep(0.0, 0.03, cr2.f2 - cr2.f1)) * open * 0.5);
  let fine = pfbm(u, 64, 3, 71u);
  let h = sat(0.55 + base * 0.6 + strata * 0.05 + fine * 0.15 - crack * 0.35);
  var alb = mix(vec3f(0.25, 0.23, 0.21), vec3f(0.42, 0.39, 0.35), sat(base * 1.5 + 0.5)) * (0.9 + 0.25 * fine);
  alb *= 1.0 - crack * 0.45;
  // lichen patches on the exposed faces
  let lc = cells(u + vec2f(pfbm(u, 16, 2, 77u)) * 0.03, 24, 73u);
  let lk = hf(lc.id);
  let blot = 1.0 - smoothstep(0.25, 0.5, lc.f1 / max(hf(lc.id + 5u), 0.2) + pn(u, 128, 79u));
  if (lk > 0.8 && crack < 0.5) {
    alb = mix(alb, select(vec3f(0.55, 0.55, 0.38), vec3f(0.58, 0.58, 0.55), lk > 0.9), 0.6 * blot);
  }
  return Mat(alb, h, mix(0.68, 0.9, crack));
}

fn basaltMat(u: vec2f) -> Mat {
  let col = cells(u, 5, 81u);
  let joints = 1.0 - smoothstep(0.0, 0.05, col.f2 - col.f1);
  let ves = cells(u, 48, 83u);
  let pit = (1.0 - smoothstep(0.15, 0.3, ves.f1)) * step(0.5, hf(ves.id));
  let base = pfbm(u, 8, 4, 85u);
  let h = sat(0.6 + base * 0.3 - joints * 0.4 - pit * 0.3);
  var alb = vec3f(0.07, 0.068, 0.066) * (0.85 + 0.4 * sat(base + 0.5));
  alb = mix(alb, vec3f(0.16, 0.09, 0.06), smoothstep(0.2, 0.35, pfbm(u, 4, 2, 87u)) * 0.6);
  return Mat(alb * (1.0 - 0.4 * joints), h, mix(0.58, 0.85, pit));
}

fn groundMat(m: u32, u: vec2f) -> Mat {
  switch (m) {
    case ${GROUND.sand.id}u: { return sandMat(u, false); }
    case ${GROUND.blackSand.id}u: { return sandMat(u, true); }
    case ${GROUND.grass.id}u: { return grassMat(u); }
    case ${GROUND.litter.id}u: { return litterMat(u); }
    case ${GROUND.rock.id}u: { return rockMat(u); }
    default: { return basaltMat(u); }
  }
}
`;

// Pass 1: albedo + height (A) and roughness (scratch).
export const groundBakeWGSL = noiseLib + patterns + /* wgsl */ `
@group(0) @binding(0) var outA: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(1) var outRough: texture_storage_2d_array<rgba8unorm, write>;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let u = (vec2f(gid.xy) + 0.5) / ${MAT_TEX}.0;
  let s = groundMat(gid.z, u);
  textureStore(outA, gid.xy, gid.z, vec4f(sqrt(s.alb), s.h));
  textureStore(outRough, gid.xy, gid.z, vec4f(s.rough, 0.0, 0.0, 1.0));
}
`;

// Pass 2: normals and occlusion from the baked heights (B).
export const groundDeriveWGSL = groundLib + /* wgsl */ `
@group(0) @binding(0) var texA: texture_2d_array<f32>;
@group(0) @binding(1) var texRough: texture_2d_array<f32>;
@group(0) @binding(2) var outB: texture_storage_2d_array<rgba8unorm, write>;
fn hAt(p: vec2i, m: u32) -> f32 {
  let w = ((p % ${MAT_TEX}) + ${MAT_TEX}) % ${MAT_TEX};
  return textureLoad(texA, w, m, 0).a;
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  let m = gid.z;
  // relief in metres per metre of ground
  let k = GROUND_DEPTH[m] / (2.0 * GROUND_TILE[m] / ${MAT_TEX}.0);
  let dx = (hAt(p + vec2i(1, 0), m) - hAt(p - vec2i(1, 0), m)) * k;
  let dy = (hAt(p + vec2i(0, 1), m) - hAt(p - vec2i(0, 1), m)) * k;
  let n = normalize(vec3f(-dx, -dy, 1.0));
  // occlusion: how far the surroundings rise above this texel
  let h = hAt(p, m);
  var occ = 0.0;
  for (var i = 0; i < 8; i++) {
    let a = f32(i) * 0.785398;
    let r = select(3.0, 8.0, (i & 1) == 1);
    occ += max(hAt(p + vec2i(round(vec2f(cos(a), sin(a)) * r)), m) - h, 0.0);
  }
  let ao = clamp(1.0 - occ / 8.0 * 2.2, 0.0, 1.0);
  let rough = textureLoad(texRough, p, m, 0).r;
  textureStore(outB, gid.xy, m, vec4f(n.xy * 0.5 + 0.5, rough, ao));
}
`;

// Mip chains: plain averages for A; for B the normals are averaged and the
// spread of the normals that got averaged away is folded into the roughness
// (Toksvig), so distant ground does not turn glossy.
export const groundMipWGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba8unorm, write>;
fn fetch(p: vec2u, l: u32) -> vec4f { return textureLoad(src, p, l, 0); }
@compute @workgroup_size(8, 8, 1)
fn albedo(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= textureDimensions(dst))) { return; }
  let p = gid.xy * 2u;
  let s = fetch(p, gid.z) + fetch(p + vec2u(1u, 0u), gid.z) + fetch(p + vec2u(0u, 1u), gid.z) + fetch(p + vec2u(1u, 1u), gid.z);
  textureStore(dst, gid.xy, gid.z, s * 0.25);
}
@compute @workgroup_size(8, 8, 1)
fn surface(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= textureDimensions(dst))) { return; }
  let p = gid.xy * 2u;
  var nsum = vec3f(0.0);
  var r2 = 0.0;
  var ao = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let t = fetch(p + vec2u(i & 1u, i >> 1u), gid.z);
    let xy = t.xy * 2.0 - 1.0;
    nsum += vec3f(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
    r2 += t.z * t.z;
    ao += t.w;
  }
  let len = length(nsum) * 0.25;
  let n = nsum / max(length(nsum), 1e-5);
  let rough = sqrt(min(r2 * 0.25 + (1.0 - len) / max(len, 1e-3) * 0.5, 1.0));
  textureStore(dst, gid.xy, gid.z, vec4f(n.xy * 0.5 + 0.5, rough, ao * 0.25));
}
`;
