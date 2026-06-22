/**
 * `@/particles` — GPU-instanced billboard particle system (CONTRACTS section 10).
 *
 * Self-contained: owns its shader + vertex array, simulates on the CPU (SoA),
 * and draws camera-facing soft sprites within the renderer's HDR pass with
 * additive or premultiplied-alpha blending.
 */
export { ParticleSystem } from './ParticleSystem';
export type { ParticleEmitterParams } from './ParticleSystem';
