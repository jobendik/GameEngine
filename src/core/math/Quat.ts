import { Vec3 } from './Vec3';
import type { Mat4 } from './Mat4';

/**
 * Unit quaternion representing a 3D rotation. Identity is (0,0,0,1).
 * Stored as (x, y, z, w) where (x,y,z) is the vector part.
 * Methods mutate `this` and return `this` unless the name implies a new value.
 */
export class Quat {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  identity(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;
    return this;
  }

  copy(q: Quat): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  clone(): Quat {
    return new Quat(this.x, this.y, this.z, this.w);
  }

  /** this = this * q (Hamilton product; rotations compose right-to-left). */
  multiply(q: Quat): this {
    return this.multiplyQuats(this, q);
  }

  /** this = a * b (Hamilton product). Safe when `this` aliases `a` or `b`. */
  multiplyQuats(a: Quat, b: Quat): this {
    const ax = a.x,
      ay = a.y,
      az = a.z,
      aw = a.w;
    const bx = b.x,
      by = b.y,
      bz = b.z,
      bw = b.w;
    this.x = aw * bx + ax * bw + ay * bz - az * by;
    this.y = aw * by - ax * bz + ay * bw + az * bx;
    this.z = aw * bz + ax * by - ay * bx + az * bw;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }

  normalize(): this {
    let len = Math.sqrt(
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w,
    );
    if (len === 0) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    } else {
      len = 1 / len;
      this.x *= len;
      this.y *= len;
      this.z *= len;
      this.w *= len;
    }
    return this;
  }

  /** Negate the vector part — the inverse rotation for a unit quaternion. */
  conjugate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  /** Full inverse (conjugate / |q|²). For unit quaternions equals conjugate. */
  invert(): this {
    const lenSq =
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    if (lenSq === 0) return this.identity();
    const inv = 1 / lenSq;
    this.x = -this.x * inv;
    this.y = -this.y * inv;
    this.z = -this.z * inv;
    this.w = this.w * inv;
    return this;
  }

  dot(q: Quat): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  length(): number {
    return Math.sqrt(
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w,
    );
  }

  /**
   * Spherical linear interpolation toward `q` by `t` in [0,1].
   * Takes the shortest path (handles the dot<0 sign flip) and falls back to
   * normalized linear interpolation when the quaternions are near-parallel.
   */
  slerp(q: Quat, t: number): this {
    if (t === 0) return this;
    if (t === 1) return this.copy(q);

    const ax = this.x,
      ay = this.y,
      az = this.z,
      aw = this.w;
    let bx = q.x,
      by = q.y,
      bz = q.z,
      bw = q.w;

    let cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw;

    // Choose the shorter arc by flipping one quaternion if needed.
    if (cosHalfTheta < 0) {
      cosHalfTheta = -cosHalfTheta;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }

    // If essentially identical, return self (avoid division by ~0).
    if (cosHalfTheta >= 1.0) {
      return this;
    }

    const sinHalfThetaSq = 1.0 - cosHalfTheta * cosHalfTheta;

    // Near-parallel: fall back to NLERP for numerical stability.
    if (sinHalfThetaSq <= Number.EPSILON) {
      const s = 1 - t;
      this.x = s * ax + t * bx;
      this.y = s * ay + t * by;
      this.z = s * az + t * bz;
      this.w = s * aw + t * bw;
      return this.normalize();
    }

    const sinHalfTheta = Math.sqrt(sinHalfThetaSq);
    const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    this.x = ax * ratioA + bx * ratioB;
    this.y = ay * ratioA + by * ratioB;
    this.z = az * ratioA + bz * ratioB;
    this.w = aw * ratioA + bw * ratioB;
    return this;
  }

  /** Set from a rotation of `angle` radians about `axis` (axis need not be unit). */
  setFromAxisAngle(axis: Vec3, angle: number): this {
    const half = angle * 0.5;
    const s = Math.sin(half);
    let ax = axis.x,
      ay = axis.y,
      az = axis.z;
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (len > 0) {
      const inv = 1 / len;
      ax *= inv;
      ay *= inv;
      az *= inv;
    }
    this.x = ax * s;
    this.y = ay * s;
    this.z = az * s;
    this.w = Math.cos(half);
    return this;
  }

  /**
   * Set from intrinsic Euler angles in XYZ order (radians): the resulting
   * rotation is Rx * Ry * Rz applied to a vector as q * v.
   */
  setFromEuler(x: number, y: number, z: number): this {
    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);

    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 + s1 * s2 * c3;
    this.w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }

  /**
   * Shortest-arc rotation that turns unit vector `from` into unit vector `to`.
   * Handles the antiparallel (180°) singularity by picking an orthogonal axis.
   */
  setFromUnitVectors(from: Vec3, to: Vec3): this {
    let r = from.x * to.x + from.y * to.y + from.z * to.z + 1;

    if (r < 1e-6) {
      // from and to are (nearly) opposite: rotate 180° about any orthogonal axis.
      r = 0;
      if (Math.abs(from.x) > Math.abs(from.z)) {
        this.x = -from.y;
        this.y = from.x;
        this.z = 0;
        this.w = 0;
      } else {
        this.x = 0;
        this.y = -from.z;
        this.z = from.y;
        this.w = 0;
      }
    } else {
      // cross(from, to)
      this.x = from.y * to.z - from.z * to.y;
      this.y = from.z * to.x - from.x * to.z;
      this.z = from.x * to.y - from.y * to.x;
      this.w = r;
    }
    return this.normalize();
  }

  /**
   * Extract rotation from the upper-left 3x3 of a matrix (assumed orthonormal /
   * pure rotation). Uses the numerically-stable trace branch method.
   */
  setFromRotationMatrix(m: Mat4): this {
    const te = m.data;
    // Column-major indices: m[col*4 + row].
    const m11 = te[0],
      m21 = te[1],
      m31 = te[2];
    const m12 = te[4],
      m22 = te[5],
      m32 = te[6];
    const m13 = te[8],
      m23 = te[9],
      m33 = te[10];

    const trace = m11 + m22 + m33;
    let s: number;

    if (trace > 0) {
      s = 0.5 / Math.sqrt(trace + 1.0);
      this.w = 0.25 / s;
      this.x = (m32 - m23) * s;
      this.y = (m13 - m31) * s;
      this.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      this.w = (m32 - m23) / s;
      this.x = 0.25 * s;
      this.y = (m12 + m21) / s;
      this.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      this.w = (m13 - m31) / s;
      this.x = (m12 + m21) / s;
      this.y = 0.25 * s;
      this.z = (m23 + m32) / s;
    } else {
      s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      this.w = (m21 - m12) / s;
      this.x = (m13 + m31) / s;
      this.y = (m23 + m32) / s;
      this.z = 0.25 * s;
    }
    return this;
  }

  toArray(out: number[] = [], offset = 0): number[] {
    out[offset] = this.x;
    out[offset + 1] = this.y;
    out[offset + 2] = this.z;
    out[offset + 3] = this.w;
    return out;
  }
}
