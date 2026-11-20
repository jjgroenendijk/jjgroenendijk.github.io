// Debug capture mode (?capture=N): renders offscreen and, after N frames,
// copies the image into a 2D canvas. Lets headless/software GPUs (which can't
// present to a WebGPU canvas) produce screenshots for automated checks.

export function offscreenContext(device, canvas) {
  let tex = null;
  return {
    format: 'rgba8unorm',
    getCurrentTexture() {
      if (!tex || tex.width !== canvas.width || tex.height !== canvas.height) {
        tex?.destroy();
        tex = device.createTexture({ size: [canvas.width, canvas.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      }
      return tex;
    },
    texture: () => tex,
  };
}

export async function captureToCanvas(device, ctx, canvas) {
  const tex = ctx.texture();
  const w = tex.width, h = tex.height;
  const bpr = Math.ceil((w * 4) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
  buf.unmap();
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:5';
  out.getContext('2d').putImageData(img, 0, 0);
  document.body.appendChild(out);
  canvas.style.display = 'none';
  window.__captured = true;
}
