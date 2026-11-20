// The director flies the camera along the endless path, blending between
// aerial, water-glide, jungle and underwater shots within each cycle.
import { W, CYCLE, hashu } from './noise.js';
import { pathX, pathDX, terrainHeight, smoothstep } from './terrain.js';
import { waveHeight } from './waves.js';

// Camera height plan within a cycle (u = fract(z / CYCLE)).
export const SPEEDS = [
  // [u, speed m/s]
  [0.00, 17], [0.14, 16], [0.20, 8], [0.25, 6.5], [0.285, 4.5], [0.31, 3.2], [0.50, 3.2], [0.53, 4.0],
  [0.56, 4.0], [0.60, 2.8], [0.82, 2.8], [0.86, 4], [0.90, 10], [0.95, 16], [1.0, 17],
];
function lerpTable(tab, u) {
  let i = 0;
  for (let k = 0; k < tab.length - 1; k++) if (u >= tab[k + 1][0]) i = k + 1;
  const a = tab[i], b = tab[Math.min(i + 1, tab.length - 1)];
  let t = Math.min(Math.max((u - a[0]) / Math.max(b[0] - a[0], 1e-5), 0), 1);
  t = t * t * (3 - 2 * t);
  return a[1] + (b[1] - a[1]) * t;
}
export const speedAt = (u) => lerpTable(SPEEDS, u);

// Mode weights: aerial / water glide / land / underwater
function modeWeights(u) {
  const ss = smoothstep;
  const aer = 1 - ss(0.135, 0.215, u) + ss(0.86, 0.96, u);
  const und = ss(0.552, 0.59, u) * (1 - ss(0.83, 0.862, u));
  const land = ss(0.285, 0.305, u) * (1 - ss(0.53, 0.55, u));
  const glide = Math.max(0, 1 - aer - und - land);
  return { aer: Math.min(aer, 1), und, land, glide };
}

export class Director {
  constructor(startU = 0.02, seedCycle = 0) {
    this.z = CYCLE * (seedCycle + startU);
    this.y = 0; this.vy = 0;
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.time = 0;
    this.lookYaw = 0; this.lookPitch = 0; // user drag offset
    this.first = true;
    this.smoothGround = null;
    this.cache = new Map();
  }
  u() { let u = this.z / CYCLE; return u - Math.floor(u); }
  cycleIndex() { return Math.floor(this.z / CYCLE) % (W / CYCLE); }
  groundAt(x, z) { return terrainHeight(x, z); }

  // average ground along path ahead/behind for smooth following
  pathGround(z, span) {
    let s = 0, mx = -1e9;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const zz = z + (i / (n - 1) - 0.35) * span;
      const h = terrainHeight(pathX(zz), zz);
      s += h; mx = Math.max(mx, h);
    }
    return { avg: s / n, max: mx };
  }

  update(dt, t) {
    this.time = t;
    const u0 = this.u();
    this.z += speedAt(u0) * dt;
    if (this.z >= W) this.z -= W;
    const u = this.u();
    const z = this.z;
    const x = pathX(z);
    const cyc = this.cycleIndex();
    const seed = hashu(cyc * 7919 + 13) / 4294967296;

    const m = modeWeights(u);
    // aerial altitude: keep clear of terrain ahead
    const ga = this.pathGround(z + 80, 520);
    const yA = Math.max(95 + 35 * Math.sin(t * 0.03 + seed * 6), ga.max + 55);
    const gl = this.pathGround(z, 14);
    const here = terrainHeight(x, z);
    const water = waveHeight(x, z, t);
    const yG = Math.max(1.9 + water * 0.6, here + 1.6);
    const yL = Math.max(gl.avg + 1.75, here + 1.25, 1.6);
    const gu = this.pathGround(z, 22);
    const yU = Math.min(Math.max(gu.avg + 2.6, here + 1.5), -2.0 + water * 0.3);

    let target = m.aer * yA + m.glide * yG + m.land * yL + m.und * yU;
    const wsum = m.aer + m.glide + m.land + m.und;
    target /= wsum;
    if (this.first) { this.y = target; this.first = false; }
    // critically damped follow
    const k = m.aer > 0.5 ? 0.9 : 2.2;
    const a = k * k * (target - this.y) - 2 * k * this.vy;
    this.vy += a * dt;
    this.y += this.vy * dt;
    // never clip into ground
    const minY = here + (m.und > 0.5 ? 1.0 : 1.1);
    if (this.y < minY) { this.y = minY; this.vy = Math.max(this.vy, 0); }

    // orientation
    const dx = pathDX(z);
    let yaw = Math.atan2(dx, 1);
    const speed = speedAt(u);
    const pan = m.aer * (0.45 * Math.sin(t * 0.045 + seed * 10) + 0.15 * Math.sin(t * 0.11))
      + m.land * (0.32 * Math.sin(t * 0.07 + 1.0) + 0.1 * Math.sin(t * 0.19))
      + m.und * (0.3 * Math.sin(t * 0.06 + 2.0) + 0.08 * Math.sin(t * 0.17))
      + m.glide * 0.18 * Math.sin(t * 0.08);
    yaw += pan;
    const climb = Math.atan2(this.vy, Math.max(speed, 1.5));
    let pitch = m.aer * -0.30 + m.glide * -0.02 + m.land * 0.06 + m.und * -0.08;
    pitch += climb * 0.75;
    pitch += m.land * 0.06 * Math.sin(t * 0.09) + m.und * 0.05 * Math.sin(t * 0.07);
    const curv = (pathDX(z + 20) - pathDX(z - 20)) / 40;
    const roll = Math.max(-0.1, Math.min(0.1, -curv * speed * (m.aer * 1.2 + 0.4))) + 0.008 * Math.sin(t * 0.3);

    // user look offset springs back
    this.lookYaw *= Math.exp(-dt * 0.6);
    this.lookPitch *= Math.exp(-dt * 0.6);

    const sm = 1 - Math.exp(-dt * 1.5);
    this.yaw += (yaw - this.yaw) * sm;
    this.pitch += (pitch - this.pitch) * sm;
    this.roll += (roll - this.roll) * sm;
    if (this.firstOrient === undefined) { this.yaw = yaw; this.pitch = pitch; this.roll = roll; this.firstOrient = true; }

    const fov = (m.aer * 52 + m.glide * 60 + m.land * 66 + m.und * 62) / wsum;
    const haze = m.land;
    return {
      pos: [x, this.y, z], yaw: this.yaw + this.lookYaw, pitch: this.pitch + this.lookPitch, roll: this.roll,
      fov, u, modes: m, haze, water,
    };
  }
}
