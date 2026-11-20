import { frameStruct, commonLib, shadowLibSimple } from './common.js';
import { fullscreenVS } from './sky.js';

const sceneDistFn = /* wgsl */ `
fn depthToRel(uv: vec2f, d: f32) -> vec4f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  return F.invViewProj * ndc;
}
fn viewRay2(uv: vec2f) -> vec3f {
  let a = depthToRel(uv, 1.0); let b = depthToRel(uv, 0.5);
  return normalize(b.xyz / b.w - a.xyz / a.w);
}
`;

// Volumetric light shafts (jungle god rays and underwater beams), half resolution.
export const volumeWGSL = frameStruct + commonLib + fullscreenVS + sceneDistFn + /* wgsl */ `
@group(1) @binding(0) var shadowTex: texture_depth_2d_array;
@group(1) @binding(1) var shadowSmp: sampler_comparison;
@group(1) @binding(2) var linSmp: sampler;
@group(2) @binding(0) var depthTex: texture_depth_2d;
${shadowLibSimple}
fn hg(mu: f32, g: f32) -> f32 { return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5)); }

@fragment fn fs(in: FSO) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(depthTex));
  let px = vec2i(clamp(in.uv * dims, vec2f(0.0), dims - 1.0));
  let d = textureLoad(depthTex, px, 0);
  let rd = viewRay2(in.uv);
  var maxT = 1e6;
  if (d > 0.0) { let w = depthToRel(in.uv, d); maxT = length(w.xyz / w.w); }
  let uw = F.camFwd.w > 0.5;
  let cy = F.camPos.y;
  var lim = select(150.0, 50.0, uw);
  if (!uw && rd.y < 0.0) { lim = min(lim, cy / -rd.y); }
  if (uw && rd.y > 0.0) { lim = min(lim, -cy / rd.y); }
  maxT = min(maxT, lim);
  if (F.lightColor.r + F.lightColor.g < 1e-4) { return vec4f(0.0); }
  let N = 16;
  let dt = maxT / f32(N);
  var t = dt * ign(in.pos.xy, F.misc.x);
  let L = F.lightDir.xyz;
  let mu = dot(rd, L);
  var acc = vec3f(0.0);
  for (var i = 0; i < 16; i++) {
    let q = rd * t;
    let pw = q + F.camPos.xyz;
    let sh = shadowPoint(q);
    if (uw) {
      let depth = max(-pw.y, 0.0);
      let beam = 0.15 + caustics(pw) * 1.4;
      let lc = F.lightColor.rgb * exp(-WATER_EXT * (depth * 1.15 + t));
      acc += sh * lc * beam * 0.05 * dt;
    } else {
      let dens = F.fog.z * 0.008 * exp(-max(pw.y - 2.0, 0.0) * 0.03) + 0.0003;
      acc += sh * F.lightColor.rgb * dens * exp(-dens * t) * dt;
    }
    t += dt;
  }
  let ph = select(hg(mu, 0.55), hg(mu, 0.5), uw) * 4.0 * PI;
  return vec4f(acc * ph * select(0.3, 0.14, uw), 1.0);
}
`;

// Temporal anti-aliasing with variance clipping.
export const taaWGSL = frameStruct + fullscreenVS + sceneDistFn + /* wgsl */ `
@group(1) @binding(0) var curTex: texture_2d<f32>;
@group(1) @binding(1) var volTex: texture_2d<f32>;
@group(1) @binding(2) var histTex: texture_2d<f32>;
@group(1) @binding(3) var depthTex: texture_depth_2d;
@group(1) @binding(4) var smp: sampler;

fn rgb2ycocg(c: vec3f) -> vec3f { return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
fn ycocg2rgb(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
fn tm(c: vec3f) -> vec3f { return c / (1.0 + max(c.r, max(c.g, c.b))); }
fn itm(c: vec3f) -> vec3f { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }

fn catmull(uv: vec2f) -> vec3f {
  let size = vec2f(textureDimensions(histTex));
  let sp = uv * size;
  let tc = floor(sp - 0.5) + 0.5;
  let f = sp - tc;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let o12 = w2 / w12;
  let t0 = (tc - 1.0) / size; let t3 = (tc + 2.0) / size; let t12 = (tc + o12) / size;
  var r = vec3f(0.0);
  r += textureSampleLevel(histTex, smp, vec2f(t12.x, t0.y), 0.0).rgb * w12.x * w0.y;
  r += textureSampleLevel(histTex, smp, vec2f(t0.x, t12.y), 0.0).rgb * w0.x * w12.y;
  r += textureSampleLevel(histTex, smp, vec2f(t12.x, t12.y), 0.0).rgb * w12.x * w12.y;
  r += textureSampleLevel(histTex, smp, vec2f(t3.x, t12.y), 0.0).rgb * w3.x * w12.y;
  r += textureSampleLevel(histTex, smp, vec2f(t12.x, t3.y), 0.0).rgb * w12.x * w3.y;
  let wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, vec3f(0.0));
}

@fragment fn fs(in: FSO) -> @location(0) vec4f {
  let px = vec2i(in.pos.xy);
  let dims = vec2i(textureDimensions(curTex));
  // soften the dithered half-res volumetrics with a small tent filter
  let vt = 1.0 / vec2f(textureDimensions(volTex));
  let vol = (textureSampleLevel(volTex, smp, in.uv + vec2f(-0.75, -0.75) * vt, 0.0).rgb
           + textureSampleLevel(volTex, smp, in.uv + vec2f(0.75, -0.75) * vt, 0.0).rgb
           + textureSampleLevel(volTex, smp, in.uv + vec2f(-0.75, 0.75) * vt, 0.0).rgb
           + textureSampleLevel(volTex, smp, in.uv + vec2f(0.75, 0.75) * vt, 0.0).rgb) * 0.25;
  var m1 = vec3f(0.0); var m2 = vec3f(0.0);
  var cur = vec3f(0.0);
  var bestD = 0.0; var bestO = vec2i(0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = clamp(px + vec2i(x, y), vec2i(0), dims - 1);
      let c = tm(textureLoad(curTex, q, 0).rgb + vol);
      let yc = rgb2ycocg(c);
      m1 += yc; m2 += yc * yc;
      if (x == 0 && y == 0) { cur = c; }
      let d = textureLoad(depthTex, q, 0);
      if (d > bestD) { bestD = d; bestO = vec2i(x, y); }
    }
  }
  let mean = m1 / 9.0;
  let sd = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
  let uvc = (vec2f(px + bestO) + 0.5) / vec2f(dims);
  let wp = depthToRel(uvc, bestD);
  let pc = F.prevViewProj * wp;
  let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5) - (uvc - in.uv);
  var outc = cur;
  if (F.jitter.z < 0.5 && pc.w > 0.0 && all(puv > vec2f(0.0)) && all(puv < vec2f(1.0))) {
    let h = rgb2ycocg(tm(catmull(puv)));
    let lo = mean - sd * 1.25; let hi = mean + sd * 1.25;
    let hc = clamp(h, lo, hi);
    let hr = ycocg2rgb(hc);
    let vel = length((puv - in.uv) * vec2f(dims));
    let wgt = mix(0.92, 0.75, clamp(vel / 30.0, 0.0, 1.0));
    outc = mix(cur, hr, wgt);
  }
  var res = itm(outc);
  if (any(res != res)) { res = vec3f(0.0); }
  return vec4f(res, 1.0);
}
`;

export const bloomDownWGSL = fullscreenVS + /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct BP { texel: vec2f, karis: f32, pad: f32 };
@group(0) @binding(2) var<uniform> B: BP;
fn kw(c: vec3f) -> f32 { return 1.0 / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722))); }
fn s(uv: vec2f) -> vec3f { return min(textureSampleLevel(src, smp, uv, 0.0).rgb, vec3f(6e4)); }
@fragment fn fs(in: FSO) -> @location(0) vec4f {
  let t = B.texel; let uv = in.uv;
  let a = s(uv + t * vec2f(-2.0, -2.0)); let b = s(uv + t * vec2f(0.0, -2.0)); let c = s(uv + t * vec2f(2.0, -2.0));
  let d = s(uv + t * vec2f(-2.0, 0.0)); let e = s(uv); let f = s(uv + t * vec2f(2.0, 0.0));
  let g = s(uv + t * vec2f(-2.0, 2.0)); let h = s(uv + t * vec2f(0.0, 2.0)); let i = s(uv + t * vec2f(2.0, 2.0));
  let j = s(uv + t * vec2f(-1.0, -1.0)); let k = s(uv + t * vec2f(1.0, -1.0)); let l = s(uv + t * vec2f(-1.0, 1.0)); let m = s(uv + t * vec2f(1.0, 1.0));
  var o: vec3f;
  if (B.karis > 0.5) {
    let g0 = (a + b + d + e) * 0.25; let g1 = (b + c + e + f) * 0.25; let g2 = (d + e + g + h) * 0.25; let g3 = (e + f + h + i) * 0.25; let g4 = (j + k + l + m) * 0.25;
    let w0 = kw(g0); let w1 = kw(g1); let w2 = kw(g2); let w3 = kw(g3); let w4 = kw(g4);
    o = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  return vec4f(o, 1.0);
}
`;

export const bloomUpWGSL = fullscreenVS + /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct BP { texel: vec2f, karis: f32, pad: f32 };
@group(0) @binding(2) var<uniform> B: BP;
@fragment fn fs(in: FSO) -> @location(0) vec4f {
  let t = B.texel * 1.0; let uv = in.uv;
  var o = textureSampleLevel(src, smp, uv, 0.0).rgb * 4.0;
  o += (textureSampleLevel(src, smp, uv + vec2f(-t.x, 0.0), 0.0).rgb + textureSampleLevel(src, smp, uv + vec2f(t.x, 0.0), 0.0).rgb
      + textureSampleLevel(src, smp, uv + vec2f(0.0, -t.y), 0.0).rgb + textureSampleLevel(src, smp, uv + vec2f(0.0, t.y), 0.0).rgb) * 2.0;
  o += textureSampleLevel(src, smp, uv - t, 0.0).rgb + textureSampleLevel(src, smp, uv + t, 0.0).rgb
     + textureSampleLevel(src, smp, uv + vec2f(t.x, -t.y), 0.0).rgb + textureSampleLevel(src, smp, uv + vec2f(-t.x, t.y), 0.0).rgb;
  return vec4f(o / 16.0 * B.karis, 1.0);
}
`;

// Final: bloom, exposure, filmic tonemap, grade, vignette, grain, output encoding.
export const compositeWGSL = frameStruct + fullscreenVS + /* wgsl */ `
@group(1) @binding(0) var colTex: texture_2d<f32>;
@group(1) @binding(1) var bloomTex: texture_2d<f32>;
@group(1) @binding(2) var smp: sampler;

fn aces(x: vec3f) -> vec3f {
  let m1 = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
  let m2 = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
  let v = m1 * x;
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), vec3f(0.0), vec3f(1.0));
}
fn h21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
fn toSRGB(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

@fragment fn fs(in: FSO) -> @location(0) vec4f {
  var uv = in.uv;
  let t = F.camPos.w;
  let uw = F.camFwd.w;
  if (uw > 0.5) {
    uv += vec2f(sin(uv.y * 18.0 + t * 1.3), cos(uv.x * 14.0 + t * 1.1)) * 0.0018;
  }
  let cc = uv - 0.5;
  let ca = dot(cc, cc) * 0.006;
  var c = vec3f(
    textureSampleLevel(colTex, smp, uv - cc * ca, 0.0).r,
    textureSampleLevel(colTex, smp, uv, 0.0).g,
    textureSampleLevel(colTex, smp, uv + cc * ca, 0.0).b);
  let bl = textureSampleLevel(bloomTex, smp, uv, 0.0).rgb;
  c = mix(c, bl, mix(0.03, 0.06, uw));
  c *= F.skyAmb.w;
  // night vision: desaturate and shift towards blue in the dark (Purkinje)
  let nightV = F.sunDir.w;
  c = mix(c, vec3f(luma(c)) * vec3f(0.55, 0.75, 1.25), nightV * 0.65);
  // sunny grade before tonemap: warm light overall, shadows only faintly cool
  let day = 1.0 - F.sunDir.w;
  let l = luma(c);
  c = mix(c, c * vec3f(0.97, 1.0, 1.03), 1.0 - smoothstep(0.0, 0.2, l));
  c = mix(c, c * vec3f(1.06, 1.01, 0.92), smoothstep(0.15, 1.5, l) * day);
  c = aces(c * 1.08);
  let g = luma(c);
  c = mix(vec3f(g), c, 1.15 + 0.1 * day);
  // gentle S-curve for depth, shadows lifted a little so nothing turns murky
  c = c * c * (3.0 - 2.0 * c) * 0.25 + c * 0.75;
  c += (1.0 - c) * 0.015 * day;
  c = max(c, vec3f(0.0));
  // vignette
  let v = 1.0 - dot(cc * vec2f(1.0, 0.8), cc * vec2f(1.0, 0.8)) * 0.4;
  c *= v;
  c *= F.cloud.w;
  var o = toSRGB(sat3(c));
  // film grain and dither
  let n = h21(in.pos.xy + fract(t * 7.13) * 100.0) - 0.5;
  o += n * (1.0 / 255.0 + 0.012 * (1.0 - g));
  return vec4f(o, 1.0);
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn sat3(c: vec3f) -> vec3f { return clamp(c, vec3f(0.0), vec3f(1.0)); }
`;
