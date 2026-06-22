import { Texture } from './Texture';
import type { GL } from './GLContext';

/** Options for {@link Framebuffer}. */
export interface FramebufferOptions {
  width: number;
  height: number;
  /** Number of color targets for MRT. Default 1. */
  colorAttachments?: number;
  /** Color pixel type: gl.UNSIGNED_BYTE | gl.HALF_FLOAT | gl.FLOAT. Default HALF_FLOAT (HDR). */
  colorType?: number;
  /** Allocate a depth attachment. Default true. */
  depth?: boolean;
  /** If true, depth is a sampleable Texture (shadow maps). Else a renderbuffer. */
  depthTexture?: boolean;
}

/**
 * Framebuffer — an offscreen render target with N color attachments (each a
 * {@link Texture}) and an optional depth attachment (sampleable texture or a
 * renderbuffer). Defaults to a single HALF_FLOAT HDR color target with depth.
 */
export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly colorTextures: Texture[] = [];
  readonly depthTexture: Texture | undefined;

  private readonly gl: GL;
  private readonly fbo: WebGLFramebuffer;
  private readonly colorCount: number;
  private readonly colorType: number;
  private readonly hasDepth: boolean;
  private readonly depthAsTexture: boolean;
  private depthRenderbuffer: WebGLRenderbuffer | null = null;

  constructor(gl: GL, opts: FramebufferOptions) {
    this.gl = gl;
    this.width = Math.max(1, opts.width);
    this.height = Math.max(1, opts.height);
    this.colorCount = Math.max(1, opts.colorAttachments ?? 1);
    this.colorType = opts.colorType ?? gl.HALF_FLOAT;
    this.hasDepth = opts.depth ?? true;
    this.depthAsTexture = opts.depthTexture ?? false;

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Framebuffer: gl.createFramebuffer() returned null.');
    this.fbo = fbo;

    // Build color textures up-front so the public arrays are populated.
    for (let i = 0; i < this.colorCount; i++) {
      this.colorTextures.push(this.createColorTexture());
    }
    if (this.hasDepth && this.depthAsTexture) {
      this.depthTexture = this.createDepthTexture();
    }

    this.attachAll();
  }

  /** Bind this framebuffer and set the viewport to its full size. */
  bind(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  /** Recreate all attachments at a new size. */
  resize(w: number, h: number): void {
    const gl = this.gl;
    const self = this as { -readonly [K in keyof Framebuffer]: Framebuffer[K] };
    self.width = Math.max(1, w);
    self.height = Math.max(1, h);

    for (const tex of this.colorTextures) tex.resize(this.width, this.height);
    if (this.depthTexture) this.depthTexture.resize(this.width, this.height);
    if (this.depthRenderbuffer) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRenderbuffer);
      gl.renderbufferStorage(
        gl.RENDERBUFFER,
        gl.DEPTH_COMPONENT24,
        this.width,
        this.height,
      );
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    }

    this.attachAll();
  }

  dispose(): void {
    const gl = this.gl;
    for (const tex of this.colorTextures) tex.dispose();
    this.colorTextures.length = 0;
    if (this.depthTexture) this.depthTexture.dispose();
    if (this.depthRenderbuffer) gl.deleteRenderbuffer(this.depthRenderbuffer);
    gl.deleteFramebuffer(this.fbo);
  }

  // ----- internals -----

  /** Allocate one color texture matching the configured type/format. */
  private createColorTexture(): Texture {
    const gl = this.gl;
    let internalFormat: number;
    if (this.colorType === gl.HALF_FLOAT || this.colorType === gl.FLOAT) {
      internalFormat = this.colorType === gl.FLOAT ? gl.RGBA32F : gl.RGBA16F;
    } else {
      internalFormat = gl.RGBA8;
    }
    return new Texture(gl, {
      width: this.width,
      height: this.height,
      internalFormat,
      format: gl.RGBA,
      type: this.colorType,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      mipmaps: false,
    });
  }

  /** Allocate a sampleable 32F depth texture (nearest, clamped — for shadows). */
  private createDepthTexture(): Texture {
    const gl = this.gl;
    return new Texture(gl, {
      width: this.width,
      height: this.height,
      internalFormat: gl.DEPTH_COMPONENT32F,
      format: gl.DEPTH_COMPONENT,
      type: gl.FLOAT,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      mipmaps: false,
    });
  }

  /** (Re)attach all color/depth targets, configure draw buffers, and validate. */
  private attachAll(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    const drawBuffers: number[] = [];
    for (let i = 0; i < this.colorTextures.length; i++) {
      const attachment = gl.COLOR_ATTACHMENT0 + i;
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        attachment,
        gl.TEXTURE_2D,
        this.colorTextures[i].handle,
        0,
      );
      drawBuffers.push(attachment);
    }
    gl.drawBuffers(drawBuffers);

    if (this.hasDepth) {
      if (this.depthAsTexture && this.depthTexture) {
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          gl.TEXTURE_2D,
          this.depthTexture.handle,
          0,
        );
      } else {
        if (!this.depthRenderbuffer) {
          const rb = gl.createRenderbuffer();
          if (!rb) throw new Error('Framebuffer: gl.createRenderbuffer() returned null.');
          this.depthRenderbuffer = rb;
          gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
          gl.renderbufferStorage(
            gl.RENDERBUFFER,
            gl.DEPTH_COMPONENT24,
            this.width,
            this.height,
          );
          gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        }
        gl.framebufferRenderbuffer(
          gl.FRAMEBUFFER,
          gl.DEPTH_ATTACHMENT,
          gl.RENDERBUFFER,
          this.depthRenderbuffer,
        );
      }
    }

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `Framebuffer: incomplete (status 0x${status.toString(16)}). ` +
          `size=${this.width}x${this.height}, colorType=0x${this.colorType.toString(16)}, ` +
          `attachments=${this.colorTextures.length}, depthTexture=${this.depthAsTexture}.`,
      );
    }
  }
}
