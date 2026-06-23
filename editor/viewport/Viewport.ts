import { Vec3, Color, MathUtils } from '@/core/math';
import type { EngineModule } from '@/core';
import { Material, Primitives } from '@/render';
import { MeshRenderer, Transform } from '@/scene';
import type { EditorContext } from '@editor/core';
import { Gizmo } from './Gizmo';

const { clamp } = MathUtils;

const HALF_PI_CLAMP = 1.5; // pitch clamp (±), just under 90°
const ORBIT_SPEED = 0.005;
const PAN_SCALE = 0.0015;
const DOLLY_RATE = 0.001;
const MIN_DIST = 2;
const MAX_DIST = 120;
const CLICK_PX = 5; // press→release under this many px counts as a click

// Scratch vectors reused across pointer/frame work (no per-event allocation).
const _dir = new Vec3();
const _right = new Vec3();
const _up = new Vec3();
const _rayO = new Vec3();
const _rayD = new Vec3();

/**
 * Owns ALL pointer interaction in the 3D view: an orbit/pan/dolly editor camera,
 * a non-selectable ground grid + axes, click-to-select (edit mode), and a
 * transform {@link Gizmo} driven from drag handles. Wires DOM listeners directly
 * on {@link EditorContext.canvas} (and `window` for move/up) — it does NOT use
 * the engine Input module.
 *
 * A registered engine module (`'viewport'`) advances the gizmo each frame so it
 * tracks the selection; the engine loop is already running.
 */
export class Viewport {
  private readonly ctx: EditorContext;
  private readonly gizmo: Gizmo;

  // ---- Orbit camera state ----
  private readonly pivot = new Vec3(0, 2, 0);
  private distance = 14;
  private yaw = -Math.PI * 0.25;
  // Negative pitch puts the camera ABOVE the pivot looking down (with the
  // `pivot - dir*distance` convention below, sin(pitch) drives camera height).
  private pitch = -0.5;

  // ---- Pointer/drag bookkeeping ----
  private activeButton = -1; // 0=LMB,1=MMB,2=RMB while a drag is live
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private moved = 0; // accumulated movement since press (for click test)
  private gizmoDrag = false; // a gizmo axis grab owns this drag

  /** Grid/axes Transforms kept referenced so they're never GC'd or selected. */
  private readonly decor: Transform[] = [];

  private readonly vpEl: HTMLElement | null;
  private readonly vpModeEl: HTMLElement | null;

  constructor(ctx: EditorContext) {
    this.ctx = ctx;
    this.gizmo = new Gizmo(ctx);
    this.vpEl = document.getElementById('viewport');
    this.vpModeEl = document.getElementById('vpMode');

    this.buildGrid();
    this.updateCamera();

    this.attachPointerListeners();
    this.registerModule();

    ctx.events.on('mode', (m) => this.onModeChanged(m as 'edit' | 'play'));
  }

  // ---------------------------------------------------------------------------
  // Camera (orbit / pan / dolly)
  // ---------------------------------------------------------------------------

  /**
   * Recompute the camera from pivot/distance/yaw/pitch and aim it at the pivot.
   * `dir` is the unit vector from pivot toward the camera, so the camera sits at
   * `pivot − dir*distance` and looks back at the pivot.
   */
  private updateCamera(): void {
    const cp = Math.cos(this.pitch);
    _dir.set(cp * Math.cos(this.yaw), Math.sin(this.pitch), cp * Math.sin(this.yaw));
    const cam = this.ctx.camera;
    cam.position.set(
      this.pivot.x - _dir.x * this.distance,
      this.pivot.y - _dir.y * this.distance,
      this.pivot.z - _dir.z * this.distance,
    );
    cam.lookAt(this.pivot);
  }

  /** LMB drag: orbit yaw/pitch (pitch clamped to avoid gimbal flip at the poles). */
  private orbit(dx: number, dy: number): void {
    this.yaw -= dx * ORBIT_SPEED;
    // Drag down → camera lowers toward the horizon (pitch toward 0/positive);
    // drag up → camera rises overhead (pitch more negative). Feels natural with
    // the above-looking-down default.
    this.pitch += dy * ORBIT_SPEED;
    this.pitch = clamp(this.pitch, -HALF_PI_CLAMP, HALF_PI_CLAMP);
    this.updateCamera();
  }

  /**
   * RMB/MMB drag: pan the pivot along the camera's right/up axes, scaled by
   * distance so the apparent pan speed is consistent at any zoom level.
   */
  private pan(dx: number, dy: number): void {
    const cam = this.ctx.camera;
    cam.getRight(_right);
    _up.set(0, 1, 0).applyQuat(cam.rotation).normalize();
    const k = this.distance * PAN_SCALE;
    // Drag right → world moves left under the cursor, so pivot follows -right*dx.
    this.pivot.x += (-_right.x * dx + _up.x * dy) * k;
    this.pivot.y += (-_right.y * dx + _up.y * dy) * k;
    this.pivot.z += (-_right.z * dx + _up.z * dy) * k;
    this.updateCamera();
  }

  /** Wheel: exponential dolly so each notch scales distance by a fixed ratio. */
  private dolly(deltaY: number): void {
    this.distance *= Math.exp(deltaY * DOLLY_RATE);
    this.distance = clamp(this.distance, MIN_DIST, MAX_DIST);
    this.updateCamera();
  }

  // ---------------------------------------------------------------------------
  // Ground grid + axes (engine geometry; NOT EditorObjects)
  // ---------------------------------------------------------------------------

  /**
   * Build a faint ground plane plus thin emissive bars for the X (red) and Z
   * (blue) axes through the origin. These are raw engine entities outside
   * {@link EditorScene}: never serialized, never click-selectable, no shadows.
   */
  private buildGrid(): void {
    // Faint dark ground plane.
    this.addDecor(
      Primitives.plane(1, 1, 1),
      new Material({
        albedo: new Color(0.1, 0.11, 0.14),
        emissive: new Color(0.05, 0.055, 0.07),
        emissiveIntensity: 1,
        roughness: 1,
      }),
      (t) => {
        t.position.set(0, -0.001, 0); // just below origin to avoid z-fighting
        t.scale.set(120, 1, 120);
      },
    );

    // Grid lines: thin emissive bars on a regular spacing along X and Z.
    const gridMat = new Material({
      albedo: new Color(0.16, 0.17, 0.2),
      emissive: new Color(0.18, 0.2, 0.24),
      emissiveIntensity: 1,
      roughness: 1,
    });
    const span = 60;
    const step = 2;
    const lineThick = 0.02;
    for (let g = -span; g <= span; g += step) {
      if (g === 0) continue; // origin handled by the colored axes below
      // Line parallel to Z at x=g.
      this.addDecor(Primitives.box(1, 1, 1), gridMat, (t) => {
        t.position.set(g, 0, 0);
        t.scale.set(lineThick, lineThick, span * 2);
      });
      // Line parallel to X at z=g.
      this.addDecor(Primitives.box(1, 1, 1), gridMat, (t) => {
        t.position.set(0, 0, g);
        t.scale.set(span * 2, lineThick, lineThick);
      });
    }

    // X axis — red.
    this.addDecor(
      Primitives.box(1, 1, 1),
      new Material({
        albedo: new Color(0.2, 0.04, 0.04),
        emissive: new Color(0.85, 0.15, 0.15),
        emissiveIntensity: 1.6,
        roughness: 1,
      }),
      (t) => t.scale.set(span * 2, 0.04, 0.04),
    );
    // Z axis — blue.
    this.addDecor(
      Primitives.box(1, 1, 1),
      new Material({
        albedo: new Color(0.04, 0.06, 0.2),
        emissive: new Color(0.18, 0.4, 0.95),
        emissiveIntensity: 1.6,
        roughness: 1,
      }),
      (t) => t.scale.set(0.04, 0.04, span * 2),
    );
  }

  /** Spawn one decorative mesh entity (no shadows, kept out of the scene). */
  private addDecor(
    geom: ReturnType<typeof Primitives.box>,
    material: Material,
    place: (t: Transform) => void,
  ): void {
    const world = this.ctx.engine.world;
    const mesh = this.ctx.renderer.createMesh(geom);
    const mr = new MeshRenderer(mesh, material);
    mr.castShadow = false;
    mr.receiveShadow = true;
    const e = world.createEntity();
    const t = world.add(e, new Transform());
    place(t);
    t.updateMatrix();
    world.add(e, mr);
    this.decor.push(t);
  }

  // ---------------------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------------------

  private attachPointerListeners(): void {
    const canvas = this.ctx.canvas;
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    this.activeButton = e.button;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.moved = 0;
    this.gizmoDrag = false;

    // LMB in edit mode may grab a gizmo axis — that takes priority over orbit.
    if (e.button === 0 && this.ctx.mode === 'edit' && this.ctx.selection) {
      this.computeRay(e, _rayO, _rayD);
      if (this.gizmo.beginDrag(_rayO, _rayD)) {
        this.gizmoDrag = true;
      }
    }
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.activeButton < 0) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);

    if (this.gizmoDrag) {
      this.computeRay(e, _rayO, _rayD);
      this.gizmo.updateDrag(_rayO, _rayD);
      return;
    }

    if (this.activeButton === 0) {
      this.orbit(dx, dy);
    } else {
      // RMB (2) or MMB (1): pan.
      this.pan(dx, dy);
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (this.activeButton < 0) return;
    const wasGizmo = this.gizmoDrag;
    const button = this.activeButton;
    this.activeButton = -1;

    if (wasGizmo) {
      this.gizmo.endDrag();
      this.gizmoDrag = false;
      return;
    }

    // A near-stationary LMB press+release in edit mode is a selection click.
    const travel = Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY);
    if (button === 0 && this.ctx.mode === 'edit' && travel < CLICK_PX) {
      this.handleClickSelect(e);
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.dolly(e.deltaY);
  };

  /** Ray-cast under the cursor against scene objects and (de)select the hit. */
  private handleClickSelect(e: MouseEvent): void {
    this.computeRay(e, _rayO, _rayD);
    const hit = this.ctx.scene.raycastSelect(_rayO, _rayD);
    this.ctx.select(hit);
  }

  /**
   * Build a world-space ray from a mouse event over the canvas: map the cursor to
   * NDC (x in −1..1, y in −1..1 with +y up) and unproject via the camera.
   */
  private computeRay(e: MouseEvent, outO: Vec3, outD: Vec3): void {
    const rect = this.ctx.canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.ctx.camera.screenToRay(nx, ny, outO, outD);
  }

  // ---------------------------------------------------------------------------
  // Engine module (per-frame gizmo follow + camera aspect)
  // ---------------------------------------------------------------------------

  /**
   * Register a `'viewport'` engine module whose `update()` keeps the gizmo glued
   * to the selection each frame and whose `resize()` keeps the camera aspect in
   * sync with the drawing buffer.
   */
  private registerModule(): void {
    const mod: EngineModule = {
      name: 'viewport',
      update: () => {
        this.gizmo.update();
      },
      resize: (w: number, h: number) => {
        this.ctx.camera.setAspect(h > 0 ? w / h : 1);
      },
    };
    this.ctx.engine.use(mod);
    // Seed aspect immediately from current buffer size.
    const { width, height } = this.ctx.engine;
    this.ctx.camera.setAspect(height > 0 ? width / height : 1);
  }

  // ---------------------------------------------------------------------------
  // Mode overlay
  // ---------------------------------------------------------------------------

  /** Reflect play/edit mode in the viewport overlay + outline. */
  private onModeChanged(mode: 'edit' | 'play'): void {
    if (this.vpModeEl) this.vpModeEl.textContent = mode === 'play' ? '● PLAY' : '';
    if (this.vpEl) this.vpEl.classList.toggle('play-mode', mode === 'play');
  }
}
