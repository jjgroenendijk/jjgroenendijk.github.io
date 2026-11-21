// Frame orchestration: owns every pass and records one command buffer per frame.
//
//   bake terrain cache (new texels only) -> sky lighting (when the sky changed)
//   -> caustics -> cloud shadow map -> (bake impostor cards, once)
//   -> flocking fish and birds -> scatter props + cull terrain tiles (frustum + last frame's Hi-Z)
//   -> shadow cascades (cached) -> clouds -> prop visibility buffer (IDs + depth)
//   -> opaque (resolve props, terrain, sky)
//   -> Hi-Z depth pyramid -> half-res reflections -> water + particles
//   -> volumetric light -> TAA -> bloom -> composite
import { SPLITS, ShadowPass } from './shadow-pass.js';
import { frustumPlanes, halton, mat4, vec3 } from '../core/math.js';
import { CausticsPass } from './caustics-pass.js';
import { CloudMapPass } from './cloud-map-pass.js';
import { FlockPass } from './flock-pass.js';
import { FrameUniforms } from './frame-uniforms.js';
import { GroundMaterials } from './ground-materials.js';
import { HiZPass } from './hiz-pass.js';
import { LeafTextures } from './leaf-textures.js';
import { PostPass } from './post-pass.js';

import { PropsPass } from './props-pass.js';

import { PropsVisibility } from './props-visibility.js';
import { SkyLightPass } from './sky-light-pass.js';
import { SkyPass } from './sky-pass.js';
import { Targets } from './targets.js';
import { TerrainPass } from './terrain-pass.js';
import { W } from '../world/noise.js';
import { WaterPass } from './water-pass.js';
import { bindGroup } from '../core/gpu.js';
import { buildMeshes } from '../scene/meshes.js';
import { createShared } from './layouts.js';

// A camera cut (or a big turn) invalidates last frame's depth for occlusion: moved further (m) or turned past this
// cosine.
const CUT = { distance: 30, turnCos: 0.9 },
  // Degrees in a full turn: fov * PI / 360 is half the vertical fov in radians.
  DEGREES_PER_TURN = 360,
  // TAA jitter: a Halton (2, 3) sequence repeating every `period` frames.
  JITTER = { period: 16, xBase: 2, yBase: 3 },
  NEAR = 0.1,
  // Portrait screens widen the vertical fov by aspect^-PORTRAIT_FOV_EXPONENT.
  PORTRAIT_FOV_EXPONENT = 0.6,
  // Resolves a pending promise into `part[key]`.
  assignResolved = async (part, key, pending) => {
    part[key] = await pending;
  },
  // Camera axes from yaw and pitch, then rolled about the forward axis.
  cameraBasis = (yaw, pitch, roll) => {
    const c = Math.cos(roll),
      fwd = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)],
      levelRight = vec3.normalize(vec3.cross(fwd, [0, 1, 0])),
      levelUp = vec3.cross(levelRight, fwd),
      s = Math.sin(roll);
    return {
      fwd,
      right: vec3.add(vec3.scale(levelRight, c), vec3.scale(levelUp, s)),
      up: vec3.sub(vec3.scale(levelUp, c), vec3.scale(levelRight, s)),
    };
  },
  // Promises (or arrays of them) a part holds until its pipelines compile, each settling into its field.
  pendingFields = (part) =>
    Object.entries(part).flatMap(([key, value]) => {
      if (value instanceof Promise) return [assignResolved(part, key, value)];
      if (Array.isArray(value) && value.some((x) => x instanceof Promise))
        return [assignResolved(part, key, Promise.all(value))];
      return [];
    }),
  // Sub-pixel TAA offset in clip space for this frame.
  taaJitter = (frame, width, height) => {
    const n = (frame % JITTER.period) + 1;
    return [((halton(n, JITTER.xBase) - 0.5) * 2) / width, ((halton(n, JITTER.yBase) - 0.5) * 2) / height];
  },
  // Shortest offset in the wrapping world.
  unwrapped = (d) => {
    for (const k of [0, 2]) {
      if (d[k] > W / 2) d[k] -= W;
      if (d[k] < -W / 2) d[k] += W;
    }
    return d;
  };

export class Renderer {
  // Passes, created by the constructor's helpers.
  caustics;
  cloudMap;
  flock;
  ground;
  hiz;
  leaves;
  post;
  props;
  propsVis;
  shadows;
  sky;
  skyLight;
  terrain;
  water;
  // Last frame's camera, for reprojection and cut detection.
  prev;

  constructor(gpu, quality) {
    const { device } = gpu;
    this.gpu = gpu;
    this.device = device;
    this.quality = quality;
    this.shared = createShared(device);
    this.uniforms = new FrameUniforms(device);
    this.targets = new Targets(device, quality.cloudDiv);
    this.createScenePasses(device, quality);
    this.createLightingPasses(device, gpu.format);
    this.frameGroup = bindGroup(
      device,
      this.shared.frame,
      [
        this.uniforms.buffer,
        this.terrain.cacheView,
        this.skyLight.lutView,
        this.skyLight.shView,
        this.caustics.view,
        this.shared.frameSampler,
      ],
      'frame',
    );
    this.cacheGroup = this.terrain.cacheBindGroup(this.uniforms.buffer);
    this.frame = 0;
    this.history = 0;
    this.resetHistory = true;
    // Debugging aid: passes to leave out.
    this.skip = new Set(quality.skip || []);
  }

  createScenePasses(device, quality) {
    this.ground = new GroundMaterials(device);
    this.terrain = new TerrainPass(device, this.shared, this.ground);
    this.flock = new FlockPass(device, this.shared);
    this.leaves = new LeafTextures(device);
    this.props = new PropsPass(device, this.shared, quality, {
      flockState: this.flock.state,
      leaves: this.leaves,
      meshes: buildMeshes(),
    });
    this.propsVis = new PropsVisibility(device, this.shared, this.props);
    this.cloudMap = new CloudMapPass(device, this.shared);
    this.shadows = new ShadowPass(device, this.shared, quality.shadowSize, this.cloudMap.view);
  }

  createLightingPasses(device, format) {
    this.sky = new SkyPass(device, this.shared);
    this.water = new WaterPass(device, this.shared);
    this.post = new PostPass(device, this.shared, format);
    this.hiz = new HiZPass(device);
    this.skyLight = new SkyLightPass(device, this.uniforms.buffer);
    this.caustics = new CausticsPass(device, this.uniforms.buffer, this.terrain.cacheView);
  }

  // Pipelines are created with create*PipelineAsync, so the browser compiles
  // them off its GPU thread and the page (and the loader) keeps animating.
  // The passes hold promises until this swaps in the compiled pipelines.
  async init() {
    const parts = Object.values(this).filter((part) => part && typeof part === 'object');
    await Promise.all([this.ground.ready, this.leaves.ready, ...parts.flatMap((part) => pendingFields(part))]);
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

  render(shot, environment, time, fade) {
    const view = this.viewState(shot);
    this.writeFrame(shot, view, environment, { fade, time });
    this.encodeFrame(environment, time);
    this.prev = { fwd: view.fwd, pos: [...shot.pos], viewProjNJ: view.viewProjNJ };
    this.history = 1 - this.history;
    this.resetHistory = false;
    this.frame += 1;
  }

  // Matrices (camera-relative: the camera sits at the origin).
  viewState(shot) {
    const { height, width } = this.targets,
      aspect = width / height,
      basis = cameraBasis(shot.yaw, shot.pitch, shot.roll),
      fovY =
        2 * Math.atan(Math.tan((shot.fov * Math.PI) / DEGREES_PER_TURN) / Math.min(aspect, 1) ** PORTRAIT_FOV_EXPONENT),
      jitter = taaJitter(this.frame, width, height),
      proj = mat4.perspectiveReverseZ(fovY, aspect, NEAR, jitter[0], jitter[1]),
      projNJ = mat4.perspectiveReverseZ(fovY, aspect, NEAR),
      view = mat4.viewFromBasis(basis.right, basis.up, basis.fwd),
      viewProj = mat4.multiply(proj, view),
      viewProjNJ = mat4.multiply(projNJ, view);
    return {
      aspect,
      fovY,
      fwd: basis.fwd,
      jitter,
      prevViewProj: this.reprojection(shot.pos, viewProjNJ),
      viewProj,
      viewProjNJ,
    };
  }

  // Last frame's unjittered view-projection, moved into this frame's camera-relative space.
  reprojection(pos, viewProjNJ) {
    if (!this.prev) return viewProjNJ;
    const d = unwrapped(vec3.sub(pos, this.prev.pos));
    return mat4.multiply(this.prev.viewProjNJ, mat4.translation(d[0], d[1], d[2]));
  }

  // Last frame's depth is useless for occlusion after a cut or a big turn.
  isCut(pos, fwd) {
    return (
      !this.prev ||
      this.resetHistory ||
      vec3.length(vec3.sub(pos, this.prev.pos)) > CUT.distance ||
      vec3.dot(fwd, this.prev.fwd) < CUT.turnCos
    );
  }

  writeFrame(shot, view, environment, { fade, time }) {
    const { pos } = shot,
      frustum = frustumPlanes(view.viewProjNJ),
      isCut = this.isCut(pos, view.fwd),
      levels = this.terrain.updateLevels(pos, this.frame === 0);
    this.shadows.update({ aspect: view.aspect, fov: view.fovY, fwd: view.fwd, pos }, environment.lightDir, this.frame);
    this.uniforms.write({
      camFwd: view.fwd,
      camPos: pos,
      cascades: this.shadows.matrices,
      caustic: this.caustics.placement(pos, environment.lightDir),
      cloudMap: this.cloudMap.origin(pos, environment.lightDir),
      cycleU: shot.u,
      env: environment,
      fade,
      frame: this.frame,
      frustum,
      height: this.targets.height,
      invViewProj: mat4.invert(view.viewProj),
      jitter: view.jitter,
      levels: levels.data,
      modes: shot.modes,
      noOcclusion: isCut,
      prevViewProj: view.prevViewProj,
      quality: this.quality.level,
      resetHistory: this.resetHistory,
      splits: [...SPLITS, 0],
      time,
      underwater: shot.underwater,
      vegDist: this.props.vegDist,
      viewProj: view.viewProj,
      viewProjNoJitter: view.viewProjNJ,
      waterLevel: shot.water,
      width: this.targets.width,
    });
  }

  isEnabled(name) {
    return !this.skip.has(name);
  }

  encodeFrame(environment, time) {
    const encoder = this.device.createCommandEncoder();
    if (this.isEnabled('bake')) this.encodeBake(encoder);
    this.skyLight.encode(encoder, environment);
    if (this.isEnabled('caustics')) this.caustics.encode(encoder);
    this.cloudMap.encode(encoder, this.frameGroup);
    this.props.bakeCards(encoder, this.frameGroup);
    if (this.isEnabled('flock')) this.flock.encode(encoder, this.frameGroup, time);
    if (this.isEnabled('scatter')) this.props.scatter(encoder, this.frameGroup, this.frame);
    this.terrain.cull(encoder, this.frameGroup);
    if (this.isEnabled('shadows')) this.shadows.encode(encoder, this.frameGroup, this.terrain, this.props);
    if (this.isEnabled('clouds')) this.sky.renderClouds(encoder, this.targets, this.frameGroup);
    this.encodeScene(encoder);
    this.device.queue.submit([encoder.finish()]);
  }

  encodeBake(encoder) {
    const pass = encoder.beginComputePass({ label: 'terrain-bake' });
    this.terrain.bake(pass, this.cacheGroup);
    pass.end();
  }

  // Props first: they hide much of the (expensive to shade) ground.
  encodeScene(encoder) {
    const t = this.targets,
      { sampleGroup } = this.shadows;
    this.propsVis.encode(encoder, t, { frame: this.frameGroup, shadow: sampleGroup }, this.isEnabled('props'));
    this.encodeOpaque(encoder, sampleGroup);
    this.hiz.encode(encoder);
    if (this.isEnabled('water')) this.water.encode(encoder, t, this.frameGroup, sampleGroup, this.terrain);
    this.post.encode(
      encoder,
      t,
      this.frameGroup,
      sampleGroup,
      this.gpu.context.getCurrentTexture().createView(),
      this.history,
    );
  }

  // The opaque pass: resolves the props, then draws terrain and sky into the depth the props left.
  encodeOpaque(encoder, sampleGroup) {
    const { views } = this.targets,
      main = encoder.beginRenderPass({
        colorAttachments: [{ clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store', view: views.hdr }],
        depthStencilAttachment: { depthLoadOp: 'load', depthStoreOp: 'store', view: views.depth },
        label: 'opaque',
      });
    if (this.isEnabled('props')) this.propsVis.resolve(main, this.frameGroup, sampleGroup);
    if (this.isEnabled('terrain')) this.terrain.draw(main, this.frameGroup, sampleGroup);
    if (this.isEnabled('sky')) this.sky.draw(main, this.frameGroup);
    main.end();
  }
}
