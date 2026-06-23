import { EventBus } from '@/core';
import type { Engine, EngineModule } from '@/core';
import type { Renderer, Camera } from '@/render';
import { Input } from '@/input';
import { ScriptRuntime } from '@editor/script';
import { EditorScene } from './EditorScene';
import type { EditorObject } from './EditorObject';
import type { AddSpec, EditorMode, GizmoMode, SceneJSON } from './types';
import { defaultEnvironment } from './types';

const STORAGE_KEY = 'aether.editor.scene';

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

  select(obj: EditorObject | null): void {
    this.selection = obj;
    this.events.emit('selection', obj);
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
    this.scene.environment = defaultEnvironment();
    this.scene.applyEnvironment();
    this.select(null);
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
    this.select(null);
    this.events.emit('hierarchy');
    this.events.emit('environment');
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
    this.scene.environment = defaultEnvironment();
    this.scene.environment.fogDensity = 0.01;
    this.scene.applyEnvironment();
    this.buildSample();
    this.select(null);
    this.events.emit('hierarchy');
    this.events.emit('environment');
    this.status('Loaded sample scene', 'ok');
  }

  /** A small physics-ready scene: floor, a stack, some balls and lights. */
  private buildSample(): void {
    const ground = this.scene.add({ kind: 'mesh', primitive: 'plane', name: 'Ground', position: [0, 0, 0], withBody: true, bodyKind: 'static' });
    ground.transform.scale.set(24, 1, 24);
    ground.material?.albedo.set(0.18, 0.19, 0.22, 1);
    if (ground.material) ground.material.roughness = 0.85;
    ground.refreshBody();

    // A stack of crates.
    const brown: [number, number, number] = [0.45, 0.32, 0.18];
    for (let i = 0; i < 4; i++) {
      const c = this.scene.add({ kind: 'mesh', primitive: 'box', name: `Crate ${i + 1}`, position: [0, 0.5 + i * 1.02, 0], withBody: true, bodyKind: 'dynamic' });
      c.material?.albedo.set(brown[0], brown[1], brown[2], 1);
      if (c.material) c.material.roughness = 0.8;
    }

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
