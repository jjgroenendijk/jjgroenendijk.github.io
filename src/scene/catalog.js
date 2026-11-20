// Catalogue of everything that gets scattered over the world.
// Shared by the mesh builder, the scatter compute shader and the renderer.

// Material ids (stored per vertex in extra.x, interpreted by the prop shader)
export const MAT = {
  palmBark: 0, palmFrond: 1, coconut: 2, bark: 3, canopy: 4, fern: 5, bananaLeaf: 6, rock: 7,
  coralBranch: 8, coralBrain: 9, seaFan: 10, seagrass: 11, fish: 12, bird: 13, bush: 14, stem: 15,
};

// Placement rule ids (interpreted by the scatter compute shader)
export const TYPE = {
  palm: 0, tree: 1, bush: 2, fern: 3, banana: 4, rock: 5,
  coralA: 6, coralB: 7, coralC: 8, seagrass: 9, fish: 10, bird: 11,
};

// Scatter layers. Each layer fills one or two draw slots (near / far LOD).
//   cell     lattice spacing in metres (must divide the world period)
//   maxDist  instances beyond this distance are dropped (they shrink before)
//   lodDist  beyond this distance the far mesh is used
//   keep     instances this close are kept even when off screen (shadow casters)
export const LAYERS = [
  { type: 'palm', cell: 8, maxDist: 650, lodDist: 90, meshes: ['palm0', 'palm1'], caps: [500, 4000], keep: 60 },
  { type: 'tree', cell: 8, maxDist: 700, lodDist: 110, meshes: ['tree0', 'tree1'], caps: [500, 7000], keep: 60 },
  { type: 'bush', cell: 4, maxDist: 220, lodDist: 1e9, meshes: ['bush'], caps: [4000], keep: 30 },
  { type: 'fern', cell: 2, maxDist: 70, lodDist: 1e9, meshes: ['fern'], caps: [3000], keep: 15 },
  { type: 'banana', cell: 4, maxDist: 130, lodDist: 1e9, meshes: ['banana'], caps: [1500], keep: 25 },
  { type: 'rock', cell: 4, maxDist: 240, lodDist: 1e9, meshes: ['rock'], caps: [3000], keep: 20 },
  { type: 'coralA', cell: 2, maxDist: 90, lodDist: 1e9, meshes: ['coralA'], caps: [2500], keep: 15 },
  { type: 'coralB', cell: 2, maxDist: 90, lodDist: 1e9, meshes: ['coralB'], caps: [2500], keep: 15 },
  { type: 'coralC', cell: 2, maxDist: 90, lodDist: 1e9, meshes: ['coralC'], caps: [2500], keep: 15 },
  { type: 'seagrass', cell: 1, maxDist: 45, lodDist: 1e9, meshes: ['seagrass'], caps: [5000], keep: 8 },
  { type: 'fish', count: 288, maxDist: 70, lodDist: 1e9, meshes: ['fish'], caps: [288], keep: 10 },
  { type: 'bird', count: 36, maxDist: 900, lodDist: 1e9, meshes: ['bird'], caps: [36], keep: 0 },
];
