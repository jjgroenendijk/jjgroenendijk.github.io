// Sky: volumetric clouds at reduced resolution, accumulated over frames, then
// sun, moon, stars and the far ocean are drawn behind everything that wrote
// depth in the main pass.
import { HDR, depthState } from './layouts.js';
import { bindGroup, bindLayout, entry, shader } from '../core/gpu.js';
import { cloudWGSL, skyWGSL } from '../shaders/sky.js';

// Both passes draw one fullscreen triangle.
const FULLSCREEN_VERTICES = 3;

export class SkyPass {
  current;
  groups;

  constructor(device, shared) {
    this.device = device;
    this.shared = shared;
    const clouds = shader(device, cloudWGSL, 'clouds');
    this.skyLayout = bindLayout(device, 'sky', [entry.texture(), entry.sampler()]);
    this.cloudPipeline = device.createRenderPipelineAsync({
      fragment: { entryPoint: 'fs', module: clouds, targets: [{ format: HDR }] },
      label: 'clouds',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.skyLayout] }),
      vertex: { entryPoint: 'vs', module: clouds },
    });
    this.pipeline = this.createSkyPipeline();
  }

  createSkyPipeline() {
    const sky = shader(this.device, skyWGSL, 'sky');
    return this.device.createRenderPipelineAsync({
      depthStencil: depthState(false, 'equal'),
      fragment: { entryPoint: 'fs', module: sky, targets: [{ format: HDR }] },
      label: 'sky',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.shared.frame, this.skyLayout] }),
      vertex: { entryPoint: 'vs', module: sky },
    });
  }

  resize(targets) {
    // Groups[i] samples clouds[i]; frame i writes clouds[i] while reading clouds[1 - i]
    this.groups = targets.views.clouds.map((view) =>
      bindGroup(this.device, this.skyLayout, [view, this.shared.linear], 'clouds'),
    );
    this.current = 0;
  }

  renderClouds(encoder, targets, frameGroup) {
    this.current = 1 - this.current;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store', view: targets.views.clouds[this.current] },
      ],
      label: 'clouds',
    });
    pass.setPipeline(this.cloudPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.groups[1 - this.current]);
    pass.draw(FULLSCREEN_VERTICES);
    pass.end();
  }

  draw(pass, frameGroup) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.groups[this.current]);
    pass.draw(FULLSCREEN_VERTICES);
  }
}
