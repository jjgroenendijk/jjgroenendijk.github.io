// Bakes the ground material textures once at start-up (see shaders/materials.js):
// patterns -> normals and occlusion -> mip chains.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { groundBakeWGSL, groundDeriveWGSL, groundMipWGSL, MAT_TEX, GROUND_COUNT } from '../shaders/materials.js';

const FORMAT = 'rgba8unorm';
const MIPS = Math.log2(MAT_TEX) + 1;
const C = () => GPUShaderStage.COMPUTE;

export class GroundMaterials {
  constructor(device) {
    this.device = device;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const tex = (label, mips) => device.createTexture({ label, size: [MAT_TEX, MAT_TEX, GROUND_COUNT], format: FORMAT, mipLevelCount: mips, usage });
    this.albedo = tex('ground-albedo-height', MIPS);
    this.surface = tex('ground-normal-rough-ao', MIPS);
    this.views = [this.albedo, this.surface].map((t) => t.createView({ dimension: '2d-array' }));
    // anisotropic filtering keeps grazing views of the ground sharp
    this.sampler = device.createSampler({
      label: 'ground', addressModeU: 'repeat', addressModeV: 'repeat',
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8,
    });
    this.ready = this.bake(); // pipelines compile asynchronously
  }

  async bake() {
    const d = this.device;
    const rough = d.createTexture({ label: 'ground-rough', size: [MAT_TEX, MAT_TEX, GROUND_COUNT], format: FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const level = (t, m) => t.createView({ dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 });
    const pipeline = (code, label, entryPoint, layout) => d.createComputePipelineAsync({
      label, layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: shader(d, code, label), entryPoint },
    });
    const enc = d.createCommandEncoder({ label: 'ground-bake' });
    const pass = enc.beginComputePass({ label: 'ground-bake' });
    const groups = (n) => [Math.ceil(n / 8), Math.ceil(n / 8), GROUND_COUNT];

    const bakeLayout = bindLayout(d, 'ground-bake', [entry.storageTexture(FORMAT, '2d-array'), entry.storageTexture(FORMAT, '2d-array')]);
    pass.setPipeline(await pipeline(groundBakeWGSL, 'ground-bake', 'main', bakeLayout));
    pass.setBindGroup(0, bindGroup(d, bakeLayout, [level(this.albedo, 0), level(rough, 0)]));
    pass.dispatchWorkgroups(...groups(MAT_TEX));

    const deriveLayout = bindLayout(d, 'ground-derive', [entry.texture('float', '2d-array', C()), entry.texture('float', '2d-array', C()), entry.storageTexture(FORMAT, '2d-array')]);
    pass.setPipeline(await pipeline(groundDeriveWGSL, 'ground-derive', 'main', deriveLayout));
    pass.setBindGroup(0, bindGroup(d, deriveLayout, [level(this.albedo, 0), level(rough, 0), level(this.surface, 0)]));
    pass.dispatchWorkgroups(...groups(MAT_TEX));

    const mipLayout = bindLayout(d, 'ground-mip', [entry.texture('float', '2d-array', C()), entry.storageTexture(FORMAT, '2d-array')]);
    const mips = { albedo: pipeline(groundMipWGSL, 'ground-mip-albedo', 'albedo', mipLayout), surface: pipeline(groundMipWGSL, 'ground-mip-surface', 'surface', mipLayout) };
    for (const [t, p] of [[this.albedo, mips.albedo], [this.surface, mips.surface]]) {
      pass.setPipeline(await p);
      for (let m = 1; m < MIPS; m++) {
        pass.setBindGroup(0, bindGroup(d, mipLayout, [level(t, m - 1), level(t, m)]));
        pass.dispatchWorkgroups(...groups(MAT_TEX >> m));
      }
    }
    pass.end();
    d.queue.submit([enc.finish()]);
    rough.destroy();
  }
}
