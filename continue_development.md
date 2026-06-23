# Aether — Continue Development

The forward-looking roadmap for the Aether engine + editor. The **Master Checklist** below is the
working to-do; the **Detailed Roadmap** explains each item (what / why / how / dependencies /
current state). Check items off as they land.

**Legend** — Priority: 🔴 P0 (foundational, highest impact) · 🟡 P1 (important) · 🟢 P2 (advanced / nice-to-have).
Items marked _(partial)_ have a foundation in place that needs completion.

> Verify every change the way the rest of the project does: `npm run build` (tsc strict + vite) must
> stay green, and drive real behavior through the headless WebGL2 (SwiftShader) harness in
> `.aether-build/` (see `smoke.mjs` / `editor-test.mjs` / `asset-test.mjs`). Keep zero runtime deps
> unless a feature genuinely requires one. Big features: lock a contract first, then fan out.

---

## Master Checklist

### 0. Editor UX core (do these first — they unblock everything else)
- [ ] 🔴 Undo / redo system (command stack; every mutation goes through it)
- [ ] 🔴 Multi-select (marquee + ctrl/shift click; multi-object gizmo + inspector multi-edit)
- [ ] 🔴 Hierarchy parenting (drag-to-reparent; expose `Transform.parent`; transform hierarchy)
- [ ] 🔴 Console / log panel (capture console + engine warnings + script errors)
- [ ] 🔴 Copy / paste / cut of objects (and component values)
- [ ] 🟡 Context menus (right-click in hierarchy / viewport / assets)
- [ ] 🟡 Gizmo snapping (grid translate, angle rotate, step scale) + local/world toggle + pivot/center
- [ ] 🟡 Frame-selected (F), camera bookmarks, ortho views (top/front/side), fly camera
- [ ] 🟡 Resizable / dockable panels + layout persistence + editor preferences
- [ ] 🟡 Command palette + customizable keyboard shortcuts
- [ ] 🟡 Object search / filter in hierarchy; rename in-place; reorder
- [ ] 🟡 Play-mode controls: pause, step-frame, maximize-on-play, play-from-here
- [ ] 🟢 Notifications / toasts; modal dialogs; confirmation prompts
- [ ] 🟢 Viewport object icons (light/camera/audio gizmos) + view cube + grid settings
- [ ] 🟢 Theme options + localization of the editor UI

### 1. Asset pipeline & importers
- [ ] 🔴 glTF 2.0 importer (meshes, materials, textures, scene graph, animations) → Mesh/Model assets
- [ ] 🔴 Texture asset + importer (PNG/JPG/WebP drag-drop) → assignable to material maps
- [ ] 🔴 Mesh asset type in the Asset library (import + reuse + instance)
- [ ] 🔴 Async asset manager (load/cache/ref-count/dependencies/GUIDs/hot-reload)
- [ ] 🟡 Audio asset + importer (mp3/ogg/wav) feeding the audio system
- [ ] 🟡 Material maps wired in inspector (albedo/normal/MR/emissive/AO/occlusion textures)
- [ ] 🟡 Prefab instances that stay LINKED (edit prefab → update all placements; overrides; nested)
- [ ] 🟡 Asset folders / search / thumbnails / previews / import settings
- [ ] 🟡 Drag-and-drop assets onto objects + into the viewport (spawn)
- [ ] 🟢 OBJ / FBX importers; Draco mesh compression; KTX2 / Basis compressed textures
- [ ] 🟢 Font assets (SDF/MSDF) and animation/material/scene asset types
- [ ] 🟢 Project file format (.aether project, asset DB, versioning/migration)

### 2. Rendering — lighting & materials
- [ ] 🔴 Image-Based Lighting (IBL): env cubemap + irradiance + prefiltered specular + BRDF LUT
- [ ] 🔴 Skybox / procedural sky / HDR environment (also drives IBL + ambient)
- [ ] 🔴 SSAO pass (the `ssao` setting flag already exists but does nothing) _(partial)_
- [ ] 🟡 Cascaded shadow maps (directional) + point (cube) & spot (perspective) shadows _(partial: 1 dir cascade)_
- [ ] 🟡 Clustered/Forward+ light culling (scale beyond the current 8-light cap) _(partial: 8 lights)_
- [ ] 🟡 Texture-mapped materials end-to-end (normal mapping exists in shader; wire maps + tangents)
- [ ] 🟡 Transparency: OIT or sorted blended + refraction/glass; alpha-clip/cutout
- [ ] 🟢 Screen-space reflections (SSR); screen-space GI; reflection/light probes
- [ ] 🟢 Shader graph / node material editor + custom shader materials
- [ ] 🟢 Decals; detail maps; triplanar; parallax-occlusion mapping
- [ ] 🟢 Baked lightmaps / offline GI

### 3. Rendering — pipeline & post
- [ ] 🟡 Anti-aliasing: MSAA resolve + TAA (currently FXAA only) _(partial)_
- [ ] 🟡 Color grading / LUT, exposure auto/eye-adaptation, additional tonemappers
- [ ] 🟡 Multiple cameras / render-to-texture / viewport split / minimaps / picture-in-picture
- [ ] 🟡 Frustum culling + spatial acceleration (octree/BVH) + draw-call sorting/batching
- [ ] 🟡 GPU instancing API for many identical objects; static batching
- [ ] 🟡 LOD system (distance-based mesh swap + impostors)
- [ ] 🟢 Depth of field, motion blur, chromatic aberration, film grain, lens flare, god rays
- [ ] 🟢 Volumetric fog / lighting / clouds
- [ ] 🟢 Render graph / frame graph abstraction
- [ ] 🟢 WebGPU backend (compute shaders, bindless, modern pipeline) behind the GL abstraction
- [ ] 🟢 Occlusion culling (HZB / queries); adaptive resolution / dynamic quality

### 4. Animation
- [ ] 🔴 Skeletal animation: skeleton/bones, GPU skinning, clips, keyframe curves (major gap)
- [ ] 🔴 glTF animation import (ties to #1)
- [ ] 🟡 Animation state machine + blend trees + layers/masks/additive blending
- [ ] 🟡 Animation events, root motion, playback API in scripts
- [ ] 🟡 Timeline / sequencer (keyframe any property; cutscenes) + dope sheet UI
- [ ] 🟢 Inverse kinematics (IK), morph targets / blend shapes, retargeting
- [ ] 🟢 Procedural animation helpers; spring/physics-driven bones

### 5. Physics
- [ ] 🔴 Collision callbacks / triggers (onCollisionEnter/Stay/Exit, onTriggerEnter/Exit) for scripts
- [ ] 🔴 Character controller (kinematic capsule: slopes, steps, gravity, jump, ground detection)
- [ ] 🔴 Continuous collision detection (CCD) for fast bodies (anti-tunneling)
- [ ] 🟡 Collision layers / masks / groups + filtered raycast/overlap/shapecast queries
- [ ] 🟡 Joints/constraints: hinge, ball-socket, slider, fixed, distance, spring, motor
- [ ] 🟡 Convex-hull + triangle-mesh + compound colliders; physics materials
- [ ] 🟡 Trigger volumes, force fields, buoyancy; physics debug draw
- [ ] 🟢 Ragdolls, vehicles, cloth/soft-body
- [ ] 🟢 Move physics to a Web Worker / WASM; determinism mode

### 6. Audio
- [ ] 🔴 Audio file loading + playback (currently procedural-only) → audio assets (ties to #1)
- [ ] 🟡 Audio mixer: buses, volume groups, effects (filter/reverb/delay/compressor)
- [ ] 🟡 3D audio polish: attenuation curves, occlusion, reverb zones, doppler tuning
- [ ] 🟡 Music system: crossfade, layers, playlists, streaming for long tracks
- [ ] 🟢 Audio middleware-style events / sound banks; editor audio preview

### 7. Scripting & gameplay
- [ ] 🔴 Collision/trigger hooks in `ScriptContext` (depends on #5 callbacks)
- [ ] 🔴 Runtime spawn/destroy: instantiate prefabs + destroy objects from scripts
- [ ] 🔴 Object/asset references as script params (drag an object into a script field)
- [ ] 🟡 Query API for scripts (find by name/tag, get components, iterate)
- [ ] 🟡 Input action mapping (named actions, rebindable, gamepad+keyboard+touch)
- [ ] 🟡 Coroutines / timers / sequences; script-to-script events/messaging
- [ ] 🟡 Expanded lifecycle (onEnable/onDisable/onDestroy/onCollision); enable/disable scripts
- [ ] 🟡 Save/load game-state API for built games
- [ ] 🟢 TypeScript script assets w/ real compilation + imports + hot-reload
- [ ] 🟢 Visual / node-based scripting; in-editor scripting console / REPL

### 8. Scene & world
- [ ] 🟡 Multiple scenes + scene tabs + additive loading + scene assets
- [ ] 🟡 Entity tags / layers / groups (used by rendering, physics, queries)
- [ ] 🟡 Transform hierarchy fully exercised (parenting in editor + runtime) (ties to #0)
- [ ] 🟢 Level streaming / open-world chunks; large-world float precision
- [ ] 🟢 Binary scene format + schema versioning/migration

### 9. In-game UI system
- [ ] 🔴 UI/HUD framework: canvas, panels, buttons, images, layout (anchors/flex), input/events
- [ ] 🟡 Text rendering (SDF/MSDF fonts), rich text, 9-slice, masks
- [ ] 🟡 World-space UI; UI animation; data binding; theming/styling
- [ ] 🟢 Localization / i18n; on-screen virtual controls for mobile; immediate-mode debug UI

### 10. 2D support
- [ ] 🟡 Orthographic camera mode + 2D editor mode (Camera/Mat4 ortho exists; expose it) _(partial)_
- [ ] 🟡 Sprite rendering, sprite sheets / atlases, sprite animation
- [ ] 🟡 Tilemap system + tile editor; 2D parallax layers
- [ ] 🟢 2D lighting / normal-mapped sprites; dedicated 2D physics layer

### 11. AI & navigation
- [ ] 🟡 NavMesh generation + A* pathfinding + agent steering/avoidance
- [ ] 🟡 Behavior trees and/or FSM authoring + runtime
- [ ] 🟢 Perception/sensors; crowd simulation; navmesh editor/baking UI

### 12. Networking / multiplayer
- [ ] 🟢 Transport (WebSocket + WebRTC) + client/server architecture
- [ ] 🟢 State replication, authority, RPCs
- [ ] 🟢 Client prediction + reconciliation + interpolation + lag compensation
- [ ] 🟢 Lobby / matchmaking; rollback option for deterministic games

### 13. Particles & VFX
- [ ] 🟡 GPU-simulated particles (transform-feedback / compute) for large counts _(partial: CPU sim)_
- [ ] 🟡 Curves over lifetime (size/color/velocity), sub-emitters, bursts, shapes (cone/box/sphere/mesh)
- [ ] 🟡 Trails / ribbons; particle collision; force fields; soft particles
- [ ] 🟡 Particle editor panel + particle-effect assets
- [ ] 🟢 Decals from particles; GPU sorting for transparent particles

### 14. Build / export / deploy
- [ ] 🔴 "Build & download playable game" — package a scene + runtime into a standalone HTML/zip
- [ ] 🟡 Export targets: web/HTML5, PWA; bundle + minify + tree-shake + asset compression
- [ ] 🟡 Production vs dev build settings; loading screen; project/app metadata (title/icon)
- [ ] 🟢 Desktop (Electron/Tauri) + mobile (Capacitor) wrappers; server/headless builds
- [ ] 🟢 Plugin / extension API for editor + runtime; CLI tooling

### 15. Performance & architecture
- [ ] 🟡 Web Workers for physics / asset decode / pathfinding off the main thread
- [ ] 🟡 Object pooling; GC-pressure reduction; allocation audits in hot loops
- [ ] 🟡 Profiler panel (FPS graph, frame-time breakdown, draw calls, memory, GPU timers)
- [ ] 🟢 WASM modules where hot (physics, mesh ops); SharedArrayBuffer multithreading
- [ ] 🟢 Frame-budget scheduler; streaming-everything; benchmark suite

### 16. Core libraries & systems
- [ ] 🟡 Geometry math: AABB, OBB, BoundingSphere, Ray, Plane, Frustum (for culling/picking)
- [ ] 🟡 Spatial structures: Octree / BVH / uniform grid (rendering + physics + queries)
- [ ] 🟡 Curves: Bezier / Catmull-Rom / splines + spline/path editor
- [ ] 🟡 Noise (Perlin/Simplex/worley), seeded RNG, more interpolation/easing helpers
- [ ] 🟡 Serialization framework + reflection/metadata (drives inspector + save format)
- [ ] 🟢 Full ECS scheduler (systems ordering/stages/parallel) atop the sparse-set store
- [ ] 🟢 Robust resource/handle manager with ref-counting + lifetime tracking

### 17. Testing, docs & samples
- [ ] 🟡 Expand headless harness into a real test suite (unit + integration + visual regression)
- [ ] 🟡 API docs (TypeDoc) + hosted handbook; in-editor help/tooltips
- [ ] 🟡 Example projects / sample games (platformer, top-down shooter, FPS, puzzle)
- [ ] 🟢 Onboarding tour; tutorials; benchmark scenes; CONTRIBUTING + architecture docs

---

## Current foundation (already implemented — don't rebuild)

- **Engine runtime (`src/`)**: math (Vec2/3/4, Quat, Mat3/4, Color), sparse-set ECS, fixed-timestep
  Engine loop + module system, EventBus, Time.
- **Renderer**: WebGL2 forward HDR (HALF_FLOAT) → bloom → ACES → FXAA → vignette; PBR (Cook–Torrance
  GGX); 1 directional shadow (3×3 PCF); up to 8 point/spot lights; emissive/fog; transparent pass;
  procedural primitives; `Texture`/`Framebuffer`/`Shader`/`VertexArray` GL wrappers.
- **Physics**: impulse rigid bodies (sphere/box/capsule/plane), SAT box–box, sequential-impulse
  solver (friction/restitution), spatial-hash broadphase, sleeping, ray casting.
- **Input** (keyboard/mouse/gamepad/wheel/pointer-lock), **Audio** (procedural spatial Web Audio),
  **Particles** (CPU-sim instanced billboards), **Anim** (Tween + easings), **Scene** (Transform with
  parent support, MeshRenderer, RenderSystem).
- **Editor (`editor/`)**: viewport (orbit camera, grid, click-select, translate/rotate/scale gizmos),
  hierarchy (flat), inspector (transform/material/light/physics/scripts/environment + asset editors),
  toolbar (add primitives/lights, gizmo modes, play/stop, new/save/load/sample/export, W/E/R/Del),
  **scripting** (8 built-in behaviors + custom code, play-mode lifecycle), **Assets** panel
  (script/material/prefab assets; shared materials; serialized with the scene).
- **Build**: Vite multipage — `index.html` (editor), `sandbox.html` (FPS physics demo).

---

## Detailed Roadmap

> Each section: current state → what to build → key sub-tasks → dependencies. Implement P0s within a
> section before P1/P2 unless a dependency dictates otherwise.

### 0. Editor UX core
The single biggest multiplier on usability. **Undo/redo** must come first because it changes how every
mutation is written: route all edits through a command object (`do()/undo()`) recorded on a stack.
Retrofit `EditorContext` mutations (add/delete/transform/props/asset ops) to push commands.
- **Multi-select**: a `selection: EditorObject[]` (generalize the single `selection`); marquee in the
  viewport, ctrl/shift in hierarchy; gizmo operates on the group around a shared pivot; inspector
  shows shared/mixed values (multi-edit).
- **Parenting**: `Transform.parent` already exists in the runtime — expose it. Hierarchy gets
  drag-to-reparent + indentation/expanders; RenderSystem already composes parent→child world
  matrices; serialize parent ids; reparent must preserve world transform.
- **Console panel**: capture `console.*`, engine warnings, and script errors into a dockable list with
  severities + filtering + click-to-source.
- **Copy/paste/cut**, **context menus**, **gizmo snapping** (grid/angle/step + local⇄world + pivot),
  **camera niceties** (F to frame, ortho top/front/side, bookmarks), **dockable resizable panels** +
  saved layout, **command palette** + rebindable shortcuts, **play-mode** pause/step/maximize.

### 1. Asset pipeline & importers
Today geometry is procedural and materials are inline/shared; there is no general asset manager.
- **glTF 2.0 importer** is the keystone: parse meshes (positions/normals/uv/tangents/skin), PBR
  materials, textures, the node graph, and animations into engine resources + editor assets. Produces
  **Mesh assets** (new asset type) and feeds **skeletal animation** (#4).
- **Texture assets**: drag-drop images → `Texture.fromImage` → assignable to material map slots (the
  PBR shader already samples albedo/normal/MR/emissive/AO with `uHas*` flags — wire the UI + tangents).
- **Async asset manager**: handle-based load/cache/ref-count, dependency graph, GUID per asset,
  hot-reload, progress events. Underpins folders/thumbnails/search and the build system (#14).
- **Linked prefab instances**: instances keep a prefab id; editing the prefab updates all placements;
  support per-instance overrides + nested prefabs (extends the current copy-on-instantiate prefabs).

### 2. Rendering — lighting & materials
- **IBL + skybox** dramatically improve metal/reflection quality (current analytic-only PBR makes
  smooth metals read dark). Load/compute an environment cubemap; generate irradiance (diffuse) +
  prefiltered roughness mips (specular) + a BRDF integration LUT; sample them in the PBR fragment;
  drive ambient + a background skybox pass. Highest visual ROI.
- **SSAO**: the `RenderSettings.ssao` flag exists but no pass runs — add a depth/normal-based SSAO
  (needs a normal buffer; consider a small G-buffer or reconstruct from depth).
- **Shadows beyond one cascade**: cascaded shadow maps for the sun; cube-map shadows for point lights,
  perspective shadows for spots. **Forward+/clustered** light culling to exceed the 8-light cap.
- **Textured materials end-to-end**: compute/upload tangents on imported meshes, expose map slots,
  validate normal mapping (already in shader).

### 3. Rendering — pipeline & post
Add **TAA/MSAA**, **color-grading LUT** + auto-exposure, **multi-camera / render-to-texture** (enables
minimaps, portals, UI), **culling + spatial acceleration** (octree/BVH; frustum cull before draw),
**GPU instancing** + static batching, **LOD**. Advanced: DOF/motion-blur/lens effects, volumetrics,
a **render-graph** abstraction, and eventually a **WebGPU** backend behind the existing GL wrapper.

### 4. Animation
The biggest gameplay gap after physics callbacks. Build **skeletal animation**: skeleton/bone
hierarchy, GPU skinning (skin matrices in the vertex shader), animation **clips** with keyframe curves,
sampling/blending, then a **state machine + blend trees** with layers/masks/additive. Import via glTF
(#1). Add a **timeline/sequencer** to keyframe arbitrary properties for cutscenes. IK + morph targets
are P2. The existing `Tween`/`TweenManager` stays as the lightweight property-animation path.

### 5. Physics
- **Collision callbacks + triggers** are P0 because scripts can't react to hits without them: the
  solver already produces contact manifolds — surface enter/stay/exit events (and overlap-only trigger
  bodies) to `ScriptContext` (#7).
- **Character controller**: a kinematic capsule with slope limits, step offset, gravity, jump, and
  ground detection — the foundation for most games (the FPS demo currently hand-rolls this).
- **CCD** to stop fast bodies tunneling; **layers/masks** + filtered queries; **joints/constraints**;
  **convex/triangle-mesh/compound colliders** + physics materials; debug draw. P2: ragdolls, vehicles,
  cloth, worker/WASM, determinism.

### 6. Audio
Add **file loading** (decode mp3/ogg/wav → buffers) as audio assets — today everything is synthesized.
Then an **audio mixer** (buses/groups/effects), **3D polish** (attenuation curves, occlusion, reverb
zones), and a **music system** (crossfade/layers/streaming). Keep the procedural SFX as a fallback.

### 7. Scripting & gameplay
- **Collision/trigger hooks** (depends on #5), **runtime spawn/destroy** (instantiate prefabs + destroy
  objects mid-play; snapshot/restore already cleans up on Stop), **object/asset reference params** (a
  script field you fill by dragging an object/asset — needs serializable refs + inspector pickers).
- **Query API** (find by name/tag, get components), **input action mapping** (named rebindable actions
  across keyboard/gamepad/touch), **coroutines/timers/sequences**, **script-to-script events**, an
  **expanded lifecycle** (onEnable/onDisable/onDestroy/onCollision) with enable/disable. P2: real
  TypeScript script assets (compile + imports + hot-reload), visual scripting, an in-editor REPL.

### 8. Scene & world
**Multiple scenes** (tabs + additive load + scene assets), **tags/layers/groups** (consumed by
rendering/physics/queries), full **transform-hierarchy** parenting (#0). P2: level streaming / chunked
open worlds + large-coordinate precision; a versioned binary scene format with migration.

### 9. In-game UI system
A retained-mode **UI/HUD framework**: a UI canvas, panels/buttons/images/text, an anchor + flex layout
system, and pointer/keyboard input routing. Then **SDF/MSDF text** (rich text, 9-slice, masks),
**world-space UI**, UI animation, data binding, theming. P2: localization + on-screen mobile controls.
This is required for almost any shippable game and currently doesn't exist.

### 10. 2D support
`Camera`/`Mat4` already support orthographic projection — expose an **ortho/2D editor mode**. Add
**sprite rendering** (sheets/atlases/animation), a **tilemap** system + tile editor, and parallax
layers. P2: 2D lighting and a dedicated 2D physics layer.

### 11. AI & navigation
**NavMesh** bake + **A\*** pathfinding + agent steering/avoidance; **behavior trees / FSMs** for agent
logic (compose with the script system). P2: perception/sensors, crowds, a navmesh baking UI.

### 12. Networking / multiplayer
P2 track: a transport layer (WebSocket authoritative + WebRTC P2P), client/server architecture, state
**replication** with authority + RPCs, and **client prediction/reconciliation/interpolation** with lag
compensation. Optional rollback netcode for deterministic games. Large, design-heavy — schedule late.

### 13. Particles & VFX
Upgrade the CPU billboard system to **GPU simulation** (transform-feedback now, compute under WebGPU)
for large counts; add **curves over lifetime**, **shapes/sub-emitters/bursts**, **trails/ribbons**,
**collision + force fields**, **soft particles**, and a **particle editor** + reusable particle-effect
assets.

### 14. Build / export / deploy
The payoff feature: **"Build & download a playable game"** — bundle the current scene + a trimmed
runtime into a standalone, self-contained HTML (or zip) that runs without the editor. Then export
settings (title/icon/loading screen), PWA packaging, asset compression, and dev/prod modes. P2:
desktop (Electron/Tauri) + mobile (Capacitor) wrappers; a plugin/extension API; CLI tooling.

### 15. Performance & architecture
Move heavy work (physics, asset decode, pathfinding) to **Web Workers**; add **object pooling** and
hot-loop allocation audits; ship a **profiler panel** (FPS/frame-time/draw-calls/memory/GPU timers).
P2: WASM for the hottest paths, SharedArrayBuffer multithreading, a frame-budget scheduler, benchmarks.

### 16. Core libraries & systems
Fill out the math/core toolbox that higher systems need: **bounding volumes** (AABB/OBB/Sphere/Ray/
Plane/Frustum) for culling + picking, **spatial structures** (Octree/BVH/grid), **curves/splines** +
a path editor, **noise + seeded RNG**, and a **serialization + reflection/metadata** framework (which
can auto-generate inspector UI and the save format). P2: a full **ECS scheduler** (system stages/order/
parallelism) over the existing sparse-set store, and a ref-counted resource/handle manager.

### 17. Testing, docs & samples
Grow the `.aether-build/` headless harness into a real **test suite** (unit + integration + visual
regression with screenshot diffing), generate **API docs** (TypeDoc) + a handbook, add in-editor help,
and build **sample games** (platformer / top-down shooter / FPS / puzzle) that double as regression
scenes and onboarding material.

---

## Suggested sequencing (dependency-aware)

1. **Editor UX core** — Undo/redo → multi-select → parenting → console (§0). Makes everything after faster.
2. **Asset manager + glTF + texture assets** (§1) — unlocks real content, IBL textures, and skeletal anim.
3. **IBL + skybox + SSAO** (§2) — biggest visual jump.
4. **Physics callbacks/triggers + character controller** (§5) + **script spawn/destroy + refs + input actions** (§7) — unlocks actual gameplay.
5. **Skeletal animation** (§4) and **in-game UI** (§9) — needed for most real games.
6. **Build & export** (§14) — lets people ship what they make.
7. Then breadth: 2D (§10), AI/nav (§11), VFX (§13), perf/profiler (§15), advanced rendering (§3), and finally networking (§12).

> When picking up work: copy the relevant checklist items into the in-session todo, lock a small
> contract for anything cross-cutting, implement, then verify with `npm run build` + a headless test
> before checking the box here.
