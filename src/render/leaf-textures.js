// Bakes the foliage card textures once at start-up (see shaders/leaves.js),
// with coverage-weighted mips from the impostor mip filter.
import { LEAF_TEX, leafBakeWGSL } from '../shaders/leaves.js';
import { bindGroup, bindLayout, entry, flags, shader } from '../core/gpu.js';
import { LEAF_COUNT } from '../scene/catalog.js';
import { cardMipWGSL } from '../shaders/props.js';

// Mips stop at 4x4. The bake and mip shaders run 8x8 workgroups, one layer per foliage kind.
const { COMPUTE } = GPUShaderStage,
  FORMAT = 'rgba8unorm',
  MAX_ANISOTROPY = 4,
  MIPS = Math.log2(LEAF_TEX) - 1,
  WORKGROUP = 8,
  computePipeline = (device, code, label, layout) =>
    device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, code, label) },
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    }),
  mipView = (texture, mip) => texture.createView({ baseMipLevel: mip, dimension: '2d-array', mipLevelCount: 1 }),
  workgroups = (size) => [Math.ceil(size / WORKGROUP), Math.ceil(size / WORKGROUP), LEAF_COUNT];

export class LeafTextures {
  // Layout entries matching `resources`, for the stages that draw foliage
  static entries(visibility) {
    return [
      entry.texture('float', '2d-array', visibility),
      entry.texture('float', '2d-array', visibility),
      entry.sampler('filtering', visibility),
    ];
  }

  constructor(device) {
    this.device = device;
    const usage = flags(GPUTextureUsage.STORAGE_BINDING, GPUTextureUsage.TEXTURE_BINDING),
      tex = (label) =>
        device.createTexture({
          format: FORMAT,
          label,
          mipLevelCount: MIPS,
          size: [LEAF_TEX, LEAF_TEX, LEAF_COUNT],
          usage,
        });
    this.albedo = tex('leaf-albedo');
    this.normal = tex('leaf-normal');
    this.sampler = device.createSampler({
      label: 'leaf',
      magFilter: 'linear',
      maxAnisotropy: MAX_ANISOTROPY,
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    // Textures and sampler, in the binding order of foliageLibrary (shaders/leaves.js)
    this.resources = [
      this.albedo.createView({ dimension: '2d-array' }),
      this.normal.createView({ dimension: '2d-array' }),
      this.sampler,
    ];
    // Pipelines compile asynchronously
    this.ready = this.bake();
  }

  async bake() {
    const encoder = this.device.createCommandEncoder({ label: 'leaf-bake' }),
      pass = encoder.beginComputePass({ label: 'leaf-bake' });
    await this.bakeBase(pass);
    await this.bakeMips(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  async bakeBase(pass) {
    const layout = bindLayout(this.device, 'leaf-bake', [
      entry.storageTexture(FORMAT, '2d-array'),
      entry.storageTexture(FORMAT, '2d-array'),
    ]);
    pass.setPipeline(await computePipeline(this.device, leafBakeWGSL, 'leaf-bake', layout));
    pass.setBindGroup(0, bindGroup(this.device, layout, [mipView(this.albedo, 0), mipView(this.normal, 0)]));
    pass.dispatchWorkgroups(...workgroups(LEAF_TEX));
  }

  async bakeMips(pass) {
    const layout = bindLayout(this.device, 'leaf-mip', [
      entry.texture('float', '2d-array', COMPUTE),
      entry.texture('float', '2d-array', COMPUTE),
      entry.storageTexture(FORMAT, '2d-array'),
      entry.storageTexture(FORMAT, '2d-array'),
    ]);
    pass.setPipeline(await computePipeline(this.device, cardMipWGSL, 'leaf-mip', layout));
    for (let mip = 1; mip < MIPS; mip += 1) {
      pass.setBindGroup(
        0,
        bindGroup(this.device, layout, [
          mipView(this.albedo, mip - 1),
          mipView(this.normal, mip - 1),
          mipView(this.albedo, mip),
          mipView(this.normal, mip),
        ]),
      );
      pass.dispatchWorkgroups(...workgroups(Math.floor(LEAF_TEX / 2 ** mip)));
    }
  }
}
