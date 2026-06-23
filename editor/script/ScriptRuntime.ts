import type { Time } from '@/core';
import type { Camera } from '@/render';
import type { Input } from '@/input';
import type { EditorScene, EditorObject, ScriptData } from '@editor/core';
import type { Behavior, ScriptContext, ParamValue } from './types';
import { getBehaviorDef } from './behaviors';
import { createCustomBehavior } from './custom';

/** Services a {@link ScriptRuntime} needs to build script contexts. */
export interface ScriptDeps {
  input: Input;
  time: Time;
  camera: Camera;
  scene: EditorScene;
  status?: (msg: string, kind?: 'warn') => void;
}

interface Instance {
  behavior: Behavior;
  ctx: ScriptContext;
  dead: boolean;
}

/**
 * Runs object behaviors during play mode. {@link start} instantiates a behavior
 * per enabled script across the scene and fires `onStart`; {@link update} /
 * {@link fixedUpdate} drive the per-frame hooks; {@link stop} fires `onStop` and
 * discards everything. A throwing script is caught, reported once, and disabled
 * so one bad script never breaks the loop.
 */
export class ScriptRuntime {
  private instances: Instance[] = [];
  private running = false;
  private readonly deps: ScriptDeps;

  constructor(deps: ScriptDeps) {
    this.deps = deps;
  }

  get active(): boolean {
    return this.running;
  }

  /** Build behavior instances for every enabled script and run `onStart`. */
  start(): void {
    this.instances = [];
    for (const obj of this.deps.scene.objects) {
      if (!obj.scripts) continue;
      for (const sd of obj.scripts) {
        if (sd.enabled === false) continue;
        const behavior = this.build(sd);
        if (!behavior) continue;
        this.instances.push({ behavior, ctx: this.makeContext(obj, sd), dead: false });
      }
    }
    this.running = true;
    for (const i of this.instances) this.safe(i, () => i.behavior.onStart?.(i.ctx));
  }

  update(dt: number): void {
    if (!this.running) return;
    for (const i of this.instances) this.safe(i, () => i.behavior.onUpdate?.(i.ctx, dt));
  }

  fixedUpdate(dt: number): void {
    if (!this.running) return;
    for (const i of this.instances) this.safe(i, () => i.behavior.onFixedUpdate?.(i.ctx, dt));
  }

  /** Run `onStop` on every instance and clear them. */
  stop(): void {
    if (!this.running) return;
    for (const i of this.instances) this.safe(i, () => i.behavior.onStop?.(i.ctx));
    this.instances = [];
    this.running = false;
  }

  // ---- internals ----

  private build(sd: ScriptData): Behavior | null {
    if (sd.type === 'custom') {
      return createCustomBehavior(sd.code ?? '', (m) => this.deps.status?.(m, 'warn'));
    }
    const def = getBehaviorDef(sd.type);
    return def ? def.create() : null;
  }

  private makeContext(obj: EditorObject, sd: ScriptData): ScriptContext {
    return {
      object: obj,
      transform: obj.transform,
      body: obj.body ?? null,
      params: this.resolveParams(sd),
      state: {},
      input: this.deps.input,
      time: this.deps.time,
      camera: this.deps.camera,
      scene: this.deps.scene,
    };
  }

  /** Merge a behavior's declared defaults with the saved param overrides. */
  private resolveParams(sd: ScriptData): Record<string, ParamValue> {
    const out: Record<string, ParamValue> = {};
    if (sd.type !== 'custom') {
      const def = getBehaviorDef(sd.type);
      if (def) for (const p of def.params) out[p.key] = p.default;
    }
    if (sd.params) for (const k in sd.params) out[k] = sd.params[k];
    return out;
  }

  private safe(i: Instance, fn: () => void): void {
    if (i.dead) return;
    try {
      fn();
    } catch (e) {
      i.dead = true;
      this.deps.status?.(`Script error: ${(e as Error).message ?? e}`, 'warn');
    }
  }
}
