// Caustics on the sea floor near the camera: photons refracted through the
// animated water surface are splatted into a map every frame.
import { shader, buffer, bindLayout, bindGroup, entry, at } from '../core/gpu.js';
import { causticSplatWGSL, causticResolveWGSL, CAUSTIC_N, CAUSTIC_SPAN, PHOTONS } from '../shaders/lighting.js';

const TEXEL = CAUSTIC_SPAN / CAUSTIC_N;
const MAX_ALTITUDE = 150; // above this the sea floor detail is too small to matter

export class CausticsPass {
  constructor(device, frameBuffer, cacheView) {
    this.texture = device.createTexture({
      label: 'caustics',
      size: [CAUSTIC_N, CAUSTIC_N],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.view = this.texture.createView();
    this.photons = buffer(
      device,
      CAUSTIC_N * CAUSTIC_N * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'caustic-photons',
    );
    const C = GPUShaderStage.COMPUTE;
    const splatLayout = bindLayout(device, 'caustic-splat', [
      entry.uniform(),
      entry.texture('unfilterable-float', '2d-array', C),
      at(6, entry.storage()),
    ]);
    this.splatGroup = bindGroup(device, splatLayout, [frameBuffer, cacheView, at(6, this.photons)], 'caustic-splat');
    this.splatPipeline = device.createComputePipelineAsync({
      label: 'caustic-splat',
      layout: device.createPipelineLayout({ bindGroupLayouts: [splatLayout] }),
      compute: { module: shader(device, causticSplatWGSL, 'caustic-splat'), entryPoint: 'main' },
    });
    const resolveLayout = bindLayout(device, 'caustic-resolve', [
      entry.storage(true),
      entry.storageTexture('rgba16float'),
    ]);
    this.resolveGroup = bindGroup(device, resolveLayout, [this.photons, this.view], 'caustic-resolve');
    this.resolvePipeline = device.createComputePipelineAsync({
      label: 'caustic-resolve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [resolveLayout] }),
      compute: { module: shader(device, causticResolveWGSL, 'caustic-resolve'), entryPoint: 'main' },
    });
  }

  // Map placement for the frame uniforms: [origin x, origin z, 1 / span, valid].
  // The origin snaps to texels so the pattern does not swim as the camera moves.
  placement(cam, lightDir) {
    const snap = (v) => Math.floor(v / TEXEL) * TEXEL - CAUSTIC_SPAN / 2;
    this.active = cam[1] < MAX_ALTITUDE && lightDir[1] > 0.02;
    return [snap(cam[0]), snap(cam[2]), 1 / CAUSTIC_SPAN, this.active ? 1 : 0];
  }

  encode(encoder) {
    if (!this.active) return;
    encoder.clearBuffer(this.photons);
    const pass = encoder.beginComputePass({ label: 'caustics' });
    pass.setPipeline(this.splatPipeline);
    pass.setBindGroup(0, this.splatGroup);
    pass.dispatchWorkgroups(PHOTONS / 8, PHOTONS / 8);
    pass.setPipeline(this.resolvePipeline);
    pass.setBindGroup(0, this.resolveGroup);
    pass.dispatchWorkgroups(CAUSTIC_N / 8, CAUSTIC_N / 8);
    pass.end();
  }
}
