import { Vec3, Color } from '@/core/math';
import { Material, Primitives } from '@/render';
import { MeshRenderer, Transform } from '@/scene';
import type { EditorContext } from '@editor/core';
import type { EditorObject } from '@editor/core';
import type { GizmoMode } from '@editor/core';

/** World-space unit axes, indexed 0..2 = X/Y/Z. */
const AXES: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(0, 1, 0),
  new Vec3(0, 0, 1),
];

/** Bright emissive handle colors per axis (X red, Y green, Z blue). */
const AXIS_COLOR: readonly [number, number, number][] = [
  [0.95, 0.22, 0.22],
  [0.3, 0.9, 0.35],
  [0.3, 0.55, 1.0],
];

// Scratch vectors reused every frame / drag step (no per-call allocation).
const _center = new Vec3();
const _axisW = new Vec3();
const _p = new Vec3();
const _q = new Vec3();
const _w0 = new Vec3();

/** Result of {@link closestPointsRayLine}: parameters along ray and along the axis line. */
interface ClosestResult {
  s: number; // param along axis line (point = center + axis*s)
  t: number; // param along ray (point = origin + dir*t)
  dist: number; // distance between the two closest points
}

/**
 * A screen-constant transform gizmo: three emissive axis handles (thin boxes
 * along +X/+Y/+Z) rendered as raw engine meshes that live OUTSIDE the editor
 * scene (never serialized, never returned by {@link EditorScene.raycastSelect}).
 *
 * The {@link Viewport} owns one Gizmo, positions/scales it each frame onto the
 * current selection, and forwards pointer events: {@link beginDrag} ray-picks an
 * axis and (if grabbed) starts a single-axis translate/scale/rotate drag,
 * {@link updateDrag} applies the constrained delta, {@link endDrag} releases it.
 */
export class Gizmo {
  private readonly ctx: EditorContext;

  /** One Transform per axis handle (X, Y, Z). */
  private readonly handles: Transform[] = [];
  private readonly materials: Material[] = [];

  /** Whether the gizmo is logically visible (selection present and edit mode). */
  private visible = false;

  /** Length of an axis handle in world units (recomputed from camera distance). */
  private handleLen = 1;

  // Active-drag state.
  private dragging = false;
  private dragAxis = -1;
  /** Param along the chosen axis at grab time (translate/scale baseline). */
  private dragStartS = 0;
  /** Selection values captured at grab start, restored-from incrementally. */
  private readonly startPos = new Vec3();
  private readonly startScale = new Vec3();
  private readonly startEuler: [number, number, number] = [0, 0, 0];

  constructor(ctx: EditorContext) {
    this.ctx = ctx;
    this.build();

    ctx.events.on('selection', () => this.refreshVisibility());
    ctx.events.on('gizmo', () => this.refreshVisibility());
    ctx.events.on('mode', () => this.refreshVisibility());
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /** Build the three axis-handle entities as unlit-looking emissive boxes. */
  private build(): void {
    const world = this.ctx.engine.world;
    for (let i = 0; i < 3; i++) {
      const c = AXIS_COLOR[i];
      const mat = new Material({
        albedo: new Color(c[0] * 0.2, c[1] * 0.2, c[2] * 0.2),
        emissive: new Color(c[0], c[1], c[2]),
        emissiveIntensity: 2.4,
        metallic: 0,
        roughness: 1,
      });
      // A unit-cube mesh; per-axis non-uniform scale turns it into a thin bar.
      const mesh = this.ctx.renderer.createMesh(Primitives.box(1, 1, 1));
      const mr = new MeshRenderer(mesh, mat);
      mr.castShadow = false;
      mr.receiveShadow = false;

      const e = world.createEntity();
      const t = world.add(e, new Transform());
      t.scale.set(0, 0, 0); // start hidden
      world.add(e, mr);

      this.handles.push(t);
      this.materials.push(mat);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update (driven by the Viewport's engine module)
  // ---------------------------------------------------------------------------

  /**
   * Reposition and rescale the handles onto the selection at a constant screen
   * size. Called every frame; hides the handles (scale 0) when not visible.
   */
  update(): void {
    const sel = this.ctx.selection;
    if (!this.visible || !sel) {
      this.hideHandles();
      return;
    }

    sel.transform.updateMatrix();
    sel.transform.worldMatrix.getPosition(_center);

    // Screen-constant size: proportional to camera distance to the selection.
    const dist = this.ctx.camera.position.distanceTo(_center);
    this.handleLen = Math.max(0.4, dist * 0.12);
    const len = this.handleLen;
    const thick = len * 0.06;

    for (let i = 0; i < 3; i++) {
      const t = this.handles[i];
      // Place the bar's CENTER at center + axis*(len/2) so it grows from origin.
      t.position.set(
        _center.x + AXES[i].x * (len * 0.5),
        _center.y + AXES[i].y * (len * 0.5),
        _center.z + AXES[i].z * (len * 0.5),
      );
      // Long along its own axis, thin on the other two.
      t.scale.set(
        i === 0 ? len : thick,
        i === 1 ? len : thick,
        i === 2 ? len : thick,
      );
      // Highlight the axis currently being dragged.
      this.materials[i].emissiveIntensity = this.dragging && this.dragAxis === i ? 4.5 : 2.4;
    }
  }

  /** Collapse all handles to zero scale (visually removes them). */
  private hideHandles(): void {
    for (const t of this.handles) t.scale.set(0, 0, 0);
  }

  /** Recompute logical visibility from selection + editor mode. */
  private refreshVisibility(): void {
    this.visible = this.ctx.selection !== null && this.ctx.mode === 'edit';
    if (!this.visible) {
      this.endDrag();
      this.hideHandles();
    } else {
      this.update();
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer interaction
  // ---------------------------------------------------------------------------

  /** Whether a drag is currently in progress (Viewport suppresses orbit/select). */
  get isDragging(): boolean {
    return this.dragging;
  }

  /**
   * Try to grab an axis from a pointer ray. Picks the axis whose infinite line is
   * closest to the ray within a screen-proportional threshold and lies within the
   * handle's length. Returns true if a drag began.
   */
  beginDrag(origin: Vec3, dir: Vec3): boolean {
    const sel = this.ctx.selection;
    if (!this.visible || !sel) return false;

    sel.transform.updateMatrix();
    sel.transform.worldMatrix.getPosition(_center);

    const len = this.handleLen;
    const threshold = len * 0.18; // grab tolerance in world units

    let bestAxis = -1;
    let bestDist = threshold;
    let bestS = 0;

    for (let i = 0; i < 3; i++) {
      _axisW.copy(AXES[i]);
      const r = closestPointsRayLine(origin, dir, _center, _axisW);
      // Must be in front of the camera and within the visible handle span.
      if (r.t <= 0) continue;
      if (r.s < -threshold || r.s > len + threshold) continue;
      if (r.dist < bestDist) {
        bestDist = r.dist;
        bestAxis = i;
        bestS = r.s;
      }
    }

    if (bestAxis < 0) return false;

    this.dragging = true;
    this.dragAxis = bestAxis;
    this.dragStartS = bestS;
    this.startPos.copy(sel.transform.position);
    this.startScale.copy(sel.transform.scale);
    this.startEuler[0] = sel.rotationEuler[0];
    this.startEuler[1] = sel.rotationEuler[1];
    this.startEuler[2] = sel.rotationEuler[2];
    return true;
  }

  /**
   * Apply the constrained delta for the in-progress drag from the current ray.
   * The delta is measured along the chosen axis (translate/scale) or mapped to a
   * rotation angle (rotate), always relative to the grab-time baseline.
   */
  updateDrag(origin: Vec3, dir: Vec3): void {
    if (!this.dragging) return;
    const sel = this.ctx.selection;
    if (!sel) return;

    const axis = this.dragAxis;
    _axisW.copy(AXES[axis]);
    const r = closestPointsRayLine(origin, dir, _center, _axisW);
    const delta = r.s - this.dragStartS;

    switch (this.ctx.gizmoMode) {
      case 'translate':
        sel.transform.position.set(
          this.startPos.x + AXES[axis].x * delta,
          this.startPos.y + AXES[axis].y * delta,
          this.startPos.z + AXES[axis].z * delta,
        );
        break;
      case 'scale': {
        const sx = axis === 0 ? this.startScale.x + delta : this.startScale.x;
        const sy = axis === 1 ? this.startScale.y + delta : this.startScale.y;
        const sz = axis === 2 ? this.startScale.z + delta : this.startScale.z;
        sel.transform.scale.set(
          Math.max(0.05, sx),
          Math.max(0.05, sy),
          Math.max(0.05, sz),
        );
        break;
      }
      case 'rotate': {
        // Map world-units dragged along the axis to degrees (screen-consistent).
        const k = 40 / Math.max(0.001, this.handleLen);
        sel.rotationEuler[0] = this.startEuler[0];
        sel.rotationEuler[1] = this.startEuler[1];
        sel.rotationEuler[2] = this.startEuler[2];
        sel.rotationEuler[axis] = this.startEuler[axis] + delta * k;
        break;
      }
    }

    this.ctx.notifyTransform(sel);
  }

  /** End any in-progress drag. */
  endDrag(): void {
    this.dragging = false;
    this.dragAxis = -1;
  }
}

/**
 * Closest points between a ray (`origin` + t·`dir`, t≥0) and an infinite line
 * (`lineO` + s·`lineDir`). `dir` and `lineDir` are assumed unit-length. Returns
 * the line param `s`, ray param `t`, and the distance between the closest points.
 *
 * Standard segment/segment closest-point reduction (Ericson, Real-Time Collision
 * Detection): solves the 2×2 system for the perpendicular connection.
 */
function closestPointsRayLine(origin: Vec3, dir: Vec3, lineO: Vec3, lineDir: Vec3): ClosestResult {
  _p.copy(dir); // ray direction (d1)
  _q.copy(lineDir); // line direction (d2)
  Vec3.sub(_w0, origin, lineO); // r = origin - lineO

  const a = _p.dot(_p); // = 1 (unit)
  const b = _p.dot(_q);
  const c = _q.dot(_q); // = 1 (unit)
  const d = _p.dot(_w0);
  const e = _q.dot(_w0);

  const denom = a * c - b * b; // >= 0
  let t: number;
  let s: number;
  if (denom > 1e-8) {
    t = (b * e - c * d) / denom;
  } else {
    t = 0; // parallel: pin the ray param
  }
  // s along the (infinite) axis line for the chosen ray param.
  s = (b * t + e) / c;

  // Distance between the two closest points.
  const cx = origin.x + dir.x * t - (lineO.x + lineDir.x * s);
  const cy = origin.y + dir.y * t - (lineO.y + lineDir.y * s);
  const cz = origin.z + dir.z * t - (lineO.z + lineDir.z * s);
  const dist = Math.sqrt(cx * cx + cy * cy + cz * cz);

  return { s, t, dist };
}
