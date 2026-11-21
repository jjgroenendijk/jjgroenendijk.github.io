// Frame orchestration: owns every pass and records one command buffer per frame.
//
//   bake terrain cache (new texels only) -> sky lighting (when the sky changed)
//   -> caustics -> cloud shadow map -> (bake impostor cards, once)
//   -> flocking fish and birds -> scatter props + cull terrain tiles (frustum + last frame's Hi-Z)
//   -> shadow cascades (cached) -> clouds -> prop visibility buffer (IDs + depth)
//   -> opaque (resolve props, terrain, sky)
//   -> Hi-Z depth pyramid -> half-res reflections -> water + particles
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
import { HiZPass } from './hizPass.js';
import { SkyLightPass } from './skyLightPass.js';
import { CausticsPass } from './causticsPass.js';
import { FlockPass } from './flockPass.js';
import { GroundMaterials } from './groundMaterials.js';
import { LeafTextures } from './leafTextures.js';
import { PropsVisibility } from './propsVisibility.js';

const NEAR = 0.1;

function cameraBasis(yaw, pitch, roll) {
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
    this.ground = new GroundMaterials(device);
    this.terrain = new TerrainPass(device, this.shared, this.ground);
    this.flock = new FlockPass(device, this.shared);
    this.leaves = new LeafTextures(device);
    this.props = new PropsPass(device, this.shared, buildMeshes(), quality, this.flock.state, this.leaves);
    this.propsVis = new PropsVisibility(device, this.shared, this.props);
    this.cloudMap = new CloudMapPass(device, this.shared);
    this.shadows = new ShadowPass(device, this.shared, quality.shadowSize, this.cloudMap.view);
    this.sky = new SkyPass(device, this.shared);
    this.water = new WaterPass(device, this.shared);
    this.post = new PostPass(device, this.shared, gpu.format);
    this.hiz = new HiZPass(device);
    this.skyLight = new SkyLightPass(device, this.uniforms.buffer);
    this.caustics = new CausticsPass(device, this.uniforms.buffer, this.terrain.cacheView);
    this.frameGroup = bindGroup(device, this.shared.frame, [this.uniforms.buffer, this.terrain.cacheView,
      this.skyLight.lutView, this.skyLight.shView, this.caustics.view, this.shared.frameSampler], 'frame');
    this.cacheGroup = this.terrain.cacheBindGroup(this.uniforms.buffer);
    this.frame = 0;
    this.history = 0;
    this.prev = null;
    this.resetHistory = true;
    this.skip = new Set(quality.skip || []); // debugging aid: passes to leave out
  }

  // Pipelines are created with create*PipelineAsync, so the browser compiles
  // them off its GPU thread and the page (and the loader) keeps animating.
  // The passes hold promises until this swaps in the compiled pipelines.
  async init() {
    const jobs = [this.ground.ready, this.leaves.ready];
    for (const part of Object.values(this)) {
      if (!part || typeof part !== 'object') continue;
      for (const [k, v] of Object.entries(part)) {
        if (v instanceof Promise) jobs.push(v.then((p) => { part[k] = p; }));
        else if (Array.isArray(v) && v.some((x) => x instanceof Promise)) jobs.push(Promise.all(v).then((a) => { part[k] = a; }));
      }
    }
    await Promise.all(jobs);
    return this;
  }

  resize(width, height) {
    if (!this.targets.resize(width, height)) return;
    this.sky.resize(this.targets);
    this.propsVis.resize(this.targets);
    this.water.resize(this.targets);
    this.post.resize(this.targets);
    this.hiz.resize(this.targets);
    this.props.setHiZ(this.hiz.view);
    this.terrain.setHiZ(this.hiz.view);
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
    // last frame's depth is useless for occlusion after a cut or a big turn
    const cut = !this.prev || this.resetHistory || vec3.length(vec3.sub(pos, this.prev.pos)) > 30 || vec3.dot(fwd, this.prev.fwd) < 0.9;
    this.shadows.update({ pos, fwd, fov: fovY, aspect }, env.lightDir, this.frame);

    this.uniforms.write({
      viewProj, invViewProj: mat4.invert(viewProj), prevViewProj, viewProjNoJitter: viewProjNJ,
      camPos: pos, camFwd: fwd, underwater: shot.underwater, time, env,
      waterLevel: shot.water, width: t.width, height: t.height, jitter, resetHistory: this.resetHistory, noOcclusion: cut,
      frame: this.frame, cycleU: shot.u, quality: this.quality.level, splits: [...SPLITS, 0],
      cascades: this.shadows.matrices, frustum, levels: levels.data,
      modes: shot.modes, fade, vegDist: this.props.vegDist,
      cloudMap: this.cloudMap.origin(pos, env.lightDir),
      caustic: this.caustics.placement(pos, env.lightDir),
    });


    const encoder = this.device.createCommandEncoder();
    const on = (name) => !this.skip.has(name);
    if (on('bake')) {
      const pass = encoder.beginComputePass({ label: 'terrain-bake' });
      this.terrain.bake(pass, this.cacheGroup);
      pass.end();
    }
    this.skyLight.encode(encoder, env);
    if (on('caustics')) this.caustics.encode(encoder);
    this.cloudMap.encode(encoder, this.frameGroup);
    this.props.bakeCards(encoder, this.frameGroup);
    if (on('flock')) this.flock.encode(encoder, this.frameGroup, time);
    if (on('scatter')) this.props.scatter(encoder, this.frameGroup, this.frame);
    this.terrain.cull(encoder, this.frameGroup);
    if (on('shadows')) this.shadows.encode(encoder, this.frameGroup, this.terrain, this.props);
    if (on('clouds')) this.sky.renderClouds(encoder, t, this.frameGroup);

    // props first: they hide much of the (expensive to shade) ground
    this.propsVis.encode(encoder, t, this.frameGroup, this.shadows.sampleGroup, on('props'));
    const main = encoder.beginRenderPass({
      label: 'opaque',
      colorAttachments: [{ view: t.views.hdr, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      depthStencilAttachment: { view: t.views.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    if (on('props')) this.propsVis.resolve(main, this.frameGroup, this.shadows.sampleGroup);
    if (on('terrain')) this.terrain.draw(main, this.frameGroup, this.shadows.sampleGroup);
    if (on('sky')) this.sky.draw(main, this.frameGroup);
    main.end();

    this.hiz.encode(encoder);
    if (on('water')) this.water.encode(encoder, t, this.frameGroup, this.shadows.sampleGroup, this.terrain);
    const out = this.gpu.context.getCurrentTexture().createView();
    this.post.encode(encoder, t, this.frameGroup, this.shadows.sampleGroup, out, this.history);
    this.device.queue.submit([encoder.finish()]);

    this.prev = { pos: [...pos], fwd, viewProjNJ };
    this.history = 1 - this.history;
    this.resetHistory = false;
    this.frame++;
  }
}
