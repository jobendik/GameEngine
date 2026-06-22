import type { Mat4 } from './Mat4';

/**
 * 3x3 matrix stored column-major in a `Float32Array(9)`. Primarily used to
 * upload normal matrices and 2D transforms to shaders. Element `data[col*3 + row]`.
 */
export class Mat3 {
  readonly data: Float32Array;

  constructor() {
    this.data = new Float32Array(9);
    this.data[0] = 1;
    this.data[4] = 1;
    this.data[8] = 1;
  }

  identity(): this {
    const d = this.data;
    d[0] = 1; d[3] = 0; d[6] = 0;
    d[1] = 0; d[4] = 1; d[7] = 0;
    d[2] = 0; d[5] = 0; d[8] = 1;
    return this;
  }

  copy(m: Mat3): this {
    this.data.set(m.data);
    return this;
  }

  /** Take the upper-left 3x3 block of a Mat4 (column-major). */
  fromMat4(m: Mat4): this {
    const me = m.data;
    const d = this.data;
    d[0] = me[0]; d[3] = me[4]; d[6] = me[8];
    d[1] = me[1]; d[4] = me[5]; d[7] = me[9];
    d[2] = me[2]; d[5] = me[6]; d[8] = me[10];
    return this;
  }

  /**
   * Set this matrix to the normal matrix derived from `m`: the inverse-transpose
   * of `m`'s upper-left 3x3. This correctly transforms surface normals under
   * non-uniform scale. Falls back to the plain upper-left 3x3 if singular.
   */
  normalFromMat4(m: Mat4): this {
    return this.fromMat4(m).invert().transpose();
  }

  /**
   * Invert this 3x3 in place via the adjugate method. Returns identity if singular.
   */
  invert(): this {
    const m = this.data;
    const n11 = m[0], n21 = m[1], n31 = m[2];
    const n12 = m[3], n22 = m[4], n32 = m[5];
    const n13 = m[6], n23 = m[7], n33 = m[8];

    const t11 = n33 * n22 - n32 * n23;
    const t12 = n32 * n13 - n33 * n12;
    const t13 = n23 * n12 - n22 * n13;

    let det = n11 * t11 + n21 * t12 + n31 * t13;
    if (det === 0) {
      return this.identity();
    }
    const invDet = 1 / det;

    m[0] = t11 * invDet;
    m[1] = (n31 * n23 - n33 * n21) * invDet;
    m[2] = (n32 * n21 - n31 * n22) * invDet;

    m[3] = t12 * invDet;
    m[4] = (n33 * n11 - n31 * n13) * invDet;
    m[5] = (n31 * n12 - n32 * n11) * invDet;

    m[6] = t13 * invDet;
    m[7] = (n21 * n13 - n23 * n11) * invDet;
    m[8] = (n22 * n11 - n21 * n12) * invDet;

    return this;
  }

  transpose(): this {
    const d = this.data;
    let t: number;
    t = d[1]; d[1] = d[3]; d[3] = t;
    t = d[2]; d[2] = d[6]; d[6] = t;
    t = d[5]; d[5] = d[7]; d[7] = t;
    return this;
  }
}
