// Props through a visibility buffer: one draw rasterizes every prop slot into
// an ID target (slot and instance, triangle) plus depth; a fullscreen resolve
// then shades each covered pixel exactly once. Dense, many-layered jungle no
// longer pays for shading the leaves that end up hidden.
import { DEPTH, HDR, depthState } from './layouts.js';
import { EMPTY, ID_FORMAT, resolveWGSL, visibilityWGSL } from '../shaders/props-visibility.js';
import { bindGroup, bindLayout, entry, flags, shader } from '../core/gpu.js';
import { LeafTextures } from './leaf-textures.js';

// Storage buffers in the prop data group, after the two card texture arrays.
const DATA_BUFFERS = 5,
  FULLSCREEN_VERTICES = 3,
  // Bind group slots shared by the raster and resolve pipelines.
  GROUP = { data: 2, frame: 0, ids: 3, shadow: 1 },
  createDataLayout = (device) => {
    const fragment = GPUShaderStage.FRAGMENT,
      vertexFragment = flags(GPUShaderStage.VERTEX, GPUShaderStage.FRAGMENT);
    return bindLayout(device, 'prop-data', [
      entry.texture('float', '2d-array', fragment),
      entry.texture('float', '2d-array', fragment),
      ...Array.from({ length: DATA_BUFFERS }, () => entry.storage(true, vertexFragment)),
      ...LeafTextures.entries(fragment),
    ]);
  };

export class PropsVisibility {
  // Created per resolution in resize().
  idGroup;
  idView;
  ids;

  constructor(device, shared, scatter) {
    this.device = device;
    this.props = scatter;
    const dataLayout = createDataLayout(device),
      primitive = { cullMode: 'none', topology: 'triangle-list' },
      raster = shader(device, scatter.withCards(visibilityWGSL), 'prop-visibility'),
      resolve = shader(device, scatter.withCards(resolveWGSL), 'prop-resolve');
    this.dataGroup = bindGroup(device, dataLayout, scatter.visibilityResources, 'prop-data');
    this.idLayout = bindLayout(device, 'prop-ids', [entry.texture('uint', '2d', GPUShaderStage.FRAGMENT)]);
    this.rasterPipeline = device.createRenderPipelineAsync({
      depthStencil: depthState(),
      fragment: { entryPoint: 'fs', module: raster, targets: [{ format: ID_FORMAT }] },
      label: 'prop-visibility',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow, dataLayout] }),
      primitive,
      vertex: { entryPoint: 'vs', module: raster },
    });
    this.resolvePipeline = device.createRenderPipelineAsync({
      // Depth is already final: the resolve neither tests nor writes it.
      depthStencil: { depthCompare: 'always', depthWriteEnabled: false, format: DEPTH },
      fragment: { entryPoint: 'fs', module: resolve, targets: [{ format: HDR }] },
      label: 'prop-resolve',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [shared.frame, shared.shadow, dataLayout, this.idLayout],
      }),
      primitive,
      vertex: { entryPoint: 'vs', module: resolve },
    });
  }

  resize(targets) {
    this.ids?.destroy();
    this.ids = this.device.createTexture({
      format: ID_FORMAT,
      label: 'prop-ids',
      size: [targets.width, targets.height],
      usage: flags(GPUTextureUsage.RENDER_ATTACHMENT, GPUTextureUsage.TEXTURE_BINDING),
    });
    this.idView = this.ids.createView();
    this.idGroup = bindGroup(this.device, this.idLayout, [this.idView], 'prop-ids');
  }

  // Raster pass: clears the scene depth and fills it with the props when `shouldDraw`.
  // `groups` holds the shared `frame` and `shadow` bind groups.
  encode(encoder, targets, groups, shouldDraw) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ clearValue: [EMPTY, 0, 0, 0], loadOp: 'clear', storeOp: 'store', view: this.idView }],
      depthStencilAttachment: {
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        view: targets.views.depth,
      },
      label: 'prop-visibility',
    });
    if (shouldDraw) {
      pass.setPipeline(this.rasterPipeline);
      pass.setBindGroup(GROUP.frame, groups.frame);
      pass.setBindGroup(GROUP.shadow, groups.shadow);
      pass.setBindGroup(GROUP.data, this.dataGroup);
      pass.drawIndirect(this.props.drawArgs, 0);
    }
    pass.end();
  }

  // Shades the covered pixels, inside the opaque pass.
  resolve(pass, frameGroup, shadowGroup) {
    pass.setPipeline(this.resolvePipeline);
    pass.setBindGroup(GROUP.frame, frameGroup);
    pass.setBindGroup(GROUP.shadow, shadowGroup);
    pass.setBindGroup(GROUP.data, this.dataGroup);
    pass.setBindGroup(GROUP.ids, this.idGroup);
    pass.draw(FULLSCREEN_VERTICES);
  }
}
