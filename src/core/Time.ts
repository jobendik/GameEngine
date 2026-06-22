/**
 * Frame-timing clock owned by {@link Engine}.
 *
 * `tick(nowMs)` is called once per rendered frame with a high-resolution
 * timestamp (e.g. from `requestAnimationFrame`). It derives the per-frame
 * delta from the previous timestamp, clamps it to avoid the "spiral of death"
 * after tab stalls, applies {@link Time.timeScale}, and maintains a smoothed
 * frames-per-second estimate.
 *
 * Coordinate-system note: all times are in **seconds** (timestamps arrive in ms).
 */
export class Time {
  /** Scaled, clamped delta for the current frame, in seconds (`unscaledDelta * timeScale`). */
  deltaTime = 0;

  /** Raw clamped delta for the current frame, in seconds (ignores {@link timeScale}). */
  unscaledDelta = 0;

  /** Total scaled seconds elapsed since the first tick. */
  elapsed = 0;

  /** Monotonically increasing rendered-frame counter (0 before the first tick). */
  frame = 0;

  /** Multiplier applied to {@link deltaTime}. 1 = real time, 0 = paused, 2 = double speed. */
  timeScale = 1;

  /** Exponentially-smoothed frames per second. */
  fps = 0;

  /** Previous `tick` timestamp in milliseconds, or `-1` before the first tick. */
  private _lastMs = -1;

  /** Maximum unscaled delta in seconds; longer frames are clamped to this. */
  private static readonly MAX_DELTA = 0.1;

  /** Smoothing factor for the FPS moving average (0..1; higher = snappier). */
  private static readonly FPS_SMOOTHING = 0.1;

  /**
   * Advance the clock by one frame.
   * @param nowMs High-resolution timestamp in milliseconds (monotonic).
   */
  tick(nowMs: number): void {
    if (this._lastMs < 0) {
      // First tick establishes the baseline; no delta is produced yet.
      this._lastMs = nowMs;
      this.frame++;
      return;
    }

    let dt = (nowMs - this._lastMs) / 1000;
    this._lastMs = nowMs;

    // Guard against negative/NaN deltas and clamp large stalls.
    if (!(dt > 0)) dt = 0;
    if (dt > Time.MAX_DELTA) dt = Time.MAX_DELTA;

    this.unscaledDelta = dt;
    this.deltaTime = dt * this.timeScale;
    this.elapsed += this.deltaTime;
    this.frame++;

    // Instantaneous FPS from the unscaled delta, smoothed via EMA.
    if (dt > 0) {
      const instantFps = 1 / dt;
      this.fps =
        this.fps === 0
          ? instantFps
          : this.fps + (instantFps - this.fps) * Time.FPS_SMOOTHING;
    }
  }
}
