import type { Engine, EngineModule } from '@/core';
import { Vec3, Quat, Color, MathUtils } from '@/core/math';
import { Renderer, Camera, Light, LightType, Material, Mesh, Primitives } from '@/render';
import { PhysicsWorld, RigidBody, BodyType } from '@/physics';
import type { Input } from '@/input';
import type { AudioEngine } from '@/audio';
import type { TweenManager } from '@/anim';
import { Transform, MeshRenderer } from '@/scene';
import { ParticleSystem } from '@/particles';

/** Dependencies injected from the bootstrap in main.ts. */
export interface GameDeps {
  engine: Engine;
  camera: Camera;
  input: Input;
  audio: AudioEngine;
  tweens: TweenManager;
  physics: PhysicsWorld;
  renderer: Renderer;
}

/** A simulated visual object: a physics body mirrored into an ECS transform. */
interface Dynamic {
  body: RigidBody;
  transform: Transform;
  /** Approximate radius for player-push reach. */
  radius: number;
  /** Speed last frame, for collision-impact detection. */
  prevSpeed: number;
  /** Cooldown so one collision makes one sound, not a burst. */
  impactCd: number;
}

// ---- tuning --------------------------------------------------------------
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.45;
const MOVE_SPEED = 7.5;
const SPRINT_SPEED = 12.5;
const PLAYER_GRAVITY = 22;
const JUMP_SPEED = 8.0;
const LOOK_SENS = 0.0022;
const PITCH_LIMIT = MathUtils.PI / 2 - 0.05;
const ORB_SPEED = 30;
const ORB_RADIUS = 0.34;
const GRAB_RANGE = 60;
const GRAB_DIST = 3.4;
const GRAB_STIFFNESS = 13;

// ---- scratch (module scope; never escape) --------------------------------
const _fwd = new Vec3();
const _right = new Vec3();
const _fwdFlat = new Vec3();
const _rightFlat = new Vec3();
const _wish = new Vec3();
const _qYaw = new Quat();
const _qPitch = new Quat();
const _rayDir = new Vec3();
const _tmp = new Vec3();
const _push = new Vec3();
const _target = new Vec3();
const _spawnPos = new Vec3();

/**
 * The Aether demo: a first-person physics sandbox that exercises the whole
 * engine — PBR materials, dynamic shadows, bloom-lit emissives, impulse
 * physics, spatial audio, particles, raycasting and a gravity gun.
 *
 * Registered LAST so its {@link render} (particles) draws over the scene the
 * RenderSystem presents, and its {@link lateUpdate} (body→transform sync) runs
 * after the physics fixed step.
 */
export class Game implements EngineModule {
  readonly name = 'game';

  private readonly engine: Engine;
  private readonly camera: Camera;
  private readonly input: Input;
  private readonly audio: AudioEngine;
  private readonly tweens: TweenManager;
  private readonly physics: PhysicsWorld;
  private readonly renderer: Renderer;

  // Player state.
  private readonly playerPos = new Vec3(0, EYE_HEIGHT, 18);
  private yaw = 0; // yaw 0 => forward is -Z, looking from z=18 toward the arena
  private pitch = -0.05;
  private vy = 0;
  private onGround = false;

  // Simulated objects.
  private readonly dynamics: Dynamic[] = [];

  // Shared GPU meshes.
  private sphereMesh!: Mesh; // radius 1
  private boxMesh!: Mesh;    // 1×1×1
  private orbMaterial!: Material;

  // Lights / centerpiece kept for per-frame animation.
  private sun!: Light;
  private flashLight!: Light;
  private flashTransform!: Transform;
  private flashOn = false;
  private torusTransform!: Transform;

  // Interaction.
  private grabbed: RigidBody | null = null;

  // Effects.
  private sparks!: ParticleSystem;

  // HUD.
  private statsEl: HTMLElement | null = null;
  private hudTimer = 0;

  constructor(deps: GameDeps) {
    this.engine = deps.engine;
    this.camera = deps.camera;
    this.input = deps.input;
    this.audio = deps.audio;
    this.tweens = deps.tweens;
    this.physics = deps.physics;
    this.renderer = deps.renderer;
  }

  init(): void {
    const r = this.renderer;
    this.sphereMesh = r.createMesh(Primitives.sphere(1, 32));
    this.boxMesh = r.createMesh(Primitives.box(1, 1, 1));

    this.sparks = new ParticleSystem(r.gl, {
      lifetime: 0.7,
      startSize: 0.22,
      endSize: 0.0,
      startColor: new Color(5.0, 2.6, 0.8, 1),
      endColor: new Color(1.6, 0.25, 0.05, 0),
      startSpeed: 5,
      speedVariance: 4,
      spread: Math.PI,
      gravity: new Vec3(0, -9, 0),
      maxParticles: 4000,
      additive: true,
    });

    this.buildArena();
    this.statsEl = document.getElementById('stats');
  }

  /** Keep the camera aspect in sync with the drawing buffer. */
  resize(w: number, h: number): void {
    this.camera.setAspect(w / Math.max(1, h));
  }

  // ======================================================================
  // Frame
  // ======================================================================

  update(dt: number): void {
    const input = this.input;
    const cam = this.camera;
    const t = this.engine.time.elapsed;

    // ---- look (only while pointer-locked) ----
    if (input.isPointerLocked) {
      this.yaw -= input.mouseDX * LOOK_SENS;
      this.pitch -= input.mouseDY * LOOK_SENS;
      this.pitch = MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    }
    _qYaw.setFromAxisAngle(Vec3.UP, this.yaw);
    _qPitch.setFromAxisAngle(Vec3.RIGHT, this.pitch);
    cam.rotation.multiplyQuats(_qYaw, _qPitch);

    // Horizontal basis from yaw only.
    _fwdFlat.set(0, 0, -1).applyQuat(_qYaw);
    _rightFlat.set(1, 0, 0).applyQuat(_qYaw);

    // ---- movement ----
    _wish.set(0, 0, 0);
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) _wish.add(_fwdFlat);
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) _wish.sub(_fwdFlat);
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) _wish.add(_rightFlat);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) _wish.sub(_rightFlat);
    const speed = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? SPRINT_SPEED : MOVE_SPEED;
    if (_wish.lengthSq() > 1e-6) _wish.normalize().scale(speed);

    this.playerPos.x += _wish.x * dt;
    this.playerPos.z += _wish.z * dt;

    // ---- gravity + ground via downward raycast ----
    this.vy -= PLAYER_GRAVITY * dt;
    this.playerPos.y += this.vy * dt;

    _tmp.set(0, -1, 0);
    const hit = this.physics.raycast(this.playerPos, _tmp, EYE_HEIGHT + 0.5);
    this.onGround = false;
    if (hit && hit.normal.y > 0.5) {
      const standY = hit.point.y + EYE_HEIGHT;
      if (this.playerPos.y <= standY + 0.001 && this.vy <= 0.001) {
        this.playerPos.y = standY;
        this.vy = 0;
        this.onGround = true;
      }
    }
    if (this.onGround && (input.wasPressed('Space'))) {
      this.vy = JUMP_SPEED;
      this.onGround = false;
    }

    cam.position.copy(this.playerPos);

    // ---- push nearby dynamic bodies aside while walking ----
    this.pushNearbyBodies();

    // ---- interactions ----
    if (input.wasPressed('KeyF')) this.toggleFlashlight();
    if (input.wasPressed('KeyG')) {
      if (this.grabbed) this.releaseGrab(false);
      else this.tryGrab();
    }
    if (input.mousePressed(0)) {
      if (this.grabbed) this.releaseGrab(true);
      else if (input.isPointerLocked) this.launchOrb();
    }

    // ---- hold grabbed body in front of the camera (gravity gun) ----
    if (this.grabbed) {
      cam.getForward(_fwd);
      _target.copy(this.playerPos).addScaled(_fwd, GRAB_DIST);
      const g = this.grabbed;
      g.linearVelocity.set(
        (_target.x - g.position.x) * GRAB_STIFFNESS,
        (_target.y - g.position.y) * GRAB_STIFFNESS,
        (_target.z - g.position.z) * GRAB_STIFFNESS,
      );
      g.angularVelocity.scale(0.85);
      g.wake();
    }

    // ---- animate world: sun sweep, flashlight, tumbling centerpiece ----
    // Keep the sun's travel direction biased toward -Z (into the scene) so the
    // camera-facing faces stay lit while it gently sweeps overhead.
    const a = t * 0.05;
    this.sun.direction.set(Math.sin(a) * 0.35 + 0.1, -0.72, Math.cos(a * 0.7) * 0.15 - 0.55).normalize();
    if (this.flashOn) {
      this.flashTransform.position.copy(this.playerPos);
      cam.getForward(this.flashLight.direction);
    }
    this.torusTransform.rotation.setFromEuler(t * 0.5, t * 0.8, 0);

    // ---- spatial audio listener follows the camera ----
    cam.getForward(_fwd);
    this.audio.setListener(this.playerPos, _fwd, Vec3.UP);

    this.sparks.update(dt);
    this.updateHud(dt);
  }

  /** Mirror physics bodies into their transforms and detect collision impacts. */
  lateUpdate(dt: number): void {
    for (const d of this.dynamics) {
      d.transform.position.copy(d.body.position);
      d.transform.rotation.copy(d.body.orientation);

      const speed = d.body.linearVelocity.length();
      d.impactCd = Math.max(0, d.impactCd - dt);
      const drop = d.prevSpeed - speed;
      if (drop > 3.5 && d.impactCd <= 0 && d.body !== this.grabbed) {
        const strength = MathUtils.clamp(drop / 12, 0.12, 1);
        this.sparks.emitBurst(Math.floor(6 + drop * 1.5), d.body.position);
        this.audio.playImpact(strength, d.body.position);
        d.impactCd = 0.09;
      }
      d.prevSpeed = speed;
    }
  }

  /** Draw particles on top of the presented scene (additive sparks bloom). */
  render(_alpha: number): void {
    this.sparks.render(this.camera);
  }

  dispose(): void {
    this.sparks.dispose();
    this.sphereMesh.dispose();
    this.boxMesh.dispose();
  }

  // ======================================================================
  // Interactions
  // ======================================================================

  private launchOrb(): void {
    this.camera.getForward(_fwd);
    _spawnPos.copy(this.playerPos).addScaled(_fwd, 1.2);
    const d = this.addDynamicSphere(_spawnPos, ORB_RADIUS, this.orbMaterial, 2.2);
    d.body.restitution = 0.5;
    d.body.friction = 0.4;
    d.body.linearVelocity.copy(_fwd).scale(ORB_SPEED);
    this.audio.playWhoosh(_spawnPos);
    this.sparks.emitBurst(16, _spawnPos);
  }

  private tryGrab(): void {
    this.camera.getForward(_rayDir);
    const hit = this.physics.raycast(this.playerPos, _rayDir, GRAB_RANGE);
    if (hit && hit.body.type === BodyType.Dynamic) {
      this.grabbed = hit.body;
      this.grabbed.gravityScale = 0;
      this.grabbed.wake();
      this.audio.playTone(440, 0.08, { type: 'triangle', gain: 0.2 });
    }
  }

  private releaseGrab(launch: boolean): void {
    const g = this.grabbed;
    if (!g) return;
    g.gravityScale = 1;
    if (launch) {
      this.camera.getForward(_fwd);
      g.linearVelocity.copy(_fwd).scale(ORB_SPEED + 8);
      this.audio.playWhoosh(g.position);
      this.sparks.emitBurst(22, g.position);
    }
    g.wake();
    this.grabbed = null;
  }

  private toggleFlashlight(): void {
    this.flashOn = !this.flashOn;
    this.flashLight.intensity = this.flashOn ? 34 : 0;
    this.audio.playTone(this.flashOn ? 620 : 360, 0.05, { type: 'square', gain: 0.12 });
  }

  private pushNearbyBodies(): void {
    for (const d of this.dynamics) {
      const b = d.body;
      if (b === this.grabbed) continue;
      const dx = b.position.x - this.playerPos.x;
      const dy = b.position.y - this.playerPos.y;
      const dz = b.position.z - this.playerPos.z;
      if (Math.abs(dy) > 1.4) continue;
      const reach = PLAYER_RADIUS + d.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq > 1e-4 && distSq < reach * reach) {
        const dist = Math.sqrt(distSq);
        const overlap = reach - dist;
        const imp = overlap * (b.mass || 1) * 7;
        _push.set((dx / dist) * imp, 0, (dz / dist) * imp);
        b.applyImpulse(_push);
      }
    }
  }

  // ======================================================================
  // HUD
  // ======================================================================

  private updateHud(dt: number): void {
    this.hudTimer -= dt;
    if (this.hudTimer > 0 || !this.statsEl) return;
    this.hudTimer = 0.2;
    const time = this.engine.time;
    this.statsEl.innerHTML =
      `<div class="title">Aether Engine</div>` +
      row('FPS', time.fps.toFixed(0)) +
      row('Frame', `${(time.deltaTime * 1000).toFixed(1)} ms`) +
      row('Bodies', String(this.physics.bodies.length)) +
      row('Particles', String(this.sparks.aliveCount)) +
      row('Flashlight', this.flashOn ? 'on' : 'off') +
      row('Gravity gun', this.grabbed ? 'HOLDING' : 'ready');
  }

  // ======================================================================
  // Scene construction
  // ======================================================================

  private buildArena(): void {
    const world = this.engine.world;
    const r = this.renderer;

    // ---- ground (visual plane + static physics plane) ----
    const groundMesh = r.createMesh(Primitives.plane(140, 140, 1));
    const groundMat = new Material({
      albedo: new Color(0.13, 0.14, 0.17),
      metallic: 0.1,
      roughness: 0.72,
    });
    const ge = world.createEntity();
    world.add(ge, new Transform());
    const gmr = new MeshRenderer(groundMesh, groundMat);
    gmr.castShadow = false;
    world.add(ge, gmr);
    this.physics.addBody(
      new RigidBody({ kind: 'plane', normal: new Vec3(0, 1, 0), constant: 0 }, BodyType.Static),
    );

    // ---- sun (directional, casts shadows) ----
    this.sun = new Light(LightType.Directional);
    this.sun.color.set(1.0, 0.92, 0.78, 1);
    this.sun.intensity = 3.9;
    this.sun.direction.set(0.3, -0.72, -0.55).normalize();
    this.sun.castShadow = true;
    const se = world.createEntity();
    world.add(se, this.sun);

    // ---- PBR material showroom: 5×5 metallic × roughness grid ----
    const base = new Color(0.86, 0.62, 0.42);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const mat = new Material({
          albedo: base.clone(),
          metallic: i / 4,
          roughness: MathUtils.clamp(j / 4, 0.06, 1),
        });
        const x = (i - 2) * 3;
        const z = -10 - j * 3;
        this.addStaticMesh(this.sphereMesh, mat, x, 1.25, z, 1.25);
      }
    }

    // ---- 4 emissive corner pillars, each with a matching point light ----
    const pillarColors = [
      new Color(0.1, 0.8, 1.0),  // cyan
      new Color(1.0, 0.25, 0.7), // magenta
      new Color(1.0, 0.55, 0.1), // orange
      new Color(0.4, 1.0, 0.35), // green
    ];
    const corners = [
      [-13, -13], [13, -13], [-13, 13], [13, 13],
    ];
    for (let k = 0; k < 4; k++) {
      const col = pillarColors[k];
      const [px, pz] = corners[k];
      const mat = new Material({
        albedo: new Color(0.03, 0.03, 0.04),
        metallic: 0.2,
        roughness: 0.5,
        emissive: col.clone(),
        emissiveIntensity: 2.6,
      });
      // Pillar body (box mesh scaled tall).
      const pe = world.createEntity();
      const pt = new Transform();
      pt.position.set(px, 2.6, pz);
      pt.scale.set(1.2, 5.2, 1.2);
      world.add(pe, pt);
      world.add(pe, new MeshRenderer(this.boxMesh, mat));

      // Matching point light near the top.
      const le = world.createEntity();
      const lt = new Transform();
      lt.position.set(px, 5.4, pz);
      world.add(le, lt);
      const light = new Light(LightType.Point);
      light.color.copy(col);
      light.intensity = 16;
      light.range = 26;
      world.add(le, light);
    }

    // ---- tumbling chrome centerpiece + white fill light ----
    const torusMesh = r.createMesh(Primitives.torus(1.5, 0.5, 64, 32));
    // A glowing energy ring reads far better than analytic-only chrome and it
    // blooms — a striking centerpiece that also tumbles.
    const ringMat = new Material({
      albedo: new Color(0.55, 0.85, 1.0),
      metallic: 0.5,
      roughness: 0.32,
      emissive: new Color(0.2, 0.95, 1.25),
      emissiveIntensity: 2.3,
    });
    const te = world.createEntity();
    this.torusTransform = new Transform();
    this.torusTransform.position.set(0, 4.2, 0);
    world.add(te, this.torusTransform);
    world.add(te, new MeshRenderer(torusMesh, ringMat));

    const cle = world.createEntity();
    const clt = new Transform();
    clt.position.set(0, 4.6, 0);
    world.add(cle, clt);
    const centerLight = new Light(LightType.Point);
    centerLight.color.set(0.85, 0.9, 1.0, 1);
    centerLight.intensity = 12;
    centerLight.range = 30;
    world.add(cle, centerLight);

    // ---- flashlight (spot, follows camera; off by default) ----
    this.flashTransform = new Transform();
    this.flashLight = new Light(LightType.Spot);
    this.flashLight.color.set(1.0, 0.96, 0.85, 1);
    this.flashLight.intensity = 0;
    this.flashLight.range = 40;
    this.flashLight.innerCone = 0.22;
    this.flashLight.outerCone = 0.4;
    const fe = world.createEntity();
    world.add(fe, this.flashTransform);
    world.add(fe, this.flashLight);

    // ---- orb material (glowing energy orbs the player launches) ----
    this.orbMaterial = new Material({
      albedo: new Color(0.02, 0.04, 0.06),
      metallic: 0,
      roughness: 0.28,
      emissive: new Color(0.15, 0.85, 1.1),
      emissiveIntensity: 4.2,
    });

    // ---- physics playground: a crate pyramid ----
    const crateMat = new Material({
      albedo: new Color(0.42, 0.3, 0.17),
      metallic: 0.0,
      roughness: 0.78,
    });
    const cs = 1.2;
    const baseX = 6;
    const baseZ = 5;
    for (let layer = 0; layer < 4; layer++) {
      const count = 4 - layer;
      for (let n = 0; n < count; n++) {
        const x = baseX + (n - (count - 1) / 2) * cs * 1.02;
        const y = cs / 2 + layer * cs * 1.02;
        this.addDynamicBox(_tmp.set(x, y, baseZ), cs, crateMat);
      }
    }

    // ---- scattered dynamic PBR balls that fall and settle on load ----
    const palette = [
      new Color(0.9, 0.2, 0.2), new Color(0.2, 0.5, 0.95), new Color(0.95, 0.8, 0.2),
      new Color(0.2, 0.85, 0.55), new Color(0.8, 0.3, 0.9), new Color(0.95, 0.95, 0.95),
    ];
    for (let i = 0; i < 10; i++) {
      const mat = new Material({
        albedo: palette[i % palette.length].clone(),
        metallic: i % 3 === 0 ? 0.9 : 0.05,
        roughness: 0.2 + (i % 5) * 0.16,
      });
      const radius = 0.45 + (i % 3) * 0.12;
      _tmp.set(MathUtils.randRange(-8, 8), 5 + i * 0.8, MathUtils.randRange(-6, 10));
      this.addDynamicSphere(_tmp, radius, mat, radius * radius * 8);
    }
  }

  // ---- entity builders -----------------------------------------------------

  private addStaticMesh(
    mesh: Mesh, material: Material, x: number, y: number, z: number, scale: number,
  ): void {
    const world = this.engine.world;
    const e = world.createEntity();
    const t = new Transform();
    t.position.set(x, y, z);
    t.scale.setScalar(scale);
    world.add(e, t);
    world.add(e, new MeshRenderer(mesh, material));
  }

  private addDynamicSphere(pos: Vec3, radius: number, material: Material, mass: number): Dynamic {
    const world = this.engine.world;
    const body = new RigidBody({ kind: 'sphere', radius }, BodyType.Dynamic, mass);
    body.position.copy(pos);
    body.restitution = 0.35;
    body.friction = 0.5;
    this.physics.addBody(body);

    const e = world.createEntity();
    const t = new Transform();
    t.position.copy(pos);
    t.scale.setScalar(radius);
    world.add(e, t);
    world.add(e, new MeshRenderer(this.sphereMesh, material));

    const d: Dynamic = { body, transform: t, radius, prevSpeed: 0, impactCd: 0 };
    this.dynamics.push(d);
    return d;
  }

  private addDynamicBox(pos: Vec3, size: number, material: Material): Dynamic {
    const world = this.engine.world;
    const half = size / 2;
    const body = new RigidBody(
      { kind: 'box', halfExtents: new Vec3(half, half, half) },
      BodyType.Dynamic,
      size * size * size * 2,
    );
    body.position.copy(pos);
    body.restitution = 0.1;
    body.friction = 0.7;
    this.physics.addBody(body);

    const e = world.createEntity();
    const t = new Transform();
    t.position.copy(pos);
    t.scale.setScalar(size);
    world.add(e, t);
    world.add(e, new MeshRenderer(this.boxMesh, material));

    const d: Dynamic = { body, transform: t, radius: half * 1.4, prevSpeed: 0, impactCd: 0 };
    this.dynamics.push(d);
    return d;
  }
}

/** One HUD stat row. */
function row(label: string, value: string): string {
  return `<div class="row"><span>${label}</span><span>${value}</span></div>`;
}
