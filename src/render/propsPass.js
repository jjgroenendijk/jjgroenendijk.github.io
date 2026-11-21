// Vegetation, rocks, corals and wildlife. A compute shader scatters instances
// around the camera every frame (frustum culled, LOD selected) straight into
// GPU buffers that feed indirect draws: no per-instance CPU work at all.
// The camera view draws them all at once through the visibility buffer
// (PropsVisibility); the shadow cascades draw slot by slot.
import { shader, buffer, bufferWithData, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { scatterWGSL, finalizeWGSL, propShadowWGSL, cardBakeWGSL, cardMipWGSL, MAX_SLOTS } from '../shaders/props.js';
import { LAYERS, TYPE, CARDS, CARD_GRID, CARD_VIEWS, CARD_SIZE } from '../scene/catalog.js';
import { LeafTextures } from './leafTextures.js';
import { DEPTH } from './layouts.js';

const PARAM_STRIDE = 256;
const INSTANCE_BYTES = 32;
const PARAM_BYTES = 128;
const FADE_BAND = 0.08; // LOD cross-fade overlap, as a fraction of the switch distance

function mergeMeshes(meshes) {
  const ranges = {};
  let vCount = 0,
    iCount = 0;
  for (const [name, m] of Object.entries(meshes)) {
    ranges[name] = { baseVertex: vCount, firstIndex: iCount, indexCount: m.i.length, bound: m.bound };
    vCount += m.v.length / 10;
    iCount += m.i.length;
  }
  const v = new Float32Array(vCount * 10),
    i = new Uint32Array(iCount);
  for (const [name, m] of Object.entries(meshes)) {
    v.set(m.v, ranges[name].baseVertex * 10);
    i.set(m.i, ranges[name].firstIndex);
  }
  return { v, i, ranges };
}

export class PropsPass {
  constructor(device, shared, meshes, quality, flockState, leaves) {
    this.device = device;
    this.flockState = flockState;
    this.leaves = leaves;
    this.leafLayout = bindLayout(device, 'leaves', LeafTextures.entries(GPUShaderStage.FRAGMENT));
    this.leafGroup = bindGroup(device, this.leafLayout, leaves.resources, 'leaves');
    const U = GPUBufferUsage;
    const merged = mergeMeshes(meshes);
    // also read as storage by the visibility buffer passes
    this.vertexBuffer = bufferWithData(device, merged.v, U.VERTEX | U.STORAGE, 'prop-verts');
    this.indexBuffer = bufferWithData(device, merged.i, U.INDEX | U.STORAGE, 'prop-indices');

    // draw slots: one per (layer, lod)
    this.layers = [];
    this.slots = [];
    let base = 0;
    for (const layer of LAYERS) {
      const slots = layer.meshes.map((mesh, k) => {
        const cap = Math.ceil(layer.caps[k] * (layer.count ? 1 : quality.density));
        const slot = {
          index: this.slots.length,
          mesh,
          cap,
          base,
          lod: (layer.lodBase || 0) + k,
          range: merged.ranges[mesh],
          shadow: layer.shadow ?? layer.type !== 'bird',
        };
        base += cap;
        this.slots.push(slot);
        return slot;
      });
      const scale = layer.count ? 1 : quality.distance;
      this.layers.push({
        ...layer,
        slots,
        variants: layer.variants || 1,
        maxDist: layer.maxDist * scale,
        minDist: layer.minDist ? layer.minDist * scale : -1,
        fadeDist: (layer.fadeDist ?? layer.maxDist) * scale,
        lods: layer.lods || [],
      });
    }
    this.setFades();
    // how far the forest reaches (the terrain fakes a canopy beyond it)
    this.vegDist = Math.max(...this.layers.filter((l) => l.type === 'tree').map((l) => l.maxDist));
    this.instanceBuffer = buffer(device, base * INSTANCE_BYTES, U.STORAGE | U.VERTEX, 'prop-instances');

    this.argsTemplate = new Uint32Array(this.slots.length * 5);
    for (const s of this.slots)
      this.argsTemplate.set([s.range.indexCount, 0, s.range.firstIndex, s.range.baseVertex, 0], s.index * 5);
    this.argsBuffer = buffer(
      device,
      this.argsTemplate.byteLength,
      U.STORAGE | U.INDIRECT | U.COPY_DST | U.COPY_SRC,
      'prop-args',
    );
    this.capsBuffer = bufferWithData(device, new Uint32Array(this.slots.map((s) => s.cap)), U.STORAGE, 'prop-caps');
    if (this.slots.length > MAX_SLOTS) throw new Error(`too many prop slots: ${this.slots.length} > ${MAX_SLOTS}`);
    // per slot: where its mesh and instances live (struct SlotInfo)
    const slotData = new ArrayBuffer(this.slots.length * SLOT_BYTES);
    this.slots.forEach((s, k) => {
      new Uint32Array(slotData, k * SLOT_BYTES, 4).set([
        s.range.firstIndex,
        s.range.baseVertex,
        s.range.indexCount,
        s.base,
      ]);
      new Float32Array(slotData, k * SLOT_BYTES + 16, 4).set(s.fade);
    });
    this.slotBuffer = bufferWithData(device, new Uint32Array(slotData), U.STORAGE, 'prop-slots');
    // first triangle corner of each slot in the merged draw, then the total
    this.startBuffer = buffer(device, (this.slots.length + 1) * 4, U.STORAGE, 'prop-slot-starts');
    this.drawArgs = buffer(device, 16, U.STORAGE | U.INDIRECT, 'prop-draw');

    // per-layer scatter parameters (struct SP in the scatter shader)
    const params = new ArrayBuffer(PARAM_STRIDE * this.layers.length);
    this.layers.forEach((layer, k) => {
      const f = new Float32Array(params, k * PARAM_STRIDE, PARAM_BYTES / 4);
      const u = new Uint32Array(params, k * PARAM_STRIDE, PARAM_BYTES / 4);
      const radius = layer.count ? 0 : Math.ceil(layer.maxDist / layer.cell);
      f[0] = layer.cell || 1;
      f[1] = radius;
      f[2] = layer.maxDist;
      f[3] = layer.minDist;
      u[4] = TYPE[layer.type];
      u[5] = layer.count || 0;
      u[6] = layer.variants;
      u[7] = layer.slots.length / layer.variants;
      f[8] = Math.max(...layer.slots.map((sl) => sl.range.bound));
      f[9] = layer.keep;
      f[10] = layer.reach || 0;
      f[11] = layer.fadeDist;
      for (let j = 0; j < 4; j++) {
        const sl = layer.slots[Math.min(j, layer.slots.length - 1)];
        f[12 + j] = layer.lods[j] ?? 1e9;
        u[16 + j] = sl.index;
        u[20 + j] = sl.base;
        u[24 + j] = sl.cap;
      }
      f[28] = FADE_BAND;
      layer.groups = layer.count
        ? [8, Math.ceil(layer.count / 64)]
        : [Math.ceil((2 * radius + 1) / 8), Math.ceil((2 * radius + 1) / 8)];
    });
    this.paramBuffer = bufferWithData(device, new Uint8Array(params), U.UNIFORM, 'scatter-params');

    this.scatterLayout = bindLayout(device, 'scatter', [
      entry.uniform(true),
      entry.storage(),
      entry.storage(),
      entry.texture('unfilterable-float', '2d', GPUShaderStage.COMPUTE),
      entry.storage(true),
    ]);
    this.setHiZ(null);
    this.scatterPipeline = device.createComputePipelineAsync({
      label: 'scatter',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.scatterLayout] }),
      compute: { module: shader(device, scatterWGSL, 'scatter'), entryPoint: 'main' },
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
      label: 'prop-finalize',
      layout: device.createPipelineLayout({ bindGroupLayouts: [finalizeLayout] }),
      compute: { module: shader(device, finalizeWGSL, 'prop-finalize'), entryPoint: 'main' },
    });

    const vertexBuffers = [
      {
        arrayStride: 40,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x4' },
        ],
      },
      {
        arrayStride: INSTANCE_BYTES,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 3, offset: 0, format: 'float32x4' },
          { shaderLocation: 4, offset: 16, format: 'float32x4' },
        ],
      },
    ];
    // impostor framing: bounding sphere (centre height, radius) of each baked species
    const frames = CARDS.map(([, src]) => {
      const m = meshes[src];
      let y0 = 1e9,
        y1 = -1e9;
      for (let j = 0; j < m.v.length; j += 10) {
        y0 = Math.min(y0, m.v[j + 1]);
        y1 = Math.max(y1, m.v[j + 1]);
      }
      const cy = (y0 + y1) / 2;
      let r = 0;
      for (let j = 0; j < m.v.length; j += 10) r = Math.max(r, Math.hypot(m.v[j], m.v[j + 1] - cy, m.v[j + 2]));
      return { r: r * 1.03, cy };
    });
    this.cardFrames = frames;
    const cardConst = `const CARD = array<vec4f, ${frames.length}>(${frames.map((c) => `vec4f(${c.r}, ${c.cy}, 0.0, 0.0)`).join(', ')});`;
    // shaders that include propVS need the framing of every impostor species
    const withCards = (code) => code.replace('/*CARD_FRAMES*/', cardConst);
    this.withCards = withCards;
    this.setupCards(device, shared, merged, withCards);

    const sh = shader(device, withCards(propShadowWGSL), 'props-shadow');
    this.shadowPipeline = device.createRenderPipelineAsync({
      label: 'props-shadow',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.cascade, this.leafLayout] }),
      vertex: { module: sh, entryPoint: 'vs', buffers: vertexBuffers },
      fragment: { module: sh, entryPoint: 'fs', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: DEPTH,
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 2,
        depthBiasSlopeScale: 2.0,
      },
    });
  }

  // Impostor atlas: CARD_VIEWS orthographic views per species, rendered once,
  // from the directions of a hemi-octahedral grid (see cardImpostor).
  setupCards(device, shared, merged, withCards) {
    const layers = CARDS.length * CARD_VIEWS;
    const mips = Math.log2(CARD_SIZE) - 1; // down to 4x4
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    const tex = (label) =>
      device.createTexture({
        label,
        size: [CARD_SIZE, CARD_SIZE, layers],
        format: 'rgba8unorm',
        mipLevelCount: mips,
        usage,
      });
    this.cardAlb = tex('card-albedo');
    this.cardNrm = tex('card-normal');
    this.cardViews = [
      this.cardAlb.createView({ dimension: '2d-array' }),
      this.cardNrm.createView({ dimension: '2d-array' }),
    ];
    this.cardMips = mips;
    this.cardRanges = CARDS.map(([, src]) => merged.ranges[src]);
    this.bakeLayout = bindLayout(device, 'card-bake', [entry.uniform(true, GPUShaderStage.VERTEX)]);
    this.bakeBuffer = buffer(
      device,
      PARAM_STRIDE * layers,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'card-bake',
    );
    this.bakeGroup = bindGroup(device, this.bakeLayout, [{ buffer: this.bakeBuffer, size: 48 }]);
    const bake = shader(device, withCards(cardBakeWGSL), 'card-bake');
    this.bakePipeline = device.createRenderPipelineAsync({
      label: 'card-bake',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, this.bakeLayout, this.leafLayout] }),
      vertex: {
        module: bake,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 40,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: { module: bake, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
    });
    const mipLayout = bindLayout(device, 'card-mip', [
      entry.texture('float', '2d-array', GPUShaderStage.COMPUTE),
      entry.texture('float', '2d-array', GPUShaderStage.COMPUTE),
      entry.storageTexture('rgba8unorm', '2d-array'),
      entry.storageTexture('rgba8unorm', '2d-array'),
    ]);
    this.mipPipeline = device.createComputePipelineAsync({
      label: 'card-mip',
      layout: device.createPipelineLayout({ bindGroupLayouts: [mipLayout] }),
      compute: { module: shader(device, cardMipWGSL, 'card-mip'), entryPoint: 'main' },
    });
    const view = (t, m) => t.createView({ dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 });
    this.mipGroups = [];
    for (let m = 1; m < mips; m++) {
      this.mipGroups.push(
        bindGroup(device, mipLayout, [
          view(this.cardAlb, m - 1),
          view(this.cardNrm, m - 1),
          view(this.cardAlb, m),
          view(this.cardNrm, m),
        ]),
      );
    }
    // one uniform block per (species, view)
    const data = new Float32Array((PARAM_STRIDE / 4) * layers);
    this.cardFrames.forEach((c, sp) => {
      for (let k = 0; k < CARD_VIEWS; k++) {
        const { right, up, dir } = cardBasis(k % CARD_GRID, Math.floor(k / CARD_GRID));
        data.set([...right, c.r, ...up, c.cy, ...dir, 0], ((sp * CARD_VIEWS + k) * PARAM_STRIDE) / 4);
      }
    });
    device.queue.writeBuffer(this.bakeBuffer, 0, data);
    this.cardsBaked = false;
  }

  bakeCards(encoder, frameGroup) {
    if (this.cardsBaked) return;
    this.cardsBaked = true;
    const depth = this.device.createTexture({
      size: [CARD_SIZE, CARD_SIZE],
      format: DEPTH,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const target = (t, layer) => ({
      view: t.createView({
        dimension: '2d',
        baseMipLevel: 0,
        mipLevelCount: 1,
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      }),
      clearValue: [0, 0, 0, 0],
      loadOp: 'clear',
      storeOp: 'store',
    });
    this.cardRanges.forEach((r, sp) => {
      for (let k = 0; k < CARD_VIEWS; k++) {
        const layer = sp * CARD_VIEWS + k;
        const pass = encoder.beginRenderPass({
          label: 'card-bake',
          colorAttachments: [target(this.cardAlb, layer), target(this.cardNrm, layer)],
          depthStencilAttachment: {
            view: depth.createView(),
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
          },
        });
        pass.setPipeline(this.bakePipeline);
        pass.setBindGroup(0, frameGroup);
        pass.setBindGroup(1, this.bakeGroup, [layer * PARAM_STRIDE]);
        pass.setBindGroup(2, this.leafGroup);
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
    this.scatterGroup = bindGroup(
      this.device,
      this.scatterLayout,
      [{ buffer: this.paramBuffer, size: PARAM_BYTES }, this.instanceBuffer, this.argsBuffer, view, this.flockState],
      'scatter',
    );
  }

  // Layers with `every` keep last frame's instances on their off frames; their
  // draw arguments are only reset when they re-scatter.
  scatter(encoder, frameGroup, frame) {
    const run = this.layers.filter((l) => !l.every || frame === 0 || frame % l.every === l.phase);
    for (const l of run) {
      const a = l.slots[0].index,
        b = l.slots[l.slots.length - 1].index + 1;
      this.device.queue.writeBuffer(this.argsBuffer, a * 20, this.argsTemplate, a * 5, (b - a) * 5);
    }
    const pass = encoder.beginComputePass({ label: 'scatter' });
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

  drawSlots(pass, filter) {
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    for (const s of this.slots) {
      if (filter && !filter(s)) continue;
      pass.setVertexBuffer(1, this.instanceBuffer, s.base * INSTANCE_BYTES, s.cap * INSTANCE_BYTES);
      pass.drawIndexedIndirect(this.argsBuffer, s.index * 20);
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

  // Cross-fade distances of every slot (struct SlotInfo.fade): a LOD fades in
  // over the band below where it takes over and fades out over the band below
  // where the next takes over, also across a near layer and the far layer
  // that continues it. Matches the overlap the scatter emits (see emit).
  setFades() {
    const NONE_IN = [-2, -1],
      NONE_OUT = [1e9, 2e9];
    const band = (d) => [d * (1 - FADE_BAND), d];
    for (const layer of this.layers) {
      const per = layer.slots.length / layer.variants;
      const next = this.layers.some((l) => l.type === layer.type && l.minDist === layer.maxDist);
      layer.slots.forEach((slot, j) => {
        const k = j % per;
        const lo = k > 0 ? layer.lods[k - 1] : layer.minDist > 0 ? layer.minDist : null;
        const hi = k < per - 1 ? layer.lods[k] : next ? layer.maxDist : null;
        slot.fade = [...(lo ? band(lo) : NONE_IN), ...(hi ? band(hi) : NONE_OUT)];
      });
    }
  }

  drawShadow(pass, frameGroup, cascadeGroup, cascade) {
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, cascadeGroup);
    pass.setBindGroup(2, this.leafGroup);
    // the near cascade gets every nearby caster, the far cascades only the big
    // ones; distant LODs and impostor cards lie beyond the last cascade and never cast
    this.drawSlots(pass, (s) => s.shadow && (cascade === 0 ? s.lod === 0 : BIG.has(s.mesh) && s.lod < cascade));
  }
}

const BIG = new Set([
  'palm0',
  'palm1',
  'treeA0',
  'treeA1',
  'treeB0',
  'treeB1',
  'emergent0',
  'emergent1',
  'understory0',
  'rock',
  'banana',
  'bush',
  'galleon',
  'wreck',
  'rowboat',
]);
const SLOT_BYTES = 32; // struct SlotInfo

// Image axes of impostor view (i, j): dir points from the plant towards the
// viewer (the hemi-octahedral grid direction), right and up span the image.
function cardBasis(i, j) {
  const e = [((i + 0.5) / CARD_GRID) * 2 - 1, ((j + 0.5) / CARD_GRID) * 2 - 1];
  const px = (e[0] + e[1]) / 2,
    pz = (e[0] - e[1]) / 2;
  const dir = normalize([px, 1 - Math.abs(px) - Math.abs(pz), pz]);
  const right = normalize([dir[2], 0, -dir[0]]); // cross(up, dir)
  const up = [
    dir[1] * right[2] - dir[2] * right[1],
    dir[2] * right[0] - dir[0] * right[2],
    dir[0] * right[1] - dir[1] * right[0],
  ];
  return { right, up, dir };
}
function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}
