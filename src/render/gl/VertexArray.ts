import type { GL } from './GLContext';

/** Per-attribute layout descriptor (CONTRACTS section 4). */
export interface AttribLayout {
  location: number;
  size: number;
  type?: number;
  normalized?: boolean;
}

/** Internal record for a buffer that may be re-uploaded via updateAttribute. */
interface BufferRecord {
  buffer: WebGLBuffer;
  size: number;
  dynamic: boolean;
}

/**
 * VertexArray — wraps a real WebGLVertexArrayObject plus its owned buffers.
 *
 * Attributes are uploaded as tightly-packed Float32 arrays bound at fixed
 * attribute locations (see CONTRACTS: 0=pos, 1=normal, 2=uv, 3=tangent, 4=color,
 * 8..11=instance mat4, 12=instance color). Indices may be Uint16 or Uint32;
 * the element type is recorded for draw calls.
 */
export class VertexArray {
  readonly vao: WebGLVertexArrayObject;
  indexCount = 0;

  private readonly gl: GL;
  private readonly attributes = new Map<number, BufferRecord>();
  private readonly instanced = new Map<number, BufferRecord>();
  private indexBuffer: WebGLBuffer | null = null;
  private indexType = 0; // gl.UNSIGNED_SHORT | gl.UNSIGNED_INT
  private hasIndices = false;

  constructor(gl: GL) {
    this.gl = gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('VertexArray: gl.createVertexArray() returned null.');
    this.vao = vao;
  }

  /**
   * Create/buffer a Float32 attribute and wire it to `loc` with `size`
   * components (FLOAT). `dynamic` selects DYNAMIC_DRAW + allows updateAttribute.
   */
  setAttribute(loc: number, data: Float32Array, size: number, dynamic = false): this {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('VertexArray: gl.createBuffer() returned null.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);

    this.attributes.set(loc, { buffer, size, dynamic });

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return this;
  }

  /** Buffer element indices; records count + element type from the array kind. */
  setIndices(data: Uint16Array | Uint32Array): this {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);

    if (!this.indexBuffer) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('VertexArray: gl.createBuffer() returned null.');
      this.indexBuffer = buffer;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);

    this.indexCount = data.length;
    this.indexType = data instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.hasIndices = true;

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    return this;
  }

  /**
   * Create/buffer a per-instance Float32 attribute at `loc` with `size`
   * components and the given vertex-attrib divisor (default 1). For an
   * instance mat4 the caller invokes this four times at locs 8..11 with size 4.
   */
  setInstanced(loc: number, data: Float32Array, size: number, divisor = 1): this {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('VertexArray: gl.createBuffer() returned null.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(loc, divisor);

    this.instanced.set(loc, { buffer, size, dynamic: true });

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return this;
  }

  /** Re-upload an existing (vertex or instanced) buffer at `loc`. */
  updateAttribute(loc: number, data: Float32Array): void {
    const gl = this.gl;
    const rec = this.attributes.get(loc) ?? this.instanced.get(loc);
    if (!rec) {
      throw new Error(`VertexArray.updateAttribute: no buffer at location ${loc}.`);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  bind(): void {
    this.gl.bindVertexArray(this.vao);
  }

  unbind(): void {
    this.gl.bindVertexArray(null);
  }

  /** Draw the indexed geometry (`mode` defaults to TRIANGLES). */
  draw(mode?: number): void {
    const gl = this.gl;
    const m = mode ?? gl.TRIANGLES;
    gl.bindVertexArray(this.vao);
    if (this.hasIndices) {
      gl.drawElements(m, this.indexCount, this.indexType, 0);
    }
    gl.bindVertexArray(null);
  }

  /** Draw `instanceCount` instances of the indexed geometry. */
  drawInstanced(instanceCount: number, mode?: number): void {
    const gl = this.gl;
    const m = mode ?? gl.TRIANGLES;
    gl.bindVertexArray(this.vao);
    if (this.hasIndices) {
      gl.drawElementsInstanced(m, this.indexCount, this.indexType, 0, instanceCount);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    for (const rec of this.attributes.values()) gl.deleteBuffer(rec.buffer);
    for (const rec of this.instanced.values()) gl.deleteBuffer(rec.buffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    gl.deleteVertexArray(this.vao);
    this.attributes.clear();
    this.instanced.clear();
    this.indexBuffer = null;
  }
}
