// Vegetation, rocks, corals and wildlife. A compute shader scatters instances
// around the camera every frame (frustum culled, LOD selected) straight into
// GPU buffers that feed indirect draws: no per-instance CPU work at all.
// The camera view draws them all at once through the visibility buffer
// (PropsVisibility); the shadow cascades draw slot by slot.
import { CARDS, CARD_SIZE, CARD_VIEWS } from '../scene/catalog.js';

import { MAX_SLOTS, cardBakeWGSL, cardMipWGSL, finalizeWGSL, propShadowWGSL, scatterWGSL } from '../shaders/props.js';
import {
  PARAM_BYTES,
  PARAM_STRIDE,
  U32_BYTES,
  WORKGROUP,
  buildLayers,
  cardBakeData,
  cardFrame,
  cardVec,
  castsShadow,
  mergeMeshes,
  packScatterUniforms,
  packSlots,
  setFades,
} from './scatter-layout.js';
import { bindGroup, bindLayout, buffer, bufferWithData, entry, flags, shader } from '../core/gpu.js';
import { DEPTH } from './layouts.js';
import { LeafTextures } from './leaf-textures.js';

// Per instance: two vec4f.
const INSTANCE_BYTES = 32,
  // An indexed indirect draw: indexCount, instanceCount, firstIndex, baseVertex, firstInstance.
  INDEXED_ARGS = 5,
  INDEXED_ARGS_BYTES = INDEXED_ARGS * U32_BYTES,
  // A plain indirect draw: four u32.
  DRAW_ARGS_BYTES = 16,
  // Mesh vertices: position and normal (f32x3 each), colour (f32x4).
  MESH_BUFFER = {
    arrayStride: 40,
    attributes: [
      { format: 'float32x3', offset: 0, shaderLocation: 0 },
      { format: 'float32x3', offset: 12, shaderLocation: 1 },
      { format: 'float32x4', offset: 24, shaderLocation: 2 },
    ],
  },
  INSTANCE_BUFFER = {
    arrayStride: INSTANCE_BYTES,
    attributes: [
      { format: 'float32x4', offset: 0, shaderLocation: 3 },
      { format: 'float32x4', offset: 16, shaderLocation: 4 },
    ],
    stepMode: 'instance',
  },
  // Per card view: right + radius, up + centre height, view direction (three vec4f).
  CARD_PARAM_BYTES = 48,
  // Colour attachment on one layer of an impostor atlas.
  cardTarget = (texture, layer) => ({
    clearValue: [0, 0, 0, 0],
    loadOp: 'clear',
    storeOp: 'store',
    view: texture.createView({
      arrayLayerCount: 1,
      baseArrayLayer: layer,
      baseMipLevel: 0,
      dimension: '2d',
      mipLevelCount: 1,
    }),
  }),
  mipView = (texture, mip) => texture.createView({ baseMipLevel: mip, dimension: '2d-array', mipLevelCount: 1 });

export class PropsPass {
  // Created by the constructor's helpers.
  argsBuffer;
  argsTemplate;
  bakeBuffer;
  bakeGroup;
  bakePipeline;
  capsBuffer;
  cardAlb;
  cardMips;
  cardNrm;
  cardRanges;
  cardViews;
  cardsBaked;
  bakeLayout;
  instanceBuffer;
  layers;
  slots;
  vegDist;
  drawArgs;
  finalizeGroup;
  finalizePipeline;
  mipGroups;
  mipPipeline;
  paramBuffer;
  scatterGroup;
  scatterLayout;
  scatterPipeline;
  shadowPipeline;
  slotBuffer;
  startBuffer;

  // `sources`: { meshes, flockState, leaves }, the meshes and the buffers and textures other passes own.
  constructor(device, shared, quality, { flockState, leaves, meshes }) {
    this.device = device;
    this.flockState = flockState;
    this.leaves = leaves;
    this.leafLayout = bindLayout(device, 'leaves', LeafTextures.entries(GPUShaderStage.FRAGMENT));
    this.leafGroup = bindGroup(device, this.leafLayout, leaves.resources, 'leaves');
    const merged = mergeMeshes(meshes),
      frames = CARDS.map(([, name]) => cardFrame(meshes[name])),
      cardConst = `const CARD = array<vec4f, ${frames.length}>(${frames.map((frame) => cardVec(frame)).join(', ')});`;
    // Also read as storage by the visibility buffer passes.
    this.vertexBuffer = bufferWithData(
      device,
      merged.v,
      flags(GPUBufferUsage.VERTEX, GPUBufferUsage.STORAGE),
      'prop-verts',
    );
    this.indexBuffer = bufferWithData(
      device,
      merged.i,
      flags(GPUBufferUsage.INDEX, GPUBufferUsage.STORAGE),
      'prop-indices',
    );
    this.createSlots(device, merged.ranges, quality);
    this.createScatter(device, shared);
    this.cardFrames = frames;
    // Shaders that include propVS need the framing of every impostor species.
    this.withCards = (code) => code.replace('/*CARD_FRAMES*/', () => cardConst);
    this.setupCards(device, shared, merged);
    this.createShadowPipeline(device, shared);
  }

  createSlots(device, ranges, quality) {
    const { instances, layers, slots } = buildLayers(ranges, quality);
    this.layers = layers;
    this.slots = slots;
    setFades(layers);
    // How far the forest reaches (the terrain fakes a canopy beyond it).
    this.vegDist = Math.max(...layers.filter((layer) => layer.type === 'tree').map((layer) => layer.maxDist));
    this.instanceBuffer = buffer(
      device,
      instances * INSTANCE_BYTES,
      flags(GPUBufferUsage.STORAGE, GPUBufferUsage.VERTEX),
      'prop-instances',
    );
    this.argsTemplate = new Uint32Array(slots.length * INDEXED_ARGS);
    for (const s of slots)
      this.argsTemplate.set([s.range.indexCount, 0, s.range.firstIndex, s.range.baseVertex, 0], s.index * INDEXED_ARGS);
    this.argsBuffer = buffer(
      device,
      this.argsTemplate.byteLength,
      flags(GPUBufferUsage.STORAGE, GPUBufferUsage.INDIRECT, GPUBufferUsage.COPY_DST, GPUBufferUsage.COPY_SRC),
      'prop-args',
    );
    this.capsBuffer = bufferWithData(
      device,
      new Uint32Array(slots.map((s) => s.cap)),
      GPUBufferUsage.STORAGE,
      'prop-caps',
    );
    if (slots.length > MAX_SLOTS) throw new Error(`too many prop slots: ${slots.length} > ${MAX_SLOTS}`);
    this.slotBuffer = bufferWithData(device, packSlots(slots), GPUBufferUsage.STORAGE, 'prop-slots');
    // First triangle corner of each slot in the merged draw, then the total.
    this.startBuffer = buffer(device, (slots.length + 1) * U32_BYTES, GPUBufferUsage.STORAGE, 'prop-slot-starts');
    this.drawArgs = buffer(
      device,
      DRAW_ARGS_BYTES,
      flags(GPUBufferUsage.STORAGE, GPUBufferUsage.INDIRECT),
      'prop-draw',
    );
  }

  createScatter(device, shared) {
    this.paramBuffer = bufferWithData(
      device,
      packScatterUniforms(this.layers),
      GPUBufferUsage.UNIFORM,
      'scatter-params',
    );
    this.scatterLayout = bindLayout(device, 'scatter', [
      entry.uniform(true),
      entry.storage(),
      entry.storage(),
      entry.texture('unfilterable-float', '2d', GPUShaderStage.COMPUTE),
      entry.storage(true),
    ]);
    this.setHiZ();
    this.scatterPipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, scatterWGSL, 'scatter') },
      label: 'scatter',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.scatterLayout] }),
    });
    const finalizeLayout = bindLayout(device, 'prop-finalize', [
      entry.storage(),
      entry.storage(true),
      entry.storage(true),
      entry.storage(),
      entry.storage(),
    ]);
    this.finalizeGroup = bindGroup(device, finalizeLayout, [
      this.argsBuffer,
      this.capsBuffer,
      this.slotBuffer,
      this.startBuffer,
      this.drawArgs,
    ]);
    this.finalizePipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, finalizeWGSL, 'prop-finalize') },
      label: 'prop-finalize',
      layout: device.createPipelineLayout({ bindGroupLayouts: [finalizeLayout] }),
    });
  }

  createShadowPipeline(device, shared) {
    const module = shader(device, this.withCards(propShadowWGSL), 'props-shadow');
    this.shadowPipeline = device.createRenderPipelineAsync({
      depthStencil: {
        depthBias: 2,
        depthBiasSlopeScale: 2,
        depthCompare: 'less',
        depthWriteEnabled: true,
        format: DEPTH,
      },
      fragment: { entryPoint: 'fs', module, targets: [] },
      label: 'props-shadow',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.cascade, this.leafLayout] }),
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: { buffers: [MESH_BUFFER, INSTANCE_BUFFER], entryPoint: 'vs', module },
    });
  }

  // Impostor atlas: CARD_VIEWS orthographic views per species, rendered once,
  // from the directions of a hemi-octahedral grid (see cardImpostor).
  setupCards(device, shared, merged) {
    const layers = CARDS.length * CARD_VIEWS,
      // Down to 4x4.
      mips = Math.log2(CARD_SIZE) - 1,
      texture = (label) =>
        device.createTexture({
          format: 'rgba8unorm',
          label,
          mipLevelCount: mips,
          size: [CARD_SIZE, CARD_SIZE, layers],
          usage: flags(
            GPUTextureUsage.RENDER_ATTACHMENT,
            GPUTextureUsage.TEXTURE_BINDING,
            GPUTextureUsage.STORAGE_BINDING,
          ),
        });
    this.cardAlb = texture('card-albedo');
    this.cardNrm = texture('card-normal');
    this.cardViews = [
      this.cardAlb.createView({ dimension: '2d-array' }),
      this.cardNrm.createView({ dimension: '2d-array' }),
    ];
    this.cardMips = mips;
    this.cardRanges = CARDS.map(([, name]) => merged.ranges[name]);
    this.createCardBake(device, shared, layers);
    this.createCardMips(device);
    device.queue.writeBuffer(this.bakeBuffer, 0, cardBakeData(this.cardFrames));
    this.cardsBaked = false;
  }

  createCardBake(device, shared, layers) {
    const module = shader(device, this.withCards(cardBakeWGSL), 'card-bake');
    this.bakeLayout = bindLayout(device, 'card-bake', [entry.uniform(true, GPUShaderStage.VERTEX)]);
    this.bakeBuffer = buffer(
      device,
      PARAM_STRIDE * layers,
      flags(GPUBufferUsage.UNIFORM, GPUBufferUsage.COPY_DST),
      'card-bake',
    );
    this.bakeGroup = bindGroup(device, this.bakeLayout, [{ buffer: this.bakeBuffer, size: CARD_PARAM_BYTES }]);
    this.bakePipeline = device.createRenderPipelineAsync({
      depthStencil: { depthCompare: 'less', depthWriteEnabled: true, format: DEPTH },
      fragment: { entryPoint: 'fs', module, targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] },
      label: 'card-bake',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.bakeLayout, this.leafLayout] }),
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: { buffers: [MESH_BUFFER], entryPoint: 'vs', module },
    });
  }

  createCardMips(device) {
    const mipLayout = bindLayout(device, 'card-mip', [
      entry.texture('float', '2d-array', GPUShaderStage.COMPUTE),
      entry.texture('float', '2d-array', GPUShaderStage.COMPUTE),
      entry.storageTexture('rgba8unorm', '2d-array'),
      entry.storageTexture('rgba8unorm', '2d-array'),
    ]);
    this.mipPipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, cardMipWGSL, 'card-mip') },
      label: 'card-mip',
      layout: device.createPipelineLayout({ bindGroupLayouts: [mipLayout] }),
    });
    this.mipGroups = [];
    for (let m = 1; m < this.cardMips; m += 1)
      this.mipGroups.push(
        bindGroup(device, mipLayout, [
          mipView(this.cardAlb, m - 1),
          mipView(this.cardNrm, m - 1),
          mipView(this.cardAlb, m),
          mipView(this.cardNrm, m),
        ]),
      );
  }

  bakeCards(encoder, frameGroup) {
    if (this.cardsBaked) return;
    this.cardsBaked = true;
    const depth = this.device.createTexture({
      format: DEPTH,
      size: [CARD_SIZE, CARD_SIZE],
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    for (const [sp, range] of this.cardRanges.entries())
      for (let k = 0; k < CARD_VIEWS; k += 1) this.bakeCard(encoder, { depth, frameGroup }, sp * CARD_VIEWS + k, range);
    this.bakeCardMips(encoder);
  }

  // Renders one (species, view) layer of the impostor atlas.
  bakeCard(encoder, { depth, frameGroup }, layer, range) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [cardTarget(this.cardAlb, layer), cardTarget(this.cardNrm, layer)],
      depthStencilAttachment: {
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        view: depth.createView(),
      },
      label: 'card-bake',
    });
    pass.setPipeline(this.bakePipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.bakeGroup, [layer * PARAM_STRIDE]);
    pass.setBindGroup(2, this.leafGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(range.indexCount, 1, range.firstIndex, range.baseVertex, 0);
    pass.end();
  }

  bakeCardMips(encoder) {
    const pass = encoder.beginComputePass({ label: 'card-mips' });
    pass.setPipeline(this.mipPipeline);
    for (const [index, group] of this.mipGroups.entries()) {
      const size = CARD_SIZE / 2 ** (index + 1);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(size / WORKGROUP), Math.ceil(size / WORKGROUP), CARDS.length * CARD_VIEWS);
    }
    pass.end();
  }

  // Depth pyramid from the previous frame for occlusion culling (none yet: a 1x1 placeholder).
  setHiZ(view) {
    this.scatterGroup = bindGroup(
      this.device,
      this.scatterLayout,
      [
        { buffer: this.paramBuffer, size: PARAM_BYTES },
        this.instanceBuffer,
        this.argsBuffer,
        view ??
          this.device
            .createTexture({ format: 'r32float', size: [1, 1], usage: GPUTextureUsage.TEXTURE_BINDING })
            .createView(),
        this.flockState,
      ],
      'scatter',
    );
  }

  // Layers with `every` keep last frame's instances on their off frames; their
  // draw arguments are only reset when they re-scatter.
  scatter(encoder, frameGroup, frame) {
    const run = this.resetDueLayers(frame),
      pass = encoder.beginComputePass({ label: 'scatter' });
    pass.setPipeline(this.scatterPipeline);
    pass.setBindGroup(0, frameGroup);
    for (const layer of run) {
      pass.setBindGroup(1, this.scatterGroup, [this.layers.indexOf(layer) * PARAM_STRIDE]);
      pass.dispatchWorkgroups(layer.groups[0], layer.groups[1]);
    }
    pass.setPipeline(this.finalizePipeline);
    pass.setBindGroup(0, this.finalizeGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  // The layers that re-scatter this frame, with their draw arguments reset.
  resetDueLayers(frame) {
    const run = this.layers.filter((layer) => !layer.every || frame === 0 || frame % layer.every === layer.phase);
    for (const layer of run) {
      const first = layer.slots[0].index,
        end = layer.slots.at(-1).index + 1;
      this.device.queue.writeBuffer(
        this.argsBuffer,
        first * INDEXED_ARGS_BYTES,
        this.argsTemplate,
        first * INDEXED_ARGS,
        (end - first) * INDEXED_ARGS,
      );
    }
    return run;
  }

  drawSlots(pass, filter) {
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    const drawn = this.slots.filter((slot) => !filter || filter(slot));
    for (const s of drawn) {
      pass.setVertexBuffer(1, this.instanceBuffer, s.base * INSTANCE_BYTES, s.cap * INSTANCE_BYTES);
      pass.drawIndexedIndirect(this.argsBuffer, s.index * INDEXED_ARGS_BYTES);
    }
  }

  // Everything the visibility buffer passes read (binding order of propData).
  get visibilityResources() {
    return [
      ...this.cardViews,
      this.vertexBuffer,
      this.indexBuffer,
      this.instanceBuffer,
      this.slotBuffer,
      this.startBuffer,
      ...this.leaves.resources,
    ];
  }

  drawShadow(pass, frameGroup, cascadeGroup, cascade) {
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, cascadeGroup);
    pass.setBindGroup(2, this.leafGroup);
    this.drawSlots(pass, (s) => castsShadow(s, cascade));
  }
}
