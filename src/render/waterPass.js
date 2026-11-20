// Ocean surface (refraction, screen-space reflections, foam) and floating
// particles, rendered on top of a copy of the opaque scene.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { waterWGSL, particleWGSL, reflectionWGSL } from '../shaders/water.js';
import { HDR, depthState } from './layouts.js';

const PARTICLES = 2400;

export class WaterPass {
  constructor(device, shared) {
    this.device = device;
    this.shared = shared;
    this.sceneLayout = bindLayout(device, 'water-scene', [entry.texture(), entry.texture('depth'), entry.texture()]);
    this.reflLayout = bindLayout(device, 'water-reflection', [entry.texture(), entry.texture('depth'), entry.sampler()]);
    const refl = shader(device, reflectionWGSL, 'water-reflection');
    this.reflPipeline = device.createRenderPipeline({
      label: 'water-reflection',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.reflLayout] }),
      vertex: { module: refl, entryPoint: 'vs' },
      fragment: { module: refl, entryPoint: 'fs', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list' },
    });
    const water = shader(device, waterWGSL, 'water');
    this.pipeline = device.createRenderPipeline({
      label: 'water',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow, this.sceneLayout] }),
      vertex: { module: water, entryPoint: 'vs' },
      fragment: { module: water, entryPoint: 'fs', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState(false),
    });
    const particles = shader(device, particleWGSL, 'particles');
    const additive = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    this.particlePipeline = device.createRenderPipeline({
      label: 'particles',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow] }),
      vertex: { module: particles, entryPoint: 'vs' },
      fragment: { module: particles, entryPoint: 'fs', targets: [{ format: HDR, blend: additive }] },
      depthStencil: depthState(false),
    });
  }

  resize(targets) {
    this.refl?.destroy();
    this.refl = this.device.createTexture({
      label: 'water-reflection', size: [Math.max(1, targets.width >> 1), Math.max(1, targets.height >> 1)], format: HDR,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.reflView = this.refl.createView();
    this.sceneGroup = bindGroup(this.device, this.sceneLayout, [targets.views.sceneCopy, targets.views.depth, this.reflView], 'water-scene');
    this.reflGroup = bindGroup(this.device, this.reflLayout, [targets.views.sceneCopy, targets.views.depth, this.shared.linear], 'water-reflection-in');
  }

  encode(encoder, targets, frameGroup, shadowGroup, terrain) {
    encoder.copyTextureToTexture({ texture: targets.hdr }, { texture: targets.sceneCopy }, [targets.width, targets.height]);
    const rp = encoder.beginRenderPass({
      label: 'water-reflection',
      colorAttachments: [{ view: this.reflView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
    });
    rp.setPipeline(this.reflPipeline);
    rp.setBindGroup(0, frameGroup);
    rp.setBindGroup(1, this.reflGroup);
    rp.draw(3);
    rp.end();
    const pass = encoder.beginRenderPass({
      label: 'water',
      colorAttachments: [{ view: targets.views.hdr, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: targets.views.depth, depthReadOnly: true },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, shadowGroup);
    pass.setBindGroup(2, this.sceneGroup);
    terrain.drawCulled(pass);
    pass.setPipeline(this.particlePipeline);
    pass.draw(6, PARTICLES);
    pass.end();
  }
}
