import { Vec3, Quat, Mat4, MathUtils } from '@/core/math';

const _scratchMat = new Mat4();
const _lookMat = new Mat4();
const _nearPoint = new Vec3();
const _farPoint = new Vec3();

/**
 * A perspective camera. Holds position/rotation and derived view, projection,
 * and view-projection matrices recomputed on demand via {@link updateMatrices}.
 *
 * Right-handed, Y-up: the camera looks down its local -Z axis.
 */
export class Camera {
  /** World-space position. */
  position: Vec3;
  /** World-space orientation. */
  rotation: Quat;
  /** Vertical field of view in radians (default 60°). */
  fov: number;
  /** Near clip plane distance. */
  near: number;
  /** Far clip plane distance. */
  far: number;
  /** Viewport aspect ratio (width / height). */
  aspect: number;

  /** View matrix (world → camera). Recomputed by {@link updateMatrices}. */
  readonly view: Mat4;
  /** Projection matrix (camera → clip). Recomputed by {@link updateMatrices}. */
  readonly projection: Mat4;
  /** Combined projection * view. Recomputed by {@link updateMatrices}. */
  readonly viewProjection: Mat4;

  constructor() {
    this.position = new Vec3(0, 0, 0);
    this.rotation = new Quat();
    this.fov = 60 * MathUtils.DEG2RAD;
    this.near = 0.1;
    this.far = 1000;
    this.aspect = 1;

    this.view = new Mat4();
    this.projection = new Mat4();
    this.viewProjection = new Mat4();
  }

  /**
   * Recompute the view, projection, and view-projection matrices from the
   * current position, rotation, fov, aspect, and clip planes. The view matrix
   * is the inverse of the camera's world transform; viewProjection = P * V.
   */
  updateMatrices(): void {
    // view = inverse(compose(position, rotation, ONE))
    _scratchMat.compose(this.position, this.rotation, Vec3.ONE);
    this.view.copy(_scratchMat).invert();

    this.projection.perspective(this.fov, this.aspect, this.near, this.far);
    this.viewProjection.multiplyMatrices(this.projection, this.view);
  }

  /** Update the aspect ratio (call on viewport resize). */
  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  /** Write the camera's world-space forward (local -Z) into `out`. */
  getForward(out: Vec3): Vec3 {
    return out.set(0, 0, -1).applyQuat(this.rotation).normalize();
  }

  /** Write the camera's world-space right (local +X) into `out`. */
  getRight(out: Vec3): Vec3 {
    return out.set(1, 0, 0).applyQuat(this.rotation).normalize();
  }

  /**
   * Orient the camera to look at `target` from its current position using world
   * up (0,1,0). Sets {@link rotation} from the resulting orientation.
   */
  lookAt(target: Vec3): void {
    // Mat4.lookAt builds a view (inverse) matrix; its rotation is the inverse of
    // the camera's world rotation, so invert before extracting.
    _lookMat.lookAt(this.position, target, Vec3.UP);
    _lookMat.invert();
    this.rotation.setFromRotationMatrix(_lookMat).normalize();
  }

  /**
   * Build a world-space ray from a normalized device coordinate (nx,ny in
   * -1..1, +y up). Unprojects the near and far points through the inverse
   * view-projection and writes the ray origin (on the near plane) and the
   * normalized direction.
   */
  screenToRay(nx: number, ny: number, outOrigin: Vec3, outDir: Vec3): void {
    _scratchMat.copy(this.viewProjection).invert();

    _nearPoint.set(nx, ny, -1).applyMat4(_scratchMat);
    _farPoint.set(nx, ny, 1).applyMat4(_scratchMat);

    outOrigin.copy(_nearPoint);
    outDir.copy(_farPoint).sub(_nearPoint).normalize();
  }
}
