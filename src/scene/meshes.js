// Registry of every procedural mesh. `bound` is the bounding radius in mesh
// units, used for GPU frustum culling.
import { palm, tree, bush, fern, banana, flowerBush } from './plants.js';
import { rock, coralBranch, coralBrain, seaFan, seagrass, coralTable, tubeSponge, softCoral, anemone, starfish } from './reef.js';
import { fish, bird, manta, turtle, dolphin, butterfly, shark, jellyfish, crab } from './fauna.js';
import { galleon, wreck, chest, rowboat, barrel } from './pirates.js';

export function buildMeshes() {
  return {
    palm0: { ...palm(0), bound: 0.75 },
    palm1: { ...palm(1), bound: 0.75 },
    tree0: { ...tree(0), bound: 0.6 },
    tree1: { ...tree(1), bound: 0.6 },
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
