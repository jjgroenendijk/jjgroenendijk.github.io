// Flocking fish and birds: each school is one workgroup of boids that keep
// apart, align with and stay close to their neighbours while following a
// target that wanders along the island. State persists between frames; the
// scatter pass reads it to place the instances.
import { frameStruct, commonLib } from './common.js';

const FISH_SCHOOLS = 13;
const FISH_PER_SCHOOL = 32;
const BIRD_FLOCKS = 6;
const BIRDS_PER_FLOCK = 6;
export const FISH_COUNT = FISH_SCHOOLS * FISH_PER_SCHOOL;
export const BIRD_COUNT = BIRD_FLOCKS * BIRDS_PER_FLOCK;
export const FLOCK_GROUPS = FISH_SCHOOLS + BIRD_FLOCKS;
export const AGENT_BYTES = 32; // (position, school key) + (velocity, bank)

// Read access to the flock state for other shaders (bound read-only).
export const flockReadLib = (group, binding) => /* wgsl */ `
@group(${group}) @binding(${binding}) var<storage, read> flock: array<vec4f>;
const FISH_COUNT: u32 = ${FISH_COUNT}u;
struct Agent { pos: vec3f, key: u32, vel: vec3f, bank: f32 };
fn agentAt(k: u32) -> Agent {
  let a = flock[k * 2u];
  let b = flock[k * 2u + 1u];
  return Agent(a.xyz, bitcast<u32>(a.w), b.xyz, b.w);
}
`;

export const flockWGSL = frameStruct + commonLib + /* wgsl */ `
struct Step { dt: f32, t: f32, pad0: f32, pad1: f32 };
@group(1) @binding(0) var<uniform> S: Step;
@group(1) @binding(1) var<storage, read_write> flock: array<vec4f>;

const GROUP: u32 = ${FISH_PER_SCHOOL}u;

// where a school should be heading this frame
struct Target { pos: vec3f, key: u32, vel: vec3f, live: u32 };

// how a species flocks
struct Rules {
  members: u32,
  separation: f32,   // personal space (m)
  view: f32,         // neighbours closer than this are flock mates (m)
  minSpeed: f32, maxSpeed: f32,
  wSep: f32, wAlign: f32, wCohere: f32, wSeek: f32, wander: f32,
  reset: f32,        // agents further than this from the target respawn near it
};
const FISH = Rules(${FISH_PER_SCHOOL}u, 0.55, 2.5, 0.5, 2.4, 6.0, 1.2, 0.5, 0.35, 0.8, 25.0);
const BIRD = Rules(${BIRDS_PER_FLOCK}u, 5.0, 25.0, 7.0, 14.0, 20.0, 0.8, 0.15, 0.12, 2.0, 160.0);

// school slots are keyed modulo their count, so a school keeps its slot (and
// its fish) while it stays in range and only the one falling behind respawns
fn slotCell(slot: i32, lo: f32, n: i32) -> f32 { return lo + f32(wrapi(slot - i32(lo), n)); }

fn fishTarget(s: u32, t: f32) -> Target {
  let spacing = 14.0;
  let zi = slotCell(i32(s), floor(F.camPos.z / spacing) - 4.0, ${FISH_SCHOOLS});
  let sh = hashu(u32(i32(zi) + 100000) * 977u);
  let ax = pathX(zi * spacing) + (hf(sh) - 0.5) * 18.0;
  let az = zi * spacing + hf(sh + 1u) * spacing;
  let ground = terrainHeight(vec2f(ax, az));
  let ay = min(ground + 2.0 + hf(sh + 2u) * 3.0, -1.6);
  let rad = 2.5 + hf(sh + 3u) * 4.0;
  let dirS = select(-1.0, 1.0, hf(sh + 4u) > 0.5);
  let w = 0.25 * dirS / max(rad * 0.3, 1.0);
  let ang = t * w;
  let pos = vec3f(ax + cos(ang) * rad, ay + sin(t * 0.3 + hf(sh) * 6.0) * 0.6, az + sin(ang) * rad);
  let vel = vec3f(-sin(ang), 0.0, cos(ang)) * rad * w;
  return Target(pos, sh | 1u, vel, u32(ground < -2.5));
}

fn birdTarget(s: u32, t: f32) -> Target {
  let cell = 260.0;
  let cc = floor(F.camPos.xz / cell);
  let ci = vec2f(slotCell(i32(s % 3u), cc.x - 1.0, 3), slotCell(i32(s / 3u), cc.y, 2));
  let sh = hashu(u32(i32(ci.x) + 5000) * 131u + hashu(u32(i32(ci.y) + 5000)));
  let center = (ci + vec2f(hf(sh), hf(sh + 1u))) * cell;
  let rad = 30.0 + hf(sh + 2u) * 50.0;
  let alt = 28.0 + hf(sh + 3u) * 50.0 + max(terrainHeight(center), 0.0);
  let dirS = select(-1.0, 1.0, hf(sh + 4u) > 0.5);
  let w = dirS * 9.0 / rad;
  let ang = t * w + hf(sh + 5u) * TAU;
  let pos = vec3f(center.x + cos(ang) * rad, alt + sin(t * 0.4) * 2.0, center.y + sin(ang) * rad);
  let vel = vec3f(-sin(ang), 0.0, cos(ang)) * rad * w;
  return Target(pos, sh | 1u, vel, 1u);
}

var<workgroup> goalShared: Target;
var<workgroup> mates: array<vec4f, ${FISH_PER_SCHOOL * 2}>; // position, velocity

@compute @workgroup_size(${FISH_PER_SCHOOL})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) j: u32) {
  let isFish = wg.x < ${FISH_SCHOOLS}u;
  var R = BIRD;
  if (isFish) { R = FISH; }
  let school = select(wg.x - ${FISH_SCHOOLS}u, wg.x, isFish);
  let k = select(${FISH_COUNT}u + school * R.members, school * R.members, isFish) + j;
  if (j == 0u) {
    if (isFish) { goalShared = fishTarget(school, S.t); } else { goalShared = birdTarget(school, S.t); }
  }
  let me = j < R.members;
  var p = vec3f(0.0);
  var v = vec3f(0.0);
  var bank = 0.0;
  if (me) {
    let a = flock[k * 2u];
    let b = flock[k * 2u + 1u];
    p = a.xyz; v = b.xyz; bank = b.w;
    mates[j * 2u] = vec4f(p, 0.0);
    mates[j * 2u + 1u] = vec4f(v, 0.0);
  }
  let goal = workgroupUniformLoad(&goalShared);
  if (!me) { return; }

  let h = hashu(k * 7u + 3u);
  let jitter = (vec3f(hf(h), hf(h + 1u), hf(h + 2u)) - 0.5) * select(vec3f(16.0, 6.0, 16.0), vec3f(3.0, 1.2, 3.0), isFish);
  if (bitcast<u32>(flock[k * 2u].w) != goal.key || distance(p, goal.pos) > R.reset) {
    // new school, or lost: start in formation behind the target
    p = goal.pos + jitter;
    v = goal.vel;
    bank = 0.0;
  } else {
    var sep = vec3f(0.0);
    var heading = vec3f(0.0);
    var center = vec3f(0.0);
    var n = 0.0;
    for (var m = 0u; m < R.members; m++) {
      if (m == j) { continue; }
      let d = p - mates[m * 2u].xyz;
      let dl = length(d);
      if (dl < R.view) {
        heading += mates[m * 2u + 1u].xyz;
        center += mates[m * 2u].xyz;
        n += 1.0;
      }
      if (dl < R.separation && dl > 1e-4) { sep += d / dl * (1.0 - dl / R.separation); }
    }
    var acc = sep * R.wSep;
    if (n > 0.0) {
      acc += (heading / n - v) * R.wAlign + (center / n - p) * R.wCohere;
    }
    // follow the target (its motion and where it is) and wander a little
    let t = S.t + hf(h + 3u) * 50.0;
    acc += (goal.pos + jitter * 0.3 - p) * R.wSeek + (goal.vel - v) * 0.3;
    acc += vec3f(sin(t * 1.3), sin(t * 1.7) * 0.4, cos(t * 1.1)) * R.wander;
    let v0 = v;
    v += acc * S.dt;
    v.y *= select(0.98, 0.9, isFish); // both prefer level travel
    let speed = length(v);
    if (speed > 1e-4) { v *= clamp(speed, R.minSpeed, R.maxSpeed) / speed; }
    p += v * S.dt;
    // fish stay below the surface, birds above the treetops near their target height
    if (isFish) { p.y = min(p.y, -0.6); }
    else { p.y = max(p.y, goal.pos.y - 20.0); }
    // lean into turns (birds bank, the sign follows the turn)
    let turn = (v0.z * v.x - v0.x * v.z) / max(dot(v, v) * S.dt, 1e-4);
    bank = mix(bank, clamp(turn * 1.5, -0.6, 0.6), 1.0 - exp(-S.dt * 3.0));
  }
  let key = select(0u, goal.key, goal.live == 1u);
  flock[k * 2u] = vec4f(p, bitcast<f32>(key));
  flock[k * 2u + 1u] = vec4f(v, bank);
}
`;
