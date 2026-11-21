// Terrain: geometry clipmap whose heights are baked on the GPU into a
// toroidally addressed texture-array cache (one layer per level). A level that
// moves only bakes the texels that scrolled in; a few rows per frame are
// refreshed so far horizon shadows follow the sun without frame-time spikes.
import {
  BAKE_BYTES,
  CACHE_LAYERS,
  GRID_M,
  SIDE,
  TILE,
  TILES,
  terrainCacheWGSL,
  terrainCullWGSL,
  terrainShadowWGSL,
  terrainWGSL,
} from '../shaders/terrain.js';
import { DEPTH, HDR, depthState } from './layouts.js';
import { at, bindGroup, bindLayout, buffer, bufferWithData, entry, flags, shader } from '../core/gpu.js';
import { LEVELS } from '../shaders/common.js';

// Cache bake mode per level, as needsBake in the shader reads it.
const BAKE = { all: 2, keep: 0, scrolled: 1 },
  // The bake parameters' binding in the cache group.
  BAKE_BINDING = 6,
  BAKE_WORKGROUP = 8,
  // Cell size of the finest level (m).
  BASE_CELL = 0.5,
  // Per cluster: first index, index count, level, tile.
  CLUSTER_WORDS = 4,
  // An indexed indirect draw: five u32 arguments.
  DRAW_ARGS_BYTES = 20,
  // Finer levels carry no horizon shadow.
  FIRST_SHADOWED = 2,
  FLOAT_BYTES = 4,
  // Half-width (in cells) of the hole a ring level leaves for the finer level inside it.
  HOLE = GRID_M / 2 - 1,
  INDEX_BYTES = 4,
  // A vec4f per level: centre xz, cell size, and whether it is the outermost level.
  LEVEL_FLOATS = 4,
  // Horizon shadow rows re-baked per frame.
  REFRESH_ROWS = 16,
  // Conservative terrain height range (incl. waves and canopy shell).
  Y_RANGE = { max: 450, min: -70 },
  // Is the box [lo, hi] (camera relative) at least partly inside all planes? Tests the corner furthest along each
  // plane's normal.
  boxVisible = (planes, lo, hi) =>
    planes.every((p) => {
      const [x, y, z] = [0, 1, 2].map((k) => [lo, hi][Number(p[k] >= 0)][k]);
      return p[0] * x + p[1] * y + p[2] * z + p[3] >= 0;
    }),
  // Vertex index of grid corner (x, z); the level's base vertex is added at draw time.
  cellCorner = (x, z) => (z + GRID_M) * SIDE + (x + GRID_M),
  // The two triangles of the cell at (x, z).
  cellTriangles = (x, z) => [
    cellCorner(x, z),
    cellCorner(x + 1, z + 1),
    cellCorner(x + 1, z),
    cellCorner(x, z),
    cellCorner(x, z + 1),
    cellCorner(x + 1, z + 1),
  ],
  isInHole = (x, z) => x >= -HOLE && x < HOLE && z >= -HOLE && z < HOLE,
  // Extends the open draw with `draw` when its indices follow on, otherwise starts a new draw. Returns the open draw.
  joinDraw = (draws, open, draw) => {
    if (open.length > 0 && open[0] + open[1] === draw[0]) {
      open[1] += draw[1];
      return open;
    }
    draws.push(draw);
    return draw;
  },
  // Appends the cells of tile (tx, tz), leaving out the hole when the grid is a ring.
  pushTile = (out, tx, tz, hasHole) => {
    for (let z = tz * TILE - GRID_M; z < (tz + 1) * TILE - GRID_M; z += 1)
      for (let x = tx * TILE - GRID_M; x < (tx + 1) * TILE - GRID_M; x += 1)
        if (!(hasHole && isInHole(x, z))) out.push(...cellTriangles(x, z));
  },
  // Indices are grouped by tile so every tile is one contiguous range.
  tileIndices = (hasHole) => {
    const out = [],
      ranges = [];
    for (let tz = 0; tz < TILES; tz += 1)
      for (let tx = 0; tx < TILES; tx += 1) {
        const first = out.length;
        pushTile(out, tx, tz, hasHole);
        ranges.push([first, out.length - first]);
      }
    return { indices: out, ranges };
  },
  // Index buffer of the clipmap grid. There is no vertex buffer: the shaders
  // derive each vertex from vertex_index (base vertex = level * SIDE^2).
  tiledGrid = () => {
    const full = tileIndices(false),
      holed = tileIndices(true),
      indices = new Uint32Array(full.indices.length + holed.indices.length);
    indices.set(full.indices);
    indices.set(holed.indices, full.indices.length);
    return {
      full: full.ranges,
      indices,
      ring: holed.ranges.map(([first, count]) => [first + full.indices.length, count]),
    };
  };

export class TerrainPass {
  // Created by the constructor's helpers.
  bakeBuffer;
  bakeData;
  cache;
  cacheLayout;
  cachePipeline;
  cacheView;
  clusterBuffer;
  clusterCount;
  cullLayout;
  cullPipeline;
  drawArgs;
  drawIndices;
  groundGroup;
  pipeline;
  shadowPipeline;
  // Camera position of the last updateLevels(), and the cull group bound to the current Hi-Z view.
  cam;
  cullGroup;

  constructor(device, shared, ground) {
    this.device = device;
    const grid = tiledGrid();
    this.indexBuffer = bufferWithData(
      device,
      grid.indices,
      flags(GPUBufferUsage.INDEX, GPUBufferUsage.STORAGE),
      'grid-indices',
    );
    this.tileRanges = [grid.full, grid.ring];
    this.levelData = new Float32Array(LEVELS * LEVEL_FLOATS);
    this.createCache(device);
    this.createCulling(device, shared.frame);
    this.createPipelines(device, shared, ground);
    this.centers = Array.from({ length: LEVELS });
    this.refreshCursor = 0;
  }

  createCache(device) {
    this.cache = device.createTexture({
      format: 'rgba32float',
      label: 'terrain-cache',
      size: [SIDE, SIDE, CACHE_LAYERS],
      usage: flags(GPUTextureUsage.STORAGE_BINDING, GPUTextureUsage.TEXTURE_BINDING),
    });
    this.cacheView = this.cache.createView({ dimension: '2d-array' });
    this.bakeData = new Float32Array(BAKE_BYTES / FLOAT_BYTES);
    this.bakeBuffer = buffer(
      device,
      BAKE_BYTES,
      flags(GPUBufferUsage.UNIFORM, GPUBufferUsage.COPY_DST),
      'terrain-bake',
    );
    this.cacheLayout = bindLayout(device, 'terrain-cache', [
      entry.uniform(),
      entry.storageTexture('rgba32float', '2d-array'),
      at(BAKE_BINDING, entry.uniform()),
    ]);
    this.cachePipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, terrainCacheWGSL, 'terrain-cache') },
      label: 'terrain-cache',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.cacheLayout] }),
    });
  }

  // GPU cluster culling: visible (level, tile) clusters are compacted into one index list.
  createCulling(device, frameLayout) {
    const clusters = [];
    let maxIndices = 0;
    for (let level = 0; level < LEVELS; level += 1)
      for (const [t, [first, count]] of this.rangesOf(level).entries()) {
        clusters.push(first, count, level, t);
        maxIndices += count;
      }
    this.clusterCount = clusters.length / CLUSTER_WORDS;
    this.clusterBuffer = bufferWithData(device, new Uint32Array(clusters), GPUBufferUsage.STORAGE, 'terrain-clusters');
    this.drawArgs = buffer(
      device,
      DRAW_ARGS_BYTES,
      flags(GPUBufferUsage.STORAGE, GPUBufferUsage.INDIRECT, GPUBufferUsage.COPY_DST),
      'terrain-draw',
    );
    this.drawIndices = buffer(
      device,
      maxIndices * INDEX_BYTES,
      flags(GPUBufferUsage.STORAGE, GPUBufferUsage.INDEX),
      'terrain-visible-indices',
    );
    this.cullLayout = bindLayout(device, 'terrain-cull', [
      entry.storage(true),
      entry.storage(),
      entry.texture('unfilterable-float', '2d', GPUShaderStage.COMPUTE),
      entry.storage(true),
      entry.storage(),
    ]);
    this.cullPipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, terrainCullWGSL, 'terrain-cull') },
      label: 'terrain-cull',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, this.cullLayout] }),
    });
  }

  createPipelines(device, shared, ground) {
    const fragment = GPUShaderStage.FRAGMENT,
      // Ground material textures (albedo + height, normal + roughness + occlusion).
      groundLayout = bindLayout(device, 'ground', [
        entry.texture('float', '2d-array', fragment),
        entry.texture('float', '2d-array', fragment),
        entry.sampler('filtering', fragment),
      ]),
      main = shader(device, terrainWGSL, 'terrain'),
      shadowShader = shader(device, terrainShadowWGSL, 'terrain-shadow'),
      vertexBuffers = [];
    this.groundGroup = bindGroup(device, groundLayout, [...ground.views, ground.sampler], 'ground');
    this.pipeline = device.createRenderPipelineAsync({
      depthStencil: depthState(),
      fragment: { entryPoint: 'fs', module: main, targets: [{ format: HDR }] },
      label: 'terrain',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow, groundLayout] }),
      primitive: { cullMode: 'back', frontFace: 'ccw', topology: 'triangle-list' },
      vertex: { buffers: vertexBuffers, entryPoint: 'vs', module: main },
    });
    this.shadowPipeline = device.createRenderPipelineAsync({
      depthStencil: {
        depthBias: 3,
        depthBiasSlopeScale: 2.5,
        depthCompare: 'less',
        depthWriteEnabled: true,
        format: DEPTH,
      },
      label: 'terrain-shadow',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.cascade] }),
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: { buffers: vertexBuffers, entryPoint: 'vs', module: shadowShader },
    });
  }

  // Tile ranges of a level: the full grid for level 0, the ring around the finer level for the others.
  rangesOf(level) {
    return this.tileRanges[Math.min(level, 1)];
  }

  // Snap each level to its own lattice and decide what the cache bake has to
  // do per level (see needsBake in the shader). Returns per-level vec4 data.
  updateLevels(cam, isForced = false) {
    const data = new Float32Array(LEVELS * LEVEL_FLOATS);
    for (let level = 0; level < LEVELS; level += 1) this.snapLevel(level, cam, isForced, data);
    this.queueRefreshBand();
    this.device.queue.writeBuffer(this.bakeBuffer, 0, this.bakeData);
    this.levelData = data;
    this.cam = cam;
    return { data };
  }

  // Snaps one level, records its bake parameters and writes its vec4 into `data`.
  snapLevel(level, cam, isForced, data) {
    const cell = BASE_CELL * 2 ** level,
      lattice = cell * 2,
      [cx, cz] = [Math.floor(cam[0] / lattice) * lattice, Math.floor(cam[2] / lattice) * lattice],
      previous = this.centers[level],
      [px, pz] = previous ?? [cx, cz];
    let mode = BAKE.keep;
    if (isForced || !previous) mode = BAKE.all;
    else if (previous[0] !== cx || previous[1] !== cz) mode = BAKE.scrolled;
    this.bakeData.set([px, pz, mode, 0], level * LEVEL_FLOATS);
    this.centers[level] = [cx, cz];
    data.set([cx, cz, cell, Number(level === LEVELS - 1)], level * LEVEL_FLOATS);
  }

  // A band of rows of one far level is re-baked every frame.
  queueRefreshBand() {
    const bands = Math.ceil(SIDE / REFRESH_ROWS),
      k = this.refreshCursor % ((LEVELS - FIRST_SHADOWED) * bands),
      row = (k % bands) * REFRESH_ROWS;
    this.refreshCursor += 1;
    this.bakeData.set([FIRST_SHADOWED + Math.floor(k / bands), row, row + REFRESH_ROWS, 0], LEVELS * LEVEL_FLOATS);
  }

  cacheBindGroup(frameBuffer) {
    return bindGroup(
      this.device,
      this.cacheLayout,
      [frameBuffer, this.cacheView, at(BAKE_BINDING, this.bakeBuffer)],
      'terrain-cache',
    );
  }

  bake(pass, group) {
    pass.setPipeline(this.cachePipeline);
    pass.setBindGroup(0, group);
    const n = Math.ceil(SIDE / BAKE_WORKGROUP);
    pass.dispatchWorkgroups(n, n, LEVELS);
  }

  // Visible tile ranges for a set of camera-relative clip planes, merged into
  // as few draws as possible: [firstIndex, indexCount, level].
  visibleDraws(planes, levels = LEVELS) {
    const box = { hi: [0, Y_RANGE.max - this.cam[1], 0], lo: [0, Y_RANGE.min - this.cam[1], 0] },
      draws = [];
    for (let level = 0; level < levels; level += 1) this.appendVisible(draws, level, planes, box);
    return draws;
  }

  // Appends one level's visible tiles to `draws`; tiles without indices neither draw nor break a run.
  appendVisible(draws, level, planes, box) {
    const [cx, cz, cell] = this.levelData.subarray(level * LEVEL_FLOATS);
    // The draw the next adjacent visible tile extends; [] while no run is open.
    let open = [];
    for (const [t, [first, count]] of this.rangesOf(level).entries())
      if (count)
        open = (this.tileVisible(planes, box, [cx, cz, cell], t) && joinDraw(draws, open, [first, count, level])) || [];
  }

  // Places the height-range box on tile `t` of a level centred at (cx, cz) and tests it against the planes.
  tileVisible(planes, { hi, lo }, [cx, cz, cell], t) {
    const tx = t % TILES,
      tz = Math.trunc(t / TILES);
    lo[0] = cx - this.cam[0] + (tx * TILE - GRID_M) * cell;
    hi[0] = lo[0] + TILE * cell;
    lo[2] = cz - this.cam[2] + (tz * TILE - GRID_M) * cell;
    hi[2] = lo[2] + TILE * cell;
    return boxVisible(planes, lo, hi);
  }

  drawGrid(pass, draws) {
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    for (const [first, count, level] of draws) pass.drawIndexed(count, 1, first, level * SIDE * SIDE, 0);
  }

  setHiZ(view) {
    this.cullGroup = bindGroup(
      this.device,
      this.cullLayout,
      [this.clusterBuffer, this.drawArgs, view, this.indexBuffer, this.drawIndices],
      'terrain-cull',
    );
  }

  // Exact per-tile height bounds, frustum and occlusion test on the GPU; the
  // surviving tiles are appended to one index list.
  cull(encoder, frameGroup) {
    encoder.clearBuffer(this.drawArgs);
    const pass = encoder.beginComputePass({ label: 'terrain-cull' });
    pass.setPipeline(this.cullPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.cullGroup);
    pass.dispatchWorkgroups(this.clusterCount);
    pass.end();
  }

  // The visible grid in one draw, with the arguments written by cull().
  drawCulled(pass) {
    pass.setIndexBuffer(this.drawIndices, 'uint32');
    pass.drawIndexedIndirect(this.drawArgs, 0);
  }

  draw(pass, frameGroup, shadowGroup) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, shadowGroup);
    pass.setBindGroup(2, this.groundGroup);
    this.drawCulled(pass);
  }

  drawShadow(pass, frameGroup, cascadeGroup, draws) {
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, cascadeGroup);
    this.drawGrid(pass, draws);
  }
}
