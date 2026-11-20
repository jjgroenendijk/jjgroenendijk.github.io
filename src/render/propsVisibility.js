// Props through a visibility buffer: one draw rasterizes every prop slot into
// an ID target (slot and instance, triangle) plus depth; a fullscreen resolve
// then shades each covered pixel exactly once. Dense, many-layered jungle no
// longer pays for shading the leaves that end up hidden.
import { shader, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { visibilityWGSL, resolveWGSL, EMPTY, ID_FORMAT } from '../shaders/propsVisibility.js';
import { HDR, DEPTH, depthState } from './layouts.js';

export class PropsVisibility {
  constructor(device, shared, props) {
    this.device = device;
    this.props = props;
    const F = GPUShaderStage.FRAGMENT, VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const dataLayout = bindLayout(device, 'prop-data', [
      entry.texture('float', '2d-array', F), entry.texture('float', '2d-array', F),
      ...Array.from({ length: 5 }, () => entry.storage(true, VF)),
    ]);
    this.dataGroup = bindGroup(device, dataLayout, props.visibilityResources, 'prop-data');
    this.idLayout = bindLayout(device, 'prop-ids', [entry.texture('uint', '2d', F)]);
    const primitive = { topology: 'triangle-list', cullMode: 'none' };

    const raster = shader(device, props.withCards(visibilityWGSL), 'prop-visibility');
    this.rasterPipeline = device.createRenderPipeline({
      label: 'prop-visibility',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow, dataLayout] }),
      vertex: { module: raster, entryPoint: 'vs' },
      fragment: { module: raster, entryPoint: 'fs', targets: [{ format: ID_FORMAT }] },
      primitive,
      depthStencil: depthState(),
    });
    const resolve = shader(device, props.withCards(resolveWGSL), 'prop-resolve');
    this.resolvePipeline = device.createRenderPipeline({
      label: 'prop-resolve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, shared.shadow, dataLayout, this.idLayout] }),
      vertex: { module: resolve, entryPoint: 'vs' },
      fragment: { module: resolve, entryPoint: 'fs', targets: [{ format: HDR }] },
      primitive,
      // depth is already final: the resolve neither tests nor writes it
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'always' },
    });
  }

  resize(targets) {
    this.ids?.destroy();
    this.ids = this.device.createTexture({
      label: 'prop-ids', size: [targets.width, targets.height], format: ID_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.idView = this.ids.createView();
    this.idGroup = bindGroup(this.device, this.idLayout, [this.idView], 'prop-ids');
  }

  // Raster pass: clears the scene depth and fills it with the props.
  encode(encoder, targets, frameGroup, shadowGroup, drawProps) {
    const pass = encoder.beginRenderPass({
      label: 'prop-visibility',
      colorAttachments: [{ view: this.idView, loadOp: 'clear', storeOp: 'store', clearValue: [EMPTY, 0, 0, 0] }],
      depthStencilAttachment: { view: targets.views.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    if (drawProps) {
      pass.setPipeline(this.rasterPipeline);
      pass.setBindGroup(0, frameGroup);
      pass.setBindGroup(1, shadowGroup);
      pass.setBindGroup(2, this.dataGroup);
      pass.drawIndirect(this.props.drawArgs, 0);
    }
    pass.end();
  }

  // Shades the covered pixels, inside the opaque pass.
  resolve(pass, frameGroup, shadowGroup) {
    pass.setPipeline(this.resolvePipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, shadowGroup);
    pass.setBindGroup(2, this.dataGroup);
    pass.setBindGroup(3, this.idGroup);
    pass.draw(3);
  }
}
