import { frameStruct, commonLib, shadowLib, shadowLibSimple } from './common.js';
import { GRID_M, SIDE, cacheLib } from './terrain.js';
import { WAVES, RIPPLES } from '../world/waves.js';

export const waterWGSL = frameStruct + commonLib + shadowLib + /* wgsl */ `
@group(2) @binding(0) var sceneTex: texture_2d<f32>;
@group(2) @binding(1) var depthTex: texture_depth_2d;
@group(2) @binding(2) var reflTex: texture_2d<f32>;

${cacheLib}

struct WV2 {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) crest: f32,
  @location(3) surf: f32,
};

fn groundAt(lvl: u32, g: vec2i) -> f32 { return cacheFetch(lvl, g).x; }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> WV2 {
  // same grid layout as the terrain (see gridPoint)
  let lvl = vi / ${SIDE * SIDE}u;
  let k = vi - lvl * ${SIDE * SIDE}u;
  let g = vec2f(f32(k % ${SIDE}u) - ${GRID_M}.0, f32(k / ${SIDE}u) - ${GRID_M}.0);
  let Lv = F.levels[lvl];
  let a = max(abs(g.x), abs(g.y)) / ${GRID_M}.0;
  var morph = smoothstep(0.70, 0.90, a);
  if (Lv.w > 0.5) { morph = 0.0; }
  let odd = g - 2.0 * floor(g * 0.5);
  let gm = g - odd * morph;
  let xz = Lv.xy + gm * Lv.z;
  let dist = length(xz - F.camPos.xz);
  let t = F.camPos.w;
  var w = gerstner(xz, t, dist);
  // the water knows how deep it is (from the terrain cache)
  let ground = mix(groundAt(lvl, vec2i(g)), groundAt(lvl, vec2i(g - odd)), morph);
  let depth = max(-ground, 0.0);
  // waves die out in very shallow water and steepen where they start to feel the bottom
  let shoal = smoothstep(0.0, 2.2, depth);
  let steep = 1.0 + 0.7 * (1.0 - smoothstep(1.5, 9.0, depth));
  w.disp = vec3f(w.disp.x * shoal, w.disp.y * shoal * steep, w.disp.z * shoal);
  // rolling surf: crests marching towards the beach and breaking
  let jitter = gnoise(xz * (512.0 / W), 512, 311u) * 3.0;
  let ph = depth * 1.5 + t * 1.15 + jitter;
  let surf = pow(sat(sin(ph) * 0.5 + 0.5), 5.0) * smoothstep(4.5, 1.4, depth) * smoothstep(0.05, 0.6, depth);
  w.disp.y += surf * 0.4;
  var o: WV2;
  o.rel = vec3f(xz.x + w.disp.x - F.camPos.x, w.disp.y - F.camPos.y, xz.y + w.disp.z - F.camPos.z);
  o.n = normalize(mix(vec3f(0.0, 1.0, 0.0), w.n, max(shoal, 0.15)));
  o.crest = w.disp.y;
  o.surf = surf;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  return o;
}

fn sceneDist(px: vec2i) -> f32 {
  let d = textureLoad(depthTex, px, 0);
  if (d <= 0.0) { return 1e6; }
  let uv = (vec2f(px) + 0.5) * F.res.zw;
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  let w = F.invViewProj * ndc;
  return length(w.xyz / w.w);
}
fn toScreen(rel: vec3f) -> vec3f {
  let c = F.viewProj * vec4f(rel, 1.0);
  let n = c.xyz / c.w;
  return vec3f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5, c.w);
}
fn sceneAt(uv: vec2f) -> vec3f { return textureSampleLevel(sceneTex, linSmp, uv, 0.0).rgb; }

// Slope variance of the waves and ripples faded out at this distance (they
// get too small for the pixel). Kept as roughness instead of dropped, so the
// far sea keeps its sheen and widening sun path instead of turning into a
// flat mirror (LEADR-style).
fn unresolvedSlopeVar(dist: f32, near: f32) -> f32 {
  var v = 0.0;
  for (var i = 0; i < ${WAVES.length}; i++) {
    let w = WV[i];
    let k = length(w.xy);
    let f = sat(1.0 - dist / (TAU / k * 14.0));
    v += 0.5 * k * k * w.z * w.z * (1.0 - f * f);
  }
  for (var i = 0; i < ${RIPPLES.length}; i++) {
    let w = RP[i];
    v += 0.5 * dot(w.xy, w.xy) * w.z * w.z * (1.0 - near * near);
  }
  return v;
}

// Wind on the sea is patchy: gusts roughen the surface, calm slicks smooth
// it. Large drifting patches that break up the uniform far water. 0.4..1.6
fn windPatch(p: vec2f, t: f32) -> f32 {
  let q = p + vec2f(t * 3.0, t * 1.3) % W;
  let g = fbm(q, 48, 3, 331u) + 0.5 * fbm(q * vec2f(1.0, 0.35), 96, 2, 337u);
  return clamp(1.0 + g * 1.6, 0.4, 1.6);
}

fn waterScatter() -> vec3f {
  return (F.lightColor.rgb * max(F.lightDir.y, 0.0) * 0.55 + F.skyAmb.rgb * 0.8) * vec3f(0.006, 0.06, 0.12);
}

@fragment fn fs(in: WV2, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let pw = in.rel + F.camPos.xyz;
  let dist = length(in.rel);
  let rd = in.rel / dist;
  let V = -rd;
  let t = F.camPos.w;
  let near = 1.0 - smoothstep(20.0, 260.0, dist);
  let gust = windPatch(pw.xz, t);
  let rg = rippleNormal(pw.xz, t, near) * gust;
  var n = normalize(in.n + vec3f(-rg.x, 0.0, -rg.y));
  // ggx alpha from the unresolved slopes (Beckmann: alpha^2 = 2 sigma^2)
  let alpha = sqrt(0.0025 + 2.0 * unresolvedSlopeVar(dist, near) * gust);
  let px = vec2i(in.pos.xy);
  let uv = in.pos.xy * F.res.zw;
  let L = F.lightDir.xyz;
  let under = F.camPos.y < waveY(F.camPos.xz, t) - 0.02 || F.camFwd.w > 0.5;

  if (under) {
    // looking up at the surface from below: Snell's window
    let nd = -n;
    let refr = refract(rd, nd, 1.33);
    var col: vec3f;
    if (dot(refr, refr) < 1e-4) {
      // total internal reflection: the surface mirrors the lit water column
      col = F.waterFog.rgb * 2.2 + F.lightColor.rgb * exp(-WATER_EXT * 6.0) * 0.04;
    } else {
      let fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, nd), 0.0), 5.0);
      col = skyBase(refr) * (1.0 - fres) * 0.9 + F.waterFog.rgb * 2.2 * fres;
      col += F.lightColor.rgb * pow(max(dot(refr, L), 0.0), 600.0) * 30.0;
    }
    col = applyFog(col, in.rel);
    return vec4f(col, 1.0);
  }

  // ---- above water
  let sd0 = sceneDist(px);
  var thick = max(sd0 - dist, 0.0);
  let off = n.xz * 0.045 * sat(thick * 0.25) / (1.0 + dist * 0.015);
  var ruv = uv + off;
  var rpx = vec2i(clamp(ruv * F.res.xy, vec2f(0.0), F.res.xy - 1.0));
  var sd = sceneDist(rpx);
  if (sd < dist) { ruv = uv; sd = sd0; }
  thick = max(sd - dist, 0.0);
  // vertical water depth under this point: the seabed seen through it lies at camY + rd.y * sd
  let vdepth = select(max(pw.y - (F.camPos.y + rd.y * sd), 0.0), 50.0, sd > 1e5);
  let behind = sceneAt(ruv);
  let T = exp(-WATER_EXT * min(thick, 400.0) * 1.1);
  var refrC = behind * T + waterScatter() * (1.0 - T);

  // reflection: traced at half resolution against the smooth swell (see
  // reflectionWGSL); the ripples here only shift where it is looked up
  var R = reflect(rd, n);
  R.y = abs(R.y);
  var Rs = reflect(rd, normalize(in.n));
  Rs.y = abs(Rs.y);
  let D = clamp(dist * 0.3, 4.0, 40.0);
  let shift = clamp(toScreen(in.rel + R * D).xy - toScreen(in.rel + Rs * D).xy, vec2f(-0.04), vec2f(0.04));
  let rt = textureSampleLevel(reflTex, linSmp, uv + shift, 0.0);
  // a rough sea reflects the sky from a spread of slopes, on average higher
  // than the mirror direction: the horizon water is a little darker and
  // bluer than the sky just above it
  let Rsky = normalize(vec3f(R.x, R.y + alpha * 0.6, R.z));
  let refl = mix(skyBase(Rsky), rt.rgb, rt.a);
  // Fresnel averaged over the slopes (rough Schlick): no white mirror at grazing angles
  let fres = 0.02 + (max(1.0 - alpha * 1.6, 0.02) - 0.02) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  var col = mix(refrC, refl, fres);
  let sh = shadowAt(in.rel, vec3f(0.0, 1.0, 0.0), in.pos.xy) * cloudShadow(pw);
  // sun glitter: the wider lobe far away draws the long sun path
  col += F.lightColor.rgb * ggx(n, V, L, sqrt(alpha)) * sh * 0.6;
  // and sparkles nearby where single ripple facets catch the sun
  let fq0 = pw.xz * 3.0 + vec2f(t * 0.7, t * 0.4);
  let glint = pow(hf(hashu(u32(floor(fq0.x)) * 7919u + u32(floor(fq0.y)) * 104729u + u32(t * 6.0))), 60.0);
  col += F.lightColor.rgb * glint * ggx(n, V, L, 0.35) * sh * 0.25 * near;

  // foam: shoreline bands and crests
  let fn1 = fbm(pw.xz + vec2f(t * 0.6, t * 0.4) % 512.0, 2048, 3, 301u);
  let shore = 1.0 - smoothstep(0.0, 0.35, vdepth + fn1 * 0.25);
  let bands = pow(sat(sin(vdepth * 9.0 - t * 1.4 + fn1 * 6.0) * 0.5 + 0.5), 4.0) * (1.0 - smoothstep(0.0, 0.6, vdepth));
  let crest = smoothstep(0.6, 0.95, in.crest + fn1 * 0.3) * (1.0 - smoothstep(50.0, 140.0, dist));
  let surfFoam = smoothstep(0.25, 0.8, in.surf + fn1 * 0.4) * (0.6 + 0.4 * smoothstep(-0.1, 0.3, fn1));
  let foam = sat(max(shore * (0.4 + 0.6 * smoothstep(0.0, 0.4, fn1 + 0.25)), bands * 0.45) + crest * 0.35 + surfFoam * 0.85) * smoothstep(0.0, 0.03, thick);
  // lacy foam texture: a network of thin bright strands with holes in between
  let fq = pw.xz * (16384.0 / W) + vec2f(t * 0.25, -t * 0.18) % 16384.0;
  let lace = smoothstep(0.55, 0.9, 1.0 - abs(gnoise(fq, 16384, 321u)) - 0.5 * abs(gnoise(fq * 2.3 + 7.0, 32768, 323u)));
  let foamTex = mix(0.3, 1.0, lace);
  let foamLit = (F.lightColor.rgb * max(L.y, 0.0) * sh + F.skyAmb.rgb) * 0.85;
  col = mix(col, foamLit, sat(foam * foamTex) * 0.9);
  col = applyFog(col, in.rel);
  return vec4f(col, 1.0);
}
`;

// Floating particles: marine snow underwater, sunlit dust motes in the jungle.
// Half resolution reflection trace: each pixel's view ray is intersected with
// the swell (sea plane + large Gerstner waves) and marched through the depth
// buffer. Output: reflected colour and confidence (0 = use the sky).
export const reflectionWGSL = frameStruct + commonLib + /* wgsl */ `
@group(1) @binding(0) var sceneTex: texture_2d<f32>;
@group(1) @binding(1) var depthTex: texture_depth_2d;
@group(1) @binding(2) var smp: sampler;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32(i & 1u) * 4.0 - 1.0, f32(i >> 1u) * 4.0 - 1.0, 0.0, 1.0);
}
fn sceneDist(px: vec2i) -> f32 {
  let d = textureLoad(depthTex, px, 0);
  if (d <= 0.0) { return 1e6; }
  let uv = (vec2f(px) + 0.5) * F.res.zw;
  let w = F.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  return length(w.xyz / w.w);
}
fn toScreen(rel: vec3f) -> vec3f {
  let c = F.viewProj * vec4f(rel, 1.0);
  let n = c.xyz / c.w;
  return vec3f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5, c.w);
}
fn sceneAt(uv: vec2f) -> vec3f { return textureSampleLevel(sceneTex, smp, uv, 0.0).rgb; }

@fragment fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let t = F.camPos.w;
  if (F.camPos.y < waveY(F.camPos.xz, t) - 0.02 || F.camFwd.w > 0.5) { return vec4f(0.0); }
  let uv = fp.xy / vec2f(textureDimensions(sceneTex)) * 2.0;
  let w = F.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1e-4, 1.0);
  let rd = normalize(w.xyz / w.w);
  if (rd.y > -1e-4) { return vec4f(0.0); }
  let dist = -F.camPos.y / rd.y;
  // the sea is hidden here by something in front of it
  if (sceneDist(vec2i(uv * F.res.xy)) < dist * 0.97 - 2.0) { return vec4f(0.0); }
  let q0 = rd * dist;
  let wv = gerstner(q0.xz + F.camPos.xz, t, dist);
  let rel = q0 + vec3f(0.0, wv.disp.y, 0.0);
  var R = reflect(rd, wv.n);
  R.y = abs(R.y);
  var st = 0.6;
  var tt = st;
  for (var i = 0; i < 18; i++) {
    let q = rel + R * tt;
    let s = toScreen(q);
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z < 0.0) { break; }
    let sdq = sceneDist(vec2i(s.xy * F.res.xy));
    let lq = length(q);
    if (sdq < lq && sdq > lq - tt * 0.35 - 1.0) {
      let edge = sat(min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)) * 8.0);
      return vec4f(sceneAt(s.xy), edge);
    }
    st *= 1.38;
    tt += st;
  }
  // nothing hit: the sky as drawn (clouds included) where it is on screen
  let s = toScreen(R * 8000.0);
  if (s.z > 0.0 && s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0) {
    if (textureLoad(depthTex, vec2i(s.xy * F.res.xy), 0) <= 0.0) {
      return vec4f(sceneAt(s.xy), sat(min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)) * 6.0));
    }
  }
  return vec4f(0.0);
}
`;

export const particleWGSL = frameStruct + commonLib + /* wgsl */ `
@group(1) @binding(0) var shadowTex: texture_depth_2d_array;
@group(1) @binding(1) var shadowSmp: sampler_comparison;
@group(1) @binding(2) var linSmp: sampler;
${shadowLibSimple}
struct PO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PO {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[vi];
  let uw = F.camFwd.w;
  let land = F.extra.z;
  let B = mix(26.0, 18.0, uw);
  let t = F.camPos.w;
  let h = vec3f(hf(ii * 3u), hf(ii * 3u + 1u), hf(ii * 3u + 2u));
  let drift = vec3f(sin(t * 0.13 + h.x * 20.0) * 0.4 + t * 0.05, sin(t * 0.21 + h.y * 30.0) * 0.3 - t * 0.02 * uw, cos(t * 0.17 + h.z * 25.0) * 0.4);
  let p = (fract(h - F.camPos.xyz / B + drift / B) - 0.5) * B;
  let fwd = F.camFwd.xyz;
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let size = mix(0.018, 0.012, uw) * (0.6 + h.x * 0.8);
  let rel = p + (right * c.x + up * c.y) * size * (1.0 + length(p) * 0.04);
  var o: PO;
  o.pos = F.viewProj * vec4f(rel, 1.0);
  o.uv = c;
  let fade = smoothstep(B * 0.5, B * 0.25, length(p)) * smoothstep(0.3, 1.5, length(p));
  var col = vec3f(0.0);
  let pw = p + F.camPos.xyz;
  let night = F.sunDir.w;
  let blink = pow(sat(sin(t * (0.6 + h.y * 1.4) + h.z * 40.0)), 6.0);
  if (uw > 0.5) {
    // marine snow by day, bioluminescent plankton at night
    col = (F.waterFog.rgb * 6.0 + lightAt(pw) * 0.15) * 0.55 * (1.0 - night * 0.7);
    col += vec3f(0.15, 0.55, 1.0) * 0.5 * blink * night * step(h.x, 0.35);
  } else if (land > 0.1 && pw.y > 0.0) {
    // sunlit pollen by day, fireflies at night
    let sh = shadowPoint(p);
    col = F.lightColor.rgb * sh * 0.9 * land * vec3f(1.0, 0.9, 0.6) * (1.0 - night);
    col += vec3f(0.75, 1.0, 0.35) * 0.4 * blink * land * night * step(h.x, 0.3);
  }
  o.col = col * fade;
  if (dot(o.col, o.col) < 1e-8) { o.pos = vec4f(0.0, 0.0, -1.0, 1.0); }
  return o;
}
@fragment fn fs(in: PO) -> @location(0) vec4f {
  let a = pow(sat(1.0 - dot(in.uv, in.uv)), 2.0);
  return vec4f(in.col * a, 0.0);
}
`;
