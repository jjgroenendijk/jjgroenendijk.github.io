// Baked lighting: the sky's radiance and irradiance (once per time-of-day
// step) and caustics from photons refracted through the animated water surface.
import { commonLibrary, frameStruct, waveArray } from './common.js';
import { CAUSTIC_WAVES } from '../world/waves.js';
import { cacheLibrary } from './terrain.js';

// Sky radiance LUT size (width, height in texels).
const SKY_LUT_WIDTH = 128,
  SKY_LUT_HEIGHT = 64,
  SKY_LUT = [SKY_LUT_WIDTH, SKY_LUT_HEIGHT],
  // The irradiance bake integrates SH_DIRS^2 directions.
  SH_DIRS = 32,
  // Bindings 0-5 of group 0 are the frame's (see common.js); the bakes write to 6+.
  skyBakeWGSL = /* wgsl */ `${frameStruct}${commonLibrary}
@group(0) @binding(6) var lutOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var shOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn lut(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${SKY_LUT[0]}u || gid.y >= ${SKY_LUT[1]}u) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(${SKY_LUT[0]}.0, ${SKY_LUT[1]}.0);
  textureStore(lutOut, vec2i(gid.xy), vec4f(skyRadiance(skyLutDir(uv)), 1.0));
}

// Project the upper hemisphere's radiance onto SH9, convolve with the cosine
// lobe and normalise by the irradiance of an upward surface.
var<workgroup> acc: array<array<vec3f, 9>, 64>;
@compute @workgroup_size(64)
fn irradiance(@builtin(local_invocation_index) li: u32) {
  var c: array<vec3f, 9>;
  for (var k = li; k < ${SH_DIRS * SH_DIRS}u; k += 64u) {
    // equal-area directions: uniform in azimuth and in height
    let y = (f32(k / ${SH_DIRS}u) + 0.5) / ${SH_DIRS}.0 * 2.0 - 1.0;
    if (y <= 0.0) { continue; }
    let az = (f32(k % ${SH_DIRS}u) + 0.5) / ${SH_DIRS}.0 * TAU;
    let r = sqrt(1.0 - y * y);
    let d = vec3f(r * cos(az), y, r * sin(az));
    let L = skyRadiance(d);
    let b = sh9(d);
    for (var i = 0; i < 9; i++) { c[i] += L * b[i]; }
  }
  acc[li] = c;
  workgroupBarrier();
  if (li != 0u) { return; }
  var sum: array<vec3f, 9>;
  for (var t = 0u; t < 64u; t++) { for (var i = 0; i < 9; i++) { sum[i] += acc[t][i]; } }
  // cosine lobe per band (pi, 2pi/3, pi/4) and the solid angle per direction
  let band = array<f32, 9>(PI, 2.0 * PI / 3.0, 2.0 * PI / 3.0, 2.0 * PI / 3.0, PI / 4.0, PI / 4.0, PI / 4.0, PI / 4.0, PI / 4.0);
  let dw = 4.0 * PI / ${SH_DIRS * SH_DIRS}.0;
  let up = sh9(vec3f(0.0, 1.0, 0.0));
  var eUp = vec3f(0.0);
  for (var i = 0; i < 9; i++) { sum[i] *= band[i] * dw; eUp += sum[i] * up[i]; }
  for (var i = 0; i < 9; i++) { textureStore(shOut, vec2i(i, 0), vec4f(sum[i] / max(eUp, vec3f(1e-8)), 1.0)); }
}
`,
  // Caustic map texels per side.
  CAUSTIC_N = 256,
  // Metres covered by the caustic map.
  CAUSTIC_SPAN = 64,
  // Photons per side.
  PHOTONS = 512,
  // Photon weight in fixed point; bilinear splatting keeps the total per photon.
  UNIT = 256,
  causticSplatWGSL = /* wgsl */ `${frameStruct}${commonLibrary}${cacheLibrary}
@group(0) @binding(6) var<storage, read_write> acc: array<atomic<u32>>;
${waveArray('CW', CAUSTIC_WAVES)}
fn causticSlope(p: vec2f, t: f32) -> vec2f {
  var g = vec2f(0.0);
  for (var i = 0; i < ${CAUSTIC_WAVES.length}; i++) {
    let w = CW[i];
    g += w.xy * w.z * cos(dot(w.xy, p) - w.w * t);
  }
  return g;
}

fn deposit(x: i32, y: i32, w: f32) {
  if (x < 0 || y < 0 || x >= ${CAUSTIC_N} || y >= ${CAUSTIC_N}) { return; }
  atomicAdd(&acc[u32(y) * ${CAUSTIC_N}u + u32(x)], u32(w * ${UNIT}.0 + 0.5));
}

// Each photon leaves the light, refracts at the wave surface above its grid
// point and lands on the sea floor below; focused photons pile up into caustics.
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${PHOTONS}u || gid.y >= ${PHOTONS}u) { return; }
  let span = 1.0 / F.caustic.z;
  let x = F.caustic.xy + (vec2f(gid.xy) + 0.5) * (span / ${PHOTONS}.0);
  let t = F.camPos.w;
  let w = gerstner(x, t, 0.0);
  let s = x + w.disp.xz;
  let rg = rippleNormal(s, t, 1.0) + causticSlope(s, t);
  let n = normalize(w.n + vec3f(-rg.x, 0.0, -rg.y));
  let r = refract(-F.lightDir.xyz, n, 1.0 / 1.33);
  let depth = w.disp.y - cacheHeight(s);
  if (depth < 0.05 || r.y > -0.05) { return; }
  let hit = s + r.xz * (depth / -r.y);
  // texel space, with the texel centres on integers
  let q = (hit - F.caustic.xy) * F.caustic.z * ${CAUSTIC_N}.0 - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  deposit(i.x, i.y, (1.0 - f.x) * (1.0 - f.y));
  deposit(i.x + 1, i.y, f.x * (1.0 - f.y));
  deposit(i.x, i.y + 1, (1.0 - f.x) * f.y);
  deposit(i.x + 1, i.y + 1, f.x * f.y);
}
`,
  // Photon counts to light density relative to a flat surface, lightly blurred.
  causticResolveWGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> acc: array<u32>;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;
fn photons(x: i32, y: i32) -> f32 {
  let c = clamp(vec2i(x, y), vec2i(0), vec2i(${CAUSTIC_N - 1}));
  return f32(acc[u32(c.y) * ${CAUSTIC_N}u + u32(c.x)]);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${CAUSTIC_N}u || gid.y >= ${CAUSTIC_N}u) { return; }
  let x = i32(gid.x); let y = i32(gid.y);
  let v = photons(x, y) * 0.25 + (photons(x - 1, y) + photons(x + 1, y) + photons(x, y - 1) + photons(x, y + 1)) * 0.125
        + (photons(x - 1, y - 1) + photons(x + 1, y - 1) + photons(x - 1, y + 1) + photons(x + 1, y + 1)) * 0.0625;
  let flat = ${UNIT}.0 * ${(PHOTONS / CAUSTIC_N) ** 2}.0;
  textureStore(outTex, vec2i(gid.xy), vec4f(v / flat, 0.0, 0.0, 1.0));
}
`;

export { CAUSTIC_N, CAUSTIC_SPAN, PHOTONS, SKY_LUT, causticResolveWGSL, causticSplatWGSL, skyBakeWGSL };
