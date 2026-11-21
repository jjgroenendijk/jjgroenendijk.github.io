// CPU-side layout of the prop scatter: merged meshes, draw slots and their LOD cross-fades, the scatter shader's
// per-layer uniforms and the impostor card framing. Pure data packing; props-pass.js turns it into GPU buffers.
import { CARDS, CARD_GRID, CARD_VIEWS, LAYERS, TYPE } from '../scene/catalog.js';

// Bytes per uniform block of the dynamically offset scatter and card-bake buffers.
const PARAM_STRIDE = 256,
  // Struct SP of the scatter shader: its size and the u32/f32 offset of each field.
  PARAM_BYTES = 128,
  SP = {
    band: 28,
    base: 20,
    bound: 8,
    cap: 24,
    cell: 0,
    kind: 4,
    lods: 12,
    slot: 16,
  },
  // Struct SlotInfo: four u32 (mesh and instance placement), then the fade vec4f.
  SLOT_BYTES = 32,
  SLOT_FADE_OFFSET = 16,
  U32_BYTES = 4,
  VEC4 = 4,
  // Mesh vertices: position, normal (f32x3 each) and colour (f32x4).
  VERTEX_FLOATS = 10,
  // LOD cross-fade overlap, as a fraction of the switch distance.
  FADE_BAND = 0.08,
  // Further than anything is drawn: LOD distances that never switch, fades that never happen.
  FAR = 1e9,
  // Fade-in band of a LOD that is drawn from distance 0.
  NO_FADE_IN_START = -2,
  NONE_IN = [NO_FADE_IN_START, -1],
  NONE_OUT = [FAR, 2 * FAR],
  // Scatter workgroups are 8x8; counted layers index instances as x + y * COUNTED_ROW.
  WORKGROUP = 8,
  COUNTED_ROW = 64,
  // Impostor framing: the bounding sphere grows by this margin.
  CARD_MARGIN = 1.03,
  // Casters drawn into the far shadow cascades.
  BIG = new Set(
    'palm0 palm1 treeA0 treeA1 treeB0 treeB1 emergent0 emergent1 understory0 rock banana bush galleon wreck rowboat'.split(
      ' ',
    ),
  ),
  // Counted layers (wildlife, landmarks) keep their size; scattered layers follow the quality setting.
  qualityScale = (layer, value) => {
    if (layer.count) return 1;
    return value;
  },
  layoutMeshes = (meshes) => {
    const ranges = {};
    let indexTotal = 0,
      vertexTotal = 0;
    for (const [name, mesh] of Object.entries(meshes)) {
      ranges[name] = { baseVertex: vertexTotal, bound: mesh.bound, firstIndex: indexTotal, indexCount: mesh.i.length };
      vertexTotal += mesh.v.length / VERTEX_FLOATS;
      indexTotal += mesh.i.length;
    }
    return { indexTotal, ranges, vertexTotal };
  },
  // All meshes in one vertex and one index buffer, with each mesh's range.
  mergeMeshes = (meshes) => {
    const { indexTotal, ranges, vertexTotal } = layoutMeshes(meshes),
      v = new Float32Array(vertexTotal * VERTEX_FLOATS),
      indices = new Uint32Array(indexTotal);
    for (const [name, mesh] of Object.entries(meshes)) {
      v.set(mesh.v, ranges[name].baseVertex * VERTEX_FLOATS);
      indices.set(mesh.i, ranges[name].firstIndex);
    }
    return { i: indices, ranges, v };
  },
  scaledLayer = (layer, slots, quality) => {
    const scale = qualityScale(layer, quality.distance);
    let minDistance = -1;
    if (layer.minDist) minDistance = layer.minDist * scale;
    return {
      ...layer,
      fadeDist: (layer.fadeDist ?? layer.maxDist) * scale,
      lods: layer.lods || [],
      maxDist: layer.maxDist * scale,
      minDist: minDistance,
      slots,
      variants: layer.variants || 1,
    };
  },
  // Draw slots: one per (layer, lod), each with a fixed instance capacity starting at `base`.
  buildLayers = (ranges, quality) => {
    const layers = [],
      slots = [];
    for (const layer of LAYERS) {
      const own = layer.meshes.map((mesh, k) => ({
        cap: Math.ceil(layer.caps[k] * qualityScale(layer, quality.density)),
        lod: (layer.lodBase || 0) + k,
        mesh,
        range: ranges[mesh],
        shadow: layer.shadow ?? layer.type !== 'bird',
      }));
      slots.push(...own);
      layers.push(scaledLayer(layer, own, quality));
    }
    let base = 0;
    for (const [index, slot] of slots.entries()) {
      slot.index = index;
      slot.base = base;
      base += slot.cap;
    }
    return { instances: base, layers, slots };
  },
  // Where LOD k of a layer fades in, and where it hands over to the next (falsy: never).
  fadeIn = (layer, k) => {
    if (k > 0) return layer.lods[k - 1];
    if (layer.minDist > 0) return layer.minDist;
    return 0;
  },
  fadeOut = (layer, k, per, hasNext) => {
    if (k < per - 1) return layer.lods[k];
    if (hasNext) return layer.maxDist;
    return 0;
  },
  fadeBand = (distance, none) => {
    if (distance) return [distance * (1 - FADE_BAND), distance];
    return none;
  },
  // Cross-fade distances of every slot (struct SlotInfo.fade): a LOD fades in
  // over the band below where it takes over and fades out over the band below
  // where the next takes over, also across a near layer and the far layer
  // that continues it. Matches the overlap the scatter emits (see emit).
  setFades = (layers) => {
    for (const layer of layers) {
      const per = layer.slots.length / layer.variants,
        hasNext = layers.some((other) => other.type === layer.type && other.minDist === layer.maxDist);
      for (const [index, slot] of layer.slots.entries()) {
        const k = index % per;
        slot.fade = [...fadeBand(fadeIn(layer, k), NONE_IN), ...fadeBand(fadeOut(layer, k, per, hasNext), NONE_OUT)];
      }
    }
  },
  // Per slot: where its mesh and instances live (struct SlotInfo).
  packSlots = (slots) => {
    const data = new ArrayBuffer(slots.length * SLOT_BYTES);
    for (const [k, s] of slots.entries()) {
      const ints = new Uint32Array(data, k * SLOT_BYTES, VEC4),
        floats = new Float32Array(data, k * SLOT_BYTES + SLOT_FADE_OFFSET, VEC4);
      ints.set([s.range.firstIndex, s.range.baseVertex, s.range.indexCount, s.base]);
      floats.set(s.fade);
    }
    return new Uint32Array(data);
  },
  scatterRadius = (layer) => {
    if (layer.count) return 0;
    return Math.ceil(layer.maxDist / layer.cell);
  },
  // Compute dispatch size: a row per COUNTED_ROW counted instances, or the cell square around the camera.
  scatterGroups = (layer, radius) => {
    if (layer.count) return [COUNTED_ROW / WORKGROUP, Math.ceil(layer.count / COUNTED_ROW)];
    return [Math.ceil((2 * radius + 1) / WORKGROUP), Math.ceil((2 * radius + 1) / WORKGROUP)];
  },
  // Per-layer scatter parameters (struct SP in the scatter shader); also sets each layer's dispatch size.
  packScatterUniforms = (layers) => {
    const blocks = new ArrayBuffer(PARAM_STRIDE * layers.length);
    for (const [k, layer] of layers.entries()) {
      const f = new Float32Array(blocks, k * PARAM_STRIDE, PARAM_BYTES / U32_BYTES),
        u = new Uint32Array(blocks, k * PARAM_STRIDE, PARAM_BYTES / U32_BYTES),
        radius = scatterRadius(layer),
        lodSlots = Array.from({ length: VEC4 }, (_, index) => layer.slots[Math.min(index, layer.slots.length - 1)]);
      f.set([layer.cell || 1, radius, layer.maxDist, layer.minDist], SP.cell);
      u.set([TYPE[layer.type], layer.count || 0, layer.variants, layer.slots.length / layer.variants], SP.kind);
      f.set(
        [Math.max(...layer.slots.map((sl) => sl.range.bound)), layer.keep, layer.reach || 0, layer.fadeDist],
        SP.bound,
      );
      f.set(
        Array.from({ length: VEC4 }, (_, index) => layer.lods[index] ?? FAR),
        SP.lods,
      );
      u.set(
        lodSlots.map((sl) => sl.index),
        SP.slot,
      );
      u.set(
        lodSlots.map((sl) => sl.base),
        SP.base,
      );
      u.set(
        lodSlots.map((sl) => sl.cap),
        SP.cap,
      );
      f[SP.band] = FADE_BAND;
      layer.groups = scatterGroups(layer, radius);
    }
    return new Uint8Array(blocks);
  },
  // Impostor framing: bounding sphere (centre height, radius) of a baked species.
  cardFrame = (mesh) => {
    let r = 0,
      y0 = FAR,
      y1 = -FAR;
    for (let at = 0; at < mesh.v.length; at += VERTEX_FLOATS) {
      y0 = Math.min(y0, mesh.v[at + 1]);
      y1 = Math.max(y1, mesh.v[at + 1]);
    }
    const cy = (y0 + y1) / 2;
    for (let at = 0; at < mesh.v.length; at += VERTEX_FLOATS)
      r = Math.max(r, Math.hypot(mesh.v[at], mesh.v[at + 1] - cy, mesh.v[at + 2]));
    return { cy, r: r * CARD_MARGIN };
  },
  cardVec = (frame) => `vec4f(${frame.r}, ${frame.cy}, 0.0, 0.0)`,
  normalize = (v) => {
    const length = Math.hypot(...v);
    return v.map((x) => x / length);
  },
  // Image axes of impostor view (column, row): toViewer points from the plant towards the
  // viewer (the hemi-octahedral grid direction), right and up span the image.
  cardBasis = (column, row) => {
    const grid = [((column + 0.5) / CARD_GRID) * 2 - 1, ((row + 0.5) / CARD_GRID) * 2 - 1],
      px = (grid[0] + grid[1]) / 2,
      pz = (grid[0] - grid[1]) / 2,
      toViewer = normalize([px, 1 - Math.abs(px) - Math.abs(pz), pz]),
      // Cross(up, toViewer).
      right = normalize([toViewer[2], 0, -toViewer[0]]),
      up = [
        toViewer[1] * right[2] - toViewer[2] * right[1],
        toViewer[2] * right[0] - toViewer[0] * right[2],
        toViewer[0] * right[1] - toViewer[1] * right[0],
      ];
    return { right, toViewer, up };
  },
  // One uniform block per (species, view).
  cardBakeData = (frames) => {
    const data = new Float32Array((PARAM_STRIDE / U32_BYTES) * CARDS.length * CARD_VIEWS);
    for (const [sp, c] of frames.entries())
      for (let k = 0; k < CARD_VIEWS; k += 1) {
        const { right, up, toViewer } = cardBasis(k % CARD_GRID, Math.floor(k / CARD_GRID));
        data.set([...right, c.r, ...up, c.cy, ...toViewer, 0], ((sp * CARD_VIEWS + k) * PARAM_STRIDE) / U32_BYTES);
      }
    return data;
  },
  // The near cascade gets every nearby caster, the far cascades only the big
  // ones; distant LODs and impostor cards lie beyond the last cascade and never cast.
  castsShadow = (slot, cascade) => {
    if (!slot.shadow) return false;
    if (cascade === 0) return slot.lod === 0;
    return BIG.has(slot.mesh) && slot.lod < cascade;
  };

export {
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
};
