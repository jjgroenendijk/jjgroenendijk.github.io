// Beach details for the terrain shader: the swash of each breaking wave running
// up the sand (and the wet band it leaves while it dries) and a trail of
// footprints along the camera path.

// in sync with the rolling surf of the water shader (same phase at depth 0)
export const shoreLib = /* wgsl */ `
const SURF_RATE: f32 = 1.15;   // rad / s, as in the water vertex shader
const SWASH_BASE: f32 = 0.08;  // height the sea always reaches (m)
const SWASH_RUN: f32 = 0.55;   // extra height of a wave's run-up (m)
const DRY_TIME: f32 = 5.0;     // seconds for wet sand to lighten again

struct Swash { wet: f32, sheet: f32, edge: f32 };

fn swashAt(p: vec2f, h: f32) -> Swash {
  var o = Swash(0.0, 0.0, 0.0);
  if (h > SWASH_BASE + SWASH_RUN + 0.6) { return o; }
  let jitter = gnoise(p * (512.0 / W), 512, 311u) * 3.0;
  // run-up follows the crest arriving at the shore, a little later
  let ph = fract((F.camPos.w * SURF_RATE + jitter - 0.9) / TAU) * TAU;
  let run = SWASH_BASE + SWASH_RUN * pow(max(sin(ph), 0.0), 1.5);
  o.sheet = 1.0 - smoothstep(run - 0.04, run, h);
  o.edge = smoothstep(run - 0.07, run - 0.02, h) * o.sheet;
  // when did the water last cover this height?
  let s0 = pow(sat((h - SWASH_BASE) / SWASH_RUN), 1.0 / 1.5);
  let leave = PI - asin(s0);
  let since = select(fract((ph - leave) / TAU) * TAU, 0.0, h < run) / SURF_RATE;
  let reached = 1.0 - smoothstep(SWASH_BASE + SWASH_RUN, SWASH_BASE + SWASH_RUN + 0.5, h);
  // sand above the run-up stays damp a little way up
  o.wet = max(exp(-since / DRY_TIME) * step(h, SWASH_BASE + SWASH_RUN), 0.45 * reached);
  o.wet = max(o.wet, o.sheet);
  return o;
}

// Footprint depth (m, negative = pressed in) at world point p.
const STRIDE: f32 = 0.72;
fn footprintDepth(p: vec2f) -> f32 {
  let trail = pathX(p.y) + 2.2 + 0.6 * sin(p.y * 0.21);
  let k = round(p.y / STRIDE);
  let hk = hashu(u32(i32(k) + 1000000));
  let side = select(1.0, -1.0, (i32(k) & 1) == 1); // left, right, left...
  let c = vec2f(trail + side * 0.12 + (hf(hk) - 0.5) * 0.05, k * STRIDE + (hf(hk + 1u) - 0.5) * 0.08);
  let a = (hf(hk + 2u) - 0.5) * 0.3 + side * 0.08;
  let d = p - c;
  let q = vec2f(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
  // heel and ball of the foot, toes as a row of dimples, a pushed-up rim
  let heel = length((q - vec2f(0.0, -0.08)) / vec2f(0.040, 0.050));
  let ball = length((q - vec2f(0.006 * side, 0.045)) / vec2f(0.048, 0.060));
  let toes = length((q - vec2f(0.004 * side, 0.118)) / vec2f(0.050, 0.018));
  let shape = min(min(heel, ball), toes);
  return -0.018 * (1.0 - smoothstep(0.55, 1.0, shape)) + 0.004 * smoothstep(0.9, 1.15, shape) * (1.0 - smoothstep(1.15, 1.6, shape));
}
// normal tilt of the footprints and how much of a print covers the point
fn footprints(p: vec2f) -> vec3f {
  let e = 0.01;
  let d0 = footprintDepth(p);
  let dx = footprintDepth(p + vec2f(e, 0.0)) - d0;
  let dz = footprintDepth(p + vec2f(0.0, e)) - d0;
  return vec3f(-dx / e, -dz / e, sat(-d0 / 0.018));
}
`;
