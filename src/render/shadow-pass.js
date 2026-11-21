// Cascaded shadow maps: three stabilised orthographic cascades around the camera.
import { bindGroup, flags } from '../core/gpu.js';
import { frustumPlanes, mat4, vec3 } from '../core/math.js';
import { DEPTH } from './layouts.js';
import { W } from '../world/noise.js';

// Per cascade: far split (m), the shadow cache's maximum age in frames, and the terrain clipmap levels drawn into it.
const CASCADE = [
    { far: 16, maxAge: 1, terrainLevels: 3 },
    { far: 60, maxAge: 2, terrainLevels: 5 },
    { far: 280, maxAge: 8, terrainLevels: 5 },
  ],
  // How far towards the light casters are captured.
  CASTER_RANGE = 700,
  // Near end of the first cascade's slice.
  FIRST_NEAR = 0.1,
  HALF_TURN_DEG = 180,
  // Light turn (degrees) that forces a cascade re-render.
  LIGHT_DEG = 0.3,
  MATRIX_BYTES = 64,
  // Camera movement, as a fraction of the cascade radius, that forces a re-render.
  MOVE_FRACTION = 0.02,
  // Above this |light.y| the light-space basis is built from the x axis instead of y.
  POLE_COS = 0.99,
  // A one-degree camera turn forces a re-render.
  REDRAW_FWD_COS = Math.cos(Math.PI / HALF_TURN_DEG),
  REDRAW_LIGHT_COS = Math.cos((LIGHT_DEG * Math.PI) / HALF_TURN_DEG),
  SPLITS = CASCADE.map((cascade) => cascade.far),
  // Light-space axes: `toLight` is the unit vector towards the light, `lx` and `ly` span the shadow map.
  lightBasis = (light) => {
    const lightAxis = vec3.normalize(light),
      // Any axis off the light direction spans the map plane: y, or x when the light is near vertical.
      lx = vec3.normalize(vec3.cross((Math.abs(lightAxis[1]) > POLE_COS && [1, 0, 0]) || [0, 1, 0], lightAxis));
    return { lx, ly: vec3.cross(lightAxis, lx), toLight: lightAxis };
  },
  // Bounding sphere of a cascade's view slice (radius depends only on fov and split => stable), camera-relative
  // centre made absolute.
  sliceSphere = (near, far, camera) => {
    const halfHeight = far * Math.tan(camera.fov / 2),
      mid = (near + far) / 2,
      radius = Math.ceil(Math.hypot(far - mid, halfHeight, halfHeight * camera.aspect));
    return { center: vec3.add(vec3.scale(camera.fwd, mid), camera.pos), radius };
  },
  // Snaps the centre to whole shadow texels in light space.
  snapToTexels = (center, radius, size, { lx, ly, toLight }) => {
    const texel = (2 * radius) / size,
      toGrid = (axis) => vec3.scale(axis, Math.round(vec3.dot(center, axis) / texel) * texel);
    return vec3.add(vec3.add(toGrid(lx), toGrid(ly)), vec3.scale(toLight, vec3.dot(center, toLight)));
  },
  // Shortest offset in the wrapping world.
  wrapped = (d) => {
    for (const k of [0, 2]) d[k] -= Math.round(d[k] / W) * W;
    return d;
  };

export class ShadowPass {
  // Per cascade: whether this frame re-renders it, and the camera and light it was last rendered with.
  active;
  rendered = [];

  constructor(device, shared, size, cloudMapView) {
    this.device = device;
    this.size = size;
    this.texture = device.createTexture({
      format: DEPTH,
      label: 'shadow-map',
      size: [size, size, CASCADE.length],
      usage: flags(GPUTextureUsage.RENDER_ATTACHMENT, GPUTextureUsage.TEXTURE_BINDING),
    });
    this.layerViews = Array.from({ length: CASCADE.length }, (_, layer) =>
      this.texture.createView({ arrayLayerCount: 1, baseArrayLayer: layer, dimension: '2d' }),
    );
    this.arrayView = this.texture.createView({ dimension: '2d-array' });
    this.buffers = Array.from({ length: CASCADE.length }, () =>
      device.createBuffer({ size: MATRIX_BYTES, usage: flags(GPUBufferUsage.UNIFORM, GPUBufferUsage.COPY_DST) }),
    );
    this.groups = this.buffers.map((b) => bindGroup(device, shared.cascade, [b]));
    this.sampleGroup = bindGroup(
      device,
      shared.shadow,
      [this.arrayView, shared.compare, shared.linear, cloudMapView],
      'shadow-sample',
    );
    this.matrices = Array.from({ length: CASCADE.length }, () => mat4.identity());
  }

  // Cached cascades: a cascade is re-rendered when it is older than its
  // maximum age or the view / light moved noticeably; otherwise last render's
  // map is reused with its matrix shifted by the camera's movement.
  plan(camera, toLight, frame) {
    return CASCADE.map((cascade, c) => {
      const r = this.rendered[c];
      return (
        !r ||
        frame === 0 ||
        frame - r.frame >= cascade.maxAge ||
        vec3.dot(toLight, r.light) < REDRAW_LIGHT_COS ||
        vec3.dot(camera.fwd, r.fwd) < REDRAW_FWD_COS ||
        vec3.length(wrapped(vec3.sub(camera.pos, r.pos))) > r.radius * MOVE_FRACTION
      );
    });
  }

  // Camera: { pos (world), fwd, fov, aspect }, light: unit vector towards the light.
  update(camera, light, frame) {
    const basis = lightBasis(light);
    this.active = this.plan(camera, basis.toLight, frame);
    for (const [c, isActive] of this.active.entries()) {
      if (isActive) this.fit(c, camera, basis, frame);
      else this.reuse(c, camera);
      this.device.queue.writeBuffer(this.buffers[c], 0, this.matrices[c]);
    }
  }

  // Fits cascade `c` to its view slice and records what it was rendered with.
  fit(c, camera, basis, frame) {
    const { center, radius } = sliceSphere([FIRST_NEAR, ...SPLITS][c], SPLITS[c], camera),
      eye = vec3.add(
        vec3.sub(snapToTexels(center, radius, this.size, basis), camera.pos),
        vec3.scale(basis.toLight, CASTER_RANGE),
      ),
      proj = mat4.ortho(-radius, radius, -radius, radius, 0.5, CASTER_RANGE + radius),
      view = mat4.multiply(
        mat4.viewFromBasis(basis.lx, basis.ly, vec3.scale(basis.toLight, -1)),
        mat4.translation(-eye[0], -eye[1], -eye[2]),
      );
    this.matrices[c] = mat4.multiply(proj, view);
    this.rendered[c] = {
      frame,
      fwd: [...camera.fwd],
      light: basis.toLight,
      matrix: this.matrices[c],
      pos: [...camera.pos],
      radius,
    };
  }

  // Reuses cascade `c`'s last map, shifting its matrix by the camera's movement since.
  reuse(c, camera) {
    const { matrix, pos } = this.rendered[c],
      d = wrapped(vec3.sub(camera.pos, pos));
    this.matrices[c] = mat4.multiply(matrix, mat4.translation(d[0], d[1], d[2]));
  }

  encode(encoder, frameGroup, terrain, scatter) {
    for (const [c, isActive] of this.active.entries())
      if (isActive) this.encodeCascade(encoder, c, frameGroup, { scatter, terrain });
  }

  // Renders cascade `c`'s casters: the terrain tiles inside its frustum and the props.
  encodeCascade(encoder, c, frameGroup, { scatter, terrain }) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        view: this.layerViews[c],
      },
      label: `shadow-${c}`,
    });
    terrain.drawShadow(
      pass,
      frameGroup,
      this.groups[c],
      terrain.visibleDraws(frustumPlanes(this.matrices[c]), CASCADE[c].terrainLevels),
    );
    scatter.drawShadow(pass, frameGroup, this.groups[c], c);
    pass.end();
  }
}

export { SPLITS };
