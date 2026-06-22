import { Vec3, Color, MathUtils } from '@/core/math';
import { Shader, VertexArray } from '@/render/gl';
import type { GL } from '@/render/gl/GLContext';
// The renderer agent owns this file; import the type directly to avoid barrel
// timing/circular-import concerns. Only structural members are used.
import type { Camera } from '@/render/Camera';

/**
 * Configuration for a {@link ParticleSystem}'s emitter. All fields are optional;
 * sensible defaults produce an upward-drifting puff of soft white sprites.
 */
export interface ParticleEmitterParams {
  /** World-space emitter origin. Default (0,0,0). */
  position?: Vec3;
  /** Continuous emission rate in particles per second (0 => burst-only). Default 0. */
  rate?: number;
  /** Particle lifetime in seconds. Default 1.5. */
  lifetime?: number;
  /** Sprite world size at birth. Default 0.5. */
  startSize?: number;
  /** Sprite world size at death (linearly interpolated). Default 0. */
  endSize?: number;
  /** Color (incl. alpha) at birth. Default opaque white. */
  startColor?: Color;
  /** Color (incl. alpha) at death. Default transparent white. */
  endColor?: Color;
  /** Initial speed along the (jittered) emission direction. Default 2. */
  startSpeed?: number;
  /** Random +/- variance added to startSpeed. Default 0. */
  speedVariance?: number;
  /** Base emission direction (need not be normalized). Default world up. */
  direction?: Vec3;
  /** Cone half-angle in radians around `direction`. Default 0.3. */
  spread?: number;
  /** Constant acceleration applied every step (e.g. gravity). Default (0,0,0). */
  gravity?: Vec3;
  /** Hard cap on simultaneously-alive particles (ring capacity). Default 1024. */
  maxParticles?: number;
  /** Additive blending for sparks/fire (else premultiplied alpha). Default false. */
  additive?: boolean;
}

/** Vertex shader: expands a unit quad into a camera-facing billboard. */
const VERT_SRC = `#version 300 es
precision highp float;

// Base quad corner in [-0.5, 0.5] (location 0 = position convention).
layout(location = 0) in vec3 aCorner;

// Per-instance data.
layout(location = 8) in vec3  iCenter; // world-space particle center
layout(location = 9) in float iSize;   // world-space sprite size
layout(location = 12) in vec4 iColor;  // premultiplied-ready rgba

uniform mat4 uViewProjection;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;

out vec2 vUv;
out vec4 vColor;

void main() {
  // [-0.5,0.5] quad -> [0,1] uv for the fragment falloff.
  vUv = aCorner.xy + vec2(0.5);
  vColor = iColor;

  vec3 worldPos = iCenter
    + uCameraRight * (aCorner.x * iSize)
    + uCameraUp    * (aCorner.y * iSize);

  gl_Position = uViewProjection * vec4(worldPos, 1.0);
}
`;

/** Fragment shader: soft round sprite via radial falloff, modulated by color. */
const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
in vec4 vColor;

// 1 => additive (output rgb, alpha already folded into rgb via mask),
// 0 => premultiplied alpha.
uniform float uAdditive;

out vec4 fragColor;

void main() {
  // Distance from sprite center in [0,1] across the quad.
  vec2 d = vUv - vec2(0.5);
  float r = length(d) * 2.0; // 0 at center, 1 at edge midpoints
  // Smooth radial falloff -> soft round disc.
  float mask = 1.0 - smoothstep(0.5, 1.0, r);
  mask *= mask;

  float alpha = vColor.a * mask;
  vec3 rgb = vColor.rgb * alpha; // premultiply

  if (uAdditive > 0.5) {
    // Additive: ONE,ONE blend — emit premultiplied rgb, zero alpha so the
    // destination alpha is untouched while colors accumulate.
    fragColor = vec4(rgb, 0.0);
  } else {
    fragColor = vec4(rgb, alpha);
  }
}
`;

// Unit quad: two triangles, corners in [-0.5, 0.5].
const QUAD_CORNERS = new Float32Array([
  -0.5, -0.5, 0.0,
   0.5, -0.5, 0.0,
   0.5,  0.5, 0.0,
  -0.5,  0.5, 0.0,
]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

// Standard attribute locations (CONTRACTS section 4).
const LOC_CORNER = 0;
const LOC_INSTANCE_CENTER = 8;
const LOC_INSTANCE_SIZE = 9;
const LOC_INSTANCE_COLOR = 12;

const TMP_RIGHT = new Vec3();
const TMP_UP = new Vec3();
const TMP_FWD = new Vec3();
const TMP_DIR = new Vec3();
const TMP_TAN = new Vec3();
const TMP_BIT = new Vec3();

/**
 * GPU-instanced billboard particle system.
 *
 * Maintains structure-of-arrays CPU state (position, velocity, life, size,
 * color) for up to `maxParticles` particles. Each {@link update} integrates
 * motion (`pos += vel*dt`, `vel += gravity*dt`), ages particles, recycles dead
 * slots, and spawns new ones from the emitter at `rate` per second plus any
 * {@link emitBurst} requests. {@link render} uploads per-instance data and draws
 * camera-facing quads in a single `drawElementsInstanced` call.
 *
 * The system owns its {@link Shader} and {@link VertexArray}; it expects to be
 * called inside the renderer's HDR pass (bright colors > 1 bloom). It enables
 * blending (additive or premultiplied alpha), keeps the depth test but disables
 * depth writes, and restores prior GL state on exit.
 */
export class ParticleSystem {
  private readonly gl: GL;
  private readonly shader: Shader;
  private readonly vao: VertexArray;

  private readonly capacity: number;
  private readonly additive: boolean;

  // SoA particle state (indices 0..capacity-1).
  private readonly posX: Float32Array;
  private readonly posY: Float32Array;
  private readonly posZ: Float32Array;
  private readonly velX: Float32Array;
  private readonly velY: Float32Array;
  private readonly velZ: Float32Array;
  /** Remaining life in seconds; <= 0 means the slot is free. */
  private readonly life: Float32Array;
  /** Total lifetime the particle was born with (for normalized aging). */
  private readonly maxLife: Float32Array;

  // Interleaved instance buffers, rebuilt each render (only alive particles).
  private readonly instCenter: Float32Array; // vec3 per particle
  private readonly instSize: Float32Array;   // float per particle
  private readonly instColor: Float32Array;  // vec4 per particle

  private alive = 0;
  private emitting = true;
  private spawnAccumulator = 0;

  // Emitter parameters (resolved defaults).
  private readonly emitPos: Vec3;
  private readonly rate: number;
  private readonly lifetime: number;
  private readonly startSize: number;
  private readonly endSize: number;
  private readonly startColor: Color;
  private readonly endColor: Color;
  private readonly startSpeed: number;
  private readonly speedVariance: number;
  private readonly direction: Vec3;
  private readonly spread: number;
  private readonly gravity: Vec3;

  /**
   * @param gl     A WebGL2 context (typically `renderer.gl`).
   * @param params Emitter configuration (see {@link ParticleEmitterParams}).
   */
  constructor(gl: GL, params: ParticleEmitterParams = {}) {
    this.gl = gl;

    this.capacity = Math.max(1, Math.floor(params.maxParticles ?? 1024));
    this.additive = params.additive ?? false;

    this.emitPos = (params.position ?? new Vec3(0, 0, 0)).clone();
    this.rate = Math.max(0, params.rate ?? 0);
    this.lifetime = Math.max(1e-3, params.lifetime ?? 1.5);
    this.startSize = params.startSize ?? 0.5;
    this.endSize = params.endSize ?? 0;
    this.startColor = (params.startColor ?? new Color(1, 1, 1, 1)).clone();
    this.endColor = (params.endColor ?? new Color(1, 1, 1, 0)).clone();
    this.startSpeed = params.startSpeed ?? 2;
    this.speedVariance = params.speedVariance ?? 0;
    this.direction = (params.direction ?? new Vec3(0, 1, 0)).clone().normalize();
    if (this.direction.lengthSq() === 0) this.direction.set(0, 1, 0);
    this.spread = params.spread ?? 0.3;
    this.gravity = (params.gravity ?? new Vec3(0, 0, 0)).clone();

    const cap = this.capacity;
    this.posX = new Float32Array(cap);
    this.posY = new Float32Array(cap);
    this.posZ = new Float32Array(cap);
    this.velX = new Float32Array(cap);
    this.velY = new Float32Array(cap);
    this.velZ = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);

    this.instCenter = new Float32Array(cap * 3);
    this.instSize = new Float32Array(cap);
    this.instColor = new Float32Array(cap * 4);

    this.shader = new Shader(gl, VERT_SRC, FRAG_SRC);

    this.vao = new VertexArray(gl);
    this.vao.setAttribute(LOC_CORNER, QUAD_CORNERS, 3);
    this.vao.setIndices(QUAD_INDICES);
    // Allocate per-instance buffers at full capacity (uploaded each frame).
    this.vao.setInstanced(LOC_INSTANCE_CENTER, this.instCenter, 3, 1);
    this.vao.setInstanced(LOC_INSTANCE_SIZE, this.instSize, 1, 1);
    this.vao.setInstanced(LOC_INSTANCE_COLOR, this.instColor, 4, 1);
  }

  /** Number of particles currently alive. */
  get aliveCount(): number {
    return this.alive;
  }

  /** Enable or disable continuous (`rate`-driven) emission. Bursts still work. */
  setEmitting(on: boolean): void {
    this.emitting = on;
  }

  /**
   * Immediately spawn `count` particles (subject to capacity), optionally from
   * an override `position` instead of the configured emitter origin.
   */
  emitBurst(count: number, position?: Vec3): void {
    const origin = position ?? this.emitPos;
    const n = Math.max(0, Math.floor(count));
    for (let i = 0; i < n; i++) {
      if (!this.spawn(origin)) break; // at capacity
    }
  }

  /**
   * Advance the simulation by `dt` seconds: integrate motion, age particles,
   * recycle dead slots, and emit new particles from the continuous rate.
   */
  update(dt: number): void {
    if (dt <= 0) return;
    const gx = this.gravity.x * dt;
    const gy = this.gravity.y * dt;
    const gz = this.gravity.z * dt;

    // Swap-remove dead particles to keep the alive range compact [0, alive).
    let i = 0;
    while (i < this.alive) {
      const remaining = this.life[i] - dt;
      if (remaining <= 0) {
        this.alive--;
        this.swapInto(i, this.alive);
        continue; // re-process the swapped-in particle at index i
      }
      this.life[i] = remaining;

      // Semi-implicit Euler: velocity then position.
      this.velX[i] += gx;
      this.velY[i] += gy;
      this.velZ[i] += gz;
      this.posX[i] += this.velX[i] * dt;
      this.posY[i] += this.velY[i] * dt;
      this.posZ[i] += this.velZ[i] * dt;
      i++;
    }

    // Continuous emission.
    if (this.emitting && this.rate > 0) {
      this.spawnAccumulator += this.rate * dt;
      let toSpawn = Math.floor(this.spawnAccumulator);
      this.spawnAccumulator -= toSpawn;
      while (toSpawn-- > 0) {
        if (!this.spawn(this.emitPos)) {
          this.spawnAccumulator = 0;
          break;
        }
      }
    }
  }

  /**
   * Draw all alive particles as camera-facing billboards. Intended to run inside
   * the renderer's HDR color pass (after opaque geometry). Enables blending and
   * disables depth writes, restoring the previous GL state afterwards.
   */
  render(camera: Camera): void {
    const count = this.alive;
    if (count === 0) return;

    const gl = this.gl;

    // Camera basis for the billboard: right and a true up = right x (-forward).
    camera.getRight(TMP_RIGHT).normalize();
    camera.getForward(TMP_FWD).normalize();
    // up = right × (-forward) gives an orthonormal up consistent with the view.
    TMP_UP.crossVectors(TMP_RIGHT, TMP_FWD).negate();
    if (TMP_UP.lengthSq() === 0) TMP_UP.copy(Vec3.UP);
    else TMP_UP.normalize();

    // Pack per-instance arrays for the alive range.
    const center = this.instCenter;
    const size = this.instSize;
    const color = this.instColor;
    for (let i = 0; i < count; i++) {
      const t = 1 - this.life[i] / this.maxLife[i]; // 0 at birth -> 1 at death
      const ci = i * 3;
      center[ci] = this.posX[i];
      center[ci + 1] = this.posY[i];
      center[ci + 2] = this.posZ[i];
      size[i] = this.startSize + (this.endSize - this.startSize) * t;

      const oi = i * 4;
      const sc = this.startColor;
      const ec = this.endColor;
      color[oi] = sc.r + (ec.r - sc.r) * t;
      color[oi + 1] = sc.g + (ec.g - sc.g) * t;
      color[oi + 2] = sc.b + (ec.b - sc.b) * t;
      color[oi + 3] = sc.a + (ec.a - sc.a) * t;
    }

    // Upload only the populated prefixes (sub-views avoid reallocating).
    this.vao.updateAttribute(LOC_INSTANCE_CENTER, center.subarray(0, count * 3));
    this.vao.updateAttribute(LOC_INSTANCE_SIZE, size.subarray(0, count));
    this.vao.updateAttribute(LOC_INSTANCE_COLOR, color.subarray(0, count * 4));

    // ---- GL state: blend on, depth test on, depth write off ----
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
    const prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB) as number;
    const prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB) as number;
    const prevBlendSrcA = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
    const prevBlendDstA = gl.getParameter(gl.BLEND_DST_ALPHA) as number;

    gl.enable(gl.BLEND);
    gl.depthMask(false);
    if (this.additive) {
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      // Premultiplied alpha: src already premultiplied in the fragment shader.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    this.shader.use();
    this.shader.setMat4('uViewProjection', camera.viewProjection);
    this.shader.setVec3('uCameraRight', TMP_RIGHT);
    this.shader.setVec3('uCameraUp', TMP_UP);
    this.shader.setFloat('uAdditive', this.additive ? 1 : 0);

    this.vao.drawInstanced(count);

    // ---- restore prior GL state ----
    gl.depthMask(prevDepthMask);
    gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcA, prevBlendDstA);
    if (!prevBlend) gl.disable(gl.BLEND);
  }

  /** Release the owned GPU resources (shader + vertex array). */
  dispose(): void {
    this.vao.dispose();
    this.shader.dispose();
    this.alive = 0;
  }

  // ----- internals -----

  /**
   * Spawn one particle at `origin` into the compact alive range. Returns false
   * if the system is at capacity.
   */
  private spawn(origin: Vec3): boolean {
    if (this.alive >= this.capacity) return false;
    const i = this.alive++;

    this.posX[i] = origin.x;
    this.posY[i] = origin.y;
    this.posZ[i] = origin.z;

    // Jitter the base direction within a cone of half-angle `spread`.
    this.coneDirection(TMP_DIR);
    const speed = this.startSpeed + (Math.random() * 2 - 1) * this.speedVariance;
    this.velX[i] = TMP_DIR.x * speed;
    this.velY[i] = TMP_DIR.y * speed;
    this.velZ[i] = TMP_DIR.z * speed;

    this.life[i] = this.lifetime;
    this.maxLife[i] = this.lifetime;
    return true;
  }

  /** Copy particle state from slot `src` into slot `dst` (swap-remove helper). */
  private swapInto(dst: number, src: number): void {
    if (dst === src) return;
    this.posX[dst] = this.posX[src];
    this.posY[dst] = this.posY[src];
    this.posZ[dst] = this.posZ[src];
    this.velX[dst] = this.velX[src];
    this.velY[dst] = this.velY[src];
    this.velZ[dst] = this.velZ[src];
    this.life[dst] = this.life[src];
    this.maxLife[dst] = this.maxLife[src];
  }

  /**
   * Write a unit-length direction into `out`, randomly perturbed within a cone
   * of half-angle `spread` around the configured base `direction`.
   */
  private coneDirection(out: Vec3): void {
    const dir = this.direction;
    if (this.spread <= 0) {
      out.copy(dir);
      return;
    }
    // Uniform sampling of a spherical cap around +Z, then rotate to `dir`.
    const cosSpread = Math.cos(this.spread);
    const z = MathUtils.lerp(cosSpread, 1, Math.random()); // cos(theta)
    const phi = Math.random() * MathUtils.TAU;
    const sinTheta = Math.sqrt(Math.max(0, 1 - z * z));
    const lx = Math.cos(phi) * sinTheta;
    const ly = Math.sin(phi) * sinTheta;
    const lz = z;

    // Build an orthonormal basis (tangent, bitangent) around `dir`.
    const ref = Math.abs(dir.y) < 0.999 ? Vec3.UP : Vec3.RIGHT;
    TMP_TAN.crossVectors(ref, dir);
    if (TMP_TAN.lengthSq() === 0) TMP_TAN.copy(Vec3.RIGHT);
    else TMP_TAN.normalize();
    TMP_BIT.crossVectors(dir, TMP_TAN).normalize();

    out.set(
      TMP_TAN.x * lx + TMP_BIT.x * ly + dir.x * lz,
      TMP_TAN.y * lx + TMP_BIT.y * ly + dir.y * lz,
      TMP_TAN.z * lx + TMP_BIT.z * ly + dir.z * lz,
    ).normalize();
  }
}
