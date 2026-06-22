import type { Quat } from './Quat';
import type { Mat4 } from './Mat4';

/**
 * Mutable 3D vector in a right-handed, Y-up coordinate space.
 * Methods mutate `this` and return `this` for chaining unless the name implies
 * a new value (`clone`) or a static `out` target. The static constants
 * (`ZERO`, `ONE`, `UP`, `FORWARD`, `RIGHT`) MUST NOT be mutated.
 */
export class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setScalar(s: number): this {
    this.x = s;
    this.y = s;
    this.z = s;
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  /** this += v * s — fundamental for explicit integrators (pos += vel*dt). */
  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  mul(v: Vec3): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  divScalar(s: number): this {
    const inv = 1 / s;
    this.x *= inv;
    this.y *= inv;
    this.z *= inv;
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** this = this × v (right-handed cross product). */
  cross(v: Vec3): this {
    const ax = this.x,
      ay = this.y,
      az = this.z;
    this.x = ay * v.z - az * v.y;
    this.y = az * v.x - ax * v.z;
    this.z = ax * v.y - ay * v.x;
    return this;
  }

  /** this = a × b. Safe even if `this` aliases `a` or `b`. */
  crossVectors(a: Vec3, b: Vec3): this {
    const ax = a.x,
      ay = a.y,
      az = a.z;
    const bx = b.x,
      by = b.y,
      bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  normalize(): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (len > 0) {
      const inv = 1 / len;
      this.x *= inv;
      this.y *= inv;
      this.z *= inv;
    }
    return this;
  }

  /** Rescale to the given length (no-op if currently zero-length). */
  setLength(l: number): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (len > 0) {
      const s = l / len;
      this.x *= s;
      this.y *= s;
      this.z *= s;
    }
    return this;
  }

  distanceTo(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distanceToSq(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  lerp(v: Vec3, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  lerpVectors(a: Vec3, b: Vec3, t: number): this {
    this.x = a.x + (b.x - a.x) * t;
    this.y = a.y + (b.y - a.y) * t;
    this.z = a.z + (b.z - a.z) * t;
    return this;
  }

  /** Component-wise minimum. */
  min(v: Vec3): this {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    return this;
  }

  /** Component-wise maximum. */
  max(v: Vec3): this {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    return this;
  }

  /** Clamp the magnitude to at most `maxLen` (direction preserved). */
  clampLength(maxLen: number): this {
    const lenSq = this.x * this.x + this.y * this.y + this.z * this.z;
    if (lenSq > maxLen * maxLen && lenSq > 0) {
      const s = maxLen / Math.sqrt(lenSq);
      this.x *= s;
      this.y *= s;
      this.z *= s;
    }
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  /**
   * Rotate this vector by quaternion `q` using the optimized
   * `v' = v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)` formula
   * (equivalent to q * v * q⁻¹ for a unit quaternion).
   */
  applyQuat(q: Quat): this {
    const vx = this.x,
      vy = this.y,
      vz = this.z;
    const qx = q.x,
      qy = q.y,
      qz = q.z,
      qw = q.w;

    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);

    // v' = v + q.w * t + cross(q.xyz, t)
    this.x = vx + qw * tx + (qy * tz - qz * ty);
    this.y = vy + qw * ty + (qz * tx - qx * tz);
    this.z = vz + qw * tz + (qx * ty - qy * tx);
    return this;
  }

  /**
   * Apply the full affine/projective transform `m` (column-major), including
   * translation and perspective w-divide.
   */
  applyMat4(m: Mat4): this {
    const e = m.data;
    const x = this.x,
      y = this.y,
      z = this.z;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    const invW = w !== 0 ? 1 / w : 1;
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * invW;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * invW;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * invW;
    return this;
  }

  /**
   * Transform as a direction: apply only the upper-left 3x3 (no translation),
   * then renormalize. Correct for unit-length results under non-uniform scale
   * is approximate; use a normal matrix for true surface normals.
   */
  transformDirection(m: Mat4): this {
    const e = m.data;
    const x = this.x,
      y = this.y,
      z = this.z;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }

  equals(v: Vec3, eps = 1e-6): boolean {
    return (
      Math.abs(this.x - v.x) <= eps &&
      Math.abs(this.y - v.y) <= eps &&
      Math.abs(this.z - v.z) <= eps
    );
  }

  toArray<T extends number[] | Float32Array = number[]>(
    out?: T,
    offset = 0,
  ): T {
    const target = (out ?? ([] as unknown as T)) as number[] | Float32Array;
    target[offset] = this.x;
    target[offset + 1] = this.y;
    target[offset + 2] = this.z;
    return target as T;
  }

  fromArray(a: ArrayLike<number>, offset = 0): this {
    this.x = a[offset];
    this.y = a[offset + 1];
    this.z = a[offset + 2];
    return this;
  }

  // ---- statics: write into `out`, return `out` ----

  static add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    out.x = a.x + b.x;
    out.y = a.y + b.y;
    out.z = a.z + b.z;
    return out;
  }

  static sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    out.x = a.x - b.x;
    out.y = a.y - b.y;
    out.z = a.z - b.z;
    return out;
  }

  static cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    const ax = a.x,
      ay = a.y,
      az = a.z;
    const bx = b.x,
      by = b.y,
      bz = b.z;
    out.x = ay * bz - az * by;
    out.y = az * bx - ax * bz;
    out.z = ax * by - ay * bx;
    return out;
  }

  static scale(out: Vec3, a: Vec3, s: number): Vec3 {
    out.x = a.x * s;
    out.y = a.y * s;
    out.z = a.z * s;
    return out;
  }

  static lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }

  static distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  static dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  // ---- constants (frozen; do not mutate) ----

  static readonly ZERO: Vec3 = Object.freeze(new Vec3(0, 0, 0)) as Vec3;
  static readonly ONE: Vec3 = Object.freeze(new Vec3(1, 1, 1)) as Vec3;
  /** World up (0,1,0). */
  static readonly UP: Vec3 = Object.freeze(new Vec3(0, 1, 0)) as Vec3;
  /** Camera/forward convention: looks down -Z. */
  static readonly FORWARD: Vec3 = Object.freeze(new Vec3(0, 0, -1)) as Vec3;
  /** World right (1,0,0). */
  static readonly RIGHT: Vec3 = Object.freeze(new Vec3(1, 0, 0)) as Vec3;
}
