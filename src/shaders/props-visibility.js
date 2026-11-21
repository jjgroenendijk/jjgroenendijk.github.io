// Visibility buffer for the props. One non-indexed draw covers every slot:
// the vertex shader finds its slot, instance and triangle corner from the
// vertex index and fetches the geometry itself. The raster pass only stores
// (slot, instance, triangle) per pixel; a fullscreen resolve then rebuilds
// that triangle, interpolates it at the pixel and shades each pixel once,
// however many layers of foliage overlap there.
import { CARD_GRID, CARD_SIZE, MAT } from '../scene/catalog.js';
import { commonLibrary, frameStruct, shadowLibrary } from './common.js';

import { foliageSurfaceLibrary, propShading, propSurface, propVS, slotInfoLibrary } from './props.js';
import { foliageLibrary } from './leaves.js';

// Visibility texel with no prop.
const EMPTY = 0xff_ff_ff_ff,
  ID_FORMAT = 'rg32uint',
  // First binding of the leaf textures in group 2, after the geometry and impostor atlas.
  LEAF_BINDING = 7,
  // Geometry, impostor atlas and leaf textures shared by the raster and resolve
  // passes (group 2).

  propData = /* wgsl */ `${slotInfoLibrary}${foliageLibrary(2, LEAF_BINDING)}
@group(2) @binding(0) var cardAlb: texture_2d_array<f32>;
@group(2) @binding(1) var cardNrm: texture_2d_array<f32>;
@group(2) @binding(2) var<storage, read> verts: array<f32>;      // 10 floats per vertex
@group(2) @binding(3) var<storage, read> indices: array<u32>;
@group(2) @binding(4) var<storage, read> inst: array<vec4f>;     // 2 per instance
@group(2) @binding(5) var<storage, read> slots: array<SlotInfo>;
@group(2) @binding(6) var<storage, read> starts: array<u32>;

const VERTEX_FLOATS: u32 = 10u;

// one corner of triangle tri of instance ii in slot s, animated and placed
fn propCorner(s: u32, ii: u32, tri: u32, corner: u32) -> PV {
  let si = slots[s];
  let v = (si.baseVertex + indices[si.firstIndex + tri * 3u + corner]) * VERTEX_FLOATS;
  let pos = vec3f(verts[v], verts[v + 1u], verts[v + 2u]);
  let nrm = vec3f(verts[v + 3u], verts[v + 4u], verts[v + 5u]);
  let ex = vec4f(verts[v + 6u], verts[v + 7u], verts[v + 8u], verts[v + 9u]);
  let o = (si.instBase + ii) * 2u;
  return propVertex(pos, nrm, ex, inst[o], inst[o + 1u]);
}

// How much of instance ii in slot s is drawn: (fade in, fade out) by the
// instance's distance, for the dithered cross-fade between neighbouring LODs.
fn slotFade(s: u32, ii: u32) -> vec2f {
  let f = slots[s].fade;
  let d = length(inst[(slots[s].instBase + ii) * 2u].xz - F.camPos.xz);
  return vec2f(smoothstep(f.x, f.y, d), smoothstep(f.z, f.w, d));
}
// Complementary dithering: a fading-out LOD keeps the pixels with noise above
// its fade, the LOD fading in those below its own (the same value).
fn fadeDiscard(fade: vec2f, noise: f32) -> bool { return noise < fade.y || noise >= fade.x; }

// ---- octahedral impostors
// Views of each species are baked from an N x N grid of directions over the
// upper hemisphere (hemi-octahedral mapping). A card blends the three views
// around the direction it is seen from; each view is reprojected along the
// view ray onto its own image plane, so the blend stays sharp.
const CARD_N: i32 = ${CARD_GRID};
fn hemiOctEncode(d: vec3f) -> vec2f {
  let p = d.xz / (abs(d.x) + abs(d.y) + abs(d.z));
  return vec2f(p.x + p.y, p.x - p.y);
}
fn hemiOctDecode(e: vec2f) -> vec3f {
  let p = vec2f(e.x + e.y, e.x - e.y) * 0.5;
  return normalize(vec3f(p.x, 1.0 - abs(p.x) - abs(p.y), p.y));
}
struct CardTap { alb: vec4f, nrm: vec4f };
fn cardView(sp: u32, g: vec2i, xl: vec3f, vl: vec3f, radius: f32, lod: f32) -> CardTap {
  let d = hemiOctDecode((vec2f(g) + 0.5) / f32(CARD_N) * 2.0 - 1.0);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), d));
  let up = cross(d, right);
  let q = xl - vl * (dot(xl, d) / min(dot(vl, d), -0.05));
  let uv = vec2f(dot(q, right), -dot(q, up)) / radius * 0.5 + 0.5;
  let layer = i32(sp) * CARD_N * CARD_N + g.y * CARD_N + g.x;
  return CardTap(textureSampleLevel(cardAlb, linSmp, uv, layer, lod), textureSampleLevel(cardNrm, linSmp, uv, layer, lod));
}
// rel: the shaded point (camera relative); in.lp the sphere centre, in.n (yaw, scale, species)
fn cardImpostor(in: PV, rel: vec3f, pixel: f32) -> CardTap {
  let yaw = in.n.x; let scale = in.n.y; let sp = u32(in.n.z + 0.5);
  let radius = CARD[sp].x;
  let toCam = rotY(normalize(-in.lp), -yaw);
  let g = clamp((hemiOctEncode(normalize(vec3f(toCam.x, max(toCam.y, 0.0), toCam.z))) * 0.5 + 0.5) * f32(CARD_N) - 0.5, vec2f(0.0), vec2f(f32(CARD_N - 1)));
  let c = vec2i(min(floor(g), vec2f(f32(CARD_N - 2))));
  let f = g - vec2f(c);
  // the triangle of three views around g, with barycentric weights
  var g0 = c; var g1 = c + vec2i(1, 0); var g2 = c + vec2i(0, 1);
  var w = vec3f(1.0 - f.x - f.y, f.x, f.y);
  if (f.x + f.y > 1.0) { g0 = c + vec2i(1, 1); g1 = c + vec2i(0, 1); g2 = c + vec2i(1, 0); w = vec3f(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y); }
  let xl = rotY(rel - in.lp, -yaw) / scale;
  let vl = rotY(normalize(rel), -yaw);
  let lod = log2(max(pixel / (2.0 * radius * scale / ${CARD_SIZE}.0), 1.0));
  let a = cardView(sp, g0, xl, vl, radius, lod);
  let b = cardView(sp, g1, xl, vl, radius, lod);
  let e = cardView(sp, g2, xl, vl, radius, lod);
  return CardTap(a.alb * w.x + b.alb * w.y + e.alb * w.z, a.nrm * w.x + b.nrm * w.y + e.nrm * w.z);
}
`,
  visibilityWGSL = /* wgsl */ `${frameStruct}${commonLibrary}${shadowLibrary}${propVS}${propSurface}${propData}
struct VO {
  @builtin(position) pos: vec4f,
  @location(0) lp: vec3f,
  @location(1) ex: vec4f,
  @location(2) @interpolate(flat) mat: u32,
  @location(3) @interpolate(flat) id: vec2u,   // slot << 24 | instance, triangle
  @location(4) rel: vec3f,
  @location(5) n: vec3f,
  @location(6) @interpolate(flat) fade: vec2f,
};

// the slot owning corner v: the last one starting at or before it
fn slotOf(v: u32) -> u32 {
  var lo = 0u;
  var hi = arrayLength(&slots);
  while (lo + 1u < hi) {
    let mid = (lo + hi) / 2u;
    if (starts[mid] <= v) { lo = mid; } else { hi = mid; }
  }
  return lo;
}

@vertex fn vs(@builtin(vertex_index) v: u32) -> VO {
  let s = slotOf(v);
  let local = v - starts[s];
  let count = slots[s].indexCount;
  let ii = local / count;
  let c = local % count;
  let p = propCorner(s, ii, c / 3u, c % 3u);
  var o: VO;
  o.pos = F.viewProj * vec4f(p.rel, 1.0);
  o.lp = p.lp;
  o.ex = p.ex;
  o.mat = p.mat;
  o.id = vec2u((s << 24u) | ii, c / 3u);
  o.rel = p.rel;
  o.n = p.n;
  o.fade = slotFade(s, ii);
  return o;
}

@fragment fn fs(in: VO) -> @location(0) vec2u {
  // derivatives must be taken before any (non-uniform) branch
  let gx = dpdx(in.lp.xy); let gy = dpdy(in.lp.xy);
  let pixel = max(length(dpdx(in.rel)), length(dpdy(in.rel)));
  let noise = ign(in.pos.xy, F.misc.x);
  if (fadeDiscard(in.fade, noise)) { discard; }
  var pv: PV;
  pv.lp = in.lp; pv.ex = in.ex; pv.mat = in.mat; pv.n = in.n;
  // dithered alpha tests: TAA turns the thinning of distant mips into soft coverage
  if (in.mat == ${MAT.card}u) {
    if (cardImpostor(pv, in.rel, pixel).alb.a < 0.25 + 0.5 * fract(noise + 0.5)) { discard; }
  } else if (in.mat == ${MAT.foliage}u) {
    if (leafCoverage(in.lp, gx, gy) < 0.2 + 0.6 * fract(noise + 0.5)) { discard; }
  } else if (propClip(pv)) {
    discard;
  }
  return in.id;
}
`,
  resolveWGSL = /* wgsl */ `${frameStruct}${commonLibrary}${shadowLibrary}${propVS}${propSurface}${propShading}${propData}${foliageSurfaceLibrary}
@group(3) @binding(0) var ids: texture_2d<u32>;

struct FO { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> FO {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return FO(vec4f(p * 2.0 - 1.0, 0.0, 1.0));
}

// Perspective-correct barycentrics of the clip-space triangle c at the NDC
// point q (exact for corners behind the camera as well).
fn barycentrics(c0: vec4f, c1: vec4f, c2: vec4f, q: vec2f) -> vec3f {
  let u = vec3f(c0.x - q.x * c0.w, c1.x - q.x * c1.w, c2.x - q.x * c2.w);
  let v = vec3f(c0.y - q.y * c0.w, c1.y - q.y * c1.w, c2.y - q.y * c2.w);
  let b = cross(u, v);
  return b / (b.x + b.y + b.z);
}

fn mixPV(a: PV, b: PV, c: PV, w: vec3f) -> PV {
  var o = a; // flat attributes come from the first corner, as in the raster pass
  o.rel = a.rel * w.x + b.rel * w.y + c.rel * w.z;
  o.n = a.n * w.x + b.n * w.y + c.n * w.z;
  o.lp = a.lp * w.x + b.lp * w.y + c.lp * w.z;
  o.ex = a.ex * w.x + b.ex * w.y + c.ex * w.z;
  return o;
}

fn cardSurface(in: PV, pixel: f32) -> Surf {
  let t = cardImpostor(in, in.rel, pixel);
  let a = max(t.alb.a, 1e-3);
  let n = normalize(rotY(t.nrm.xyz / a * 2.0 - 1.0, in.n.x));
  let tint = mix(vec3f(0.85, 0.95, 1.1), vec3f(1.15, 1.05, 0.8), in.ex.w);
  return Surf(t.alb.rgb / a * tint, n, t.nrm.w / a, 0.3, 0.5, vec3f(0.0));
}

@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let id = textureLoad(ids, vec2i(frag.xy), 0).xy;
  if (id.x == ${EMPTY}u) { discard; }
  let s = id.x >> 24u;
  let ii = id.x & 0xffffffu;
  let a = propCorner(s, ii, id.y, 0u);
  let b = propCorner(s, ii, id.y, 1u);
  let c = propCorner(s, ii, id.y, 2u);
  let c0 = F.viewProj * vec4f(a.rel, 1.0);
  let c1 = F.viewProj * vec4f(b.rel, 1.0);
  let c2 = F.viewProj * vec4f(c.rel, 1.0);
  // the pixel and its neighbours (for texture gradients) in NDC
  let px = 2.0 * F.res.zw;
  let q = vec2f(frag.x * px.x - 1.0, 1.0 - frag.y * px.y);
  let w = barycentrics(c0, c1, c2, q);
  var pv = mixPV(a, b, c, w);
  pv.pos = frag;
  // the rasterizer's facing: winding of the projected triangle
  let ff = determinant(mat3x3f(c0.xyw, c1.xyw, c2.xyw)) > 0.0;
  var sf: Surf;
  if (pv.mat == ${MAT.card}u || pv.mat == ${MAT.foliage}u) {
    // texture gradients from the neighbouring pixels' barycentrics
    let wx = barycentrics(c0, c1, c2, q + vec2f(px.x, 0.0));
    let wy = barycentrics(c0, c1, c2, q - vec2f(0.0, px.y));
    let rel = mat3x3f(a.rel, b.rel, c.rel);
    let pixel = max(length(rel * wx - pv.rel), length(rel * wy - pv.rel));
    if (pv.mat == ${MAT.card}u) {
      sf = cardSurface(pv, pixel);
    } else {
      let lp = mat3x3f(a.lp, b.lp, c.lp);
      let gx = (lp * wx).xy - pv.lp.xy;
      let gy = (lp * wy).xy - pv.lp.xy;
      // the card's texture axes in world space, from the triangle
      let e1 = b.rel - a.rel; let e2 = c.rel - a.rel;
      let d1 = b.lp.xy - a.lp.xy; let d2 = c.lp.xy - a.lp.xy;
      let r = 1.0 / (d1.x * d2.y - d2.x * d1.y + 1e-8);
      let tu = normalize((e1 * d2.y - e2 * d1.y) * r);
      let tv = normalize((e2 * d1.x - e1 * d2.x) * r);
      sf = foliageSurface(pv, leafSample(pv.lp, gx, gy), tu, tv);
    }
  } else {
    sf = surface(pv, ff);
  }
  return vec4f(shadeProp(pv, sf, frag.xy), 1.0);
}
`;

export { EMPTY, ID_FORMAT, resolveWGSL, visibilityWGSL };
