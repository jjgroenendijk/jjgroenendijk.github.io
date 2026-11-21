// Bakes the cloud shadow map (see cloudMapWGSL) around the point where the
// camera's light ray meets the cloud layer.
import { CLOUD_ALT, CLOUD_MAP_N, CLOUD_MAP_SPAN } from '../shaders/common.js';
import { bindGroup, bindLayout, entry, flags, shader } from '../core/gpu.js';
import { cloudMapWGSL } from '../shaders/sky.js';

// The light ray's slope is clamped to MIN_LIGHT_HEIGHT so a low sun does not throw the map towards the horizon. The
// bake shader runs 8x8 workgroups.
const MIN_LIGHT_HEIGHT = 0.03,
  WORKGROUP = 8;

export class CloudMapPass {
  constructor(device, shared) {
    this.texel = CLOUD_MAP_SPAN / CLOUD_MAP_N;
    this.texture = device.createTexture({
      format: 'rgba16float',
      label: 'cloud-map',
      size: [CLOUD_MAP_N, CLOUD_MAP_N],
      usage: flags(GPUTextureUsage.STORAGE_BINDING, GPUTextureUsage.TEXTURE_BINDING),
    });
    this.view = this.texture.createView();
    const layout = bindLayout(device, 'cloud-map', [entry.storageTexture('rgba16float')]);
    this.group = bindGroup(device, layout, [this.view], 'cloud-map');
    this.pipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, cloudMapWGSL, 'cloud-map') },
      label: 'cloud-map',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, layout] }),
    });
  }

  // Map origin on the cloud plane, snapped to whole texels so it does not shimmer
  origin(camPos, lightDirection) {
    const k = (CLOUD_ALT - camPos[1]) / Math.max(lightDirection[1], MIN_LIGHT_HEIGHT),
      snap = (v) => Math.round(v / this.texel) * this.texel;
    return [snap(camPos[0] + lightDirection[0] * k), snap(camPos[2] + lightDirection[2] * k), 1 / CLOUD_MAP_SPAN, 0];
  }

  encode(encoder, frameGroup) {
    const pass = encoder.beginComputePass({ label: 'cloud-map' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.group);
    pass.dispatchWorkgroups(CLOUD_MAP_N / WORKGROUP, CLOUD_MAP_N / WORKGROUP);
    pass.end();
  }
}
