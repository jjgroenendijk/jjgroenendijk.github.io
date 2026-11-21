// Post processing chain: volumetric light, temporal AA, bloom, tonemapping.
import { bindGroup, bindLayout, entry, flags, shader } from '../core/gpu.js';
import { bloomDownWGSL, bloomUpWGSL, compositeWGSL, taaWGSL, volumeWGSL } from '../shaders/post.js';
import { HDR } from './layouts.js';

// Every pass draws one fullscreen triangle. A bloom step's uniform is one vec4f: texel size and the shader's
// karis value (1 enables the Karis average on the first downsample and is the weight of each upsample).
const ADDITIVE = { alpha: { dstFactor: 'one', srcFactor: 'one' }, color: { dstFactor: 'one', srcFactor: 'one' } },
  BLOOM_UNIFORM_BYTES = 16,
  FULLSCREEN_VERTICES = 3,
  // Size of bloom mip `level`: the chain starts at half the render resolution.
  bloomSize = (size, level) => Math.max(1, Math.floor(size / 2 ** (level + 1))),
  // Draws one fullscreen pass into view; loadOp 'load' blends onto what is there.
  drawFullscreen = (encoder, { groups, label, loadOp = 'clear', pipeline, view }) => {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ clearValue: [0, 0, 0, 1], loadOp, storeOp: 'store', view }],
      label,
    });
    pass.setPipeline(pipeline);
    for (const [index, group] of groups.entries()) pass.setBindGroup(index, group);
    pass.draw(FULLSCREEN_VERTICES);
    pass.end();
  };

export class PostPass {
  bloomDown;
  bloomUp;
  compGroups;
  depthGroup;
  taaGroups;

  constructor(device, shared, outputFormat) {
    this.device = device;
    this.shared = shared;
    const fullscreen = (label, code, layouts, target) => {
      const module = shader(device, code, label);
      return device.createRenderPipelineAsync({
        fragment: { entryPoint: 'fs', module, targets: [target] },
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { entryPoint: 'vs', module },
      });
    };
    this.depthLayout = bindLayout(device, 'depth-only', [entry.texture('depth')]);
    this.volumePipeline = fullscreen('volume', volumeWGSL, [shared.frame, shared.shadow, this.depthLayout], {
      format: HDR,
    });

    this.taaLayout = bindLayout(device, 'taa', [
      entry.texture(),
      entry.texture(),
      entry.texture(),
      entry.texture('depth'),
      entry.sampler(),
    ]);
    this.taaPipeline = fullscreen('taa', taaWGSL, [shared.frame, this.taaLayout], { format: HDR });

    this.bloomLayout = bindLayout(device, 'bloom', [
      entry.texture(),
      entry.sampler(),
      entry.uniform(false, GPUShaderStage.FRAGMENT),
    ]);
    this.downPipeline = fullscreen('bloom-down', bloomDownWGSL, [this.bloomLayout], { format: HDR });
    this.upPipeline = fullscreen('bloom-up', bloomUpWGSL, [this.bloomLayout], { blend: ADDITIVE, format: HDR });

    this.compLayout = bindLayout(device, 'composite', [entry.texture(), entry.texture(), entry.sampler()]);
    this.compositePipeline = fullscreen('composite', compositeWGSL, [shared.frame, this.compLayout], {
      format: outputFormat,
    });
  }

  // One bloom step reading `source`, a w x h texture.
  bloomGroup(source, [w, h], karis) {
    const uniforms = this.device.createBuffer({
      size: BLOOM_UNIFORM_BYTES,
      usage: flags(GPUBufferUsage.UNIFORM, GPUBufferUsage.COPY_DST),
    });
    this.device.queue.writeBuffer(uniforms, 0, new Float32Array([1 / w, 1 / h, karis, 0]));
    return bindGroup(this.device, this.bloomLayout, [source, this.shared.linear, uniforms]);
  }

  resize(targets) {
    const mipSize = (level) => [bloomSize(targets.width, level), bloomSize(targets.height, level)];
    this.depthGroup = bindGroup(this.device, this.depthLayout, [targets.views.depth]);
    // TAA ping-pong: group[i] writes history[i] and reads history[1-i]
    this.taaGroups = [0, 1].map((index) =>
      bindGroup(this.device, this.taaLayout, [
        targets.views.hdr,
        targets.views.volume,
        targets.views.history[1 - index],
        targets.views.depth,
        this.shared.linear,
      ]),
    );
    this.compGroups = [0, 1].map((index) =>
      bindGroup(this.device, this.compLayout, [
        targets.views.history[index],
        targets.bloomViews[0],
        this.shared.linear,
      ]),
    );
    // Bloom chain
    this.bloomDown = [0, 1].map((history) => [
      this.bloomGroup(targets.views.history[history], [targets.width, targets.height], 1),
    ]);
    for (let level = 1; level < targets.bloomMips; level += 1) {
      const group = this.bloomGroup(targets.bloomViews[level - 1], mipSize(level - 1), 0);
      this.bloomDown[0].push(group);
      this.bloomDown[1].push(group);
    }
    this.bloomUp = [];
    for (let level = targets.bloomMips - 1; level > 0; level -= 1)
      this.bloomUp.push({ group: this.bloomGroup(targets.bloomViews[level], mipSize(level), 1), target: level - 1 });
  }

  // eslint-disable-next-line max-params -- renderer.js calls encode with these six positional arguments
  encode(encoder, targets, frameGroup, shadowGroup, outputView, historyIndex) {
    const h = historyIndex;
    drawFullscreen(encoder, {
      groups: [frameGroup, shadowGroup, this.depthGroup],
      label: 'volume',
      pipeline: this.volumePipeline,
      view: targets.views.volume,
    });
    drawFullscreen(encoder, {
      groups: [frameGroup, this.taaGroups[h]],
      label: 'taa',
      pipeline: this.taaPipeline,
      view: targets.views.history[h],
    });
    for (let level = 0; level < targets.bloomMips; level += 1) {
      drawFullscreen(encoder, {
        groups: [this.bloomDown[h][level]],
        label: `bloom-down-${level}`,
        pipeline: this.downPipeline,
        view: targets.bloomViews[level],
      });
    }
    for (const step of this.bloomUp)
      drawFullscreen(encoder, {
        groups: [step.group],
        label: 'bloom-up',
        loadOp: 'load',
        pipeline: this.upPipeline,
        view: targets.bloomViews[step.target],
      });
    drawFullscreen(encoder, {
      groups: [frameGroup, this.compGroups[h]],
      label: 'composite',
      pipeline: this.compositePipeline,
      view: outputView,
    });
  }
}
