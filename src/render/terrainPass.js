// Terrain: geometry clipmap whose heights are baked on the GPU into a
// texture-array cache (one layer per level), re-baked only when a level moves.
import { shader, bufferWithData, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { terrainCacheWGSL, terrainWGSL, terrainShadowWGSL, GRID_M } from '../shaders/terrain.js';
import { HDR, DEPTH, depthState } from './layouts.js';

export const LEVELS = 8;
const BASE_CELL = 0.5;
const SIDE = GRID_M * 2 + 1;

function buildGrid() {
  const verts = new Float32Array(SIDE * SIDE * 2);
  for (let z = 0; z < SIDE; z++) for (let x = 0; x < SIDE; x++) {
    verts[(z * SIDE + x) * 2] = x - GRID_M;
    verts[(z * SIDE + x) * 2 + 1] = z - GRID_M;
  }
  const idx = (x, z) => (z + GRID_M) * SIDE + (x + GRID_M);
  const build = (hole) => {
    const out = [];
    const h = GRID_M / 2 - 1;
    for (let z = -GRID_M; z < GRID_M; z++) for (let x = -GRID_M; x < GRID_M; x++) {
      if (hole && x >= -h && x < h && z >= -h && z < h) continue;
      const a = idx(x, z), b = idx(x + 1, z), c = idx(x + 1, z + 1), d = idx(x, z + 1);
      out.push(a, c, b, a, d, c);
    }
    return new Uint32Array(out);
  };
  return { verts, full: build(false), ring: build(true) };
}

export class TerrainPass {
  constructor(device, shared) {
    this.device = device;
    const grid = buildGrid();
    const U = GPUBufferUsage;
    this.vertexBuffer = bufferWithData(device, grid.verts, U.VERTEX, 'grid-verts');
    this.fullIndex = bufferWithData(device, grid.full, U.INDEX, 'grid-full');
    this.ringIndex = bufferWithData(device, grid.ring, U.INDEX, 'grid-ring');
    this.fullCount = grid.full.length;
    this.ringCount = grid.ring.length;

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

  drawGrid(pass, levels = LEVELS) {
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.fullIndex, 'uint32');
    pass.drawIndexed(this.fullCount, 1, 0, 0, 0);
    pass.setIndexBuffer(this.ringIndex, 'uint32');
    pass.drawIndexed(this.ringCount, levels - 1, 0, 0, 1);
  }

  draw(pass, frameGroup, shadowGroup) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, shadowGroup);
    this.drawGrid(pass);
  }

  drawShadow(pass, frameGroup, cascadeGroup, levels) {
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, cascadeGroup);
    this.drawGrid(pass, levels);
  }
}
