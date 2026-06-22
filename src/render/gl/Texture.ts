import type { GL } from './GLContext';

/** Options for {@link Texture}. All optional with sensible HDR-friendly defaults. */
export interface TextureOptions {
  width?: number;
  height?: number;
  /** Sized internal format (e.g. gl.RGBA8, gl.RGBA16F). Default RGBA8. */
  internalFormat?: number;
  /** Pixel format (e.g. gl.RGBA). Default RGBA. */
  format?: number;
  /** Pixel type (e.g. gl.UNSIGNED_BYTE, gl.HALF_FLOAT). Default UNSIGNED_BYTE. */
  type?: number;
  minFilter?: number;
  magFilter?: number;
  wrapS?: number;
  wrapT?: number;
  mipmaps?: boolean;
  flipY?: boolean;
  anisotropy?: number;
  data?: ArrayBufferView | null;
}

/** EXT_texture_filter_anisotropic enum subset. */
interface AnisotropyExt {
  readonly TEXTURE_MAX_ANISOTROPY_EXT: number;
  readonly MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
}

/**
 * Texture — a 2D GPU texture with full sampler/format control.
 *
 * Defaults: RGBA8, LINEAR min/mag, CLAMP_TO_EDGE, no mipmaps. When `mipmaps`
 * is requested the min filter is upgraded to LINEAR_MIPMAP_LINEAR (unless the
 * caller specified one) and a mip chain is generated.
 */
export class Texture {
  readonly handle: WebGLTexture;
  width: number;
  height: number;

  private readonly gl: GL;
  private readonly internalFormat: number;
  private readonly format: number;
  private readonly type: number;
  private readonly mipmaps: boolean;

  constructor(gl: GL, opts: TextureOptions = {}) {
    this.gl = gl;

    this.width = Math.max(1, opts.width ?? 1);
    this.height = Math.max(1, opts.height ?? 1);
    this.internalFormat = opts.internalFormat ?? gl.RGBA8;
    this.format = opts.format ?? gl.RGBA;
    this.type = opts.type ?? gl.UNSIGNED_BYTE;
    this.mipmaps = opts.mipmaps ?? false;

    const wrapS = opts.wrapS ?? gl.CLAMP_TO_EDGE;
    const wrapT = opts.wrapT ?? gl.CLAMP_TO_EDGE;
    const magFilter = opts.magFilter ?? gl.LINEAR;
    const minFilter =
      opts.minFilter ?? (this.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);

    const handle = gl.createTexture();
    if (!handle) throw new Error('Texture: gl.createTexture() returned null.');
    this.handle = handle;

    gl.bindTexture(gl.TEXTURE_2D, handle);

    if (opts.flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.internalFormat,
      this.width,
      this.height,
      0,
      this.format,
      this.type,
      (opts.data ?? null) as ArrayBufferView | null,
    );

    if (opts.flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);

    if (opts.anisotropy && opts.anisotropy > 1) {
      this.applyAnisotropy(opts.anisotropy);
    }

    if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Build a texture from an image/canvas/video source. */
  static fromImage(gl: GL, img: TexImageSource, opts: TextureOptions = {}): Texture {
    const tex = new Texture(gl, {
      width: 1,
      height: 1,
      mipmaps: opts.mipmaps ?? true,
      flipY: opts.flipY ?? true,
      internalFormat: opts.internalFormat ?? gl.RGBA8,
      format: opts.format ?? gl.RGBA,
      type: opts.type ?? gl.UNSIGNED_BYTE,
      minFilter: opts.minFilter,
      magFilter: opts.magFilter,
      wrapS: opts.wrapS,
      wrapT: opts.wrapT,
      anisotropy: opts.anisotropy,
    });

    const w =
      (img as { width?: number }).width ??
      (img as { videoWidth?: number }).videoWidth ??
      1;
    const h =
      (img as { height?: number }).height ??
      (img as { videoHeight?: number }).videoHeight ??
      1;

    gl.bindTexture(gl.TEXTURE_2D, tex.handle);
    if (opts.flipY ?? true) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, tex.internalFormat, tex.format, tex.type, img);
    if (opts.flipY ?? true) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (opts.mipmaps ?? true) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);

    tex.width = w;
    tex.height = h;
    return tex;
  }

  /** 1x1 RGBA8 texture filled with the given (0..1) color. */
  static fromColor(gl: GL, r: number, g: number, b: number, a = 1): Texture {
    const data = new Uint8Array([
      Math.round(Math.min(1, Math.max(0, r)) * 255),
      Math.round(Math.min(1, Math.max(0, g)) * 255),
      Math.round(Math.min(1, Math.max(0, b)) * 255),
      Math.round(Math.min(1, Math.max(0, a)) * 255),
    ]);
    return new Texture(gl, {
      width: 1,
      height: 1,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      data,
    });
  }

  /** 1x1 opaque white. */
  static white(gl: GL): Texture {
    return Texture.fromColor(gl, 1, 1, 1, 1);
  }

  /** 1x1 opaque black. */
  static black(gl: GL): Texture {
    return Texture.fromColor(gl, 0, 0, 0, 1);
  }

  /** 1x1 flat tangent-space normal (rgb 128,128,255 => +Z). */
  static normalFlat(gl: GL): Texture {
    return Texture.fromColor(gl, 0.5, 0.5, 1, 1);
  }

  /** Activate `unit` and bind this texture there. */
  bind(unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
  }

  /** Upload a full-resolution pixel block, resizing storage to `width x height`. */
  setData(data: ArrayBufferView, width: number, height: number): void {
    const gl = this.gl;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.internalFormat,
      this.width,
      this.height,
      0,
      this.format,
      this.type,
      data,
    );
    if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Reallocate empty storage at a new size (e.g. on canvas/framebuffer resize). */
  resize(w: number, h: number): void {
    const gl = this.gl;
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.internalFormat,
      this.width,
      this.height,
      0,
      this.format,
      this.type,
      null,
    );
    if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  dispose(): void {
    this.gl.deleteTexture(this.handle);
  }

  /** Apply anisotropic filtering if the extension is available. */
  private applyAnisotropy(requested: number): void {
    const gl = this.gl;
    const ext =
      (gl.getExtension('EXT_texture_filter_anisotropic') as AnisotropyExt | null) ??
      (gl.getExtension('MOZ_EXT_texture_filter_anisotropic') as AnisotropyExt | null) ??
      (gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') as AnisotropyExt | null);
    if (!ext) return;
    const max = (gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) || 1;
    const value = Math.min(requested, max);
    gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, value);
  }
}
