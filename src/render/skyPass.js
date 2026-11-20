// Sky: volumetric clouds at reduced resolution, accumulated over frames, then
// sun, moon, stars and the far ocean are drawn behind everything that wrote
// depth in the main pass.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { cloudWGSL, skyWGSL } from '../shaders/sky.js';
import { HDR, depthState } from './layouts.js';

export class SkyPass {
  constructor(device, shared) {
    this.device = device;
    this.shared = shared;
    const clouds = shader(device, cloudWGSL, 'clouds');
    this.skyLayout = bindLayout(device, 'sky', [entry.texture(), entry.sampler()]);
    this.cloudPipeline = device.createRenderPipeline({
      label: 'clouds',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.skyLayout] }),
      vertex: { module: clouds, entryPoint: 'vs' },
      fragment: { module: clouds, entryPoint: 'fs', targets: [{ format: HDR }] },
    });
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
    // groups[i] samples clouds[i]; frame i writes clouds[i] while reading clouds[1 - i]
    this.groups = targets.views.clouds.map((v) => bindGroup(this.device, this.skyLayout, [v, this.shared.linear], 'clouds'));
    this.current = 0;
  }

  renderClouds(encoder, targets, frameGroup) {
    this.current = 1 - this.current;
    const pass = encoder.beginRenderPass({
      label: 'clouds',
      colorAttachments: [{ view: targets.views.clouds[this.current], loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(this.cloudPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.groups[1 - this.current]);
    pass.draw(3);
    pass.end();
  }

  draw(pass, frameGroup) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.groups[this.current]);
    pass.draw(3);
  }
}
