import { Vec3, Quat, Mat4 } from '@/core/math';

/**
 * Spatial transform component: position, rotation, and scale, with an optional
 * parent for hierarchical transforms.
 *
 * {@link localMatrix} and {@link worldMatrix} are `Float32Array`-backed {@link Mat4}
 * instances suitable for direct upload to WebGL. They are recomputed by
 * {@link updateMatrix}; the world matrix is `parent.worldMatrix * localMatrix`
 * (or just the local matrix when there is no parent).
 *
 * Note: {@link updateMatrix} reads `parent.worldMatrix` as-is, so a parent must
 * be updated before its children for the result to be correct.
 */
export class Transform {
  /** Local-space position. */
  position: Vec3 = new Vec3(0, 0, 0);
  /** Local-space rotation. Identity = (0,0,0,1). */
  rotation: Quat = new Quat(0, 0, 0, 1);
  /** Local-space scale. Defaults to (1,1,1). */
  scale: Vec3 = new Vec3(1, 1, 1);

  /** Local TRS matrix (relative to the parent). Recomputed by {@link updateMatrix}. */
  readonly localMatrix: Mat4 = new Mat4();
  /** World-space matrix. Recomputed by {@link updateMatrix}. */
  readonly worldMatrix: Mat4 = new Mat4();

  /** Optional parent transform. When set, world = parent.world * local. */
  parent?: Transform;

  constructor() {}

  /**
   * Recompute the local matrix from position/rotation/scale, then the world
   * matrix. If a parent is set, `world = parent.worldMatrix * local`, otherwise
   * `world = local`. The parent's world matrix is used as-is (update parents
   * before children).
   */
  updateMatrix(): void {
    this.localMatrix.compose(this.position, this.rotation, this.scale);
    if (this.parent) {
      this.worldMatrix.multiplyMatrices(this.parent.worldMatrix, this.localMatrix);
    } else {
      this.worldMatrix.copy(this.localMatrix);
    }
  }

  /** Set the local position. Chainable. */
  setPosition(x: number, y: number, z: number): this {
    this.position.set(x, y, z);
    return this;
  }
}
