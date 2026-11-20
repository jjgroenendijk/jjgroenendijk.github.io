// Packs the per-frame uniform block (layout must match `struct Frame` in WGSL).
import { FRAME_FLOATS, FRAME_OFS } from '../shaders/common.js';
import { WAVE_T } from '../world/waves.js';

export class FrameUniforms {
  constructor(device) {
    this.device = device;
    this.data = new Float32Array(FRAME_FLOATS);
    this.buffer = device.createBuffer({ label: 'frame', size: FRAME_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  write(f) {
    const d = this.data;
    const v4 = (o, a, w = 0) => { d[o] = a[0]; d[o + 1] = a[1]; d[o + 2] = a[2]; d[o + 3] = a.length > 3 ? a[3] : w; };
    d.set(f.viewProj, 0);
    d.set(f.invViewProj, 16);
    d.set(f.prevViewProj, 32);
    d.set(f.viewProjNoJitter, 48);
    const e = f.env;
    v4(64, f.camPos, f.time % WAVE_T);
    v4(68, f.camFwd, f.underwater ? 1 : 0);
    v4(72, e.lightDir, e.isSun);
    v4(76, e.lightColor, e.coverage);
    v4(80, e.sun, e.night);
    v4(84, e.moon, e.stars);
    v4(88, e.skyAmb, e.exposure);
    v4(92, e.groundAmb, f.waterLevel);
    v4(96, e.fog);
    v4(100, e.waterFog, 1);
    v4(104, [f.width, f.height, 1 / f.width, 1 / f.height]);
    v4(108, [f.jitter[0], f.jitter[1], f.resetHistory ? 1 : 0, f.noOcclusion ? 1 : 0]);
    v4(112, [f.frame % 4096, f.cycleU, f.time % 10000, f.quality]);
    v4(116, f.splits);
    f.cascades.forEach((m, i) => d.set(m, 120 + i * 16));
    f.frustum.forEach((p, i) => v4(168 + i * 4, p));
    d.set(f.levels, FRAME_OFS.levels);
    v4(FRAME_OFS.cloud, [e.wind[0], e.wind[1], e.coverage, f.fade]);
    v4(FRAME_OFS.extra, [f.modes.und, f.modes.aer, f.modes.land, 0]);
    v4(FRAME_OFS.fx, [e.rainbow, e.mist, f.vegDist, 0]);
    v4(FRAME_OFS.cloudMap, f.cloudMap);
    this.device.queue.writeBuffer(this.buffer, 0, d);
  }
}
