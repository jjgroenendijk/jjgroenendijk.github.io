// Vegetation, rocks, corals and wildlife. A compute shader scatters instances
// around the camera every frame (frustum culled, LOD selected) straight into
// GPU buffers that feed indirect draws: no per-instance CPU work at all.
import { shader, buffer, bufferWithData, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { scatterWGSL, clampWGSL, propWGSL, propShadowWGSL, cardBakeWGSL, cardMipWGSL } from '../shaders/props.js';
import { LAYERS, TYPE, CARDS, CARD_VIEWS } from '../scene/catalog.js';
import { HDR, DEPTH, depthState } from './layouts.js';

const PARAM_STRIDE = 256;
const INSTANCE_BYTES = 32;
const PARAM_BYTES = 112;
const CARD_SIZE = 128;

function mergeMeshes(meshes) {
  const ranges = {};
  let vCount = 0, iCount = 0;
  for (const [name, m] of Object.entries(meshes)) {
    ranges[name] = { baseVertex: vCount, firstIndex: iCount, indexCount: m.i.length, bound: m.bound };
    vCount += m.v.length / 10; iCount += m.i.length;
  }
  const v = new Float32Array(vCount * 10), i = new Uint32Array(iCount);
  for (const [name, m] of Object.entries(meshes)) {
    v.set(m.v, ranges[name].baseVertex * 10);
    i.set(m.i, ranges[name].firstIndex);
  }
  return { v, i, ranges };
}

export class PropsPass {
  constructor(device, shared, meshes, quality) {
    this.device = device;
    const U = GPUBufferUsage;
    const merged = mergeMeshes(meshes);
    this.vertexBuffer = bufferWithData(device, merged.v, U.VERTEX, 'prop-verts');
    this.indexBuffer = bufferWithData(device, merged.i, U.INDEX, 'prop-indices');

    // draw slots: one per (layer, lod)
    this.layers = [];
    this.slots = [];
    let base = 0;
    for (const layer of LAYERS) {
      const slots = layer.meshes.map((mesh, k) => {
        const cap = Math.ceil(layer.caps[k] * (layer.count ? 1 : quality.density));
        const slot = { index: this.slots.length, mesh, cap, base, lod: (layer.lodBase || 0) + k, range: merged.ranges[mesh], shadow: layer.shadow ?? (layer.type !== 'bird') };
        base += cap;
        this.slots.push(slot);
        return slot;
      });
      const scale = layer.count ? 1 : quality.distance;
      this.layers.push({ ...layer, slots, maxDist: layer.maxDist * scale,
        minDist: layer.minDist ? layer.minDist * scale : -1,
        fadeDist: (layer.fadeDist ?? layer.maxDist) * scale, lods: layer.lods || [] });
    }
    // how far the forest reaches (the terrain fakes a canopy beyond it)
    this.vegDist = Math.max(...this.layers.filter((l) => l.type === 'tree').map((l) => l.maxDist));
    this.instanceBuffer = buffer(device, base * INSTANCE_BYTES, U.STORAGE | U.VERTEX, 'prop-instances');

    this.argsTemplate = new Uint32Array(this.slots.length * 5);
    for (const s of this.slots) this.argsTemplate.set([s.range.indexCount, 0, s.range.firstIndex, s.range.baseVertex, 0], s.index * 5);
    this.argsBuffer = buffer(device, this.argsTemplate.byteLength, U.STORAGE | U.INDIRECT | U.COPY_DST | U.COPY_SRC, 'prop-args');
    this.capsBuffer = bufferWithData(device, new Uint32Array(this.slots.map((s) => s.cap)), U.STORAGE, 'prop-caps');

    // per-layer scatter parameters (struct SP in the scatter shader)
    const params = new ArrayBuffer(PARAM_STRIDE * this.layers.length);
    this.layers.forEach((layer, k) => {
      const f = new Float32Array(params, k * PARAM_STRIDE, PARAM_BYTES / 4);
      const u = new Uint32Array(params, k * PARAM_STRIDE, PARAM_BYTES / 4);
      const radius = layer.count ? 0 : Math.ceil(layer.maxDist / layer.cell);
      f[0] = layer.cell || 1; f[1] = radius; f[2] = layer.maxDist; f[3] = layer.minDist;
      u[4] = TYPE[layer.type]; u[5] = layer.count || 0; u[6] = layer.cacheHeight ? 1 : 0;
      f[8] = layer.slots[0].range.bound; f[9] = layer.keep; f[10] = layer.reach || 0; f[11] = layer.fadeDist;
      for (let j = 0; j < 4; j++) {
        const sl = layer.slots[Math.min(j, layer.slots.length - 1)];
        f[12 + j] = layer.lods[j] ?? 1e9;
        u[16 + j] = sl.index; u[20 + j] = sl.base; u[24 + j] = sl.cap;
      }
      layer.groups = layer.count ? [8, Math.ceil(layer.count / 64)] : [Math.ceil((2 * radius + 1) / 8), Math.ceil((2 * radius + 1) / 8)];
    });
    this.paramBuffer = bufferWithData(device, new Uint8Array(params), U.UNIFORM, 'scatter-params');

    this.scatterLayout = bindLayout(device, 'scatter', [entry.uniform(true), entry.storage(), entry.storage(),
      entry.texture('unfilterable-float', '2d', GPUShaderStage.COMPUTE)]);
    this.setHiZ(null);
    this.scatterPipeline = device.createComputePipeline({
      label: 'scatter',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.scatterLayout] }),
      compute: { module: shader(device, scatterWGSL, 'scatter'), entryPoint: 'main' },
    });
    const clampLayout = bindLayout(device, 'clamp', [entry.storage(), entry.storage(true)]);
    this.clampGroup = bindGroup(device, clampLayout, [this.argsBuffer, this.capsBuffer]);
    this.clampPipeline = device.createComputePipeline({
      label: 'clamp-args',
      layout: device.createPipelineLayout({ bindGroupLayouts: [clampLayout] }),
      compute: { module: shader(device, clampWGSL, 'clamp'), entryPoint: 'main' },
    });

    const vertexBuffers = [
      { arrayStride: 40, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x4' }] },
      { arrayStride: INSTANCE_BYTES, stepMode: 'instance', attributes: [
        { shaderLocation: 3, offset: 0, format: 'float32x4' },
        { shaderLocation: 4, offset: 16, format: 'float32x4' }] },
    ];
    // impostor framing: half width and height range of each baked species
    const frames = CARDS.map(([, src]) => {
      const m = meshes[src];
      let hw = 0, y0 = 1e9, y1 = -1e9;
      for (let j = 0; j < m.v.length; j += 10) {
        hw = Math.max(hw, Math.hypot(m.v[j], m.v[j + 2]));
        y0 = Math.min(y0, m.v[j + 1]); y1 = Math.max(y1, m.v[j + 1]);
      }
      return { hw: hw * 1.04, y0, y1: y1 + (y1 - y0) * 0.02, r: Math.hypot(hw, Math.max(Math.abs(y0), Math.abs(y1))) * 1.05 };
    });
    this.cardFrames = frames;
    const cardConst = `const CARD = array<vec4f, ${frames.length}>(${frames.map((c) => `vec4f(${c.hw}, ${c.y0}, ${c.y1}, 0.0)`).join(', ')});`;
    const withCards = (code) => code.replace('/*CARD_FRAMES*/', cardConst);
    this.setupCards(device, shared, merged, withCards);

    const main = shader(device, withCards(propWGSL), 'props');
    this.pipeline = device.createRenderPipeline({
      label: 'props',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow, this.cardLayout] }),
      vertex: { module: main, entryPoint: 'vs', buffers: vertexBuffers },
      fragment: { module: main, entryPoint: 'fs', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState(),
    });
    const sh = shader(device, withCards(propShadowWGSL), 'props-shadow');
    this.shadowPipeline = device.createRenderPipeline({
      label: 'props-shadow',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.cascade] }),
      vertex: { module: sh, entryPoint: 'vs', buffers: vertexBuffers },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
    });
  }

  // Impostor atlas: CARD_VIEWS orthographic views per species, rendered once.
  setupCards(device, shared, merged, withCards) {
    const layers = CARDS.length * CARD_VIEWS;
    const mips = Math.log2(CARD_SIZE) - 1; // down to 4x4
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    const tex = (label) => device.createTexture({ label, size: [CARD_SIZE, CARD_SIZE, layers], format: 'rgba8unorm', mipLevelCount: mips, usage });
    this.cardAlb = tex('card-albedo');
    this.cardNrm = tex('card-normal');
    this.cardLayout = bindLayout(device, 'cards', [entry.texture('float', '2d-array', GPUShaderStage.FRAGMENT), entry.texture('float', '2d-array', GPUShaderStage.FRAGMENT)]);
    this.cardGroup = bindGroup(device, this.cardLayout, [this.cardAlb.createView({ dimension: '2d-array' }), this.cardNrm.createView({ dimension: '2d-array' })], 'cards');
    this.cardMips = mips;
    this.cardRanges = CARDS.map(([, src]) => merged.ranges[src]);
    this.bakeLayout = bindLayout(device, 'card-bake', [entry.uniform(true, GPUShaderStage.VERTEX)]);
    this.bakeBuffer = buffer(device, PARAM_STRIDE * layers, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'card-bake');
    this.bakeGroup = bindGroup(device, this.bakeLayout, [{ buffer: this.bakeBuffer, size: 48 }]);
    const bake = shader(device, withCards(cardBakeWGSL), 'card-bake');
    this.bakePipeline = device.createRenderPipeline({
      label: 'card-bake',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.bakeLayout] }),
      vertex: { module: bake, entryPoint: 'vs', buffers: [{ arrayStride: 40, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x4' }] }] },
      fragment: { module: bake, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
    });
    const mipLayout = bindLayout(device, 'card-mip', [
      entry.texture('float', '2d-array', GPUShaderStage.COMPUTE), entry.texture('float', '2d-array', GPUShaderStage.COMPUTE),
      entry.storageTexture('rgba8unorm', '2d-array'), entry.storageTexture('rgba8unorm', '2d-array')]);
    this.mipPipeline = device.createComputePipeline({
      label: 'card-mip',
      layout: device.createPipelineLayout({ bindGroupLayouts: [mipLayout] }),
      compute: { module: shader(device, cardMipWGSL, 'card-mip'), entryPoint: 'main' },
    });
    const view = (t, m) => t.createView({ dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 });
    this.mipGroups = [];
    for (let m = 1; m < mips; m++) {
      this.mipGroups.push(bindGroup(device, mipLayout, [view(this.cardAlb, m - 1), view(this.cardNrm, m - 1), view(this.cardAlb, m), view(this.cardNrm, m)]));
    }
    // one uniform block per (species, view)
    const data = new Float32Array(PARAM_STRIDE / 4 * layers);
    this.cardFrames.forEach((c, sp) => {
      for (let k = 0; k < CARD_VIEWS; k++) {
        const th = (k * 2 * Math.PI) / CARD_VIEWS;
        data.set([Math.cos(th), 0, -Math.sin(th), c.hw, Math.sin(th), 0, Math.cos(th), c.r, c.y0, c.y1, 0, 0], (sp * CARD_VIEWS + k) * PARAM_STRIDE / 4);
      }
    });
    device.queue.writeBuffer(this.bakeBuffer, 0, data);
    this.cardsBaked = false;
  }

  bakeCards(encoder, frameGroup) {
    if (this.cardsBaked) return;
    this.cardsBaked = true;
    const depth = this.device.createTexture({ size: [CARD_SIZE, CARD_SIZE], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const target = (t, layer) => ({ view: t.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }),
      clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' });
    this.cardRanges.forEach((r, sp) => {
      for (let k = 0; k < CARD_VIEWS; k++) {
        const layer = sp * CARD_VIEWS + k;
        const pass = encoder.beginRenderPass({
          label: 'card-bake',
          colorAttachments: [target(this.cardAlb, layer), target(this.cardNrm, layer)],
          depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
        });
        pass.setPipeline(this.bakePipeline);
        pass.setBindGroup(0, frameGroup);
        pass.setBindGroup(1, this.bakeGroup, [layer * PARAM_STRIDE]);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, 'uint32');
        pass.drawIndexed(r.indexCount, 1, r.firstIndex, r.baseVertex, 0);
        pass.end();
      }
    });
    const pass = encoder.beginComputePass({ label: 'card-mips' });
    pass.setPipeline(this.mipPipeline);
    this.mipGroups.forEach((g, j) => {
      const size = CARD_SIZE >> (j + 1);
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8), CARDS.length * CARD_VIEWS);
    });
    pass.end();
  }

  // Depth pyramid from the previous frame for occlusion culling (null = none yet).
  setHiZ(view) {
    if (!view) {
      const t = this.device.createTexture({ size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING });
      view = t.createView();
    }
    this.scatterGroup = bindGroup(this.device, this.scatterLayout, [
      { buffer: this.paramBuffer, size: PARAM_BYTES }, this.instanceBuffer, this.argsBuffer, view,
    ], 'scatter');
  }

  // Layers with `every` keep last frame's instances on their off frames; their
  // draw arguments are only reset when they re-scatter.
  scatter(encoder, frameGroup, frame) {
    const run = this.layers.filter((l) => !l.every || frame === 0 || frame % l.every === l.phase);
    for (const l of run) {
      const a = l.slots[0].index, b = l.slots[l.slots.length - 1].index + 1;
      this.device.queue.writeBuffer(this.argsBuffer, a * 20, this.argsTemplate, a * 5, (b - a) * 5);
    }
    const pass = encoder.beginComputePass({ label: 'scatter' });
    pass.setPipeline(this.scatterPipeline);
    pass.setBindGroup(0, frameGroup);
    for (const layer of run) {
      pass.setBindGroup(1, this.scatterGroup, [this.layers.indexOf(layer) * PARAM_STRIDE]);
      pass.dispatchWorkgroups(layer.groups[0], layer.groups[1]);
    }
    pass.setPipeline(this.clampPipeline);
    pass.setBindGroup(0, this.clampGroup);
    pass.dispatchWorkgroups(Math.ceil(this.slots.length / 32));
    pass.end();
  }

  drawSlots(pass, filter) {
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    for (const s of this.slots) {
      if (filter && !filter(s)) continue;
      pass.setVertexBuffer(1, this.instanceBuffer, s.base * INSTANCE_BYTES, s.cap * INSTANCE_BYTES);
      pass.drawIndexedIndirect(this.argsBuffer, s.index * 20);
    }
  }

  draw(pass, frameGroup, shadowGroup) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, shadowGroup);
    pass.setBindGroup(2, this.cardGroup);
    this.drawSlots(pass);
  }

  drawShadow(pass, frameGroup, cascadeGroup, cascade) {
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, cascadeGroup);
    // the near cascade gets every nearby caster, the far cascades only the big
    // ones; distant LODs and impostor cards lie beyond the last cascade and never cast
    this.drawSlots(pass, (s) => s.shadow && (cascade === 0 ? s.lod === 0 : BIG.has(s.mesh) && s.lod < cascade));
  }
}

const BIG = new Set(['palm0', 'palm1', 'tree0', 'tree1', 'rock', 'banana', 'bush', 'galleon', 'wreck', 'rowboat']);
