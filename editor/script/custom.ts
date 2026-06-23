import { Vec3, Quat, MathUtils } from '@/core/math';
import type { Behavior, ScriptContext } from './types';

/**
 * Compile a user-written code body into a {@link Behavior} that runs the body
 * every frame. The body executes with these identifiers in scope:
 *
 *   dt, time, input, transform, body, object, state, scene, camera,
 *   Vec3, Quat, MathUtils
 *
 * Example body:
 *   transform.position.y = 2 + Math.sin(time.elapsed * 3) * 0.5;
 *   if (input.isDown('KeyW')) transform.position.z -= dt * 4;
 *
 * Compile/runtime errors are reported once via `onError` and then the script is
 * disabled so it never spams or blocks the loop.
 */
export function createCustomBehavior(code: string, onError?: (msg: string) => void): Behavior {
  let fn: ((...args: unknown[]) => void) | null = null;
  let compileError: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = new Function(
      'dt', 'time', 'input', 'transform', 'body', 'object', 'state', 'scene', 'camera',
      'Vec3', 'Quat', 'MathUtils',
      code,
    ) as (...args: unknown[]) => void;
  } catch (e) {
    compileError = `Script compile error: ${(e as Error).message ?? e}`;
  }

  let dead = false;
  return {
    onStart() {
      if (compileError) { onError?.(compileError); dead = true; }
    },
    onUpdate(ctx: ScriptContext, dt: number) {
      if (dead || !fn) return;
      try {
        fn(dt, ctx.time, ctx.input, ctx.transform, ctx.body, ctx.object, ctx.state, ctx.scene,
          ctx.camera, Vec3, Quat, MathUtils);
      } catch (e) {
        onError?.(`Script error: ${(e as Error).message ?? e}`);
        dead = true;
      }
    },
  };
}
