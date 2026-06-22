import { Vec3, Quat, Mat4 } from '@/core/math';

/**
 * Body simulation class.
 * - `Static`: never moves, infinite mass (inverse mass/inertia = 0). Used for
 *   ground planes and immovable geometry.
 * - `Dynamic`: fully simulated — affected by gravity, forces and collisions.
 * - `Kinematic`: moved by user code (set velocity / position), pushes dynamic
 *   bodies but is not pushed back (treated as infinite mass by the solver).
 */
export enum BodyType {
  Static = 0,
  Dynamic = 1,
  Kinematic = 2,
}

/**
 * Convex collider shape attached to a {@link RigidBody}. Discriminated on
 * `kind`. The plane is an infinite half-space (typically static ground); the
 * capsule's central axis is the body-local Y axis.
 */
export type ColliderShape =
  | { kind: 'sphere'; radius: number }
  | { kind: 'box'; halfExtents: Vec3 }
  | { kind: 'plane'; normal: Vec3; constant: number }
  | { kind: 'capsule'; radius: number; height: number };

/** Result of a successful {@link PhysicsWorld.raycast}. */
export interface RaycastHit {
  /** The body the ray struck. */
  body: RigidBody;
  /** World-space intersection point. */
  point: Vec3;
  /** World-space surface normal at the hit (unit length, facing the ray). */
  normal: Vec3;
  /** Distance from the ray origin to {@link point}. */
  distance: number;
}

// Scratch quaternions reused by orientation integration (no per-step GC).
const _spin = new Quat();
const _deltaQ = new Quat();

/**
 * A rigid body: the unit of simulation in {@link PhysicsWorld}.
 *
 * Holds linear + angular state, mass/inertia (with cached inverses), material
 * properties (restitution, friction, damping) and force/torque accumulators.
 * A `mass` of `0` — always the case for {@link BodyType.Static} — means
 * infinite mass: the inverse mass and inverse inertia tensor are zero so the
 * solver leaves the body unmoved.
 *
 * The world matrix is recomputed from position + orientation each physics step
 * (see {@link updateWorldMatrix}) so renderers can read a ready transform.
 */
export class RigidBody {
  type: BodyType;
  position: Vec3 = new Vec3();
  orientation: Quat = new Quat();
  linearVelocity: Vec3 = new Vec3();
  angularVelocity: Vec3 = new Vec3();

  /** Mass in kg; `0` means infinite (static / immovable). */
  mass: number;
  /** Bounciness, 0 (inelastic) .. 1 (perfectly elastic). */
  restitution = 0.2;
  /** Coulomb friction coefficient, 0 (frictionless) .. 1+. */
  friction = 0.5;
  /** Per-second exponential damping of linear velocity. */
  linearDamping = 0.01;
  /** Per-second exponential damping of angular velocity. */
  angularDamping = 0.05;

  shape: ColliderShape;
  /** Multiplier on world gravity for this body (1 = normal, 0 = floats). */
  gravityScale = 1;

  /** Transform recomputed by the physics step; safe for renderers to read. */
  readonly worldMatrix: Mat4 = new Mat4();

  /** Arbitrary user payload (entity id, tag, etc.). */
  userData?: unknown;

  /**
   * Stable index assigned by {@link PhysicsWorld} when the body is added, used
   * to dedupe broadphase pairs without object lookups. `-1` while unmanaged.
   */
  userIndex = -1;

  // ---- cached mass/inertia inverses (derived from mass + shape) -----------
  /** 1/mass, or 0 for infinite mass. */
  invMass = 0;
  /** Inverse inertia tensor in body-local space (diagonal). */
  readonly invInertiaLocal: Vec3 = new Vec3();
  /** Inverse inertia tensor rotated into world space (diagonal approximation). */
  readonly invInertiaWorld: Vec3 = new Vec3();

  // ---- accumulators (cleared every integration step) ---------------------
  private readonly force: Vec3 = new Vec3();
  private readonly torque: Vec3 = new Vec3();

  // ---- sleeping ----------------------------------------------------------
  /** Whether the body is currently asleep (skips integration). */
  sleeping = false;
  /** Accumulated time spent below the sleep velocity threshold. */
  sleepTimer = 0;

  /**
   * @param shape Collider geometry.
   * @param type  Simulation class (default {@link BodyType.Dynamic}).
   * @param mass  Mass in kg; ignored (forced to 0/infinite) for static bodies,
   *              defaults to `1` for dynamic/kinematic.
   */
  constructor(shape: ColliderShape, type: BodyType = BodyType.Dynamic, mass = 1) {
    this.shape = shape;
    this.type = type;
    this.mass = type === BodyType.Static ? 0 : mass;
    this.computeMassProperties();
    this.updateWorldMatrix();
  }

  /**
   * Recompute {@link invMass} and the local inverse inertia tensor from the
   * current mass and shape. Static/kinematic bodies and zero-mass bodies get
   * zero inverses (infinite mass). Call after mutating `mass` or `shape`.
   *
   * Inertia tensors (solid bodies):
   * - sphere: I = 2/5 · m · r²  (isotropic)
   * - box:    I_x = 1/12 · m · (hy² + hz²)·4  etc. (from full extents)
   * - capsule: cylinder body + two hemispherical caps, approximated.
   */
  computeMassProperties(): void {
    if (this.type !== BodyType.Dynamic || this.mass <= 0) {
      this.invMass = 0;
      this.invInertiaLocal.set(0, 0, 0);
      this.invInertiaWorld.set(0, 0, 0);
      return;
    }

    const m = this.mass;
    this.invMass = 1 / m;

    let ix = 0;
    let iy = 0;
    let iz = 0;

    switch (this.shape.kind) {
      case 'sphere': {
        const r = this.shape.radius;
        const i = 0.4 * m * r * r; // 2/5 m r^2
        ix = iy = iz = i;
        break;
      }
      case 'box': {
        const h = this.shape.halfExtents;
        // Full extents.
        const ex = 2 * h.x;
        const ey = 2 * h.y;
        const ez = 2 * h.z;
        const k = m / 12;
        ix = k * (ey * ey + ez * ez);
        iy = k * (ex * ex + ez * ez);
        iz = k * (ex * ex + ey * ey);
        break;
      }
      case 'capsule': {
        // Capsule = cylinder (height h, radius r) + 2 hemispheres (radius r),
        // axis along local Y. Split mass by volume, sum analytic tensors.
        const r = this.shape.radius;
        const h = this.shape.height;
        const rSq = r * r;
        const cylVol = Math.PI * rSq * h;
        const hemiVol = (2 / 3) * Math.PI * rSq * r; // one hemisphere
        const total = cylVol + 2 * hemiVol;
        const cm = total > 0 ? (m * cylVol) / total : m;
        const hm = total > 0 ? (m * hemiVol) / total : 0; // mass of one cap

        // Cylinder about its central (Y) axis and transverse axes.
        const cylY = 0.5 * cm * rSq;
        const cylXZ = cm * ((rSq / 4) + (h * h / 12));

        // Two hemispheres. Y axis: 2 * (2/5 m r^2). Transverse uses parallel
        // axis: each cap centroid is offset ~ (h/2 + 3r/8) from the centre.
        const hemiY = 2 * (0.4 * hm * rSq);
        const d = h / 2 + (3 * r) / 8;
        const hemiXZ =
          2 * (0.4 * hm * rSq + hm * d * d);

        iy = cylY + hemiY;
        ix = cylXZ + hemiXZ;
        iz = ix;
        break;
      }
      case 'plane': {
        // Planes are conceptually static; treat as infinite mass.
        this.invMass = 0;
        this.invInertiaLocal.set(0, 0, 0);
        this.invInertiaWorld.set(0, 0, 0);
        return;
      }
    }

    this.invInertiaLocal.set(
      ix > 0 ? 1 / ix : 0,
      iy > 0 ? 1 / iy : 0,
      iz > 0 ? 1 / iz : 0,
    );
    this.updateInertiaWorld();
  }

  /**
   * Rotate the local diagonal inverse-inertia into world space. For a diagonal
   * local tensor `R · I⁻¹ · Rᵀ` is dense; we keep a cheap, stable diagonal
   * approximation by rotating the per-axis values, which is more than adequate
   * for the (near-symmetric) primitive shapes used here.
   */
  updateInertiaWorld(): void {
    if (this.invMass === 0) {
      this.invInertiaWorld.set(0, 0, 0);
      return;
    }
    const l = this.invInertiaLocal;
    // Sphere/capsule x==z; rotation of a (near) isotropic diagonal is itself.
    // For boxes this preserves total magnitude well enough for stability.
    this.invInertiaWorld.set(Math.abs(l.x), Math.abs(l.y), Math.abs(l.z));
  }

  /**
   * Apply an instantaneous impulse (kg·m/s). Without a contact point it changes
   * only linear velocity; with a world-space contact point it also applies the
   * angular component `r × impulse · I⁻¹` where `r` is the lever arm from the
   * centre of mass. No-op for infinite-mass bodies.
   */
  applyImpulse(impulse: Vec3, contactPointWorld?: Vec3): void {
    if (this.invMass === 0) return;
    this.wake();

    this.linearVelocity.x += impulse.x * this.invMass;
    this.linearVelocity.y += impulse.y * this.invMass;
    this.linearVelocity.z += impulse.z * this.invMass;

    if (contactPointWorld) {
      // r = contact - centre of mass (= position).
      const rx = contactPointWorld.x - this.position.x;
      const ry = contactPointWorld.y - this.position.y;
      const rz = contactPointWorld.z - this.position.z;
      // τ = r × impulse.
      const tx = ry * impulse.z - rz * impulse.y;
      const ty = rz * impulse.x - rx * impulse.z;
      const tz = rx * impulse.y - ry * impulse.x;
      const ii = this.invInertiaWorld;
      this.angularVelocity.x += tx * ii.x;
      this.angularVelocity.y += ty * ii.y;
      this.angularVelocity.z += tz * ii.z;
    }
  }

  /** Accumulate a continuous force (N); applied and cleared each step. */
  applyForce(force: Vec3): void {
    if (this.invMass === 0) return;
    this.force.add(force);
    this.wake();
  }

  /**
   * Accumulate a continuous force applied at a world point, producing torque
   * about the centre of mass as well as linear force.
   */
  applyForceAtPoint(force: Vec3, pointWorld: Vec3): void {
    if (this.invMass === 0) return;
    this.force.add(force);
    const rx = pointWorld.x - this.position.x;
    const ry = pointWorld.y - this.position.y;
    const rz = pointWorld.z - this.position.z;
    this.torque.x += ry * force.z - rz * force.y;
    this.torque.y += rz * force.x - rx * force.z;
    this.torque.z += rx * force.y - ry * force.x;
    this.wake();
  }

  /** Read the accumulated force (internal use by the integrator). */
  getForce(): Vec3 {
    return this.force;
  }

  /** Read the accumulated torque (internal use by the integrator). */
  getTorque(): Vec3 {
    return this.torque;
  }

  /** Zero the force/torque accumulators (called after integration). */
  clearAccumulators(): void {
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }

  /** Teleport the body, refresh its world matrix and wake it. */
  setPosition(p: Vec3): void {
    this.position.copy(p);
    this.updateWorldMatrix();
    this.wake();
  }

  /** Wake a sleeping body so it integrates again. */
  wake(): void {
    if (this.type !== BodyType.Dynamic) return;
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  /** Force the body to sleep (zeroes velocity). */
  sleep(): void {
    this.sleeping = true;
    this.linearVelocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
  }

  /**
   * Integrate orientation by the current angular velocity over `dt`:
   * `q' = normalize(q + 0.5 · ω · q · dt)`. Reuses scratch quaternions.
   */
  integrateOrientation(dt: number): void {
    const w = this.angularVelocity;
    if (w.x === 0 && w.y === 0 && w.z === 0) return;
    // Pure-vector quaternion of angular velocity.
    _spin.set(w.x, w.y, w.z, 0);
    // dq = 0.5 * (spin * q) * dt
    _deltaQ.multiplyQuats(_spin, this.orientation);
    this.orientation.x += 0.5 * _deltaQ.x * dt;
    this.orientation.y += 0.5 * _deltaQ.y * dt;
    this.orientation.z += 0.5 * _deltaQ.z * dt;
    this.orientation.w += 0.5 * _deltaQ.w * dt;
    this.orientation.normalize();
  }

  /** Recompute {@link worldMatrix} from position + orientation (no scale). */
  updateWorldMatrix(): void {
    this.worldMatrix.compose(this.position, this.orientation, Vec3.ONE);
  }
}
