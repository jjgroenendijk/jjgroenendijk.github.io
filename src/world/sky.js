// Analytic atmosphere (mirrors skyBase() in WGSL) and the day/night cycle.
import { smoothstep } from './terrain.js';

// Scattering coefficients (1/m): Rayleigh per RGB channel and Mie, with the scale heights (m) of air and haze.
const BETA_MIE = 21e-6,
  BETA_RAYLEIGH = [5.8e-6, 13.5e-6, 33.1e-6],
  MIE_DEPTH = 1200,
  // Henyey-Greenstein asymmetry of the haze.
  MIE_G = 0.76,
  RAYLEIGH_DEPTH = 8000,
  SKY_E = 22,
  TAU = Math.PI * 2,
  // Colour of the twilight glow.
  TWILIGHT = [0.1, 0.07, 0.12],
  // About 22 minutes per full day before warping (in days per second).
  DAY_RATE = 1 / (22 * 60),
  // Unit vector at an azimuth and elevation.
  aim = (az, elevation) => [
    Math.cos(az) * Math.cos(elevation),
    Math.sin(elevation),
    Math.sin(az) * Math.cos(elevation),
  ],
  airmass = (c) => {
    const zd = (Math.acos(Math.min(Math.max(c, -1), 1)) * 180) / Math.PI;
    return 1 / (Math.max(c, 0) + 0.50572 * Math.max(96.07995 - zd, 0.1) ** -1.6364);
  },
  sunTransmittance = (sy) => {
    const m = airmass(sy),
      fade = smoothstep(-0.12, 0.02, sy);
    return BETA_RAYLEIGH.map((b) => Math.exp(-(b * RAYLEIGH_DEPTH + BETA_MIE * MIE_DEPTH) * m) * fade);
  },
  // Single scattering of one channel along a view ray of airmass mv, with Rayleigh and Mie phases pR and pM.
  inScatter = (beta, mv, pR, pM) => {
    const dR = RAYLEIGH_DEPTH * mv,
      dM = MIE_DEPTH * mv,
      extinction = beta * dR + BETA_MIE * dM;
    return ((beta * pR * dR + BETA_MIE * pM * dM) / extinction) * (1 - Math.exp(-extinction));
  },
  skyRadiance = (rd, sun, intensity) => {
    const mu = rd[0] * sun[0] + rd[1] * sun[1] + rd[2] * sun[2],
      pR = (3 / (16 * Math.PI)) * (1 + mu * mu),
      pM = (1 - MIE_G * MIE_G) / (4 * Math.PI * (1 + MIE_G * MIE_G - 2 * MIE_G * mu) ** 1.5),
      mv = airmass(Math.max(rd[1], 0)),
      thin = 1 - 0.7 * Math.min(Math.max(rd[1] * 1.6, 0), 1),
      fade = smoothstep(-0.12, 0.02, sun[1]),
      // Twilight glow.
      tw = smoothstep(-0.25, 0, sun[1]) * (1 - smoothstep(0, 0.25, sun[1]));
    return sunTransmittance(sun[1]).map(
      (v, channel) =>
        intensity *
          (Math.max(v / Math.max(fade, 1e-6), 1e-6) ** thin * fade) *
          inScatter(BETA_RAYLEIGH[channel], mv, pR, pM) +
        intensity * 0.012 * tw * TWILIGHT[channel] * (1 - rd[1] * 0.5),
    );
  },
  // Sun and moon directions for tod in [0, 1), where 0 is midnight.
  celestial = (tod) => {
    const elevation = Math.asin(0.93 * Math.sin((tod - 0.25) * TAU)),
      az = tod * TAU + Math.PI - 0.35,
      mel = Math.asin(0.8 * Math.sin((tod - 0.25 + 0.47) * TAU));
    return { moon: aim(az + Math.PI + 0.4, mel), sun: aim(az, elevation) };
  },
  // Time of day progresses slower around sunrise and sunset (the pretty part).
  todRate = (tod) => {
    const [, sunY] = celestial(tod).sun,
      golden = Math.exp(-(((sunY - 0.06) / 0.16) ** 2)),
      night = smoothstep(-0.05, -0.3, sunY);
    // Nights pass quickly: the island is mostly seen in the sun.
    return DAY_RATE * (1.25 - 0.8 * golden + 1.6 * night);
  };

export { SKY_E, celestial, skyRadiance, sunTransmittance, todRate };
