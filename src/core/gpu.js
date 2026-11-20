// WebGPU bootstrap and small helpers that keep the render code declarative.

export async function initGPU(canvas) {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  const context = canvas?.getContext('webgpu');
  context?.configure({ device, format, alphaMode: 'opaque' });
  return { device, context, format, adapter };
}

export function shader(device, code, label) {
  const module = device.createShaderModule({ code, label });
  module.getCompilationInfo?.().then((info) => {
    for (const m of info.messages) {
      if (m.type !== 'error') continue;
      const line = code.split('\n')[m.lineNum - 1];
      console.error(`[${label}] ${m.lineNum}:${m.linePos} ${m.message}\n  ${line}`);
    }
  });
  return module;
}

export function buffer(device, size, usage, label) {
  return device.createBuffer({ size: Math.ceil(size / 4) * 4, usage, label });
}

export function bufferWithData(device, data, usage, label) {
  const b = device.createBuffer({ size: Math.ceil(data.byteLength / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST, label });
  device.queue.writeBuffer(b, 0, data);
  return b;
}

// Bind group layout entry shorthands
const VFC = () => GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
const VF = () => GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
export const entry = {
  uniform: (dynamic = false, visibility = VFC()) => ({ visibility, buffer: { type: 'uniform', hasDynamicOffset: dynamic } }),
  storage: (readOnly = false) => ({ visibility: GPUShaderStage.COMPUTE, buffer: { type: readOnly ? 'read-only-storage' : 'storage' } }),
  texture: (sampleType = 'float', viewDimension = '2d', visibility = VF()) => ({ visibility, texture: { sampleType, viewDimension } }),
  storageTexture: (format, viewDimension = '2d') => ({ visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format, viewDimension } }),
  sampler: (type = 'filtering', visibility = VF()) => ({ visibility, sampler: { type } }),
};

export function bindLayout(device, label, entries) {
  return device.createBindGroupLayout({ label, entries: entries.map((e, i) => ({ binding: i, ...e })) });
}

export function bindGroup(device, layout, resources, label) {
  return device.createBindGroup({
    label, layout,
    entries: resources.map((r, i) => ({ binding: i, resource: r instanceof GPUBuffer ? { buffer: r } : r })),
  });
}
