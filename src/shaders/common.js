// Shared WGSL: frame uniforms, periodic noise, terrain, waves, sky, fog, lighting.
import { W, CYCLE } from '../world/noise.js';
import { KNOTS } from '../world/terrain.js';
import { WAVES, RIPPLES, WAVE_T } from '../world/waves.js';

const f = (x) => {
  const s = Number(x).toPrecision(9);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
};

const knotArr = `var<private> KN: array<vec4f, ${KNOTS.length}> = array<vec4f, ${KNOTS.length}>(${KNOTS.map((k) => `vec4f(${f(k[0])},${f(k[1])},${f(k[2])},${f(k[3])})`).join(',')});
var<private> KW: array<f32, ${KNOTS.length}> = array<f32, ${KNOTS.length}>(${KNOTS.map((k) => f(k[4])).join(',')});`;

const waveArr = (name, list) => `var<private> ${name}: array<vec4f, ${list.length}> = array<vec4f, ${list.length}>(${list.map((w) => `vec4f(${f(w[0])},${f(w[1])},${f(w[2])},${f(w[4])})`).join(',')});
var<private> ${name}Q: array<f32, ${list.length}> = array<f32, ${list.length}>(${list.map((w) => f(w[3])).join(',')});`;

export const FRAME_FLOATS = 236;

export const frameStruct = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  prevViewProj: mat4x4f,
  viewProjNJ: mat4x4f,
  camPos: vec4f,      // xyz world (wrapped), w time (s, mod ${WAVE_T})
  camFwd: vec4f,      // w: camera underwater
  lightDir: vec4f,    // w: sun-ness (1 sun, 0 moon)
  lightColor: vec4f,  // w: cloud coverage
  sunDir: vec4f,      // w: night factor
  moonDir: vec4f,     // w: star visibility
  skyAmb: vec4f,      // w: exposure
  groundAmb: vec4f,   // w: water level at camera
  fog: vec4f,         // x density, y height falloff, z jungle haze, w sky intensity
  waterFog: vec4f,    // rgb in-scatter colour, w visibility scale
  res: vec4f,         // w, h, 1/w, 1/h
  jitter: vec4f,
  misc: vec4f,        // x frame, y cycle u, z wind time, w quality
  cascadeSplits: vec4f,
  lightVP: array<mat4x4f, 3>,
  frustum: array<vec4f, 6>,
  levels: array<vec4f, 8>,
  cloud: vec4f,       // xy wind offset, z coverage, w unused
  extra: vec4f,       // x underwater mode weight, y aerial weight, z land weight, w cache mask
  fx: vec4f,          // x rainbow, y morning mist, z, w unused
};
@group(0) @binding(0) var<uniform> F: Frame;
`;

export const commonLib = /* wgsl */ `
const W: f32 = ${f(W)};
const CYCLE: f32 = ${f(CYCLE)};
const PI: f32 = 3.14159265;
const TAU: f32 = 6.28318531;
const WATER_EXT: vec3f = vec3f(0.20, 0.058, 0.034);
// lighting attenuation is kept gentler than view extinction so reefs stay colourful
const LIGHT_EXT: vec3f = vec3f(0.11, 0.04, 0.032);
${knotArr}
${waveArr('WV', WAVES)}
${waveArr('RP', RIPPLES)}

fn hashu(x: u32) -> u32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}
fn hf(x: u32) -> f32 { return f32(hashu(x)) * (1.0 / 4294967295.0); }
fn wrapi(a: i32, p: i32) -> i32 { return ((a % p) + p) % p; }
fn grad(ix: i32, iy: i32, per: i32, seed: u32) -> vec2f {
  let h = hashu(u32(wrapi(ix, per)) + hashu(u32(wrapi(iy, per)) + seed));
  return vec2f(f32(h & 0xffffu), f32(h >> 16u)) / 32767.5 - 1.0;
}
fn gnoise(p: vec2f, per: i32, seed: u32) -> f32 {
  let pi = floor(p);
  let fr = p - pi;
  let i = vec2i(pi);
  let u = fr * fr * fr * (fr * (fr * 6.0 - 15.0) + 10.0);
  let a = dot(grad(i.x, i.y, per, seed), fr);
  let b = dot(grad(i.x + 1, i.y, per, seed), fr - vec2f(1.0, 0.0));
  let c = dot(grad(i.x, i.y + 1, per, seed), fr - vec2f(0.0, 1.0));
  let d = dot(grad(i.x + 1, i.y + 1, per, seed), fr - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p: vec2f, per0: i32, oct: i32, seed: u32) -> f32 {
  var s = 0.0; var a = 0.5; var per = per0;
  var q = p * (f32(per0) / W);
  for (var i = 0; i < oct; i++) {
    s += a * gnoise(q, per, seed + u32(i) * 101u);
    q *= 2.0; per *= 2; a *= 0.5;
  }
  return s;
}
// cheap non periodic 3D value noise (used for local detail only)
fn vhash3(p: vec3i) -> f32 { return hf((u32(p.x) * 73856093u) ^ (u32(p.y) * 19349663u) ^ (u32(p.z) * 83492791u)); }
fn vnoise3(p: vec3f) -> f32 {
  let i = vec3i(floor(p)); let fr = fract(p);
  let u = fr * fr * (3.0 - 2.0 * fr);
  let a = mix(mix(vhash3(i), vhash3(i + vec3i(1,0,0)), u.x), mix(vhash3(i + vec3i(0,1,0)), vhash3(i + vec3i(1,1,0)), u.x), u.y);
  let b = mix(mix(vhash3(i + vec3i(0,0,1)), vhash3(i + vec3i(1,0,1)), u.x), mix(vhash3(i + vec3i(0,1,1)), vhash3(i + vec3i(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
fn ign(px: vec2f, frame: f32) -> f32 {
  let p = px + 5.588238 * (frame % 64.0);
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// ------------------------------------------------------------ terrain
fn pathX(z: f32) -> f32 {
  let k = TAU / W;
  return 140.0 * sin(k * 7.0 * z) + 50.0 * sin(k * 19.0 * z + 1.3) + 18.0 * sin(k * 41.0 * z + 0.4);
}
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
fn corridorAt(z: f32) -> vec4f {
  let u = fract(z / CYCLE);
  var i = 0;
  for (var k = 0; k < ${KNOTS.length - 1}; k++) { if (u >= KN[k + 1].x) { i = k + 1; } }
  let j = min(i + 1, ${KNOTS.length - 1});
  let a = KN[i]; let b = KN[j];
  var t = clamp((u - a.x) / max(b.x - a.x, 1e-5), 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  return vec4f(mix(a.yzw, b.yzw, t), mix(KW[i], KW[j], t));
}
fn baseHeight(p: vec2f) -> f32 {
  let c = fbm(p, 8, 3, 11u);
  let n = fbm(p, 32, 6, 23u);
  let e = n * 1.5 + c * 1.2 - 0.1;
  let r = 1.0 - abs(gnoise(p * (64.0 / W), 64, 37u));
  let r2 = 1.0 - abs(gnoise(p * (128.0 / W), 128, 41u));
  let ridge = r * r * 0.7 + r2 * r2 * 0.3;
  var h: f32;
  if (e > 0.0) { h = e * 40.0 + pow(max(e - 0.06, 0.0), 1.5) * 900.0 * (0.35 + 0.65 * ridge); }
  else { h = e * 90.0; }
  return max(h, -48.0 + 8.0 * n);
}
fn terrainHeight(p: vec2f) -> f32 {
  var h = baseHeight(p);
  let d = abs(p.x - pathX(p.y));
  h = smin(h, 30.0 + d * 0.55, 25.0);
  let land = smoothstep(-2.0, 4.0, h);
  h += fbm(p, 512, 4, 59u) * 6.0 * land;
  h += gnoise(p * (2048.0 / W), 2048, 71u) * 0.4;
  let k = corridorAt(p.y);
  let w = k.y * (1.0 - smoothstep(k.w * 0.35, k.w, d));
  if (w > 0.0) {
    let t = k.x + k.z * pow(max(d - 14.0, 0.0), 1.35) * 0.22 + fbm(p, 512, 3, 83u) * 2.5;
    h = mix(h, t, w);
  }
  return h;
}
// Island character varies by region: x = dry (golden grass, sparse forest),
// y = volcanic (black sand and basalt), the rest is lush with white sand.
fn region(p: vec2f) -> vec2f {
  let dry = smoothstep(0.06, 0.2, fbm(p, 8, 2, 251u));
  let volc = smoothstep(0.08, 0.22, fbm(p, 8, 2, 257u)) * (1.0 - dry);
  return vec2f(dry, volc);
}
fn forestDensity(p: vec2f) -> f32 {
  return smoothstep(-0.28, 0.05, fbm(p, 64, 3, 97u)) * (1.0 - 0.75 * region(p).x);
}
fn reefMask(p: vec2f) -> f32 { return smoothstep(-0.05, 0.18, fbm(p, 256, 3, 113u)); }

// ------------------------------------------------------------ waves
struct WaveOut { disp: vec3f, n: vec3f };
fn gerstner(p: vec2f, t: f32, dist: f32) -> WaveOut {
  var d = vec3f(0.0); var dx = 0.0; var dz = 0.0;
  for (var i = 0; i < ${WAVES.length}; i++) {
    let w = WV[i];
    let k = length(w.xy);
    let dir = w.xy / k;
    let th = dot(w.xy, p) - w.w * t;
    let lambda = TAU / k;
    let a = w.z * sat(1.0 - dist / (lambda * 14.0));
    let q = WVQ[i] / (k * w.z * ${WAVES.length}.0);
    let s = sin(th); let c = cos(th);
    d += vec3f(dir.x * q * a * c, a * s, dir.y * q * a * c);
    dx += w.x * a * c; dz += w.y * a * c;
  }
  return WaveOut(d, normalize(vec3f(-dx, 1.0, -dz)));
}
fn rippleNormal(p: vec2f, t: f32, fade: f32) -> vec2f {
  var g = vec2f(0.0);
  for (var i = 0; i < ${RIPPLES.length}; i++) {
    let w = RP[i];
    let th = dot(w.xy, p) - w.w * t;
    g += w.xy * w.z * cos(th) * fade;
  }
  return g;
}
fn waveY(p: vec2f, t: f32) -> f32 {
  var y = 0.0;
  for (var i = 0; i < ${WAVES.length}; i++) { let w = WV[i]; y += w.z * sin(dot(w.xy, p) - w.w * t); }
  return y;
}

// ------------------------------------------------------------ sky
const BR: vec3f = vec3f(5.8e-6, 13.5e-6, 33.1e-6);
const BM: f32 = 21e-6;
fn airmass(c: f32) -> f32 {
  let zd = acos(clamp(c, -1.0, 1.0)) * 57.2957795;
  return 1.0 / (max(c, 0.0) + 0.50572 * pow(max(96.07995 - zd, 0.1), -1.6364));
}
fn sunTrans(sy: f32) -> vec3f {
  return exp(-(BR * 8000.0 + BM * 1200.0) * airmass(sy)) * smoothstep(-0.12, 0.02, sy);
}
fn scatterSky(rd: vec3f, sun: vec3f, E: f32, g: f32) -> vec3f {
  let mu = dot(rd, sun);
  let pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let pM = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  let mv = airmass(max(rd.y, 0.0));
  let dR = 8000.0 * mv; let dM = 1200.0 * mv;
  let ext = BR * dR + BM * dM;
  let sc = (BR * pR * dR + BM * pM * dM) / ext * (1.0 - exp(-ext));
  // light scattered towards the zenith comes from higher, thinner air, so it is
  // reddened less than light near the horizon (keeps sunset zeniths blue)
  let tsRaw = exp(-(BR * 8000.0 + BM * 1200.0) * airmass(sun.y));
  let thin = mix(1.0, 0.3, sat(rd.y * 1.6));
  var c = E * pow(tsRaw, vec3f(thin)) * smoothstep(-0.12, 0.02, sun.y) * sc;
  let tw = smoothstep(-0.25, 0.0, sun.y) * (1.0 - smoothstep(0.0, 0.25, sun.y));
  c += E * 0.012 * tw * vec3f(0.10, 0.07, 0.12) * (1.0 - rd.y * 0.5);
  return c;
}
// full sky radiance without sun disc / stars / clouds
fn skyBase(rd: vec3f) -> vec3f {
  let E = F.fog.w;
  var c = scatterSky(rd, F.sunDir.xyz, E, 0.72);
  // moon light sky (stylised, brighter than reality)
  c += scatterSky(rd, F.moonDir.xyz, E * 0.0035, 0.6) * vec3f(0.75, 0.85, 1.1);
  // night floor
  c += vec3f(0.0009, 0.0016, 0.0034) * F.sunDir.w * (1.2 - 0.6 * max(rd.y, 0.0));
  return c;
}
fn fogSkyColor(rd: vec3f) -> vec3f {
  return skyBase(normalize(vec3f(rd.x, max(rd.y, 0.0) * 0.6 + 0.015, rd.z)));
}

// ------------------------------------------------------------ clouds (2D coverage shared by shadows)
fn cloudCoverage(xz: vec2f) -> f32 {
  let q = xz + F.cloud.xy;
  let n = fbm(q, 4, 4, 131u) + 0.35 * fbm(q, 32, 2, 151u);
  return n + F.cloud.z;
}
fn cloudShadow(pw: vec3f) -> f32 {
  let L = F.lightDir.xyz;
  if (L.y < 0.03) { return 1.0; }
  let q = pw.xz + L.xz * (1700.0 - pw.y) / L.y;
  return 1.0 - 0.75 * smoothstep(0.02, 0.35, cloudCoverage(q));
}

// ------------------------------------------------------------ water lighting helpers
fn caustics(pw: vec3f) -> f32 {
  let t = F.camPos.w;
  let L = F.lightDir.xyz;
  let p = pw.xz - L.xz / max(L.y, 0.2) * pw.y * 0.75;
  let q1 = p * (4096.0 / W) + vec2f(t * 0.11, t * 0.07) % 4096.0;
  let q2 = p * (4096.0 / W) * 1.37 - vec2f(t * 0.09, -t * 0.12) % 4096.0;
  let a = gnoise(q1, 4096, 171u);
  let b = gnoise(q2 * 1.0, 8192, 173u);
  let c1 = sat(1.0 - abs(a - b) * 3.2);
  let a2 = gnoise(q1 * 2.0 + 3.1, 8192, 177u);
  let c2 = sat(1.0 - abs(a2 + b) * 3.2);
  return pow(c1, 5.0) * 1.0 + pow(c2, 5.0) * 0.6;
}

// light arriving at a world point (sun/moon colour, attenuated if underwater)
fn lightAt(pw: vec3f) -> vec3f {
  var lc = F.lightColor.rgb;
  if (pw.y < 0.0) {
    let depth = -pw.y;
    lc *= exp(-LIGHT_EXT * depth) * (0.55 + caustics(pw) * 0.9 * exp(-depth * 0.05));
  }
  return lc;
}
fn ambientAt(n: vec3f, pw: vec3f) -> vec3f {
  var a = mix(F.groundAmb.rgb, F.skyAmb.rgb, n.y * 0.5 + 0.5);
  if (pw.y < 0.0) {
    let depth = -pw.y;
    a = mix(a, F.waterFog.rgb * 3.0, 0.5) * exp(-LIGHT_EXT * depth * 0.6);
  }
  return a;
}

// ------------------------------------------------------------ fog
fn applyFog(col: vec3f, rel: vec3f) -> vec3f {
  let dist = length(rel);
  let rd = rel / max(dist, 1e-4);
  if (F.camFwd.w > 0.5) {
    // underwater camera
    let T = exp(-WATER_EXT * dist * F.waterFog.w);
    let depthTint = exp(-WATER_EXT * max(-(F.camPos.y + rel.y), 0.0) * 0.25);
    return col * T + F.waterFog.rgb * depthTint * (1.0 - T);
  }
  let cy = F.camPos.y;
  let hf = F.fog.y;
  let dy = rel.y;
  var od: f32;
  let base = F.fog.x * exp(-hf * max(cy, 0.0));
  if (abs(dy) > 0.01) { od = base * (1.0 - exp(-hf * dy)) / (hf * dy) * dist; }
  else { od = base * dist; }
  // low morning mist hugging the water and valleys
  if (F.fx.y > 0.001) {
    // exact integral of an exponential layer (scale height MH) along the ray
    let MH = 18.0;
    let ya = max(cy, 0.0);
    let yb = max(cy + dy, 0.0);
    var layer = exp(-ya / MH);
    if (abs(yb - ya) > 0.01) { layer = MH * (exp(-ya / MH) - exp(-yb / MH)) / (yb - ya); }
    od += F.fx.y * 0.0035 * min(dist, 6000.0) * layer;
  }
  // jungle haze (near-field, only at ground level)
  od += F.fog.z * 0.005 * min(dist, 140.0) * exp(-max(cy + rel.y * 0.5, 0.0) * 0.02);
  let T = exp(-od * vec3f(0.75, 0.9, 1.15));
  var fc = fogSkyColor(rd);
  // sun glow in the haze
  let mu = max(dot(rd, F.sunDir.xyz), 0.0);
  fc += F.lightColor.rgb * pow(mu, 12.0) * 0.03 * F.lightDir.w;
  return col * T + fc * (1.0 - T);
}

fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let h = normalize(v + l);
  let nh = max(dot(n, h), 0.0);
  let a = rough * rough;
  let a2 = a * a;
  let d = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * d * d);
  let nl = max(dot(n, l), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let k = a * 0.5;
  let G = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  return D * G / (4.0 * nv);
}
`;

export const shadowLib = /* wgsl */ `
@group(1) @binding(0) var shadowTex: texture_depth_2d_array;
@group(1) @binding(1) var shadowSmp: sampler_comparison;
@group(1) @binding(2) var linSmp: sampler;

var<private> POISSON: array<vec2f, 8> = array<vec2f, 8>(
  vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696, 0.457), vec2f(-0.203, 0.621),
  vec2f(0.962, -0.195), vec2f(0.473, -0.480), vec2f(0.519, 0.767), vec2f(0.185, -0.893));

fn shadowCascade(rel: vec3f, c: i32, rot: f32, taps: i32) -> f32 {
  let lp = F.lightVP[c] * vec4f(rel, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0) { return 1.0; }
  let texel = 1.0 / f32(textureDimensions(shadowTex).x);
  let radius = texel * (1.6 - f32(c) * 0.35);
  let cs = cos(rot); let sn = sin(rot);
  var s = 0.0;
  for (var i = 0; i < taps; i++) {
    let o = POISSON[i];
    let r = vec2f(o.x * cs - o.y * sn, o.x * sn + o.y * cs) * radius;
    s += textureSampleCompareLevel(shadowTex, shadowSmp, uv + r, c, lp.z);
  }
  return s / f32(taps);
}
fn shadowAt(rel: vec3f, n: vec3f, px: vec2f) -> f32 {
  let dist = length(rel);
  let sp = F.cascadeSplits;
  if (dist > sp.z || F.lightColor.r + F.lightColor.g < 1e-4) { return 1.0; }
  var c = 0;
  if (dist > sp.x) { c = 1; }
  if (dist > sp.y) { c = 2; }
  let nb = n * (0.03 + 0.06 * f32(c) * f32(c)) * (1.0 + dist * 0.01);
  let rot = ign(px, F.misc.x) * TAU;
  var s = shadowCascade(rel + nb, c, rot, 6);
  let fade = smoothstep(sp.z * 0.8, sp.z, dist);
  return mix(s, 1.0, fade);
}
`;

export const shadowLibSimple = /* wgsl */ `
fn shadowPoint(rel: vec3f) -> f32 {
  let dist = length(rel);
  let sp = F.cascadeSplits;
  if (dist > sp.z) { return 1.0; }
  var c = 0;
  if (dist > sp.x) { c = 1; }
  if (dist > sp.y) { c = 2; }
  let lp = F.lightVP[c] * vec4f(rel, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  return textureSampleCompareLevel(shadowTex, shadowSmp, uv, c, lp.z);
}
`;
