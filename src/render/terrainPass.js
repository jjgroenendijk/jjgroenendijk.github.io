// Terrain: geometry clipmap whose heights are baked on the GPU into a
// texture-array cache (one layer per level), re-baked only when a level moves.
import { shader, bufferWithData, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { terrainCacheWGSL, terrainWGSL, terrainShadowWGSL, GRID_M } from '../shaders/terrain.js';
import { HDR, DEPTH, depthState } from './layouts.js';
import { LEVELS } from '../shaders/common.js';

export { LEVELS };

const BASE_CELL = 0.5;
const SIDE = GRID_M * 2 + 1;
const TILES = 4; // each level is split into TILES x TILES blocks for culling
const TILE = (GRID_M * 2) / TILES;
const Y_RANGE = [-70, 450]; // conservative terrain height range (incl. waves and canopy shell)

function buildGrid() {
  const verts = new Float32Array(SIDE * SIDE * 2);
  for (let z = 0; z < SIDE; z++) for (let x = 0; x < SIDE; x++) {
    verts[(z * SIDE + x) * 2] = x - GRID_M;
    verts[(z * SIDE + x) * 2 + 1] = z - GRID_M;
  }
  const idx = (x, z) => (z + GRID_M) * SIDE + (x + GRID_M);
  // indices are grouped by tile so every tile is one contiguous range
  const build = (hole) => {
    const out = [];
    const ranges = [];
    const h = GRID_M / 2 - 1;
    for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) {
      const first = out.length;
      for (let z = tz * TILE - GRID_M; z < (tz + 1) * TILE - GRID_M; z++) for (let x = tx * TILE - GRID_M; x < (tx + 1) * TILE - GRID_M; x++) {
        if (hole && x >= -h && x < h && z >= -h && z < h) continue;
        const a = idx(x, z), b = idx(x + 1, z), c = idx(x + 1, z + 1), d = idx(x, z + 1);
        out.push(a, c, b, a, d, c);
      }
      ranges.push([first, out.length - first]);
    }
    return { indices: out, ranges };
  };
  const full = build(false), ring = build(true);
  const indices = new Uint32Array(full.indices.length + ring.indices.length);
  indices.set(full.indices);
  indices.set(ring.indices, full.indices.length);
  const off = full.indices.length;
  return { verts, indices, full: full.ranges, ring: ring.ranges.map(([f, c]) => [f + off, c]) };
}

// is the box [lo, hi] (camera relative) at least partly inside all planes?
function boxVisible(planes, lo, hi) {
  for (const p of planes) {
    const x = p[0] >= 0 ? hi[0] : lo[0], y = p[1] >= 0 ? hi[1] : lo[1], z = p[2] >= 0 ? hi[2] : lo[2];
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}

export class TerrainPass {
  constructor(device, shared) {
    this.device = device;
    const grid = buildGrid();
    const U = GPUBufferUsage;
    this.vertexBuffer = bufferWithData(device, grid.verts, U.VERTEX, 'grid-verts');
    this.indexBuffer = bufferWithData(device, grid.indices, U.INDEX, 'grid-indices');
    this.tileRanges = [grid.full, grid.ring];
    this.levelData = new Float32Array(LEVELS * 4);

    this.cache = device.createTexture({
      label: 'terrain-cache', size: [SIDE, SIDE, LEVELS], format: 'rgba32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.cacheView = this.cache.createView({ dimension: '2d-array' });

    const cacheLayout = bindLayout(device, 'terrain-cache', [entry.uniform(), entry.storageTexture('rgba32float', '2d-array')]);
    this.cacheLayout = cacheLayout;
    this.cachePipeline = device.createComputePipeline({
      label: 'terrain-cache',
      layout: device.createPipelineLayout({ bindGroupLayouts: [cacheLayout] }),
      compute: { module: shader(device, terrainCacheWGSL, 'terrain-cache'), entryPoint: 'main' },
    });

    const vertexBuffers = [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }];
    const main = shader(device, terrainWGSL, 'terrain');
    this.pipeline = device.createRenderPipeline({
      label: 'terrain',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow] }),
      vertex: { module: main, entryPoint: 'vs', buffers: vertexBuffers },
      fragment: { module: main, entryPoint: 'fs', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: depthState(),
    });
    const sh = shader(device, terrainShadowWGSL, 'terrain-shadow');
    this.shadowPipeline = device.createRenderPipeline({
      label: 'terrain-shadow',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.cascade] }),
      vertex: { module: sh, entryPoint: 'vs', buffers: vertexBuffers },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 2.5 },
    });

    this.centers = new Array(LEVELS).fill(null);
    this.refreshCursor = 0;
    this.frameCount = 0;
  }

  // Snap each level to its own lattice. Returns per-level vec4 data and the
  // bitmask of levels whose cache must be re-baked this frame.
  updateLevels(cam, force = false) {
    const data = new Float32Array(LEVELS * 4);
    let mask = 0;
    for (let l = 0; l < LEVELS; l++) {
      const cell = BASE_CELL * 2 ** l;
      const snap = cell * 2;
      const cx = Math.floor(cam[0] / snap) * snap;
      const cz = Math.floor(cam[2] / snap) * snap;
      const prev = this.centers[l];
      if (force || !prev || prev[0] !== cx || prev[1] !== cz) mask |= 1 << l;
      this.centers[l] = [cx, cz];
      data.set([cx, cz, cell, l === LEVELS - 1 ? 1 : 0], l * 4);
    }
    this.levelData = data;
    this.cam = cam;
    // periodically refresh far levels so horizon shadows follow the sun
    if (++this.frameCount % 24 === 0) {
      mask |= 1 << (2 + (this.refreshCursor++ % (LEVELS - 2)));
    }
    return { data, mask };
  }

  cacheBindGroup(frameBuffer) {
    return bindGroup(this.device, this.cacheLayout, [frameBuffer, this.cacheView], 'terrain-cache');
  }

  bake(pass, group) {
    pass.setPipeline(this.cachePipeline);
    pass.setBindGroup(0, group);
    const n = Math.ceil(SIDE / 8);
    pass.dispatchWorkgroups(n, n, LEVELS);
  }

  // Visible tile ranges for a set of camera-relative clip planes, merged into
  // as few draws as possible: [firstIndex, indexCount, level].
  visibleDraws(planes, levels = LEVELS) {
    const draws = [];
    const lo = [0, Y_RANGE[0] - this.cam[1], 0], hi = [0, Y_RANGE[1] - this.cam[1], 0];
    for (let l = 0; l < levels; l++) {
      const [cx, cz, cell] = this.levelData.subarray(l * 4, l * 4 + 3);
      const ranges = this.tileRanges[l === 0 ? 0 : 1];
      let open = null;
      for (let t = 0; t < ranges.length; t++) {
        const [first, count] = ranges[t];
        if (!count) continue;
        const tx = t % TILES, tz = (t / TILES) | 0;
        lo[0] = cx - this.cam[0] + (tx * TILE - GRID_M) * cell; hi[0] = lo[0] + TILE * cell;
        lo[2] = cz - this.cam[2] + (tz * TILE - GRID_M) * cell; hi[2] = lo[2] + TILE * cell;
        if (!boxVisible(planes, lo, hi)) { open = null; continue; }
        if (open && open[0] + open[1] === first) open[1] += count;
        else { open = [first, count, l]; draws.push(open); }
      }
    }
    return draws;
  }

  drawGrid(pass, draws) {
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    for (const [first, count, l] of draws) pass.drawIndexed(count, 1, first, 0, l);
  }

  draw(pass, frameGroup, shadowGroup, draws) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, shadowGroup);
    this.drawGrid(pass, draws);
  }

  drawShadow(pass, frameGroup, cascadeGroup, draws) {
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, cascadeGroup);
    this.drawGrid(pass, draws);
  }
}
