import type { EngineModule } from '@/core';
import { Ease, type Easing } from './Ease';
import { Tween } from './Tween';

/**
 * Owns and advances a pool of active {@link Tween}s as an {@link EngineModule}.
 *
 * Register the manager with the engine (`engine.use(new TweenManager())`); its
 * {@link TweenManager.update} is then driven each frame, advancing every active
 * tween and removing those that have finished.
 */
export class TweenManager implements EngineModule {
  readonly name = 'tweens';

  /** Currently-active tweens, advanced each frame. */
  private readonly active: Tween<object>[] = [];

  /**
   * Add a tween to be advanced by this manager. Adding the same tween twice
   * is ignored.
   *
   * @param tween - The tween to track until it completes.
   */
  add(tween: Tween<object>): void {
    if (this.active.indexOf(tween) === -1) this.active.push(tween);
  }

  /**
   * Convenience: create a single-segment {@link Tween}, add it, and return it.
   *
   * @typeParam T - The animated target object type.
   * @param target - Object whose numeric properties will be animated.
   * @param props - End values keyed by numeric property name.
   * @param dur - Duration in seconds.
   * @param easing - Easing curve (defaults to {@link Ease.linear}).
   * @returns The created tween (already added), for further chaining.
   */
  tweenTo<T extends object>(
    target: T,
    props: Partial<Record<keyof T, number>>,
    dur: number,
    easing: Easing = Ease.linear,
  ): Tween<T> {
    const tween = new Tween(target).to(props, dur, easing);
    this.add(tween as unknown as Tween<object>);
    return tween;
  }

  /**
   * Advance all active tweens by `dt` seconds and drop finished ones.
   *
   * Uses a swap-remove pass so removal is allocation-free and stable for the
   * remaining tweens.
   *
   * @param dt - Elapsed time in seconds since the last update.
   */
  update(dt: number): void {
    const active = this.active;
    let i = 0;
    while (i < active.length) {
      const finished = active[i]!.update(dt);
      if (finished) {
        const last = active.length - 1;
        active[i] = active[last]!;
        active.pop();
        // Do not advance `i`: re-process the swapped-in tween.
      } else {
        i++;
      }
    }
  }

  /** Remove all active tweens without firing their completion callbacks. */
  clear(): void {
    this.active.length = 0;
  }
}
