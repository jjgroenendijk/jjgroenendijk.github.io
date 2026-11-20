import { frameStruct, commonLib, shadowLib } from './common.js';

export const GRID_M = 96; // half-size of a clipmap level in cells

// Compute: bake heights, normals and far horizon shadows into a clipmap texture array.
export const terrainCacheWGSL = frameStruct + commonLib + /* wgsl */ `
@group(0) @binding(1) var cacheOut: texture_storage_2d_array<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let lvl = gid.z;
  let mask = u32(F.extra.w);
  if (((mask >> lvl) & 1u) == 0u || gid.x > ${GRID_M * 2}u || gid.y > ${GRID_M * 2}u) { return; }
  let Lv = F.levels[lvl];
  let g = vec2f(f32(gid.x), f32(gid.y)) - ${GRID_M}.0;
  let p = Lv.xy + g * Lv.z;
  let h = terrainHeight(p);
  let e = max(Lv.z, 0.35);
  let hx0 = terrainHeight(p - vec2f(e, 0.0));
  let hx1 = terrainHeight(p + vec2f(e, 0.0));
  let hz0 = terrainHeight(p - vec2f(0.0, e));
  let hz1 = terrainHeight(p + vec2f(0.0, e));
  let n = normalize(vec3f(hx0 - hx1, 2.0 * e, hz0 - hz1));
  var sh = 1.0;
  let L = F.lightDir.xyz;
  if (lvl >= 2u && L.y > -0.05) {
    let dir = normalize(L.xz + vec2f(1e-5));
    let slope = L.y / max(length(L.xz), 1e-3);
    var t = Lv.z * 2.0;
    for (var i = 0; i < 12; i++) {
      let q = p + dir * t;
      let th = baseHeight(q);
      let ry = max(h, 0.0) + 2.0 + t * slope;
      sh = min(sh, sat((ry - th) / (t * 0.06) + 0.5));
      t *= 1.55;
      if (t > 4000.0 || sh < 0.01) { break; }
    }
  }
  textureStore(cacheOut, vec2i(gid.xy), i32(lvl), vec4f(h, n.x, n.z, sh));
}
`;

const terrainVS = /* wgsl */ `
@group(0) @binding(1) var cacheTex: texture_2d_array<f32>;

struct TV {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) misc: vec4f, // horizon shadow, canopy shell factor, forest, unused
};

fn fetchC(lvl: u32, g: vec2i) -> vec4f {
  return textureLoad(cacheTex, clamp(g + vec2i(${GRID_M}), vec2i(0), vec2i(${GRID_M * 2})), lvl, 0);
}

fn terrainVertex(g: vec2f, lvl: u32) -> TV {
  let Lv = F.levels[lvl];
  let a = max(abs(g.x), abs(g.y)) / ${GRID_M}.0;
  var morph = smoothstep(0.70, 0.90, a);
  if (Lv.w > 0.5) { morph = 0.0; }
  let odd = g - 2.0 * floor(g * 0.5);
  let t0 = fetchC(lvl, vec2i(g));
  let t1 = fetchC(lvl, vec2i(g - odd));
  let tt = mix(t0, t1, morph);
  let gm = g - odd * morph;
  let xz = Lv.xy + gm * Lv.z;
  var h = tt.x;
  let nxz = tt.yz;
  let n = vec3f(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
  var rel = vec3f(xz.x - F.camPos.x, h - F.camPos.y, xz.y - F.camPos.z);
  let dist = length(rel.xz);
  let forest = forestDensity(xz) * smoothstep(3.5, 9.0, h);
  let shell = smoothstep(380.0, 720.0, dist);
  let lump = 0.75 + 0.5 * gnoise(xz * (1024.0 / W), 1024, 191u);
  rel.y += shell * forest * 17.0 * lump;
  var o: TV;
  o.rel = rel;
  o.n = n;
  o.misc = vec4f(select(1.0, tt.w, lvl >= 2u), shell, forest, 0.0);
  return o;
}
`;

export const terrainWGSL = frameStruct + commonLib + shadowLib + terrainVS + /* wgsl */ `
@vertex fn vs(@location(0) g: vec2f, @builtin(instance_index) lvl: u32) -> TV {
  var o = terrainVertex(g, lvl);
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  return o;
}

@fragment fn fs(in: TV) -> @location(0) vec4f {
  let pw = in.rel + F.camPos.xyz;
  let h = pw.y;
  let dist = length(in.rel);
  var n = normalize(in.n);
  let near = 1.0 - smoothstep(30.0, 160.0, dist);
  // micro relief
  let q = pw.xz * (4096.0 / W);
  let d1 = vec2f(gnoise(q, 4096, 201u), gnoise(q + 17.0, 4096, 203u));
  let d2 = vec2f(gnoise(q * 4.0, 16384, 205u), gnoise(q * 4.0 + 9.0, 16384, 207u));
  n = normalize(n + vec3f(d1.x + d2.x * 0.5, 0.0, d1.y + d2.y * 0.5) * 0.35 * near);
  // distant rainforest: per-pixel tree crowns (bumps that catch the light, dark gaps between)
  let crownW = in.misc.z * smoothstep(120.0, 450.0, dist) * smoothstep(-0.5, 3.0, h);
  var crownShade = 1.0;
  if (crownW > 0.01) {
    let cq = pw.xz * (2048.0 / W);
    let c0 = gnoise(cq, 2048, 231u) + 0.5 * gnoise(cq * 2.0, 4096, 233u);
    let cx = gnoise(cq + vec2f(0.12, 0.0), 2048, 231u) + 0.5 * gnoise(cq * 2.0 + vec2f(0.24, 0.0), 4096, 233u);
    let cz = gnoise(cq + vec2f(0.0, 0.12), 2048, 231u) + 0.5 * gnoise(cq * 2.0 + vec2f(0.0, 0.24), 4096, 233u);
    n = normalize(n - vec3f(cx - c0, 0.0, cz - c0) * 9.0 * crownW);
    crownShade = mix(1.0, 0.45 + 0.9 * smoothstep(-0.4, 0.5, c0), crownW);
  }
  let slope = 1.0 - n.y;
  let shell = in.misc.y;
  let forest = in.misc.z;

  let mn = fbm(pw.xz, 2048, 3, 211u);
  let big = fbm(pw.xz, 256, 3, 213u);
  // palette
  // palette shifts with the island's character
  let rg = region(pw.xz);
  let sandTone = mix(mix(vec3f(0.86, 0.80, 0.66), vec3f(0.80, 0.66, 0.44), rg.x), vec3f(0.16, 0.15, 0.15), rg.y);
  let sand = sandTone * (0.92 + 0.16 * mn);
  let wetSand = sandTone * vec3f(0.55, 0.53, 0.52);
  let uwSand = mix(vec3f(0.80, 0.75, 0.62), vec3f(0.30, 0.28, 0.27), rg.y * 0.8) * (0.9 + 0.2 * mn);
  var grass = mix(vec3f(0.11, 0.17, 0.05), vec3f(0.20, 0.22, 0.08), sat(big * 2.0 + 0.5));
  grass = mix(grass, mix(vec3f(0.36, 0.30, 0.13), vec3f(0.27, 0.27, 0.12), sat(big * 2.0 + 0.5)), rg.x);
  // near the camera, break the lawn up with leaf litter and bare soil
  let litter = smoothstep(-0.05, 0.25, gnoise(pw.xz * (4096.0 / W), 4096, 241u) + 0.5 * gnoise(pw.xz * (16384.0 / W), 16384, 243u));
  grass = mix(grass, mix(vec3f(0.20, 0.15, 0.08), vec3f(0.14, 0.15, 0.06), mn + 0.5), litter * 0.55);
  let floorC = mix(vec3f(0.17, 0.12, 0.07), vec3f(0.12, 0.17, 0.05), sat(mn * 2.0 + 0.5));
  let rock = mix(mix(vec3f(0.30, 0.27, 0.24), vec3f(0.22, 0.20, 0.19), sat(mn * 2.0 + 0.5)), vec3f(0.09, 0.085, 0.085), rg.y);
  let canopy = mix(vec3f(0.035, 0.09, 0.025), vec3f(0.09, 0.16, 0.04), sat(gnoise(pw.xz * (2048.0 / W), 2048, 217u) * 1.6 + 0.5));

  let beachH = 1.6 + mn * 1.5 + big * 1.0;
  var alb: vec3f;
  if (h < -0.4) {
    let reef = reefMask(pw.xz);
    alb = mix(uwSand, uwSand * vec3f(0.65, 0.6, 0.55), reef * 0.6);
    alb = mix(alb, rock * 0.8, smoothstep(0.35, 0.6, slope));
  } else {
    let landW = smoothstep(beachH - 0.4, beachH + 0.6, h);
    let wet = 1.0 - smoothstep(0.1, 0.9, h);
    var land = mix(grass, floorC, forest * (1.0 - shell) * 0.9);
    land = mix(land, canopy, sat(shell * forest * 1.2));
    land = mix(land, rock, smoothstep(0.42, 0.62, slope + mn * 0.2));
    land = mix(land, rock * 1.1, smoothstep(160.0, 260.0, h + big * 40.0) * 0.7);
    alb = mix(mix(sand, wetSand, wet), land, landW);
  }

  let rd = in.rel / max(dist, 1e-4);
  let V = -rd;
  let L = F.lightDir.xyz;
  var sh = min(shadowAt(in.rel, n, in.pos.xy), in.misc.x) * cloudShadow(pw);
  let nl = max(dot(n, L), 0.0);
  let ao = 1.0 - 0.3 * forest * (1.0 - shell) * smoothstep(1.0, 5.0, h);
  var col = alb * crownShade * (lightAt(pw) * nl * sh + ambientAt(n, pw) * ao);
  // wet sand sheen
  let wetS = (1.0 - smoothstep(0.0, 0.7, h)) * step(-0.4, h);
  col += lightAt(pw) * ggx(n, V, L, 0.25) * wetS * 0.25 * sh;
  // canopy translucency glow at grazing light (far forest)
  col += canopy * F.lightColor.rgb * pow(max(dot(-rd, -L), 0.0), 3.0) * shell * forest * 0.6 * sh;
  col = applyFog(col, in.rel);
  return vec4f(col, 1.0);
}
`;

export const terrainShadowWGSL = frameStruct + commonLib + terrainVS + /* wgsl */ `
struct Cascade { vp: mat4x4f };
@group(1) @binding(0) var<uniform> CS: Cascade;
@vertex fn vs(@location(0) g: vec2f, @builtin(instance_index) lvl: u32) -> @builtin(position) vec4f {
  let o = terrainVertex(g, lvl);
  return CS.vp * vec4f(o.rel, 1.0);
}
`;
