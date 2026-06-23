import { Color } from '@/core/math';
import { Material } from '@/render';
import type { MaterialData } from './types';

/** Build a live {@link Material} from serializable {@link MaterialData}. */
export function materialFromData(m: MaterialData): Material {
  return new Material({
    albedo: new Color(m.albedo[0], m.albedo[1], m.albedo[2]),
    metallic: m.metallic,
    roughness: m.roughness,
    emissive: new Color(m.emissive[0], m.emissive[1], m.emissive[2]),
    emissiveIntensity: m.emissiveIntensity,
    opacity: m.opacity,
    transparent: m.opacity < 1,
  });
}

/** Read a live {@link Material} back into serializable {@link MaterialData}. */
export function materialToData(m: Material): MaterialData {
  return {
    albedo: [m.albedo.r, m.albedo.g, m.albedo.b],
    metallic: m.metallic,
    roughness: m.roughness,
    emissive: [m.emissive.r, m.emissive.g, m.emissive.b],
    emissiveIntensity: m.emissiveIntensity,
    opacity: m.opacity,
  };
}

/** Copy all fields from one Material into another (keeps the destination identity). */
export function copyMaterial(dst: Material, src: Material): void {
  dst.albedo.copy(src.albedo);
  dst.metallic = src.metallic;
  dst.roughness = src.roughness;
  dst.emissive.copy(src.emissive);
  dst.emissiveIntensity = src.emissiveIntensity;
  dst.opacity = src.opacity;
  dst.transparent = src.transparent;
}
