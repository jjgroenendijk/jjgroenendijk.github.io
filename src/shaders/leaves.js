// Leaf cluster textures for the tree foliage cards, baked once at start-up.
// Each layer is a twig with its leaves, seen from above, attached at the
// bottom centre of the card (u = 0.5, v = 1):
//   A: albedo (premultiplied by coverage), coverage
//   B: tangent-space normal xy (premultiplied, 0.5 = flat), translucency, coverage
// Premultiplied texels let the shared card mip filter average them without
// the transparent background bleeding into the leaf colour.
import { noiseLib } from './common.js';

export const LEAF_TEX = 256;
export const LEAF = { broad: 0, small: 1, pinnate: 2 };
export const LEAF_COUNT = Object.keys(LEAF).length;

// Sampling, for any shader that draws foliage (uv and layer as unpacked by
// unpackLeafUV in the prop vertex stage). The textures and
// their sampler live in bind group `group` from binding `binding` on.
export const foliageLib = (group, binding) => /* wgsl */ `
@group(${group}) @binding(${binding}) var leafA: texture_2d_array<f32>;
@group(${group}) @binding(${binding + 1}) var leafB: texture_2d_array<f32>;
@group(${group}) @binding(${binding + 2}) var leafSmp: sampler;

struct LeafTap { alb: vec3f, a: f32, nt: vec2f, trans: f32 };
fn leafSample(uvl: vec3f, gx: vec2f, gy: vec2f) -> LeafTap {
  let a = textureSampleGrad(leafA, leafSmp, uvl.xy, i32(uvl.z + 0.5), gx, gy);
  let b = textureSampleGrad(leafB, leafSmp, uvl.xy, i32(uvl.z + 0.5), gx, gy);
  let w = 1.0 / max(a.a, 1e-3);
  return LeafTap(a.rgb * w, a.a, b.xy * w * 2.0 - 1.0, b.z * w);
}
fn leafCoverage(uvl: vec3f, gx: vec2f, gy: vec2f) -> f32 {
  return textureSampleGrad(leafA, leafSmp, uvl.xy, i32(uvl.z + 0.5), gx, gy).a;
}
`;

export const leafBakeWGSL = noiseLib + /* wgsl */ `
@group(0) @binding(0) var outA: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(1) var outB: texture_storage_2d_array<rgba8unorm, write>;

struct Leaf { base: vec2f, dir: vec2f, len: f32, wid: f32, tone: f32, bend: f32 };
struct Hit { alb: vec3f, n: vec2f, trans: f32, cov: f32 };

fn leafAt(layer: u32, i: u32) -> Leaf {
  let h = hashu(layer * 977u + i * 131u + 7u);
  let r0 = hf(h); let r1 = hf(h + 1u); let r2 = hf(h + 2u); let r3 = hf(h + 3u);
  if (layer == ${LEAF.broad}u) {
    // a fan of large, glossy leaves along a short twig
    let fi = f32(i);
    let s = 0.25 + fi * 0.11;
    let side = select(-1.0, 1.0, (i & 1u) == 0u);
    let base = vec2f(0.5, 0.95 - s * 0.7);
    let a = side * (0.5 + 0.35 * r0) + (r1 - 0.5) * 0.3 - 0.05 * side * fi;
    return Leaf(base, vec2f(sin(a), -cos(a)), 0.44 + 0.12 * r2, 0.15 + 0.03 * r3, r1, (r2 - 0.5) * 0.25);
  }
  if (layer == ${LEAF.small}u) {
    // a forked twig densely set with small oval leaves
    let br = i % 3u;
    let t = (f32(i / 3u) + 0.5) / 10.0;
    let ba = (f32(br) - 1.0) * 0.55;
    let along = vec2f(sin(ba), -cos(ba));
    let base = vec2f(0.5, 0.97) + vec2f(0.0, -0.25) * min(t * 3.0, 1.0) + along * max(t - 0.33, 0.0) * 0.95;
    let side = select(-1.0, 1.0, (i & 1u) == 0u);
    let a = ba + side * (0.7 + 0.5 * r0);
    return Leaf(base, vec2f(sin(a), -cos(a)), 0.13 + 0.05 * r2, 0.055 + 0.015 * r3, r1, (r2 - 0.5) * 0.4);
  }
  // pinnate: leaflets in pairs along a curved rachis
  let pair = f32(i / 2u);
  let t = (pair + 0.5) / 12.0;
  let base = vec2f(0.5 + 0.06 * sin(t * 2.5), 0.97 - t * 0.9);
  let side = select(-1.0, 1.0, (i & 1u) == 0u);
  let a = side * (1.0 + 0.2 * r0 - 0.4 * t);
  return Leaf(base, vec2f(sin(a), -cos(a)), (0.2 - 0.1 * t) * (0.85 + 0.3 * r2), 0.04 + 0.012 * r3, r1, side * 0.15);
}
fn leafCount(layer: u32) -> u32 { return select(select(24u, 30u, layer == ${LEAF.small}u), 7u, layer == ${LEAF.broad}u); }

fn leafColor(layer: u32, tone: f32) -> vec3f {
  let young = vec3f(0.20, 0.36, 0.06);
  let old = select(vec3f(0.04, 0.14, 0.03), vec3f(0.06, 0.17, 0.04), layer == ${LEAF.small}u);
  return mix(old, young, tone * tone * 0.8);
}

// The leaf blade: s along (0 at the stalk, 1 at the tip), t across in half widths.
fn bladeHit(q: vec2f, l: Leaf, layer: u32) -> Hit {
  let d = q - l.base;
  let perp = vec2f(-l.dir.y, l.dir.x);
  let s = dot(d, l.dir) / l.len;
  var t = dot(d, perp) / l.wid - l.bend * s * s * 4.0;
  if (s < 0.0 || s > 1.0) { return Hit(vec3f(0.0), vec2f(0.0), 0.0, 0.0); }
  // pointed tip, rounded base
  let shape = pow(sin(PI * pow(s, 0.75)), 0.8) * (1.0 - 0.25 * s);
  let at = abs(t);
  if (at > shape) { return Hit(vec3f(0.0), vec2f(0.0), 0.0, 0.0); }
  let u = at / max(shape, 1e-3);
  var c = leafColor(layer, l.tone);
  // lighter midrib, faint lateral veins, darker and drier margins
  let rib = 1.0 - smoothstep(0.03, 0.08, at);
  let vein = smoothstep(0.85, 0.97, fract(s * 9.0 - u * 1.4)) * smoothstep(0.1, 0.3, u) * (1.0 - u);
  c = mix(c, c * vec3f(1.5, 1.4, 1.1) + 0.03, rib * 0.7 + vein * 0.25);
  c *= 0.85 + 0.2 * (1.0 - u * u) + 0.08 * (hf(u32(q.x * 900.0) * 7u + u32(q.y * 900.0)) - 0.5);
  c = mix(c, vec3f(0.25, 0.22, 0.08), smoothstep(0.85, 1.0, u) * 0.3 * l.tone);
  // folded along the midrib, curled towards the tip
  let fold = sign(t) * 0.45 * (0.3 + u);
  let nl = perp * fold + l.dir * (0.35 * s * s - 0.1);
  return Hit(c, nl, mix(0.9, 0.35, rib), 1.0);
}

fn twigHit(q: vec2f, a: vec2f, b: vec2f, w: f32) -> Hit {
  let ab = b - a;
  let h = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
  let d = length(q - a - ab * h);
  let ww = w * (1.0 - 0.5 * h);
  if (d > ww) { return Hit(vec3f(0.0), vec2f(0.0), 0.0, 0.0); }
  let across = (q - a - ab * h) / ww;
  return Hit(vec3f(0.17, 0.12, 0.07), across * 0.8, 0.1, 1.0);
}

fn sampleCluster(q: vec2f, layer: u32) -> Hit {
  var o = Hit(vec3f(0.0), vec2f(0.0), 0.0, 0.0);
  // twig skeleton
  if (layer == ${LEAF.small}u) {
    for (var b = 0u; b < 3u; b++) {
      let ba = (f32(b) - 1.0) * 0.55;
      let fork = vec2f(0.5, 0.72);
      let h = twigHit(q, fork, fork + vec2f(sin(ba), -cos(ba)) * 0.62, 0.008);
      if (h.cov > 0.0) { o = h; }
    }
    let h = twigHit(q, vec2f(0.5, 1.0), vec2f(0.5, 0.72), 0.012);
    if (h.cov > 0.0) { o = h; }
  } else {
    let tip = select(vec2f(0.5, 0.25), vec2f(0.53, 0.07), layer == ${LEAF.pinnate}u);
    let h = twigHit(q, vec2f(0.5, 1.0), tip, select(0.012, 0.008, layer == ${LEAF.pinnate}u));
    if (h.cov > 0.0) { o = h; }
  }
  // leaves on top, later ones over earlier ones
  for (var i = 0u; i < leafCount(layer); i++) {
    let h = bladeHit(q, leafAt(layer, i), layer);
    if (h.cov > 0.0) { o = h; }
  }
  return o;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${LEAF_TEX}u || gid.y >= ${LEAF_TEX}u) { return; }
  // 4x4 supersampling for smooth edges in the coverage
  var alb = vec3f(0.0); var n = vec2f(0.0); var tr = 0.0; var cov = 0.0;
  for (var j = 0u; j < 16u; j++) {
    let q = (vec2f(gid.xy) + (vec2f(f32(j & 3u), f32(j >> 2u)) + 0.5) / 4.0) / ${LEAF_TEX}.0;
    let h = sampleCluster(q, gid.z);
    alb += h.alb * h.cov; n += h.n * h.cov; tr += h.trans * h.cov; cov += h.cov;
  }
  alb /= 16.0; n /= 16.0; tr /= 16.0; cov /= 16.0;
  textureStore(outA, vec2i(gid.xy), gid.z, vec4f(alb, cov));
  textureStore(outB, vec2i(gid.xy), gid.z, vec4f(clamp(n, vec2f(-cov), vec2f(cov)) * 0.5 + 0.5 * cov, tr, cov));
}
`;
