import { Material } from '@/render';
import { materialFromData, materialToData } from './materialIO';
import { defaultMaterial } from './types';
import type {
  AssetsJSON, MaterialData, ObjectJSON, ScriptData,
} from './types';

/** A reusable, named custom/preset script. Objects reference it by `id`. */
export class ScriptAsset {
  constructor(public id: number, public name: string, public script: ScriptData) {}
}

/** A reusable, named material. Objects that use it SHARE this live instance. */
export class MaterialAsset {
  readonly material: Material;
  constructor(public id: number, public name: string, material: Material) {
    this.material = material;
  }
}

/** A saved object template that can be instantiated into the scene. */
export class PrefabAsset {
  constructor(public id: number, public name: string, public object: ObjectJSON) {}
}

/**
 * The project asset library shown in the Assets panel: reusable scripts,
 * shared materials, and prefabs. Owned by the {@link EditorScene} and serialized
 * with the scene so assets persist and resolve on load (before objects).
 */
export class AssetLibrary {
  readonly scripts: ScriptAsset[] = [];
  readonly materials: MaterialAsset[] = [];
  readonly prefabs: PrefabAsset[] = [];
  private nextId = 1;

  // ---- create ----

  createScript(name: string, script?: ScriptData): ScriptAsset {
    const a = new ScriptAsset(this.nextId++, name, script ?? { type: 'custom', code: '' });
    this.scripts.push(a);
    return a;
  }

  createMaterial(name: string, data?: MaterialData): MaterialAsset {
    const a = new MaterialAsset(this.nextId++, name, materialFromData(data ?? defaultMaterial()));
    this.materials.push(a);
    return a;
  }

  createPrefab(name: string, object: ObjectJSON): PrefabAsset {
    const a = new PrefabAsset(this.nextId++, name, clone(object));
    this.prefabs.push(a);
    return a;
  }

  // ---- remove ----

  removeScript(a: ScriptAsset): void { pull(this.scripts, a); }
  removeMaterial(a: MaterialAsset): void { pull(this.materials, a); }
  removePrefab(a: PrefabAsset): void { pull(this.prefabs, a); }

  // ---- lookup ----

  findScript(id: number): ScriptAsset | undefined { return this.scripts.find((a) => a.id === id); }
  findMaterial(id: number): MaterialAsset | undefined { return this.materials.find((a) => a.id === id); }
  findPrefab(id: number): PrefabAsset | undefined { return this.prefabs.find((a) => a.id === id); }

  get total(): number { return this.scripts.length + this.materials.length + this.prefabs.length; }

  clear(): void {
    this.scripts.length = 0;
    this.materials.length = 0;
    this.prefabs.length = 0;
  }

  // ---- (de)serialization ----

  serialize(): AssetsJSON {
    return {
      nextId: this.nextId,
      scripts: this.scripts.map((a) => ({ id: a.id, name: a.name, script: clone(a.script) })),
      materials: this.materials.map((a) => ({ id: a.id, name: a.name, material: materialToData(a.material) })),
      prefabs: this.prefabs.map((a) => ({ id: a.id, name: a.name, object: clone(a.object) })),
    };
  }

  deserialize(json: AssetsJSON | undefined): void {
    this.clear();
    if (!json) { this.nextId = 1; return; }
    for (const s of json.scripts ?? []) this.scripts.push(new ScriptAsset(s.id, s.name, clone(s.script)));
    for (const m of json.materials ?? []) this.materials.push(new MaterialAsset(m.id, m.name, materialFromData(m.material)));
    for (const p of json.prefabs ?? []) this.prefabs.push(new PrefabAsset(p.id, p.name, clone(p.object)));
    this.nextId = Math.max(json.nextId ?? 1, this.maxId() + 1);
  }

  private maxId(): number {
    let m = 0;
    for (const a of this.scripts) m = Math.max(m, a.id);
    for (const a of this.materials) m = Math.max(m, a.id);
    for (const a of this.prefabs) m = Math.max(m, a.id);
    return m;
  }
}

function pull<T>(arr: T[], item: T): void {
  const i = arr.indexOf(item);
  if (i !== -1) arr.splice(i, 1);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
