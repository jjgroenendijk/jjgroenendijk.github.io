// Caustics on the sea floor near the camera: photons refracted through the
// animated water surface are splatted into a map every frame.
import { CAUSTIC_N, CAUSTIC_SPAN, PHOTONS, causticResolveWGSL, causticSplatWGSL } from '../shaders/lighting.js';
import { at, bindGroup, bindLayout, buffer, entry, flags, shader } from '../core/gpu.js';

// The photon accumulator holds one atomic u32 per map texel, at a binding above those the shared WGSL libraries
// declare. Above MAX_ALTITUDE the sea floor detail is too small to matter, and below MIN_SUN_HEIGHT (the light
// direction's y) there is too little sun to cast caustics. Both compute shaders run 8x8 workgroups.
const ACCUMULATOR_BYTES_PER_TEXEL = 4,
  MAX_ALTITUDE = 150,
  MIN_SUN_HEIGHT = 0.02,
  PHOTON_BINDING = 6,
  TEXEL = CAUSTIC_SPAN / CAUSTIC_N,
  WORKGROUP = 8,
  snap = (v) => Math.floor(v / TEXEL) * TEXEL - CAUSTIC_SPAN / 2;

export class CausticsPass {
  active;
  resolveGroup;
  resolvePipeline;
  splatGroup;
  splatPipeline;

  constructor(device, frameBuffer, cacheView) {
    this.texture = device.createTexture({
      format: 'rgba16float',
      label: 'caustics',
      size: [CAUSTIC_N, CAUSTIC_N],
      usage: flags(GPUTextureUsage.STORAGE_BINDING, GPUTextureUsage.TEXTURE_BINDING),
    });
    this.view = this.texture.createView();
    this.photons = buffer(
      device,
      CAUSTIC_N * CAUSTIC_N * ACCUMULATOR_BYTES_PER_TEXEL,
      flags(GPUBufferUsage.STORAGE, GPUBufferUsage.COPY_DST),
      'caustic-photons',
    );
    this.createSplat(device, frameBuffer, cacheView);
    this.createResolve(device);
  }

  createSplat(device, frameBuffer, cacheView) {
    const layout = bindLayout(device, 'caustic-splat', [
      entry.uniform(),
      entry.texture('unfilterable-float', '2d-array', GPUShaderStage.COMPUTE),
      at(PHOTON_BINDING, entry.storage()),
    ]);
    this.splatGroup = bindGroup(
      device,
      layout,
      [frameBuffer, cacheView, at(PHOTON_BINDING, this.photons)],
      'caustic-splat',
    );
    this.splatPipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, causticSplatWGSL, 'caustic-splat') },
      label: 'caustic-splat',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    });
  }

  createResolve(device) {
    const layout = bindLayout(device, 'caustic-resolve', [entry.storage(true), entry.storageTexture('rgba16float')]);
    this.resolveGroup = bindGroup(device, layout, [this.photons, this.view], 'caustic-resolve');
    this.resolvePipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, causticResolveWGSL, 'caustic-resolve') },
      label: 'caustic-resolve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    });
  }

  // Map placement for the frame uniforms: [origin x, origin z, 1 / span, valid].
  // The origin snaps to texels so the pattern does not swim as the camera moves.
  placement(cam, lightDirection) {
    this.active = cam[1] < MAX_ALTITUDE && lightDirection[1] > MIN_SUN_HEIGHT;
    return [snap(cam[0]), snap(cam[2]), 1 / CAUSTIC_SPAN, Number(this.active)];
  }

  encode(encoder) {
    if (!this.active) return;
    encoder.clearBuffer(this.photons);
    const pass = encoder.beginComputePass({ label: 'caustics' });
    pass.setPipeline(this.splatPipeline);
    pass.setBindGroup(0, this.splatGroup);
    pass.dispatchWorkgroups(PHOTONS / WORKGROUP, PHOTONS / WORKGROUP);
    pass.setPipeline(this.resolvePipeline);
    pass.setBindGroup(0, this.resolveGroup);
    pass.dispatchWorkgroups(CAUSTIC_N / WORKGROUP, CAUSTIC_N / WORKGROUP);
    pass.end();
  }
}
