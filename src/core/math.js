// Minimal column-major 4x4 matrix helpers (WGSL mat4x4f layout).

export const mat4 = {
  identity() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },

  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },

  invert(m) {
    const o = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    const id = det ? 1 / det : 0;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * id; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * id;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * id; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * id;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * id; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * id;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * id; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * id;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * id; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * id;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * id; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * id;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * id; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * id;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * id; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * id;
    return o;
  },

  // Reverse-Z infinite perspective: near plane -> depth 1, infinity -> depth 0.
  perspectiveReverseZ(fovY, aspect, near, jx = 0, jy = 0) {
    const f = 1 / Math.tan(fovY / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f;
    m[8] = -jx; m[9] = -jy; m[11] = -1;
    m[14] = near;
    return m;
  },

  // WebGPU orthographic projection (depth 0..1).
  ortho(l, r, b, t, n, f) {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = 1 / (n - f);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = n / (n - f); m[15] = 1;
    return m;
  },

  // Rotation-only view matrix from an orthonormal basis (camera at origin).
  viewFromBasis(right, up, fwd) {
    return new Float32Array([
      right[0], up[0], -fwd[0], 0,
      right[1], up[1], -fwd[1], 0,
      right[2], up[2], -fwd[2], 0,
      0, 0, 0, 1,
    ]);
  },

  translation(x, y, z) { const m = mat4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },

  transformPoint(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
  },
};

export const vec3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

// Frustum planes (camera-relative) from a view-projection matrix, reverse-Z.
export function frustumPlanes(m) {
  const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const planes = [
    r3.map((v, i) => v + r0[i]), r3.map((v, i) => v - r0[i]),
    r3.map((v, i) => v + r1[i]), r3.map((v, i) => v - r1[i]),
    r3.map((v, i) => v - r2[i]), r2,
  ];
  return planes.map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return l < 1e-6 ? [0, 0, 0, 1] : p.map((v) => v / l);
  });
}

export const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
