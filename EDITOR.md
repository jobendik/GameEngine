# Aether Editor — internal API contract

The editor is a browser application built ON TOP of the Aether engine (`src/`). It turns the
code-first engine into a visual tool: a viewport, a scene hierarchy, an inspector, transform
gizmos, play mode, and save/load. This file is the single source of truth for the editor's
INTERNAL module boundaries so panels can be implemented independently and link together.

## Layout / DOM (already in `index.html`)

```
#toolbar      (top)     ← Toolbar
#hierarchy    (left)    ← HierarchyPanel  (has a .panel-head already; append a tree)
#viewport     (center)  ← Viewport (contains <canvas id="gl"> + .vp-overlay)
#inspector    (right)   ← InspectorPanel  (has a .panel-head already; append body)
#status       (bottom)  ← status bar text
```

CSS classes for tree/inspector/fields are defined in `index.html` (`.tree .row`, `.group`,
`.field`, `.vec3 .axis.x/.y/.z`, `.slider`, etc.). Reuse them — do not invent new global CSS.

## Core (in `editor/core/`, implemented FIRST — panels import from `@/../editor/core`)

Import in editor code via relative paths (`../core`, `./...`) OR the `@editor/` alias
(configured: `@editor` → `editor/`). Engine imports use the existing `@/` alias.

### Data model — `editor/core/types.ts`
```ts
export type PrimitiveKind = 'box' | 'sphere' | 'plane' | 'cylinder' | 'capsule' | 'torus';
export type LightKind = 'directional' | 'point' | 'spot';
export type BodyKind = 'static' | 'dynamic';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface Vec3Tuple { 0: number; 1: number; 2: number; length: 3 } // use [number,number,number]

export interface TransformData { position: number[]; rotationEuler: number[]; scale: number[] } // euler DEGREES
export interface MaterialData { albedo: number[]; metallic: number; roughness: number; emissive: number[]; emissiveIntensity: number; opacity: number }
export interface LightData { kind: LightKind; color: number[]; intensity: number; range: number; castShadow: boolean; innerCone: number; outerCone: number } // cones DEGREES
export interface BodyData { kind: BodyKind; mass: number; restitution: number; friction: number }
export interface ObjectJSON {
  id: number; name: string;
  transform: TransformData;
  primitive?: PrimitiveKind;     // present => has a mesh
  material?: MaterialData;       // present iff primitive present
  light?: LightData;
  body?: BodyData;
}
export interface EnvironmentData {
  ambient: number[]; sunColor: number[]; sunDirection: number[]; sunIntensity: number; sunCastShadow: boolean;
  fogColor: number[]; fogDensity: number; exposure: number; bloom: boolean; bloomStrength: number;
}
export interface SceneJSON { version: number; nextId: number; environment: EnvironmentData; objects: ObjectJSON[]; }

export type AddSpec =
  | { kind: 'mesh'; primitive: PrimitiveKind; name?: string; position?: number[]; withBody?: boolean; bodyKind?: BodyKind }
  | { kind: 'light'; lightKind: LightKind; name?: string; position?: number[] };
```

### `editor/core/EditorObject.ts`
Wraps one scene entity and its live engine components plus editor metadata.
```ts
class EditorObject {
  readonly id: number;
  name: string;
  readonly entity: Entity;            // ECS entity in ctx.engine.world
  readonly transform: Transform;      // live @/scene Transform (always present)
  primitive?: PrimitiveKind;          // set when it has a mesh
  meshRenderer?: MeshRenderer;        // live, when primitive present
  material?: Material;                // live, when primitive present
  light?: Light;                      // live @/render Light, when a light
  body?: RigidBody;                   // live @/physics body, when physics enabled (NOT auto-added to world here)

  // mutation helpers (update live component + keep editor consistent; caller emits events):
  setPrimitive(kind: PrimitiveKind): void;   // rebuild the mesh from the new primitive
  setLightKind(kind: LightKind): void;
  enableBody(kind: BodyKind): void;          // create body sized from current transform + add to physics world
  disableBody(): void;                       // remove body from physics world
  syncTransformToBody(): void;               // copy transform -> body (edit-time placement)
  syncBodyToTransform(): void;               // copy body -> transform (play-time)
  worldBoundingSphere(outCenter: Vec3): number; // returns radius; for click-selection ray test
  toJSON(): ObjectJSON;
}
```
Construction is done by EditorScene (it owns the engine refs), NOT by panels.

### `editor/core/EditorScene.ts`
Owns the object list + environment + (de)serialization. Holds engine refs.
```ts
class EditorScene {
  readonly objects: EditorObject[];
  environment: EnvironmentData;       // live values; call applyEnvironment() to push to renderer+sun
  constructor(engine: Engine, renderer: Renderer);
  add(spec: AddSpec): EditorObject;   // creates entity+components, adds to world (+physics if body)
  remove(obj: EditorObject): void;    // destroy entity, remove body
  clear(): void;
  find(id: number): EditorObject | undefined;
  applyEnvironment(): void;           // sync environment -> renderer.settings + the managed sun Light
  serialize(): SceneJSON;
  deserialize(json: SceneJSON): void; // clear + rebuild everything
  raycastSelect(originWorld: Vec3, dirWorld: Vec3): EditorObject | null; // nearest object hit (bounding-sphere)
}
```
The scene OWNS a single managed directional "sun" Light entity driven by `environment` (not a
normal EditorObject, not in `objects`, not serialized as an object — it lives in environment).

### `editor/core/EditorContext.ts`
The hub every panel receives in its constructor.
```ts
class EditorContext {
  readonly engine: Engine;
  readonly renderer: Renderer;
  readonly camera: Camera;            // the editor (viewport) camera
  readonly canvas: HTMLCanvasElement;
  readonly scene: EditorScene;
  readonly events: EventBus;          // editor event bus (see events below)
  selection: EditorObject | null;     // read-only-ish; mutate via select()
  mode: 'edit' | 'play';
  gizmoMode: GizmoMode;

  select(obj: EditorObject | null): void;           // emits 'selection'
  add(spec: AddSpec): EditorObject;                 // scene.add + select + emits 'hierarchy'
  delete(obj: EditorObject): void;                  // emits 'hierarchy'
  duplicate(obj: EditorObject): EditorObject;       // emits 'hierarchy'
  rename(obj: EditorObject, name: string): void;    // emits 'hierarchy'
  setGizmoMode(m: GizmoMode): void;                 // emits 'gizmo'
  notifyTransform(obj: EditorObject): void;         // a gizmo/inspector changed transform -> emits 'transform'
  notifyProps(obj: EditorObject): void;             // inspector changed material/light/body -> emits 'props'
  notifyEnvironment(): void;                        // scene env changed -> applyEnvironment + emits 'environment'
  enterPlay(): void; exitPlay(): void; togglePlay(): void;  // emits 'mode'
  newScene(): void; saveToStorage(): void; loadFromStorage(): boolean;
  downloadScene(): void; importSceneJSON(json: SceneJSON): void; loadSample(): void;  // emits 'hierarchy'
  status(msg: string, kind?: 'info' | 'ok' | 'warn'): void; // writes to #status
}
```

### Editor EventBus events (string names + payload)
- `'selection'`  → EditorObject | null
- `'hierarchy'`  → void (structure changed: add/delete/rename/scene load) — Hierarchy + Inspector refresh
- `'transform'`  → EditorObject (position/rot/scale changed) — Inspector refreshes its transform fields, Viewport repositions gizmo
- `'props'`      → EditorObject (material/light/body changed)
- `'environment'`→ void
- `'mode'`       → 'edit' | 'play'
- `'gizmo'`      → GizmoMode

## Panels (each: `constructor(ctx: EditorContext)`, build into its container element)

- `editor/viewport/Viewport.ts` — `class Viewport { constructor(ctx) }`. Owns: editor camera
  ORBIT controller on `ctx.canvas` (LMB orbit around a pivot, RMB/MMB pan, wheel dolly), a ground
  GRID (rendered as engine geometry; NOT a selectable EditorObject), CLICK selection
  (`camera.screenToRay` → `scene.raycastSelect`), and a TRANSLATE/ROTATE/SCALE GIZMO on the
  selection (drag handles to edit `selection.transform`, then `ctx.notifyTransform`). Register an
  EngineModule on `ctx.engine` for per-frame camera/gizmo updates, OR drive from a rAF — but the
  engine loop already runs; prefer registering a module named `'viewport'` whose `update()`
  advances the camera controller and gizmo and whose `lateUpdate()` (play mode) syncs physics
  bodies→transforms. Respect `ctx.mode`: gizmo + selection only in 'edit'.
- `editor/panels/HierarchyPanel.ts` — lists `ctx.scene.objects` as `.tree .row`s with an icon,
  name, and a delete (×) button; clicking a row selects; reflects `ctx.selection` highlight;
  rebuilds on `'hierarchy'`, updates highlight on `'selection'`.
- `editor/panels/InspectorPanel.ts` — when `ctx.selection` is set, shows editable GROUPS:
  Object (name), Transform (position/rotationEuler/scale vec3 fields), Material (albedo color,
  metallic/roughness/emissive/emissiveIntensity/opacity), Light (kind/color/intensity/range/
  cones/castShadow) — only the groups relevant to the object — and a Physics group (enable body,
  kind, mass, restitution, friction). When nothing is selected, shows a SCENE group editing
  `ctx.scene.environment` (ambient, sun color/dir/intensity/shadow, fog, exposure, bloom).
  Writes go straight to the live components; then call the right `ctx.notify*`. Refresh on
  `'selection'`, `'transform'`, `'props'`, `'hierarchy'`, `'environment'`.
- `editor/panels/Toolbar.ts` — buttons: add Cube/Sphere/Plane/Cylinder/Capsule/Torus, add Light
  (menu: directional/point/spot), gizmo mode toggles (Move/Rotate/Scale, bound to W/E/R, reflect
  `ctx.gizmoMode`), Play/Stop (reflect `ctx.mode`), New, Save, Load, Sample, Export(download).
  Also owns the bottom `#status` line via `ctx.status` (or read it from events).

## `editor/main.ts` (the integrator — I write it)
Creates `GLContext`, `Engine`, editor `Camera`, `Renderer`, `RenderSystem`, builds an
`EditorContext`, then instantiates each panel with the ctx, seeds a default scene, and
`engine.start()`. Wires keyboard shortcuts at the app level if needed.

## Rules
- TypeScript strict, no new runtime deps. Reuse the engine via `@/...`.
- Physics must NOT run in edit mode. Bodies are created/sized but only STEPPED in play mode.
  Entering play snapshots `scene.serialize()`; exiting play restores via `deserialize()`.
- The managed sun + the viewport grid/gizmo are engine entities/meshes but are EXCLUDED from
  `scene.objects`, hierarchy, serialization, and click-selection (except gizmo handle picking).
- Inspector edits mutate live components directly; RenderSystem shows them next frame.
- Keep it dependency-free and matching the dark CSS already in `index.html`.
