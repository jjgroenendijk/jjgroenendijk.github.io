// Screen-sized render targets, recreated whenever the render resolution changes.
import { HDR, DEPTH } from './layouts.js';

const U = () => GPUTextureUsage;

export class Targets {
  constructor(device, cloudDiv = 2) { this.device = device; this.cloudDiv = cloudDiv; this.width = 0; this.height = 0; }

  resize(width, height) {
    if (width === this.width && height === this.height) return false;
    this.destroy();
    const d = this.device;
    const tex = (label, w, h, format, usage, mips = 1) => d.createTexture({ label, size: [Math.max(1, w), Math.max(1, h)], format, usage, mipLevelCount: mips });
    const RT = U().RENDER_ATTACHMENT | U().TEXTURE_BINDING;
    this.width = width; this.height = height;
    this.hdr = tex('hdr', width, height, HDR, RT | U().COPY_SRC);
    this.sceneCopy = tex('scene-copy', width, height, HDR, U().TEXTURE_BINDING | U().COPY_DST);
    this.depth = tex('depth', width, height, DEPTH, RT);
    this.volume = tex('volume', width >> 1, height >> 1, HDR, RT);
    this.clouds = tex('clouds', Math.ceil(width / this.cloudDiv), Math.ceil(height / this.cloudDiv), HDR, RT);
    this.history = [tex('history-a', width, height, HDR, RT), tex('history-b', width, height, HDR, RT)];
    this.bloomMips = 6;
    this.bloom = tex('bloom', width >> 1, height >> 1, HDR, RT, this.bloomMips);
    this.bloomViews = Array.from({ length: this.bloomMips }, (_, i) => this.bloom.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    this.views = {
      hdr: this.hdr.createView(), sceneCopy: this.sceneCopy.createView(), depth: this.depth.createView(),
      volume: this.volume.createView(), clouds: this.clouds.createView(),
      history: this.history.map((t) => t.createView()),
    };
    this.generation = (this.generation || 0) + 1;
    return true;
  }

  destroy() {
    for (const t of [this.hdr, this.sceneCopy, this.depth, this.volume, this.clouds, this.bloom, ...(this.history || [])]) t?.destroy();
  }
}
