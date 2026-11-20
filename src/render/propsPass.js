// Vegetation, rocks, corals and wildlife. A compute shader scatters instances
// around the camera every frame (frustum culled, LOD selected) straight into
// GPU buffers that feed indirect draws: no per-instance CPU work at all.
import { shader, buffer, bufferWithData, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { scatterWGSL, clampWGSL, propWGSL, propShadowWGSL } from '../shaders/props.js';
import { LAYERS, TYPE } from '../scene/catalog.js';
import { HDR, DEPTH, depthState } from './layouts.js';

const PARAM_STRIDE = 256;
const INSTANCE_BYTES = 32;

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
        const slot = { index: this.slots.length, mesh, cap, base, range: merged.ranges[mesh], shadow: layer.type !== 'bird' };
        base += cap;
        this.slots.push(slot);
        return slot;
      });
      this.layers.push({ ...layer, maxDist: layer.maxDist * (layer.count ? 1 : quality.distance), slots });
    }
    this.instanceBuffer = buffer(device, base * INSTANCE_BYTES, U.STORAGE | U.VERTEX, 'prop-instances');

    this.argsTemplate = new Uint32Array(this.slots.length * 5);
    for (const s of this.slots) this.argsTemplate.set([s.range.indexCount, 0, s.range.firstIndex, s.range.baseVertex, 0], s.index * 5);
    this.argsBuffer = buffer(device, this.argsTemplate.byteLength, U.STORAGE | U.INDIRECT | U.COPY_DST, 'prop-args');
    this.capsBuffer = bufferWithData(device, new Uint32Array(this.slots.map((s) => s.cap)), U.STORAGE, 'prop-caps');

    // per-layer scatter parameters
    const params = new ArrayBuffer(PARAM_STRIDE * this.layers.length);
    this.layers.forEach((layer, k) => {
      const f = new Float32Array(params, k * PARAM_STRIDE, 16);
      const u = new Uint32Array(params, k * PARAM_STRIDE, 16);
      const [s0, s1 = s0] = layer.slots;
      const radius = layer.count ? 0 : Math.ceil(layer.maxDist / layer.cell);
      f[0] = layer.cell || 1; f[1] = radius; f[2] = layer.maxDist; f[3] = layer.lodDist;
      u[4] = TYPE[layer.type]; u[5] = s0.index; u[6] = s1.index; u[7] = s0.base;
      u[8] = s1.base; u[9] = s0.cap; u[10] = s1.cap; u[11] = layer.count || 0;
      f[12] = s0.range.bound; f[13] = layer.keep;
      layer.groups = layer.count ? [8, Math.ceil(layer.count / 64)] : [Math.ceil((2 * radius + 1) / 8), Math.ceil((2 * radius + 1) / 8)];
    });
    this.paramBuffer = bufferWithData(device, new Uint8Array(params), U.UNIFORM, 'scatter-params');

    const scatterLayout = bindLayout(device, 'scatter', [entry.uniform(true), entry.storage(), entry.storage()]);
    this.scatterGroup = bindGroup(device, scatterLayout, [
      { buffer: this.paramBuffer, size: 64 }, this.instanceBuffer, this.argsBuffer,
    ], 'scatter');
    this.scatterPipeline = device.createComputePipeline({
      label: 'scatter',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, scatterLayout] }),
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
    const main = shader(device, propWGSL, 'props');
    this.pipeline = device.createRenderPipeline({
      label: 'props',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow] }),
      vertex: { module: main, entryPoint: 'vs', buffers: vertexBuffers },
      fragment: { module: main, entryPoint: 'fs', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState(),
    });
    const sh = shader(device, propShadowWGSL, 'props-shadow');
    this.shadowPipeline = device.createRenderPipeline({
      label: 'props-shadow',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.cascade] }),
      vertex: { module: sh, entryPoint: 'vs', buffers: vertexBuffers },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
    });
  }

  scatter(encoder, frameGroup) {
    this.device.queue.writeBuffer(this.argsBuffer, 0, this.argsTemplate);
    const pass = encoder.beginComputePass({ label: 'scatter' });
    pass.setPipeline(this.scatterPipeline);
    pass.setBindGroup(0, frameGroup);
    this.layers.forEach((layer, k) => {
      pass.setBindGroup(1, this.scatterGroup, [k * PARAM_STRIDE]);
      pass.dispatchWorkgroups(layer.groups[0], layer.groups[1]);
    });
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
    this.drawSlots(pass);
  }

  drawShadow(pass, frameGroup, cascadeGroup, cascade) {
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, cascadeGroup);
    // the near cascade gets everything, far cascades only the big casters
    const big = new Set(['palm0', 'palm1', 'tree0', 'tree1', 'rock', 'banana', 'bush']);
    this.drawSlots(pass, (s) => s.shadow && (cascade === 0 || big.has(s.mesh)));
  }
}
