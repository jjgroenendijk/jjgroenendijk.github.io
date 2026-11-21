// Registry of every procedural mesh. `bound` is the bounding radius in mesh
// units, used for GPU frustum culling.
import { palm, bush, fern, banana, flowerBush } from './plants.js';
import { tree, bound } from './trees.js';
import {
  rock,
  coralBranch,
  coralBrain,
  seaFan,
  seagrass,
  coralTable,
  tubeSponge,
  softCoral,
  anemone,
  starfish,
} from './reef.js';
import { fish, bird, manta, turtle, dolphin, butterfly, shark, jellyfish, crab } from './fauna.js';
import { galleon, wreck, chest, rowboat, barrel } from './pirates.js';

import { MAT } from './catalog.js';

// Impostor quad (x, y in [-1, 1]); extra.y selects the card species.
function card(species) {
  const v = [];
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    v.push(x, y, 0, 0, 0, 1, MAT.card, species, 0, 0);
  return { v: new Float32Array(v), i: new Uint32Array([0, 1, 2, 0, 2, 3]) };
}

// All LODs of one tree, sharing the culling bound of the largest.
function treeLods(name, kind, variant, lods) {
  const out = {};
  for (let lod = 0; lod < lods; lod++) out[name + lod] = tree(kind, variant, lod);
  const b = Math.max(...Object.values(out).map(bound));
  for (const m of Object.values(out)) m.bound = b;
  return out;
}

export function buildMeshes() {
  const trees = {
    ...treeLods('treeA', 'canopy', 0, 3),
    ...treeLods('treeB', 'canopy', 1, 3),
    ...treeLods('emergent', 'emergent', 0, 3),
    ...treeLods('understory', 'understory', 0, 2),
  };
  return {
    ...trees,
    palm0: { ...palm(0), bound: 0.75 },
    palm1: { ...palm(1), bound: 0.75 },
    palm2: { ...palm(2), bound: 0.75 },
    // impostors, in CARDS order
    palmCard: { ...card(0), bound: 0.75 },
    treeACard: { ...card(1), bound: trees.treeA0.bound },
    treeBCard: { ...card(2), bound: trees.treeB0.bound },
    emergentCard: { ...card(3), bound: trees.emergent0.bound },
    bush: { ...bush(), bound: 0.8 },
    fern: { ...fern(), bound: 0.9 },
    flowers: { ...flowerBush(), bound: 0.8 },
    butterfly: { ...butterfly(), bound: 0.6 },
    banana: { ...banana(), bound: 0.8 },
    rock: { ...rock(), bound: 0.8 },
    coralA: { ...coralBranch(), bound: 1.0 },
    coralB: { ...coralBrain(), bound: 0.7 },
    coralC: { ...seaFan(), bound: 1.0 },
    seagrass: { ...seagrass(), bound: 1.2 },
    coralD: { ...coralTable(), bound: 0.8 },
    coralE: { ...tubeSponge(), bound: 1.1 },
    coralF: { ...softCoral(), bound: 1.0 },
    anemone: { ...anemone(), bound: 0.5 },
    starfish: { ...starfish(), bound: 0.6 },
    shark: { ...shark(), bound: 0.7 },
    jelly: { ...jellyfish(), bound: 1.4 },
    crab: { ...crab(), bound: 0.8 },
    fish: { ...fish(), bound: 0.8 },
    bird: { ...bird(), bound: 0.8 },
    manta: { ...manta(), bound: 0.7 },
    turtle: { ...turtle(), bound: 0.8 },
    dolphin: { ...dolphin(), bound: 0.7 },
    galleon: { ...galleon(), bound: 30 },
    wreck: { ...wreck(), bound: 16 },
    chest: { ...chest(), bound: 1.2 },
    rowboat: { ...rowboat(), bound: 2.6 },
    barrel: { ...barrel(), bound: 0.8 },
  };
}
