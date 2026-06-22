import { Color, Vec2 } from '@/core/math';
import type { Texture } from '@/render/gl';

/**
 * Construction parameters for a {@link Material}. All fields are optional; any
 * omitted value falls back to the PBR metallic-roughness defaults documented on
 * {@link Material}. Colors and textures passed here are referenced (textures) or
 * copied (colors) so defaults are never shared between instances.
 */
export interface MaterialParams {
  /** Base color (linear). Default white at 0.8 luminance. */
  albedo?: Color;
  /** Metalness in 0..1. Default 0 (dielectric). */
  metallic?: number;
  /** Perceptual roughness in 0..1. Default 0.5. */
  roughness?: number;
  /** Emissive color (linear, may exceed 1 for bloom). Default black. */
  emissive?: Color;
  /** Multiplier applied to the emissive color. Default 1. */
  emissiveIntensity?: number;
  /** Base color texture (sRGB content). */
  albedoMap?: Texture;
  /** Tangent-space normal map. */
  normalMap?: Texture;
  /** Packed metallic-roughness map (G=roughness, B=metallic, glTF convention). */
  metallicRoughnessMap?: Texture;
  /** Emissive texture. */
  emissiveMap?: Texture;
  /** Ambient-occlusion map. */
  aoMap?: Texture;
  /** Opacity in 0..1 (1 = opaque). Default 1. */
  opacity?: number;
  /** Whether this material is alpha-blended. Default false. */
  transparent?: boolean;
  /** Disable backface culling. Default false. */
  doubleSided?: boolean;
  /** UV tiling factor. Default (1,1). */
  tiling?: Vec2;
}

/**
 * A PBR metallic-roughness material — a plain data holder consumed by the
 * renderer. Each instance owns its own {@link Color}/{@link Vec2} objects so
 * mutating one material never affects another (and never the shared defaults).
 */
export class Material {
  /** Base color (linear). */
  albedo: Color;
  /** Metalness in 0..1. */
  metallic: number;
  /** Perceptual roughness in 0..1. */
  roughness: number;
  /** Emissive color (linear). */
  emissive: Color;
  /** Emissive color multiplier. */
  emissiveIntensity: number;
  /** Opacity in 0..1. */
  opacity: number;
  /** Whether the material is alpha-blended. */
  transparent: boolean;
  /** Whether backface culling is disabled. */
  doubleSided: boolean;
  /** Base color texture. */
  albedoMap?: Texture;
  /** Tangent-space normal map. */
  normalMap?: Texture;
  /** Packed metallic-roughness map. */
  metallicRoughnessMap?: Texture;
  /** Emissive texture. */
  emissiveMap?: Texture;
  /** Ambient-occlusion map. */
  aoMap?: Texture;
  /** UV tiling factor. */
  tiling: Vec2;

  constructor(params: MaterialParams = {}) {
    this.albedo = params.albedo
      ? params.albedo.clone()
      : new Color(0.8, 0.8, 0.8, 1);
    this.metallic = params.metallic ?? 0;
    this.roughness = params.roughness ?? 0.5;
    this.emissive = params.emissive
      ? params.emissive.clone()
      : new Color(0, 0, 0, 1);
    this.emissiveIntensity = params.emissiveIntensity ?? 1;
    this.opacity = params.opacity ?? 1;
    this.transparent = params.transparent ?? false;
    this.doubleSided = params.doubleSided ?? false;
    this.albedoMap = params.albedoMap;
    this.normalMap = params.normalMap;
    this.metallicRoughnessMap = params.metallicRoughnessMap;
    this.emissiveMap = params.emissiveMap;
    this.aoMap = params.aoMap;
    this.tiling = params.tiling ? params.tiling.clone() : new Vec2(1, 1);
  }
}
