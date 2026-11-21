// Terrain height field: an endless archipelago, plus a "corridor" along the camera path that guarantees lagoon, beach,
// jungle, beach and reef.
import { CYCLE, W as WORLD_PERIOD, fbm, gnoise, gnoiseD, hashu, wrapi } from './noise.js';
import { PATH_OFFSET, PATH_TERMS } from './path.js';

const TAU = Math.PI * 2,
  // Fractal noise layers as { per: lattice cells per world period, oct: octaves, seed, damp: first slope-damped octave }.
  CONTINENTS = { damp: 99, oct: 3, per: 8, seed: 11 },
  HILLS = { damp: 2, oct: 6, per: 32, seed: 23 },
  LAND_DETAIL = { oct: 4, per: 512, seed: 59 },
  CORRIDOR_DETAIL = { oct: 3, per: 512, seed: 83 },
  // Elevation where the beach ends, and how steeply the profile rises below and above it.
  BEACH_TOP = 0.12,
  BEACH_RISE = 14,
  SLOPE_RISE = 45,
  // Elevation where the hills start to climb.
  HILL_START = 0.14,
  // Scale from a u32 hash to [0, 1].
  U32_MAX = 4_294_967_295,
  // Smallest knot spacing the corridor interpolation divides by.
  MIN_SPAN = 1e-5,
  // Corridor knots along one cycle: [u, targetHeight, strength, valley, width].
  // The terrain is gently forced to these heights near the camera path so the director can rely on lagoon, beach,
  // jungle, beach, reef and open sea.
  KNOTS = [
    [0, -22, 0, 0, 300],
    [0.13, -22, 0, 0, 300],
    [0.19, -13, 1, 0, 300],
    [0.245, -3.2, 1, 0, 280],
    [0.285, -0.6, 1, 0, 260],
    [0.3, 1.4, 1, 0.3, 250],
    [0.32, 3.2, 1, 0.8, 250],
    [0.36, 6, 1, 1, 240],
    [0.42, 9, 1, 1, 240],
    [0.48, 6.5, 1, 1, 240],
    [0.515, 3, 1, 0.7, 250],
    [0.535, 1, 1, 0.2, 260],
    [0.55, -0.9, 1, 0, 270],
    [0.575, -6, 1, -0.05, 280],
    [0.61, -9.5, 1, -0.12, 300],
    [0.7, -10.5, 1, -0.14, 300],
    [0.78, -8.5, 1, -0.12, 300],
    [0.82, -6.5, 1, -0.08, 300],
    [0.85, -3.4, 1, -0.03, 300],
    [0.88, -10, 0.6, 0, 300],
    [0.94, -22, 0, 0, 300],
    [1, -22, 0, 0, 300],
  ],
  smoothstep = (a, b, x) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  },
  smin = (a, b, k) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  },
  pathX = (z) => {
    const k = TAU / WORLD_PERIOD;
    let x = PATH_OFFSET;
    for (const [a, f, ph] of PATH_TERMS) x += a * Math.sin(k * f * z + ph);
    return x;
  },
  pathDX = (z) => {
    const k = TAU / WORLD_PERIOD;
    let dx = 0;
    for (const [a, f, ph] of PATH_TERMS) dx += a * k * f * Math.cos(k * f * z + ph);
    return dx;
  },
  // Corridor [targetHeight, strength, valley, width] at path position z.
  corridorAt = (z) => {
    let segment = 0,
      u = z / CYCLE;
    u -= Math.floor(u);
    for (let next = 1; next < KNOTS.length; next += 1) if (u >= KNOTS[next][0]) segment = next;
    const a = KNOTS[segment],
      b = KNOTS[Math.min(segment + 1, KNOTS.length - 1)],
      s = Math.min(Math.max((u - a[0]) / Math.max(b[0] - a[0], MIN_SPAN), 0), 1),
      t = s * s * (3 - 2 * s);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
  },
  // Mirrors of the WGSL in shaders/common.js (fbmD, gullies, baseHeight).
  sat = (x) => Math.min(Math.max(x, 0), 1),
  // eslint-disable-next-line no-bitwise -- u32 hash input, as in the WGSL twin
  hf = (x) => hashu(x >>> 0) / U32_MAX,
  // Gradient noise of one lattice period at world point (x, z).
  noiseAt = (x, z, per, seed) => gnoise(x * (per / WORLD_PERIOD), z * (per / WORLD_PERIOD), per, seed),
  // Fbm with its derivative (world units); octaves from `damp` on are damped by the slope below.
  fbmD = (x, z, { damp: damp0, oct, per: per0, seed }) => {
    const s = [0, 0, 0];
    let a = 0.5,
      per = per0,
      sx = 0,
      sz = 0;
    for (let octave = 0; octave < oct; octave += 1) {
      // eslint-disable-next-line no-bitwise -- u32 seed, as in the WGSL twin
      const n = gnoiseD(x * (per / WORLD_PERIOD), z * (per / WORLD_PERIOD), per, (seed + octave * 101) >>> 0);
      let damp = 1;
      if (octave >= damp0) damp = 1 / (1 + 0.35 * (sx * sx + sz * sz));
      s[0] += n[0] * a * damp;
      s[1] += n[1] * (per / WORLD_PERIOD) * a * damp;
      s[2] += n[2] * (per / WORLD_PERIOD) * a * damp;
      sx += n[1];
      sz += n[2];
      per *= 2;
      a *= 0.5;
    }
    return s;
  },
  // One octave of gullies running down the slope g = [gx, gz], on a lattice of `cell` metres: [value, d/dx, d/dz].
  gullyOctave = (x, z, [gx, gz], cell) => {
    const n = Math.round(WORLD_PERIOD / cell),
      qx = x / cell,
      qz = z / cell,
      cx = Math.floor(qx),
      cz = Math.floor(qz),
      al = Math.hypot(-gz + 1e-6, gx),
      ax = (-gz + 1e-6) / al,
      az = gx / al;
    let v = 0,
      dvx = 0,
      dvz = 0,
      wsum = 0;
    for (let oz = -1; oz <= 1; oz += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        // eslint-disable-next-line no-bitwise -- integer hash must match the WGSL twin bit for bit
        const h = hashu((Math.imul(wrapi(cx + ox, n), 3) + hashu((wrapi(cz + oz, n) + 977) >>> 0)) >>> 0),
          dx = qx - (cx + ox) - hf(h),
          dz = qz - (cz + oz) - hf(h + 1),
          wt = Math.exp(-(dx * dx + dz * dz) * 1.5),
          ph = (dx * ax + dz * az) * Math.PI * 2;
        v += Math.cos(ph) * wt;
        dvx -= Math.sin(ph) * Math.PI * 2 * ax * wt;
        dvz -= Math.sin(ph) * Math.PI * 2 * az * wt;
        wsum += wt;
      }
    }
    return [v / wsum, dvx / cell / wsum, dvz / cell / wsum];
  },
  // Two gully octaves, the finer one bent along the coarser one.
  gullyPair = (x, z, gx, gz) => {
    const coarse = gullyOctave(x, z, [gx, gz], 32);
    return coarse[0] * 3.5 + gullyOctave(x, z, [gx + coarse[1] * 3.5, gz + coarse[2] * 3.5], 8)[0] * 1.2 - 1;
  },
  gullies = (x, z, gx, gz) => {
    const steep = sat(Math.hypot(gx, gz) * 1.5);
    if (steep < 0.01) return 0;
    return gullyPair(x, z, gx, gz) * steep;
  },
  // Height scale of the hills from two ridged noise layers.
  hillScale = (x, z) => {
    const r = 1 - Math.abs(noiseAt(x, z, 64, 37)),
      r2 = 1 - Math.abs(noiseAt(x, z, 128, 41));
    return 950 * (0.35 + 0.65 * (r * r * 0.7 + r2 * r2 * 0.3));
  },
  // Land above sea level at elevation `level`: beaches, then hills cut by erosion, from the noise layers c and n.
  landHeight = (x, z, level, [c, n]) => {
    const hill = hillScale(x, z);
    let rise = BEACH_RISE;
    if (level > BEACH_TOP) rise = SLOPE_RISE;
    // The slope of the profile, which steers the erosion on the hillsides (beaches and shelves stay smooth).
    rise += 1.5 * Math.sqrt(Math.max(level - HILL_START, 0)) * hill;
    return (
      Math.min(level, BEACH_TOP) * BEACH_RISE +
      Math.max(level - BEACH_TOP, 0) * SLOPE_RISE +
      Math.max(level - HILL_START, 0) ** 1.5 * hill +
      gullies(x, z, (n[1] * 1.5 + c[1] * 1.2) * rise, (n[2] * 1.5 + c[2] * 1.2) * rise) *
        smoothstep(BEACH_TOP, 0.2, level)
    );
  },
  baseHeight = (x, z) => {
    const c = fbmD(x, z, CONTINENTS),
      n = fbmD(x, z, HILLS),
      level = n[0] * 1.5 + c[0] * 1.2 - 0.1,
      seabed = -48 + 8 * n[0];
    // A gentle profile around sea level gives wide beaches and shallow shelves.
    if (level > 0) return Math.max(landHeight(x, z, level, [c, n]), seabed);
    return Math.max(Math.max(level, -0.08) * 30 + Math.min(level + 0.08, 0) * 90, seabed);
  },
  terrainHeight = (x, z) => {
    const d = Math.abs(x - pathX(z)),
      k = corridorAt(z),
      w = k[1] * (1 - smoothstep(k[3] * 0.35, k[3], d));
    let h = smin(baseHeight(x, z), 30 + d * 0.55, 25);
    h += fbm(x, z, LAND_DETAIL) * 6 * smoothstep(-2, 4, h);
    h += noiseAt(x, z, 2048, 71) * 0.4;
    if (w > 0) h += (k[0] + k[2] * Math.max(d - 14, 0) ** 1.35 * 0.22 + fbm(x, z, CORRIDOR_DETAIL) * 2.5 - h) * w;
    return h;
  };

export { KNOTS, pathDX, pathX, smoothstep, terrainHeight };
