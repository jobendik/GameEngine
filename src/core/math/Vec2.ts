/**
 * Mutable 2D vector. Methods mutate `this` and return `this` for chaining
 * unless the name implies a new value (`clone`) or a static `out` target.
 */
export class Vec2 {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(v: Vec2): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  add(v: Vec2): this {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  /** this += v * s */
  addScaled(v: Vec2, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  sub(v: Vec2): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  mul(v: Vec2): this {
    this.x *= v.x;
    this.y *= v.y;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalize(): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y);
    if (len > 0) {
      const inv = 1 / len;
      this.x *= inv;
      this.y *= inv;
    }
    return this;
  }

  distanceTo(v: Vec2): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  lerp(v: Vec2, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    return this;
  }

  equals(v: Vec2, eps = 1e-6): boolean {
    return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps;
  }

  toArray(out: number[] = [], offset = 0): number[] {
    out[offset] = this.x;
    out[offset + 1] = this.y;
    return out;
  }

  /** out = a + b */
  static add(out: Vec2, a: Vec2, b: Vec2): Vec2 {
    out.x = a.x + b.x;
    out.y = a.y + b.y;
    return out;
  }
}
