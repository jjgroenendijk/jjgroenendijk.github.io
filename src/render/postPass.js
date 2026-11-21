// Post processing chain: volumetric light, temporal AA, bloom, tonemapping.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { volumeWGSL, taaWGSL, bloomDownWGSL, bloomUpWGSL, compositeWGSL } from '../shaders/post.js';
import { HDR } from './layouts.js';

export class PostPass {
  constructor(device, shared, outputFormat) {
    this.device = device;
    this.shared = shared;
    const fullscreen = (label, code, layouts, format, blend) => {
      const module = shader(device, code, label);
      return device.createRenderPipelineAsync({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] },
      });
    };
    this.depthLayout = bindLayout(device, 'depth-only', [entry.texture('depth')]);
    this.volumePipeline = fullscreen('volume', volumeWGSL, [shared.frame, shared.shadow, this.depthLayout], HDR);

    this.taaLayout = bindLayout(device, 'taa', [
      entry.texture(),
      entry.texture(),
      entry.texture(),
      entry.texture('depth'),
      entry.sampler(),
    ]);
    this.taaPipeline = fullscreen('taa', taaWGSL, [shared.frame, this.taaLayout], HDR);

    this.bloomLayout = bindLayout(device, 'bloom', [
      entry.texture(),
      entry.sampler(),
      entry.uniform(false, GPUShaderStage.FRAGMENT),
    ]);
    this.downPipeline = fullscreen('bloom-down', bloomDownWGSL, [this.bloomLayout], HDR);
    const add = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    this.upPipeline = fullscreen('bloom-up', bloomUpWGSL, [this.bloomLayout], HDR, add);

    this.compLayout = bindLayout(device, 'composite', [entry.texture(), entry.texture(), entry.sampler()]);
    this.compositePipeline = fullscreen('composite', compositeWGSL, [shared.frame, this.compLayout], outputFormat);
  }

  resize(targets) {
    const d = this.device,
      s = this.shared;
    this.depthGroup = bindGroup(d, this.depthLayout, [targets.views.depth]);
    // TAA ping-pong: group[i] writes history[i] and reads history[1-i]
    this.taaGroups = [0, 1].map((i) =>
      bindGroup(d, this.taaLayout, [
        targets.views.hdr,
        targets.views.volume,
        targets.views.history[1 - i],
        targets.views.depth,
        s.linear,
      ]),
    );
    this.compGroups = [0, 1].map((i) =>
      bindGroup(d, this.compLayout, [targets.views.history[i], targets.bloomViews[0], s.linear]),
    );
    // bloom chain
    const mk = (src, w, h, k) => {
      const ub = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(ub, 0, new Float32Array([1 / w, 1 / h, k, 0]));
      return bindGroup(d, this.bloomLayout, [src, s.linear, ub]);
    };
    const bw = (i) => Math.max(1, (targets.width >> 1) >> i),
      bh = (i) => Math.max(1, (targets.height >> 1) >> i);
    this.bloomDown = [0, 1].map((h) => [mk(targets.views.history[h], targets.width, targets.height, 1)]);
    for (let i = 1; i < targets.bloomMips; i++) {
      const g = mk(targets.bloomViews[i - 1], bw(i - 1), bh(i - 1), 0);
      this.bloomDown[0].push(g);
      this.bloomDown[1].push(g);
    }
    this.bloomUp = [];
    for (let i = targets.bloomMips - 1; i > 0; i--)
      this.bloomUp.push({ target: i - 1, group: mk(targets.bloomViews[i], bw(i), bh(i), 1) });
  }

  fullscreenPass(encoder, label, view, pipeline, groups, load = false) {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{ view, loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(pipeline);
    groups.forEach((g, i) => pass.setBindGroup(i, g));
    pass.draw(3);
    pass.end();
  }

  encode(encoder, targets, frameGroup, shadowGroup, outputView, historyIndex) {
    const h = historyIndex;
    this.fullscreenPass(encoder, 'volume', targets.views.volume, this.volumePipeline, [
      frameGroup,
      shadowGroup,
      this.depthGroup,
    ]);
    this.fullscreenPass(encoder, 'taa', targets.views.history[h], this.taaPipeline, [frameGroup, this.taaGroups[h]]);
    for (let i = 0; i < targets.bloomMips; i++) {
      this.fullscreenPass(encoder, `bloom-down-${i}`, targets.bloomViews[i], this.downPipeline, [this.bloomDown[h][i]]);
    }
    for (const u of this.bloomUp)
      this.fullscreenPass(encoder, 'bloom-up', targets.bloomViews[u.target], this.upPipeline, [u.group], true);
    this.fullscreenPass(encoder, 'composite', outputView, this.compositePipeline, [frameGroup, this.compGroups[h]]);
  }
}
