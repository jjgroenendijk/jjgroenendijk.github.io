import { frameStruct, commonLib } from './common.js';

export const fullscreenVS = /* wgsl */ `
struct FSO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> FSO {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: FSO;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
`;

const rayDir = /* wgsl */ `
fn viewRay(uv: vec2f) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let a = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  let b = F.invViewProj * vec4f(ndc, 0.5, 1.0);
  return normalize(b.xyz / b.w - a.xyz / a.w);
}
`;

// Volumetric cloud layer, rendered at reduced resolution.
export const cloudWGSL = frameStruct + commonLib + fullscreenVS + rayDir + /* wgsl */ `
const CB: f32 = 1150.0;
const CT: f32 = 2500.0;
fn cloudDensity(p: vec3f, detail: bool) -> f32 {
  let hfr = (p.y - CB) / (CT - CB);
  if (hfr < 0.0 || hfr > 1.0) { return 0.0; }
  let cov = cloudCoverage(p.xz);
  // cumulus: flat base, cauliflower tops that narrow with height
  let base = smoothstep(0.0, 0.08, hfr);
  var d = (cov - 0.05 - hfr * hfr * 0.45) * base;
  if (d <= -0.12) { return 0.0; }
  let t = F.misc.z;
  let q = p * 0.0024 + vec3f(t * 0.004, -t * 0.003, t * 0.003);
  d += (vnoise3(q) - 0.55) * 0.22;
  if (detail) { d -= (1.0 - vnoise3(q * 3.7)) * 0.07 * (1.0 - hfr * 0.5); }
  return sat(d * 2.2) * 0.03;
}
fn hg(mu: f32, g: f32) -> f32 { return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5)); }
@group(1) @binding(0) var prevClouds: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;

@fragment fn fs(in: FSO) -> @location(0) vec4f {
  let rd = viewRay(in.uv);
  let cur = march(in, rd);
  // temporal accumulation: clouds are far away, so reprojecting the view
  // direction alone is accurate even while the camera flies
  let pc = F.prevViewProj * vec4f(rd, 0.0);
  if (pc.w > 0.0 && F.jitter.z < 0.5) {
    let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
    if (all(puv > vec2f(0.0)) && all(puv < vec2f(1.0))) {
      let prev = textureSampleLevel(prevClouds, smp, puv, 0.0);
      return mix(cur, prev, 0.9);
    }
  }
  return cur;
}

fn march(in: FSO, rd: vec3f) -> vec4f {
  if (rd.y < 0.015 || F.camFwd.w > 0.5) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let ro = F.camPos.xyz;
  let t0 = (CB - ro.y) / rd.y;
  let t1 = min((CT - ro.y) / rd.y, t0 + 9000.0);
  let N = i32(mix(18.0, 32.0, F.misc.w));
  let dt = (t1 - t0) / f32(N);
  var t = t0 + dt * ign(in.pos.xy, F.misc.x);
  var T = 1.0;
  var col = vec3f(0.0);
  let L = F.lightDir.xyz;
  let mu = dot(rd, L);
  let ph = mix(hg(mu, 0.65), hg(mu, -0.15), 0.4) * 4.0 * PI;
  let amb = F.skyAmb.rgb;
  for (var i = 0; i < 32; i++) {
    if (i >= N || T < 0.02) { break; }
    let p = ro + rd * t;
    let d = cloudDensity(p, true);
    if (d > 1e-4) {
      var od = 0.0;
      var ls = 70.0;
      var lp = p;
      for (var j = 0; j < 4; j++) {
        lp += L * ls;
        od += cloudDensity(lp, j < 2) * ls;
        ls *= 1.9;
      }
      let hfr = (p.y - CB) / (CT - CB);
      let beer = max(exp(-od), exp(-od * 0.25) * 0.6);
      let powder = 1.0 - exp(-od * 2.0 - 0.1);
      let direct = F.lightColor.rgb * 3.2 * beer * ph * mix(1.0, powder, 0.5);
      let ambient = amb * (0.5 + 1.1 * hfr) * 1.5;
      let S = (direct + ambient) * d;
      let Td = exp(-d * dt);
      col += T * (S - S * Td) / d;
      T *= Td;
    }
    t += dt;
  }
  // fade far clouds into the haze
  let f = exp(-t0 / 26000.0) * smoothstep(0.015, 0.08, rd.y);
  return vec4f(col * f, mix(1.0, T, f));
}
`;

// Sky (sun, moon, stars, distant ocean) composited with the cloud layer.
export const skyWGSL = frameStruct + commonLib + fullscreenVS + rayDir + /* wgsl */ `
@group(1) @binding(0) var cloudTex: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;

fn stars(rd: vec3f) -> vec3f {
  let p = rd * 220.0;
  let c = floor(p);
  let h = hashu((u32(i32(c.x) + 4096) * 73856093u) ^ (u32(i32(c.y) + 4096) * 19349663u) ^ (u32(i32(c.z) + 4096) * 83492791u));
  let r = f32(h & 0xffffu) / 65535.0;
  if (r < 0.985) { return vec3f(0.0); }
  let fp = fract(p) - 0.5;
  let d = length(fp);
  let tw = 0.7 + 0.3 * sin(F.camPos.w * (2.0 + r * 6.0) + r * 100.0);
  let b = pow(sat(1.0 - d * 2.2), 6.0) * tw * (r - 0.985) * 66.0;
  let tint = mix(vec3f(0.75, 0.85, 1.0), vec3f(1.0, 0.85, 0.7), fract(r * 77.0));
  return tint * b;
}

@fragment fn fs(in: FSO) -> @location(0) vec4f {
  let rd = viewRay(in.uv);
  if (F.camFwd.w > 0.5) {
    return vec4f(applyFog(vec3f(0.0), rd * 2000.0), 1.0);
  }
  let E = F.fog.w;
  var col: vec3f;
  if (rd.y >= 0.0) {
    col = skyBase(rd);
    // sun disc with limb darkening
    let sd = dot(rd, F.sunDir.xyz);
    let sunR = 0.99996;
    if (sd > sunR - 0.00004) {
      let k = sat((sd - (sunR - 0.00004)) / 0.00008);
      col += sunTrans(F.sunDir.y) * E * 220.0 * k * k;
    }
    // moon
    let md = dot(rd, F.moonDir.xyz);
    if (md > 0.99985) {
      let k = smoothstep(0.99985, 0.99992, md);
      let crater = 0.85 + 0.15 * vnoise3(rd * 3000.0);
      col += vec3f(0.9, 0.92, 1.0) * 2.2 * k * crater * smoothstep(-0.05, 0.05, F.moonDir.y);
    }
    // faint halo around the moon
    col += vec3f(0.35, 0.4, 0.5) * pow(max(md, 0.0), 600.0) * 0.15 * F.sunDir.w;
    col += stars(rd) * F.moonDir.w * smoothstep(0.0, 0.15, rd.y);
    // smooth upsample of the reduced resolution cloud layer
    let ct = 0.5 / vec2f(textureDimensions(cloudTex));
    let c = (textureSampleLevel(cloudTex, smp, in.uv + vec2f(-ct.x, -ct.y), 0.0) + textureSampleLevel(cloudTex, smp, in.uv + vec2f(ct.x, -ct.y), 0.0)
           + textureSampleLevel(cloudTex, smp, in.uv + vec2f(-ct.x, ct.y), 0.0) + textureSampleLevel(cloudTex, smp, in.uv + vec2f(ct.x, ct.y), 0.0)) * 0.25;
    col = col * c.a + c.rgb;
    // horizon haze
    col = mix(col, fogSkyColor(rd), (1.0 - smoothstep(0.0, 0.06, rd.y)) * 0.6);
  } else {
    // distant ocean beyond the water mesh
    let t = F.camPos.y / max(-rd.y, 1e-4);
    let n = vec3f(0.0, 1.0, 0.0);
    let R = reflect(rd, n);
    let fres = 0.02 + 0.98 * pow(1.0 - max(-rd.y, 0.0), 5.0);
    let deep = (F.lightColor.rgb * max(F.lightDir.y, 0.0) * 0.6 + F.skyAmb.rgb * 0.7) * vec3f(0.006, 0.035, 0.06);
    col = mix(deep, skyBase(R), fres);
    col = applyFog(col, rd * min(t, 60000.0));
  }
  return vec4f(col, 1.0);
}
`;
