// Hierarchical depth (Hi-Z): a min-depth pyramid of the opaque scene. Next
// frame's scatter and terrain culling test bounding boxes against it, so
// whatever hid behind the hills and the forest last frame is not drawn.
// (Reverse-Z: smaller is farther, so each texel keeps the farthest depth.)
import { bindGroup, bindLayout, entry, flags, shader } from '../core/gpu.js';

// Level 0 reduces the scene depth buffer, every further level the r32float level above it. The reduce shader runs 8x8
// workgroups.
const SOURCES = [
    { channel: '', sampleType: 'depth', texture: 'texture_depth_2d' },
    { channel: '.x', sampleType: 'unfilterable-float', texture: 'texture_2d<f32>' },
  ],
  WORKGROUP = 8,
  half = (size, mip) => Math.max(1, Math.floor(size / 2 ** mip)),
  reduceWGSL = (source) => /* wgsl */ `
@group(0) @binding(0) var src: ${source.texture};
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let d = textureDimensions(dst);
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let sd = vec2i(textureDimensions(src)) - 1;
  // the last row / column also takes the odd texel a floor-sized mip leaves out
  let x1 = select(2 * i32(gid.x) + 1, sd.x, gid.x == d.x - 1u);
  let y1 = select(2 * i32(gid.y) + 1, sd.y, gid.y == d.y - 1u);
  var z = 1e9;
  for (var y = 2 * i32(gid.y); y <= y1; y++) {
    for (var x = 2 * i32(gid.x); x <= x1; x++) {
      z = min(z, textureLoad(src, min(vec2i(x, y), sd), 0)${source.channel});
    }
  }
  textureStore(dst, vec2i(gid.xy), vec4f(z));
}
`;

export class HiZPass {
  steps;
  texture;
  view;

  constructor(device) {
    this.device = device;
    this.layouts = SOURCES.map((source) =>
      bindLayout(device, 'hiz', [
        entry.texture(source.sampleType, '2d', GPUShaderStage.COMPUTE),
        entry.storageTexture('r32float'),
      ]),
    );
    this.pipelines = SOURCES.map((source, index) =>
      device.createComputePipelineAsync({
        compute: { entryPoint: 'main', module: shader(device, reduceWGSL(source), 'hiz') },
        label: 'hiz',
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.layouts[index]] }),
      }),
    );
  }

  resize(targets) {
    this.texture?.destroy();
    const w = Math.max(1, Math.ceil(targets.width / 2)),
      h = Math.max(1, Math.ceil(targets.height / 2)),
      mips = Math.floor(Math.log2(Math.max(w, h))) + 1;
    this.texture = this.device.createTexture({
      format: 'r32float',
      label: 'hiz',
      mipLevelCount: mips,
      size: [w, h],
      usage: flags(GPUTextureUsage.STORAGE_BINDING, GPUTextureUsage.TEXTURE_BINDING),
    });
    this.view = this.texture.createView();
    this.steps = Array.from({ length: mips }, (_, mip) => this.step(targets, mip, [w, h]));
  }

  // Mip 0 reads the depth buffer with the depth pipeline; the others read the previous mip.
  step(targets, mip, [w, h]) {
    const kind = Math.min(mip, 1),
      level = (index) => this.texture.createView({ baseMipLevel: index, mipLevelCount: 1 }),
      source = (mip === 0 && targets.views.depth) || level(mip - 1);
    return {
      group: bindGroup(this.device, this.layouts[kind], [source, level(mip)]),
      pipeline: this.pipelines[kind],
      size: [half(w, mip), half(h, mip)],
    };
  }

  encode(encoder) {
    const pass = encoder.beginComputePass({ label: 'hiz' });
    for (const step of this.steps) {
      pass.setPipeline(step.pipeline);
      pass.setBindGroup(0, step.group);
      pass.dispatchWorkgroups(Math.ceil(step.size[0] / WORKGROUP), Math.ceil(step.size[1] / WORKGROUP));
    }
    pass.end();
  }
}
