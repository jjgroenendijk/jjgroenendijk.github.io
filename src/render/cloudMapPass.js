// Bakes the cloud shadow map (see cloudMapWGSL) around the point where the
// camera's light ray meets the cloud layer.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { cloudMapWGSL } from '../shaders/sky.js';
import { CLOUD_MAP_N, CLOUD_MAP_SPAN, CLOUD_ALT } from '../shaders/common.js';

export class CloudMapPass {
  constructor(device, shared) {
    this.texture = device.createTexture({
      label: 'cloud-map', size: [CLOUD_MAP_N, CLOUD_MAP_N], format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.view = this.texture.createView();
    const layout = bindLayout(device, 'cloud-map', [entry.storageTexture('rgba16float')]);
    this.group = bindGroup(device, layout, [this.view], 'cloud-map');
    this.pipeline = device.createComputePipelineAsync({
      label: 'cloud-map',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, layout] }),
      compute: { module: shader(device, cloudMapWGSL, 'cloud-map'), entryPoint: 'main' },
    });
  }

  // map origin on the cloud plane, snapped to whole texels so it does not shimmer
  origin(camPos, lightDir) {
    const texel = CLOUD_MAP_SPAN / CLOUD_MAP_N;
    const k = (CLOUD_ALT - camPos[1]) / Math.max(lightDir[1], 0.03);
    const snap = (v) => Math.round(v / texel) * texel;
    return [snap(camPos[0] + lightDir[0] * k), snap(camPos[2] + lightDir[2] * k), 1 / CLOUD_MAP_SPAN, 0];
  }

  encode(encoder, frameGroup) {
    const pass = encoder.beginComputePass({ label: 'cloud-map' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.group);
    pass.dispatchWorkgroups(CLOUD_MAP_N / 8, CLOUD_MAP_N / 8);
    pass.end();
  }
}
