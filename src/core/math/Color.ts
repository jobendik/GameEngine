/**
 * RGBA color stored in **linear** space, components in [0, 1] (rgb may exceed 1
 * for HDR/emissive). `setHex`/`fromHex` accept sRGB hex and convert to linear
 * using the standard IEC 61966-2-1 sRGB transfer function.
 */
export class Color {
  r: number;
  g: number;
  b: number;
  a: number;

  constructor(r = 1, g = 1, b = 1, a = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  set(r: number, g: number, b: number, a = 1): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  /**
   * Set from a packed 0xRRGGBB sRGB integer, converting each channel to linear
   * space. Alpha is preserved (defaults to 1 if currently unset elsewhere).
   */
  setHex(hex: number): this {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    this.r = Color.srgbToLinear(r);
    this.g = Color.srgbToLinear(g);
    this.b = Color.srgbToLinear(b);
    this.a = 1;
    return this;
  }

  copy(c: Color): this {
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    this.a = c.a;
    return this;
  }

  clone(): Color {
    return new Color(this.r, this.g, this.b, this.a);
  }

  /** Interpolate all four channels toward `c` by `t`. */
  lerp(c: Color, t: number): this {
    this.r += (c.r - this.r) * t;
    this.g += (c.g - this.g) * t;
    this.b += (c.b - this.b) * t;
    this.a += (c.a - this.a) * t;
    return this;
  }

  /** Scale rgb only (e.g. emissive intensity); alpha untouched. */
  scale(s: number): this {
    this.r *= s;
    this.g *= s;
    this.b *= s;
    return this;
  }

  toArray<T extends number[] | Float32Array = number[]>(
    out?: T,
    offset = 0,
  ): T {
    const target = (out ?? ([] as unknown as T)) as number[] | Float32Array;
    target[offset] = this.r;
    target[offset + 1] = this.g;
    target[offset + 2] = this.b;
    target[offset + 3] = this.a;
    return target as T;
  }

  /** Construct a new linear-space Color from an sRGB 0xRRGGBB hex value. */
  static fromHex(hex: number): Color {
    return new Color().setHex(hex);
  }

  /**
   * Standard sRGB → linear transfer function for a single channel in [0,1].
   * Uses the exact piecewise curve (linear segment below 0.04045).
   */
  static srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /** Inverse transfer function: linear → sRGB for a single channel in [0,1]. */
  static linearToSrgb(c: number): number {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }
}
