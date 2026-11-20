// Catalogue of everything that gets scattered over the world.
// Shared by the mesh builder, the scatter compute shader and the renderer.

// Material ids (stored per vertex in extra.x, interpreted by the prop shader)
export const MAT = {
  palmBark: 0, palmFrond: 1, coconut: 2, bark: 3, canopy: 4, fern: 5, bananaLeaf: 6, rock: 7,
  coralBranch: 8, coralBrain: 9, seaFan: 10, seagrass: 11, fish: 12, bird: 13, bush: 14, stem: 15,
  wood: 16, sail: 17, flag: 18, wreck: 19, gold: 20, iron: 21, manta: 22, shell: 23, skin: 24, deck: 25, dolphin: 26, petal: 27, butterfly: 28, leaf: 29,
};

// Placement rule ids (interpreted by the scatter compute shader)
export const TYPE = {
  palm: 0, tree: 1, bush: 2, fern: 3, banana: 4, rock: 5,
  coralA: 6, coralB: 7, coralC: 8, seagrass: 9, fish: 10, bird: 11,
  manta: 12, turtle: 13, dolphin: 19, flowers: 20, butterfly: 21, ship: 14, wreck: 15, chest: 16, rowboat: 17, barrel: 18,
};

// Scatter layers. Each layer fills one or two draw slots (near / far LOD).
//   cell     lattice spacing in metres (must divide the world period)
//   maxDist  instances beyond this distance are dropped (they shrink before)
//   lodDist  beyond this distance the far mesh is used
//   keep     instances this close are kept even when off screen (shadow casters)
export const LAYERS = [
  { type: 'palm', cell: 8, maxDist: 650, lodDist: 90, meshes: ['palm0', 'palm1'], caps: [500, 4000], keep: 60 },
  { type: 'tree', cell: 8, maxDist: 700, lodDist: 110, meshes: ['tree0', 'tree1'], caps: [600, 12000], keep: 60 },
  { type: 'bush', cell: 4, maxDist: 160, lodDist: 1e9, meshes: ['bush'], caps: [4000], keep: 30 },
  { type: 'flowers', cell: 4, maxDist: 110, lodDist: 1e9, meshes: ['flowers'], caps: [1500], keep: 15 },
  { type: 'butterfly', count: 24, maxDist: 60, lodDist: 1e9, meshes: ['butterfly'], caps: [24], keep: 0 },
  { type: 'fern', cell: 2, maxDist: 70, lodDist: 1e9, meshes: ['fern'], caps: [3000], keep: 15 },
  { type: 'banana', cell: 4, maxDist: 130, lodDist: 1e9, meshes: ['banana'], caps: [1500], keep: 25 },
  { type: 'rock', cell: 4, maxDist: 240, lodDist: 1e9, meshes: ['rock'], caps: [3000], keep: 20 },
  { type: 'coralA', cell: 2, maxDist: 90, lodDist: 1e9, meshes: ['coralA'], caps: [2500], keep: 15 },
  { type: 'coralB', cell: 2, maxDist: 90, lodDist: 1e9, meshes: ['coralB'], caps: [2500], keep: 15 },
  { type: 'coralC', cell: 2, maxDist: 90, lodDist: 1e9, meshes: ['coralC'], caps: [2500], keep: 15 },
  { type: 'seagrass', cell: 1, maxDist: 45, lodDist: 1e9, meshes: ['seagrass'], caps: [5000], keep: 8 },
  { type: 'fish', count: 288, maxDist: 70, lodDist: 1e9, meshes: ['fish'], caps: [288], keep: 10 },
  { type: 'bird', count: 36, maxDist: 900, lodDist: 1e9, meshes: ['bird'], caps: [36], keep: 0 },
  { type: 'manta', count: 4, maxDist: 90, lodDist: 1e9, meshes: ['manta'], caps: [4], keep: 0 },
  { type: 'dolphin', count: 6, maxDist: 400, lodDist: 1e9, meshes: ['dolphin'], caps: [6], keep: 0 },
  { type: 'turtle', count: 6, maxDist: 70, lodDist: 1e9, meshes: ['turtle'], caps: [6], keep: 0 },
  // pirate set pieces: one of each per cycle, placed relative to the camera path
  { type: 'ship', count: 3, maxDist: 4000, lodDist: 1e9, meshes: ['galleon'], caps: [3], keep: 400 },
  { type: 'wreck', count: 3, maxDist: 160, lodDist: 1e9, meshes: ['wreck'], caps: [3], keep: 40 },
  { type: 'chest', count: 3, maxDist: 90, lodDist: 1e9, meshes: ['chest'], caps: [3], keep: 10 },
  { type: 'rowboat', count: 3, maxDist: 500, lodDist: 1e9, meshes: ['rowboat'], caps: [3], keep: 30 },
  { type: 'barrel', count: 15, maxDist: 300, lodDist: 1e9, meshes: ['barrel'], caps: [15], keep: 20 },
];
