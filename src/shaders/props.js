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
  if (kind == ${TYPE.manta}u || kind == ${TYPE.turtle}u) { cruiser(gid.x + gid.y * 64u, kind, t); return; }
  if (kind == ${TYPE.dolphin}u) { dolphin(gid.x + gid.y * 64u, t); return; }
  if (kind >= ${TYPE.ship}u) { landmark(gid.x + gid.y * 64u, kind, t); return; }
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
    scale = mix(1.4, 3.2, r5);
    excl = 2.8;
    sink = 0.1;
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
    let meadow = smoothstep(0.0, 0.15, fbm(p, 512, 2, 223u));
    prob = select(0.0, 0.75 * (1.0 - reef) * meadow, h < -0.7 && h > -10.0);
    scale = mix(0.6, 1.3, r5);
    excl = 1.2;
  }
  if (r3 * 0.999 > prob && !(kind >= ${TYPE.coralA}u && kind <= ${TYPE.coralC}u)) { return; }
  if ((kind >= ${TYPE.coralA}u && kind <= ${TYPE.coralC}u) && r1 * 0.5 + r2 * 0.5 > prob) { return; }
  // keep the camera corridor clear
  let cor = corridorAt(p.y);
  if (cor.y > 0.01 && d < excl * max(cor.y, 0.25)) { return; }
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

// manta rays and turtles: slow, wide circles along the reef
fn cruiser(i: u32, kind: u32, t: f32) {
  if (i >= P.count || F.extra.x < 0.01) { return; }
  let isManta = kind == ${TYPE.manta}u;
  let spacing = select(45.0, 70.0, isManta);
  let zi = floor(F.camPos.z / spacing) + f32(i % 3u) - 1.0 + f32(i / 3u) * 0.5;
  let sh = hashu(u32(i32(zi * 2.0) + 100000) * 613u + kind);
  let side = select(-1.0, 1.0, hf(sh) > 0.5);
  let ax = pathX(zi * spacing) + side * (5.0 + hf(sh + 1u) * 9.0);
  let az = zi * spacing;
  let ground = terrainHeight(vec2f(ax, az));
  if (ground > -3.5) { return; }
  let rad = 9.0 + hf(sh + 2u) * 9.0;
  let speed = select(0.55, 1.1, isManta);
  let dirS = select(-1.0, 1.0, hf(sh + 3u) > 0.5);
  let ang = t * speed * dirS / rad + hf(sh + 4u) * TAU;
  let lift = select(1.6, 3.2, isManta) + hf(sh + 5u) * 2.0;
  let x = ax + cos(ang) * rad;
  let z = az + sin(ang) * rad;
  let y = min(terrainHeight(vec2f(x, z)) + lift + sin(t * 0.2 + hf(sh) * 9.0) * 0.6, -1.8);
  let pos = vec3f(x, y, z);
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist) { return; }
  let yaw = atan2(-sin(ang) * dirS, cos(ang) * dirS);
  let sc = select(mix(0.8, 1.15, hf(sh + 6u)), mix(2.4, 3.6, hf(sh + 6u)), isManta);
  emit(rel, vec4f(pos, sc), vec4f(yaw, sin(t * 0.3 + hf(sh) * 5.0) * 0.08, hf(sh + 7u), hf(sh + 8u) * 100.0), dist);
}

// a pod of dolphins cruising the open water near the lagoon, leaping now and then
fn dolphin(i: u32, t: f32) {
  if (i >= P.count || F.camFwd.w > 0.5) { return; }
  let cyc = floor(F.camPos.z / CYCLE);
  let ch = hashu(u32(i32(cyc) + 1000) * 747796405u);
  let side = select(-1.0, 1.0, (ch & 2u) == 2u);
  // the pod swims along the path through the lagoon approach, looping every 360 m
  let s = (t * 6.0 + f32(i) * 1.7) % 360.0;
  let z = (cyc + 0.12) * CYCLE + s;
  let lane = side * (24.0 + f32(i % 3u) * 3.0) + sin(t * 0.3 + f32(i)) * 1.5;
  let x = pathX(z) + lane;
  if (terrainHeight(vec2f(x, z)) > -3.0) { return; }
  // leap: a short ballistic arc every few seconds, otherwise swimming just below the surface
  let ph = fract(t / 7.0 + hf(ch + i) * 0.6);
  let jump = sat(ph / 0.16);
  var y = -1.1 + sin(t * 1.5 + f32(i)) * 0.15;
  var pitch = 0.0;
  if (ph < 0.16) {
    y = -0.6 + 2.6 * sin(PI * jump);
    pitch = -cos(PI * jump) * 0.9;
  }
  // fade in/out at the ends of the loop so the reset is never seen
  let fade = smoothstep(0.0, 25.0, s) * smoothstep(360.0, 335.0, s);
  let pos = vec3f(x, y, z);
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist || fade < 0.02) { return; }
  emit(rel, vec4f(pos, 2.2 * fade), vec4f(atan2(pathX(z + 1.0) - pathX(z), 1.0), pitch, hf(ch), f32(i) * 13.0), dist);
}

// pirate set pieces, one per cycle, positioned relative to the camera path
fn landmark(i: u32, kind: u32, t: f32) {
  if (i >= P.count) { return; }
  var per = 1u;
  if (kind == ${TYPE.barrel}u) { per = 5u; }
  let ci = i / per;
  let j = i % per;
  let cyc = floor(F.camPos.z / CYCLE) + f32(ci) - 1.0;
  let ch = hashu(u32(i32(cyc) + 1000) * 2654435761u);
  let side = select(-1.0, 1.0, (ch & 1u) == 1u);
  var pos = vec3f(0.0);
  var yaw = hf(ch + 9u) * TAU;
  var tilt = 0.0;
  if (kind == ${TYPE.ship}u) {
    let z = (cyc + 0.205) * CYCLE;
    var x = pathX(z) + side * 160.0;
    for (var k = 0; k < 10; k++) {
      let xx = pathX(z) + side * (90.0 + f32(k) * 25.0);
      if (terrainHeight(vec2f(xx, z)) < -9.0) { x = xx; break; }
    }
    pos = vec3f(x, waveY(vec2f(x, z), t) * 0.5 - 0.15, z);
    yaw = 1.35 + hf(ch + 3u) * 0.5;
    tilt = sin(t * 0.45 + hf(ch) * 6.0) * 0.025;
  } else if (kind == ${TYPE.wreck}u) {
    let z = (cyc + 0.655) * CYCLE;
    let x = pathX(z) + side * (17.0 + hf(ch + 4u) * 4.0);
    pos = vec3f(x, terrainHeight(vec2f(x, z)) - 0.5, z);
    tilt = 0.2;
  } else if (kind == ${TYPE.chest}u) {
    let z = (cyc + 0.69) * CYCLE;
    let x = pathX(z) - side * 3.2;
    pos = vec3f(x, terrainHeight(vec2f(x, z)) - 0.06, z);
    tilt = -0.1;
  } else {
    // rowboat pulled up on the beach, barrels scattered around it
    let off = side * 7.0;
    var z = (cyc + 0.29) * CYCLE;
    for (var k = 0; k < 16; k++) {
      let zz = (cyc + 0.278 + f32(k) * 0.002) * CYCLE;
      if (terrainHeight(vec2f(pathX(zz) + off, zz)) > 0.45) { z = zz; break; }
    }
    var xz = vec2f(pathX(z) + off, z);
    yaw = 0.4 * side;
    tilt = 0.06;
    if (kind == ${TYPE.barrel}u) {
      let a = f32(j) * 1.9 + hf(ch + 5u);
      xz += vec2f(cos(a), sin(a)) * (2.2 + f32(j) * 0.45) + vec2f(side * 1.5, 2.0);
      yaw = a * 3.0;
      tilt = select(0.0, 1.57, j == 3u);
    }
    pos = vec3f(xz.x, terrainHeight(xz) + select(-0.02, 0.22, kind == ${TYPE.rowboat}u), xz.y);
    if (kind == ${TYPE.barrel}u && j == 3u) { pos.y += 0.3; }
  }
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist) { return; }
  emit(rel, vec4f(pos, 1.0), vec4f(yaw, tilt, hf(ch + 6u), hf(ch + 7u) * 100.0), dist);
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
  if (mat == 17u) { p.z += sin(t * 0.7 + ph) * 0.25 * flex; }
  if (mat == 18u) { p.x += sin(t * 6.0 + ph - p.z * 1.8) * 0.28 * flex; }
  if (mat == 26u) { p.y += sin(t * 4.0 + ph) * 0.05 * flex; }
  if (mat == 22u) { p.y += sin(t * 1.3 + ph - abs(p.x) * 2.0) * abs(p.x) * 0.45 * flex; }
  if (mat == 24u) { p.y += sin(t * 1.5 + ph + p.z * 2.0) * 0.22 * flex; p.z += cos(t * 1.5 + ph) * 0.06 * flex; }
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
      alb = mix(vec3f(0.12, 0.25, 0.04), vec3f(0.36, 0.42, 0.10), sat(in.ex.y * 0.8 + hue * 0.35));
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
      // clumpy leaf normals
      let jn = vec3f(vnoise3(lp * 45.0), vnoise3(lp * 45.0 + 11.0), vnoise3(lp * 45.0 + 23.0)) - 0.5;
      n = normalize(n + jn * 1.4);
      if (in.mat == 14u) { alb *= vec3f(0.9, 1.05, 0.8); }
      trans = 0.7; spec = 0.15; rough = 0.5;
    }
    case 5u: { alb = mix(vec3f(0.09, 0.24, 0.05), vec3f(0.20, 0.34, 0.07), hue) * (0.8 + 0.4 * in.ex.z); trans = 0.8; spec = 0.1; }
    case 6u: {
      // in.ex.z is 0.5 on the two rows next to the midrib, 0 at the edges
      alb = mix(vec3f(0.13, 0.30, 0.05), vec3f(0.30, 0.45, 0.10), hue * 0.6 + in.ex.z * 0.25);
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
    case 16u, 25u: {
      // weathered planks; ochre stripe and dark gun ports along big hulls
      let plank = smoothstep(0.0, 0.08, abs(fract(lp.y * 3.2) - 0.5) * 2.0);
      let grain = vnoise3(lp * vec3f(2.0, 20.0, 0.6)) * 0.5 + vnoise3(lp * 9.0) * 0.5;
      alb = mix(vec3f(0.16, 0.10, 0.06), vec3f(0.34, 0.24, 0.15), grain) * mix(0.6, 1.0, plank);
      if (in.mat == 25u) { alb = mix(vec3f(0.38, 0.29, 0.19), vec3f(0.50, 0.40, 0.28), grain); }
      if (lp.y > 1.2 && lp.y < 1.75 && abs(lp.z) < 13.0 && in.mat == 16u) {
        alb = vec3f(0.42, 0.30, 0.12) * (0.8 + 0.4 * grain);
        let port = step(0.6, fract(lp.z * 0.42)) * step(abs(lp.y - 1.48), 0.2);
        alb = mix(alb, vec3f(0.02), port);
      }
      spec = 0.05; rough = 0.8;
    }
    case 17u: {
      let seam = smoothstep(0.0, 0.06, abs(fract(lp.x * 0.8) - 0.5) * 2.0);
      alb = vec3f(0.80, 0.74, 0.62) * mix(0.82, 1.0, seam) * (0.9 + 0.15 * vnoise3(lp * 3.0));
      trans = 0.8;
    }
    case 18u: {
      // skull and crossbones on black
      let uv = vec2f(in.ex.z * 1.55, in.ex.x);
      let c = uv - vec2f(0.72, 0.6);
      var w = 0.0;
      w = max(w, step(length(c * vec2f(1.0, 1.1)), 0.17));
      w = max(w, step(abs(c.x), 0.1) * step(abs(c.y + 0.17), 0.07));
      let eyes = step(length(c - vec2f(0.065, 0.02)), 0.045) + step(length(c - vec2f(-0.065, 0.02)), 0.045);
      w *= 1.0 - eyes;
      let b = uv - vec2f(0.72, 0.28);
      let r1 = vec2f(b.x * 0.8 + b.y * 0.6, -b.x * 0.6 + b.y * 0.8);
      let r2 = vec2f(b.x * 0.8 - b.y * 0.6, b.x * 0.6 + b.y * 0.8);
      w = max(w, step(abs(r1.y), 0.03) * step(abs(r1.x), 0.3));
      w = max(w, step(abs(r2.y), 0.03) * step(abs(r2.x), 0.3));
      alb = mix(vec3f(0.02, 0.02, 0.025), vec3f(0.85, 0.83, 0.78), w);
      trans = 0.3;
    }
    case 19u: {
      let nz = vnoise3(lp * 1.7) * 0.6 + vnoise3(lp * 7.0) * 0.4;
      if (nz > 0.66) { discard; }
      alb = mix(vec3f(0.14, 0.13, 0.09), vec3f(0.22, 0.27, 0.16), vnoise3(lp * 3.0 + 4.0));
      alb = mix(alb, coralColor(fract(nz * 3.0)) * 0.6, smoothstep(0.55, 0.64, nz) * 0.7);
    }
    case 20u: {
      alb = vec3f(1.0, 0.72, 0.25);
      spec = 2.5; rough = 0.22;
      let glint = pow(vnoise3(lp * 80.0 + F.camPos.w * 0.5), 12.0);
      emissive = vec3f(1.0, 0.75, 0.3) * (0.02 + glint * 3.0) * F.lightColor.rgb;
    }
    case 21u: { alb = vec3f(0.10, 0.10, 0.11) * (0.8 + 0.4 * vnoise3(lp * 9.0)); spec = 0.4; rough = 0.45; }
    case 22u: {
      alb = select(vec3f(0.92, 0.92, 0.9), vec3f(0.07, 0.08, 0.10), n.y > 0.0 || in.ex.z > 0.5);
      spec = 0.2;
    }
    case 23u: {
      let q = lp.xz * 9.0;
      let cell = abs(fract(q.x + sin(q.y)) - 0.5) + abs(fract(q.y + sin(q.x * 0.7)) - 0.5);
      alb = mix(vec3f(0.18, 0.13, 0.07), vec3f(0.45, 0.33, 0.16), smoothstep(0.2, 0.7, cell) * (0.7 + 0.3 * vnoise3(lp * 20.0)));
      spec = 0.4; rough = 0.35;
    }
    case 26u: {
      alb = mix(vec3f(0.62, 0.64, 0.66), vec3f(0.20, 0.23, 0.27), smoothstep(-0.03, 0.04, lp.y + lp.x * 0.1));
      spec = 0.8; rough = 0.25;
    }
    case 24u: { alb = vec3f(0.30, 0.32, 0.24) * (0.7 + 0.5 * vnoise3(lp * 30.0)); }
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
