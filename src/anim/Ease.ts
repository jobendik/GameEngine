/**
 * Easing functions for tweening.
 *
 * Every easing maps a normalized time `t` in `[0, 1]` to an eased progress value.
 * Most return values in `[0, 1]`, though overshooting easings (`backOut`,
 * `elasticOut`) may briefly exceed that range — this is intentional.
 */

/** A normalized easing function: maps `t` in `[0,1]` to eased progress. */
export type Easing = (t: number) => number;

/**
 * Standard easing curves. Use as the optional `easing` argument to
 * {@link Tween.to} / {@link TweenManager.tweenTo}; defaults to {@link Ease.linear}.
 */
export const Ease = {
  /** No easing — constant rate of change. */
  linear: (t: number): number => t,

  /** Quadratic acceleration from zero velocity. */
  quadIn: (t: number): number => t * t,

  /** Quadratic deceleration to zero velocity. */
  quadOut: (t: number): number => t * (2 - t),

  /** Quadratic acceleration until halfway, then deceleration. */
  quadInOut: (t: number): number =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  /** Cubic acceleration until halfway, then deceleration. */
  cubicInOut: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  /** Exponential deceleration to zero velocity. */
  expoOut: (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  /** Overshoots slightly past the target, then settles back. */
  backOut: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const p = t - 1;
    return 1 + c3 * p * p * p + c1 * p * p;
  },

  /** Springy overshoot that oscillates with decaying amplitude. */
  elasticOut: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },

  /** Decaying bounce as the value settles onto the target. */
  bounceOut: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      const u = t - 1.5 / d1;
      return n1 * u * u + 0.75;
    } else if (t < 2.5 / d1) {
      const u = t - 2.25 / d1;
      return n1 * u * u + 0.9375;
    }
    const u = t - 2.625 / d1;
    return n1 * u * u + 0.984375;
  },
} as const;
