import { Vec3, MathUtils } from '@/core/math';
import type { World, Entity } from '@/core/ecs';
import { Material, Light, LightType, Primitives } from '@/render';
import type { Renderer, Mesh } from '@/render';
import type { GeometryData } from '@/render';
import { PhysicsWorld, RigidBody, BodyType } from '@/physics';
import type { ColliderShape } from '@/physics';
import { Transform, MeshRenderer } from '@/scene';
import { materialFromData, materialToData } from './materialIO';
import type { AssetLibrary, MaterialAsset } from './AssetLibrary';
import type {
  AddSpec, ObjectJSON, PrimitiveKind, LightKind, BodyKind, LightData, ScriptData,
} from './types';
import { defaultMaterial, defaultLight } from './types';

/** Engine handles an EditorObject needs to build/destroy its live components. */
export interface EditorDeps {
  world: World;
  renderer: Renderer;
  physics: PhysicsWorld;
  assets: AssetLibrary;
}

const D2R = MathUtils.DEG2RAD;
const R2D = MathUtils.RAD2DEG;

/**
 * One object in the editor scene: a thin wrapper around an ECS entity and its
 * live engine components (Transform / MeshRenderer+Material / Light / RigidBody)
 * plus editor metadata (name, primitive kind, Euler rotation source-of-truth).
 *
 * Inspector and gizmo mutate the live components (or this object's helpers); the
 * RenderSystem renders the result next frame. {@link toJSON} captures everything
 * for save/load.
 */
export class EditorObject {
  readonly id: number;
  name: string;
  readonly entity: Entity;
  readonly transform: Transform;

  /** Euler rotation in DEGREES — the editable source of truth (avoids quat↔euler drift). */
  rotationEuler: [number, number, number] = [0, 0, 0];

  /** Attached script/behavior components (run in play mode). */
  scripts: ScriptData[] = [];

  /** If set, this object shares a Material asset (its `material` is the asset's). */
  materialAssetId?: number;

  primitive?: PrimitiveKind;
  meshRenderer?: MeshRenderer;
  material?: Material;
  light?: Light;
  body?: RigidBody;

  private readonly deps: EditorDeps;

  private constructor(id: number, name: string, entity: Entity, transform: Transform, deps: EditorDeps) {
    this.id = id;
    this.name = name;
    this.entity = entity;
    this.transform = transform;
    this.deps = deps;
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  static create(deps: EditorDeps, spec: AddSpec, id: number): EditorObject {
    const entity = deps.world.createEntity();
    const transform = deps.world.add(entity, new Transform());
    const p = spec.position ?? [0, 0, 0];
    transform.position.set(p[0], p[1], p[2]);

    const name = spec.name ?? (spec.kind === 'mesh' ? capitalize(spec.primitive) : capitalize(spec.lightKind) + ' Light');
    const obj = new EditorObject(id, name, entity, transform, deps);

    if (spec.kind === 'mesh') {
      obj.attachMesh(spec.primitive, materialFromData(defaultMaterial()));
      if (spec.withBody) obj.enableBody(spec.bodyKind ?? 'dynamic');
    } else {
      obj.attachLight(lightFromData(defaultLight(spec.lightKind)));
    }
    obj.applyTransform();
    return obj;
  }

  static fromJSON(deps: EditorDeps, json: ObjectJSON): EditorObject {
    const entity = deps.world.createEntity();
    const transform = deps.world.add(entity, new Transform());
    const t = json.transform;
    transform.position.set(t.position[0], t.position[1], t.position[2]);
    transform.scale.set(t.scale[0], t.scale[1], t.scale[2]);

    const obj = new EditorObject(json.id, json.name, entity, transform, deps);
    obj.rotationEuler = [t.rotationEuler[0], t.rotationEuler[1], t.rotationEuler[2]];

    if (json.primitive) {
      obj.attachMesh(json.primitive, materialFromData(json.material ?? defaultMaterial()));
    }
    if (json.light) {
      obj.attachLight(lightFromData(json.light));
    }
    if (json.body) {
      obj.enableBody(json.body.kind);
      if (obj.body) {
        obj.body.mass = json.body.kind === 'static' ? 0 : json.body.mass;
        obj.body.restitution = json.body.restitution;
        obj.body.friction = json.body.friction;
        obj.body.computeMassProperties();
      }
    }
    obj.scripts = json.scripts ? (JSON.parse(JSON.stringify(json.scripts)) as ScriptData[]) : [];
    // Link a shared material asset if referenced (assets are deserialized first).
    if (json.primitive && json.materialAssetId !== undefined) {
      const asset = deps.assets.findMaterial(json.materialAssetId);
      if (asset) obj.linkMaterialAsset(asset);
    }
    obj.applyTransform();
    return obj;
  }

  private attachMesh(primitive: PrimitiveKind, material: Material): void {
    this.primitive = primitive;
    this.material = material;
    const mesh = this.deps.renderer.createMesh(buildGeometry(primitive));
    this.meshRenderer = this.deps.world.add(this.entity, new MeshRenderer(mesh, material));
  }

  private attachLight(light: Light): void {
    this.light = this.deps.world.add(this.entity, light);
  }

  // ---------------------------------------------------------------------------
  // Mutation (called by inspector / gizmo, then ctx.notify*)
  // ---------------------------------------------------------------------------

  /** Recompute the quaternion from {@link rotationEuler} and sync the body. */
  applyTransform(): void {
    this.transform.rotation.setFromEuler(
      this.rotationEuler[0] * D2R,
      this.rotationEuler[1] * D2R,
      this.rotationEuler[2] * D2R,
    );
    this.transform.updateMatrix();
    if (this.body) this.syncTransformToBody();
  }

  /** Swap the mesh geometry to a different primitive (keeps material + transform). */
  setPrimitive(kind: PrimitiveKind): void {
    if (!this.meshRenderer) return;
    const old = this.meshRenderer.mesh;
    this.meshRenderer.mesh = this.deps.renderer.createMesh(buildGeometry(kind));
    this.primitive = kind;
    old.dispose();
    if (this.body) this.refreshBody();
  }

  setLightKind(kind: LightKind): void {
    if (this.light) this.light.type = lightTypeOf(kind);
  }

  /** Create a rigid body sized from the current transform and add it to physics. */
  enableBody(kind: BodyKind): void {
    if (this.body) return;
    const shape = this.buildShape(kind);
    const type = kind === 'static' ? BodyType.Static : BodyType.Dynamic;
    const body = new RigidBody(shape, type, 1);
    this.body = this.deps.physics.addBody(body);
    this.syncTransformToBody();
  }

  disableBody(): void {
    if (!this.body) return;
    this.deps.physics.removeBody(this.body);
    this.body = undefined;
  }

  /** Share a Material asset: this object renders with the asset's live material. */
  linkMaterialAsset(asset: MaterialAsset): void {
    if (!this.meshRenderer) return;
    this.materialAssetId = asset.id;
    this.material = asset.material;
    this.meshRenderer.material = asset.material;
  }

  /** Stop sharing: clone the current material into an independent copy. */
  unlinkMaterialAsset(): void {
    if (!this.meshRenderer || this.materialAssetId === undefined || !this.material) return;
    const indep = materialFromData(materialToData(this.material));
    this.material = indep;
    this.meshRenderer.material = indep;
    this.materialAssetId = undefined;
  }

  /** Switch an existing body between static/dynamic. */
  setBodyKind(kind: BodyKind): void {
    if (!this.body) return;
    this.body.type = kind === 'static' ? BodyType.Static : BodyType.Dynamic;
    if (kind === 'static') this.body.mass = 0;
    else if (this.body.mass <= 0) this.body.mass = 1;
    this.refreshBody();
  }

  /** Rebuild the collider from the current scale and recompute mass properties. */
  refreshBody(): void {
    if (!this.body) return;
    const kind: BodyKind = this.body.type === BodyType.Static ? 'static' : 'dynamic';
    this.body.shape = this.buildShape(kind);
    this.body.computeMassProperties();
    this.syncTransformToBody();
  }

  syncTransformToBody(): void {
    if (!this.body) return;
    this.body.position.copy(this.transform.position);
    this.body.orientation.copy(this.transform.rotation);
    this.body.linearVelocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.updateWorldMatrix();
    this.body.wake();
  }

  /** Copy simulated body state back into the transform (play mode). */
  syncBodyToTransform(): void {
    if (!this.body) return;
    this.transform.position.copy(this.body.position);
    this.transform.rotation.copy(this.body.orientation);
  }

  private buildShape(kind: BodyKind): ColliderShape {
    const s = this.transform.scale;
    const sx = Math.abs(s.x), sy = Math.abs(s.y), sz = Math.abs(s.z);
    switch (this.primitive) {
      case 'sphere':
      case 'torus':
        return { kind: 'sphere', radius: 0.5 * Math.max(sx, sy, sz) };
      case 'capsule':
        return { kind: 'capsule', radius: 0.4 * Math.max(sx, sz), height: 0.6 * sy };
      case 'plane':
        if (kind === 'static') {
          return { kind: 'plane', normal: new Vec3(0, 1, 0), constant: this.transform.position.y };
        }
        return { kind: 'box', halfExtents: new Vec3(0.5 * sx, 0.02, 0.5 * sz) };
      case 'box':
      case 'cylinder':
      default:
        return { kind: 'box', halfExtents: new Vec3(0.5 * sx, 0.5 * sy, 0.5 * sz) };
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** World-space bounding sphere for click-selection. Returns the radius. */
  worldBoundingSphere(outCenter: Vec3): number {
    this.transform.updateMatrix();
    this.transform.worldMatrix.getPosition(outCenter);
    const s = this.transform.scale;
    const maxScale = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    if (this.meshRenderer) {
      const b = this.meshRenderer.mesh.bounds;
      outCenter.x += b.center.x * s.x;
      outCenter.y += b.center.y * s.y;
      outCenter.z += b.center.z * s.z;
      return Math.max(0.05, b.radius * maxScale);
    }
    return 0.6; // lights & empties get a clickable handle radius
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toJSON(): ObjectJSON {
    const t = this.transform;
    const json: ObjectJSON = {
      id: this.id,
      name: this.name,
      transform: {
        position: [t.position.x, t.position.y, t.position.z],
        rotationEuler: [this.rotationEuler[0], this.rotationEuler[1], this.rotationEuler[2]],
        scale: [t.scale.x, t.scale.y, t.scale.z],
      },
    };
    if (this.primitive && this.material) {
      json.primitive = this.primitive;
      // A linked material asset is referenced by id; an inline one is embedded.
      if (this.materialAssetId !== undefined) {
        json.materialAssetId = this.materialAssetId;
      } else {
        json.material = materialToData(this.material);
      }
    }
    if (this.light) {
      json.light = {
        kind: lightKindOf(this.light.type),
        color: [this.light.color.r, this.light.color.g, this.light.color.b],
        intensity: this.light.intensity,
        range: this.light.range,
        castShadow: this.light.castShadow,
        innerCone: this.light.innerCone * R2D,
        outerCone: this.light.outerCone * R2D,
      };
    }
    if (this.body) {
      json.body = {
        kind: this.body.type === BodyType.Static ? 'static' : 'dynamic',
        mass: this.body.mass,
        restitution: this.body.restitution,
        friction: this.body.friction,
      };
    }
    if (this.scripts.length > 0) {
      json.scripts = JSON.parse(JSON.stringify(this.scripts)) as ScriptData[];
    }
    return json;
  }

  /** Destroy the entity and remove the body. */
  destroy(): void {
    if (this.body) this.deps.physics.removeBody(this.body);
    if (this.meshRenderer) this.meshRenderer.mesh.dispose();
    this.deps.world.destroyEntity(this.entity);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildGeometry(kind: PrimitiveKind): GeometryData {
  switch (kind) {
    case 'box': return Primitives.box(1, 1, 1);
    case 'sphere': return Primitives.sphere(0.5, 32);
    case 'plane': return Primitives.plane(1, 1, 1);
    case 'cylinder': return Primitives.cylinder(0.5, 1, 32);
    case 'capsule': return Primitives.capsule(0.4, 0.6, 24);
    case 'torus': return Primitives.torus(0.5, 0.18, 48, 24);
  }
}

function lightFromData(l: LightData): Light {
  const light = new Light(lightTypeOf(l.kind));
  light.color.set(l.color[0], l.color[1], l.color[2], 1);
  light.intensity = l.intensity;
  light.range = l.range;
  light.castShadow = l.castShadow;
  light.innerCone = l.innerCone * D2R;
  light.outerCone = l.outerCone * D2R;
  return light;
}

function lightTypeOf(kind: LightKind): LightType {
  return kind === 'directional' ? LightType.Directional : kind === 'point' ? LightType.Point : LightType.Spot;
}

function lightKindOf(type: LightType): LightKind {
  return type === LightType.Directional ? 'directional' : type === LightType.Point ? 'point' : 'spot';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
