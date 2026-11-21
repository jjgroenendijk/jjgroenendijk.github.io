// Debug capture mode (?capture=N): renders offscreen and, after N frames,
// copies the image into a 2D canvas. Lets headless/software GPUs (which can't
// present to a WebGPU canvas) produce screenshots for automated checks.
import { flags } from '../core/gpu.js';

// The offscreen target is RGBA8, and texture-to-buffer copies pad each row to 256 bytes.
const BYTES_PER_TEXEL = 4,
  ROW_ALIGN = 256,
  offscreenContext = (device, canvas) => {
    // Holds the current render target, recreated whenever the canvas size changes
    const current = {};
    return {
      format: 'rgba8unorm',
      getCurrentTexture() {
        const { texture } = current;
        if (!texture || texture.width !== canvas.width || texture.height !== canvas.height) {
          texture?.destroy();
          current.texture = device.createTexture({
            format: 'rgba8unorm',
            size: [canvas.width, canvas.height],
            usage: flags(GPUTextureUsage.RENDER_ATTACHMENT, GPUTextureUsage.COPY_SRC),
          });
        }
        return current.texture;
      },
      texture: () => current.texture,
    };
  },
  // Copies the padded rows of a mapped readback buffer into tightly packed image data.
  copyRows = (source, bytesPerRow, image) => {
    const rowBytes = image.width * BYTES_PER_TEXEL;
    for (let y = 0; y < image.height; y += 1)
      image.data.set(source.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * image.width * BYTES_PER_TEXEL);
  },
  readPixels = async (device, texture) => {
    const { height, width } = texture,
      bytesPerRow = Math.ceil((width * BYTES_PER_TEXEL) / ROW_ALIGN) * ROW_ALIGN,
      readback = device.createBuffer({
        size: bytesPerRow * height,
        usage: flags(GPUBufferUsage.COPY_DST, GPUBufferUsage.MAP_READ),
      }),
      encoder = device.createCommandEncoder(),
      image = new ImageData(width, height);
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    copyRows(new Uint8Array(readback.getMappedRange()), bytesPerRow, image);
    readback.unmap();
    return image;
  },
  // Shows the captured image full-window in place of the WebGPU canvas.
  showImage = (image, canvas) => {
    const out = document.createElement('canvas');
    out.width = image.width;
    out.height = image.height;
    out.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:5';
    out.getContext('2d').putImageData(image, 0, 0);
    document.body.append(out);
    canvas.style.display = 'none';
  },
  captureToCanvas = async (device, context, canvas) => {
    showImage(await readPixels(device, context.texture()), canvas);
    // The headless screenshot script (checking-rendering skill) waits for window.__captured
    // eslint-disable-next-line no-underscore-dangle, unicorn/no-global-object-property-assignment -- screenshot flag
    globalThis.__captured = true;
  };

export { captureToCanvas, offscreenContext };
