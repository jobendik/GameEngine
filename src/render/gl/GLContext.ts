/**
 * GLContext — owns the WebGL2 rendering context for a canvas and probes
 * device capabilities used by the rest of the GL layer (Texture, Framebuffer).
 *
 * The context is created with a fixed attribute set tuned for an HDR deferred-ish
 * forward renderer: no MSAA on the default framebuffer (we resolve in postfx),
 * opaque alpha, high-performance GPU preference, depth but no stencil.
 */

/** Convenience alias matching CONTRACTS section 4. */
export type GL = WebGL2RenderingContext;

/** Device/driver capabilities probed once at context creation. */
export interface GLCaps {
  /** EXT_color_buffer_float present — renderable HALF_FLOAT/FLOAT color targets. */
  readonly colorBufferFloat: boolean;
  /** OES_texture_float_linear present — LINEAR filtering of float textures. */
  readonly textureFloatLinear: boolean;
  /** GL_MAX_SAMPLES — max MSAA samples for renderbuffers. */
  readonly maxSamples: number;
  /** Max anisotropy from EXT_texture_filter_anisotropic (1 if unsupported). */
  readonly anisotropy: number;
}

/** Anisotropic filtering extension shape (not in lib.dom typings). */
interface AnisotropyExt {
  readonly TEXTURE_MAX_ANISOTROPY_EXT: number;
  readonly MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
}

export class GLContext {
  readonly gl: GL;
  readonly canvas: HTMLCanvasElement;
  readonly caps: GLCaps;

  /** Loaded extension objects retained so dependent classes can use them. */
  readonly extColorBufferFloat: object | null;
  readonly extTextureFloatLinear: object | null;
  readonly extAnisotropy: AnisotropyExt | null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    }) as GL | null;

    if (!gl) {
      throw new Error(
        'GLContext: failed to acquire a WebGL2 context. This engine requires ' +
          'a WebGL2-capable browser/GPU (got null from getContext("webgl2")).',
      );
    }
    this.gl = gl;

    // --- Probe extensions / capabilities ---
    this.extColorBufferFloat = gl.getExtension('EXT_color_buffer_float');
    this.extTextureFloatLinear = gl.getExtension('OES_texture_float_linear');
    this.extAnisotropy =
      (gl.getExtension('EXT_texture_filter_anisotropic') as AnisotropyExt | null) ??
      (gl.getExtension('MOZ_EXT_texture_filter_anisotropic') as AnisotropyExt | null) ??
      (gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') as AnisotropyExt | null);

    const maxSamples = (gl.getParameter(gl.MAX_SAMPLES) as number) | 0;
    let anisotropy = 1;
    if (this.extAnisotropy) {
      anisotropy =
        (gl.getParameter(this.extAnisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) || 1;
    }

    this.caps = {
      colorBufferFloat: this.extColorBufferFloat !== null,
      textureFloatLinear: this.extTextureFloatLinear !== null,
      maxSamples,
      anisotropy,
    };
  }

  /**
   * Resize the drawing buffer to `w x h` CSS pixels scaled by `dpr`.
   * Sets `canvas.width/height` to the backing-store (drawing-buffer) pixels.
   * No-op if the computed size is unchanged.
   */
  resize(w: number, h: number, dpr: number = 1): void {
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  get drawingBufferWidth(): number {
    return this.gl.drawingBufferWidth;
  }

  get drawingBufferHeight(): number {
    return this.gl.drawingBufferHeight;
  }
}
