// Visibility buffer for the props. One non-indexed draw covers every slot:
// the vertex shader finds its slot, instance and triangle corner from the
// vertex index and fetches the geometry itself. The raster pass only stores
// (slot, instance, triangle) per pixel; a fullscreen resolve then rebuilds
// that triangle, interpolates it at the pixel and shades each pixel once,
// however many layers of foliage overlap there.
import { frameStruct, commonLib, shadowLib } from './common.js';
import { propVS, propSurface, propShading, slotInfoLib } from './props.js';
import { MAT } from '../scene/catalog.js';

export const EMPTY = 0xffffffff; // visibility texel with no prop
export const ID_FORMAT = 'rg32uint';

// Geometry and impostor atlas shared by the raster and resolve passes (group 2).
const propData = slotInfoLib + /* wgsl */ `
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

// card coverage from the atlas, with explicit gradients
fn cardSample(tex: texture_2d_array<f32>, in: PV, gx: vec2f, gy: vec2f) -> vec4f {
  return textureSampleGrad(tex, linSmp, in.lp.xy, i32(in.lp.z + 0.5), gx, gy);
}
`;

export const visibilityWGSL = frameStruct + commonLib + shadowLib + propVS + propSurface + propData + /* wgsl */ `
struct VO {
  @builtin(position) pos: vec4f,
  @location(0) lp: vec3f,
  @location(1) ex: vec4f,
  @location(2) @interpolate(flat) mat: u32,
  @location(3) @interpolate(flat) id: vec2u,   // slot << 24 | instance, triangle
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
  return o;
}

@fragment fn fs(in: VO) -> @location(0) vec2u {
  // derivatives must be taken before any (non-uniform) branch
  let gx = dpdx(in.lp.xy); let gy = dpdy(in.lp.xy);
  var pv: PV;
  pv.lp = in.lp; pv.ex = in.ex; pv.mat = in.mat;
  if (in.mat == ${MAT.card}u) {
    // dithered alpha test: TAA turns the thinning of distant mips into soft coverage
    if (cardSample(cardAlb, pv, gx, gy).a < 0.25 + 0.5 * ign(in.pos.xy, F.misc.x)) { discard; }
  } else if (propClip(pv)) {
    discard;
  }
  return in.id;
}
`;

export const resolveWGSL = frameStruct + commonLib + shadowLib + propVS + propSurface + propShading + propData + /* wgsl */ `
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

fn cardSurface(in: PV, gx: vec2f, gy: vec2f) -> Surf {
  let c = cardSample(cardAlb, in, gx, gy);
  let nt = cardSample(cardNrm, in, gx, gy);
  let a = max(c.a, 1e-3);
  let n = normalize(rotY(nt.xyz / a * 2.0 - 1.0, in.n.x));
  return Surf(c.rgb / a * (0.85 + 0.3 * in.ex.w), n, nt.w / a, 0.15, 0.5, vec3f(0.0));
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
  if (pv.mat == ${MAT.card}u) {
    let wx = barycentrics(c0, c1, c2, q + vec2f(px.x, 0.0));
    let wy = barycentrics(c0, c1, c2, q - vec2f(0.0, px.y));
    let lp = mat3x3f(a.lp, b.lp, c.lp);
    let gx = (lp * wx).xy - pv.lp.xy;
    let gy = (lp * wy).xy - pv.lp.xy;
    sf = cardSurface(pv, gx, gy);
  } else {
    sf = surface(pv, ff);
  }
  return vec4f(shadeProp(pv, sf, frag.xy), 1.0);
}
`;
