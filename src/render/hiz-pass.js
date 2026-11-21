// Hierarchical depth (Hi-Z): a min-depth pyramid of the opaque scene. Next
// frame's scatter and terrain culling test bounding boxes against it, so
// whatever hid behind the hills and the forest last frame is not drawn.
// (Reverse-Z: smaller is farther, so each texel keeps the farthest depth.)
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';

const reduceWGSL = (fromDepth) => /* wgsl */ `
@group(0) @binding(0) var src: ${fromDepth ? 'texture_depth_2d' : 'texture_2d<f32>'};
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
      z = min(z, textureLoad(src, min(vec2i(x, y), sd), 0)${fromDepth ? '' : '.x'});
    }
  }
  textureStore(dst, vec2i(gid.xy), vec4f(z));
}
`;

export class HiZPass {
  constructor(device) {
    this.device = device;
    const layout = (depth) =>
      bindLayout(device, 'hiz', [
        entry.texture(depth ? 'depth' : 'unfilterable-float', '2d', GPUShaderStage.COMPUTE),
        entry.storageTexture('r32float'),
      ]);
    this.layouts = [layout(true), layout(false)];
    this.pipelines = [true, false].map((depth, k) =>
      device.createComputePipelineAsync({
        label: 'hiz',
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.layouts[k]] }),
        compute: { module: shader(device, reduceWGSL(depth), 'hiz'), entryPoint: 'main' },
      }),
    );
  }

  resize(targets) {
    this.texture?.destroy();
    const w = Math.max(1, Math.ceil(targets.width / 2)),
      h = Math.max(1, Math.ceil(targets.height / 2));
    const mips = Math.floor(Math.log2(Math.max(w, h))) + 1;
    this.texture = this.device.createTexture({
      label: 'hiz',
      size: [w, h],
      format: 'r32float',
      mipLevelCount: mips,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.view = this.texture.createView();
    const mip = (m) => this.texture.createView({ baseMipLevel: m, mipLevelCount: 1 });
    this.steps = [];
    for (let m = 0; m < mips; m++) {
      const k = m === 0 ? 0 : 1;
      this.steps.push({
        pipeline: this.pipelines[k],
        group: bindGroup(this.device, this.layouts[k], [m === 0 ? targets.views.depth : mip(m - 1), mip(m)]),
        size: [Math.max(1, w >> m), Math.max(1, h >> m)],
      });
    }
  }

  encode(encoder) {
    const pass = encoder.beginComputePass({ label: 'hiz' });
    for (const s of this.steps) {
      pass.setPipeline(s.pipeline);
      pass.setBindGroup(0, s.group);
      pass.dispatchWorkgroups(Math.ceil(s.size[0] / 8), Math.ceil(s.size[1] / 8));
    }
    pass.end();
  }
}
