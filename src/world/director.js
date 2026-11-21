// The director flies the camera along the endless path, blending between aerial, water-glide, jungle and underwater
// shots within each cycle.
import { CYCLE, W as WORLD_PERIOD, hashu } from './noise.js';
import { pathDX, pathX, smoothstep, terrainHeight } from './terrain.js';
import { PATH_SEED } from './path.js';
import { waveHeight } from './waves.js';

// Camera speed plan within a cycle (u = fract(z / CYCLE)), in m/s.
const SPEEDS = [
    { speed: 17, u: 0 },
    { speed: 16, u: 0.14 },
    { speed: 8, u: 0.2 },
    { speed: 6.5, u: 0.25 },
    { speed: 4.5, u: 0.285 },
    { speed: 3.2, u: 0.31 },
    { speed: 3.2, u: 0.5 },
    { speed: 4, u: 0.53 },
    { speed: 4, u: 0.56 },
    { speed: 2.8, u: 0.6 },
    { speed: 2.8, u: 0.82 },
    { speed: 4, u: 0.86 },
    { speed: 10, u: 0.9 },
    { speed: 16, u: 0.95 },
    { speed: 17, u: 1 },
  ],
  // Smallest knot spacing the speed interpolation divides by.
  MIN_SPAN = 1e-5,
  // Cycle fractions [from, to] over which each shot mode fades in or out.
  MODE_EDGES = {
    aerialIn: { from: 0.86, to: 0.96 },
    aerialOut: { from: 0.135, to: 0.215 },
    landIn: { from: 0.285, to: 0.305 },
    landOut: { from: 0.53, to: 0.55 },
    underIn: { from: 0.552, to: 0.59 },
    underOut: { from: 0.83, to: 0.862 },
  },
  // Hash multipliers and salts for the per-cycle random numbers, and the u32 range that maps a hash onto [0, 1).
  SHOT_HASH = { cycle: 7919, pan: 29, path: 104_729, range: 4_294_967_296, swell: 13 },
  // Ground sampling along the path: sample count, the share of the span that lies behind, and a floor for the maximum.
  GROUND = { behind: 0.35, floor: -1e9, samples: 7 },
  // Target camera heights (m) per mode, relative to sea level, the local ground or the path ground around it.
  HEIGHT = {
    aerialAhead: 80,
    aerialBase: 95,
    aerialClear: 55,
    aerialSeedPhase: 6,
    aerialSpan: 520,
    aerialSwell: 35,
    aerialSwellRate: 0.03,
    glideAboveGround: 1.6,
    glideAboveSea: 1.9,
    glideSwell: 0.6,
    landAboveGround: 1.25,
    landAbovePath: 1.75,
    landMin: 1.6,
    landSpan: 14,
    underAboveGround: 1.5,
    underAbovePath: 2.6,
    underBelowSea: -2,
    underSpan: 22,
    underSwell: 0.3,
  },
  // Stiffness of the critically damped height follow, and the clearance (m) the camera always keeps above ground.
  FOLLOW = { aerial: 0.9, clearance: 1.1, ground: 2.2, underClearance: 1 },
  // Slow pans per mode: a main sway with a per-cycle phase plus a faster drift.
  PAN = {
    aerial: { amp: 0.45, drift: 0.15, driftRate: 0.11, phase: 10, rate: 0.045 },
    glide: { amp: 0.18, phase: 7, rate: 0.08 },
    land: { amp: 0.32, drift: 0.1, driftRate: 0.19, phase: 13, rate: 0.07 },
    under: { amp: 0.3, drift: 0.08, driftRate: 0.17, phase: 17, rate: 0.06 },
  },
  // Pitch (rad) per mode, how much of the climb angle shows, and the bobbing on land and under water.
  PITCH = {
    aerial: -0.3,
    climb: 0.75,
    glide: -0.02,
    land: 0.06,
    landBob: 0.06,
    landBobRate: 0.09,
    minSpeed: 1.5,
    under: -0.08,
    underBob: 0.05,
    underBobRate: 0.07,
  },
  // Banking into the path's curves (curvature measured over ±span m), its limit and a slight wobble.
  ROLL = { aerialBank: 1.2, bank: 0.4, max: 0.1, span: 20, wobble: 0.008, wobbleRate: 0.3 },
  // Rates (1/s) at which the orientation eases to its target and the user's look offset springs back.
  EASE = { look: 0.6, orient: 1.5 },
  // Field of view (degrees) per mode.
  FOV = { aer: 52, glide: 60, land: 66, und: 62 },
  speedAt = (u) => {
    let segment = 0;
    for (let next = 1; next < SPEEDS.length; next += 1) if (u >= SPEEDS[next].u) segment = next;
    const a = SPEEDS[segment],
      b = SPEEDS[Math.min(segment + 1, SPEEDS.length - 1)];
    return a.speed + (b.speed - a.speed) * smoothstep(0, 1, (u - a.u) / Math.max(b.u - a.u, MIN_SPAN));
  },
  fadeAt = ({ from, to }, u) => smoothstep(from, to, u),
  // Mode weights: aerial / water glide / land / underwater.
  modeWeights = (u) => {
    const aer = 1 - fadeAt(MODE_EDGES.aerialOut, u) + fadeAt(MODE_EDGES.aerialIn, u),
      und = fadeAt(MODE_EDGES.underIn, u) * (1 - fadeAt(MODE_EDGES.underOut, u)),
      land = fadeAt(MODE_EDGES.landIn, u) * (1 - fadeAt(MODE_EDGES.landOut, u));
    return { aer: Math.min(aer, 1), glide: Math.max(0, 1 - aer - und - land), land, und };
  },
  // Mode-weighted average of one value per mode.
  blend = (m, v) =>
    (m.aer * v.aer + m.glide * v.glide + m.land * v.land + m.und * v.und) / (m.aer + m.glide + m.land + m.und),
  // Random number in [0, 1) per cycle, salt and camera path.
  cycleRandom = (cycle, salt) =>
    // eslint-disable-next-line no-bitwise -- u32 hash input, as everywhere hashu is used
    hashu((cycle * SHOT_HASH.cycle + salt + PATH_SEED * SHOT_HASH.path) >>> 0) / SHOT_HASH.range,
  // Average and highest ground along the path around z, for smooth following.
  pathGround = (z, span) => {
    let max = GROUND.floor,
      sum = 0;
    for (let sample = 0; sample < GROUND.samples; sample += 1) {
      const along = z + (sample / (GROUND.samples - 1) - GROUND.behind) * span,
        h = terrainHeight(pathX(along), along);
      sum += h;
      max = Math.max(max, h);
    }
    return { avg: sum / GROUND.samples, max };
  },
  // Everything a shot depends on at path position z, cycle fraction u and time t.
  situation = (z, u, cycle, t) => {
    const x = pathX(z);
    return {
      here: terrainHeight(x, z),
      m: modeWeights(u),
      s2: cycleRandom(cycle, SHOT_HASH.pan),
      seed: cycleRandom(cycle, SHOT_HASH.swell),
      t,
      u,
      water: waveHeight(x, z, t),
      x,
      z,
    };
  },
  // Target camera height per mode: aerial shots keep clear of the terrain ahead.
  modeHeights = ({ here, seed, t, water, z }) => {
    const ahead = pathGround(z + HEIGHT.aerialAhead, HEIGHT.aerialSpan),
      land = pathGround(z, HEIGHT.landSpan),
      under = pathGround(z, HEIGHT.underSpan);
    return {
      aer: Math.max(
        HEIGHT.aerialBase + HEIGHT.aerialSwell * Math.sin(t * HEIGHT.aerialSwellRate + seed * HEIGHT.aerialSeedPhase),
        ahead.max + HEIGHT.aerialClear,
      ),
      glide: Math.max(HEIGHT.glideAboveSea + water * HEIGHT.glideSwell, here + HEIGHT.glideAboveGround),
      land: Math.max(land.avg + HEIGHT.landAbovePath, here + HEIGHT.landAboveGround, HEIGHT.landMin),
      und: Math.min(
        Math.max(under.avg + HEIGHT.underAbovePath, here + HEIGHT.underAboveGround),
        HEIGHT.underBelowSea + water * HEIGHT.underSwell,
      ),
    };
  },
  panOf = (pan, t, seed) =>
    pan.amp * Math.sin(t * pan.rate + seed * pan.phase) + pan.drift * Math.sin(t * pan.driftRate),
  // Heading along the path plus each mode's pan.
  yawAt = ({ m, s2, seed, t, z }) =>
    Math.atan2(pathDX(z), 1) +
    (m.aer * panOf(PAN.aerial, t, seed) +
      m.land * panOf(PAN.land, t, s2) +
      m.und * panOf(PAN.under, t, s2) +
      m.glide * PAN.glide.amp * Math.sin(t * PAN.glide.rate + seed * PAN.glide.phase)),
  pitchAt = (m, t, climb) =>
    m.aer * PITCH.aerial +
    m.glide * PITCH.glide +
    m.land * PITCH.land +
    m.und * PITCH.under +
    climb * PITCH.climb +
    (m.land * PITCH.landBob * Math.sin(t * PITCH.landBobRate) +
      m.und * PITCH.underBob * Math.sin(t * PITCH.underBobRate)),
  rollAt = (m, z, t, speed) => {
    const curv = (pathDX(z + ROLL.span) - pathDX(z - ROLL.span)) / (2 * ROLL.span);
    return (
      Math.max(-ROLL.max, Math.min(ROLL.max, -curv * speed * (m.aer * ROLL.aerialBank + ROLL.bank))) +
      ROLL.wobble * Math.sin(t * ROLL.wobbleRate)
    );
  };

export class Director {
  first = true;
  lookPitch = 0;
  // User drag offset, which springs back.
  lookYaw = 0;
  oriented = false;
  pitch = 0;
  roll = 0;
  time = 0;
  vy = 0;
  y = 0;
  yaw = 0;
  z = 0;

  constructor(startU = 0.02, seedCycle = 0) {
    this.z = CYCLE * (seedCycle + startU);
  }

  // Critically damped follow of the target height that never clips into the ground.
  #follow(dt, here, m, target) {
    let { clearance } = FOLLOW,
      k = FOLLOW.ground;
    if (m.aer > 0.5) k = FOLLOW.aerial;
    if (m.und > 0.5) clearance = FOLLOW.underClearance;
    if (this.first) {
      this.y = target;
      this.first = false;
    }
    this.vy += (k * k * (target - this.y) - 2 * k * this.vy) * dt;
    this.y += this.vy * dt;
    // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- `>=` would clamp to a NaN ground height; `<` never does
    if (!(this.y < here + clearance)) return;
    this.y = here + clearance;
    this.vy = Math.max(this.vy, 0);
  }

  // Eases yaw, pitch and roll towards the shot's, snapping to them on the first frame.
  #orient(dt, shot) {
    const speed = speedAt(shot.u),
      pitch = pitchAt(shot.m, shot.t, Math.atan2(this.vy, Math.max(speed, PITCH.minSpeed))),
      roll = rollAt(shot.m, shot.z, shot.t, speed),
      yaw = yawAt(shot),
      sm = 1 - Math.exp(-dt * EASE.orient);
    this.lookYaw *= Math.exp(-dt * EASE.look);
    this.lookPitch *= Math.exp(-dt * EASE.look);
    this.yaw += (yaw - this.yaw) * sm;
    this.pitch += (pitch - this.pitch) * sm;
    this.roll += (roll - this.roll) * sm;
    if (this.oriented) return;
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = roll;
    this.oriented = true;
  }

  u() {
    const u = this.z / CYCLE;
    return u - Math.floor(u);
  }

  cycleIndex() {
    return Math.floor(this.z / CYCLE) % (WORLD_PERIOD / CYCLE);
  }

  update(dt, t) {
    this.time = t;
    this.z += speedAt(this.u()) * dt;
    if (this.z >= WORLD_PERIOD) this.z -= WORLD_PERIOD;
    const shot = situation(this.z, this.u(), this.cycleIndex(), t),
      { m } = shot;
    this.#follow(dt, shot.here, m, blend(m, modeHeights(shot)));
    this.#orient(dt, shot);
    return {
      fov: blend(m, FOV),
      haze: m.land,
      modes: m,
      pitch: this.pitch + this.lookPitch,
      pos: [shot.x, this.y, shot.z],
      roll: this.roll,
      u: shot.u,
      water: shot.water,
      yaw: this.yaw + this.lookYaw,
    };
  }
}
