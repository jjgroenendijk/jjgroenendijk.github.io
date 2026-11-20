import { frameStruct, commonLib, shadowLib, shadowLibSimple } from './common.js';
import { GRID_M } from './terrain.js';

export const waterWGSL = frameStruct + commonLib + shadowLib + /* wgsl */ `
@group(2) @binding(0) var sceneTex: texture_2d<f32>;
@group(2) @binding(1) var depthTex: texture_depth_2d;

struct WV2 {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) crest: f32,
};

@vertex fn vs(@location(0) g: vec2f, @builtin(instance_index) lvl: u32) -> WV2 {
  let Lv = F.levels[lvl];
  let a = max(abs(g.x), abs(g.y)) / ${GRID_M}.0;
  var morph = smoothstep(0.70, 0.90, a);
  if (Lv.w > 0.5) { morph = 0.0; }
  let odd = g - 2.0 * floor(g * 0.5);
  let gm = g - odd * morph;
  let xz = Lv.xy + gm * Lv.z;
  let dist = length(xz - F.camPos.xz);
  let w = gerstner(xz, F.camPos.w, dist);
  var o: WV2;
  o.rel = vec3f(xz.x + w.disp.x - F.camPos.x, w.disp.y - F.camPos.y, xz.y + w.disp.z - F.camPos.z);
  o.n = w.n;
  o.crest = w.disp.y;
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
  let rg = rippleNormal(pw.xz, t, near);
  var n = normalize(in.n + vec3f(-rg.x, 0.0, -rg.y));
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
      // total internal reflection: reflect the deep water
      col = F.waterFog.rgb * 0.8;
    } else {
      let fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, nd), 0.0), 5.0);
      col = skyBase(refr) * (1.0 - fres) * 0.9 + F.waterFog.rgb * fres;
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
  // vertical depth below this point (for shore effects) approximated from view thickness
  let vdepth = thick * max(-rd.y, 0.08);
  let behind = sceneAt(ruv);
  let T = exp(-WATER_EXT * min(thick, 400.0) * 1.1);
  var refrC = behind * T + waterScatter() * (1.0 - T);

  // reflection: screen space march with sky fallback
  var R = reflect(rd, n);
  R.y = abs(R.y);
  var refl = skyBase(R);
  var hit = false;
  var st = 0.6;
  var tt = st;
  for (var i = 0; i < 18; i++) {
    let q = in.rel + R * tt;
    let s = toScreen(q);
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z < 0.0) { break; }
    let sdq = sceneDist(vec2i(s.xy * F.res.xy));
    let lq = length(q);
    if (sdq < lq && sdq > lq - tt * 0.35 - 1.0) {
      let edge = sat(min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)) * 8.0);
      refl = mix(refl, sceneAt(s.xy), edge);
      hit = true;
      break;
    }
    st *= 1.38;
    tt += st;
  }
  if (!hit) {
    let s = toScreen(R * 8000.0);
    if (s.z > 0.0 && s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0) {
      let d = textureLoad(depthTex, vec2i(s.xy * F.res.xy), 0);
      if (d <= 0.0) {
        let edge = sat(min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)) * 6.0);
        refl = mix(refl, sceneAt(s.xy), edge);
      }
    }
  }
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  var col = mix(refrC, refl, fres);
  let sh = shadowAt(in.rel, vec3f(0.0, 1.0, 0.0), in.pos.xy) * cloudShadow(pw);
  col += F.lightColor.rgb * ggx(n, V, L, 0.07 + 0.25 * (1.0 - near)) * sh * 0.9;

  // foam: shoreline bands and crests
  let fn1 = fbm(pw.xz + vec2f(t * 0.6, t * 0.4) % 512.0, 2048, 3, 301u);
  let shore = 1.0 - smoothstep(0.0, 1.4, vdepth + fn1 * 0.8);
  let bands = sat(sin(vdepth * 7.0 - t * 1.4 + fn1 * 6.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.0, 0.9, vdepth));
  let crest = smoothstep(0.22, 0.4, in.crest + fn1 * 0.3) * near;
  let foam = sat(max(shore * (0.55 + 0.45 * smoothstep(0.1, 0.5, fn1 + 0.3)), bands * 0.5) + crest * 0.45) * smoothstep(0.0, 0.05, thick);
  let foamLit = (F.lightColor.rgb * max(L.y, 0.0) * sh + F.skyAmb.rgb) * 0.85;
  col = mix(col, foamLit, foam * 0.9);
  col = applyFog(col, in.rel);
  return vec4f(col, 1.0);
}
`;

// Floating particles: marine snow underwater, sunlit dust motes in the jungle.
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
  if (uw > 0.5) {
    col = (F.waterFog.rgb * 6.0 + lightAt(pw) * 0.15) * 0.55;
  } else if (land > 0.1 && pw.y > 0.0) {
    let sh = shadowPoint(p);
    col = F.lightColor.rgb * sh * 0.9 * land * vec3f(1.0, 0.9, 0.6);
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
