// Ground surface from the baked material textures (see materials.js), with a
// fixed texture budget: a pixel blends at most two materials; each one costs
// two fetches (stochastic tiling on flat ground) or up to three (triplanar on
// cliffs), times two textures. Plus the shared PBR lighting for the ground.
import { groundLibrary } from './materials.js';

const groundSampleLibrary = /* wgsl */ `${groundLibrary}
@group(2) @binding(0) var groundA: texture_2d_array<f32>;  // sqrt(albedo), height
@group(2) @binding(1) var groundB: texture_2d_array<f32>;  // normal xy, roughness, occlusion
@group(2) @binding(2) var groundSmp: sampler;

struct GroundTex { alb: vec3f, h: f32, nt: vec3f, rough: f32, ao: f32 };
struct GroundSurf { alb: vec3f, h: f32, n: vec3f, rough: f32, ao: f32 };

fn groundFetch(m: u32, uv: vec2f, gx: vec2f, gy: vec2f) -> GroundTex {
  let a = textureSampleGrad(groundA, groundSmp, uv, m, gx, gy);
  let b = textureSampleGrad(groundB, groundSmp, uv, m, gx, gy);
  let xy = b.xy * 2.0 - 1.0;
  return GroundTex(a.rgb * a.rgb, a.a, vec3f(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))), b.z, b.w);
}

fn mixTex(a: GroundTex, b: GroundTex, t: f32) -> GroundTex {
  return GroundTex(mix(a.alb, b.alb, t), mix(a.h, b.h, t), normalize(mix(a.nt, b.nt, t)), mix(a.rough, b.rough, t), mix(a.ao, b.ao, t));
}

// Repetition breaking: a slowly varying index k (0..1) picks one of eight
// random offsets of the tile; neighbouring variants are cross-faded, with the
// fade sharpened by the content so it reads as one surface.
fn groundStochastic(m: u32, uv: vec2f, gx: vec2f, gy: vec2f, k: f32) -> GroundTex {
  let x = k * 8.0;
  let i = u32(floor(x));
  let f = fract(x);
  let sa = hashu(i * 7u + m * 131u);
  let sb = hashu((i + 1u) * 7u + m * 131u);
  let a = groundFetch(m, uv + vec2f(hf(sa), hf(sa + 1u)), gx, gy);
  let b = groundFetch(m, uv + vec2f(hf(sb), hf(sb + 1u)), gx, gy);
  return mixTex(a, b, smoothstep(0.2, 0.8, f - 0.6 * (a.h - b.h)));
}

// Reoriented normal mapping: detail normal d on top of base normal b (both
// tangent space, z up) without flattening either.
fn rnm(b: vec3f, d: vec3f) -> vec3f {
  let t = b + vec3f(0.0, 0.0, 1.0);
  let u = d * vec3f(-1.0, -1.0, 1.0);
  return normalize(t * dot(t, u) / t.z - u);
}
// the three planar projections: texture u, v along world (x, z), (z, y), (x, y)
fn topNormal(n: vec3f, d: vec3f) -> vec3f { let r = rnm(vec3f(n.x, n.z, n.y), d); return vec3f(r.x, r.z, r.y); }
fn sideXNormal(n: vec3f, d: vec3f) -> vec3f { let r = rnm(vec3f(n.z, n.y, abs(n.x)), d); return vec3f(r.z * sign(n.x), r.y, r.x); }
fn sideZNormal(n: vec3f, d: vec3f) -> vec3f { let r = rnm(vec3f(n.x, n.y, abs(n.z)), d); return vec3f(r.x, r.y, r.z * sign(n.z)); }

fn surfFrom(t: GroundTex, n: vec3f) -> GroundSurf { return GroundSurf(t.alb, t.h, n, t.rough, t.ao); }

// One material at world point p with base normal n. dpx, dpy: screen
// derivatives of p (taken before any branching). Steep faces use triplanar
// mapping so cliffs are not stretched.
fn groundSurface(m: u32, p: vec3f, n: vec3f, dpx: vec3f, dpy: vec3f, k: f32, triplanar: bool) -> GroundSurf {
  let s = 1.0 / GROUND_TILE[m];
  if (!triplanar) {
    let t = groundStochastic(m, p.xz * s, dpx.xz * s, dpy.xz * s, k);
    return surfFrom(t, topNormal(n, t.nt));
  }
  var w = pow(abs(n), vec3f(4.0));
  w = w / (w.x + w.y + w.z);
  var o = GroundSurf(vec3f(0.0), 0.0, vec3f(0.0), 0.0, 0.0);
  if (w.y > 0.02) {
    let t = groundFetch(m, p.xz * s, dpx.xz * s, dpy.xz * s);
    o = accumulate(o, surfFrom(t, topNormal(n, t.nt)), w.y);
  }
  if (w.x > 0.02) {
    let t = groundFetch(m, p.zy * s, dpx.zy * s, dpy.zy * s);
    o = accumulate(o, surfFrom(t, sideXNormal(n, t.nt)), w.x);
  }
  if (w.z > 0.02) {
    let t = groundFetch(m, p.xy * s, dpx.xy * s, dpy.xy * s);
    o = accumulate(o, surfFrom(t, sideZNormal(n, t.nt)), w.z);
  }
  let wsum = select(0.0, w.y, w.y > 0.02) + select(0.0, w.x, w.x > 0.02) + select(0.0, w.z, w.z > 0.02);
  return GroundSurf(o.alb / wsum, o.h / wsum, normalize(o.n), o.rough / wsum, o.ao / wsum);
}
fn accumulate(o: GroundSurf, s: GroundSurf, w: f32) -> GroundSurf {
  return GroundSurf(o.alb + s.alb * w, o.h + s.h * w, o.n + s.n * w, o.rough + s.rough * w, o.ao + s.ao * w);
}

// Height-based blend of two materials with weights w0 + w1 = 1: the taller
// texel wins near the transition (sand settles between pebbles, grass grows
// in tufts) instead of a plain cross-fade. Returns the weight of the second.
fn heightBlend(h0: f32, w0: f32, h1: f32, w1: f32) -> f32 {
  let depth = 0.15;
  let a = h0 + w0;
  let b = h1 + w1;
  let top = max(a, b) - depth;
  let b0 = max(a - top, 0.0);
  let b1 = max(b - top, 0.0);
  return b1 / max(b0 + b1, 1e-5);
}
fn blendSurf(a: GroundSurf, b: GroundSurf, t: f32) -> GroundSurf {
  return GroundSurf(mix(a.alb, b.alb, t), mix(a.h, b.h, t), normalize(mix(a.n, b.n, t)), mix(a.rough, b.rough, t), mix(a.ao, b.ao, t));
}
`,
  // Physically based ground lighting: Lambert diffuse plus GGX specular with
  // Schlick Fresnel, and a specular ambient term from the baked sky radiance.
  groundShadingLibrary = /* wgsl */ `
const GROUND_F0: f32 = 0.04; // dielectric reflectance at normal incidence

// analytic fit of the pre-integrated environment BRDF (Karis)
fn envBRDF(rough: f32, nv: f32) -> vec2f {
  let r = rough * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}
// how much of the reflected sky the surrounding ground still lets through
fn specularOcclusion(nv: f32, ao: f32, rough: f32) -> f32 {
  return sat(pow(nv + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao);
}

struct GroundLight { sun: f32, ao: f32 }; // shadow factor on direct light, ambient occlusion

fn shadeGround(alb: vec3f, n: vec3f, rough: f32, rel: vec3f, lt: GroundLight) -> vec3f {
  let pw = rel + F.camPos.xyz;
  let V = -normalize(rel);
  let L = F.lightDir.xyz;
  let lc = lightAt(pw);
  let nl = max(dot(n, L), 0.0);
  let nv = max(dot(n, V), 1e-3);
  let hv = normalize(V + L);
  let fres = GROUND_F0 + (1.0 - GROUND_F0) * pow(1.0 - max(dot(V, hv), 0.0), 5.0);
  var col = alb * (1.0 - fres) * lc * nl * lt.sun;
  col += lc * PI * ggx(n, V, L, max(rough, 0.04)) * fres * lt.sun;
  col += alb * ambientAt(n, pw) * lt.ao;
  // reflected sky: sharp for wet ground, the diffuse sky for rough ground
  let R = reflect(-V, n);
  let env = mix(skyBase(R), ambientAt(R, pw), rough * rough) * smoothstep(-0.2, 0.15, R.y);
  let ab = envBRDF(rough, nv);
  col += env * (GROUND_F0 * ab.x + ab.y) * specularOcclusion(nv, lt.ao, rough);
  return col;
}
`;

export { groundSampleLibrary, groundShadingLibrary };
