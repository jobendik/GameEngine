/**
 * Scalar math utilities and constants used across the engine.
 * All angles are in radians. Pure functions with no side effects.
 */

/** Multiply degrees by this to get radians. */
export const DEG2RAD = Math.PI / 180;
/** Multiply radians by this to get degrees. */
export const RAD2DEG = 180 / Math.PI;
/** π */
export const PI = Math.PI;
/** 2π — a full turn in radians. */
export const TAU = Math.PI * 2;

/** Clamp `x` into the inclusive range `[min, max]`. */
export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

/** Linear interpolation: returns `a` at `t=0`, `b` at `t=1`. `t` is not clamped. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Hermite smoothstep. Returns 0 below `edge0`, 1 above `edge1`, and a smooth
 * (C1-continuous) S-curve in between. Robust when `edge0 === edge1`.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate-independent exponential smoothing toward `b`.
 * `lambda` is the smoothing rate (larger = faster). Equivalent to an
 * exponential decay: result approaches `b` as `dt` grows.
 */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

/** Uniform random float in `[min, max)`. */
export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Uniform random integer in the inclusive range `[min, max]`. */
export function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Smallest power of two that is >= `n` (for n >= 1). Returns 1 for n <= 1.
 * Uses bit twiddling on 32-bit integers.
 */
export function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let v = Math.ceil(n) - 1;
  v |= v >>> 1;
  v |= v >>> 2;
  v |= v >>> 4;
  v |= v >>> 8;
  v |= v >>> 16;
  return v + 1;
}
