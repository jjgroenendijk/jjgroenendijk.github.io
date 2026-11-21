// Ocean surface (refraction, screen-space reflections, foam) and floating
// particles, rendered on top of a copy of the opaque scene.
import { HDR, depthState } from './layouts.js';
import { bindGroup, bindLayout, entry, flags, shader } from '../core/gpu.js';
import { particleWGSL, reflectionWGSL, waterWGSL } from '../shaders/water.js';

// The reflection pass draws one fullscreen triangle, each particle a two-triangle quad.
const ADDITIVE = { alpha: { dstFactor: 'one', srcFactor: 'one' }, color: { dstFactor: 'one', srcFactor: 'one' } },
  FULLSCREEN_VERTICES = 3,
  PARTICLES = 2400,
  QUAD_VERTICES = 6;

export class WaterPass {
  refl;
  reflGroup;
  reflView;
  sceneGroup;

  constructor(device, shared) {
    this.device = device;
    this.shared = shared;
    this.sceneLayout = bindLayout(device, 'water-scene', [entry.texture(), entry.texture('depth'), entry.texture()]);
    this.reflLayout = bindLayout(device, 'water-reflection', [
      entry.texture(),
      entry.texture('depth'),
      entry.sampler(),
    ]);
    this.reflPipeline = this.createReflectionPipeline();
    this.pipeline = this.createWaterPipeline();
    this.particlePipeline = this.createParticlePipeline();
  }

  createReflectionPipeline() {
    const refl = shader(this.device, reflectionWGSL, 'water-reflection');
    return this.device.createRenderPipelineAsync({
      fragment: { entryPoint: 'fs', module: refl, targets: [{ format: HDR }] },
      label: 'water-reflection',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.shared.frame, this.reflLayout] }),
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vs', module: refl },
    });
  }

  createWaterPipeline() {
    const water = shader(this.device, waterWGSL, 'water');
    return this.device.createRenderPipelineAsync({
      depthStencil: depthState(false),
      fragment: { entryPoint: 'fs', module: water, targets: [{ format: HDR }] },
      label: 'water',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.shared.frame, this.shared.shadow, this.sceneLayout],
      }),
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: { entryPoint: 'vs', module: water },
    });
  }

  createParticlePipeline() {
    const particles = shader(this.device, particleWGSL, 'particles');
    return this.device.createRenderPipelineAsync({
      depthStencil: depthState(false),
      fragment: { entryPoint: 'fs', module: particles, targets: [{ blend: ADDITIVE, format: HDR }] },
      label: 'particles',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.shared.frame, this.shared.shadow] }),
      vertex: { entryPoint: 'vs', module: particles },
    });
  }

  resize(targets) {
    this.refl?.destroy();
    this.refl = this.device.createTexture({
      format: HDR,
      label: 'water-reflection',
      size: [Math.max(1, Math.floor(targets.width / 2)), Math.max(1, Math.floor(targets.height / 2))],
      usage: flags(GPUTextureUsage.RENDER_ATTACHMENT, GPUTextureUsage.TEXTURE_BINDING),
    });
    this.reflView = this.refl.createView();
    this.sceneGroup = bindGroup(
      this.device,
      this.sceneLayout,
      [targets.views.sceneCopy, targets.views.depth, this.reflView],
      'water-scene',
    );
    this.reflGroup = bindGroup(
      this.device,
      this.reflLayout,
      [targets.views.sceneCopy, targets.views.depth, this.shared.linear],
      'water-reflection-in',
    );
  }

  // Screen-space reflections of the scene copy, at half resolution.
  renderReflection(encoder, frameGroup) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store', view: this.reflView }],
      label: 'water-reflection',
    });
    pass.setPipeline(this.reflPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.reflGroup);
    pass.draw(FULLSCREEN_VERTICES);
    pass.end();
  }

  // eslint-disable-next-line max-params -- renderer.js calls encode with these five positional arguments
  encode(encoder, targets, frameGroup, shadowGroup, terrain) {
    encoder.copyTextureToTexture({ texture: targets.hdr }, { texture: targets.sceneCopy }, [
      targets.width,
      targets.height,
    ]);
    this.renderReflection(encoder, frameGroup);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ loadOp: 'load', storeOp: 'store', view: targets.views.hdr }],
      depthStencilAttachment: { depthReadOnly: true, view: targets.views.depth },
      label: 'water',
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, shadowGroup);
    pass.setBindGroup(2, this.sceneGroup);
    terrain.drawCulled(pass);
    pass.setPipeline(this.particlePipeline);
    pass.draw(QUAD_VERTICES, PARTICLES);
    pass.end();
  }
}
