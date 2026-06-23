import { Vec3, Color } from '@/core/math';
import type { Engine } from '@/core';
import { Light, LightType } from '@/render';
import type { Renderer } from '@/render';
import { PhysicsWorld } from '@/physics';
import { EditorObject } from './EditorObject';
import type { EditorDeps } from './EditorObject';
import type { AddSpec, EnvironmentData, ObjectJSON, SceneJSON } from './types';
import { SCENE_VERSION, defaultEnvironment } from './types';

const _v = new Vec3();

/**
 * The editable scene: the list of {@link EditorObject}s, the global environment
 * (ambient/sun/fog/post settings), a managed directional "sun" light, and
 * (de)serialization. It owns the engine handles so it can build and tear down
 * live components.
 */
export class EditorScene {
  readonly objects: EditorObject[] = [];
  environment: EnvironmentData = defaultEnvironment();

  readonly physics: PhysicsWorld;
  private readonly deps: EditorDeps;
  private readonly renderer: Renderer;
  private nextId = 1;

  /** Managed sun (not a selectable object; serialized inside `environment`). */
  private readonly sun: Light;

  constructor(engine: Engine, renderer: Renderer) {
    this.renderer = renderer;
    this.physics = new PhysicsWorld();
    this.deps = { world: engine.world, renderer, physics: this.physics };

    // Managed sun: a directional Light entity the RenderSystem will pick up.
    this.sun = new Light(LightType.Directional);
    engine.world.add(engine.world.createEntity(), this.sun);

    this.applyEnvironment();
  }

  // ---------------------------------------------------------------------------

  add(spec: AddSpec): EditorObject {
    const obj = EditorObject.create(this.deps, spec, this.nextId++);
    this.objects.push(obj);
    return obj;
  }

  /** Build an object from JSON, assigning it a fresh id (used for duplicate). */
  addFromJSON(json: ObjectJSON): EditorObject {
    const copy: ObjectJSON = { ...json, id: this.nextId++ };
    const obj = EditorObject.fromJSON(this.deps, copy);
    this.objects.push(obj);
    return obj;
  }

  remove(obj: EditorObject): void {
    const i = this.objects.indexOf(obj);
    if (i === -1) return;
    this.objects.splice(i, 1);
    obj.destroy();
  }

  clear(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
  }

  find(id: number): EditorObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  /** Push `environment` into the renderer settings and the managed sun light. */
  applyEnvironment(): void {
    const e = this.environment;
    const s = this.renderer.settings;
    s.ambient = new Color(e.ambient[0], e.ambient[1], e.ambient[2]);
    s.fogColor = new Color(e.fogColor[0], e.fogColor[1], e.fogColor[2]);
    s.fogDensity = e.fogDensity;
    s.exposure = e.exposure;
    s.bloom = e.bloom;
    s.bloomStrength = e.bloomStrength;
    s.shadows = true;

    this.sun.color.set(e.sunColor[0], e.sunColor[1], e.sunColor[2], 1);
    this.sun.intensity = e.sunIntensity;
    this.sun.direction.set(e.sunDirection[0], e.sunDirection[1], e.sunDirection[2]).normalize();
    this.sun.castShadow = e.sunCastShadow;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  serialize(): SceneJSON {
    return {
      version: SCENE_VERSION,
      nextId: this.nextId,
      environment: JSON.parse(JSON.stringify(this.environment)) as EnvironmentData,
      objects: this.objects.map((o) => o.toJSON()),
    };
  }

  deserialize(json: SceneJSON): void {
    this.clear();
    this.environment = mergeEnvironment(json.environment);
    this.applyEnvironment();
    for (const oj of json.objects) {
      this.objects.push(EditorObject.fromJSON(this.deps, oj as ObjectJSON));
    }
    this.nextId = Math.max(json.nextId ?? 1, this.maxId() + 1);
  }

  private maxId(): number {
    let m = 0;
    for (const o of this.objects) if (o.id > m) m = o.id;
    return m;
  }

  // ---------------------------------------------------------------------------
  // Selection raycast (against bounding spheres)
  // ---------------------------------------------------------------------------

  /** Nearest object whose bounding sphere the ray (origin, unit dir) hits. */
  raycastSelect(origin: Vec3, dir: Vec3): EditorObject | null {
    let best = Infinity;
    let hit: EditorObject | null = null;
    for (const obj of this.objects) {
      const r = obj.worldBoundingSphere(_v);
      const t = raySphere(origin, dir, _v, r);
      if (t >= 0 && t < best) {
        best = t;
        hit = obj;
      }
    }
    return hit;
  }
}

/** Ray vs sphere; returns nearest non-negative t, or -1. Dir must be unit. */
function raySphere(o: Vec3, d: Vec3, c: Vec3, radius: number): number {
  const ocx = o.x - c.x, ocy = o.y - c.y, ocz = o.z - c.z;
  const b = ocx * d.x + ocy * d.y + ocz * d.z;
  const cc = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  if (cc > 0 && b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** Fill any missing environment fields from defaults (forward-compatible load). */
function mergeEnvironment(e: Partial<EnvironmentData> | undefined): EnvironmentData {
  return { ...defaultEnvironment(), ...(e ?? {}) };
}
