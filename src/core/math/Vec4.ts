/**
 * Mutable 4D vector. Used for homogeneous coordinates, RGBA, and tangents
 * (xyz tangent + w handedness). Methods mutate `this` and return `this`.
 */
export class Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 0) {
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

  copy(v: Vec4): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.w = v.w;
    return this;
  }

  clone(): Vec4 {
    return new Vec4(this.x, this.y, this.z, this.w);
  }

  add(v: Vec4): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.w += v.w;
    return this;
  }

  sub(v: Vec4): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this.w -= v.w;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    this.w *= s;
    return this;
  }

  dot(v: Vec4): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  length(): number {
    return Math.sqrt(
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w,
    );
  }

  normalize(): this {
    const len = this.length();
    if (len > 0) {
      const inv = 1 / len;
      this.x *= inv;
      this.y *= inv;
      this.z *= inv;
      this.w *= inv;
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
