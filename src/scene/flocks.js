// Sizes of the fish schools and bird flocks. The flocking compute shader runs one workgroup per school, and the scatter
// catalogue reserves one instance per animal.
export const FISH_SCHOOLS = 13;
export const FISH_PER_SCHOOL = 32;
const BIRD_FLOCKS = 6;
export const BIRDS_PER_FLOCK = 6;
export const FISH_COUNT = FISH_SCHOOLS * FISH_PER_SCHOOL;
export const BIRD_COUNT = BIRD_FLOCKS * BIRDS_PER_FLOCK;
export const FLOCK_GROUPS = FISH_SCHOOLS + BIRD_FLOCKS;
