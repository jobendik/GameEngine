import type { Mesh } from '@/render/Mesh';
import type { Material } from '@/render/Material';

/**
 * ECS component pairing a {@link Mesh} with a {@link Material} for rendering.
 *
 * The {@link RenderSystem} reads this together with a {@link Transform} to build
 * the per-frame {@link Renderable} list. Shadow participation is controlled by
 * {@link castShadow}/{@link receiveShadow}.
 */
export class MeshRenderer {
  /** Geometry to draw. */
  mesh: Mesh;
  /** Surface material (PBR metallic-roughness). */
  material: Material;
  /** Whether this object casts shadows. Default `true`. */
  castShadow = true;
  /** Whether this object receives shadows. Default `true`. */
  receiveShadow = true;

  constructor(mesh: Mesh, material: Material) {
    this.mesh = mesh;
    this.material = material;
  }
}
