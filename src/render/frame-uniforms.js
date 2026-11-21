// Packs the per-frame uniform block (layout must match `struct Frame` in WGSL).
import { FRAME_FLOATS, FRAME_OFS } from '../shaders/common.js';
import { PATH_OFFSET, PATH_TERMS } from '../world/path.js';
import { WAVE_T } from '../world/waves.js';
import { flags } from '../core/gpu.js';

const FLOAT_BYTES = 4,
  // Wrap periods that keep the frame counter and the wind clock precise as f32.
  FRAME_INDEX_WRAP = 4096,
  MAT4_FLOATS = 16,
  // Float offsets of the fixed head of `struct Frame`; the fields after the frustum planes are in FRAME_OFS.
  OFS = {
    camFwd: 68,
    camPos: 64,
    cascades: 120,
    fog: 96,
    frustum: 168,
    groundAmb: 92,
    invViewProj: 16,
    jitter: 108,
    lightColor: 76,
    lightDir: 72,
    misc: 112,
    moon: 84,
    prevViewProj: 32,
    res: 104,
    skyAmb: 88,
    splits: 116,
    sun: 80,
    viewProj: 0,
    viewProjNoJitter: 48,
    waterFog: 100,
  },
  VEC4_FLOATS = 4,
  WIND_TIME_WRAP = 10_000,
  W_LANE = 3,
  // Booleans travel as 1 or 0.
  toFlag = (value) => Number(Boolean(value));

export class FrameUniforms {
  constructor(device) {
    this.device = device;
    this.data = new Float32Array(FRAME_FLOATS);
    this.buffer = device.createBuffer({
      label: 'frame',
      size: FRAME_FLOATS * FLOAT_BYTES,
      usage: flags(GPUBufferUsage.UNIFORM, GPUBufferUsage.COPY_DST),
    });
  }

  // Writes a vec4f at `offset`: xyz from `values`, w from `values[3]` when it has one, else `w`.
  vec4(offset, values, w = 0) {
    this.data.set([values[0], values[1], values[2], w], offset);
    if (values.length > W_LANE) this.data[offset + W_LANE] = values[W_LANE];
  }

  write(f) {
    this.writeCamera(f);
    this.writeEnvironment(f.env, f.waterLevel);
    this.writeScreen(f);
    this.writeTail(f);
    this.device.queue.writeBuffer(this.buffer, 0, this.data);
  }

  writeCamera(f) {
    this.data.set(f.viewProj, OFS.viewProj);
    this.data.set(f.invViewProj, OFS.invViewProj);
    this.data.set(f.prevViewProj, OFS.prevViewProj);
    this.data.set(f.viewProjNoJitter, OFS.viewProjNoJitter);
    this.vec4(OFS.camPos, f.camPos, f.time % WAVE_T);
    this.vec4(OFS.camFwd, f.camFwd, toFlag(f.underwater));
  }

  writeEnvironment(environment, waterLevel) {
    this.vec4(OFS.lightDir, environment.lightDir, environment.isSun);
    this.vec4(OFS.lightColor, environment.lightColor, environment.coverage);
    this.vec4(OFS.sun, environment.sun, environment.night);
    this.vec4(OFS.moon, environment.moon, environment.stars);
    this.vec4(OFS.skyAmb, environment.skyAmb, environment.exposure);
    this.vec4(OFS.groundAmb, environment.groundAmb, waterLevel);
    this.vec4(OFS.fog, environment.fog);
    this.vec4(OFS.waterFog, environment.waterFog, 1);
  }

  writeScreen(f) {
    this.vec4(OFS.res, [f.width, f.height, 1 / f.width, 1 / f.height]);
    this.vec4(OFS.jitter, [f.jitter[0], f.jitter[1], toFlag(f.resetHistory), toFlag(f.noOcclusion)]);
    this.vec4(OFS.misc, [f.frame % FRAME_INDEX_WRAP, f.cycleU, f.time % WIND_TIME_WRAP, f.quality]);
    this.vec4(OFS.splits, f.splits);
    for (const [index, matrix] of f.cascades.entries()) this.data.set(matrix, OFS.cascades + index * MAT4_FLOATS);
    for (const [index, plane] of f.frustum.entries()) this.vec4(OFS.frustum + index * VEC4_FLOATS, plane);
  }

  writeTail(f) {
    const environment = f.env;
    this.data.set(f.levels, FRAME_OFS.levels);
    this.vec4(FRAME_OFS.cloud, [environment.wind[0], environment.wind[1], environment.coverage, f.fade]);
    this.vec4(FRAME_OFS.extra, [f.modes.und, f.modes.aer, f.modes.land, 0]);
    this.vec4(FRAME_OFS.fx, [environment.rainbow, environment.mist, f.vegDist, environment.wetness]);
    this.vec4(FRAME_OFS.cloudMap, f.cloudMap);
    this.vec4(FRAME_OFS.caustic, f.caustic);
    for (const [index, term] of PATH_TERMS.entries()) this.vec4(FRAME_OFS.path + index * VEC4_FLOATS, term);
    // The first path term's w carries the path offset.
    this.vec4(FRAME_OFS.path, PATH_TERMS[0], PATH_OFFSET);
  }
}
