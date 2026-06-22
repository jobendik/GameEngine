import { World } from '@/core/ecs';
import { Time } from '@/core/Time';
import { EventBus } from '@/core/EventBus';

/**
 * A pluggable engine subsystem (renderer, physics, input, audio, …).
 *
 * All lifecycle hooks are optional; modules implement only what they need and
 * the {@link Engine} skips any hook a module does not provide.
 *
 * Per-frame call order is fixed:
 * `update` → `fixedUpdate` × N → `lateUpdate` → `render`.
 */
export interface EngineModule {
  /** Unique, stable identifier used by {@link Engine.get}. */
  readonly name: string;

  /** Async one-time setup. Awaited by {@link Engine.start} before the loop begins. */
  init?(engine: Engine): void | Promise<void>;

  /** Fixed-step update for deterministic simulation (e.g. physics). `dt` is the fixed step. */
  fixedUpdate?(dt: number): void;

  /** Variable-step update driven by the real frame delta (seconds). */
  update?(dt: number): void;

  /** Variable-step update run after all `update` hooks (e.g. camera follow, input flush). */
  lateUpdate?(dt: number): void;

  /**
   * Produce a frame.
   * @param alpha Fixed-step interpolation factor in `[0,1)` for smooth rendering
   *              between simulation steps.
   */
  render?(alpha: number): void;

  /** Called when the drawing-buffer size changes. Sizes are in device pixels. */
  resize?(w: number, h: number): void;

  /** Release any owned resources. Called in reverse registration order on dispose. */
  dispose?(): void;
}

/** Construction options for {@link Engine}. */
export interface EngineOptions {
  /** Canvas the engine renders into and observes for size changes. */
  canvas: HTMLCanvasElement;
  /** Fixed simulation step in seconds. Default `1/60`. */
  fixedTimeStep?: number;
  /** Maximum fixed sub-steps per frame, bounding catch-up work. Default `5`. */
  maxSubSteps?: number;
}

/**
 * Owns the world, clock, event bus, and the ordered module list, and drives the
 * main loop.
 *
 * The loop is a classic fixed-timestep accumulator: each animation frame ticks
 * the {@link Time} clock, runs variable-step `update`s, drains an accumulator
 * with up to `maxSubSteps` fixed `fixedUpdate`s, runs `lateUpdate`s, then
 * `render`s with the residual-accumulator interpolation `alpha`.
 */
export class Engine {
  /** Shared ECS world. */
  readonly world: World;
  /** Frame clock. */
  readonly time: Time;
  /** Global event bus. */
  readonly events: EventBus;
  /** Backing canvas. */
  readonly canvas: HTMLCanvasElement;

  /** Drawing-buffer width in device pixels (`floor(clientWidth * dpr)`). */
  readonly width: number = 0;
  /** Drawing-buffer height in device pixels (`floor(clientHeight * dpr)`). */
  readonly height: number = 0;

  private readonly _modules: EngineModule[] = [];
  private readonly _fixedTimeStep: number;
  private readonly _maxSubSteps: number;

  private _accumulator = 0;
  private _rafId = 0;
  private _running = false;

  private readonly _frame: (nowMs: number) => void;
  private readonly _onResize: () => void;
  private _resizeObserver: ResizeObserver | null = null;

  constructor(opts: EngineOptions) {
    this.canvas = opts.canvas;
    this._fixedTimeStep = opts.fixedTimeStep ?? 1 / 60;
    this._maxSubSteps = opts.maxSubSteps ?? 5;

    this.world = new World();
    this.time = new Time();
    this.events = new EventBus();

    // Bind once so add/removeEventListener and rAF use stable references.
    this._frame = this._tick.bind(this);
    this._onResize = this._handleResize.bind(this);

    // Observe canvas size where supported, falling back to window resize.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(this._onResize);
      this._resizeObserver.observe(this.canvas);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResize);
    }

    // Establish initial dimensions immediately.
    this._measure();
  }

  /**
   * Register a module. Modules are updated/rendered in registration order and
   * disposed in reverse. Initialization is deferred to {@link Engine.start}.
   * @returns The same module, for fluent assignment.
   */
  use<T extends EngineModule>(m: T): T {
    this._modules.push(m);
    return m;
  }

  /**
   * Look up a previously-registered module by its `name`.
   * @throws If no module with the given name is registered.
   */
  get<T extends EngineModule>(name: string): T {
    for (let i = 0; i < this._modules.length; i++) {
      if (this._modules[i].name === name) return this._modules[i] as T;
    }
    throw new Error(`Engine.get: no module named "${name}"`);
  }

  /**
   * Initialize every module (awaiting async `init`) in registration order, push
   * the current size to each, then start the animation-frame loop.
   */
  async start(): Promise<void> {
    if (this._running) return;

    for (let i = 0; i < this._modules.length; i++) {
      const m = this._modules[i];
      if (m.init) await m.init(this);
    }

    // Ensure modules see the correct size before the first frame.
    this._measure();
    this._dispatchResize();

    this._running = true;
    this._accumulator = 0;
    if (typeof requestAnimationFrame !== 'undefined') {
      this._rafId = requestAnimationFrame(this._frame);
    }
  }

  /** Halt the loop. Modules are kept; call {@link Engine.start} to resume. */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this._rafId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._rafId);
    }
    this._rafId = 0;
  }

  /**
   * Stop the loop, dispose modules in reverse registration order, detach resize
   * observers/listeners, and clear all event subscriptions.
   */
  dispose(): void {
    this.stop();

    for (let i = this._modules.length - 1; i >= 0; i--) {
      this._modules[i].dispose?.();
    }
    this._modules.length = 0;

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    } else if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onResize);
    }

    this.events.clear();
  }

  /** One animation frame: tick clock, run module hooks in order, schedule next. */
  private _tick(nowMs: number): void {
    if (!this._running) return;

    this.time.tick(nowMs);
    const dt = this.time.deltaTime;
    const fixed = this._fixedTimeStep;

    // Variable-step update.
    for (let i = 0; i < this._modules.length; i++) {
      this._modules[i].update?.(dt);
    }

    // Fixed-step simulation: drain the accumulator, bounded by maxSubSteps.
    this._accumulator += dt;
    let steps = 0;
    while (this._accumulator >= fixed && steps < this._maxSubSteps) {
      for (let i = 0; i < this._modules.length; i++) {
        this._modules[i].fixedUpdate?.(fixed);
      }
      this._accumulator -= fixed;
      steps++;
    }
    // Drop leftover backlog so we don't perpetually lag after a long stall.
    if (this._accumulator > fixed) {
      this._accumulator = this._accumulator % fixed;
    }

    // Late update (after all fixed steps).
    for (let i = 0; i < this._modules.length; i++) {
      this._modules[i].lateUpdate?.(dt);
    }

    // Render with interpolation factor between the last two fixed states.
    const alpha = fixed > 0 ? this._accumulator / fixed : 0;
    for (let i = 0; i < this._modules.length; i++) {
      this._modules[i].render?.(alpha);
    }

    this._rafId = requestAnimationFrame(this._frame);
  }

  /** Recompute {@link width}/{@link height} from the canvas CSS size × dpr. */
  private _measure(): boolean {
    const dpr =
      typeof devicePixelRatio !== 'undefined' && devicePixelRatio > 0
        ? devicePixelRatio
        : 1;
    // Prefer CSS pixel size; fall back to the canvas attribute size headlessly.
    const cssW = this.canvas.clientWidth || this.canvas.width || 1;
    const cssH = this.canvas.clientHeight || this.canvas.height || 1;
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (w === this.width && h === this.height) return false;
    // Public `width`/`height` are readonly to consumers; we own them internally.
    const self = this as { -readonly [K in 'width' | 'height']: number };
    self.width = w;
    self.height = h;
    return true;
  }

  /** Resize-event handler: remeasure and notify modules only when size changes. */
  private _handleResize(): void {
    if (this._measure()) this._dispatchResize();
  }

  /** Push the current drawing-buffer size to every module that wants it. */
  private _dispatchResize(): void {
    for (let i = 0; i < this._modules.length; i++) {
      this._modules[i].resize?.(this.width, this.height);
    }
  }
}
