import type { EngineModule } from '@/core';
import { Vec3 } from '@/core/math';
import { RigidBody, BodyType } from './RigidBody';
import type { ColliderShape, RaycastHit } from './RigidBody';

/**
 * A single contact point produced by narrowphase. `normal` points from `a`
 * toward `b` (so pushing `a` along `-normal` and `b` along `+normal` separates
 * them). `penetration` is positive when the shapes overlap.
 */
interface Contact {
  a: RigidBody;
  b: RigidBody;
  /** World-space contact point (on the overlap region). */
  point: Vec3;
  /** Unit normal, from `a` to `b`. */
  normal: Vec3;
  /** Overlap depth (>= 0). */
  penetration: number;
  /** Accumulated normal impulse magnitude (for warm-feel clamping). */
  normalImpulse: number;
}

// ---- solver tuning ---------------------------------------------------------
/** Velocity-solver iterations. More = stiffer stacks, slower. */
const SOLVER_ITERATIONS = 10;
/** Penetration left uncorrected to avoid jitter (metres). */
const PENETRATION_SLOP = 0.005;
/** Fraction of remaining penetration corrected per step (Baumgarte). */
const BAUMGARTE = 0.2;
/** Relative normal speed below which restitution is suppressed (anti-buzz). */
const RESTITUTION_THRESHOLD = 1.0;
/** Linear speed² under which a body is a sleep candidate. */
const SLEEP_LINEAR_SQ = 0.01 * 0.01;
/** Angular speed² under which a body is a sleep candidate. */
const SLEEP_ANGULAR_SQ = 0.05 * 0.05;
/** Time a body must stay slow before sleeping (seconds). */
const SLEEP_TIME = 0.5;
/** Uniform spatial-hash cell size for broadphase (metres). */
const CELL_SIZE = 2.0;

// ---- scratch vectors (reused across the hot loop; never escape) ------------
const _tmpA = new Vec3();
const _tmpB = new Vec3();
const _tmpC = new Vec3();
const _rel = new Vec3();
const _ra = new Vec3();
const _rb = new Vec3();
const _va = new Vec3();
const _vb = new Vec3();
const _tangent = new Vec3();
const _impulse = new Vec3();
const _grav = new Vec3();
const _localMin = new Vec3();
const _localMax = new Vec3();

/**
 * Impulse-based 3D rigid body world.
 *
 * Each {@link fixedUpdate} runs the standard pipeline:
 * 1. **Integrate** dynamic bodies (semi-implicit Euler) with gravity, forces,
 *    damping and quaternion orientation integration.
 * 2. **Broadphase** — a uniform spatial hash buckets dynamic bodies by AABB to
 *    cheaply enumerate candidate pairs; every dynamic body is also paired with
 *    every static plane.
 * 3. **Narrowphase** — exact/robust tests for sphere, box, plane and capsule
 *    combinations produce contact manifolds (point, normal, penetration).
 * 4. **Resolution** — a sequential-impulse solver applies normal impulses with
 *    restitution plus Coulomb-clamped friction over several iterations, then a
 *    positional (Baumgarte + slop) correction removes residual penetration.
 *
 * The solver is tuned for stable resting stacks: a small penetration slop and a
 * restitution threshold prevent micro-bouncing and sinking.
 */
export class PhysicsWorld implements EngineModule {
  readonly name = 'physics';

  /** World gravity acceleration (m/s²). Default Earth-like, down -Y. */
  gravity: Vec3 = new Vec3(0, -9.81, 0);

  private readonly _bodies: RigidBody[] = [];
  /** Monotonic counter assigning each body a stable broadphase index. */
  private _nextIndex = 0;
  /** Spatial-hash buckets reused each step (cleared, not reallocated). */
  private readonly grid = new Map<number, RigidBody[]>();
  /** Candidate broadphase pairs for the current step. */
  private readonly pairs: { a: RigidBody; b: RigidBody }[] = [];
  /** Contact manifolds for the current step. */
  private readonly contacts: Contact[] = [];
  /** Pool of Contact objects to avoid per-step allocation. */
  private readonly contactPool: Contact[] = [];
  private contactCount = 0;

  /** All bodies in the world (read-only view). */
  get bodies(): ReadonlyArray<RigidBody> {
    return this._bodies;
  }

  /** Add a body and return it. */
  addBody(body: RigidBody): RigidBody {
    if (this._bodies.indexOf(body) === -1) {
      body.userIndex = this._nextIndex++;
      this._bodies.push(body);
    }
    return body;
  }

  /** Remove a body if present. */
  removeBody(body: RigidBody): void {
    const i = this._bodies.indexOf(body);
    if (i !== -1) this._bodies.splice(i, 1);
  }

  /** Remove every body from the world. */
  clear(): void {
    this._bodies.length = 0;
  }

  // =========================================================================
  // Step
  // =========================================================================

  /** Advance the simulation by one fixed timestep `dt` (seconds). */
  fixedUpdate(dt: number): void {
    if (dt <= 0) return;
    this.integrate(dt);
    this.broadphase();
    this.narrowphase();
    this.solve(dt);
    this.updateSleep(dt);
    // Refresh world matrices for every body (renderers read these).
    for (let i = 0; i < this._bodies.length; i++) {
      this._bodies[i].updateWorldMatrix();
    }
  }

  // ---- 1. integration -----------------------------------------------------

  private integrate(dt: number): void {
    const bodies = this._bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.type !== BodyType.Dynamic) {
        // Kinematic bodies integrate their (user-set) velocity but ignore
        // forces/gravity; static bodies do nothing.
        if (b.type === BodyType.Kinematic) {
          b.position.addScaled(b.linearVelocity, dt);
          b.integrateOrientation(dt);
        }
        b.clearAccumulators();
        continue;
      }
      if (b.sleeping) {
        b.clearAccumulators();
        continue;
      }

      // a = gravity*scale + F/m
      _grav.copy(this.gravity).scale(b.gravityScale);
      const f = b.getForce();
      b.linearVelocity.x += (_grav.x + f.x * b.invMass) * dt;
      b.linearVelocity.y += (_grav.y + f.y * b.invMass) * dt;
      b.linearVelocity.z += (_grav.z + f.z * b.invMass) * dt;

      // Angular acceleration from accumulated torque.
      const t = b.getTorque();
      const ii = b.invInertiaWorld;
      b.angularVelocity.x += t.x * ii.x * dt;
      b.angularVelocity.y += t.y * ii.y * dt;
      b.angularVelocity.z += t.z * ii.z * dt;

      // Exponential damping (frame-rate independent).
      const ld = Math.max(0, 1 - b.linearDamping * dt);
      const ad = Math.max(0, 1 - b.angularDamping * dt);
      b.linearVelocity.scale(ld);
      b.angularVelocity.scale(ad);

      // Semi-implicit Euler position + orientation update.
      b.position.addScaled(b.linearVelocity, dt);
      b.integrateOrientation(dt);
      b.updateInertiaWorld();

      b.clearAccumulators();
    }
  }

  // ---- 2. broadphase (uniform spatial hash + static planes) ---------------

  private broadphase(): void {
    const bodies = this._bodies;
    this.grid.clear();
    this.pairs.length = 0;

    // Collect plane bodies (handled separately — infinite extent).
    // Insert finite-AABB bodies into the spatial hash.
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.shape.kind === 'plane') continue;
      this.aabb(b, _localMin, _localMax);
      const x0 = Math.floor(_localMin.x / CELL_SIZE);
      const y0 = Math.floor(_localMin.y / CELL_SIZE);
      const z0 = Math.floor(_localMin.z / CELL_SIZE);
      const x1 = Math.floor(_localMax.x / CELL_SIZE);
      const y1 = Math.floor(_localMax.y / CELL_SIZE);
      const z1 = Math.floor(_localMax.z / CELL_SIZE);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          for (let z = z0; z <= z1; z++) {
            const key = this.hashCell(x, y, z);
            let bucket = this.grid.get(key);
            if (!bucket) {
              bucket = [];
              this.grid.set(key, bucket);
            }
            bucket.push(b);
          }
        }
      }
    }

    // Emit unique candidate pairs from shared cells.
    // Use a per-step seen set keyed by ordered body indices to dedupe.
    const seen = new Set<number>();
    for (const bucket of this.grid.values()) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];
          // Skip static-static / kinematic-kinematic etc. (no dynamic body).
          if (a.invMass === 0 && b.invMass === 0) continue;
          const ia = a.userIndex;
          const ib = b.userIndex;
          const lo = ia < ib ? ia : ib;
          const hi = ia < ib ? ib : ia;
          // Unique pairing: base exceeds every assigned index.
          const key = lo * this._nextIndex + hi;
          if (seen.has(key)) continue;
          seen.add(key);
          this.pairs.push({ a, b });
        }
      }
    }

    // Pair every dynamic/kinematic body with every static plane.
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i];
      if (p.shape.kind !== 'plane') continue;
      for (let j = 0; j < bodies.length; j++) {
        const b = bodies[j];
        if (b === p || b.shape.kind === 'plane') continue;
        if (b.invMass === 0) continue;
        this.pairs.push({ a: b, b: p });
      }
    }
  }

  /** Stable hash for an integer grid cell. */
  private hashCell(x: number, y: number, z: number): number {
    // Mix with large primes; force into 32-bit range.
    return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
  }

  /** World-space AABB of a (non-plane) body's shape into out min/max. */
  private aabb(b: RigidBody, outMin: Vec3, outMax: Vec3): void {
    const p = b.position;
    const s = b.shape;
    if (s.kind === 'sphere') {
      const r = s.radius;
      outMin.set(p.x - r, p.y - r, p.z - r);
      outMax.set(p.x + r, p.y + r, p.z + r);
    } else if (s.kind === 'capsule') {
      const r = s.radius;
      const half = s.height / 2 + r;
      outMin.set(p.x - r, p.y - half, p.z - r);
      outMax.set(p.x + r, p.y + half, p.z + r);
    } else if (s.kind === 'box') {
      // Conservative AABB of an oriented box: rotate half-extent vectors.
      const h = s.halfExtents;
      // Rotate each axis-aligned half extent by orientation, take abs sum.
      _tmpA.set(h.x, 0, 0).applyQuat(b.orientation);
      _tmpB.set(0, h.y, 0).applyQuat(b.orientation);
      _tmpC.set(0, 0, h.z).applyQuat(b.orientation);
      const ex = Math.abs(_tmpA.x) + Math.abs(_tmpB.x) + Math.abs(_tmpC.x);
      const ey = Math.abs(_tmpA.y) + Math.abs(_tmpB.y) + Math.abs(_tmpC.y);
      const ez = Math.abs(_tmpA.z) + Math.abs(_tmpB.z) + Math.abs(_tmpC.z);
      outMin.set(p.x - ex, p.y - ey, p.z - ez);
      outMax.set(p.x + ex, p.y + ey, p.z + ez);
    } else {
      // Plane — unbounded; callers skip planes here.
      outMin.set(-Infinity, -Infinity, -Infinity);
      outMax.set(Infinity, Infinity, Infinity);
    }
  }

  // ---- 3. narrowphase -----------------------------------------------------

  private narrowphase(): void {
    this.contactCount = 0;
    this.contacts.length = 0;
    for (let i = 0; i < this.pairs.length; i++) {
      const { a, b } = this.pairs[i];
      this.collide(a, b);
    }
  }

  /** Acquire a pooled, freshly-initialised Contact. */
  private acquireContact(): Contact {
    let c = this.contactPool[this.contactCount];
    if (!c) {
      c = {
        a: null as unknown as RigidBody,
        b: null as unknown as RigidBody,
        point: new Vec3(),
        normal: new Vec3(),
        penetration: 0,
        normalImpulse: 0,
      };
      this.contactPool[this.contactCount] = c;
    }
    this.contactCount++;
    c.normalImpulse = 0;
    return c;
  }

  /**
   * Dispatch the appropriate narrowphase test. Shapes are normalised so the
   * lower-priority shape becomes `a` where it simplifies the pair handling;
   * the produced normal always points from contact.a to contact.b.
   */
  private collide(a: RigidBody, b: RigidBody): void {
    const ka = a.shape.kind;
    const kb = b.shape.kind;

    // Order so plane is always `b` when present (plane is the reference).
    if (ka === 'plane' && kb !== 'plane') {
      this.collide(b, a);
      return;
    }

    if (ka === 'sphere' && kb === 'sphere') {
      this.sphereSphere(a, b);
    } else if (ka === 'sphere' && kb === 'box') {
      this.sphereBox(a, b, false);
    } else if (ka === 'box' && kb === 'sphere') {
      this.sphereBox(b, a, true);
    } else if (ka === 'box' && kb === 'box') {
      this.boxBox(a, b);
    } else if (ka === 'sphere' && kb === 'plane') {
      this.spherePlane(a, b);
    } else if (ka === 'box' && kb === 'plane') {
      this.boxPlane(a, b);
    } else if (ka === 'capsule' && kb === 'plane') {
      this.capsulePlane(a, b);
    } else if (ka === 'capsule' && kb === 'sphere') {
      this.capsuleSphere(a, b, false);
    } else if (ka === 'sphere' && kb === 'capsule') {
      this.capsuleSphere(b, a, true);
    } else if (ka === 'capsule' && kb === 'box') {
      this.capsuleBox(a, b, false);
    } else if (ka === 'box' && kb === 'capsule') {
      this.capsuleBox(b, a, true);
    } else if (ka === 'capsule' && kb === 'capsule') {
      this.capsuleCapsule(a, b);
    }
  }

  private emitContact(
    a: RigidBody,
    b: RigidBody,
    nx: number,
    ny: number,
    nz: number,
    px: number,
    py: number,
    pz: number,
    penetration: number,
  ): void {
    if (penetration <= 0) return;
    const c = this.acquireContact();
    c.a = a;
    c.b = b;
    c.normal.set(nx, ny, nz);
    c.point.set(px, py, pz);
    c.penetration = penetration;
    this.contacts.push(c);
  }

  // sphere vs sphere
  private sphereSphere(a: RigidBody, b: RigidBody): void {
    const ra = (a.shape as { radius: number }).radius;
    const rb = (b.shape as { radius: number }).radius;
    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const dz = b.position.z - a.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const rsum = ra + rb;
    if (distSq >= rsum * rsum) return;
    const dist = Math.sqrt(distSq);
    let nx: number, ny: number, nz: number;
    if (dist > 1e-8) {
      const inv = 1 / dist;
      nx = dx * inv;
      ny = dy * inv;
      nz = dz * inv;
    } else {
      nx = 0; ny = 1; nz = 0;
    }
    const pen = rsum - dist;
    // Contact point: on surface of a toward b.
    const px = a.position.x + nx * ra;
    const py = a.position.y + ny * ra;
    const pz = a.position.z + nz * ra;
    this.emitContact(a, b, nx, ny, nz, px, py, pz, pen);
  }

  // sphere vs plane (plane is b)
  private spherePlane(s: RigidBody, p: RigidBody): void {
    const r = (s.shape as { radius: number }).radius;
    const plane = p.shape as { normal: Vec3; constant: number };
    const n = plane.normal;
    // Signed distance from sphere centre to plane.
    const d = n.x * s.position.x + n.y * s.position.y + n.z * s.position.z - plane.constant;
    const pen = r - d;
    if (pen <= 0) return;
    // Normal from sphere (a) to plane (b) is -planeNormal (points into plane).
    const nx = -n.x, ny = -n.y, nz = -n.z;
    // Deepest point on sphere = centre - n*r projected to plane surface.
    const px = s.position.x - n.x * r;
    const py = s.position.y - n.y * r;
    const pz = s.position.z - n.z * r;
    this.emitContact(s, p, nx, ny, nz, px, py, pz, pen);
  }

  // sphere vs box. `s` sphere, `box` box. `swap` => emit with reversed normal.
  private sphereBox(s: RigidBody, box: RigidBody, swap: boolean): void {
    const r = (s.shape as { radius: number }).radius;
    const h = (box.shape as { halfExtents: Vec3 }).halfExtents;
    // Sphere centre in box local space.
    _tmpA.copy(s.position).sub(box.position);
    this.invRotate(box, _tmpA, _tmpB); // _tmpB = local sphere centre
    // Closest point on box (clamped) in local space.
    const cx = clamp(_tmpB.x, -h.x, h.x);
    const cy = clamp(_tmpB.y, -h.y, h.y);
    const cz = clamp(_tmpB.z, -h.z, h.z);
    const dx = _tmpB.x - cx;
    const dy = _tmpB.y - cy;
    const dz = _tmpB.z - cz;
    const distSq = dx * dx + dy * dy + dz * dz;

    let lnx: number, lny: number, lnz: number, pen: number;
    if (distSq > 1e-12) {
      const dist = Math.sqrt(distSq);
      if (dist >= r) return;
      const inv = 1 / dist;
      lnx = dx * inv; lny = dy * inv; lnz = dz * inv;
      pen = r - dist;
    } else {
      // Centre inside box: push out along the least-penetrated axis.
      const ox = h.x - Math.abs(_tmpB.x);
      const oy = h.y - Math.abs(_tmpB.y);
      const oz = h.z - Math.abs(_tmpB.z);
      if (ox <= oy && ox <= oz) {
        lnx = _tmpB.x < 0 ? -1 : 1; lny = 0; lnz = 0; pen = ox + r;
      } else if (oy <= oz) {
        lnx = 0; lny = _tmpB.y < 0 ? -1 : 1; lnz = 0; pen = oy + r;
      } else {
        lnx = 0; lny = 0; lnz = _tmpB.z < 0 ? -1 : 1; pen = oz + r;
      }
    }
    // Local contact point on box surface.
    const lpx = cx, lpy = cy, lpz = cz;
    // Transform normal + point back to world.
    _tmpC.set(lnx, lny, lnz).applyQuat(box.orientation); // world normal (sphere->box dir is -this)
    // Normal currently points from box surface toward sphere centre. For
    // contact (a=sphere, b=box) normal must point a->b = sphere->box = -_tmpC.
    let nx = -_tmpC.x, ny = -_tmpC.y, nz = -_tmpC.z;
    _tmpA.set(lpx, lpy, lpz).applyQuat(box.orientation).add(box.position);
    const px = _tmpA.x, py = _tmpA.y, pz = _tmpA.z;

    if (swap) {
      // caller passed (box, sphere): emit as a=box,b=sphere -> normal box->sphere = _tmpC
      this.emitContact(box, s, _tmpC.x, _tmpC.y, _tmpC.z, px, py, pz, pen);
    } else {
      this.emitContact(s, box, nx, ny, nz, px, py, pz, pen);
    }
  }

  // box vs plane (plane is b)
  private boxPlane(box: RigidBody, p: RigidBody): void {
    const h = (box.shape as { halfExtents: Vec3 }).halfExtents;
    const plane = p.shape as { normal: Vec3; constant: number };
    const n = plane.normal;
    // For each of 8 corners, find penetration; emit contacts for penetrating.
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          _tmpA.set(sx * h.x, sy * h.y, sz * h.z).applyQuat(box.orientation);
          const wx = box.position.x + _tmpA.x;
          const wy = box.position.y + _tmpA.y;
          const wz = box.position.z + _tmpA.z;
          const d = n.x * wx + n.y * wy + n.z * wz - plane.constant;
          if (d < 0) {
            // Normal a(box)->b(plane) is -planeNormal.
            this.emitContact(box, p, -n.x, -n.y, -n.z, wx, wy, wz, -d);
          }
        }
      }
    }
  }

  // box vs box via SAT (15 axes), single representative contact point.
  private boxBox(a: RigidBody, b: RigidBody): void {
    const ha = (a.shape as { halfExtents: Vec3 }).halfExtents;
    const hb = (b.shape as { halfExtents: Vec3 }).halfExtents;

    // Axis basis vectors for each box (world space).
    const ax = [_axisCache[0], _axisCache[1], _axisCache[2]];
    const bx = [_axisCache[3], _axisCache[4], _axisCache[5]];
    ax[0].set(1, 0, 0).applyQuat(a.orientation);
    ax[1].set(0, 1, 0).applyQuat(a.orientation);
    ax[2].set(0, 0, 1).applyQuat(a.orientation);
    bx[0].set(1, 0, 0).applyQuat(b.orientation);
    bx[1].set(0, 1, 0).applyQuat(b.orientation);
    bx[2].set(0, 0, 1).applyQuat(b.orientation);

    // Vector between centres.
    _rel.copy(b.position).sub(a.position);

    const haArr = [ha.x, ha.y, ha.z];
    const hbArr = [hb.x, hb.y, hb.z];

    let minOverlap = Infinity;
    let bestNx = 0, bestNy = 1, bestNz = 0;

    // Helper to test one axis; returns false if separated.
    const testAxis = (axisX: number, axisY: number, axisZ: number): boolean => {
      const len = Math.sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);
      if (len < 1e-6) return true; // degenerate (parallel edges) — skip
      const inv = 1 / len;
      const nx = axisX * inv, ny = axisY * inv, nz = axisZ * inv;
      // Projection radii.
      let ra = 0, rb = 0;
      for (let k = 0; k < 3; k++) {
        ra += haArr[k] * Math.abs(ax[k].x * nx + ax[k].y * ny + ax[k].z * nz);
        rb += hbArr[k] * Math.abs(bx[k].x * nx + bx[k].y * ny + bx[k].z * nz);
      }
      const dist = Math.abs(_rel.x * nx + _rel.y * ny + _rel.z * nz);
      const overlap = ra + rb - dist;
      if (overlap < 0) return false; // separating axis found
      if (overlap < minOverlap) {
        minOverlap = overlap;
        // Orient normal from a -> b.
        const sign = (_rel.x * nx + _rel.y * ny + _rel.z * nz) < 0 ? -1 : 1;
        bestNx = nx * sign; bestNy = ny * sign; bestNz = nz * sign;
      }
      return true;
    };

    // 6 face axes.
    for (let i = 0; i < 3; i++) {
      if (!testAxis(ax[i].x, ax[i].y, ax[i].z)) return;
    }
    for (let i = 0; i < 3; i++) {
      if (!testAxis(bx[i].x, bx[i].y, bx[i].z)) return;
    }
    // 9 edge-edge cross axes.
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const cx = ax[i].y * bx[j].z - ax[i].z * bx[j].y;
        const cy = ax[i].z * bx[j].x - ax[i].x * bx[j].z;
        const cz = ax[i].x * bx[j].y - ax[i].y * bx[j].x;
        if (!testAxis(cx, cy, cz)) return;
      }
    }

    // Overlapping. Approximate contact point: support point of b along -normal
    // averaged with support of a along +normal.
    this.boxSupport(a, bestNx, bestNy, bestNz, _tmpA);   // a's furthest toward b
    this.boxSupport(b, -bestNx, -bestNy, -bestNz, _tmpB); // b's furthest toward a
    const px = (_tmpA.x + _tmpB.x) * 0.5;
    const py = (_tmpA.y + _tmpB.y) * 0.5;
    const pz = (_tmpA.z + _tmpB.z) * 0.5;
    this.emitContact(a, b, bestNx, bestNy, bestNz, px, py, pz, minOverlap);
  }

  /** Furthest point of a box along world direction (nx,ny,nz) into `out`. */
  private boxSupport(box: RigidBody, nx: number, ny: number, nz: number, out: Vec3): void {
    const h = (box.shape as { halfExtents: Vec3 }).halfExtents;
    // Local direction.
    _tmpC.set(nx, ny, nz);
    this.invRotate(box, _tmpC, out); // out = local dir
    const lx = (out.x >= 0 ? 1 : -1) * h.x;
    const ly = (out.y >= 0 ? 1 : -1) * h.y;
    const lz = (out.z >= 0 ? 1 : -1) * h.z;
    out.set(lx, ly, lz).applyQuat(box.orientation).add(box.position);
  }

  // ---- capsule helpers ----------------------------------------------------

  /** World-space endpoints of a capsule's central segment into outA/outB. */
  private capsuleSegment(c: RigidBody, outA: Vec3, outB: Vec3): number {
    const cap = c.shape as { radius: number; height: number };
    const half = cap.height / 2;
    _tmpC.set(0, half, 0).applyQuat(c.orientation);
    outA.copy(c.position).add(_tmpC);   // top
    outB.copy(c.position).sub(_tmpC);   // bottom
    return cap.radius;
  }

  // capsule vs plane (plane is b): test both endpoints (sphere-plane each).
  private capsulePlane(c: RigidBody, p: RigidBody): void {
    const r = this.capsuleSegment(c, _va, _vb);
    const plane = p.shape as { normal: Vec3; constant: number };
    const n = plane.normal;
    for (let e = 0; e < 2; e++) {
      const pt = e === 0 ? _va : _vb;
      const d = n.x * pt.x + n.y * pt.y + n.z * pt.z - plane.constant;
      const pen = r - d;
      if (pen <= 0) continue;
      const px = pt.x - n.x * r;
      const py = pt.y - n.y * r;
      const pz = pt.z - n.z * r;
      this.emitContact(c, p, -n.x, -n.y, -n.z, px, py, pz, pen);
    }
  }

  // capsule vs sphere. cap=capsule, s=sphere. swap => reverse normal.
  private capsuleSphere(cap: RigidBody, s: RigidBody, swap: boolean): void {
    const r = this.capsuleSegment(cap, _va, _vb);
    const rs = (s.shape as { radius: number }).radius;
    // Closest point on segment to sphere centre.
    closestOnSegment(_va, _vb, s.position, _tmpA);
    const dx = s.position.x - _tmpA.x;
    const dy = s.position.y - _tmpA.y;
    const dz = s.position.z - _tmpA.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const rsum = r + rs;
    if (distSq >= rsum * rsum) return;
    const dist = Math.sqrt(distSq);
    let nx: number, ny: number, nz: number;
    if (dist > 1e-8) {
      const inv = 1 / dist;
      nx = dx * inv; ny = dy * inv; nz = dz * inv;
    } else {
      nx = 0; ny = 1; nz = 0;
    }
    const pen = rsum - dist;
    const px = _tmpA.x + nx * r;
    const py = _tmpA.y + ny * r;
    const pz = _tmpA.z + nz * r;
    if (swap) {
      this.emitContact(s, cap, -nx, -ny, -nz, px, py, pz, pen);
    } else {
      this.emitContact(cap, s, nx, ny, nz, px, py, pz, pen);
    }
  }

  // capsule vs box: approximate capsule by sphere at the closest segment point.
  private capsuleBox(cap: RigidBody, box: RigidBody, swap: boolean): void {
    const r = this.capsuleSegment(cap, _va, _vb);
    // Closest point on capsule segment to box centre (good approximation).
    closestOnSegment(_va, _vb, box.position, _tmpA);
    // Treat as sphere at _tmpA with radius r vs box.
    const h = (box.shape as { halfExtents: Vec3 }).halfExtents;
    _tmpB.copy(_tmpA).sub(box.position);
    this.invRotate(box, _tmpB, _tmpC); // local sphere centre
    const lx = clamp(_tmpC.x, -h.x, h.x);
    const ly = clamp(_tmpC.y, -h.y, h.y);
    const lz = clamp(_tmpC.z, -h.z, h.z);
    const dx = _tmpC.x - lx;
    const dy = _tmpC.y - ly;
    const dz = _tmpC.z - lz;
    const distSq = dx * dx + dy * dy + dz * dz;
    let lnx: number, lny: number, lnz: number, pen: number;
    if (distSq > 1e-12) {
      const dist = Math.sqrt(distSq);
      if (dist >= r) return;
      const inv = 1 / dist;
      lnx = dx * inv; lny = dy * inv; lnz = dz * inv;
      pen = r - dist;
    } else {
      const ox = h.x - Math.abs(_tmpC.x);
      const oy = h.y - Math.abs(_tmpC.y);
      const oz = h.z - Math.abs(_tmpC.z);
      if (ox <= oy && ox <= oz) { lnx = _tmpC.x < 0 ? -1 : 1; lny = 0; lnz = 0; pen = ox + r; }
      else if (oy <= oz) { lnx = 0; lny = _tmpC.y < 0 ? -1 : 1; lnz = 0; pen = oy + r; }
      else { lnx = 0; lny = 0; lnz = _tmpC.z < 0 ? -1 : 1; pen = oz + r; }
    }
    // World normal pointing box-surface -> capsule.
    _tmpB.set(lnx, lny, lnz).applyQuat(box.orientation);
    // contact point on box surface (world).
    _tmpC.set(lx, ly, lz).applyQuat(box.orientation).add(box.position);
    if (swap) {
      // a=box, b=capsule: normal box->capsule = _tmpB
      this.emitContact(box, cap, _tmpB.x, _tmpB.y, _tmpB.z, _tmpC.x, _tmpC.y, _tmpC.z, pen);
    } else {
      // a=capsule, b=box: normal capsule->box = -_tmpB
      this.emitContact(cap, box, -_tmpB.x, -_tmpB.y, -_tmpB.z, _tmpC.x, _tmpC.y, _tmpC.z, pen);
    }
  }

  // capsule vs capsule: closest points between two segments, sphere-sphere there.
  private capsuleCapsule(a: RigidBody, b: RigidBody): void {
    const ra = this.capsuleSegment(a, _va, _vb);
    const rb = this.capsuleSegment(b, _ra, _rb);
    closestSegmentSegment(_va, _vb, _ra, _rb, _tmpA, _tmpB);
    const dx = _tmpB.x - _tmpA.x;
    const dy = _tmpB.y - _tmpA.y;
    const dz = _tmpB.z - _tmpA.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const rsum = ra + rb;
    if (distSq >= rsum * rsum) return;
    const dist = Math.sqrt(distSq);
    let nx: number, ny: number, nz: number;
    if (dist > 1e-8) {
      const inv = 1 / dist;
      nx = dx * inv; ny = dy * inv; nz = dz * inv;
    } else {
      nx = 0; ny = 1; nz = 0;
    }
    const pen = rsum - dist;
    const px = _tmpA.x + nx * ra;
    const py = _tmpA.y + ny * ra;
    const pz = _tmpA.z + nz * ra;
    this.emitContact(a, b, nx, ny, nz, px, py, pz, pen);
  }

  // ---- 4. resolution (sequential impulse + positional correction) ---------

  private solve(dt: number): void {
    const contacts = this.contacts;
    if (contacts.length === 0) return;

    // Wake bodies that are in contact with a moving partner.
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      if (!c.a.sleeping && !c.b.sleeping) continue;
      const aMoving = !c.a.sleeping && c.a.linearVelocity.lengthSq() > SLEEP_LINEAR_SQ;
      const bMoving = !c.b.sleeping && c.b.linearVelocity.lengthSq() > SLEEP_LINEAR_SQ;
      if (aMoving) c.b.wake();
      if (bMoving) c.a.wake();
    }

    // Velocity solver iterations.
    for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
      for (let i = 0; i < contacts.length; i++) {
        this.resolveVelocity(contacts[i]);
      }
    }

    // Positional correction (Baumgarte with slop) — separate pass keeps the
    // velocity solver from fighting position changes.
    const invDt = dt > 0 ? 1 / dt : 0;
    void invDt;
    for (let i = 0; i < contacts.length; i++) {
      this.correctPosition(contacts[i]);
    }
  }

  private resolveVelocity(c: Contact): void {
    const a = c.a;
    const b = c.b;
    const n = c.normal;

    // Lever arms from each centre of mass to the contact point.
    _ra.copy(c.point).sub(a.position);
    _rb.copy(c.point).sub(b.position);

    // Relative velocity at contact = (vb + wb×rb) - (va + wa×ra).
    _va.crossVectors(a.angularVelocity, _ra).add(a.linearVelocity);
    _vb.crossVectors(b.angularVelocity, _rb).add(b.linearVelocity);
    _rel.copy(_vb).sub(_va);

    const relNormal = _rel.dot(n);
    // Already separating along the normal — no normal impulse needed.
    if (relNormal > 0) return;

    // Effective mass along the normal including angular terms.
    const rnA = this.angularTerm(a, _ra, n);
    const rnB = this.angularTerm(b, _rb, n);
    const invMassSum = a.invMass + b.invMass + rnA + rnB;
    if (invMassSum <= 0) return;

    // Restitution: suppressed for slow contacts to avoid resting jitter.
    const e =
      -relNormal > RESTITUTION_THRESHOLD
        ? Math.min(a.restitution, b.restitution)
        : 0;

    let jn = -(1 + e) * relNormal / invMassSum;

    // Accumulate & clamp so total normal impulse stays >= 0.
    const newImpulse = Math.max(c.normalImpulse + jn, 0);
    jn = newImpulse - c.normalImpulse;
    c.normalImpulse = newImpulse;

    _impulse.copy(n).scale(jn);
    this.applyContactImpulse(a, b, _impulse, _ra, _rb);

    // ---- friction (Coulomb) ----
    // Recompute relative velocity after normal impulse.
    _va.crossVectors(a.angularVelocity, _ra).add(a.linearVelocity);
    _vb.crossVectors(b.angularVelocity, _rb).add(b.linearVelocity);
    _rel.copy(_vb).sub(_va);

    // Tangent = relVel minus its normal component.
    const vn = _rel.dot(n);
    _tangent.copy(_rel).addScaled(n, -vn);
    const tLen = _tangent.length();
    if (tLen < 1e-8) return;
    _tangent.scale(1 / tLen);

    const rtA = this.angularTerm(a, _ra, _tangent);
    const rtB = this.angularTerm(b, _rb, _tangent);
    const invMassTan = a.invMass + b.invMass + rtA + rtB;
    if (invMassTan <= 0) return;

    let jt = -_rel.dot(_tangent) / invMassTan;
    const mu = Math.sqrt(a.friction * b.friction);
    const maxFriction = mu * c.normalImpulse;
    jt = clamp(jt, -maxFriction, maxFriction);

    _impulse.copy(_tangent).scale(jt);
    this.applyContactImpulse(a, b, _impulse, _ra, _rb);
  }

  /** rₓ contribution to effective mass: (I⁻¹(r×n))×r · n. */
  private angularTerm(body: RigidBody, r: Vec3, n: Vec3): number {
    if (body.invMass === 0) return 0;
    // rxn = r × n
    const cx = r.y * n.z - r.z * n.y;
    const cy = r.z * n.x - r.x * n.z;
    const cz = r.x * n.y - r.y * n.x;
    const ii = body.invInertiaWorld;
    // I⁻¹ * (r×n)
    const ix = cx * ii.x;
    const iy = cy * ii.y;
    const iz = cz * ii.z;
    // (I⁻¹(r×n)) × r
    const dx = iy * r.z - iz * r.y;
    const dy = iz * r.x - ix * r.z;
    const dz = ix * r.y - iy * r.x;
    // · n
    return dx * n.x + dy * n.y + dz * n.z;
  }

  /** Apply +impulse to b and -impulse to a at their lever arms. */
  private applyContactImpulse(
    a: RigidBody,
    b: RigidBody,
    impulse: Vec3,
    ra: Vec3,
    rb: Vec3,
  ): void {
    if (a.invMass > 0) {
      a.linearVelocity.x -= impulse.x * a.invMass;
      a.linearVelocity.y -= impulse.y * a.invMass;
      a.linearVelocity.z -= impulse.z * a.invMass;
      const ii = a.invInertiaWorld;
      const tx = ra.y * impulse.z - ra.z * impulse.y;
      const ty = ra.z * impulse.x - ra.x * impulse.z;
      const tz = ra.x * impulse.y - ra.y * impulse.x;
      a.angularVelocity.x -= tx * ii.x;
      a.angularVelocity.y -= ty * ii.y;
      a.angularVelocity.z -= tz * ii.z;
    }
    if (b.invMass > 0) {
      b.linearVelocity.x += impulse.x * b.invMass;
      b.linearVelocity.y += impulse.y * b.invMass;
      b.linearVelocity.z += impulse.z * b.invMass;
      const ii = b.invInertiaWorld;
      const tx = rb.y * impulse.z - rb.z * impulse.y;
      const ty = rb.z * impulse.x - rb.x * impulse.z;
      const tz = rb.x * impulse.y - rb.y * impulse.x;
      b.angularVelocity.x += tx * ii.x;
      b.angularVelocity.y += ty * ii.y;
      b.angularVelocity.z += tz * ii.z;
    }
  }

  private correctPosition(c: Contact): void {
    const a = c.a;
    const b = c.b;
    const corr = Math.max(c.penetration - PENETRATION_SLOP, 0) * BAUMGARTE;
    if (corr <= 0) return;
    const invMassSum = a.invMass + b.invMass;
    if (invMassSum <= 0) return;
    const move = corr / invMassSum;
    const n = c.normal;
    // a moves opposite the normal, b along it, proportional to inverse mass.
    if (a.invMass > 0) {
      a.position.x -= n.x * move * a.invMass;
      a.position.y -= n.y * move * a.invMass;
      a.position.z -= n.z * move * a.invMass;
    }
    if (b.invMass > 0) {
      b.position.x += n.x * move * b.invMass;
      b.position.y += n.y * move * b.invMass;
      b.position.z += n.z * move * b.invMass;
    }
  }

  // ---- sleeping -----------------------------------------------------------

  private updateSleep(dt: number): void {
    const bodies = this._bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.type !== BodyType.Dynamic || b.sleeping) continue;
      const slow =
        b.linearVelocity.lengthSq() < SLEEP_LINEAR_SQ &&
        b.angularVelocity.lengthSq() < SLEEP_ANGULAR_SQ;
      if (slow) {
        b.sleepTimer += dt;
        if (b.sleepTimer >= SLEEP_TIME) b.sleep();
      } else {
        b.sleepTimer = 0;
      }
    }
  }

  // =========================================================================
  // Raycast
  // =========================================================================

  /**
   * Cast a ray from `origin` along `dir` (need not be unit) up to `maxDist`.
   * Tests every body and returns the nearest {@link RaycastHit}, or `null`.
   */
  raycast(origin: Vec3, dir: Vec3, maxDist = Infinity): RaycastHit | null {
    // Normalise direction.
    const dl = dir.length();
    if (dl < 1e-9) return null;
    const dx = dir.x / dl;
    const dy = dir.y / dl;
    const dz = dir.z / dl;

    let bestT = maxDist;
    let bestBody: RigidBody | null = null;
    const bestNormal = new Vec3();
    const bestPoint = new Vec3();

    for (let i = 0; i < this._bodies.length; i++) {
      const body = this._bodies[i];
      const t = this.raycastBody(body, origin, dx, dy, dz, _tmpA, _tmpB);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestBody = body;
        bestNormal.copy(_tmpA);
        bestPoint.copy(_tmpB);
      }
    }

    if (!bestBody) return null;
    return { body: bestBody, point: bestPoint, normal: bestNormal, distance: bestT };
  }

  /**
   * Ray vs single body. Returns hit distance (>=0) or -1. Writes the surface
   * normal into `outN` and the world hit point into `outP`.
   */
  private raycastBody(
    body: RigidBody,
    o: Vec3,
    dx: number,
    dy: number,
    dz: number,
    outN: Vec3,
    outP: Vec3,
  ): number {
    const s = body.shape;
    if (s.kind === 'sphere') {
      return raySphere(o, dx, dy, dz, body.position, s.radius, outN, outP);
    } else if (s.kind === 'plane') {
      return rayPlane(o, dx, dy, dz, s.normal, s.constant, outN, outP);
    } else if (s.kind === 'box') {
      return this.rayBox(body, o, dx, dy, dz, outN, outP);
    } else {
      // capsule: ray vs the two endpoint spheres + cylinder (approx via spheres
      // along the segment closest point — robust enough for picking).
      const r = this.capsuleSegment(body, _ra, _rb);
      // Project: treat as cylinder by sampling closest sphere. Use endpoints
      // and midpoint spheres for a stable approximate hit.
      let best = -1;
      let bestN0 = 0, bestN1 = 0, bestN2 = 0;
      let bestP0 = 0, bestP1 = 0, bestP2 = 0;
      for (let k = 0; k <= 4; k++) {
        const tt = k / 4;
        _tmpC.lerpVectors(_ra, _rb, tt);
        const hit = raySphere(o, dx, dy, dz, _tmpC, r, outN, outP);
        if (hit >= 0 && (best < 0 || hit < best)) {
          best = hit;
          bestN0 = outN.x; bestN1 = outN.y; bestN2 = outN.z;
          bestP0 = outP.x; bestP1 = outP.y; bestP2 = outP.z;
        }
      }
      if (best >= 0) {
        outN.set(bestN0, bestN1, bestN2);
        outP.set(bestP0, bestP1, bestP2);
      }
      return best;
    }
  }

  /** Ray vs oriented box (slab test in box-local space). */
  private rayBox(
    box: RigidBody,
    o: Vec3,
    dx: number,
    dy: number,
    dz: number,
    outN: Vec3,
    outP: Vec3,
  ): number {
    const h = (box.shape as { halfExtents: Vec3 }).halfExtents;
    // Transform ray to box-local space.
    _tmpA.copy(o).sub(box.position);
    this.invRotate(box, _tmpA, _localMin); // local origin
    _tmpB.set(dx, dy, dz);
    this.invRotate(box, _tmpB, _localMax); // local dir

    const ox = _localMin.x, oy = _localMin.y, oz = _localMin.z;
    const ldx = _localMax.x, ldy = _localMax.y, ldz = _localMax.z;

    let tmin = -Infinity;
    let tmax = Infinity;
    let axis = 0;
    let sign = 1;

    // Per-axis slab test, tracking which face gives tmin.
    const lo = [-h.x, -h.y, -h.z];
    const hi = [h.x, h.y, h.z];
    const od = [ox, oy, oz];
    const dd = [ldx, ldy, ldz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dd[i]) < 1e-9) {
        if (od[i] < lo[i] || od[i] > hi[i]) return -1;
      } else {
        const inv = 1 / dd[i];
        let t1 = (lo[i] - od[i]) * inv;
        let t2 = (hi[i] - od[i]) * inv;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1; t1 = t2; t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = i;
          sign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    if (tmax < 0) return -1;
    const t = tmin >= 0 ? tmin : tmax;
    if (t < 0) return -1;

    // Local normal.
    _tmpC.set(0, 0, 0);
    if (axis === 0) _tmpC.x = sign;
    else if (axis === 1) _tmpC.y = sign;
    else _tmpC.z = sign;
    // World normal + point.
    outN.copy(_tmpC).applyQuat(box.orientation);
    outP.set(o.x + dx * t, o.y + dy * t, o.z + dz * t);
    return t;
  }

  // ---- shared helpers -----------------------------------------------------

  /** Rotate a world-space vector into a body's local frame (out = q⁻¹ · v). */
  private invRotate(body: RigidBody, v: Vec3, out: Vec3): void {
    // Conjugate rotation: build inverse quat once via applyQuat with conjugate.
    const q = body.orientation;
    const vx = v.x, vy = v.y, vz = v.z;
    const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    out.x = vx + qw * tx + (qy * tz - qz * ty);
    out.y = vy + qw * ty + (qz * tx - qx * tz);
    out.z = vz + qw * tz + (qx * ty - qy * tx);
  }
}

// ===========================================================================
// Free helper functions (no allocation; operate on primitives / out params)
// ===========================================================================

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Scratch axes for box-box SAT (6 reused vectors). */
const _axisCache = [
  new Vec3(), new Vec3(), new Vec3(),
  new Vec3(), new Vec3(), new Vec3(),
];

/** Closest point on segment [a,b] to point p, written to `out`. */
function closestOnSegment(a: Vec3, b: Vec3, p: Vec3, out: Vec3): void {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 0 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}

/**
 * Closest points between segments [p1,q1] and [p2,q2], written to outC1/outC2.
 * Standard Ericson (Real-Time Collision Detection) clamped solution.
 */
function closestSegmentSegment(
  p1: Vec3, q1: Vec3,
  p2: Vec3, q2: Vec3,
  outC1: Vec3, outC2: Vec3,
): void {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s: number;
  let t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  outC1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  outC2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
}

/** Ray vs sphere; returns nearest non-negative t or -1. Writes normal+point. */
function raySphere(
  o: Vec3, dx: number, dy: number, dz: number,
  center: Vec3, radius: number,
  outN: Vec3, outP: Vec3,
): number {
  const ocx = o.x - center.x;
  const ocy = o.y - center.y;
  const ocz = o.z - center.z;
  const b = ocx * dx + ocy * dy + ocz * dz;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  // Origin outside and pointing away.
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq; // origin inside sphere
  if (t < 0) return -1;
  outP.set(o.x + dx * t, o.y + dy * t, o.z + dz * t);
  outN.set(outP.x - center.x, outP.y - center.y, outP.z - center.z).normalize();
  return t;
}

/** Ray vs infinite plane (dot(n,x)=constant). Returns t or -1. */
function rayPlane(
  o: Vec3, dx: number, dy: number, dz: number,
  n: Vec3, constant: number,
  outN: Vec3, outP: Vec3,
): number {
  const denom = n.x * dx + n.y * dy + n.z * dz;
  if (Math.abs(denom) < 1e-9) return -1; // parallel
  const t = (constant - (n.x * o.x + n.y * o.y + n.z * o.z)) / denom;
  if (t < 0) return -1;
  outP.set(o.x + dx * t, o.y + dy * t, o.z + dz * t);
  // Normal faces the ray.
  if (denom > 0) outN.set(-n.x, -n.y, -n.z);
  else outN.set(n.x, n.y, n.z);
  return t;
}
