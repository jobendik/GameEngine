export const meta = {
  name: 'aether-subsystems',
  description: 'Implement Aether engine subsystems (renderer+shaders, geometry/material/camera/light, physics, anim, particles, scene) against CONTRACTS.md',
  phases: [
    { title: 'Subsystems', detail: 'parallel agents implement renderer, physics, anim, particles, scene' },
  ],
}

const ROOT = 'c:/Users/joben/Projects/GameEngine'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['module', 'files', 'publicSymbols', 'notes'],
  properties: {
    module: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    publicSymbols: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const COMMON = `
You are implementing a subsystem of "Aether", a from-scratch WebGL2 TypeScript game engine.
PROJECT ROOT: ${ROOT}
The FOUNDATION already exists on disk and typechecks: src/core/math (Vec2/Vec3/Vec4/Quat/Mat3/Mat4/
Color/MathUtils), src/core/ecs (World, Entity, ComponentClass), src/core (Engine, Time, EventBus,
EngineModule), src/render/gl (GLContext, Shader, VertexArray, Texture, Framebuffer), src/input
(Input), src/audio (AudioEngine).

FIRST: read ${ROOT}/CONTRACTS.md IN FULL (single source of truth). THEN read the actual foundation
files you depend on so you use their REAL signatures:
- ALWAYS read src/core/math/index.ts and the specific math classes you use (Vec3, Quat, Mat4, etc.)
- read src/render/gl/index.ts + the gl classes you use (Shader, VertexArray, Texture, Framebuffer)
- read src/core/index.ts for the EngineModule interface
Conform to CONTRACTS exactly (names, signatures, file paths, barrel exports). Import via '@/' alias.

HARD RULES:
- TypeScript strict mode, no 'any' in public signatures, no external runtime deps.
- COMPLETE, correct, production-quality implementations. No stubs/TODOs/placeholders.
- Concise JSDoc on public API. Modern, clean TS.
- Only create files inside YOUR assigned module folder(s). Do NOT edit foundation files or other
  subsystems' files. Use the Write tool. Return the structured manifest.
`

const tasks = [
  {
    label: 'render-core',
    effort: 'high',
    prompt: `${COMMON}
YOUR MODULE FILES (do NOT create src/render/index.ts or src/render/Renderer.ts or src/render/shaders/* —
those belong to the 'renderer' agent running in parallel):
- src/render/Mesh.ts        (class Mesh + interface GeometryData per CONTRACTS section 5. Builds a
   VertexArray from GeometryData using the FIXED attribute locations (0 pos,1 normal,2 uv,3 tangent).
   computeNormals: area-weighted face normals accumulated per vertex then normalized. computeTangents:
   standard per-triangle tangent from uv deltas, Gram-Schmidt orthonormalize, w = handedness. Compute
   a local bounding sphere (center = bounds midpoint, radius = max distance). If normals absent,
   computeNormals in constructor; if uvs present and tangents absent, computeTangents. draw()/
   drawInstanced via the VAO. dispose().)
- src/render/Primitives.ts  (export namespace/object 'Primitives' with box, sphere, plane, cylinder,
   capsule, torus per CONTRACTS — each returns GeometryData with positions, normals, uvs, indices
   (Uint16Array unless >65535 verts). Correct winding (CCW front), correct normals & UVs. sphere is a
   UV-sphere; capsule = cylinder + 2 hemispheres aligned to local Y; plane lies in XZ with +Y normal.)
- src/render/Material.ts    (class Material + interface MaterialParams per CONTRACTS. Plain data
   holder with sane defaults: albedo=white(0.8), metallic=0, roughness=0.5, emissive=black,
   emissiveIntensity=1, opacity=1, tiling=(1,1). Clone the Color defaults so instances don't share.)
- src/render/Camera.ts      (class Camera per CONTRACTS. updateMatrices: view = inverse of
   compose(position, rotation, ONE); projection = perspective(fov, aspect, near, far);
   viewProjection = projection * view. getForward/getRight from rotation. lookAt sets rotation via a
   quaternion from a lookAt matrix. screenToRay: unproject NDC (nx,ny) at near & far using inverse
   viewProjection to build a world-space ray (origin, normalized dir).)
- src/render/Light.ts       (enum LightType + class Light per CONTRACTS. Defaults: Directional,
   color white, intensity depends on type (directional ~3, point/spot ~10), direction normalized
   (0,-1,0) default pointing down, range 20, inner/outer cone PI/8 and PI/6, castShadow false.)
Do NOT write the Renderer or shaders or barrel. The 'renderer' agent will import these via '@/render'
(it owns the barrel that re-exports your classes). Make every class independently importable by path.`,
  },
  {
    label: 'renderer',
    effort: 'high',
    prompt: `${COMMON}
YOU OWN: the GPU pipeline + ALL shaders + the render barrel. The 'render-core' agent (parallel) is
writing src/render/Mesh.ts, Primitives.ts, Material.ts, Camera.ts, Light.ts to the SAME CONTRACTS —
import those from their paths (e.g. import { Mesh } from '@/render/Mesh', Camera from '@/render/Camera',
Light, LightType from '@/render/Light', Material from '@/render/Material'). Trust the CONTRACTS
signatures for them. Read src/render/gl/* for the REAL GL wrapper API before writing.
CREATE:
- src/render/shaders/common.ts  (export GLSL string chunks: PBR functions (distributionGGX,
   geometrySmith, fresnelSchlick), tonemapping (ACES + reinhard), sRGB<->linear, and a shared
   #version-less chunk registry. Register chunks via Shader.registerChunk in an init function OR
   just export raw strings the other shader files concatenate. Prefer exporting raw string constants
   that Renderer concatenates — simplest & robust.)
- src/render/shaders/pbr.ts     (export PBR_VERT and PBR_FRAG strings, '#version 300 es'. Vertex:
   in vec3 aPosition(0), vec3 aNormal(1), vec2 aUv(2), vec4 aTangent(3); uniforms uModel(mat4),
   uView, uProj (or uViewProj), uNormalMatrix(mat3), uLightSpaceMatrix(mat4); outputs world pos,
   world normal, uv, tangent/bitangent (TBN), and light-space position for shadows. Fragment:
   metallic-roughness PBR with up to N lights passed via uniforms (support: 1 directional with
   shadow + up to 8 point/spot lights). Uniform block layout (use individual uniforms, simplest):
   uCamPos, uAmbient(vec3), directional: uDirLightDir, uDirLightColor (already color*intensity),
   point/spot arrays: uLightPos[8], uLightColor[8], uLightDir[8], uLightRange[8], uLightType[8] (0
   unused / int as float), uLightCone[8] (vec2 inner/outer cos), uNumLights(int). Material uniforms:
   uAlbedo(vec3), uMetallic, uRoughness, uEmissive(vec3), uOpacity, uTiling(vec2), and samplers
   uAlbedoMap, uNormalMap, uMRMap, uEmissiveMap, uAoMap with boolean 'has' flags uHasAlbedoMap etc.
   Shadow: sample uShadowMap (sampler2D) with 3x3 PCF + slope bias; uShadowEnabled. Output LINEAR HDR
   color (NO tonemapping here — postfx does it). Apply exponential fog with uFogColor, uFogDensity.
   Be meticulous: this shader must COMPILE on WebGL2 (GLSL ES 3.00) — declare precision highp float,
   use 'in/out', texture(), and a fixed MAX_LIGHTS 8 const for arrays.)
- src/render/shaders/depth.ts   (export DEPTH_VERT/DEPTH_FRAG for the shadow map pass — render
   linear depth or just use built-in depth; minimal fragment.)
- src/render/shaders/postfx.ts  (export fullscreen-triangle VERT (no attributes; gl_VertexID trick)
   and FRAGS for: BRIGHT_PASS (threshold extract for bloom), BLUR (separable Gaussian, uDirection
   uniform), COMPOSITE (sample HDR scene + bloom, apply exposure, ACES tonemap, vignette, then
   gamma-encode to sRGB), and FXAA (operate on the LDR sRGB result). Provide each as exported const.)
- src/render/Renderer.ts        (class Renderer implements EngineModule per CONTRACTS section 5.
   Pipeline each renderScene(camera, renderables, lights):
   (1) SHADOW PASS: if settings.shadows and a directional light has castShadow, render all
       shadow-casting renderables' depth into a depthTexture Framebuffer from the light's ortho
       view (fit an ortho frustum around the scene; a fixed size box e.g. 40 units is fine).
       Compute uLightSpaceMatrix = lightProj * lightView.
   (2) OPAQUE PASS: bind an HDR HALF_FLOAT Framebuffer (sceneFBO), clear, set depth test, draw each
       renderable with the PBR shader: upload model/normal matrices, material uniforms+textures
       (bind white/normalFlat defaults when a map is absent and set uHas* flags), the directional
       light + up to 8 nearest point/spot lights, ambient, fog, shadow map + light space matrix.
       Respect material.doubleSided (cull) and transparent (blend, draw after opaque, no depth write).
   (3) POSTFX: bright-pass threshold from sceneFBO color -> ping-pong Gaussian blur (a few iterations
       at half/quarter res) -> COMPOSITE (scene + bloom*strength, exposure, ACES, vignette, gamma)
       into an LDR framebuffer -> FXAA -> default framebuffer (screen). If settings.bloom is false,
       skip bloom; if fxaa false, composite straight to screen.
   Manage all Framebuffers; resize() reallocates them to the drawing buffer size. Provide createMesh,
   createTextureFromImage, get gl(). Use a fullscreen-triangle VAO (no buffer, draw 3 verts via
   gl.drawArrays) for postfx. Cache 1x1 white/normalFlat/black default textures. dispose() frees all.
   Keep state changes minimal and correct; reset gl state (depth, blend, cull) between passes.)
- src/render/index.ts           (barrel: export { Renderer } from './Renderer'; export { Camera } from
   './Camera'; export { Light, LightType } from './Light'; export { Material } from './Material';
   export { Mesh } from './Mesh'; export { Primitives } from './Primitives'; export type
   { GeometryData } from './Mesh'; export type { MaterialParams } from './Material'; export type
   { Renderable, RenderSettings } from './Renderer'; and re-export gl symbols:
   export * from './gl'. Define interfaces Renderable & RenderSettings in Renderer.ts and export them.)
This is the centerpiece — correctness of the GLSL (must compile) and pass wiring is paramount. Use a
single directional shadow cascade. Prefer robustness over feature-maximalism: a clean PBR + shadow +
bloom + ACES + FXAA pipeline that COMPILES and RUNS beats a fancier one that errors.`,
  },
  {
    label: 'physics',
    effort: 'high',
    prompt: `${COMMON}
YOUR MODULE: src/physics/ per CONTRACTS section 6. DEPENDS ON: @/core/math, @/core (EngineModule).
Create:
- src/physics/RigidBody.ts   (enum BodyType + class RigidBody + type ColliderShape + interface
   RaycastHit per CONTRACTS. RigidBody holds position, orientation(Quat), linear/angular velocity,
   mass (0 => infinite/static), restitution, friction, damping, shape, gravityScale, worldMatrix
   (recomputed), force/torque accumulators, an inverse-mass and inverse-inertia-tensor (compute
   from shape: solid sphere I=2/5 m r^2; box I from half extents; capsule approximate as sphere/
   cylinder; static/infinite => inverse 0). applyImpulse(impulse, contactPointWorld?) updates linear
   and (if contact point given) angular velocity via r x impulse. applyForce accumulates. setPosition,
   wake (sleeping optional but expose wake()). A sleeping flag is OPTIONAL; if implemented, bodies
   below a velocity threshold for a while sleep and skip integration until woken/collided.)
- src/physics/PhysicsWorld.ts (class PhysicsWorld implements EngineModule per CONTRACTS. fixedUpdate(dt):
   1) integrate dynamic bodies (apply gravity*gravityScale + accumulated forces; semi-implicit Euler:
      v += a*dt; apply damping; x += v*dt; integrate orientation from angular velocity quaternion;
      clear accumulators). 2) broadphase: a uniform spatial hash grid OR simple sweep-and-prune to get
      candidate pairs (also test every dynamic body against static planes). 3) narrowphase collision
      detection for pairs: sphere-sphere, sphere-box, box-box (use SAT or a robust approximate),
      sphere-plane, box-plane, capsule-sphere/plane/box (capsule as a segment). Produce contact
      manifolds (point, normal, penetration depth). 4) resolution: sequential impulse solver with a
      few iterations — resolve penetration via positional correction (Baumgarte / slop), apply normal
      impulses with restitution and tangential friction impulses (Coulomb clamp). Static bodies have
      infinite mass. Make it STABLE: a resting stack of boxes/spheres on the ground must not jitter
      explosively or sink. Use a small penetration slop and restitution threshold to avoid micro-
      bouncing. raycast(origin,dir,maxDist): test the ray against every body's shape (sphere, box AABB-
      in-local-space, plane, capsule), return nearest RaycastHit or null. addBody/removeBody/clear,
      readonly bodies, gravity default (0,-9.81,0).)
- src/physics/index.ts       (barrel: export { PhysicsWorld, RigidBody, BodyType }, export type
   { ColliderShape, RaycastHit })
Correctness & STABILITY matter most: the demo will drop dozens of spheres and boxes onto a ground
plane and into a pile — they must settle believably without exploding, tunneling at moderate speeds,
or jittering. Keep math in local helpers; reuse temp vectors to avoid GC churn in the hot loop.`,
  },
  {
    label: 'anim',
    effort: 'medium',
    prompt: `${COMMON}
YOUR MODULE: src/anim/ per CONTRACTS section 9. DEPENDS ON: nothing heavy.
Create:
- src/anim/Ease.ts          (export namespace/object 'Ease' with linear, quadIn, quadOut, quadInOut,
   cubicInOut, expoOut, backOut, elasticOut, bounceOut — correct standard easing formulas; export
   'type Easing = (t:number)=>number'.)
- src/anim/Tween.ts         (class Tween<T extends object> per CONTRACTS. to(props,dur,easing)
   captures start values lazily on first update (so chained/queued tweens read correct starts).
   Support a delay and onComplete. update(dt) returns true when finished. Support chaining multiple
   .to() calls as a SEQUENCE (each runs after the previous completes).)
- src/anim/TweenManager.ts  (class TweenManager implements EngineModule per CONTRACTS — holds active
   tweens, update(dt) advances them and removes finished ones; tweenTo convenience creates+adds.)
- src/anim/index.ts         (barrel: export { Tween, TweenManager, Ease }, export type { Easing })
Keep it allocation-light. Numeric props only (Partial<Record<keyof T, number>>).`,
  },
  {
    label: 'particles',
    effort: 'medium',
    prompt: `${COMMON}
YOUR MODULE: src/particles/ per CONTRACTS section 10. DEPENDS ON: @/render/gl (for GL types &
VertexArray/Shader/Texture), @/render (Camera), @/core/math.
Read src/render/gl/* and the Camera contract first. The 'renderer' agent owns src/render/index.ts;
import Camera from '@/render/Camera' to avoid any barrel timing issues.
Create:
- src/particles/ParticleSystem.ts (class ParticleSystem per CONTRACTS — INSTANCED billboard particles.
   Maintain CPU arrays for position, velocity, life, size, color per particle (SoA, capacity =
   maxParticles). Spawn at 'rate' per second from the emitter plus emitBurst(count). update(dt):
   integrate position += vel*dt + gravity, age life, recycle dead. render(camera): upload per-instance
   data (instance world position via a center + camera-facing billboard expansion in the vertex shader
   using camera right/up, instance size, instance color/alpha) and draw a quad with
   drawElementsInstanced / drawArraysInstanced. Use a small inline GLSL shader (#version 300 es): a
   quad (2 triangles) with per-instance center(loc?), size, color; vertex builds the billboard from
   uCameraRight/uCameraUp; fragment makes a soft round sprite (radial falloff) * color.a. Support
   additive blending (additive => ONE,ONE; else premultiplied alpha) and DISABLE depth write (keep
   depth test). setEmitting, aliveCount, dispose. Get camera right/up from camera.getRight and
   camera.getForward (up = right x forward-ish; or compute from camera.rotation).)
- src/particles/index.ts          (barrel: export { ParticleSystem }, export type { ParticleEmitterParams })
The particle render happens after the opaque scene in the HDR pass (the demo will call it). Bright
colors (>1) are fine — they bloom. Keep it self-contained: own its Shader + VertexArray.`,
  },
  {
    label: 'scene',
    effort: 'medium',
    prompt: `${COMMON}
YOUR MODULE: src/scene/ per CONTRACTS section 11. DEPENDS ON: @/core/math, @/core/ecs (World, Entity),
@/render (Renderer, Camera, Mesh, Material, Light, Renderable). Import render symbols from their direct
files to avoid barrel timing (Renderer from '@/render/Renderer', Camera from '@/render/Camera',
Mesh from '@/render/Mesh', Material from '@/render/Material', Light/LightType from '@/render/Light').
Create:
- src/scene/Transform.ts     (class Transform per CONTRACTS — position(Vec3), rotation(Quat),
   scale(Vec3, default 1), localMatrix & worldMatrix (Float32Array-backed Mat4), optional parent.
   updateMatrix(): localMatrix = compose(pos,rot,scale); worldMatrix = parent ? parent.world * local
   : local. setPosition chainable.)
- src/scene/MeshRenderer.ts  (class MeshRenderer per CONTRACTS — holds mesh, material, castShadow=true,
   receiveShadow=true.)
- src/scene/RenderSystem.ts  (class RenderSystem implements EngineModule per CONTRACTS. Constructor
   (world, renderer, camera). render(alpha): query the World for entities with Transform+MeshRenderer,
   update each Transform matrix, build a Renderable[] { mesh, material, worldMatrix, castShadow,
   receiveShadow }. Query entities with a Light component (the Light class from @/render/Light used
   directly as an ECS component) into a Light[] — for point/spot lights, copy the entity's Transform
   position into the light.position so moving the transform moves the light; for directional use the
   light.direction. Update camera.updateMatrices(). Then renderer.renderScene(camera, renderables,
   lights).)
- src/scene/index.ts         (barrel: export { Transform, MeshRenderer, RenderSystem })
Light is used as an ECS component by attaching a @/render Light instance to an entity. RenderSystem
gathers them. Keep it straightforward and correct.`,
  },
]

phase('Subsystems')
log('Implementing 6 subsystems in parallel against CONTRACTS.md + the existing foundation')

const results = await parallel(
  tasks.map((t) => () =>
    agent(t.prompt, { label: t.label, phase: 'Subsystems', schema: SCHEMA, effort: t.effort })
  )
)

const ok = results.filter(Boolean)
log(`Subsystems complete: ${ok.length}/${tasks.length} implemented`)
return { modules: ok }
