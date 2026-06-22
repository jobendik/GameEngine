import { Ease, type Easing } from './Ease';

/** Numeric properties that may be tweened on a target object of type `T`. */
type TweenProps<T> = Partial<Record<keyof T, number>>;

/**
 * A single segment of a tween sequence: animate one set of numeric props
 * over a fixed duration with an easing curve. Start values are captured
 * lazily the first time the segment is advanced.
 */
interface Segment<T> {
  /** Target end values, keyed by property name. */
  readonly props: TweenProps<T>;
  /** Duration of this segment in seconds (clamped to be non-negative). */
  readonly duration: number;
  /** Easing curve applied to this segment's normalized time. */
  readonly easing: Easing;
  /** Captured start values, populated lazily on first update. */
  start: TweenProps<T> | null;
}

/**
 * Interpolates numeric properties of a target object over time.
 *
 * Multiple {@link Tween.to} calls chain as a **sequence**: each segment runs
 * after the previous one completes. Start values for each segment are captured
 * lazily on the segment's first update, so queued/chained tweens always read
 * the correct (possibly mutated) starting state.
 *
 * @typeParam T - The object whose numeric fields are animated.
 *
 * @example
 * ```ts
 * new Tween(sprite)
 *   .to({ x: 100 }, 0.5, Ease.quadOut)
 *   .to({ x: 0 }, 0.5, Ease.quadIn)
 *   .onComplete(() => console.log('done'));
 * ```
 */
export class Tween<T extends object> {
  private readonly target: T;
  private readonly segments: Segment<T>[] = [];

  /** Index of the currently-running segment. */
  private index = 0;
  /** Elapsed seconds within the current segment. */
  private elapsed = 0;
  /** Remaining start delay in seconds before the first segment runs. */
  private delaySec = 0;
  /** Completion callback fired once when all segments finish. */
  private onCompleteFn: (() => void) | null = null;
  /** True once every segment has completed. */
  private done = false;

  /**
   * @param target - Object whose numeric properties will be animated.
   */
  constructor(target: T) {
    this.target = target;
  }

  /**
   * Queue a segment that animates `props` to their given values over
   * `durationSec` seconds using `easing`. Chained calls run in sequence.
   *
   * @param props - End values keyed by numeric property name.
   * @param durationSec - Segment duration in seconds.
   * @param easing - Easing curve (defaults to {@link Ease.linear}).
   * @returns This tween, for chaining.
   */
  to(props: TweenProps<T>, durationSec: number, easing: Easing = Ease.linear): this {
    this.segments.push({
      props,
      duration: durationSec > 0 ? durationSec : 0,
      easing,
      start: null,
    });
    return this;
  }

  /**
   * Delay the start of the entire tween by `sec` seconds.
   *
   * @param sec - Delay in seconds (negative values are ignored).
   * @returns This tween, for chaining.
   */
  delay(sec: number): this {
    if (sec > 0) this.delaySec += sec;
    return this;
  }

  /**
   * Register a callback fired once when the final segment completes.
   *
   * @param fn - Completion callback.
   * @returns This tween, for chaining.
   */
  onComplete(fn: () => void): this {
    this.onCompleteFn = fn;
    return this;
  }

  /**
   * Advance the tween by `dt` seconds, mutating the target's properties.
   *
   * @param dt - Elapsed time in seconds since the last update.
   * @returns `true` once the tween has finished (all segments complete).
   */
  update(dt: number): boolean {
    if (this.done) return true;
    if (this.segments.length === 0) {
      this.finish();
      return true;
    }

    // Consume the start delay before any segment runs.
    if (this.delaySec > 0) {
      this.delaySec -= dt;
      if (this.delaySec > 0) return false;
      // Carry the leftover negative time into the first segment.
      dt = -this.delaySec;
      this.delaySec = 0;
    }

    // Advance through segments, carrying any time overflow into the next.
    while (this.index < this.segments.length) {
      const seg = this.segments[this.index]!;

      // Lazily capture start values on first touch of this segment.
      if (seg.start === null) {
        seg.start = this.captureStart(seg.props);
        // Snap to start immediately so a zero-dt first frame is consistent.
        this.applyProgress(seg, 0);
      }

      this.elapsed += dt;

      if (seg.duration <= 0 || this.elapsed >= seg.duration) {
        // Segment completed: snap to its end values exactly.
        this.applyProgress(seg, 1);
        const overflow = seg.duration <= 0 ? 0 : this.elapsed - seg.duration;
        this.index++;
        this.elapsed = 0;
        dt = overflow;
        if (this.index >= this.segments.length) {
          this.finish();
          return true;
        }
        // Continue into the next segment with the overflow time.
        continue;
      }

      // Mid-segment: apply eased interpolation.
      const t = seg.easing(this.elapsed / seg.duration);
      this.applyProgress(seg, t);
      return false;
    }

    this.finish();
    return true;
  }

  /** Snapshot the target's current values for the keys in `props`. */
  private captureStart(props: TweenProps<T>): TweenProps<T> {
    const start: TweenProps<T> = {};
    for (const key in props) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        start[key] = this.target[key] as unknown as number;
      }
    }
    return start;
  }

  /** Write interpolated values for normalized eased progress `t` into the target. */
  private applyProgress(seg: Segment<T>, t: number): void {
    const start = seg.start!;
    const target = this.target;
    for (const key in seg.props) {
      if (!Object.prototype.hasOwnProperty.call(seg.props, key)) continue;
      const from = start[key] as number;
      const to = seg.props[key] as number;
      (target[key] as unknown as number) = from + (to - from) * t;
    }
  }

  /** Mark complete and fire the completion callback exactly once. */
  private finish(): void {
    if (this.done) return;
    this.done = true;
    const fn = this.onCompleteFn;
    if (fn !== null) fn();
  }
}
