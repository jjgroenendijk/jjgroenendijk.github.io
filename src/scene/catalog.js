// Catalogue of everything that gets scattered over the world.
// Shared by the mesh builder, the scatter compute shader and the renderer.
import { BIRD_COUNT, FISH_COUNT } from './flocks.js';

// Species with an impostor card, in atlas order: [card mesh, mesh baked into it]
const CARDS = [
    ['palmCard', 'palm0'],
    ['treeACard', 'treeA0'],
    ['treeBCard', 'treeB0'],
    ['emergentCard', 'emergent0'],
  ],
  // Impostor views per species: an N x N grid of directions over the upper
  // hemisphere (hemi-octahedral mapping)
  CARD_GRID = 6,
  // Texels per impostor view.
  CARD_SIZE = 128,
  CARD_VIEWS = CARD_GRID * CARD_GRID,
  // Leaf texture layers baked at start-up, one per kind of leaf card.
  LEAF = { broad: 0, pinnate: 2, small: 1 },
  LEAF_COUNT = Object.keys(LEAF).length,
  // Material ids (stored per vertex in extra.x, interpreted by the prop shader). Ids are explicit, so the key order
  // carries no meaning.
  MAT = {
    anemone: 34,
    bananaLeaf: 6,
    bark: 3,
    bird: 13,
    bush: 14,
    butterfly: 28,
    // Impostor quad, textured from the baked card atlas.
    card: 40,
    coconut: 2,
    coralBrain: 9,
    coralBranch: 8,
    crab: 33,
    deck: 25,
    dolphin: 26,
    fern: 5,
    fish: 12,
    flag: 18,
    // Leaf cluster card, textured from the baked leaf textures.
    foliage: 37,
    gold: 20,
    iron: 21,
    jelly: 31,
    leaf: 29,
    manta: 22,
    palmBark: 0,
    palmFrond: 1,
    petal: 27,
    rock: 7,
    sail: 17,
    seaFan: 10,
    seagrass: 11,
    shark: 30,
    shell: 23,
    skin: 24,
    softCoral: 36,
    sponge: 35,
    starfish: 32,
    stem: 15,
    wood: 16,
    wreck: 19,
  },
  // Placement rule ids (interpreted by the scatter compute shader). The pirate set pieces, ship to barrel, must stay
  // a contiguous id range.
  TYPE = {
    anemone: 30,
    banana: 4,
    barrel: 18,
    bird: 11,
    bush: 2,
    butterfly: 21,
    chest: 16,
    clownfish: 31,
    coralA: 6,
    coralB: 7,
    coralC: 8,
    coralD: 22,
    coralE: 23,
    coralF: 24,
    crab: 29,
    dolphin: 19,
    emergent: 37,
    fern: 3,
    fish: 10,
    flowers: 20,
    jelly: 26,
    manta: 12,
    palm: 0,
    parrot: 32,
    ray: 27,
    rock: 5,
    rowboat: 17,
    seagrass: 9,
    shark: 25,
    ship: 14,
    starfish: 28,
    tree: 1,
    turtle: 13,
    understory: 38,
    wreck: 15,
  },
  // A layer with LOD levels: `levels` lists each LOD's slot cap and (after the first) the distance it starts at.
  // Every variant has the same levels, so the caps repeat per variant.
  lodLayer = ({ levels, ...layer }) => ({
    ...layer,
    caps: Array.from({ length: layer.variants ?? 1 }).flatMap(() => levels.map((level) => level.cap)),
    lods: levels.slice(1).map((level) => level.from),
  }),
  // A layer drawn with one mesh and no LODs; fixed-count layers cap their slot at `count` unless `cap` says otherwise.
  oneMesh = ({ cap, mesh, ...layer }) => ({ ...layer, caps: [cap ?? layer.count], meshes: [mesh] }),
  // Scatter layers. Each layer fills one or two draw slots (near / far LOD).
  //   cell     lattice spacing in metres (must divide the world period)
  //   maxDist  instances beyond this distance are dropped (they shrink before)
  //   lods     distances beyond which the 2nd / 3rd mesh is used
  //   caps     instance capacity of each slot
  //   reach    radius of the largest instance, enables a cheap frustum pre-cull
  //   keep     instances this close are kept even when off screen (shadow casters)
  //   minDist  instances this close belong to another layer
  //   fadeDist distance over which instances shrink away (default maxDist)
  //   every    re-scatter only every n-th frame (phase picks which); the
  //            previous instances are drawn in between
  //   lodBase  LOD number of the first mesh (for shadow caster selection)
  //   variants number of model variants: meshes then list each variant's LODs
  //            in turn, and every instance picks one variant
  // Neighbouring LODs (and a near layer and the far layer after it) overlap by
  // a short band in which they cross-fade with complementary dithering.
  LAYERS = [
    // Palms and trees come in a near layer (every frame) and a far layer (every
    // other frame, impostor cards)
    lodLayer({
      cell: 8,
      fadeDist: 1500,
      keep: 60,
      levels: [{ cap: 500 }, { cap: 3000, from: 90 }],
      maxDist: 320,
      meshes: ['palm0', 'palm1'],
      reach: 16,
      type: 'palm',
    }),
    lodLayer({
      cell: 8,
      every: 2,
      keep: 0,
      levels: [{ cap: 5000 }, { cap: 12_000, from: 650 }],
      lodBase: 2,
      maxDist: 1500,
      meshes: ['palm2', 'palmCard'],
      minDist: 320,
      phase: 0,
      reach: 16,
      type: 'palm',
    }),
    lodLayer({
      cell: 8,
      fadeDist: 1800,
      keep: 60,
      levels: [{ cap: 350 }, { cap: 3500, from: 110 }],
      maxDist: 340,
      meshes: ['treeA0', 'treeA1', 'treeB0', 'treeB1'],
      reach: 28,
      type: 'tree',
      variants: 2,
    }),
    lodLayer({
      cell: 8,
      every: 2,
      keep: 0,
      levels: [{ cap: 4000 }, { cap: 15_000, from: 700 }],
      lodBase: 2,
      maxDist: 1800,
      meshes: ['treeA2', 'treeACard', 'treeB2', 'treeBCard'],
      minDist: 340,
      phase: 1,
      reach: 28,
      type: 'tree',
      variants: 2,
    }),
    // Rare giants towering over the canopy, and slender trees beneath it
    lodLayer({
      cell: 16,
      fadeDist: 2400,
      keep: 80,
      levels: [{ cap: 120 }, { cap: 900, from: 130 }],
      maxDist: 400,
      meshes: ['emergent0', 'emergent1'],
      reach: 44,
      type: 'emergent',
    }),
    lodLayer({
      cell: 16,
      every: 2,
      keep: 0,
      levels: [{ cap: 1200 }, { cap: 5000, from: 750 }],
      lodBase: 2,
      maxDist: 2400,
      meshes: ['emergent2', 'emergentCard'],
      minDist: 400,
      phase: 0,
      reach: 44,
      type: 'emergent',
    }),
    lodLayer({
      cell: 6,
      keep: 40,
      levels: [{ cap: 500 }, { cap: 2500, from: 80 }],
      maxDist: 220,
      meshes: ['understory0', 'understory1'],
      reach: 10,
      type: 'understory',
    }),
    oneMesh({ cap: 4000, cell: 4, keep: 30, maxDist: 160, mesh: 'bush', type: 'bush' }),
    oneMesh({ cap: 1500, cell: 4, keep: 15, maxDist: 110, mesh: 'flowers', type: 'flowers' }),
    oneMesh({ count: 24, keep: 0, maxDist: 60, mesh: 'butterfly', type: 'butterfly' }),
    oneMesh({ cap: 3000, cell: 2, keep: 15, maxDist: 70, mesh: 'fern', type: 'fern' }),
    oneMesh({ cap: 1500, cell: 4, keep: 25, maxDist: 130, mesh: 'banana', type: 'banana' }),
    oneMesh({ cap: 3000, cell: 4, keep: 20, maxDist: 320, mesh: 'rock', type: 'rock' }),
    // Six coral kinds share one 1 m lattice, each cell holding at most one of them
    oneMesh({ cap: 1200, cell: 1, keep: 10, maxDist: 45, mesh: 'coralA', type: 'coralA' }),
    oneMesh({ cap: 1200, cell: 1, keep: 10, maxDist: 45, mesh: 'coralB', type: 'coralB' }),
    oneMesh({ cap: 1200, cell: 1, keep: 10, maxDist: 45, mesh: 'coralC', type: 'coralC' }),
    oneMesh({ cap: 1200, cell: 1, keep: 10, maxDist: 45, mesh: 'coralD', type: 'coralD' }),
    oneMesh({ cap: 1200, cell: 1, keep: 10, maxDist: 45, mesh: 'coralE', type: 'coralE' }),
    oneMesh({ cap: 1200, cell: 1, keep: 10, maxDist: 45, mesh: 'coralF', type: 'coralF' }),
    oneMesh({ cap: 400, cell: 4, keep: 8, maxDist: 60, mesh: 'anemone', type: 'anemone' }),
    oneMesh({ cap: 400, cell: 4, keep: 0, maxDist: 40, mesh: 'fish', type: 'clownfish' }),
    oneMesh({ cap: 600, cell: 2, keep: 0, maxDist: 45, mesh: 'starfish', type: 'starfish' }),
    oneMesh({ cap: 5000, cell: 1, keep: 8, maxDist: 45, mesh: 'seagrass', type: 'seagrass' }),
    oneMesh({ count: FISH_COUNT, keep: 10, maxDist: 70, mesh: 'fish', type: 'fish' }),
    oneMesh({ count: BIRD_COUNT, keep: 0, maxDist: 900, mesh: 'bird', type: 'bird' }),
    oneMesh({ count: 4, keep: 0, maxDist: 90, mesh: 'shark', type: 'shark' }),
    oneMesh({ count: 6, keep: 0, maxDist: 70, mesh: 'manta', type: 'ray' }),
    oneMesh({ count: 16, keep: 0, maxDist: 60, mesh: 'jelly', type: 'jelly' }),
    oneMesh({ cap: 800, count: 2025, keep: 0, maxDist: 85, mesh: 'crab', type: 'crab' }),
    oneMesh({ count: 12, keep: 0, maxDist: 300, mesh: 'bird', type: 'parrot' }),
    oneMesh({ count: 4, keep: 0, maxDist: 90, mesh: 'manta', type: 'manta' }),
    oneMesh({ count: 6, keep: 0, maxDist: 400, mesh: 'dolphin', type: 'dolphin' }),
    oneMesh({ count: 6, keep: 0, maxDist: 70, mesh: 'turtle', type: 'turtle' }),
    // Pirate set pieces: one of each per cycle, placed relative to the camera path
    oneMesh({ count: 3, keep: 400, maxDist: 4000, mesh: 'galleon', type: 'ship' }),
    oneMesh({ count: 3, keep: 40, maxDist: 160, mesh: 'wreck', type: 'wreck' }),
    oneMesh({ count: 3, keep: 10, maxDist: 90, mesh: 'chest', type: 'chest' }),
    oneMesh({ count: 3, keep: 30, maxDist: 500, mesh: 'rowboat', type: 'rowboat' }),
    oneMesh({ count: 15, keep: 20, maxDist: 300, mesh: 'barrel', type: 'barrel' }),
  ];

export { CARDS, CARD_GRID, CARD_SIZE, CARD_VIEWS, LEAF, LEAF_COUNT, MAT, TYPE, LAYERS };
