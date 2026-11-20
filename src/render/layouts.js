// Bind group layouts and samplers shared across passes.
import { bindLayout, entry } from '../core/gpu.js';

export function createShared(device) {
  const frame = bindLayout(device, 'frame', [
    entry.uniform(),
    entry.texture('unfilterable-float', '2d-array'), // terrain clipmap cache
  ]);
  const shadow = bindLayout(device, 'shadow', [
    entry.texture('depth', '2d-array'),
    entry.sampler('comparison'),
    entry.sampler('filtering'),
  ]);
  const cascade = bindLayout(device, 'cascade', [entry.uniform(false, GPUShaderStage.VERTEX)]);
  const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const compare = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
  return { frame, shadow, cascade, linear, compare };
}

export const HDR = 'rgba16float';
export const DEPTH = 'depth32float';

// Common pipeline state for camera passes (reverse-Z depth).
export const depthState = (write = true, compare = 'greater') => ({ format: DEPTH, depthWriteEnabled: write, depthCompare: compare });
