// Bind group layouts and samplers shared across passes.
import { bindLayout, entry, flags } from '../core/gpu.js';

export const DEPTH = 'depth32float',
  HDR = 'rgba16float',
  createShared = (device) => {
    const ALL = flags(GPUShaderStage.VERTEX, GPUShaderStage.FRAGMENT, GPUShaderStage.COMPUTE),
      frame = bindLayout(device, 'frame', [
        entry.uniform(),
        // Terrain clipmap cache
        entry.texture('unfilterable-float', '2d-array', ALL),
        // Sky radiance LUT
        entry.texture('float', '2d', ALL),
        // Sky irradiance SH9
        entry.texture('float', '2d', ALL),
        // Caustics
        entry.texture('float', '2d', ALL),
        entry.sampler('filtering', ALL),
      ]),
      shadow = bindLayout(device, 'shadow', [
        entry.texture('depth', '2d-array'),
        entry.sampler('comparison'),
        entry.sampler('filtering'),
        // Cloud shadow map
        entry.texture(),
      ]),
      cascade = bindLayout(device, 'cascade', [entry.uniform(false, GPUShaderStage.VERTEX)]),
      linear = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
      }),
      // Wraps around in u: the sky LUT's azimuth
      frameSampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
      }),
      compare = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    return { cascade, compare, frame, frameSampler, linear, shadow };
  },
  // Common pipeline state for camera passes (reverse-Z depth).
  depthState = (isWritten = true, compare = 'greater') => ({
    depthCompare: compare,
    depthWriteEnabled: isWritten,
    format: DEPTH,
  });
