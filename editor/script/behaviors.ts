import { Vec3, Quat } from '@/core/math';
import { BodyType } from '@/physics';
import type { Behavior, BehaviorDef, ScriptContext } from './types';
import { num, str, bool, vec, DEG2RAD } from './types';

/**
 * Built-in behaviors. Each is a {@link BehaviorDef} with editable parameters and
 * a factory that returns a fresh {@link Behavior}. Behaviors that physically
 * drive an object set the rigid body (velocity / kinematic placement); those
 * without a body fall back to moving the transform directly.
 */

/** Zero gravity for kinematic-style movers so physics doesn't fight them. */
function makeKinematic(ctx: ScriptContext): void {
  if (ctx.body) {
    ctx.body.gravityScale = 0;
    ctx.body.linearVelocity.set(0, 0, 0);
    ctx.body.angularVelocity.set(0, 0, 0);
  }
}

/** Place the object (transform + body) at a world position, killing velocity. */
function place(ctx: ScriptContext, x: number, y: number, z: number): void {
  ctx.transform.position.set(x, y, z);
  if (ctx.body) {
    ctx.body.position.set(x, y, z);
    ctx.body.linearVelocity.set(0, 0, 0);
  }
}

const spin: BehaviorDef = {
  type: 'spin',
  label: 'Spin',
  description: 'Continuously rotate around an axis.',
  params: [
    { key: 'speed', label: 'Speed °/s', type: 'number', default: 90, step: 5 },
    { key: 'axis', label: 'Axis', type: 'vec3', default: [0, 1, 0] },
  ],
  create(): Behavior {
    const q = new Quat();
    const ax = new Vec3();
    return {
      onUpdate(ctx, dt) {
        const speed = num(ctx.params.speed, 90) * DEG2RAD;
        const a = vec(ctx.params.axis, [0, 1, 0]);
        ax.set(a[0], a[1], a[2]);
        if (ax.lengthSq() < 1e-8) ax.set(0, 1, 0);
        ax.normalize();
        if (ctx.body && ctx.body.type === BodyType.Dynamic) {
          ctx.body.angularVelocity.set(ax.x * speed, ax.y * speed, ax.z * speed);
          ctx.body.wake();
        } else {
          q.setFromAxisAngle(ax, speed * dt);
          ctx.transform.rotation.multiply(q).normalize();
        }
      },
    };
  },
};

const hover: BehaviorDef = {
  type: 'hover',
  label: 'Hover / Bob',
  description: 'Bob up and down around the start height.',
  params: [
    { key: 'amplitude', label: 'Amplitude', type: 'number', default: 0.5, step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 2, step: 0.1 },
  ],
  create(): Behavior {
    return {
      onStart(ctx) {
        ctx.state.baseY = ctx.transform.position.y;
        makeKinematic(ctx);
      },
      onUpdate(ctx) {
        const amp = num(ctx.params.amplitude, 0.5);
        const spd = num(ctx.params.speed, 2);
        const baseY = (ctx.state.baseY as number) ?? ctx.transform.position.y;
        const y = baseY + Math.sin(ctx.time.elapsed * spd) * amp;
        ctx.transform.position.y = y;
        if (ctx.body) { ctx.body.position.y = y; ctx.body.linearVelocity.set(0, 0, 0); }
      },
    };
  },
};

const orbit: BehaviorDef = {
  type: 'orbit',
  label: 'Orbit',
  description: 'Circle around a center point on the XZ plane.',
  params: [
    { key: 'radius', label: 'Radius', type: 'number', default: 4, step: 0.5 },
    { key: 'speed', label: 'Speed °/s', type: 'number', default: 60, step: 5 },
    { key: 'center', label: 'Center', type: 'vec3', default: [0, 0, 0] },
  ],
  create(): Behavior {
    return {
      onStart(ctx) {
        makeKinematic(ctx);
        const c = vec(ctx.params.center, [0, 0, 0]);
        ctx.state.phase = Math.atan2(ctx.transform.position.z - c[2], ctx.transform.position.x - c[0]);
      },
      onUpdate(ctx, dt) {
        const r = num(ctx.params.radius, 4);
        const spd = num(ctx.params.speed, 60) * DEG2RAD;
        const c = vec(ctx.params.center, [0, 0, 0]);
        const ph = (ctx.state.phase as number) + spd * dt;
        ctx.state.phase = ph;
        place(ctx, c[0] + Math.cos(ph) * r, ctx.transform.position.y, c[2] + Math.sin(ph) * r);
      },
    };
  },
};

const patrol: BehaviorDef = {
  type: 'patrol',
  label: 'Patrol',
  description: 'Move back and forth along an axis.',
  params: [
    { key: 'axis', label: 'Axis', type: 'vec3', default: [1, 0, 0] },
    { key: 'distance', label: 'Distance', type: 'number', default: 3, step: 0.5 },
    { key: 'speed', label: 'Speed', type: 'number', default: 2, step: 0.1 },
  ],
  create(): Behavior {
    return {
      onStart(ctx) {
        makeKinematic(ctx);
        ctx.state.base = [ctx.transform.position.x, ctx.transform.position.y, ctx.transform.position.z];
        ctx.state.t = 0;
      },
      onUpdate(ctx, dt) {
        const a = vec(ctx.params.axis, [1, 0, 0]);
        const dist = num(ctx.params.distance, 3);
        const spd = num(ctx.params.speed, 2);
        const t = (ctx.state.t as number) + dt * spd;
        ctx.state.t = t;
        const off = Math.sin(t) * dist;
        const b = ctx.state.base as number[];
        place(ctx, b[0] + a[0] * off, b[1] + a[1] * off, b[2] + a[2] * off);
      },
    };
  },
};

const lookAtCamera: BehaviorDef = {
  type: 'billboard',
  label: 'Look At Camera',
  description: 'Always face the camera (billboard).',
  params: [],
  create(): Behavior {
    const dir = new Vec3();
    const from = new Vec3(0, 0, -1);
    return {
      onUpdate(ctx) {
        dir.set(
          ctx.camera.position.x - ctx.transform.position.x,
          ctx.camera.position.y - ctx.transform.position.y,
          ctx.camera.position.z - ctx.transform.position.z,
        );
        if (dir.lengthSq() < 1e-8) return;
        dir.normalize();
        ctx.transform.rotation.setFromUnitVectors(from, dir);
      },
    };
  },
};

const wasd: BehaviorDef = {
  type: 'wasd',
  label: 'WASD Move',
  description: 'Move on the ground plane with WASD / arrows. Uses physics if the object has a body.',
  params: [
    { key: 'speed', label: 'Speed', type: 'number', default: 6, step: 0.5 },
    { key: 'arrows', label: 'Arrow keys', type: 'boolean', default: true },
  ],
  create(): Behavior {
    return {
      onUpdate(ctx, dt) {
        const spd = num(ctx.params.speed, 6);
        const arrows = bool(ctx.params.arrows, true);
        const I = ctx.input;
        let x = 0, z = 0;
        if (I.isDown('KeyW') || (arrows && I.isDown('ArrowUp'))) z -= 1;
        if (I.isDown('KeyS') || (arrows && I.isDown('ArrowDown'))) z += 1;
        if (I.isDown('KeyA') || (arrows && I.isDown('ArrowLeft'))) x -= 1;
        if (I.isDown('KeyD') || (arrows && I.isDown('ArrowRight'))) x += 1;
        const len = Math.hypot(x, z);
        if (len > 0) { x /= len; z /= len; }
        if (ctx.body && ctx.body.type === BodyType.Dynamic) {
          ctx.body.linearVelocity.x = x * spd;
          ctx.body.linearVelocity.z = z * spd;
          if (x || z) ctx.body.wake();
        } else {
          ctx.transform.position.x += x * spd * dt;
          ctx.transform.position.z += z * spd * dt;
        }
      },
    };
  },
};

const jump: BehaviorDef = {
  type: 'jump',
  label: 'Jump',
  description: 'Jump on key press (requires a dynamic body).',
  params: [
    { key: 'key', label: 'Key', type: 'key', default: 'Space' },
    { key: 'jumpSpeed', label: 'Jump Speed', type: 'number', default: 7, step: 0.5 },
  ],
  create(): Behavior {
    return {
      onUpdate(ctx) {
        const key = str(ctx.params.key, 'Space');
        if (ctx.input.wasPressed(key) && ctx.body && ctx.body.type === BodyType.Dynamic) {
          ctx.body.linearVelocity.y = num(ctx.params.jumpSpeed, 7);
          ctx.body.wake();
        }
      },
    };
  },
};

const pulse: BehaviorDef = {
  type: 'pulse',
  label: 'Pulse Emissive',
  description: 'Animate the emissive intensity (give the material an emissive color).',
  params: [
    { key: 'min', label: 'Min', type: 'number', default: 0.5, step: 0.1 },
    { key: 'max', label: 'Max', type: 'number', default: 3, step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 3, step: 0.1 },
  ],
  create(): Behavior {
    return {
      onUpdate(ctx) {
        const mat = ctx.object.material;
        if (!mat) return;
        const lo = num(ctx.params.min, 0.5);
        const hi = num(ctx.params.max, 3);
        const spd = num(ctx.params.speed, 3);
        const t = Math.sin(ctx.time.elapsed * spd) * 0.5 + 0.5;
        mat.emissiveIntensity = lo + (hi - lo) * t;
      },
    };
  },
};

/** Registry of built-in behaviors (order = inspector dropdown order). */
export const BUILTIN_BEHAVIORS: BehaviorDef[] = [
  spin, hover, orbit, patrol, lookAtCamera, wasd, jump, pulse,
];

const BY_TYPE = new Map<string, BehaviorDef>(BUILTIN_BEHAVIORS.map((b) => [b.type, b]));

/** Look up a built-in behavior definition by its type id. */
export function getBehaviorDef(type: string): BehaviorDef | undefined {
  return BY_TYPE.get(type);
}
