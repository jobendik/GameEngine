/**
 * Public barrel for the math module — `@/core/math`.
 * Exports the vector/matrix/quaternion/color classes plus a `MathUtils`
 * namespace object bundling scalar constants and free functions.
 */
export { Vec2 } from './Vec2';
export { Vec3 } from './Vec3';
export { Vec4 } from './Vec4';
export { Quat } from './Quat';
export { Mat3 } from './Mat3';
export { Mat4 } from './Mat4';
export { Color } from './Color';

import * as MathUtilsNS from './MathUtils';

/**
 * Scalar math helpers and constants, accessed as `MathUtils.clamp(...)`,
 * `MathUtils.DEG2RAD`, etc.
 */
export const MathUtils = {
  DEG2RAD: MathUtilsNS.DEG2RAD,
  RAD2DEG: MathUtilsNS.RAD2DEG,
  PI: MathUtilsNS.PI,
  TAU: MathUtilsNS.TAU,
  clamp: MathUtilsNS.clamp,
  lerp: MathUtilsNS.lerp,
  smoothstep: MathUtilsNS.smoothstep,
  damp: MathUtilsNS.damp,
  randRange: MathUtilsNS.randRange,
  randInt: MathUtilsNS.randInt,
  nextPow2: MathUtilsNS.nextPow2,
} as const;
