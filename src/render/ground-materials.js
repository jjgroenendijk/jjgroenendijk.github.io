// Bakes the ground material textures once at start-up (see shaders/materials.js):
// patterns -> normals and occlusion -> mip chains.
import { GROUND_COUNT, MAT_TEX, groundBakeWGSL, groundDeriveWGSL, groundMipWGSL } from '../shaders/materials.js';
import { bindGroup, bindLayout, entry, flags, shader } from '../core/gpu.js';

// The bake, derive and mip shaders run 8x8 workgroups, one layer per ground material.
const FORMAT = 'rgba8unorm',
  MAX_ANISOTROPY = 8,
  MIPS = Math.log2(MAT_TEX) + 1,
  WORKGROUP = 8,
  compute = () => GPUShaderStage.COMPUTE,
  // Stage is { code, entryPoint }.
  computePipeline = (device, label, layout, stage) =>
    device.createComputePipelineAsync({
      compute: { entryPoint: stage.entryPoint, module: shader(device, stage.code, label) },
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    }),
  mipView = (texture, mip) => texture.createView({ baseMipLevel: mip, dimension: '2d-array', mipLevelCount: 1 }),
  storageUsage = () => flags(GPUTextureUsage.STORAGE_BINDING, GPUTextureUsage.TEXTURE_BINDING),
  workgroups = (size) => [Math.ceil(size / WORKGROUP), Math.ceil(size / WORKGROUP), GROUND_COUNT];

export class GroundMaterials {
  constructor(device) {
    this.device = device;
    const tex = (label) =>
      device.createTexture({
        format: FORMAT,
        label,
        mipLevelCount: MIPS,
        size: [MAT_TEX, MAT_TEX, GROUND_COUNT],
        usage: storageUsage(),
      });
    this.albedo = tex('ground-albedo-height');
    this.surface = tex('ground-normal-rough-ao');
    this.views = [this.albedo, this.surface].map((texture) => texture.createView({ dimension: '2d-array' }));
    // Anisotropic filtering keeps grazing views of the ground sharp
    this.sampler = device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      label: 'ground',
      magFilter: 'linear',
      maxAnisotropy: MAX_ANISOTROPY,
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    // Pipelines compile asynchronously
    this.ready = this.bake();
  }

  async bake() {
    const rough = this.device.createTexture({
        format: FORMAT,
        label: 'ground-rough',
        size: [MAT_TEX, MAT_TEX, GROUND_COUNT],
        usage: storageUsage(),
      }),
      encoder = this.device.createCommandEncoder({ label: 'ground-bake' }),
      pass = encoder.beginComputePass({ label: 'ground-bake' });
    await this.bakeBase(pass, rough);
    await this.bakeDerived(pass, rough);
    await this.bakeMips(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    rough.destroy();
  }

  async bakeBase(pass, rough) {
    const layout = bindLayout(this.device, 'ground-bake', [
      entry.storageTexture(FORMAT, '2d-array'),
      entry.storageTexture(FORMAT, '2d-array'),
    ]);
    pass.setPipeline(
      await computePipeline(this.device, 'ground-bake', layout, { code: groundBakeWGSL, entryPoint: 'main' }),
    );
    pass.setBindGroup(0, bindGroup(this.device, layout, [mipView(this.albedo, 0), mipView(rough, 0)]));
    pass.dispatchWorkgroups(...workgroups(MAT_TEX));
  }

  async bakeDerived(pass, rough) {
    const layout = bindLayout(this.device, 'ground-derive', [
      entry.texture('float', '2d-array', compute()),
      entry.texture('float', '2d-array', compute()),
      entry.storageTexture(FORMAT, '2d-array'),
    ]);
    pass.setPipeline(
      await computePipeline(this.device, 'ground-derive', layout, { code: groundDeriveWGSL, entryPoint: 'main' }),
    );
    pass.setBindGroup(
      0,
      bindGroup(this.device, layout, [mipView(this.albedo, 0), mipView(rough, 0), mipView(this.surface, 0)]),
    );
    pass.dispatchWorkgroups(...workgroups(MAT_TEX));
  }

  async bakeMips(pass) {
    const layout = bindLayout(this.device, 'ground-mip', [
        entry.texture('float', '2d-array', compute()),
        entry.storageTexture(FORMAT, '2d-array'),
      ]),
      // Both mip pipelines compile in parallel
      pipelines = await Promise.all(
        ['albedo', 'surface'].map((entryPoint) =>
          computePipeline(this.device, `ground-mip-${entryPoint}`, layout, { code: groundMipWGSL, entryPoint }),
        ),
      );
    for (const [index, texture] of [this.albedo, this.surface].entries()) {
      pass.setPipeline(pipelines[index]);
      for (let mip = 1; mip < MIPS; mip += 1) {
        pass.setBindGroup(0, bindGroup(this.device, layout, [mipView(texture, mip - 1), mipView(texture, mip)]));
        pass.dispatchWorkgroups(...workgroups(Math.floor(MAT_TEX / 2 ** mip)));
      }
    }
  }
}
