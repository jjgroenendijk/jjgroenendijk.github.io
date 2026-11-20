// Cascaded shadow maps: three stabilised orthographic cascades around the camera.
import { bindGroup } from '../core/gpu.js';
import { mat4, vec3, frustumPlanes } from '../core/math.js';
import { DEPTH } from './layouts.js';
import { W } from '../world/noise.js';

export const CASCADES = 3;
export const SPLITS = [16, 60, 280];
const CASTER_RANGE = 700; // how far towards the light casters are captured

export class ShadowPass {
  constructor(device, shared, size, cloudMapView) {
    this.device = device;
    this.size = size;
    this.texture = device.createTexture({
      label: 'shadow-map', size: [size, size, CASCADES], format: DEPTH,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.layerViews = Array.from({ length: CASCADES }, (_, i) => this.texture.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    this.arrayView = this.texture.createView({ dimension: '2d-array' });
    this.buffers = Array.from({ length: CASCADES }, () => device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.groups = this.buffers.map((b) => bindGroup(device, shared.cascade, [b]));
    this.sampleGroup = bindGroup(device, shared.shadow, [this.arrayView, shared.compare, shared.linear, cloudMapView], 'shadow-sample');
    this.matrices = Array.from({ length: CASCADES }, () => mat4.identity());
  }

  // The far cascade changes slowly, so it is only re-rendered every other frame.
  active(frame) { return [true, true, frame % 2 === 0]; }

  // camera: { pos (world), right, up, fwd, fov, aspect }, light: unit vector towards the light
  update(camera, light, frame) {
    const active = this.active(frame);
    // the far cascade's matrix is kept relative to the camera of the frame it was rendered in
    if (!active[2] && this.lastPos) {
      const d = vec3.sub(camera.pos, this.lastPos);
      for (const k of [0, 2]) d[k] -= Math.round(d[k] / W) * W; // the world wraps
      this.matrices[2] = mat4.multiply(this.rendered2, mat4.translation(d[0], d[1], d[2]));
      this.device.queue.writeBuffer(this.buffers[2], 0, this.matrices[2]);
    }
    const L = vec3.normalize(light);
    const helper = Math.abs(L[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    const lx = vec3.normalize(vec3.cross(helper, L));
    const ly = vec3.cross(L, lx);
    const tanV = Math.tan(camera.fov / 2);
    let near = 0.1;
    for (let c = 0; c < CASCADES; c++) {
      const far = SPLITS[c];
      if (!active[c]) { near = far; continue; }
      const mid = (near + far) / 2;
      const hFar = far * tanV, wFar = hFar * camera.aspect;
      // bounding sphere of the slice (radius depends only on fov and split => stable)
      const radius = Math.ceil(Math.hypot(far - mid, hFar, wFar));
      const centerRel = vec3.scale(camera.fwd, mid);
      const centerAbs = vec3.add(centerRel, camera.pos);
      // snap the centre to whole shadow texels in light space
      const texel = (2 * radius) / this.size;
      const sx = Math.round(vec3.dot(centerAbs, lx) / texel) * texel;
      const sy = Math.round(vec3.dot(centerAbs, ly) / texel) * texel;
      const sz = vec3.dot(centerAbs, L);
      const snapped = vec3.add(vec3.add(vec3.scale(lx, sx), vec3.scale(ly, sy)), vec3.scale(L, sz));
      const rel = vec3.sub(snapped, camera.pos);
      const eye = vec3.add(rel, vec3.scale(L, CASTER_RANGE));
      const view = mat4.multiply(mat4.viewFromBasis(lx, ly, vec3.scale(L, -1)), mat4.translation(-eye[0], -eye[1], -eye[2]));
      const proj = mat4.ortho(-radius, radius, -radius, radius, 0.5, CASTER_RANGE + radius);
      this.matrices[c] = mat4.multiply(proj, view);
      if (c === 2) { this.rendered2 = this.matrices[c]; this.lastPos = [...camera.pos]; }
      this.device.queue.writeBuffer(this.buffers[c], 0, this.matrices[c]);
      near = far;
    }
  }

  encode(encoder, frameGroup, terrain, props, frame) {
    const active = this.active(frame);
    for (let c = 0; c < CASCADES; c++) {
      if (!active[c]) continue;
      const pass = encoder.beginRenderPass({
        label: `shadow-${c}`,
        colorAttachments: [],
        depthStencilAttachment: { view: this.layerViews[c], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      terrain.drawShadow(pass, frameGroup, this.groups[c], terrain.visibleDraws(frustumPlanes(this.matrices[c]), c === 0 ? 3 : 5));
      props.drawShadow(pass, frameGroup, this.groups[c], c);
      pass.end();
    }
  }
}
