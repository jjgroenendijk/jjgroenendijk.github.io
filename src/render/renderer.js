// Frame orchestration: owns every pass and records one command buffer per frame.
//
//   bake terrain cache -> cloud shadow map -> scatter props -> shadow cascades -> clouds
//   -> opaque (terrain, props, sky) -> water + particles
//   -> volumetric light -> TAA -> bloom -> composite
import { bindGroup } from '../core/gpu.js';
import { mat4, vec3, frustumPlanes, halton } from '../core/math.js';
import { W } from '../world/noise.js';
import { buildMeshes } from '../scene/meshes.js';
import { createShared } from './layouts.js';
import { Targets } from './targets.js';
import { FrameUniforms } from './frameUniforms.js';
import { TerrainPass } from './terrainPass.js';
import { PropsPass } from './propsPass.js';
import { ShadowPass, SPLITS } from './shadowPass.js';
import { SkyPass } from './skyPass.js';
import { WaterPass } from './waterPass.js';
import { PostPass } from './postPass.js';
import { CloudMapPass } from './cloudMapPass.js';

const NEAR = 0.1;

export function cameraBasis(yaw, pitch, roll) {
  const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  let right = vec3.normalize(vec3.cross(fwd, [0, 1, 0]));
  let up = vec3.cross(right, fwd);
  const c = Math.cos(roll), s = Math.sin(roll);
  [right, up] = [vec3.add(vec3.scale(right, c), vec3.scale(up, s)), vec3.sub(vec3.scale(up, c), vec3.scale(right, s))];
  return { fwd, right, up };
}

export class Renderer {
  constructor(gpu, quality) {
    const device = gpu.device;
    this.gpu = gpu;
    this.device = device;
    this.quality = quality;
    this.shared = createShared(device);
    this.uniforms = new FrameUniforms(device);
    this.targets = new Targets(device, quality.cloudDiv);
    this.terrain = new TerrainPass(device, this.shared);
    this.props = new PropsPass(device, this.shared, buildMeshes(), quality);
    this.cloudMap = new CloudMapPass(device, this.shared);
    this.shadows = new ShadowPass(device, this.shared, quality.shadowSize, this.cloudMap.view);
    this.sky = new SkyPass(device, this.shared);
    this.water = new WaterPass(device, this.shared);
    this.post = new PostPass(device, this.shared, gpu.format);
    this.frameGroup = bindGroup(device, this.shared.frame, [this.uniforms.buffer, this.terrain.cacheView], 'frame');
    this.cacheGroup = this.terrain.cacheBindGroup(this.uniforms.buffer);
    this.frame = 0;
    this.history = 0;
    this.prev = null;
    this.resetHistory = true;
    this.skip = new Set(quality.skip || []); // debugging aid: passes to leave out
  }

  resize(width, height) {
    if (!this.targets.resize(width, height)) return;
    this.sky.resize(this.targets);
    this.water.resize(this.targets);
    this.post.resize(this.targets);
    this.resetHistory = true;
  }

  render(shot, env, time, fade) {
    const t = this.targets;
    const aspect = t.width / t.height;
    const fovY = 2 * Math.atan(Math.tan((shot.fov * Math.PI) / 360) / Math.pow(Math.min(aspect, 1), 0.6));
    const { fwd, right, up } = cameraBasis(shot.yaw, shot.pitch, shot.roll);
    const pos = shot.pos;

    // matrices (camera-relative: the camera sits at the origin)
    const n = (this.frame % 16) + 1;
    const jitter = [(halton(n, 2) - 0.5) * 2 / t.width, (halton(n, 3) - 0.5) * 2 / t.height];
    const view = mat4.viewFromBasis(right, up, fwd);
    const projNJ = mat4.perspectiveReverseZ(fovY, aspect, NEAR);
    const proj = mat4.perspectiveReverseZ(fovY, aspect, NEAR, jitter[0], jitter[1]);
    const viewProj = mat4.multiply(proj, view);
    const viewProjNJ = mat4.multiply(projNJ, view);
    let prevViewProj = viewProjNJ;
    if (this.prev) {
      const d = vec3.sub(pos, this.prev.pos);
      for (const k of [0, 2]) { if (d[k] > W / 2) d[k] -= W; if (d[k] < -W / 2) d[k] += W; }
      prevViewProj = mat4.multiply(this.prev.viewProjNJ, mat4.translation(d[0], d[1], d[2]));
    }

    const levels = this.terrain.updateLevels(pos, this.frame === 0);
    const frustum = frustumPlanes(viewProjNJ);
    const terrainDraws = this.terrain.visibleDraws(frustum);
    this.shadows.update({ pos, fwd, fov: fovY, aspect }, env.lightDir, this.frame);

    this.uniforms.write({
      viewProj, invViewProj: mat4.invert(viewProj), prevViewProj, viewProjNoJitter: viewProjNJ,
      camPos: pos, camFwd: fwd, underwater: shot.underwater, time, env,
      waterLevel: shot.water, width: t.width, height: t.height, jitter, resetHistory: this.resetHistory,
      frame: this.frame, cycleU: shot.u, quality: this.quality.level, splits: [...SPLITS, 0],
      cascades: this.shadows.matrices, frustum, levels: levels.data,
      modes: shot.modes, cacheMask: levels.mask, fade, vegDist: this.props.vegDist,
      cloudMap: this.cloudMap.origin(pos, env.lightDir),
    });


    const encoder = this.device.createCommandEncoder();
    const on = (name) => !this.skip.has(name);
    if (levels.mask && on('bake')) {
      const pass = encoder.beginComputePass({ label: 'terrain-bake' });
      this.terrain.bake(pass, this.cacheGroup);
      pass.end();
    }
    this.cloudMap.encode(encoder, this.frameGroup);
    if (on('scatter')) this.props.scatter(encoder, this.frameGroup);
    if (on('shadows')) this.shadows.encode(encoder, this.frameGroup, this.terrain, this.props, this.frame);
    if (on('clouds')) this.sky.renderClouds(encoder, t, this.frameGroup);

    const main = encoder.beginRenderPass({
      label: 'opaque',
      colorAttachments: [{ view: t.views.hdr, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      depthStencilAttachment: { view: t.views.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    // props first: they hide much of the (expensive to shade) ground
    if (on('props')) this.props.draw(main, this.frameGroup, this.shadows.sampleGroup);
    if (on('terrain')) this.terrain.draw(main, this.frameGroup, this.shadows.sampleGroup, terrainDraws);
    if (on('sky')) this.sky.draw(main, this.frameGroup);
    main.end();

    if (on('water')) this.water.encode(encoder, t, this.frameGroup, this.shadows.sampleGroup, this.terrain, terrainDraws);
    const out = this.gpu.context.getCurrentTexture().createView();
    this.post.encode(encoder, t, this.frameGroup, this.shadows.sampleGroup, out, this.history);
    this.device.queue.submit([encoder.finish()]);

    this.prev = { pos: [...pos], viewProjNJ };
    this.history = 1 - this.history;
    this.resetHistory = false;
    this.frame++;
  }
}
