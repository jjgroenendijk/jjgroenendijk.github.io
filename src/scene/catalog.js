// Catalogue of everything that gets scattered over the world.
// Shared by the mesh builder, the scatter compute shader and the renderer.
import { FISH_COUNT, BIRD_COUNT } from '../shaders/flock.js';

// Material ids (stored per vertex in extra.x, interpreted by the prop shader)
export const MAT = {
  palmBark: 0, palmFrond: 1, coconut: 2, bark: 3, canopy: 4, fern: 5, bananaLeaf: 6, rock: 7,
  coralBranch: 8, coralBrain: 9, seaFan: 10, seagrass: 11, fish: 12, bird: 13, bush: 14, stem: 15,
  wood: 16, sail: 17, flag: 18, wreck: 19, gold: 20, iron: 21, manta: 22, shell: 23, skin: 24, deck: 25, dolphin: 26, petal: 27, butterfly: 28, leaf: 29,
  shark: 30, jelly: 31, starfish: 32, crab: 33, anemone: 34, sponge: 35, softCoral: 36,
  card: 40, // impostor quad, textured from the baked card atlas
};

// Baked views per impostor species (around the vertical axis)
export const CARD_VIEWS = 8;
// Species with an impostor card, in atlas order: [card mesh, mesh baked into it]
export const CARDS = [['palmCard', 'palm0'], ['treeCard', 'tree0']];

// Placement rule ids (interpreted by the scatter compute shader)
export const TYPE = {
  palm: 0, tree: 1, bush: 2, fern: 3, banana: 4, rock: 5,
  coralA: 6, coralB: 7, coralC: 8, seagrass: 9, fish: 10, bird: 11,
  manta: 12, turtle: 13, dolphin: 19, flowers: 20, butterfly: 21,
  coralD: 22, coralE: 23, coralF: 24, shark: 25, jelly: 26, ray: 27, starfish: 28, crab: 29,
  anemone: 30, clownfish: 31, parrot: 32, ship: 14, wreck: 15, chest: 16, rowboat: 17, barrel: 18,
};

// Scatter layers. Each layer fills one or two draw slots (near / far LOD).
//   cell     lattice spacing in metres (must divide the world period)
//   maxDist  instances beyond this distance are dropped (they shrink before)
//   lods     distances beyond which the 2nd / 3rd mesh is used
//   reach    radius of the largest instance, enables a cheap frustum pre-cull
//   keep     instances this close are kept even when off screen (shadow casters)
//   minDist  instances this close belong to another layer
//   fadeDist distance over which instances shrink away (default maxDist)
//   every    re-scatter only every n-th frame (phase picks which); the
//            previous instances are drawn in between
//   lodBase  LOD number of the first mesh (for shadow caster selection)
export const LAYERS = [
  // palms and trees come in a near layer (every frame) and a far layer (every
  // other frame, impostor cards)
  { type: 'palm', cell: 8, maxDist: 320, fadeDist: 1500, lods: [90], meshes: ['palm0', 'palm1'], caps: [500, 3000], keep: 60, reach: 16 },
  { type: 'palm', cell: 8, minDist: 320, maxDist: 1500, lods: [650], meshes: ['palm2', 'palmCard'], caps: [5000, 12000], keep: 0, reach: 16,
    every: 2, phase: 0, lodBase: 2 },
  { type: 'tree', cell: 8, maxDist: 340, fadeDist: 1800, lods: [110], meshes: ['tree0', 'tree1'], caps: [600, 7000], keep: 60, reach: 28 },
  { type: 'tree', cell: 8, minDist: 340, maxDist: 1800, lods: [700], meshes: ['tree2', 'treeCard'], caps: [8000, 30000], keep: 0, reach: 28,
    every: 2, phase: 1, lodBase: 2 },
  { type: 'bush', cell: 4, maxDist: 160, meshes: ['bush'], caps: [4000], keep: 30 },
  { type: 'flowers', cell: 4, maxDist: 110, meshes: ['flowers'], caps: [1500], keep: 15 },
  { type: 'butterfly', count: 24, maxDist: 60, meshes: ['butterfly'], caps: [24], keep: 0 },
  { type: 'fern', cell: 2, maxDist: 70, meshes: ['fern'], caps: [3000], keep: 15 },
  { type: 'banana', cell: 4, maxDist: 130, meshes: ['banana'], caps: [1500], keep: 25 },
  { type: 'rock', cell: 4, maxDist: 320, meshes: ['rock'], caps: [3000], keep: 20 },
  // six coral kinds share one 1 m lattice, each cell holding at most one of them
  { type: 'coralA', cell: 1, maxDist: 45, meshes: ['coralA'], caps: [1200], keep: 10 },
  { type: 'coralB', cell: 1, maxDist: 45, meshes: ['coralB'], caps: [1200], keep: 10 },
  { type: 'coralC', cell: 1, maxDist: 45, meshes: ['coralC'], caps: [1200], keep: 10 },
  { type: 'coralD', cell: 1, maxDist: 45, meshes: ['coralD'], caps: [1200], keep: 10 },
  { type: 'coralE', cell: 1, maxDist: 45, meshes: ['coralE'], caps: [1200], keep: 10 },
  { type: 'coralF', cell: 1, maxDist: 45, meshes: ['coralF'], caps: [1200], keep: 10 },
  { type: 'anemone', cell: 4, maxDist: 60, meshes: ['anemone'], caps: [400], keep: 8 },
  { type: 'clownfish', cell: 4, maxDist: 40, meshes: ['fish'], caps: [400], keep: 0 },
  { type: 'starfish', cell: 2, maxDist: 45, meshes: ['starfish'], caps: [600], keep: 0 },
  { type: 'seagrass', cell: 1, maxDist: 45, meshes: ['seagrass'], caps: [5000], keep: 8 },
  { type: 'fish', count: FISH_COUNT, maxDist: 70, meshes: ['fish'], caps: [FISH_COUNT], keep: 10 },
  { type: 'bird', count: BIRD_COUNT, maxDist: 900, meshes: ['bird'], caps: [BIRD_COUNT], keep: 0 },
  { type: 'shark', count: 4, maxDist: 90, meshes: ['shark'], caps: [4], keep: 0 },
  { type: 'ray', count: 6, maxDist: 70, meshes: ['manta'], caps: [6], keep: 0 },
  { type: 'jelly', count: 16, maxDist: 60, meshes: ['jelly'], caps: [16], keep: 0 },
  { type: 'crab', count: 2025, maxDist: 85, meshes: ['crab'], caps: [800], keep: 0 },
  { type: 'parrot', count: 12, maxDist: 300, meshes: ['bird'], caps: [12], keep: 0 },
  { type: 'manta', count: 4, maxDist: 90, meshes: ['manta'], caps: [4], keep: 0 },
  { type: 'dolphin', count: 6, maxDist: 400, meshes: ['dolphin'], caps: [6], keep: 0 },
  { type: 'turtle', count: 6, maxDist: 70, meshes: ['turtle'], caps: [6], keep: 0 },
  // pirate set pieces: one of each per cycle, placed relative to the camera path
  { type: 'ship', count: 3, maxDist: 4000, meshes: ['galleon'], caps: [3], keep: 400 },
  { type: 'wreck', count: 3, maxDist: 160, meshes: ['wreck'], caps: [3], keep: 40 },
  { type: 'chest', count: 3, maxDist: 90, meshes: ['chest'], caps: [3], keep: 10 },
  { type: 'rowboat', count: 3, maxDist: 500, meshes: ['rowboat'], caps: [3], keep: 30 },
  { type: 'barrel', count: 15, maxDist: 300, meshes: ['barrel'], caps: [15], keep: 20 },
];
