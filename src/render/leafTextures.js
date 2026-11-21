// Bakes the foliage card textures once at start-up (see shaders/leaves.js),
// with coverage-weighted mips from the impostor mip filter.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { leafBakeWGSL, LEAF_TEX, LEAF_COUNT } from '../shaders/leaves.js';
import { cardMipWGSL } from '../shaders/props.js';

const FORMAT = 'rgba8unorm';
const MIPS = Math.log2(LEAF_TEX) - 1; // down to 4x4
const C = GPUShaderStage.COMPUTE;

export class LeafTextures {
  constructor(device) {
    this.device = device;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const tex = (label) =>
      device.createTexture({
        label,
        size: [LEAF_TEX, LEAF_TEX, LEAF_COUNT],
        format: FORMAT,
        mipLevelCount: MIPS,
        usage,
      });
    this.albedo = tex('leaf-albedo');
    this.normal = tex('leaf-normal');
    this.sampler = device.createSampler({
      label: 'leaf',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      maxAnisotropy: 4,
    });
    // textures and sampler, in the binding order of foliageLib
    this.resources = [
      this.albedo.createView({ dimension: '2d-array' }),
      this.normal.createView({ dimension: '2d-array' }),
      this.sampler,
    ];
    this.ready = this.bake(); // pipelines compile asynchronously
  }

  // layout entries matching `resources`, for the stages that draw foliage
  static entries(visibility) {
    return [
      entry.texture('float', '2d-array', visibility),
      entry.texture('float', '2d-array', visibility),
      entry.sampler('filtering', visibility),
    ];
  }

  async bake() {
    const d = this.device;
    const level = (t, m) => t.createView({ dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 });
    const pipeline = (code, label, layout) =>
      d.createComputePipelineAsync({
        label,
        layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: shader(d, code, label), entryPoint: 'main' },
      });
    const groups = (n) => [Math.ceil(n / 8), Math.ceil(n / 8), LEAF_COUNT];
    const enc = d.createCommandEncoder({ label: 'leaf-bake' });
    const pass = enc.beginComputePass({ label: 'leaf-bake' });

    const bakeLayout = bindLayout(d, 'leaf-bake', [
      entry.storageTexture(FORMAT, '2d-array'),
      entry.storageTexture(FORMAT, '2d-array'),
    ]);
    pass.setPipeline(await pipeline(leafBakeWGSL, 'leaf-bake', bakeLayout));
    pass.setBindGroup(0, bindGroup(d, bakeLayout, [level(this.albedo, 0), level(this.normal, 0)]));
    pass.dispatchWorkgroups(...groups(LEAF_TEX));

    const mipLayout = bindLayout(d, 'leaf-mip', [
      entry.texture('float', '2d-array', C),
      entry.texture('float', '2d-array', C),
      entry.storageTexture(FORMAT, '2d-array'),
      entry.storageTexture(FORMAT, '2d-array'),
    ]);
    pass.setPipeline(await pipeline(cardMipWGSL, 'leaf-mip', mipLayout));
    for (let m = 1; m < MIPS; m++) {
      pass.setBindGroup(
        0,
        bindGroup(d, mipLayout, [
          level(this.albedo, m - 1),
          level(this.normal, m - 1),
          level(this.albedo, m),
          level(this.normal, m),
        ]),
      );
      pass.dispatchWorkgroups(...groups(LEAF_TEX >> m));
    }
    pass.end();
    d.queue.submit([enc.finish()]);
  }
}
