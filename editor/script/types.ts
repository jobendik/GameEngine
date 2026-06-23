import type { Vec3, Quat } from '@/core/math';
import { MathUtils } from '@/core/math';
import type { Time } from '@/core';
import type { Camera } from '@/render';
import type { RigidBody } from '@/physics';
import type { Transform } from '@/scene';
import type { Input } from '@/input';
import type { EditorObject, EditorScene } from '@editor/core';

/** Re-export the math constructors so custom scripts can use them. */
export { Vec3, Quat, MathUtils } from '@/core/math';

/** A primitive parameter value editable in the inspector. */
export type ParamValue = number | boolean | string | number[];

/**
 * The per-frame context a behavior receives. It exposes the object's live
 * components plus engine services (input/time/camera/scene) and a private
 * `state` bag for persistent data between frames.
 */
export interface ScriptContext {
  /** The object this script is attached to. */
  readonly object: EditorObject;
  /** The object's live transform (mutate to move/rotate/scale it). */
  readonly transform: Transform;
  /** The object's physics body, or null if it has none. */
  readonly body: RigidBody | null;
  /** Resolved parameter values for this script instance. */
  readonly params: Record<string, ParamValue>;
  /** Persistent scratch storage for this instance (survives across frames). */
  readonly state: Record<string, unknown>;
  /** Keyboard/mouse/gamepad input. */
  readonly input: Input;
  /** Frame clock (`time.deltaTime`, `time.elapsed`, ...). */
  readonly time: Time;
  /** The editor/play camera. */
  readonly camera: Camera;
  /** The scene (e.g. to read other objects). */
  readonly scene: EditorScene;
}

/**
 * A behavior instance. All hooks are optional; they run only in play mode.
 * `onStart` fires once when play begins, `onUpdate` every frame, `onFixedUpdate`
 * every fixed physics step, `onStop` once when play ends.
 */
export interface Behavior {
  onStart?(ctx: ScriptContext): void;
  onUpdate?(ctx: ScriptContext, dt: number): void;
  onFixedUpdate?(ctx: ScriptContext, dt: number): void;
  onStop?(ctx: ScriptContext): void;
}

export type ParamType = 'number' | 'boolean' | 'string' | 'vec3' | 'color' | 'key';

/** Describes one tunable parameter of a built-in behavior (drives inspector UI). */
export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
}

/** A registered built-in behavior: metadata + a factory for fresh instances. */
export interface BehaviorDef {
  type: string;
  label: string;
  description: string;
  params: ParamSpec[];
  create(): Behavior;
}

// ---- small helpers shared by built-in behaviors ----

export function num(v: ParamValue | undefined, d: number): number {
  return typeof v === 'number' ? v : d;
}
export function str(v: ParamValue | undefined, d: string): string {
  return typeof v === 'string' ? v : d;
}
export function bool(v: ParamValue | undefined, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}
export function vec(v: ParamValue | undefined, d: [number, number, number]): [number, number, number] {
  return Array.isArray(v) && v.length >= 3 ? [v[0], v[1], v[2]] : d;
}
export const DEG2RAD = MathUtils.DEG2RAD;
