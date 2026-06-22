import { Vec3 } from './Vec3';
import type { Quat } from './Quat';

/**
 * 4x4 matrix stored column-major in a `Float32Array(16)`, directly uploadable
 * to WebGL. Element `data[col*4 + row]`. Right-handed conventions throughout.
 *
 * Layout (column-major), where t* is translation:
 * ```
 * | data[0] data[4] data[8]  data[12] |
 * | data[1] data[5] data[9]  data[13] |
 * | data[2] data[6] data[10] data[14] |
 * | data[3] data[7] data[11] data[15] |
 * ```
 */
export class Mat4 {
  readonly data: Float32Array;

  constructor() {
    // Identity.
    this.data = new Float32Array(16);
    this.data[0] = 1;
    this.data[5] = 1;
    this.data[10] = 1;
    this.data[15] = 1;
  }

  identity(): this {
    const d = this.data;
    d[0] = 1; d[4] = 0; d[8] = 0; d[12] = 0;
    d[1] = 0; d[5] = 1; d[9] = 0; d[13] = 0;
    d[2] = 0; d[6] = 0; d[10] = 1; d[14] = 0;
    d[3] = 0; d[7] = 0; d[11] = 0; d[15] = 1;
    return this;
  }

  copy(m: Mat4): this {
    this.data.set(m.data);
    return this;
  }

  clone(): Mat4 {
    return new Mat4().copy(this);
  }

  /** this = this * m. */
  multiply(m: Mat4): this {
    return this.multiplyMatrices(this, m);
  }

  /** this = a * b (column-major). Safe when `this` aliases `a` or `b`. */
  multiplyMatrices(a: Mat4, b: Mat4): this {
    const ae = a.data;
    const be = b.data;

    const a00 = ae[0], a10 = ae[1], a20 = ae[2], a30 = ae[3];
    const a01 = ae[4], a11 = ae[5], a21 = ae[6], a31 = ae[7];
    const a02 = ae[8], a12 = ae[9], a22 = ae[10], a32 = ae[11];
    const a03 = ae[12], a13 = ae[13], a23 = ae[14], a33 = ae[15];

    const b00 = be[0], b10 = be[1], b20 = be[2], b30 = be[3];
    const b01 = be[4], b11 = be[5], b21 = be[6], b31 = be[7];
    const b02 = be[8], b12 = be[9], b22 = be[10], b32 = be[11];
    const b03 = be[12], b13 = be[13], b23 = be[14], b33 = be[15];

    const out = this.data;
    out[0] = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30;
    out[1] = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30;
    out[2] = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30;
    out[3] = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30;

    out[4] = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31;
    out[5] = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31;
    out[6] = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31;
    out[7] = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31;

    out[8] = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32;
    out[9] = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32;
    out[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32;
    out[11] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32;

    out[12] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33;
    out[13] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33;
    out[14] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33;
    out[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33;

    return this;
  }

  /**
   * Build a TRS matrix: translation * rotation(quat) * scale.
   * Equivalent to `compose = T * R * S`.
   */
  compose(pos: Vec3, rot: Quat, scale: Vec3): this {
    const d = this.data;
    const x = rot.x, y = rot.y, z = rot.z, w = rot.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    const sx = scale.x, sy = scale.y, sz = scale.z;

    d[0] = (1 - (yy + zz)) * sx;
    d[1] = (xy + wz) * sx;
    d[2] = (xz - wy) * sx;
    d[3] = 0;

    d[4] = (xy - wz) * sy;
    d[5] = (1 - (xx + zz)) * sy;
    d[6] = (yz + wx) * sy;
    d[7] = 0;

    d[8] = (xz + wy) * sz;
    d[9] = (yz - wx) * sz;
    d[10] = (1 - (xx + yy)) * sz;
    d[11] = 0;

    d[12] = pos.x;
    d[13] = pos.y;
    d[14] = pos.z;
    d[15] = 1;
    return this;
  }

  /**
   * Decompose this matrix into translation, rotation, and (positive) scale.
   * Handles a single negative-determinant axis by flipping X's sign so the
   * extracted rotation is a proper (non-mirrored) rotation.
   */
  decompose(outPos: Vec3, outRot: Quat, outScale: Vec3): this {
    const d = this.data;

    let sx = Math.hypot(d[0], d[1], d[2]);
    const sy = Math.hypot(d[4], d[5], d[6]);
    const sz = Math.hypot(d[8], d[9], d[10]);

    // If determinant is negative, negate one scale to keep a proper rotation.
    const det = this.determinant();
    if (det < 0) sx = -sx;

    outPos.set(d[12], d[13], d[14]);
    outScale.set(sx === 0 ? 0 : sx, sy === 0 ? 0 : sy, sz === 0 ? 0 : sz);

    const invSx = sx !== 0 ? 1 / sx : 0;
    const invSy = sy !== 0 ? 1 / sy : 0;
    const invSz = sz !== 0 ? 1 / sz : 0;

    // Build the pure-rotation upper-left 3x3 (column-major elements).
    const m11 = d[0] * invSx, m21 = d[1] * invSx, m31 = d[2] * invSx;
    const m12 = d[4] * invSy, m22 = d[5] * invSy, m32 = d[6] * invSy;
    const m13 = d[8] * invSz, m23 = d[9] * invSz, m33 = d[10] * invSz;

    const trace = m11 + m22 + m33;
    let s: number;
    if (trace > 0) {
      s = 0.5 / Math.sqrt(trace + 1.0);
      outRot.w = 0.25 / s;
      outRot.x = (m32 - m23) * s;
      outRot.y = (m13 - m31) * s;
      outRot.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      outRot.w = (m32 - m23) / s;
      outRot.x = 0.25 * s;
      outRot.y = (m12 + m21) / s;
      outRot.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      outRot.w = (m13 - m31) / s;
      outRot.x = (m12 + m21) / s;
      outRot.y = 0.25 * s;
      outRot.z = (m23 + m32) / s;
    } else {
      s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      outRot.w = (m21 - m12) / s;
      outRot.x = (m13 + m31) / s;
      outRot.y = (m23 + m32) / s;
      outRot.z = 0.25 * s;
    }
    return this;
  }

  /**
   * Invert this matrix in place via the cofactor/adjugate method.
   * Returns identity (and leaves the matrix as identity) if singular.
   */
  invert(): this {
    const m = this.data;
    const m00 = m[0], m10 = m[1], m20 = m[2], m30 = m[3];
    const m01 = m[4], m11 = m[5], m21 = m[6], m31 = m[7];
    const m02 = m[8], m12 = m[9], m22 = m[10], m32 = m[11];
    const m03 = m[12], m13 = m[13], m23 = m[14], m33 = m[15];

    // 2x2 sub-determinants of the bottom two rows / top two rows.
    const b00 = m00 * m11 - m10 * m01;
    const b01 = m00 * m21 - m20 * m01;
    const b02 = m00 * m31 - m30 * m01;
    const b03 = m10 * m21 - m20 * m11;
    const b04 = m10 * m31 - m30 * m11;
    const b05 = m20 * m31 - m30 * m21;
    const b06 = m02 * m13 - m12 * m03;
    const b07 = m02 * m23 - m22 * m03;
    const b08 = m02 * m33 - m32 * m03;
    const b09 = m12 * m23 - m22 * m13;
    const b10 = m12 * m33 - m32 * m13;
    const b11 = m22 * m33 - m32 * m23;

    let det =
      b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (det === 0) {
      return this.identity();
    }
    det = 1.0 / det;

    m[0] = (m11 * b11 - m21 * b10 + m31 * b09) * det;
    m[1] = (m20 * b10 - m10 * b11 - m30 * b09) * det;
    m[2] = (m13 * b05 - m23 * b04 + m33 * b03) * det;
    m[3] = (m22 * b04 - m12 * b05 - m32 * b03) * det;

    m[4] = (m21 * b08 - m01 * b11 - m31 * b07) * det;
    m[5] = (m00 * b11 - m20 * b08 + m30 * b07) * det;
    m[6] = (m23 * b02 - m03 * b05 - m33 * b01) * det;
    m[7] = (m02 * b05 - m22 * b02 + m32 * b01) * det;

    m[8] = (m01 * b10 - m11 * b08 + m31 * b06) * det;
    m[9] = (m10 * b08 - m00 * b10 - m30 * b06) * det;
    m[10] = (m03 * b04 - m13 * b02 + m33 * b00) * det;
    m[11] = (m12 * b02 - m02 * b04 - m32 * b00) * det;

    m[12] = (m11 * b07 - m01 * b09 - m21 * b06) * det;
    m[13] = (m00 * b09 - m10 * b07 + m20 * b06) * det;
    m[14] = (m13 * b01 - m03 * b03 - m23 * b00) * det;
    m[15] = (m02 * b03 - m12 * b01 + m22 * b00) * det;

    return this;
  }

  transpose(): this {
    const d = this.data;
    let t: number;
    t = d[1]; d[1] = d[4]; d[4] = t;
    t = d[2]; d[2] = d[8]; d[8] = t;
    t = d[3]; d[3] = d[12]; d[12] = t;
    t = d[6]; d[6] = d[9]; d[9] = t;
    t = d[7]; d[7] = d[13]; d[13] = t;
    t = d[11]; d[11] = d[14]; d[14] = t;
    return this;
  }

  setPosition(v: Vec3): this {
    this.data[12] = v.x;
    this.data[13] = v.y;
    this.data[14] = v.z;
    return this;
  }

  getPosition(out: Vec3): Vec3 {
    out.x = this.data[12];
    out.y = this.data[13];
    out.z = this.data[14];
    return out;
  }

  determinant(): number {
    const m = this.data;
    const m00 = m[0], m10 = m[1], m20 = m[2], m30 = m[3];
    const m01 = m[4], m11 = m[5], m21 = m[6], m31 = m[7];
    const m02 = m[8], m12 = m[9], m22 = m[10], m32 = m[11];
    const m03 = m[12], m13 = m[13], m23 = m[14], m33 = m[15];

    const b00 = m00 * m11 - m10 * m01;
    const b01 = m00 * m21 - m20 * m01;
    const b02 = m00 * m31 - m30 * m01;
    const b03 = m10 * m21 - m20 * m11;
    const b04 = m10 * m31 - m30 * m11;
    const b05 = m20 * m31 - m30 * m21;
    const b06 = m02 * m13 - m12 * m03;
    const b07 = m02 * m23 - m22 * m03;
    const b08 = m02 * m33 - m32 * m03;
    const b09 = m12 * m23 - m22 * m13;
    const b10 = m12 * m33 - m32 * m13;
    const b11 = m22 * m33 - m32 * m23;

    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  }

  /**
   * Right-handed perspective projection for WebGL clip space (camera looks down
   * -Z; NDC z mapped to [-1, 1] to match `gl.depthRange` defaults).
   * `fovY` is the vertical field of view in radians.
   */
  perspective(fovY: number, aspect: number, near: number, far: number): this {
    const d = this.data;
    const f = 1.0 / Math.tan(fovY / 2);
    const nf = 1.0 / (near - far);

    d[0] = f / aspect; d[4] = 0; d[8] = 0; d[12] = 0;
    d[1] = 0; d[5] = f; d[9] = 0; d[13] = 0;
    d[2] = 0; d[6] = 0; d[10] = (far + near) * nf; d[14] = 2 * far * near * nf;
    d[3] = 0; d[7] = 0; d[11] = -1; d[15] = 0;
    return this;
  }

  /**
   * Right-handed orthographic projection for WebGL clip space (NDC z in [-1,1]).
   */
  ortho(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
  ): this {
    const d = this.data;
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);

    d[0] = -2 * lr; d[4] = 0; d[8] = 0; d[12] = (left + right) * lr;
    d[1] = 0; d[5] = -2 * bt; d[9] = 0; d[13] = (top + bottom) * bt;
    d[2] = 0; d[6] = 0; d[10] = 2 * nf; d[14] = (far + near) * nf;
    d[3] = 0; d[7] = 0; d[11] = 0; d[15] = 1;
    return this;
  }

  /**
   * Right-handed view matrix that places the camera at `eye` looking toward
   * `target` with the given world `up`. The camera's local -Z points at the
   * target. Falls back gracefully if eye≈target or up is parallel to the view.
   */
  lookAt(eye: Vec3, target: Vec3, up: Vec3): this {
    const d = this.data;

    // z = normalize(eye - target) (points back toward the camera, +Z local).
    let zx = eye.x - target.x;
    let zy = eye.y - target.y;
    let zz = eye.z - target.z;
    let zlen = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (zlen === 0) {
      // eye == target: choose an arbitrary forward.
      zz = 1;
      zlen = 1;
    }
    const invZ = 1 / zlen;
    zx *= invZ; zy *= invZ; zz *= invZ;

    // x = normalize(cross(up, z)).
    let xx = up.y * zz - up.z * zy;
    let xy = up.z * zx - up.x * zz;
    let xz = up.x * zy - up.y * zx;
    let xlen = Math.sqrt(xx * xx + xy * xy + xz * xz);
    if (xlen === 0) {
      // up is parallel to z: nudge to obtain a valid basis.
      if (Math.abs(up.z) === 1) {
        zx += 1e-4;
      } else {
        zz += 1e-4;
      }
      zlen = Math.sqrt(zx * zx + zy * zy + zz * zz);
      const iz = 1 / zlen;
      zx *= iz; zy *= iz; zz *= iz;
      xx = up.y * zz - up.z * zy;
      xy = up.z * zx - up.x * zz;
      xz = up.x * zy - up.y * zx;
      xlen = Math.sqrt(xx * xx + xy * xy + xz * xz);
    }
    const invX = 1 / xlen;
    xx *= invX; xy *= invX; xz *= invX;

    // y = cross(z, x) (already unit length).
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    // View matrix is the inverse of the camera world basis: rows are x,y,z.
    d[0] = xx; d[4] = xy; d[8] = xz; d[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
    d[1] = yx; d[5] = yy; d[9] = yz; d[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
    d[2] = zx; d[6] = zy; d[10] = zz; d[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
    d[3] = 0; d[7] = 0; d[11] = 0; d[15] = 1;
    return this;
  }

  /** out = a * b. */
  static multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
    return out.multiplyMatrices(a, b);
  }
}
