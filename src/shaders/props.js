import { frameStruct, commonLib, shadowLib } from './common.js';
import { TYPE } from '../scene/catalog.js';

export const scatterWGSL = frameStruct + commonLib + /* wgsl */ `
struct SP {
  cell: f32, radius: f32, maxDist: f32, lodDist: f32,
  kind: u32, slot0: u32, slot1: u32, base0: u32,
  base1: u32, cap0: u32, cap1: u32, count: u32,
  bound: f32, keepDist: f32, p0: f32, p1: f32,
};
@group(1) @binding(0) var<uniform> P: SP;
@group(1) @binding(1) var<storage, read_write> inst: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> args: array<atomic<u32>>;

fn emit(rel: vec3f, a: vec4f, b: vec4f, dist: f32) {
  // frustum culling (camera relative planes)
  let c = rel + vec3f(0.0, a.w * P.bound * 0.5, 0.0);
  let r = a.w * P.bound;
  var vis = true;
  for (var i = 0; i < 6; i++) {
    let pl = F.frustum[i];
    if (dot(pl.xyz, c) + pl.w < -r) { vis = false; }
  }
  if (!vis && dist > P.keepDist) { return; }
  var slot = P.slot0; var base = P.base0; var cap = P.cap0;
  if (dist > P.lodDist && P.slot1 != P.slot0) { slot = P.slot1; base = P.base1; cap = P.cap1; }
  let idx = atomicAdd(&args[slot * 5u + 1u], 1u);
  if (idx >= cap) { return; }
  inst[(base + idx) * 2u] = a;
  inst[(base + idx) * 2u + 1u] = b;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let kind = P.kind;
  let t = F.camPos.w;
  if (kind == ${TYPE.fish}u) { fish(gid.x + gid.y * 64u, t); return; }
  if (kind == ${TYPE.bird}u) { bird(gid.x + gid.y * 64u, t); return; }
  let R = i32(P.radius);
  if (gid.x > u32(2 * R) || gid.y > u32(2 * R)) { return; }
  let cs = P.cell;
  let camC = vec2i(floor(F.camPos.xz / cs));
  let c = camC + vec2i(gid.xy) - vec2i(R);
  let ncell = i32(W / cs + 0.5);
  let cw = vec2i(wrapi(c.x, ncell), wrapi(c.y, ncell));
  // coral types share one cell lattice so they never overlap
  var tseed = kind;
  if (kind == ${TYPE.coralB}u || kind == ${TYPE.coralC}u) { tseed = ${TYPE.coralA}u; }
  let seed = hashu(u32(cw.x) * 7919u + hashu(u32(cw.y) * 104729u + tseed * 1013u));
  let r1 = hf(seed); let r2 = hf(seed + 1u); let r3 = hf(seed + 2u);
  let r4 = hf(seed + 3u); let r5 = hf(seed + 4u); let r6 = hf(seed + 5u);
  let p = (vec2f(c) + vec2f(r1, r2) * 0.9 + 0.05) * cs;
  let rel2 = p - F.camPos.xz;
  let dist = length(rel2);
  if (dist > P.maxDist) { return; }
  let h = terrainHeight(p);
  let d = abs(p.x - pathX(p.y));
  var prob = 0.0;
  var scale = 1.0;
  var excl = 0.0;
  var tilt = 0.0;
  var sink = 0.0;
  let yaw = r4 * TAU;
  if (kind == ${TYPE.palm}u) {
    let f = forestDensity(p);
    prob = select(0.0, 0.72 * (1.0 - smoothstep(3.0, 16.0, h)) + 0.14 * (1.0 - f), h > 0.8 && h < 40.0);
    scale = mix(8.5, 14.5, r5);
    tilt = mix(0.05, 0.42, r6 * r6) * (1.0 - smoothstep(2.0, 9.0, h) * 0.6);
    excl = 6.0;
  } else if (kind == ${TYPE.tree}u) {
    let f = forestDensity(p);
    prob = select(0.0, f * 0.92 * smoothstep(4.0, 9.0, h), h > 4.0);
    scale = mix(15.0, 27.0, r5);
    excl = 6.5;
    sink = 0.3;
  } else if (kind == ${TYPE.bush}u) {
    let f = forestDensity(p);
    prob = select(0.0, 0.55 * (0.35 + f), h > 2.6);
    scale = mix(1.6, 4.0, r5);
    excl = 2.8;
    sink = 0.25;
  } else if (kind == ${TYPE.fern}u) {
    prob = select(0.0, 0.8 * smoothstep(1.3, 3.0, h), h > 1.3);
    scale = mix(0.7, 1.5, r5);
    excl = 1.4;
  } else if (kind == ${TYPE.banana}u) {
    prob = select(0.0, 0.4 * smoothstep(2.2, 5.0, h), h > 2.2);
    scale = mix(2.2, 4.2, r5);
    excl = 2.8;
  } else if (kind == ${TYPE.rock}u) {
    prob = select(0.025, 0.14, h < 2.2 && h > -30.0);
    scale = mix(0.5, 2.4, r5 * r5);
    tilt = (r6 - 0.5) * 0.6;
    excl = 2.6;
    sink = 0.35;
  } else if (kind == ${TYPE.coralA}u || kind == ${TYPE.coralB}u || kind == ${TYPE.coralC}u) {
    let reef = reefMask(p);
    let k = u32(r3 * 3.0);
    let mine = k == kind - ${TYPE.coralA}u;
    prob = select(0.0, 0.25 + reef * 0.75, mine && h < -1.3 && h > -18.0);
    scale = mix(0.9, 2.4, r5);
    if (kind == ${TYPE.coralC}u) { scale = mix(0.9, 2.2, r5); }
    tilt = (r6 - 0.5) * 0.35;
    excl = 1.9;
    sink = 0.12;
  } else if (kind == ${TYPE.seagrass}u) {
    let reef = reefMask(p);
    prob = select(0.0, 0.65 * (1.0 - reef), h < -0.7 && h > -10.0);
    scale = mix(0.6, 1.3, r5);
    excl = 1.2;
  }
  if (r3 * 0.999 > prob && !(kind >= ${TYPE.coralA}u && kind <= ${TYPE.coralC}u)) { return; }
  if ((kind >= ${TYPE.coralA}u && kind <= ${TYPE.coralC}u) && r1 * 0.5 + r2 * 0.5 > prob) { return; }
  // keep the camera corridor clear
  let cor = corridorAt(p.y);
  if (d < excl * max(cor.y, 0.25) * 1.0 + excl * 0.0 && cor.y > 0.01) { return; }
  // shrink near max distance to avoid popping
  scale *= 1.0 - smoothstep(P.maxDist * 0.8, P.maxDist, dist);
  if (scale < 0.02) { return; }
  let rel = vec3f(rel2.x, h - F.camPos.y - sink * scale, rel2.y);
  emit(rel, vec4f(p.x, h - sink * scale, p.y, scale), vec4f(yaw, tilt, r6, r1 * 100.0), dist);
}

fn fish(i: u32, t: f32) {
  if (i >= P.count || F.extra.x < 0.01) { return; }
  let per = 32u;
  let s = i / per;
  let j = i % per;
  let spacing = 22.0;
  let zc = floor(F.camPos.z / spacing);
  let zi = zc + f32(s) - 1.0;
  let sh = hashu(u32(i32(zi) + 100000) * 977u);
  let ax = pathX(zi * spacing) + (hf(sh) - 0.5) * 18.0;
  let az = zi * spacing + hf(sh + 1u) * spacing;
  let ground = terrainHeight(vec2f(ax, az));
  if (ground > -2.5) { return; }
  let ay = min(ground + 2.0 + hf(sh + 2u) * 3.0, -1.6);
  let rad = 2.5 + hf(sh + 3u) * 4.0;
  let dirS = select(-1.0, 1.0, hf(sh + 4u) > 0.5);
  let ang = t * 0.25 * dirS / max(rad * 0.3, 1.0) + f32(j) * 0.07;
  let center = vec3f(ax + cos(ang) * rad, ay + sin(t * 0.3 + hf(sh) * 6.0) * 0.6, az + sin(ang) * rad);
  let fj = hashu(i * 7u + 3u);
  let off = (vec3f(hf(fj), hf(fj + 1u), hf(fj + 2u)) - 0.5) * vec3f(3.0, 1.2, 3.0);
  let wob = vec3f(sin(t * 1.3 + f32(j)), sin(t * 1.7 + f32(j) * 2.0) * 0.4, cos(t * 1.1 + f32(j))) * 0.25;
  let pos = center + off + wob;
  let yaw = atan2(-sin(ang) * dirS, cos(ang) * dirS);
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist) { return; }
  let sc = mix(0.09, 0.22, hf(sh + 5u)) * (0.85 + 0.3 * hf(fj + 3u));
  emit(rel, vec4f(pos, sc), vec4f(yaw, 0.0, hf(sh + 6u), hf(fj) * 100.0), dist);
}

fn bird(i: u32, t: f32) {
  if (i >= P.count || F.camFwd.w > 0.5) { return; }
  let per = 6u;
  let s = i / per;
  let j = i % per;
  let cell = 260.0;
  let cc = floor(F.camPos.xz / cell);
  let ci = cc + vec2f(f32(s % 3u) - 1.0, f32(s / 3u) - 0.0);
  let sh = hashu(u32(i32(ci.x) + 5000) * 131u + hashu(u32(i32(ci.y) + 5000)));
  let center = (ci + vec2f(hf(sh), hf(sh + 1u))) * cell;
  let rad = 30.0 + hf(sh + 2u) * 50.0;
  let alt = 28.0 + hf(sh + 3u) * 50.0 + max(terrainHeight(center), 0.0);
  let dirS = select(-1.0, 1.0, hf(sh + 4u) > 0.5);
  let ang = t * dirS * 9.0 / rad + f32(j) * 0.35 + hf(sh + 5u) * TAU;
  let fj = hashu(i * 13u + 1u);
  let r = rad + (hf(fj) - 0.5) * 14.0;
  let pos = vec3f(center.x + cos(ang) * r, alt + (hf(fj + 1u) - 0.5) * 8.0 + sin(t * 0.4 + f32(j)) * 2.0, center.y + sin(ang) * r);
  let yaw = atan2(-sin(ang) * dirS, cos(ang) * dirS);
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist) { return; }
  emit(rel, vec4f(pos, 0.9 + hf(fj + 2u) * 0.4), vec4f(yaw, -0.25 * dirS, hf(sh + 6u), hf(fj) * 100.0), dist);
}
`;

export const clampWGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> args: array<u32>;
@group(0) @binding(1) var<storage, read> caps: array<u32>;
@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&caps)) { return; }
  args[i * 5u + 1u] = min(args[i * 5u + 1u], caps[i]);
}
`;

const propVS = /* wgsl */ `
struct PV {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) lp: vec3f,
  @location(3) @interpolate(flat) mat: u32,
  @location(4) ex: vec4f,     // ao, flex, t, hue
};
fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
fn rotX(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }

fn propVertex(pos: vec3f, nrm: vec3f, ex: vec4f, a: vec4f, b: vec4f) -> PV {
  let mat = u32(ex.x + 0.5);
  let t = F.camPos.w;
  var p = pos; var n = nrm;
  let flex = ex.z;
  let ph = b.w;
  let gust = 0.6 + 0.4 * sin(t * 0.23 + a.x * 0.01) * sin(t * 0.17 + a.z * 0.013);
  if (mat <= 2u) {
    let lean = b.y;
    let bt = ex.w;
    p.x += lean * bt * bt;
    p.y -= lean * lean * bt * 0.3;
    p.x += sin(t * 0.7 + ph) * 0.012 * bt * bt * gust;
  }
  if (mat == 1u || mat == 4u || mat == 5u || mat == 6u || mat == 14u) {
    let w = vec3f(sin(t * 1.9 + ph + p.y * 3.0 + p.x * 2.0), sin(t * 2.6 + ph * 1.3 + p.z * 4.0) * 0.6, cos(t * 1.5 + ph + p.y * 2.0));
    let amp = select(0.045, 0.02, mat == 4u || mat == 14u);
    p += w * amp * flex * gust;
  }
  if (mat == 3u) { p.x += sin(t * 0.5 + ph) * 0.004 * ex.w * ex.w * gust; }
  if (mat == 11u || mat == 10u) {
    let cur = vec2f(sin(t * 0.8 + ph + p.y * 1.3), cos(t * 0.6 + ph * 1.7 + p.y)) * flex * flex;
    p += vec3f(cur.x, 0.0, cur.y) * select(0.16, 0.05, mat == 10u);
  }
  if (mat == 12u) {
    let wig = sin(t * 9.0 + ph - p.z * 5.0) * 0.18 * flex;
    p.x += wig;
  }
  if (mat == 13u) {
    let flap = smoothstep(0.2, 0.7, sin(t * 0.5 + ph));
    p.y += sin(t * 7.0 + ph) * abs(p.x) * 0.7 * flex * flap;
  }
  if (mat == 12u || mat == 13u) {
    p = rotX(p, b.y * select(0.0, 1.0, mat == 13u)); n = rotX(n, b.y * select(0.0, 1.0, mat == 13u));
    // birds bank by rotating around Z instead
  } else if (mat > 2u && mat != 3u && mat != 4u && mat != 14u) {
    p = rotX(p, b.y); n = rotX(n, b.y);
  }
  p = rotY(p, b.x); n = rotY(n, b.x);
  var o: PV;
  o.rel = vec3f(a.x - F.camPos.x, a.y - F.camPos.y, a.z - F.camPos.z) + p * a.w;
  o.n = n;
  o.lp = pos;
  o.mat = mat;
  o.ex = vec4f(ex.y, flex, ex.w, b.z);
  return o;
}
`;

export const propWGSL = frameStruct + commonLib + shadowLib + propVS + /* wgsl */ `
@vertex fn vs(@location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) ex: vec4f,
              @location(3) a: vec4f, @location(4) b: vec4f) -> PV {
  var o = propVertex(pos, nrm, ex, a, b);
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  return o;
}

fn coralColor(h: f32) -> vec3f {
  let k = u32(h * 6.0);
  switch (k) {
    case 0u: { return vec3f(0.55, 0.20, 0.55); }
    case 1u: { return vec3f(0.95, 0.42, 0.16); }
    case 2u: { return vec3f(0.95, 0.42, 0.55); }
    case 3u: { return vec3f(0.92, 0.80, 0.30); }
    case 4u: { return vec3f(0.20, 0.62, 0.58); }
    default: { return vec3f(0.80, 0.30, 0.30); }
  }
}

@fragment fn fs(in: PV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let pw = in.rel + F.camPos.xyz;
  var n = normalize(in.n);
  if (!ff) { n = -n; }
  let hue = in.ex.w;
  let lp = in.lp;
  var alb = vec3f(0.5);
  var trans = 0.0;
  var spec = 0.0;
  var rough = 0.6;
  var emissive = vec3f(0.0);
  switch (in.mat) {
    case 0u: {
      let ring = smoothstep(0.3, 0.7, fract(lp.y * 38.0 + vnoise3(lp * 30.0) * 0.4));
      alb = mix(vec3f(0.26, 0.22, 0.17), vec3f(0.42, 0.37, 0.30), ring) * (0.85 + 0.3 * hue);
    }
    case 1u: {
      alb = mix(vec3f(0.12, 0.25, 0.04), vec3f(0.36, 0.42, 0.10), sat(in.ex.z * 0.8 + hue * 0.35));
      alb *= 0.85 + 0.3 * vnoise3(lp * 60.0);
      trans = 0.9; spec = 0.25; rough = 0.45;
    }
    case 2u: { alb = mix(vec3f(0.25, 0.30, 0.08), vec3f(0.33, 0.22, 0.10), hue); spec = 0.2; }
    case 3u: {
      let nz = vnoise3(lp * vec3f(60.0, 12.0, 60.0));
      alb = mix(vec3f(0.30, 0.27, 0.22), vec3f(0.45, 0.44, 0.38), nz);
      alb = mix(alb, vec3f(0.22, 0.30, 0.12), smoothstep(0.6, 0.8, vnoise3(lp * 25.0)) * 0.6);
    }
    case 4u, 14u: {
      let m = vnoise3(lp * 22.0) * 0.6 + vnoise3(lp * 55.0) * 0.4;
      let base = mix(vec3f(0.05, 0.14, 0.03), vec3f(0.15, 0.24, 0.05), hue);
      alb = base * (0.55 + 0.9 * m);
      if (in.mat == 14u) { alb *= vec3f(0.9, 1.05, 0.8); }
      trans = 0.7; spec = 0.15; rough = 0.5;
    }
    case 5u: { alb = mix(vec3f(0.09, 0.24, 0.05), vec3f(0.20, 0.34, 0.07), hue) * (0.8 + 0.4 * in.ex.z); trans = 0.8; spec = 0.1; }
    case 6u: {
      let rib = 1.0 - smoothstep(0.0, 0.04, abs(lp.z * 0.0 + in.ex.z - 0.5) * 0.0 + abs(fract(in.ex.z * 1.0) - 0.0));
      alb = mix(vec3f(0.13, 0.30, 0.05), vec3f(0.30, 0.45, 0.10), hue * 0.6 + rib * 0.2);
      trans = 0.95; spec = 0.35; rough = 0.35;
    }
    case 7u: {
      let nz = vnoise3(lp * 6.0) * 0.6 + vnoise3(lp * 20.0) * 0.4;
      alb = mix(vec3f(0.24, 0.23, 0.21), vec3f(0.44, 0.41, 0.37), nz) * (0.85 + 0.3 * hue);
      if (pw.y < 0.2) { alb = mix(alb, vec3f(0.20, 0.28, 0.14), 0.45 * smoothstep(0.4, 0.8, n.y + nz * 0.3)); }
    }
    case 8u: {
      alb = coralColor(hue);
      alb = mix(alb * 0.55, alb * 1.15, in.ex.z);
      spec = 0.1;
    }
    case 9u: {
      let q = lp * 18.0;
      let rdg = abs(sin(q.x + 2.0 * vnoise3(q * 0.7) * 3.0) * sin(q.z + vnoise3(q * 0.5 + 7.0) * 4.0));
      alb = coralColor(fract(hue + 0.37)) * mix(0.5, 1.1, smoothstep(0.1, 0.6, rdg));
    }
    case 10u: {
      let q = lp.xy * 55.0;
      let lat = min(abs(sin(q.x + sin(q.y * 0.5))), abs(sin(q.y * 1.2 + sin(q.x * 0.4))));
      if (lat > 0.55 && in.ex.z > 0.15) { discard; }
      alb = mix(vec3f(0.55, 0.12, 0.35), vec3f(0.85, 0.35, 0.20), hue);
      trans = 0.5;
    }
    case 11u: { alb = mix(vec3f(0.18, 0.32, 0.10), vec3f(0.35, 0.40, 0.14), in.ex.z) * (0.8 + 0.4 * hue); trans = 0.6; }
    case 12u: {
      var c1 = vec3f(0.95, 0.80, 0.10);
      var c2 = vec3f(0.95, 0.85, 0.30);
      if (hue > 0.33) { c1 = vec3f(0.10, 0.35, 0.85); c2 = vec3f(0.55, 0.75, 0.95); }
      if (hue > 0.66) { c1 = vec3f(0.95, 0.55, 0.15); c2 = vec3f(0.98, 0.98, 0.95); }
      let stripe = step(0.5, fract(lp.z * 9.0 + 0.2));
      alb = mix(c1, c2, select(sat(lp.y * 6.0 + 0.3), stripe, hue > 0.66));
      spec = 0.6; rough = 0.3;
    }
    case 13u: {
      alb = mix(vec3f(0.85, 0.85, 0.82), vec3f(0.12, 0.12, 0.13), smoothstep(0.5, 0.9, abs(lp.x) * 1.4) * 0.8 + 0.1 * hue);
    }
    case 15u: { alb = vec3f(0.30, 0.36, 0.14) * (0.8 + 0.3 * vnoise3(lp * 30.0)); }
    default: {}
  }
  let dist = length(in.rel);
  let V = -in.rel / max(dist, 1e-4);
  let L = F.lightDir.xyz;
  let sh = shadowAt(in.rel, n, in.pos.xy) * cloudShadow(pw);
  let lc = lightAt(pw);
  let ao = in.ex.x;
  var nl = max(dot(n, L), 0.0);
  if (trans > 0.0) { nl = max((dot(n, L) + 0.35) / 1.35, 0.0); }
  var col = alb * (lc * nl * sh + ambientAt(n, pw) * ao);
  col += alb * lc * trans * pow(sat(dot(V, -L)), 4.0) * 1.6 * sh;
  col += lc * ggx(n, V, L, rough) * spec * sh * nl;
  col = applyFog(col + emissive, in.rel);
  return vec4f(col, 1.0);
}
`;

export const propShadowWGSL = frameStruct + commonLib + propVS + /* wgsl */ `
struct Cascade { vp: mat4x4f };
@group(1) @binding(0) var<uniform> CS: Cascade;
@vertex fn vs(@location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) ex: vec4f,
              @location(3) a: vec4f, @location(4) b: vec4f) -> @builtin(position) vec4f {
  let o = propVertex(pos, nrm, ex, a, b);
  return CS.vp * vec4f(o.rel, 1.0);
}
`;
