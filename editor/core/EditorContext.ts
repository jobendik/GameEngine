import { EventBus } from '@/core';
import type { Engine, EngineModule } from '@/core';
import type { Renderer, Camera } from '@/render';
import { Input } from '@/input';
import { ScriptRuntime } from '@editor/script';
import { EditorScene } from './EditorScene';
import type { EditorObject } from './EditorObject';
import { ScriptAsset, MaterialAsset, PrefabAsset } from './AssetLibrary';
import { materialToData } from './materialIO';
import type { AddSpec, EditorMode, GizmoMode, SceneJSON } from './types';
import { defaultEnvironment, defaultMaterial } from './types';

const SCRIPT_ASSET_TEMPLATE =
  `// Reusable script asset — attach it to objects from the Assets panel.\n` +
  `// In scope: dt, time, input, transform, body, object, state, scene, camera, Vec3, Quat, MathUtils\n` +
  `transform.position.y += Math.sin(time.elapsed * 3) * dt;\n`;

const STORAGE_KEY = 'aether.editor.scene';

/** The currently-selected asset (shown in the inspector), tagged by type. */
export type SelectedAsset =
  | { type: 'script'; asset: ScriptAsset }
  | { type: 'material'; asset: MaterialAsset }
  | { type: 'prefab'; asset: PrefabAsset };

/**
 * The editor hub. Owns the engine/renderer/camera/scene and the editor event
 * bus, tracks selection / gizmo mode / play state, and exposes every command
 * the panels invoke. Physics only advances in play mode (an internal engine
 * module steps it), so the scene is static and freely editable in edit mode.
 */
export class EditorContext {
  readonly engine: Engine;
  readonly renderer: Renderer;
  readonly camera: Camera;
  readonly canvas: HTMLCanvasElement;
  readonly scene: EditorScene;
  readonly events = new EventBus();
  /** Keyboard/mouse input available to scripts in play mode. */
  readonly input: Input;

  selection: EditorObject | null = null;
  selectedAsset: SelectedAsset | null = null;
  mode: EditorMode = 'edit';
  gizmoMode: GizmoMode = 'translate';

  private playSnapshot: SceneJSON | null = null;
  private statusEl: HTMLElement | null = null;
  private readonly scripts: ScriptRuntime;

  constructor(engine: Engine, renderer: Renderer, camera: Camera) {
    this.engine = engine;
    this.renderer = renderer;
    this.camera = camera;
    this.canvas = engine.canvas;
    this.scene = new EditorScene(engine, renderer);

    // Input is registered first so its edge detection runs before scripts read it.
    this.input = new Input(engine.canvas);
    engine.use(this.input);

    this.scripts = new ScriptRuntime({
      input: this.input,
      time: engine.time,
      camera,
      scene: this.scene,
      status: (m, k) => this.status(m, k),
    });

    // Internal simulation module: in PLAY mode it advances scripts + physics and
    // syncs bodies→transforms. In edit mode it does nothing, so the scene is
    // static and freely editable.
    const sim: EngineModule = {
      name: 'editor-sim',
      update: (dt: number) => {
        if (this.mode === 'play') this.scripts.update(dt);
      },
      fixedUpdate: (dt: number) => {
        if (this.mode !== 'play') return;
        this.scene.physics.fixedUpdate(dt);
        this.scripts.fixedUpdate(dt);
      },
      lateUpdate: () => {
        if (this.mode !== 'play') return;
        for (const o of this.scene.objects) if (o.body) o.syncBodyToTransform();
      },
    };
    engine.use(sim);
  }

  // ---------------------------------------------------------------------------
  // Selection & editing commands
  // ---------------------------------------------------------------------------

  /** Convenience accessor for the project asset library. */
  get assets() {
    return this.scene.assets;
  }

  select(obj: EditorObject | null): void {
    this.selection = obj;
    if (obj && this.selectedAsset) {
      this.selectedAsset = null;
      this.events.emit('assetSelection', null);
    }
    this.events.emit('selection', obj);
  }

  /** Select an asset to edit it in the inspector (clears object selection). */
  selectAsset(sel: SelectedAsset | null): void {
    this.selectedAsset = sel;
    if (sel && this.selection) {
      this.selection = null;
      this.events.emit('selection', null);
    }
    this.events.emit('assetSelection', sel);
  }

  /** Force the inspector to rebuild (after a structural change it can't detect). */
  refreshInspector(): void {
    this.events.emit('inspector');
  }

  add(spec: AddSpec): EditorObject {
    const obj = this.scene.add(spec);
    this.events.emit('hierarchy');
    this.select(obj);
    this.status(`Added ${obj.name}`, 'ok');
    return obj;
  }

  delete(obj: EditorObject): void {
    const wasSelected = this.selection === obj;
    this.scene.remove(obj);
    if (wasSelected) this.select(null);
    this.events.emit('hierarchy');
    this.status(`Deleted ${obj.name}`);
  }

  duplicate(obj: EditorObject): EditorObject {
    const json = obj.toJSON();
    json.transform.position[0] += 1.2;
    const copy = this.scene.addFromJSON(json);
    this.events.emit('hierarchy');
    this.select(copy);
    return copy;
  }

  rename(obj: EditorObject, name: string): void {
    obj.name = name.trim() || obj.name;
    this.events.emit('hierarchy');
  }

  setGizmoMode(m: GizmoMode): void {
    this.gizmoMode = m;
    this.events.emit('gizmo', m);
  }

  // Change notifications from inspector/gizmo --------------------------------

  notifyTransform(obj: EditorObject): void {
    obj.applyTransform();
    this.events.emit('transform', obj);
  }

  notifyProps(obj: EditorObject): void {
    if (obj.body) obj.refreshBody();
    this.events.emit('props', obj);
  }

  notifyEnvironment(): void {
    this.scene.applyEnvironment();
    this.events.emit('environment');
  }

  // ---------------------------------------------------------------------------
  // Play mode
  // ---------------------------------------------------------------------------

  enterPlay(): void {
    if (this.mode === 'play') return;
    this.playSnapshot = this.scene.serialize();
    // Bodies start from their current placement at rest.
    for (const o of this.scene.objects) if (o.body) o.syncTransformToBody();
    this.mode = 'play';
    this.scripts.start(); // instantiate behaviors + fire onStart
    this.events.emit('mode', this.mode);
    this.status('Playing — physics + scripts running', 'ok');
  }

  exitPlay(): void {
    if (this.mode !== 'play') return;
    this.scripts.stop(); // fire onStop on the live objects before restoring
    this.mode = 'edit';
    if (this.playSnapshot) {
      this.scene.deserialize(this.playSnapshot);
      this.playSnapshot = null;
    }
    this.select(null);
    this.events.emit('mode', this.mode);
    this.events.emit('hierarchy');
    this.status('Stopped — scene restored');
  }

  togglePlay(): void {
    if (this.mode === 'play') this.exitPlay();
    else this.enterPlay();
  }

  // ---------------------------------------------------------------------------
  // Scene file commands
  // ---------------------------------------------------------------------------

  newScene(): void {
    this.scene.clear();
    this.scene.assets.clear();
    this.scene.environment = defaultEnvironment();
    this.scene.applyEnvironment();
    this.selectedAsset = null;
    this.select(null);
    this.events.emit('assets');
    this.events.emit('hierarchy');
    this.events.emit('environment');
    this.status('New scene');
  }

  saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.scene.serialize()));
      this.status('Saved to browser storage', 'ok');
    } catch {
      this.status('Save failed', 'warn');
    }
  }

  loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.status('No saved scene found', 'warn');
        return false;
      }
      this.importSceneJSON(JSON.parse(raw) as SceneJSON);
      this.status('Loaded from browser storage', 'ok');
      return true;
    } catch {
      this.status('Load failed', 'warn');
      return false;
    }
  }

  importSceneJSON(json: SceneJSON): void {
    this.scene.deserialize(json);
    this.selectedAsset = null;
    this.select(null);
    this.events.emit('assets');
    this.events.emit('assetSelection', null);
    this.events.emit('hierarchy');
    this.events.emit('environment');
  }

  // ---------------------------------------------------------------------------
  // Asset library commands
  // ---------------------------------------------------------------------------

  createScriptAsset(): ScriptAsset {
    const name = `Script ${this.assets.scripts.length + 1}`;
    const asset = this.assets.createScript(name, { type: 'custom', code: SCRIPT_ASSET_TEMPLATE });
    this.events.emit('assets');
    this.selectAsset({ type: 'script', asset });
    this.status(`Created ${name}`, 'ok');
    return asset;
  }

  createMaterialAsset(): MaterialAsset {
    const name = `Material ${this.assets.materials.length + 1}`;
    const seed = this.selection?.material ? materialToData(this.selection.material) : defaultMaterial();
    const asset = this.assets.createMaterial(name, seed);
    this.events.emit('assets');
    this.selectAsset({ type: 'material', asset });
    this.status(`Created ${name}`, 'ok');
    return asset;
  }

  createPrefabFromSelection(): PrefabAsset | null {
    if (!this.selection) {
      this.status('Select an object to save as a prefab', 'warn');
      return null;
    }
    const asset = this.assets.createPrefab(this.selection.name, this.selection.toJSON());
    this.events.emit('assets');
    this.status(`Saved prefab "${asset.name}"`, 'ok');
    return asset;
  }

  instantiatePrefab(asset: PrefabAsset): EditorObject {
    const obj = this.scene.addFromJSON(asset.object);
    this.events.emit('hierarchy');
    this.select(obj);
    this.status(`Instantiated "${asset.name}"`, 'ok');
    return obj;
  }

  deleteAsset(sel: SelectedAsset): void {
    if (sel.type === 'material') {
      for (const o of this.scene.objects) {
        if (o.materialAssetId === sel.asset.id) o.unlinkMaterialAsset();
      }
      this.assets.removeMaterial(sel.asset);
    } else if (sel.type === 'script') {
      for (const o of this.scene.objects) {
        o.scripts = o.scripts.filter((s) => s.assetId !== sel.asset.id);
      }
      this.assets.removeScript(sel.asset);
    } else {
      this.assets.removePrefab(sel.asset);
    }
    if (this.selectedAsset?.asset === sel.asset) this.selectAsset(null);
    this.events.emit('assets');
    this.status('Deleted asset');
  }

  /** Attach a Script asset reference to an object (default: the selection). */
  attachScriptAsset(asset: ScriptAsset, target?: EditorObject): void {
    const obj = target ?? this.selection;
    if (!obj) { this.status('Select an object first', 'warn'); return; }
    obj.scripts.push({ type: asset.script.type, assetId: asset.id });
    this.refreshInspector();
    this.status(`Attached "${asset.name}" to ${obj.name}`, 'ok');
  }

  /** Link a Material asset to an object (default: the selection). */
  assignMaterialAsset(asset: MaterialAsset, target?: EditorObject): void {
    const obj = target ?? this.selection;
    if (!obj || !obj.meshRenderer) { this.status('Select a mesh object first', 'warn'); return; }
    obj.linkMaterialAsset(asset);
    this.refreshInspector();
    this.status(`Assigned "${asset.name}" to ${obj.name}`, 'ok');
  }

  renameAsset(sel: SelectedAsset, name: string): void {
    sel.asset.name = name.trim() || sel.asset.name;
    this.events.emit('assets');
  }

  downloadScene(): void {
    const data = JSON.stringify(this.scene.serialize(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aether-scene.json';
    a.click();
    URL.revokeObjectURL(url);
    this.status('Exported aether-scene.json', 'ok');
  }

  loadSample(): void {
    this.scene.clear();
    this.scene.assets.clear();
    this.scene.environment = defaultEnvironment();
    this.scene.environment.fogDensity = 0.01;
    this.scene.applyEnvironment();
    this.buildSample();
    this.selectedAsset = null;
    this.select(null);
    this.events.emit('assets');
    this.events.emit('hierarchy');
    this.events.emit('environment');
    this.status('Loaded sample scene', 'ok');
  }

  /** A small physics-ready scene + a few assets to populate the Assets panel. */
  private buildSample(): void {
    const ground = this.scene.add({ kind: 'mesh', primitive: 'plane', name: 'Ground', position: [0, 0, 0], withBody: true, bodyKind: 'static' });
    ground.transform.scale.set(24, 1, 24);
    ground.material?.albedo.set(0.18, 0.19, 0.22, 1);
    if (ground.material) ground.material.roughness = 0.85;
    ground.refreshBody();

    // A stack of crates that all SHARE one "Wood" material asset.
    const wood = this.assets.createMaterial('Wood', {
      albedo: [0.45, 0.32, 0.18], metallic: 0, roughness: 0.82, emissive: [0, 0, 0], emissiveIntensity: 1, opacity: 1,
    });
    for (let i = 0; i < 4; i++) {
      const c = this.scene.add({ kind: 'mesh', primitive: 'box', name: `Crate ${i + 1}`, position: [0, 0.5 + i * 1.02, 0], withBody: true, bodyKind: 'dynamic' });
      c.linkMaterialAsset(wood);
    }

    // A spinning coin: a "Gold" material asset + a "Fast Spinner" script asset.
    const gold = this.assets.createMaterial('Gold', {
      albedo: [1.0, 0.78, 0.34], metallic: 1, roughness: 0.25, emissive: [0, 0, 0], emissiveIntensity: 1, opacity: 1,
    });
    const spinner = this.assets.createScript('Fast Spinner', { type: 'spin', params: { speed: 160, axis: [0, 1, 0] } });
    const coin = this.scene.add({ kind: 'mesh', primitive: 'cylinder', name: 'Coin', position: [-4.5, 1.4, -3] });
    coin.transform.scale.set(1.3, 0.16, 1.3);
    coin.applyTransform();
    coin.linkMaterialAsset(gold);
    coin.scripts = [{ type: spinner.script.type, assetId: spinner.id }];

    // A couple of metal balls to drop.
    const ball1 = this.scene.add({ kind: 'mesh', primitive: 'sphere', name: 'Steel Ball', position: [-2.5, 4, 1.5], withBody: true, bodyKind: 'dynamic' });
    if (ball1.material) { ball1.material.metallic = 1; ball1.material.roughness = 0.25; ball1.material.albedo.set(0.9, 0.9, 0.95, 1); }
    const ball2 = this.scene.add({ kind: 'mesh', primitive: 'sphere', name: 'Red Ball', position: [2.2, 5, -1], withBody: true, bodyKind: 'dynamic' });
    if (ball2.material) { ball2.material.metallic = 0.1; ball2.material.roughness = 0.4; ball2.material.albedo.set(0.85, 0.2, 0.18, 1); }

    // A glowing emissive ring centerpiece (no physics).
    const ring = this.scene.add({ kind: 'mesh', primitive: 'torus', name: 'Energy Ring', position: [0, 3.6, 0] });
    if (ring.material) {
      ring.material.emissive.set(0.2, 0.9, 1.2, 1);
      ring.material.emissiveIntensity = 2.2;
      ring.material.metallic = 0.4;
      ring.material.roughness = 0.3;
    }
    ring.transform.scale.set(2.2, 2.2, 2.2);
    ring.rotationEuler = [80, 0, 0];
    ring.applyTransform();
    // Scripts make it a "game" object: it spins and pulses in play mode.
    ring.scripts = [
      { type: 'spin', params: { speed: 70, axis: [1, 0, 0] } },
      { type: 'pulse', params: { min: 1.4, max: 3.2, speed: 2.2 } },
    ];

    // A warm point light.
    const lamp = this.scene.add({ kind: 'light', lightKind: 'point', name: 'Lamp', position: [3, 4, 3] });
    if (lamp.light) { lamp.light.color.set(1.0, 0.7, 0.4, 1); lamp.light.intensity = 14; lamp.light.range = 22; }
  }

  // ---------------------------------------------------------------------------

  status(msg: string, kind: 'info' | 'ok' | 'warn' = 'info'): void {
    if (!this.statusEl) this.statusEl = document.getElementById('status');
    if (!this.statusEl) return;
    const cls = kind === 'ok' ? 'ok' : kind === 'warn' ? 'accent' : '';
    this.statusEl.innerHTML = `<span class="${cls}">${escapeHtml(msg)}</span>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
