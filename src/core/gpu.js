// WebGPU bootstrap and small helpers that keep the render code declarative.
// Module-private helpers share the one const declaration (one-var), so the public helpers are exported by name at the
// bottom.

// Buffer sizes are rounded up to this many bytes, as writeBuffer and mapping require.
const BUFFER_ALIGN = 4,
  STORAGE_TYPE = { false: 'storage', true: 'read-only-storage' },
  aligned = (size) => Math.ceil(size / BUFFER_ALIGN) * BUFFER_ALIGN,
  // Combines WebGPU usage or stage flags (GPUBufferUsage, GPUTextureUsage, GPUShaderStage, GPUMapMode).
  flags = (...bits) =>
    // eslint-disable-next-line no-bitwise -- WebGPU usage flags are bit masks
    bits.reduce((combined, bit) => combined | bit, 0),
  configureDevice = async (adapter, canvas) => {
    const device = await adapter.requestDevice(),
      format = navigator.gpu.getPreferredCanvasFormat(),
      context = canvas?.getContext('webgpu');
    context?.configure({ alphaMode: 'opaque', device, format });
    return { adapter, context, device, format };
  },
  // Resolves to a falsy value when the browser has no WebGPU or no suitable adapter.
  initGPU = async (canvas) => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    return adapter && configureDevice(adapter, canvas);
  },
  // Prints WGSL compile errors with the shader label and the offending source line.
  reportCompileErrors = async (module, code, label) => {
    const info = await module.getCompilationInfo(),
      errors = info.messages.filter((message) => message.type === 'error');
    for (const message of errors) {
      const line = code.split('\n')[message.lineNum - 1];
      // eslint-disable-next-line no-console -- the browser console is the only error surface for shader compiles
      console.error(`[${label}] ${message.lineNum}:${message.linePos} ${message.message}\n  ${line}`);
    }
  },
  shader = (device, code, label) => {
    const module = device.createShaderModule({ code, label });
    if (module.getCompilationInfo) reportCompileErrors(module, code, label);
    return module;
  },
  buffer = (device, size, usage, label) => device.createBuffer({ label, size: aligned(size), usage }),
  bufferWithData = (device, data, usage, label) => {
    const created = device.createBuffer({
      label,
      size: aligned(data.byteLength),
      usage: flags(usage, GPUBufferUsage.COPY_DST),
    });
    device.queue.writeBuffer(created, 0, data);
    return created;
  },
  // Bind group layout visibility shorthands
  vertexFragmentCompute = () => flags(GPUShaderStage.VERTEX, GPUShaderStage.FRAGMENT, GPUShaderStage.COMPUTE),
  vertexFragment = () => flags(GPUShaderStage.VERTEX, GPUShaderStage.FRAGMENT),
  // Bind group layout entry shorthands
  entry = {
    sampler: (type = 'filtering', visibility = vertexFragment()) => ({ sampler: { type }, visibility }),
    storage: (isReadOnly = false, visibility = GPUShaderStage.COMPUTE) => ({
      buffer: { type: STORAGE_TYPE[Boolean(isReadOnly)] },
      visibility,
    }),
    storageTexture: (format, viewDimension = '2d') => ({
      storageTexture: { access: 'write-only', format, viewDimension },
      visibility: GPUShaderStage.COMPUTE,
    }),
    texture: (sampleType = 'float', viewDimension = '2d', visibility = vertexFragment()) => ({
      texture: { sampleType, viewDimension },
      visibility,
    }),
    uniform: (isDynamic = false, visibility = vertexFragmentCompute()) => ({
      buffer: { hasDynamicOffset: isDynamic, type: 'uniform' },
      visibility,
    }),
  },
  // Entries are numbered by position unless they name a binding with at(): a
  // layout can then leave room for bindings that shared WGSL libraries declare.
  at = (binding, item) => ({ binding, item }),
  numbered = (list) =>
    list.map((listed, index) => {
      if (Number.isSafeInteger(listed?.binding) && Object.hasOwn(listed, 'item')) return listed;
      return { binding: index, item: listed };
    }),
  bindLayout = (device, label, entries) =>
    device.createBindGroupLayout({
      entries: numbered(entries).map(({ binding, item }) => ({ binding, ...item })),
      label,
    }),
  bindingResource = (item) => {
    if (item instanceof GPUBuffer) return { buffer: item };
    return item;
  },
  bindGroup = (device, layout, resources, label) =>
    device.createBindGroup({
      entries: numbered(resources).map(({ binding, item }) => ({ binding, resource: bindingResource(item) })),
      label,
      layout,
    });

export { at, bindGroup, bindLayout, buffer, bufferWithData, entry, flags, initGPU, shader };
