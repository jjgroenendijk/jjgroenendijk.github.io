// Sky: volumetric clouds at quarter resolution, then sun, moon, stars and the
// far ocean are drawn behind everything that wrote depth in the main pass.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { cloudWGSL, skyWGSL } from '../shaders/sky.js';
import { HDR, depthState } from './layouts.js';

export class SkyPass {
  constructor(device, shared) {
    this.device = device;
    this.shared = shared;
    const clouds = shader(device, cloudWGSL, 'clouds');
    this.cloudPipeline = device.createRenderPipeline({
      label: 'clouds',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame] }),
      vertex: { module: clouds, entryPoint: 'vs' },
      fragment: { module: clouds, entryPoint: 'fs', targets: [{ format: HDR }] },
    });
    this.skyLayout = bindLayout(device, 'sky', [entry.texture(), entry.sampler()]);
    const sky = shader(device, skyWGSL, 'sky');
    this.pipeline = device.createRenderPipeline({
      label: 'sky',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.skyLayout] }),
      vertex: { module: sky, entryPoint: 'vs' },
      fragment: { module: sky, entryPoint: 'fs', targets: [{ format: HDR }] },
      depthStencil: depthState(false, 'equal'),
    });
  }

  resize(targets) {
    this.group = bindGroup(this.device, this.skyLayout, [targets.views.clouds, this.shared.linear], 'sky');
  }

  renderClouds(encoder, targets, frameGroup) {
    const pass = encoder.beginRenderPass({
      label: 'clouds',
      colorAttachments: [{ view: targets.views.clouds, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(this.cloudPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.draw(3);
    pass.end();
  }

  draw(pass, frameGroup) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.group);
    pass.draw(3);
  }
}
