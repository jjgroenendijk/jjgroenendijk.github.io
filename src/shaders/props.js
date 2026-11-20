import { frameStruct, commonLib, shadowLib, hizLib } from './common.js';
import { cacheLib } from './terrain.js';
import { TYPE, MAT, CARD_VIEWS } from '../scene/catalog.js';

export const scatterWGSL = frameStruct + commonLib + hizLib + cacheLib + /* wgsl */ `
struct SP {
  cell: f32, radius: f32, maxDist: f32, minDist: f32,
  kind: u32, count: u32, flags: u32, p0: u32,      // flags: 1 = heights from the clipmap cache
  bound: f32, keepDist: f32, reach: f32, fadeDist: f32,
  lods: vec4f,                                      // distances where the next LOD slot takes over
  slot: vec4u, base: vec4u, cap: vec4u,
};
@group(1) @binding(0) var<uniform> P: SP;
@group(1) @binding(1) var<storage, read_write> inst: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> args: array<atomic<u32>>;
@group(1) @binding(3) var hiz: texture_2d<f32>;

fn emit(rel: vec3f, a: vec4f, b: vec4f, dist: f32) {
  // frustum culling (camera relative planes)
  let c = rel + vec3f(0.0, a.w * P.bound * 0.5, 0.0);
  let r = a.w * P.bound;
  var vis = true;
  for (var i = 0; i < 6; i++) {
    let pl = F.frustum[i];
    if (dot(pl.xyz, c) + pl.w < -r) { vis = false; }
  }
  if (dist > P.keepDist) {
    // off screen, or hidden behind what was drawn last frame (and too far to cast a shadow)
    if (!vis || occludedBox(hiz, c, vec3f(r), 1.0)) { return; }
  }
  let k = u32(dist > P.lods.x) + u32(dist > P.lods.y) + u32(dist > P.lods.z);
  let slot = P.slot[k];
  let idx = atomicAdd(&args[slot * 5u + 1u], 1u);
  if (idx >= P.cap[k]) { return; }
  let o = (P.base[k] + idx) * 2u;
  inst[o] = a;
  inst[o + 1u] = b;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let kind = P.kind;
  let t = F.camPos.w;
  if (kind == ${TYPE.fish}u) { fish(gid.x + gid.y * 64u, t); return; }
  if (kind == ${TYPE.bird}u) { bird(gid.x + gid.y * 64u, t); return; }
  if (kind == ${TYPE.manta}u || kind == ${TYPE.turtle}u) { cruiser(gid.x + gid.y * 64u, kind, t); return; }
  if (kind == ${TYPE.dolphin}u) { dolphin(gid.x + gid.y * 64u, t); return; }
  if (kind == ${TYPE.butterfly}u) { butterfly(gid.x + gid.y * 64u, t); return; }
  if (kind == ${TYPE.shark}u || kind == ${TYPE.ray}u) { cruiser(gid.x + gid.y * 64u, kind, t); return; }
  if (kind == ${TYPE.jelly}u) { jelly(gid.x + gid.y * 64u, t); return; }
  if (kind == ${TYPE.crab}u) { crab(gid.x + gid.y * 64u, t); return; }
  if (kind == ${TYPE.parrot}u) { parrot(gid.x + gid.y * 64u, t); return; }
  // reef life is only worth placing when the camera is near the water
  let reefLife = isCoral(kind) || kind == ${TYPE.seagrass}u || kind == ${TYPE.anemone}u || kind == ${TYPE.clownfish}u || kind == ${TYPE.starfish}u;
  if (reefLife && F.camPos.y > 45.0) { return; }
  if (kind >= ${TYPE.ship}u && kind <= ${TYPE.barrel}u) { landmark(gid.x + gid.y * 64u, kind, t); return; }
  let R = i32(P.radius);
  if (gid.x > u32(2 * R) || gid.y > u32(2 * R)) { return; }
  let cs = P.cell;
  let camC = vec2i(floor(F.camPos.xz / cs));
  let c = camC + vec2i(gid.xy) - vec2i(R);
  let ncell = i32(W / cs + 0.5);
  let cw = vec2i(wrapi(c.x, ncell), wrapi(c.y, ncell));
  // coral types share one cell lattice so they never overlap
  var tseed = kind;
  if (isCoral(kind)) { tseed = ${TYPE.coralA}u; }
  if (kind == ${TYPE.clownfish}u) { tseed = ${TYPE.anemone}u; }
  let seed = hashu(u32(cw.x) * 7919u + hashu(u32(cw.y) * 104729u + tseed * 1013u));
  let r1 = hf(seed); let r2 = hf(seed + 1u); let r3 = hf(seed + 2u);
  let r4 = hf(seed + 3u); let r5 = hf(seed + 4u); let r6 = hf(seed + 5u);
  let p = (vec2f(c) + vec2f(r1, r2) * 0.9 + 0.05) * cs;
  let rel2 = p - F.camPos.xz;
  let dist = length(rel2);
  if (dist > P.maxDist || dist <= P.minDist) { return; }
  // cheap frustum test on a vertical column before evaluating any terrain noise
  if (P.reach > 0.0 && dist > P.keepDist) {
    let y0 = -60.0 - F.camPos.y;
    let y1 = 360.0 - F.camPos.y;
    for (var i = 0; i < 4; i++) {
      let pl = F.frustum[i];
      let e = dot(pl.xz, rel2) + max(pl.y * y0, pl.y * y1) + pl.w;
      if (e < -P.reach) { return; }
    }
  }
  // far layers sit on the terrain as it is drawn (cheap cache lookup instead of noise)
  let h = select(terrainHeight(p), cacheHeight(p), (P.flags & 1u) != 0u);
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
  } else if (kind == ${TYPE.flowers}u) {
    prob = select(0.0, 0.35 * smoothstep(1.8, 4.0, h) * (1.0 - 0.5 * region(p).x), h > 1.8);
    scale = mix(1.2, 2.0, r5);
    excl = 2.4;
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
  } else if (isCoral(kind)) {
    let reef = reefMask(p);
    let mine = u32(r3 * 6.0) == coralIndex(kind);
    prob = select(0.0, 0.2 + reef * 0.75, mine && h < -1.3 && h > -18.0);
    scale = mix(0.8, 2.2, r5);
    if (kind == ${TYPE.coralE}u || kind == ${TYPE.coralF}u) { scale = mix(0.6, 1.4, r5); }
    tilt = (r6 - 0.5) * 0.35;
    excl = 1.9;
    sink = 0.1;
  } else if (kind == ${TYPE.anemone}u || kind == ${TYPE.clownfish}u) {
    prob = select(0.0, 0.12 + reefMask(p) * 0.25, h < -1.5 && h > -14.0);
    scale = mix(0.9, 1.4, r5);
    excl = 2.2;
  } else if (kind == ${TYPE.starfish}u) {
    prob = select(0.0, 0.07 * (1.0 - reefMask(p) * 0.6), h < -0.8 && h > -16.0);
    scale = mix(0.18, 0.32, r5);
    excl = 1.0;
    sink = -0.02;
  } else if (kind == ${TYPE.seagrass}u) {
    let reef = reefMask(p);
    let meadow = smoothstep(0.0, 0.15, fbm(p, 512, 2, 223u));
    prob = select(0.0, 0.75 * (1.0 - reef) * meadow, h < -0.7 && h > -10.0);
    scale = mix(0.6, 1.3, r5);
    excl = 1.2;
  }
  if (isCoral(kind)) { if (r1 * 0.5 + r2 * 0.5 > prob) { return; } }
  else if (r3 * 0.999 > prob) { return; }
  // keep the camera corridor clear
  let cor = corridorAt(p.y);
  if (cor.y > 0.01 && d < excl * max(cor.y, 0.25)) { return; }
  // shrink near max distance to avoid popping
  scale *= 1.0 - smoothstep(P.fadeDist * 0.8, P.fadeDist, dist);
  if (scale < 0.02) { return; }
  if (kind == ${TYPE.clownfish}u) {
    // a pair of clownfish hovering over their anemone
    for (var j = 0u; j < 2u; j++) {
      let a = t * (0.5 + f32(j) * 0.3) + r6 * TAU + f32(j) * 2.5;
      let fp = vec3f(p.x + cos(a) * 0.35 * scale, h + 0.3 * scale + sin(t * 1.3 + f32(j)) * 0.06, p.y + sin(a) * 0.35 * scale);
      emit(fp - F.camPos.xyz, vec4f(fp, 0.09), vec4f(a + PI * 0.5, 0.0, 0.97, r1 * 100.0 + f32(j) * 7.0), dist);
    }
    return;
  }
  let rel = vec3f(rel2.x, h - F.camPos.y - sink * scale, rel2.y);
  emit(rel, vec4f(p.x, h - sink * scale, p.y, scale), vec4f(yaw, tilt, r6, r1 * 100.0), dist);
}

fn isCoral(kind: u32) -> bool {
  return (kind >= ${TYPE.coralA}u && kind <= ${TYPE.coralC}u) || (kind >= ${TYPE.coralD}u && kind <= ${TYPE.coralF}u);
}
fn coralIndex(kind: u32) -> u32 {
  if (kind <= ${TYPE.coralC}u) { return kind - ${TYPE.coralA}u; }
  return kind - ${TYPE.coralD}u + 3u;
}

// jellyfish drifting through the water column
fn jelly(i: u32, t: f32) {
  if (i >= P.count || F.extra.x < 0.01) { return; }
  let spacing = 9.0;
  let zi = floor(F.camPos.z / spacing) + f32(i % 8u) - 2.0;
  let sh = hashu(u32(i32(zi) + 100000) * 97u + i / 8u * 13u);
  let x = pathX(zi * spacing) + (hf(sh) - 0.5) * 22.0 + sin(t * 0.05 + hf(sh) * 9.0) * 2.0;
  let z = zi * spacing + hf(sh + 1u) * spacing;
  let ground = terrainHeight(vec2f(x, z));
  if (ground > -3.0) { return; }
  let y = mix(ground + 1.5, -1.2, hf(sh + 2u)) + sin(t * 0.25 + hf(sh + 3u) * 6.0) * 0.6;
  let pos = vec3f(x, y, z);
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist) { return; }
  emit(rel, vec4f(pos, mix(0.3, 0.6, hf(sh + 4u))), vec4f(hf(sh + 5u) * TAU, (hf(sh + 6u) - 0.5) * 0.3, hf(sh + 7u), hf(sh + 8u) * 100.0), dist);
}

// crabs scuttling sideways on every beach: a 4 m lattice around the camera,
// about half of the cells on the sand band hold a crab
fn crab(i: u32, t: f32) {
  let n = 45u;
  if (i >= n * n || F.camFwd.w > 0.5) { return; }
  let cell = 4.0;
  let c = vec2i(floor(F.camPos.xz / cell)) + vec2i(i32(i % n), i32(i / n)) - i32(n / 2u);
  let sh = hashu(u32(c.x + 100000) * 193u + u32(c.y + 100000) * 7919u);
  if (hf(sh + 6u) > 0.5) { return; }
  let ph = hf(sh + 2u) * TAU;
  let yaw = hf(sh + 3u) * TAU;
  // walk sideways in bursts, then pause
  let stride = sin(t * 0.35 + ph) * 1.2;
  let pos2 = (vec2f(c) + 0.15 + vec2f(hf(sh), hf(sh + 1u)) * 0.7) * cell + vec2f(cos(yaw), -sin(yaw)) * stride;
  let rel2 = pos2 - F.camPos.xz;
  let dist = length(rel2);
  if (dist > P.maxDist) { return; }
  let h = terrainHeight(pos2);
  if (h < 0.25 || h > 2.4) { return; }
  let pos = vec3f(pos2.x, h, pos2.y);
  emit(pos - F.camPos.xyz, vec4f(pos, mix(0.3, 0.45, hf(sh + 4u))), vec4f(yaw, 0.0, hf(sh + 5u), ph * 10.0), dist);
}

// scarlet macaws crossing over the jungle canopy
fn parrot(i: u32, t: f32) {
  if (i >= P.count || F.extra.z < 0.05 || F.sunDir.y < 0.02) { return; }
  let flock = i / 4u;
  let j = i % 4u;
  let period = 45.0;
  let k = floor(t / period + f32(flock) * 0.33);
  let ph = fract(t / period + f32(flock) * 0.33);
  let sh = hashu(u32(k) * 7919u + flock * 31u);
  let side = select(-1.0, 1.0, hf(sh) > 0.5);
  let z0 = F.camPos.z + 30.0 + hf(sh + 1u) * 60.0;
  let x = pathX(z0) + side * (ph - 0.5) * 220.0;
  let z = z0 + sin(ph * 3.0 + f32(j)) * 6.0 + f32(j) * 2.5;
  let alt = max(terrainHeight(vec2f(x, z)), 0.0) + 24.0 + hf(sh + 2u) * 10.0 + f32(j) * 1.2;
  let pos = vec3f(x, alt, z);
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist) { return; }
  emit(rel, vec4f(pos, 0.75), vec4f(select(-PI * 0.5, PI * 0.5, side > 0.0), 0.0, 0.85 + hf(sh + 3u) * 0.1, f32(i) * 11.0), dist);
}

fn fish(i: u32, t: f32) {
  if (i >= P.count || F.extra.x < 0.01) { return; }
  let per = 32u;
  let s = i / per;
  let j = i % per;
  let spacing = 14.0;
  let zc = floor(F.camPos.z / spacing);
  let zi = zc + f32(s) - 4.0;
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
  let isShark = kind == ${TYPE.shark}u;
  let isRay = kind == ${TYPE.ray}u;
  let spacing = select(select(45.0, 70.0, isManta), 60.0, isShark || isRay);
  let zi = floor(F.camPos.z / spacing) + f32(i % 3u) - 1.0 + f32(i / 3u) * 0.5;
  let sh = hashu(u32(i32(zi * 2.0) + 100000) * 613u + kind);
  let side = select(-1.0, 1.0, hf(sh) > 0.5);
  let ax = pathX(zi * spacing) + side * (5.0 + hf(sh + 1u) * 9.0);
  let az = zi * spacing;
  let ground = terrainHeight(vec2f(ax, az));
  if (ground > -3.5) { return; }
  let rad = 9.0 + hf(sh + 2u) * 9.0;
  var speed = select(0.55, 1.1, isManta);
  if (isShark) { speed = 1.6; }
  if (isRay) { speed = 0.7; }
  let dirS = select(-1.0, 1.0, hf(sh + 3u) > 0.5);
  let ang = t * speed * dirS / rad + hf(sh + 4u) * TAU;
  var lift = select(1.6, 3.2, isManta) + hf(sh + 5u) * 2.0;
  if (isRay) { lift = 0.35; }
  if (isShark) { lift = 2.0 + hf(sh + 5u) * 3.0; }
  let x = ax + cos(ang) * rad;
  let z = az + sin(ang) * rad;
  let y = min(terrainHeight(vec2f(x, z)) + lift + sin(t * 0.2 + hf(sh) * 9.0) * 0.6, -1.8);
  let pos = vec3f(x, y, z);
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist) { return; }
  let yaw = atan2(-sin(ang) * dirS, cos(ang) * dirS);
  var sc = select(mix(0.8, 1.15, hf(sh + 6u)), mix(2.4, 3.6, hf(sh + 6u)), isManta);
  var hue = hf(sh + 7u);
  if (isShark) { sc = mix(1.5, 2.1, hf(sh + 6u)); }
  if (isRay) { sc = mix(0.9, 1.4, hf(sh + 6u)); hue = 0.8 + hue * 0.2; } else if (isManta) { hue *= 0.5; }
  emit(rel, vec4f(pos, sc), vec4f(yaw, sin(t * 0.3 + hf(sh) * 5.0) * 0.08, hue, hf(sh + 8u) * 100.0), dist);
}

// butterflies flutter along the jungle path by day
fn butterfly(i: u32, t: f32) {
  if (i >= P.count || F.extra.z < 0.05 || F.sunDir.y < 0.05) { return; }
  let spacing = 7.0;
  let zi = floor(F.camPos.z / spacing) + f32(i % 12u) - 2.0;
  let sh = hashu(u32(i32(zi) + 100000) * 31u + i / 12u * 7u);
  let ax = pathX(zi * spacing) + (hf(sh) - 0.5) * 9.0;
  let az = zi * spacing + hf(sh + 1u) * spacing;
  let ground = terrainHeight(vec2f(ax, az));
  if (ground < 1.5) { return; }
  let ph = hf(sh + 2u) * TAU;
  let wob = vec3f(sin(t * 0.6 + ph) * 1.8 + sin(t * 1.7 + ph * 2.0) * 0.3, sin(t * 2.3 + ph) * 0.35, cos(t * 0.45 + ph) * 1.8);
  let vel = vec2f(cos(t * 0.6 + ph) * 1.08, -sin(t * 0.45 + ph) * 0.81);
  let pos = vec3f(ax, ground + 0.9 + hf(sh + 3u) * 1.4, az) + wob;
  let rel = pos - F.camPos.xyz;
  let dist = length(rel);
  if (dist > P.maxDist) { return; }
  emit(rel, vec4f(pos, mix(0.11, 0.17, hf(sh + 4u))), vec4f(atan2(vel.x, vel.y), 0.0, hf(sh + 5u), ph * 10.0), dist);
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
/*CARD_FRAMES*/
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

// Impostor card: a camera-facing quad showing the nearest of 8 baked views.
// ex.y = species; the quad spans x in [-1, 1], y in [0, 1].
fn cardVertex(pos: vec3f, ex: vec4f, a: vec4f, b: vec4f) -> PV {
  let sp = u32(ex.y + 0.5);
  let fr = CARD[sp]; // half width, y min, y max (mesh units)
  let d = normalize(F.camPos.xz - a.xz + vec2f(1e-4, 0.0));
  let right = vec3f(d.y, 0.0, -d.x);
  // camera direction in the plant's own frame picks the baked view
  let cy = cos(b.x); let sy = sin(b.x);
  let th = atan2(cy * d.x - sy * d.y, sy * d.x + cy * d.y);
  let view = u32(i32(round(th / (TAU / ${CARD_VIEWS}.0))) + ${CARD_VIEWS}) % ${CARD_VIEWS}u;
  let p = right * pos.x * fr.x + vec3f(0.0, mix(fr.y, fr.z, pos.y), 0.0);
  var o: PV;
  o.rel = a.xyz - F.camPos.xyz + p * a.w;
  o.n = vec3f(b.x, 0.0, 0.0); // the plant's yaw, to turn baked normals into world space
  o.lp = vec3f(pos.x * 0.5 + 0.5, 1.0 - pos.y, f32(sp * ${CARD_VIEWS}u + view));
  o.mat = ${MAT.card}u;
  o.ex = vec4f(1.0, 0.0, 0.0, b.z);
  return o;
}

fn propVertex(pos: vec3f, nrm: vec3f, ex: vec4f, a: vec4f, b: vec4f) -> PV {
  let mat = u32(ex.x + 0.5);
  if (mat == ${MAT.card}u) { return cardVertex(pos, ex, a, b); }
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
    var flap = smoothstep(0.2, 0.7, sin(t * 0.5 + ph));
    if (b.z > 0.8) { flap = 1.0; }
    p.y += sin(t * 7.0 + ph) * abs(p.x) * 0.7 * flex * flap;
  }
  if (mat == 17u) { p.z += sin(t * 0.7 + ph) * 0.25 * flex; }
  if (mat == 18u) { p.x += sin(t * 6.0 + ph - p.z * 1.8) * 0.28 * flex; }
  if (mat == 30u) { p.x += sin(t * 3.0 + ph - p.z * 4.0) * 0.06 * flex; }
  if (mat == 31u) {
    let pulse = sin(t * 1.6 + ph);
    if (ex.w < 0.9) { p.x *= 1.0 + pulse * 0.08; p.z *= 1.0 + pulse * 0.08; p.y *= 1.0 - pulse * 0.1; }
    p.x += sin(t * 0.9 + ph + p.y * 2.0) * 0.08 * flex;
    p.z += cos(t * 0.7 + ph + p.y * 1.7) * 0.08 * flex;
  }
  if (mat == 33u) { p.y += abs(sin(t * 14.0 + ph + p.z * 9.0)) * 0.04 * flex * smoothstep(0.2, 0.5, sin(t * 0.7 + ph * 0.1)); }
  if (mat == 34u || mat == 36u) { p += vec3f(sin(t * 0.9 + ph + p.y * 4.0), 0.0, cos(t * 0.8 + ph + p.x * 3.0)) * 0.05 * flex * flex; }
  if (mat == 28u) { p.y += sin(t * 15.0 + ph) * abs(p.x) * 1.1 * flex; }
  if (mat == 27u) { p += vec3f(sin(t * 1.6 + ph + p.x * 9.0), 0.0, cos(t * 1.3 + ph)) * 0.008; }
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

const propSurface = /* wgsl */ `
fn fishColor(h: f32, lp: vec3f) -> vec3f {
  let belly = sat(lp.y * 6.0 + 0.3);
  if (h < 0.16) { return mix(vec3f(0.95, 0.78, 0.08), vec3f(0.98, 0.88, 0.35), belly); }            // yellow tang
  if (h < 0.32) { return mix(vec3f(0.10, 0.35, 0.85), vec3f(0.55, 0.75, 0.95), belly); }            // chromis
  if (h < 0.48) {                                                                                     // blue tang
    var c = vec3f(0.05, 0.25, 0.85);
    c = mix(c, vec3f(0.02, 0.02, 0.06), step(0.6, sin(lp.z * 9.0 + lp.y * 12.0) * 0.5 + 0.5) * step(0.0, lp.y));
    return mix(c, vec3f(0.98, 0.80, 0.10), step(lp.z, -0.38));
  }
  if (h < 0.64) {                                                                                     // sergeant major
    let bars = step(0.72, fract(lp.z * 5.5));
    return mix(mix(vec3f(0.85, 0.85, 0.75), vec3f(0.95, 0.88, 0.40), belly), vec3f(0.05), bars);
  }
  if (h < 0.80) { return mix(vec3f(0.10, 0.60, 0.55), vec3f(0.90, 0.45, 0.60), step(0.5, fract(lp.z * 4.0 + lp.y * 6.0))); } // parrotfish
  if (h < 0.92) {                                                                                     // butterflyfish
    let c = mix(vec3f(0.98, 0.97, 0.92), vec3f(0.98, 0.85, 0.15), smoothstep(-0.05, -0.3, lp.z));
    return mix(c, vec3f(0.03), step(abs(lp.z - 0.3), 0.04));
  }
  // clownfish: orange with three white bands edged in black
  let z = lp.z;
  let band = min(min(abs(z - 0.28), abs(z + 0.02)), abs(z + 0.36));
  var c = vec3f(0.98, 0.42, 0.04);
  c = mix(c, vec3f(0.02), step(band, 0.075));
  return mix(c, vec3f(0.98), step(band, 0.055));
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

struct Surf { alb: vec3f, n: vec3f, trans: f32, spec: f32, rough: f32, emissive: vec3f };

// Material of a prop surface point (shared by the main pass and the impostor bake).
fn surface(in: PV, ff: bool) -> Surf {
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
      trans = 0.3; spec = 0.15; rough = 0.5;
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
    case 12u: { alb = fishColor(hue, lp); spec = 0.6; rough = 0.3; }
    case 13u: {
      if (hue > 0.8) {
        // scarlet macaw: red body, yellow and blue wings
        let wx = abs(lp.x);
        alb = mix(vec3f(0.80, 0.06, 0.04), vec3f(0.95, 0.75, 0.08), smoothstep(0.1, 0.25, wx));
        alb = mix(alb, vec3f(0.05, 0.25, 0.85), smoothstep(0.35, 0.5, wx));
        break;
      }
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
      if (hue > 0.8) {
        // stingray: sandy, spotted back
        alb = select(vec3f(0.85, 0.82, 0.78), vec3f(0.36, 0.30, 0.22) * (0.8 + 0.4 * vnoise3(lp * 40.0)), n.y > 0.0 || in.ex.z > 0.5);
        break;
      }
      alb = select(vec3f(0.92, 0.92, 0.9), vec3f(0.07, 0.08, 0.10), n.y > 0.0 || in.ex.z > 0.5);
      spec = 0.2;
    }
    case 23u: {
      let q = lp.xz * 9.0;
      let cell = abs(fract(q.x + sin(q.y)) - 0.5) + abs(fract(q.y + sin(q.x * 0.7)) - 0.5);
      alb = mix(vec3f(0.18, 0.13, 0.07), vec3f(0.45, 0.33, 0.16), smoothstep(0.2, 0.7, cell) * (0.7 + 0.3 * vnoise3(lp * 20.0)));
      spec = 0.4; rough = 0.35;
    }
    case 27u: {
      var pc = vec3f(0.85, 0.06, 0.10);
      if (hue > 0.3) { pc = vec3f(0.96, 0.42, 0.06); }
      if (hue > 0.5) { pc = vec3f(0.95, 0.38, 0.62); }
      if (hue > 0.7) { pc = vec3f(0.98, 0.84, 0.18); }
      if (hue > 0.88) { pc = vec3f(0.95, 0.93, 0.90); }
      alb = mix(pc * vec3f(0.6, 0.15, 0.2), pc, smoothstep(0.0, 0.5, in.ex.z));
      trans = 0.6; spec = 0.2; rough = 0.4;
    }
    case 28u: {
      if (hue < 0.5) {
        // blue morpho: iridescent blue above, brown below
        let fres = pow(1.0 - abs(dot(n, normalize(-in.rel))), 2.0);
        alb = mix(vec3f(0.02, 0.22, 0.85), vec3f(0.25, 0.70, 1.0), fres);
        if (!ff) { alb = vec3f(0.25, 0.18, 0.10); }
        spec = 1.2; rough = 0.25;
      } else {
        let vein = step(0.85, fract(abs(lp.x) * 14.0 + lp.z * 6.0));
        alb = mix(vec3f(0.95, 0.48, 0.06), vec3f(0.03), max(vein, smoothstep(0.42, 0.48, length(lp.xz))));
      }
      alb = mix(alb, vec3f(0.04), step(abs(lp.x), 0.02));
      trans = 0.4;
    }
    case 30u: {
      // reef shark: grey back, white belly, black fin tips
      alb = mix(vec3f(0.85, 0.85, 0.83), vec3f(0.36, 0.38, 0.40), smoothstep(-0.03, 0.03, lp.y));
      alb = mix(alb, vec3f(0.03), smoothstep(0.6, 0.9, in.ex.z) * step(0.5, in.ex.z));
      spec = 0.4; rough = 0.35;
    }
    case 31u: {
      // jellyfish: pale translucent bell with a faint glow
      let c = mix(vec3f(0.75, 0.80, 0.95), vec3f(0.95, 0.60, 0.85), hue);
      alb = c * 0.5;
      trans = 1.0;
      emissive = c * (0.15 + 0.35 * pow(1.0 - abs(dot(n, normalize(-in.rel))), 3.0)) * (F.lightColor.rgb * 0.2 + F.waterFog.rgb * 4.0);
    }
    case 32u: {
      var c = vec3f(0.90, 0.35, 0.10);
      if (hue > 0.4) { c = vec3f(0.85, 0.15, 0.20); }
      if (hue > 0.75) { c = vec3f(0.15, 0.35, 0.85); }
      alb = c * (0.75 + 0.5 * vnoise3(lp * 60.0));
    }
    case 33u: { alb = mix(vec3f(0.75, 0.22, 0.08), vec3f(0.85, 0.55, 0.25), hue) * (0.8 + 0.3 * vnoise3(lp * 30.0)); spec = 0.4; rough = 0.4; }
    case 34u: {
      let c = select(vec3f(0.65, 0.25, 0.75), vec3f(0.35, 0.75, 0.35), hue > 0.5);
      alb = mix(c * 0.5, c * 1.2 + 0.1, in.ex.z);
      trans = 0.5;
    }
    case 35u: {
      var c = vec3f(0.55, 0.20, 0.60);
      if (hue > 0.35) { c = vec3f(0.95, 0.55, 0.15); }
      if (hue > 0.7) { c = vec3f(0.85, 0.80, 0.25); }
      alb = c * (0.55 + 0.45 * in.ex.x) * (0.85 + 0.3 * vnoise3(lp * 25.0));
    }
    case 36u: {
      let c = coralColor(fract(hue + 0.55));
      alb = mix(c * 0.6, min(c * 1.3, vec3f(1.0)), in.ex.y);
      trans = 0.4;
    }
    case 26u: {
      alb = mix(vec3f(0.62, 0.64, 0.66), vec3f(0.20, 0.23, 0.27), smoothstep(-0.03, 0.04, lp.y + lp.x * 0.1));
      spec = 0.8; rough = 0.25;
    }
    case 24u: { alb = vec3f(0.30, 0.32, 0.24) * (0.7 + 0.5 * vnoise3(lp * 30.0)); }
    default: {}
  }
  return Surf(alb, n, trans, spec, rough, emissive);
}
`;

export const propWGSL = frameStruct + commonLib + shadowLib + propVS + propSurface + /* wgsl */ `
@group(2) @binding(0) var cardAlb: texture_2d_array<f32>;
@group(2) @binding(1) var cardNrm: texture_2d_array<f32>;

@vertex fn vs(@location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) ex: vec4f,
              @location(3) a: vec4f, @location(4) b: vec4f) -> PV {
  var o = propVertex(pos, nrm, ex, a, b);
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  return o;
}

fn cardSurface(in: PV, gx: vec2f, gy: vec2f) -> Surf {
  let lay = i32(in.lp.z + 0.5);
  let c = textureSampleGrad(cardAlb, linSmp, in.lp.xy, lay, gx, gy);
  // dithered alpha test: TAA turns the thinning of distant mips into soft coverage
  if (c.a < 0.25 + 0.5 * ign(in.pos.xy, F.misc.x)) { discard; }
  let nt = textureSampleGrad(cardNrm, linSmp, in.lp.xy, lay, gx, gy);
  let nl = nt.xyz / max(c.a, 1e-3) * 2.0 - 1.0;
  let n = normalize(rotY(nl, in.n.x));
  let alb = c.rgb / max(c.a, 1e-3) * (0.85 + 0.3 * in.ex.w);
  return Surf(alb, n, nt.w / max(c.a, 1e-3), 0.15, 0.5, vec3f(0.0));
}

@fragment fn fs(in: PV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  // derivatives must be taken before any (non-uniform) branch
  let gx = dpdx(in.lp.xy); let gy = dpdy(in.lp.xy);
  var s: Surf;
  if (in.mat == ${MAT.card}u) { s = cardSurface(in, gx, gy); } else { s = surface(in, ff); }
  let pw = in.rel + F.camPos.xyz;
  let alb = s.alb; let n = s.n; let trans = s.trans; let spec = s.spec; let rough = s.rough; let emissive = s.emissive;
  let dist = length(in.rel);
  let V = -in.rel / max(dist, 1e-4);
  let L = F.lightDir.xyz;
  let sh = shadowAt(in.rel, n, in.pos.xy) * cloudShadow(pw);
  let lc = lightAt(pw);
  let ao = in.ex.x;
  var nl = max(dot(n, L), 0.0);
  if (trans > 0.0) { nl = max((dot(n, L) + 0.35) / 1.35, 0.0); }
  var col = alb * (lc * nl * sh + ambientAt(n, pw) * ao);
  col += alb * lc * trans * pow(sat(dot(V, -L)), 4.0) * 1.1 * sh;
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

// Impostor bake: one orthographic view of a plant into the card atlas
// (premultiplied albedo + coverage, premultiplied normal + translucency).
export const cardBakeWGSL = frameStruct + commonLib + propVS + propSurface + /* wgsl */ `
struct BakeU { right: vec4f, dir: vec4f, yr: vec4f };   // right.w half width, dir.w radius, yr.xy height range
@group(1) @binding(0) var<uniform> B: BakeU;
@vertex fn vs(@location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) ex: vec4f) -> PV {
  var o = propVertex(pos, nrm, ex, vec4f(F.camPos.xyz, 1.0), vec4f(0.0, 0.0, 0.5, 0.0));
  let p = o.rel;
  o.pos = vec4f(dot(p, B.right.xyz) / B.right.w, (p.y - B.yr.x) / (B.yr.y - B.yr.x) * 2.0 - 1.0,
                0.5 - 0.5 * dot(p, B.dir.xyz) / B.dir.w, 1.0);
  return o;
}
struct BO { @location(0) alb: vec4f, @location(1) nrm: vec4f };
@fragment fn fs(in: PV, @builtin(front_facing) ff: bool) -> BO {
  let s = surface(in, ff);
  return BO(vec4f(s.alb, 1.0), vec4f(s.n * 0.5 + 0.5, s.trans));
}
`;

// Mip chain of the card atlas: coverage weighted, so leaf colour does not
// bleed into the transparent background.
export const cardMipWGSL = /* wgsl */ `
@group(0) @binding(0) var srcA: texture_2d_array<f32>;
@group(0) @binding(1) var srcN: texture_2d_array<f32>;
@group(0) @binding(2) var dstA: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(3) var dstN: texture_storage_2d_array<rgba8unorm, write>;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let d = textureDimensions(dstA);
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  var a = vec4f(0.0); var n = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) {
    let q = vec2i(gid.xy * 2u + vec2u(i & 1u, i >> 1u));
    a += textureLoad(srcA, q, gid.z, 0);
    n += textureLoad(srcN, q, gid.z, 0);
  }
  textureStore(dstA, vec2i(gid.xy), gid.z, a * 0.25);
  textureStore(dstN, vec2i(gid.xy), gid.z, n * 0.25);
}
`;
