import type { EngineModule } from '@/core';

/**
 * Input manager: keyboard, mouse, wheel, pointer lock and gamepad.
 *
 * Frame semantics:
 * - {@link update} runs EARLY in the frame. It snapshots the previous frame's
 *   key/button state and diffs against the live state so that
 *   {@link wasPressed}/{@link wasReleased} (and their mouse equivalents) are
 *   true only on the single frame a transition occurred. It also polls the
 *   gamepad.
 * - {@link lateUpdate} runs LATE in the frame and clears the per-frame deltas
 *   (mouse dx/dy and the accumulated wheel) so the next frame starts clean.
 *
 * All keyboard codes use `KeyboardEvent.code` (e.g. `'KeyW'`, `'Space'`,
 * `'ArrowUp'`). Mouse position is reported relative to the canvas; per-frame
 * deltas accumulate `movementX/Y`, which keeps working under pointer lock.
 */
export class Input implements EngineModule {
  readonly name = 'input';

  private readonly canvas: HTMLCanvasElement;

  // ---- keyboard ----------------------------------------------------------
  /** Codes currently held down (live state, mutated by DOM events). */
  private readonly down = new Set<string>();
  /** Snapshot of `down` taken at the previous frame's update(). */
  private readonly prevDown = new Set<string>();
  /** Codes that transitioned down this frame (computed in update). */
  private readonly pressed = new Set<string>();
  /** Codes that transitioned up this frame (computed in update). */
  private readonly released = new Set<string>();

  // ---- mouse -------------------------------------------------------------
  private _mouseX = 0;
  private _mouseY = 0;
  /** Accumulated per-frame movement (reset in lateUpdate). */
  private _mouseDX = 0;
  private _mouseDY = 0;
  /** Accumulated wheel delta (reset in lateUpdate). */
  private _wheel = 0;

  /** Live mouse button state, indexed by `MouseEvent.button`. */
  private readonly buttons: boolean[] = [];
  /** Snapshot of `buttons` from the previous update(). */
  private readonly prevButtons: boolean[] = [];
  /** Buttons that transitioned down this frame. */
  private readonly buttonsPressed: boolean[] = [];

  // ---- pointer lock ------------------------------------------------------
  private _pointerLocked = false;

  // ---- gamepad -----------------------------------------------------------
  private _gamepad: { axes: number[]; buttons: boolean[] } | null = null;

  // ---- bound listeners (kept so they can be removed in dispose) ----------
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly onContextMenu: (e: MouseEvent) => void;
  private readonly onPointerLockChange: () => void;
  private readonly onBlur: () => void;

  /**
   * @param canvas the canvas events are tracked relative to and that pointer
   *   lock is requested on.
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.onKeyDown = (e: KeyboardEvent): void => {
      // Ignore auto-repeat so wasPressed fires exactly once per physical press.
      if (e.repeat) return;
      this.down.add(e.code);
    };

    this.onKeyUp = (e: KeyboardEvent): void => {
      this.down.delete(e.code);
    };

    this.onMouseDown = (e: MouseEvent): void => {
      this.buttons[e.button] = true;
    };

    this.onMouseUp = (e: MouseEvent): void => {
      this.buttons[e.button] = false;
    };

    this.onMouseMove = (e: MouseEvent): void => {
      const rect = this.canvas.getBoundingClientRect();
      this._mouseX = e.clientX - rect.left;
      this._mouseY = e.clientY - rect.top;
      // movementX/Y is the only reliable delta under pointer lock; accumulate
      // it so multiple events within one frame are summed.
      this._mouseDX += e.movementX;
      this._mouseDY += e.movementY;
    };

    this.onWheel = (e: WheelEvent): void => {
      // Prevent the page from scrolling while the canvas is the focus.
      e.preventDefault();
      this._wheel += e.deltaY;
    };

    this.onContextMenu = (e: MouseEvent): void => {
      // Suppress the browser context menu so right-click can be used in-game.
      e.preventDefault();
    };

    this.onPointerLockChange = (): void => {
      this._pointerLocked = document.pointerLockElement === this.canvas;
    };

    // On focus loss, release everything so keys don't get "stuck" down.
    this.onBlur = (): void => {
      this.down.clear();
      this.buttons.length = 0;
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('blur', this.onBlur);
  }

  // ---- keyboard queries --------------------------------------------------

  /** True while `code` is held down. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True only on the single frame `code` transitioned from up to down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** True only on the single frame `code` transitioned from down to up. */
  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  // ---- mouse accessors ---------------------------------------------------

  /** Mouse X relative to the canvas (CSS pixels). */
  get mouseX(): number {
    return this._mouseX;
  }

  /** Mouse Y relative to the canvas (CSS pixels). */
  get mouseY(): number {
    return this._mouseY;
  }

  /** Mouse X movement accumulated this frame (works under pointer lock). */
  get mouseDX(): number {
    return this._mouseDX;
  }

  /** Mouse Y movement accumulated this frame (works under pointer lock). */
  get mouseDY(): number {
    return this._mouseDY;
  }

  /** Wheel delta accumulated this frame (cleared in lateUpdate). */
  get wheel(): number {
    return this._wheel;
  }

  /** True while the given mouse button is held (default left button 0). */
  mouseDown(button = 0): boolean {
    return this.buttons[button] === true;
  }

  /** True only on the frame the given mouse button went down (default 0). */
  mousePressed(button = 0): boolean {
    return this.buttonsPressed[button] === true;
  }

  // ---- pointer lock ------------------------------------------------------

  /** Request pointer lock on the canvas (must be called from a user gesture). */
  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  /** Release pointer lock if currently held. */
  exitPointerLock(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  /** True while the canvas owns the pointer lock. */
  get isPointerLocked(): boolean {
    return this._pointerLocked;
  }

  // ---- gamepad -----------------------------------------------------------

  /**
   * First connected gamepad, or null. `axes` are raw -1..1 values; `buttons`
   * is a parallel array of pressed booleans. Refreshed each frame in update().
   */
  get gamepad(): { axes: number[]; buttons: boolean[] } | null {
    return this._gamepad;
  }

  // ---- lifecycle ---------------------------------------------------------

  /**
   * Compute per-frame edge sets and poll the gamepad. Call EARLY in the frame
   * (before game logic) so wasPressed/wasReleased reflect this frame's input.
   */
  update(_dt: number): void {
    // Keyboard edge detection: diff live `down` against last frame's snapshot.
    this.pressed.clear();
    this.released.clear();

    for (const code of this.down) {
      if (!this.prevDown.has(code)) this.pressed.add(code);
    }
    for (const code of this.prevDown) {
      if (!this.down.has(code)) this.released.add(code);
    }

    // Refresh the snapshot for next frame.
    this.prevDown.clear();
    for (const code of this.down) this.prevDown.add(code);

    // Mouse button edge detection.
    const buttonCount = Math.max(this.buttons.length, this.prevButtons.length);
    this.buttonsPressed.length = 0;
    for (let i = 0; i < buttonCount; i++) {
      const isDown = this.buttons[i] === true;
      const wasDown = this.prevButtons[i] === true;
      this.buttonsPressed[i] = isDown && !wasDown;
      this.prevButtons[i] = isDown;
    }

    this.pollGamepad();
  }

  /**
   * Clear per-frame deltas (mouse dx/dy and accumulated wheel). Call LATE in
   * the frame (after all systems have consumed the input).
   */
  lateUpdate(_dt: number): void {
    this._mouseDX = 0;
    this._mouseDY = 0;
    this._wheel = 0;
  }

  /** Remove all DOM listeners and release pointer lock. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.onBlur);

    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }

    this.down.clear();
    this.prevDown.clear();
    this.pressed.clear();
    this.released.clear();
    this.buttons.length = 0;
    this.prevButtons.length = 0;
    this.buttonsPressed.length = 0;
    this._gamepad = null;
  }

  // ---- internals ---------------------------------------------------------

  /** Poll the navigator gamepad list and expose the first non-null pad. */
  private pollGamepad(): void {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (!nav || typeof nav.getGamepads !== 'function') {
      this._gamepad = null;
      return;
    }

    const pads = nav.getGamepads();
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p) {
        pad = p;
        break;
      }
    }

    if (!pad) {
      this._gamepad = null;
      return;
    }

    const axes: number[] = new Array(pad.axes.length);
    for (let i = 0; i < pad.axes.length; i++) axes[i] = pad.axes[i];

    const buttons: boolean[] = new Array(pad.buttons.length);
    for (let i = 0; i < pad.buttons.length; i++) buttons[i] = pad.buttons[i].pressed;

    this._gamepad = { axes, buttons };
  }
}
