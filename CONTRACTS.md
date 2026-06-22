# Aether Engine — API Contracts (single source of truth)

This file defines the EXACT cross-module public API. Every module MUST conform to these
signatures so independently-implemented modules link together. Internal helpers are free.

## Global conventions

- **Language**: TypeScript, `strict: true`. Target ES2022, ESM modules. No runtime deps.
- **Imports**: use the `@/` alias for `src/` (e.g. `import { Vec3 } from '@/core/math'`).
  Every folder listed below has an `index.ts` barrel re-exporting its public symbols.
- **Coordinate system**: right-handed, Y-up. Camera looks down -Z. CCW front faces.
- **Matrices**: column-major, stored in `Float32Array(16)` directly uploadable to WebGL.
- **Angles**: radians everywhere.
- **Mutability**: math types are mutable; methods mutate `this` and return `this` for
  chaining UNLESS the name implies a new value (`clone`, `cloned`, static `Vec3.add(out,a,b)`).
- **Disposal**: GPU resources expose `dispose(): void`.
- **Style**: classes for stateful objects; no `any` in public signatures. Use `readonly`
  where sensible. Prefer `number` ids over object refs in hot paths (ECS entities).

---

## 1. `src/core/math/` — exports via `@/core/math`

All vectors store plain `number` fields (x,y,z,w). All mutating methods return `this`.

### `Vec2` (fields: `x, y`)
```ts
constructor(x?: number, y?: number)
set(x: number, y: number): this
copy(v: Vec2): this
clone(): Vec2
add(v: Vec2): this; addScaled(v: Vec2, s: number): this
sub(v: Vec2): this
mul(v: Vec2): this; scale(s: number): this
dot(v: Vec2): number
length(): number; lengthSq(): number
normalize(): this
distanceTo(v: Vec2): number
lerp(v: Vec2, t: number): this
negate(): this
equals(v: Vec2, eps?: number): boolean
toArray(out?: number[], offset?: number): number[]
static add(out: Vec2, a: Vec2, b: Vec2): Vec2
```

### `Vec3` (fields: `x, y, z`)
```ts
constructor(x?: number, y?: number, z?: number)
set(x: number, y: number, z: number): this
setScalar(s: number): this
copy(v: Vec3): this
clone(): Vec3
add(v: Vec3): this
addScaled(v: Vec3, s: number): this        // this += v * s   (critical for physics/integrators)
sub(v: Vec3): this
mul(v: Vec3): this
scale(s: number): this
divScalar(s: number): this
dot(v: Vec3): number
cross(v: Vec3): this                        // this = this × v
crossVectors(a: Vec3, b: Vec3): this        // this = a × b
length(): number
lengthSq(): number
normalize(): this
setLength(l: number): this
distanceTo(v: Vec3): number
distanceToSq(v: Vec3): number
lerp(v: Vec3, t: number): this
lerpVectors(a: Vec3, b: Vec3, t: number): this
min(v: Vec3): this; max(v: Vec3): this
clampLength(maxLen: number): this
negate(): this
applyQuat(q: Quat): this                    // rotate this by quaternion
applyMat4(m: Mat4): this                     // full transform (w-divide)
transformDirection(m: Mat4): this            // rotate only, then normalize
equals(v: Vec3, eps?: number): boolean
toArray(out?: number[] | Float32Array, offset?: number): number[] | Float32Array
fromArray(a: ArrayLike<number>, offset?: number): this
// statics (write into out, return out):
static add(out: Vec3, a: Vec3, b: Vec3): Vec3
static sub(out: Vec3, a: Vec3, b: Vec3): Vec3
static cross(out: Vec3, a: Vec3, b: Vec3): Vec3
static scale(out: Vec3, a: Vec3, s: number): Vec3
static lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3
static distance(a: Vec3, b: Vec3): number
static dot(a: Vec3, b: Vec3): number
// constants (do not mutate):
static readonly ZERO: Vec3
static readonly ONE: Vec3
static readonly UP: Vec3      // (0,1,0)
static readonly FORWARD: Vec3 // (0,0,-1)
static readonly RIGHT: Vec3   // (1,0,0)
```

### `Vec4` (fields: `x, y, z, w`)
```ts
constructor(x?, y?, z?, w?)
set(x,y,z,w): this; copy(v): this; clone(): Vec4
add(v): this; sub(v): this; scale(s): this
dot(v): number; length(): number; normalize(): this
toArray(out?, offset?): number[]
```

### `Quat` (fields: `x, y, z, w`; identity = (0,0,0,1))
```ts
constructor(x?, y?, z?, w?)
set(x,y,z,w): this
identity(): this
copy(q: Quat): this
clone(): Quat
multiply(q: Quat): this                  // this = this * q
multiplyQuats(a: Quat, b: Quat): this
normalize(): this
conjugate(): this
invert(): this
dot(q: Quat): number
length(): number
slerp(q: Quat, t: number): this
setFromAxisAngle(axis: Vec3, angle: number): this
setFromEuler(x: number, y: number, z: number): this   // XYZ order, radians
setFromUnitVectors(from: Vec3, to: Vec3): this
setFromRotationMatrix(m: Mat4): this
toArray(out?, offset?): number[]
```

### `Mat4` (field: `data: Float32Array` length 16, column-major)
```ts
constructor()                            // identity
identity(): this
copy(m: Mat4): this
clone(): Mat4
multiply(m: Mat4): this                  // this = this * m
multiplyMatrices(a: Mat4, b: Mat4): this // this = a * b
compose(pos: Vec3, rot: Quat, scale: Vec3): this
decompose(outPos: Vec3, outRot: Quat, outScale: Vec3): this
invert(): this
transpose(): this
setPosition(v: Vec3): this
getPosition(out: Vec3): Vec3
determinant(): number
perspective(fovY: number, aspect: number, near: number, far: number): this
ortho(left, right, bottom, top, near, far: number): this
lookAt(eye: Vec3, target: Vec3, up: Vec3): this
static multiply(out: Mat4, a: Mat4, b: Mat4): Mat4
```

### `Mat3` (field: `data: Float32Array` length 9, column-major)
```ts
constructor()
identity(): this
copy(m: Mat3): this
fromMat4(m: Mat4): this                  // upper-left 3x3
normalFromMat4(m: Mat4): this            // inverse-transpose upper 3x3 (for normals)
invert(): this; transpose(): this
```

### `Color` (fields: `r, g, b, a` in 0..1, linear space)
```ts
constructor(r?, g?, b?, a?)
set(r,g,b,a?): this
setHex(hex: number): this                // 0xRRGGBB, converts sRGB->linear
copy(c): this; clone(): Color
lerp(c: Color, t: number): this
scale(s: number): this                   // scales rgb only (for intensity)
toArray(out?: number[] | Float32Array, offset?: number): number[] | Float32Array
static fromHex(hex: number): Color
```

### `MathUtils` (namespace/object of free functions)
```ts
const DEG2RAD: number; const RAD2DEG: number; const PI: number; const TAU: number
function clamp(x, min, max): number
function lerp(a, b, t): number
function smoothstep(edge0, edge1, x): number
function damp(a, b, lambda, dt): number          // exponential smoothing
function randRange(min, max): number
function randInt(min, max): number               // inclusive
function nextPow2(n): number
```

Math barrel `src/core/math/index.ts` exports: `Vec2, Vec3, Vec4, Quat, Mat3, Mat4, Color, MathUtils`.

---

## 2. `src/core/ecs/` — sparse-set ECS, exports via `@/core/ecs`

```ts
type Entity = number;                     // 0 is INVALID/null entity

// A component is any class. Registration is implicit on first use.
type ComponentClass<T = any> = new (...args: any[]) => T;

class World {
  createEntity(): Entity
  destroyEntity(e: Entity): void
  isAlive(e: Entity): boolean
  add<T>(e: Entity, component: T): T                         // attaches instance, returns it
  get<T>(e: Entity, type: ComponentClass<T>): T | undefined
  getOr<T>(e: Entity, type: ComponentClass<T>): T            // throws if missing
  has(e: Entity, type: ComponentClass): boolean
  remove(e: Entity, type: ComponentClass): void
  // Iterate entities having ALL listed component types.
  // The callback receives the entity then each component instance in the same order.
  query<A>(a: ComponentClass<A>, fn: (e: Entity, a: A) => void): void
  query<A,B>(a: ComponentClass<A>, b: ComponentClass<B>, fn: (e: Entity, a: A, b: B) => void): void
  query<A,B,C>(a, b, c, fn: (e: Entity, a: A, b: B, c: C) => void): void
  query<A,B,C,D>(a, b, c, d, fn): void
  // Non-callback variant returning an array of entities (use sparingly):
  entitiesWith(...types: ComponentClass[]): Entity[]
  count(type: ComponentClass): number
  clear(): void
}
```

ECS barrel exports: `World`, type `Entity`, type `ComponentClass`.

---

## 3. `src/core/` misc utilities — exports via `@/core`

```ts
// src/core/Time.ts
class Time {
  deltaTime: number      // seconds, clamped (<= 0.1)
  unscaledDelta: number
  elapsed: number        // total seconds since start
  frame: number          // frame counter
  timeScale: number      // default 1
  fps: number            // smoothed
  tick(nowMs: number): void   // called by Engine each frame
}

// src/core/EventBus.ts  — typed pub/sub
class EventBus {
  on(event: string, fn: (payload?: any) => void): () => void   // returns unsubscribe
  off(event: string, fn: (payload?: any) => void): void
  emit(event: string, payload?: any): void
  clear(): void
}

// src/core/Engine.ts — owns the loop and the module list
interface EngineModule {
  readonly name: string;
  init?(engine: Engine): void | Promise<void>;
  fixedUpdate?(dt: number): void;     // called at fixed step (physics)
  update?(dt: number): void;          // variable step
  lateUpdate?(dt: number): void;
  render?(alpha: number): void;       // alpha = fixed-step interpolation factor 0..1
  resize?(w: number, h: number): void;
  dispose?(): void;
}

interface EngineOptions {
  canvas: HTMLCanvasElement;
  fixedTimeStep?: number;             // default 1/60
  maxSubSteps?: number;               // default 5
}

class Engine {
  readonly world: World
  readonly time: Time
  readonly events: EventBus
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  constructor(opts: EngineOptions)
  use<T extends EngineModule>(m: T): T   // register a module, returns it
  get<T extends EngineModule>(name: string): T
  start(): void                          // begins rAF loop
  stop(): void
  dispose(): void
}
```

Core barrel `src/core/index.ts` exports: everything from math + ecs, plus `Engine`, `Time`,
`EventBus`, types `EngineModule`, `EngineOptions`.

---

## 4. `src/render/gl/` — WebGL2 wrapper, exports via `@/render/gl`

```ts
type GL = WebGL2RenderingContext;

class GLContext {
  readonly gl: GL
  readonly canvas: HTMLCanvasElement
  constructor(canvas: HTMLCanvasElement)
  resize(w: number, h: number, dpr?: number): void   // sets drawingBuffer size
  get drawingBufferWidth(): number
  get drawingBufferHeight(): number
  // capability flags
  readonly caps: { colorBufferFloat: boolean; textureFloatLinear: boolean; maxSamples: number; anisotropy: number };
}

// Shader program with #define injection + simple #include "name" resolution.
class Shader {
  constructor(gl: GL, vertSrc: string, fragSrc: string, defines?: Record<string, string | number | boolean>)
  use(): void
  readonly program: WebGLProgram
  // uniform setters (cached by name); silently ignore missing uniforms
  setFloat(name: string, v: number): void
  setInt(name: string, v: number): void
  setVec2(name: string, x: number, y: number): void
  setVec3(name: string, v: Vec3 | Color): void
  setVec3f(name: string, x: number, y: number, z: number): void
  setVec4(name: string, x: number, y: number, z: number, w: number): void
  setMat3(name: string, m: Mat3): void
  setMat4(name: string, m: Mat4): void
  setTexture(name: string, tex: Texture, unit: number): void   // binds tex to unit + sets sampler
  dispose(): void
  // Static include registry shared across shaders:
  static registerChunk(name: string, src: string): void
}

interface AttribLayout { location: number; size: number; type?: number; normalized?: boolean; }

class VertexArray {
  constructor(gl: GL)
  // positions etc. as Float32Array; indices as Uint16Array|Uint32Array
  setAttribute(loc: number, data: Float32Array, size: number, dynamic?: boolean): this
  setIndices(data: Uint16Array | Uint32Array): this
  setInstanced(loc: number, data: Float32Array, size: number, divisor?: number): this  // for instancing
  updateAttribute(loc: number, data: Float32Array): void   // re-upload dynamic buffer
  bind(): void
  unbind(): void
  draw(mode?: number): void                    // mode default TRIANGLES; uses index count
  drawInstanced(instanceCount: number, mode?: number): void
  readonly indexCount: number
  dispose(): void
}

interface TextureOptions {
  width?: number; height?: number;
  internalFormat?: number; format?: number; type?: number;
  minFilter?: number; magFilter?: number;
  wrapS?: number; wrapT?: number;
  mipmaps?: boolean; flipY?: boolean; anisotropy?: number;
  data?: ArrayBufferView | null;
}
class Texture {
  readonly handle: WebGLTexture
  readonly width: number; readonly height: number;
  constructor(gl: GL, opts: TextureOptions)
  static fromImage(gl: GL, img: TexImageSource, opts?: TextureOptions): Texture
  static fromColor(gl: GL, r: number, g: number, b: number, a?: number): Texture  // 1x1
  static white(gl: GL): Texture; static black(gl: GL): Texture; static normalFlat(gl: GL): Texture
  bind(unit: number): void
  setData(data: ArrayBufferView, width: number, height: number): void
  resize(w: number, h: number): void
  dispose(): void
}

interface FramebufferOptions {
  width: number; height: number;
  colorAttachments?: number;          // default 1, count of color targets (MRT)
  colorType?: number;                 // gl.UNSIGNED_BYTE | gl.HALF_FLOAT | gl.FLOAT (default HALF_FLOAT for HDR)
  depth?: boolean;                    // default true
  depthTexture?: boolean;             // if true, depth is sampleable Texture (for shadows)
}
class Framebuffer {
  readonly width: number; readonly height: number;
  readonly colorTextures: Texture[];
  readonly depthTexture?: Texture;
  constructor(gl: GL, opts: FramebufferOptions)
  bind(): void                        // binds + sets viewport to its size
  resize(w: number, h: number): void
  dispose(): void
}
```

gl barrel `src/render/gl/index.ts` exports: `GLContext, Shader, VertexArray, Texture, Framebuffer`,
and the interfaces `TextureOptions, FramebufferOptions, AttribLayout`.

### Standard vertex attribute locations (FIXED — all meshes & shaders use these)
```
0 = position (vec3)
1 = normal   (vec3)
2 = uv       (vec2)
3 = tangent  (vec4)   // xyz tangent, w handedness
4 = color    (vec4)   // optional vertex color
// instancing uses locations 8..11 for a mat4 instance matrix, 12 for instance color
```

---

## 5. `src/render/` — renderer, exports via `@/render`

```ts
// ---- Geometry & Mesh ----
interface GeometryData {
  positions: Float32Array;   // xyz
  normals?: Float32Array;    // xyz (auto-computed if absent)
  uvs?: Float32Array;        // xy
  tangents?: Float32Array;   // xyzw (auto-computed if absent and normal+uv present)
  indices: Uint16Array | Uint32Array;
}
class Mesh {
  readonly data: GeometryData
  constructor(gl: GL, data: GeometryData)
  computeNormals(): void
  computeTangents(): void
  readonly vao: VertexArray
  readonly bounds: { center: Vec3; radius: number };  // bounding sphere (local)
  draw(): void
  drawInstanced(count: number): void
  dispose(): void
}
// Procedural primitives (return GeometryData, no GL):
namespace Primitives {
  function box(w?: number, h?: number, d?: number): GeometryData
  function sphere(radius?: number, segments?: number): GeometryData
  function plane(w?: number, d?: number, segs?: number): GeometryData
  function cylinder(radius?: number, height?: number, segments?: number): GeometryData
  function capsule(radius?: number, height?: number, segments?: number): GeometryData
  function torus(radius?: number, tube?: number, seg?: number, tubeSeg?: number): GeometryData
}

// ---- Material (PBR metallic-roughness) ----
interface MaterialParams {
  albedo?: Color;
  metallic?: number;            // 0..1
  roughness?: number;           // 0..1
  emissive?: Color;             // linear, can exceed 1 for bloom
  emissiveIntensity?: number;
  albedoMap?: Texture;
  normalMap?: Texture;
  metallicRoughnessMap?: Texture; // G=roughness, B=metallic (glTF convention)
  emissiveMap?: Texture;
  aoMap?: Texture;
  opacity?: number;             // 1 = opaque
  transparent?: boolean;
  doubleSided?: boolean;
  tiling?: Vec2;
}
class Material {
  albedo: Color; metallic: number; roughness: number;
  emissive: Color; emissiveIntensity: number;
  opacity: number; transparent: boolean; doubleSided: boolean;
  albedoMap?: Texture; normalMap?: Texture; metallicRoughnessMap?: Texture;
  emissiveMap?: Texture; aoMap?: Texture; tiling: Vec2;
  constructor(params?: MaterialParams)
}

// ---- Camera ----
class Camera {
  position: Vec3
  rotation: Quat
  fov: number          // radians, vertical (default 60deg)
  near: number; far: number; aspect: number;
  readonly view: Mat4          // recomputed by updateMatrices()
  readonly projection: Mat4
  readonly viewProjection: Mat4
  constructor()
  updateMatrices(): void
  setAspect(aspect: number): void
  // helpers
  getForward(out: Vec3): Vec3
  getRight(out: Vec3): Vec3
  lookAt(target: Vec3): void
  screenToRay(nx: number, ny: number, outOrigin: Vec3, outDir: Vec3): void  // nx,ny in -1..1 NDC
}

// ---- Lights ----
enum LightType { Directional = 0, Point = 1, Spot = 2 }
class Light {
  type: LightType
  color: Color
  intensity: number
  position: Vec3        // point/spot
  direction: Vec3       // directional/spot (normalized)
  range: number         // point/spot attenuation radius
  innerCone: number; outerCone: number;  // spot, radians (cos handled internally)
  castShadow: boolean   // honored for the primary directional light
  constructor(type?: LightType)
}

// ---- Renderable (what the renderer consumes) ----
interface Renderable {
  mesh: Mesh;
  material: Material;
  worldMatrix: Mat4;
  castShadow?: boolean;   // default true
  receiveShadow?: boolean;// default true
}

// ---- Renderer ----
interface RenderSettings {
  exposure?: number;          // default 1.0
  bloom?: boolean;            // default true
  bloomStrength?: number;     // default 0.6
  bloomThreshold?: number;    // default 1.0
  fxaa?: boolean;             // default true
  ssao?: boolean;             // default true
  shadows?: boolean;          // default true
  shadowMapSize?: number;     // default 2048
  ambient?: Color;            // ambient/sky light
  fogColor?: Color; fogDensity?: number;
  toneMapping?: 'aces' | 'reinhard' | 'none';  // default 'aces'
}
class Renderer implements EngineModule {
  readonly name = 'renderer'
  readonly glx: GLContext
  settings: RenderSettings
  constructor(glx: GLContext, settings?: RenderSettings)
  resize(w: number, h: number): void
  // Submit a frame: renderer does shadow pass, opaque PBR pass, postfx, present.
  renderScene(camera: Camera, renderables: Renderable[], lights: Light[]): void
  // convenience to build a Mesh from GeometryData using this context:
  createMesh(data: GeometryData): Mesh
  createTextureFromImage(img: TexImageSource): Texture
  readonly gl: GL
  dispose(): void
}
```

render barrel `src/render/index.ts` exports: `Renderer, Camera, Light, LightType, Material, Mesh,
Primitives`, and the interfaces `GeometryData, MaterialParams, Renderable, RenderSettings`.
(Also re-exports gl symbols for convenience.)

---

## 6. `src/physics/` — impulse-based rigid bodies, exports via `@/physics`

```ts
enum BodyType { Static = 0, Dynamic = 1, Kinematic = 2 }
type ColliderShape =
  | { kind: 'sphere'; radius: number }
  | { kind: 'box'; halfExtents: Vec3 }
  | { kind: 'plane'; normal: Vec3; constant: number }    // infinite ground plane
  | { kind: 'capsule'; radius: number; height: number }; // axis = local Y

class RigidBody {
  type: BodyType
  position: Vec3
  orientation: Quat
  linearVelocity: Vec3
  angularVelocity: Vec3
  mass: number               // 0 => infinite (forced for Static)
  restitution: number        // 0..1 bounciness
  friction: number           // 0..1
  linearDamping: number
  angularDamping: number
  shape: ColliderShape
  gravityScale: number       // default 1
  readonly worldMatrix: Mat4 // updated by physics each step
  userData?: unknown
  constructor(shape: ColliderShape, type?: BodyType, mass?: number)
  applyImpulse(impulse: Vec3, contactPointWorld?: Vec3): void
  applyForce(force: Vec3): void           // accumulated, cleared each step
  setPosition(p: Vec3): void
  wake(): void
}

interface RaycastHit { body: RigidBody; point: Vec3; normal: Vec3; distance: number; }

class PhysicsWorld implements EngineModule {
  readonly name = 'physics'
  gravity: Vec3              // default (0,-9.81,0)
  constructor()
  addBody(body: RigidBody): RigidBody
  removeBody(body: RigidBody): void
  fixedUpdate(dt: number): void           // integrate + collide + solve
  raycast(origin: Vec3, dir: Vec3, maxDist?: number): RaycastHit | null
  // sphere cast / overlap helpers optional
  readonly bodies: ReadonlyArray<RigidBody>
  clear(): void
}
```

physics barrel `src/physics/index.ts` exports: `PhysicsWorld, RigidBody, BodyType`, types
`ColliderShape, RaycastHit`.

---

## 7. `src/input/` — exports via `@/input`

```ts
class Input implements EngineModule {
  readonly name = 'input'
  constructor(canvas: HTMLCanvasElement)
  // keyboard (KeyboardEvent.code strings, e.g. 'KeyW', 'Space')
  isDown(code: string): boolean
  wasPressed(code: string): boolean       // true only on the frame it went down
  wasReleased(code: string): boolean
  // mouse
  readonly mouseX: number; readonly mouseY: number
  readonly mouseDX: number; readonly mouseDY: number   // per-frame delta (works under pointer lock)
  readonly wheel: number
  mouseDown(button?: number): boolean
  mousePressed(button?: number): boolean
  // pointer lock
  requestPointerLock(): void
  exitPointerLock(): void
  readonly isPointerLocked: boolean
  // gamepad (first connected)
  readonly gamepad: { axes: number[]; buttons: boolean[] } | null
  // lifecycle (Engine calls these)
  update(dt: number): void       // computes wasPressed/released & gamepad poll (call EARLY)
  lateUpdate(dt: number): void    // clears per-frame deltas (call LATE)
  dispose(): void
}
```

input barrel exports: `Input`.

---

## 8. `src/audio/` — spatial audio, exports via `@/audio`

```ts
class AudioEngine implements EngineModule {
  readonly name = 'audio'
  constructor()
  resume(): void                     // call on first user gesture
  setListener(pos: Vec3, forward: Vec3, up: Vec3): void
  // Procedural one-shots (no asset files needed):
  playTone(freq: number, durationSec: number, opts?: { type?: OscillatorType; gain?: number; pos?: Vec3 }): void
  playImpact(strength: number, pos?: Vec3): void     // synthesized thud/click for collisions
  playWhoosh(pos?: Vec3): void
  masterGain: number                 // 0..1
  update(dt: number): void
  dispose(): void
}
```

audio barrel exports: `AudioEngine`.

---

## 9. `src/anim/` — tweening + animation, exports via `@/anim`

```ts
type Easing = (t: number) => number;
namespace Ease {
  const linear: Easing; const quadIn: Easing; const quadOut: Easing; const quadInOut: Easing;
  const cubicInOut: Easing; const expoOut: Easing; const backOut: Easing; const elasticOut: Easing;
  const bounceOut: Easing;
}
class Tween<T extends object> {
  constructor(target: T)
  to(props: Partial<Record<keyof T, number>>, durationSec: number, easing?: Easing): this
  delay(sec: number): this
  onComplete(fn: () => void): this
  update(dt: number): boolean         // returns true when finished
}
class TweenManager implements EngineModule {
  readonly name = 'tweens'
  add(tween: Tween<any>): void
  tweenTo<T extends object>(target: T, props: Partial<Record<keyof T, number>>, dur: number, easing?: Easing): Tween<T>
  update(dt: number): void
}
```

anim barrel exports: `Tween, TweenManager, Ease`, type `Easing`.

---

## 10. `src/particles/` — exports via `@/particles`

```ts
interface ParticleEmitterParams {
  position?: Vec3;
  rate?: number;                  // particles/sec (0 for burst-only)
  lifetime?: number;              // seconds
  startSize?: number; endSize?: number;
  startColor?: Color; endColor?: Color;
  startSpeed?: number; speedVariance?: number;
  direction?: Vec3; spread?: number;     // cone half-angle radians
  gravity?: Vec3;
  maxParticles?: number;
  additive?: boolean;             // additive blending (sparks/fire)
}
class ParticleSystem {            // instanced billboard particles
  constructor(gl: GL, params?: ParticleEmitterParams)
  emitBurst(count: number, position?: Vec3): void
  update(dt: number): void
  // renders billboards facing the camera; called by demo within the renderer's HDR pass
  render(camera: Camera): void
  setEmitting(on: boolean): void
  readonly aliveCount: number
  dispose(): void
}
```

particles barrel exports: `ParticleSystem`, interface `ParticleEmitterParams`.

---

## 11. `src/scene/` — ECS components & systems glue, exports via `@/scene`

These are the ECS components used by the demo and by RenderSystem/PhysicsSystem.

```ts
class Transform {
  position: Vec3; rotation: Quat; scale: Vec3;
  readonly localMatrix: Mat4; readonly worldMatrix: Mat4;
  parent?: Transform;
  constructor()
  updateMatrix(): void               // recompute local + world (world = parent.world * local)
  setPosition(x: number, y: number, z: number): this
}
class MeshRenderer {
  mesh: Mesh; material: Material; castShadow: boolean; receiveShadow: boolean;
  constructor(mesh: Mesh, material: Material)
}
// RenderSystem walks ECS, builds Renderable[] from Transform+MeshRenderer, gathers Light
// components, and calls renderer.renderScene(camera, renderables, lights).
class RenderSystem implements EngineModule {
  readonly name = 'renderSystem'
  constructor(world: World, renderer: Renderer, camera: Camera)
  render(alpha: number): void
}
```

scene barrel exports: `Transform, MeshRenderer, RenderSystem`.

---

## 12. `src/index.ts` — top-level engine barrel

Re-exports the public surface: `Engine`, math, ecs, `Renderer/Camera/Light/Material/Mesh/Primitives`,
`PhysicsWorld/RigidBody/BodyType`, `Input`, `AudioEngine`, `Tween/TweenManager/Ease`,
`ParticleSystem`, scene components. So a game can `import { Engine, Vec3, Renderer } from '@/index'`.

---

## Integration notes for implementers

- The renderer is the integrator of GPU state; it OWNS `GLContext`. The demo creates the
  `GLContext`, passes it to `Renderer`. Other GPU users (ParticleSystem) receive `renderer.gl`.
- Shadow pass: one directional light with `castShadow` produces a depth map; PBR shader samples
  it with 3x3 PCF. Keep it to a single cascade for reliability.
- The HDR pipeline: opaque pass renders into a HALF_FLOAT framebuffer; bloom is threshold +
  separable Gaussian downsample/upsample; final pass = tonemap(ACES) + bloom add + FXAA + vignette.
- Physics fixed step is driven by `Engine.fixedUpdate`; rendering interpolates via `alpha`.
- Keep all shader GLSL as exported string constants in `src/render/shaders/*.ts` (no .glsl files,
  so Vite needs no plugin). Use `#version 300 es`.
- Everything must typecheck under `strict`. No external runtime dependencies.
- When normals/tangents are missing in GeometryData, Mesh computes them.
- AVOID circular imports across barrels: `gl` must not import from `render` root; `render` imports
  `gl`; `scene` imports `render`, `physics`, `ecs`; `core` imports only math+ecs.
