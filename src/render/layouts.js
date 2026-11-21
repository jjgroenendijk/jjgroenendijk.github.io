// Bind group layouts and samplers shared across passes.
import { bindLayout, entry } from '../core/gpu.js';

export function createShared(device) {
  const ALL = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
  const frame = bindLayout(device, 'frame', [
    entry.uniform(),
    entry.texture('unfilterable-float', '2d-array', ALL), // terrain clipmap cache
    entry.texture('float', '2d', ALL), // sky radiance LUT
    entry.texture('float', '2d', ALL), // sky irradiance SH9
    entry.texture('float', '2d', ALL), // caustics
    entry.sampler('filtering', ALL),
  ]);
  const shadow = bindLayout(device, 'shadow', [
    entry.texture('depth', '2d-array'),
    entry.sampler('comparison'),
    entry.sampler('filtering'),
    entry.texture(), // cloud shadow map
  ]);
  const cascade = bindLayout(device, 'cascade', [entry.uniform(false, GPUShaderStage.VERTEX)]);
  const linear = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  // wraps around in u: the sky LUT's azimuth
  const frameSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
  });
  const compare = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
  return { frame, shadow, cascade, linear, compare, frameSampler };
}

export const HDR = 'rgba16float';
export const DEPTH = 'depth32float';

// Common pipeline state for camera passes (reverse-Z depth).
export const depthState = (write = true, compare = 'greater') => ({
  format: DEPTH,
  depthWriteEnabled: write,
  depthCompare: compare,
});
