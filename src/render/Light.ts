import { Vec3, Color, MathUtils } from '@/core/math';

/** Discriminates the three supported light kinds. */
export enum LightType {
  /** Infinitely distant light with a single direction (sun). */
  Directional = 0,
  /** Omnidirectional point light with range-based attenuation. */
  Point = 1,
  /** Cone-shaped spot light with inner/outer falloff. */
  Spot = 2,
}

/**
 * A scene light. The active fields depend on {@link type}: directional lights
 * use {@link direction}; point lights use {@link position} and {@link range};
 * spot lights use both plus {@link innerCone}/{@link outerCone}.
 *
 * Defaults: directional, white, intensity 3 (directional) or 10 (point/spot),
 * direction pointing straight down (0,-1,0), range 20, cones PI/8 and PI/6.
 */
export class Light {
  /** Which kind of light this is. */
  type: LightType;
  /** Light color (linear). */
  color: Color;
  /** Radiometric intensity multiplier. */
  intensity: number;
  /** World-space position (point/spot). */
  position: Vec3;
  /** Normalized world-space direction (directional/spot). */
  direction: Vec3;
  /** Attenuation radius (point/spot). */
  range: number;
  /** Spot inner cone half-angle in radians (full intensity within). */
  innerCone: number;
  /** Spot outer cone half-angle in radians (zero intensity beyond). */
  outerCone: number;
  /** Whether this light casts shadows (honored for the primary directional). */
  castShadow: boolean;

  constructor(type: LightType = LightType.Directional) {
    this.type = type;
    this.color = new Color(1, 1, 1, 1);
    this.intensity = type === LightType.Directional ? 3 : 10;
    this.position = new Vec3(0, 0, 0);
    this.direction = new Vec3(0, -1, 0);
    this.range = 20;
    this.innerCone = MathUtils.PI / 8;
    this.outerCone = MathUtils.PI / 6;
    this.castShadow = false;
  }
}
