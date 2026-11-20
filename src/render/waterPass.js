// Ocean surface (refraction, screen-space reflections, foam) and floating
// particles, rendered on top of a copy of the opaque scene.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { waterWGSL, particleWGSL } from '../shaders/water.js';
import { HDR, depthState } from './layouts.js';

const PARTICLES = 2400;

export class WaterPass {
  constructor(device, shared) {
    this.device = device;
    this.sceneLayout = bindLayout(device, 'water-scene', [entry.texture(), entry.texture('depth')]);
    const water = shader(device, waterWGSL, 'water');
    this.pipeline = device.createRenderPipeline({
      label: 'water',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow, this.sceneLayout] }),
      vertex: { module: water, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
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
    this.sceneGroup = bindGroup(this.device, this.sceneLayout, [targets.views.sceneCopy, targets.views.depth], 'water-scene');
  }

  encode(encoder, targets, frameGroup, shadowGroup, terrain) {
    encoder.copyTextureToTexture({ texture: targets.hdr }, { texture: targets.sceneCopy }, [targets.width, targets.height]);
    const pass = encoder.beginRenderPass({
      label: 'water',
      colorAttachments: [{ view: targets.views.hdr, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: targets.views.depth, depthReadOnly: true },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, shadowGroup);
    pass.setBindGroup(2, this.sceneGroup);
    terrain.drawGrid(pass);
    pass.setPipeline(this.particlePipeline);
    pass.draw(6, PARTICLES);
    pass.end();
  }
}
