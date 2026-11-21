// Sky lighting bake: a radiance LUT (read by fog, reflections and refraction)
// and SH9 irradiance (directional ambient), re-baked only when the sky changes.
import { shader, bindLayout, bindGroup, entry, at } from '../core/gpu.js';
import { skyBakeWGSL, SKY_LUT } from '../shaders/lighting.js';

const FORMAT = 'rgba16float';
const TOLERANCE = 0.002; // largest change of a sky input that still reuses the bake

export class SkyLightPass {
  constructor(device, frameBuffer) {
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    this.lut = device.createTexture({ label: 'sky-lut', size: SKY_LUT, format: FORMAT, usage });
    this.sh = device.createTexture({ label: 'sky-sh', size: [9, 1], format: FORMAT, usage });
    this.lutView = this.lut.createView();
    this.shView = this.sh.createView();
    const layout = bindLayout(device, 'sky-bake', [
      entry.uniform(),
      at(6, entry.storageTexture(FORMAT)),
      at(7, entry.storageTexture(FORMAT)),
    ]);
    this.group = bindGroup(device, layout, [frameBuffer, at(6, this.lutView), at(7, this.shView)], 'sky-bake');
    const module = shader(device, skyBakeWGSL, 'sky-bake');
    const pipeline = (entryPoint) =>
      device.createComputePipelineAsync({
        label: `sky-${entryPoint}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint },
      });
    this.lutPipeline = pipeline('lut');
    this.shPipeline = pipeline('irradiance');
    this.key = null;
  }

  // everything the sky radiance depends on
  static keyOf(env) {
    return [...env.sun, env.night, ...env.moon, env.fog[3]];
  }

  encode(encoder, env) {
    const key = SkyLightPass.keyOf(env);
    if (this.key && key.every((v, i) => Math.abs(v - this.key[i]) < TOLERANCE)) return;
    this.key = key;
    const pass = encoder.beginComputePass({ label: 'sky-bake' });
    pass.setBindGroup(0, this.group);
    pass.setPipeline(this.lutPipeline);
    pass.dispatchWorkgroups(Math.ceil(SKY_LUT[0] / 8), Math.ceil(SKY_LUT[1] / 8));
    pass.setPipeline(this.shPipeline);
    pass.dispatchWorkgroups(1);
    pass.end();
  }
}
