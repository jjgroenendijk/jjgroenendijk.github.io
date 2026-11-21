// Sizes of the fish schools and bird flocks. The flocking compute shader runs one workgroup per school, and the scatter
// catalogue reserves one instance per animal.
const FISH_SCHOOLS = 13,
  FISH_PER_SCHOOL = 32,
  BIRD_FLOCKS = 6,
  BIRDS_PER_FLOCK = 6,
  FISH_COUNT = FISH_SCHOOLS * FISH_PER_SCHOOL,
  BIRD_COUNT = BIRD_FLOCKS * BIRDS_PER_FLOCK,
  FLOCK_GROUPS = FISH_SCHOOLS + BIRD_FLOCKS;

export { BIRD_COUNT, BIRDS_PER_FLOCK, FISH_COUNT, FISH_PER_SCHOOL, FISH_SCHOOLS, FLOCK_GROUPS };
