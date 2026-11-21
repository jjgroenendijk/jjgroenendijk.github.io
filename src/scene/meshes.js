// Registry of every procedural mesh. `bound` is the bounding radius in mesh
// units, used for GPU frustum culling.
import {
  anemone,
  coralBrain,
  coralBranch,
  coralTable,
  rock,
  seaFan,
  seagrass,
  softCoral,
  starfish,
  tubeSponge,
} from './reef.js';
import { banana, bush, fern, flowerBush, palm } from './plants.js';
import { barrel, chest, galleon, rowboat, wreck } from './pirates.js';
import { bird, butterfly, crab, dolphin, fish, jellyfish, manta, shark, turtle } from './fauna.js';
import { bound, tree } from './trees.js';
import { MAT } from './catalog.js';

// Impostor quad corners (x, y in [-1, 1]).
const CARD_CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ],
  // All LODs of one tree, sharing the culling bound of the largest.
  treeLods = (name, kind, variant, lods) => {
    const meshes = Array.from({ length: lods }, (_, lod) => tree(kind, variant, lod)),
      radius = Math.max(...meshes.map((mesh) => bound(mesh)));
    for (const mesh of meshes) mesh.bound = radius;
    return Object.fromEntries(meshes.map((mesh, lod) => [name + lod, mesh]));
  },
  // Impostor quad; extra.y selects the card species.
  card = (species) => ({
    i: new Uint32Array([0, 1, 2, 0, 2, 3]),
    v: new Float32Array(CARD_CORNERS.flatMap(([x, y]) => [x, y, 0, 0, 0, 1, MAT.card, species, 0, 0])),
  }),
  // Built as ordered entries: the merged vertex buffer lays the meshes out in this order.
  buildMeshes = () => {
    const trees = {
      ...treeLods('treeA', 'canopy', 0, 3),
      ...treeLods('treeB', 'canopy', 1, 3),
      ...treeLods('emergent', 'emergent', 0, 3),
      ...treeLods('understory', 'understory', 0, 2),
    };
    return Object.fromEntries([
      ...Object.entries(trees),
      ['palm0', { ...palm(0), bound: 0.75 }],
      ['palm1', { ...palm(1), bound: 0.75 }],
      ['palm2', { ...palm(2), bound: 0.75 }],
      // Impostors, in CARDS order.
      ['palmCard', { ...card(0), bound: 0.75 }],
      ['treeACard', { ...card(1), bound: trees.treeA0.bound }],
      ['treeBCard', { ...card(2), bound: trees.treeB0.bound }],
      ['emergentCard', { ...card(3), bound: trees.emergent0.bound }],
      ['bush', { ...bush(), bound: 0.8 }],
      ['fern', { ...fern(), bound: 0.9 }],
      ['flowers', { ...flowerBush(), bound: 0.8 }],
      ['butterfly', { ...butterfly(), bound: 0.6 }],
      ['banana', { ...banana(), bound: 0.8 }],
      ['rock', { ...rock(), bound: 0.8 }],
      ['coralA', { ...coralBranch(), bound: 1 }],
      ['coralB', { ...coralBrain(), bound: 0.7 }],
      ['coralC', { ...seaFan(), bound: 1 }],
      ['seagrass', { ...seagrass(), bound: 1.2 }],
      ['coralD', { ...coralTable(), bound: 0.8 }],
      ['coralE', { ...tubeSponge(), bound: 1.1 }],
      ['coralF', { ...softCoral(), bound: 1 }],
      ['anemone', { ...anemone(), bound: 0.5 }],
      ['starfish', { ...starfish(), bound: 0.6 }],
      ['shark', { ...shark(), bound: 0.7 }],
      ['jelly', { ...jellyfish(), bound: 1.4 }],
      ['crab', { ...crab(), bound: 0.8 }],
      ['fish', { ...fish(), bound: 0.8 }],
      ['bird', { ...bird(), bound: 0.8 }],
      ['manta', { ...manta(), bound: 0.7 }],
      ['turtle', { ...turtle(), bound: 0.8 }],
      ['dolphin', { ...dolphin(), bound: 0.7 }],
      ['galleon', { ...galleon(), bound: 30 }],
      ['wreck', { ...wreck(), bound: 16 }],
      ['chest', { ...chest(), bound: 1.2 }],
      ['rowboat', { ...rowboat(), bound: 2.6 }],
      ['barrel', { ...barrel(), bound: 0.8 }],
    ]);
  };

export { buildMeshes };
