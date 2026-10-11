import { cleanVec3, equals, type Vec3 } from './vec3';

/**
 * A local transform. Position and scale are in metres; rotation is Euler angles
 * in degrees applied in XYZ order (the same convention as Three.js).
 */
export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/** A 4x4 matrix stored column-major, matching Three.js `Matrix4.elements`. */
export type Mat4 = number[];

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function identityTransform(): Transform {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

export function cloneTransform(t: Transform): Transform {
  return { position: [...t.position], rotation: [...t.rotation], scale: [...t.scale] };
}

export function transformsEqual(a: Transform, b: Transform, epsilon = 1e-9): boolean {
  return (
    equals(a.position, b.position, epsilon) &&
    equals(a.rotation, b.rotation, epsilon) &&
    equals(a.scale, b.scale, epsilon)
  );
}

/** Removes floating-point noise (e.g. 0.30000000000000004) before values are stored. */
export function cleanTransform(t: Transform, decimals = 6): Transform {
  return {
    position: cleanVec3(t.position, decimals),
    rotation: cleanVec3(t.rotation, decimals),
    scale: cleanVec3(t.scale, decimals),
  };
}

export function identityMatrix(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Builds translation * rotation(XYZ) * scale. */
export function composeMatrix(t: Transform): Mat4 {
  const [rx, ry, rz] = t.rotation.map((deg) => deg * DEG_TO_RAD) as Vec3;
  const [sx, sy, sz] = t.scale;
  const a = Math.cos(rx);
  const b = Math.sin(rx);
  const c = Math.cos(ry);
  const d = Math.sin(ry);
  const e = Math.cos(rz);
  const f = Math.sin(rz);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  const r00 = c * e;
  const r01 = -c * f;
  const r02 = d;
  const r10 = af + be * d;
  const r11 = ae - bf * d;
  const r12 = -b * c;
  const r20 = bf - ae * d;
  const r21 = be + af * d;
  const r22 = a * c;

  return [
    r00 * sx, r10 * sx, r20 * sx, 0,
    r01 * sy, r11 * sy, r21 * sy, 0,
    r02 * sz, r12 * sz, r22 * sz, 0,
    t.position[0], t.position[1], t.position[2], 1,
  ];
}

/** Returns a * b (apply b first, then a). */
export function multiplyMatrices(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Inverts an affine matrix. Returns null when the matrix is singular (e.g. a zero scale). */
export function invertAffine(m: Mat4): Mat4 | null {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const n00 = (e * i - f * h) * inv;
  const n01 = (c * h - b * i) * inv;
  const n02 = (b * f - c * e) * inv;
  const n10 = (f * g - d * i) * inv;
  const n11 = (a * i - c * g) * inv;
  const n12 = (c * d - a * f) * inv;
  const n20 = (d * h - e * g) * inv;
  const n21 = (b * g - a * h) * inv;
  const n22 = (a * e - b * d) * inv;
  const tx = m[12], ty = m[13], tz = m[14];
  return [
    n00, n10, n20, 0,
    n01, n11, n21, 0,
    n02, n12, n22, 0,
    -(n00 * tx + n01 * ty + n02 * tz),
    -(n10 * tx + n11 * ty + n12 * tz),
    -(n20 * tx + n21 * ty + n22 * tz),
    1,
  ];
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Splits a matrix back into position, XYZ rotation (degrees) and scale. Shear is discarded. */
export function decomposeMatrix(m: Mat4): Transform {
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const det =
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) sx = -sx;

  const ix = sx === 0 ? 1 : 1 / sx;
  const iy = sy === 0 ? 1 : 1 / sy;
  const iz = sz === 0 ? 1 : 1 / sz;
  const m11 = m[0] * ix;
  const m12 = m[4] * iy;
  const m13 = m[8] * iz;
  const m22 = m[5] * iy;
  const m23 = m[9] * iz;
  const m32 = m[6] * iy;
  const m33 = m[10] * iz;

  const y = Math.asin(Math.min(1, Math.max(-1, m13)));
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }

  return {
    position: [m[12], m[13], m[14]],
    rotation: [x * RAD_TO_DEG, y * RAD_TO_DEG, z * RAD_TO_DEG],
    scale: [sx, sy, sz],
  };
}
