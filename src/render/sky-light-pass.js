// Sky lighting bake: a radiance LUT (read by fog, reflections and refraction)
// and SH9 irradiance (directional ambient), re-baked only when the sky changes.
import { SKY_LUT, skyBakeWGSL } from '../shaders/lighting.js';
import { at, bindGroup, bindLayout, entry, flags, shader } from '../core/gpu.js';

// The outputs sit at bindings above those the shared WGSL libraries declare. TOLERANCE is the largest change of a sky
// input that still reuses the bake. The LUT shader runs 8x8 workgroups.
const FORMAT = 'rgba16float',
  LUT_BINDING = 6,
  SH_BINDING = 7,
  SH_COEFFICIENTS = 9,
  TOLERANCE = 0.002,
  WORKGROUP = 8;

export class SkyLightPass {
  // Everything the sky radiance depends on
  static keyOf(environment) {
    return [...environment.sun, environment.night, ...environment.moon, environment.fog[3]];
  }

  group;
  key;
  lutPipeline;
  shPipeline;

  constructor(device, frameBuffer) {
    const usage = flags(GPUTextureUsage.STORAGE_BINDING, GPUTextureUsage.TEXTURE_BINDING);
    this.lut = device.createTexture({ format: FORMAT, label: 'sky-lut', size: SKY_LUT, usage });
    this.sh = device.createTexture({ format: FORMAT, label: 'sky-sh', size: [SH_COEFFICIENTS, 1], usage });
    this.lutView = this.lut.createView();
    this.shView = this.sh.createView();
    this.createBake(device, frameBuffer);
  }

  createBake(device, frameBuffer) {
    const layout = bindLayout(device, 'sky-bake', [
        entry.uniform(),
        at(LUT_BINDING, entry.storageTexture(FORMAT)),
        at(SH_BINDING, entry.storageTexture(FORMAT)),
      ]),
      group = bindGroup(
        device,
        layout,
        [frameBuffer, at(LUT_BINDING, this.lutView), at(SH_BINDING, this.shView)],
        'sky-bake',
      ),
      module = shader(device, skyBakeWGSL, 'sky-bake'),
      pipeline = (entryPoint) =>
        device.createComputePipelineAsync({
          compute: { entryPoint, module },
          label: `sky-${entryPoint}`,
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        });
    this.group = group;
    this.lutPipeline = pipeline('lut');
    this.shPipeline = pipeline('irradiance');
  }

  encode(encoder, environment) {
    const key = SkyLightPass.keyOf(environment);
    if (this.key && key.every((value, index) => Math.abs(value - this.key[index]) < TOLERANCE)) return;
    this.key = key;
    this.bake(encoder);
  }

  bake(encoder) {
    const pass = encoder.beginComputePass({ label: 'sky-bake' });
    pass.setBindGroup(0, this.group);
    pass.setPipeline(this.lutPipeline);
    pass.dispatchWorkgroups(Math.ceil(SKY_LUT[0] / WORKGROUP), Math.ceil(SKY_LUT[1] / WORKGROUP));
    pass.setPipeline(this.shPipeline);
    pass.dispatchWorkgroups(1);
    pass.end();
  }
}
