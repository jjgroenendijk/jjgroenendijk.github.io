// Minimal column-major 4x4 matrix helpers (WGSL mat4x4f layout).

// Frustum planes (camera-relative) from a view-projection matrix, reverse-Z.
export const frustumPlanes = (m) => {
    const row = (index) => [m[index], m[4 + index], m[8 + index], m[12 + index]],
      r0 = row(0),
      r1 = row(1),
      r2 = row(2),
      r3 = row(3),
      planes = [
        r3.map((v, index) => v + r0[index]),
        r3.map((v, index) => v - r0[index]),
        r3.map((v, index) => v + r1[index]),
        r3.map((v, index) => v - r1[index]),
        r3.map((v, index) => v - r2[index]),
        r2,
      ];
    return planes.map((p) => {
      const norm = Math.hypot(p[0], p[1], p[2]);
      if (norm < 1e-6) return [0, 0, 0, 1];
      return p.map((v) => v / norm);
    });
  },
  halton = (index, b) => {
    let f = 1,
      r = 0,
      remaining = index;
    while (remaining > 0) {
      f /= b;
      r += f * (remaining % b);
      remaining = Math.floor(remaining / b);
    }
    return r;
  },
  mat4 = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

    invert(m) {
      const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m,
        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,
        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06,
        // 1 / det, or 0 for a singular matrix (det zero or NaN).
        id = Number(Boolean(det)) / (det || 1);
      return new Float32Array([
        (a11 * b11 - a12 * b10 + a13 * b09) * id,
        (a02 * b10 - a01 * b11 - a03 * b09) * id,
        (a31 * b05 - a32 * b04 + a33 * b03) * id,
        (a22 * b04 - a21 * b05 - a23 * b03) * id,
        (a12 * b08 - a10 * b11 - a13 * b07) * id,
        (a00 * b11 - a02 * b08 + a03 * b07) * id,
        (a32 * b02 - a30 * b05 - a33 * b01) * id,
        (a20 * b05 - a22 * b02 + a23 * b01) * id,
        (a10 * b10 - a11 * b08 + a13 * b06) * id,
        (a01 * b08 - a00 * b10 - a03 * b06) * id,
        (a30 * b04 - a31 * b02 + a33 * b00) * id,
        (a21 * b02 - a20 * b04 - a23 * b00) * id,
        (a11 * b07 - a10 * b09 - a12 * b06) * id,
        (a00 * b09 - a01 * b07 + a02 * b06) * id,
        (a31 * b01 - a30 * b03 - a32 * b00) * id,
        (a20 * b03 - a21 * b01 + a22 * b00) * id,
      ]);
    },

    multiply(a, b) {
      const out = new Float32Array(16);
      for (let c = 0; c < 4; c += 1)
        for (let r = 0; r < 4; r += 1) {
          out[c * 4 + r] =
            a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      return out;
    },

    // WebGPU orthographic projection (depth 0..1).
    // eslint-disable-next-line max-params -- six box bounds, the signature shadow-pass.js calls
    ortho(left, right, bottom, top, near, far) {
      const m = new Float32Array(16);
      m[0] = 2 / (right - left);
      m[5] = 2 / (top - bottom);
      m[10] = 1 / (near - far);
      m[12] = -(right + left) / (right - left);
      m[13] = -(top + bottom) / (top - bottom);
      m[14] = near / (near - far);
      m[15] = 1;
      return m;
    },

    // Reverse-Z infinite perspective: near plane -> depth 1, infinity -> depth 0, with sub-pixel jitter jx, jy.
    // eslint-disable-next-line max-params -- renderer.js passes the jitter as two trailing positional arguments
    perspectiveReverseZ(fovY, aspect, near, jx = 0, jy = 0) {
      const f = 1 / Math.tan(fovY / 2),
        m = new Float32Array(16);
      m[0] = f / aspect;
      m[5] = f;
      m[8] = -jx;
      m[9] = -jy;
      m[11] = -1;
      m[14] = near;
      return m;
    },

    transformPoint(m, p) {
      const [x, y, z] = p,
        w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
      ];
    },

    translation(x, y, z) {
      const m = mat4.identity();
      m[12] = x;
      m[13] = y;
      m[14] = z;
      return m;
    },

    // Rotation-only view matrix from an orthonormal basis (camera at origin).
    viewFromBasis: (right, up, fwd) =>
      new Float32Array([
        right[0],
        up[0],
        -fwd[0],
        0,
        right[1],
        up[1],
        -fwd[1],
        0,
        right[2],
        up[2],
        -fwd[2],
        0,
        0,
        0,
        0,
        1,
      ]),
  },
  vec3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    length: (a) => Math.hypot(a[0], a[1], a[2]),
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    normalize: (a) => {
      const norm = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / norm, a[1] / norm, a[2] / norm];
    },
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  };
