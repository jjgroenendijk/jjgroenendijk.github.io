// Screen-sized render targets, recreated whenever the render resolution changes.
import { DEPTH, HDR } from './layouts.js';
import { flags } from '../core/gpu.js';

const BLOOM_MIPS = 6,
  half = (size) => Math.floor(size / 2);

export class Targets {
  bloom;
  bloomMips;
  bloomViews;
  clouds;
  depth;
  generation = 0;
  hdr;
  height = 0;
  history;
  sceneCopy;
  views;
  volume;
  width = 0;

  constructor(device, cloudDiv = 2) {
    this.device = device;
    this.cloudDiv = cloudDiv;
  }

  // Creates one target; size is [width, height], each clamped to at least one texel.
  texture(label, [width, height], { format, usage, mips = 1 }) {
    return this.device.createTexture({
      format,
      label,
      mipLevelCount: mips,
      size: [Math.max(1, width), Math.max(1, height)],
      usage,
    });
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return false;
    this.destroy();
    const RT = flags(GPUTextureUsage.RENDER_ATTACHMENT, GPUTextureUsage.TEXTURE_BINDING),
      cloudSize = [Math.ceil(width / this.cloudDiv), Math.ceil(height / this.cloudDiv)],
      full = [width, height],
      halfSize = [half(width), half(height)],
      hdrTarget = { format: HDR, usage: RT };
    this.width = width;
    this.height = height;
    this.hdr = this.texture('hdr', full, { format: HDR, usage: flags(RT, GPUTextureUsage.COPY_SRC) });
    this.sceneCopy = this.texture('scene-copy', full, {
      format: HDR,
      usage: flags(GPUTextureUsage.TEXTURE_BINDING, GPUTextureUsage.COPY_DST),
    });
    this.depth = this.texture('depth', full, { format: DEPTH, usage: RT });
    this.volume = this.texture('volume', halfSize, hdrTarget);
    this.clouds = [this.texture('clouds-a', cloudSize, hdrTarget), this.texture('clouds-b', cloudSize, hdrTarget)];
    this.history = [this.texture('history-a', full, hdrTarget), this.texture('history-b', full, hdrTarget)];
    this.createBloom(halfSize, hdrTarget);
    this.createViews();
    this.generation += 1;
    return true;
  }

  createBloom(size, target) {
    this.bloomMips = BLOOM_MIPS;
    this.bloom = this.texture('bloom', size, { ...target, mips: this.bloomMips });
    this.bloomViews = Array.from({ length: this.bloomMips }, (_, level) =>
      this.bloom.createView({ baseMipLevel: level, mipLevelCount: 1 }),
    );
  }

  createViews() {
    this.views = {
      clouds: this.clouds.map((target) => target.createView()),
      depth: this.depth.createView(),
      hdr: this.hdr.createView(),
      history: this.history.map((target) => target.createView()),
      sceneCopy: this.sceneCopy.createView(),
      volume: this.volume.createView(),
    };
  }

  destroy() {
    for (const target of [
      this.hdr,
      this.sceneCopy,
      this.depth,
      this.volume,
      this.bloom,
      ...(this.clouds || []),
      ...(this.history || []),
    ])
      target?.destroy();
  }
}
