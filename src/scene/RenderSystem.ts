import type { EngineModule } from '@/core';
import type { World, Entity } from '@/core/ecs';
import type { Renderer } from '@/render/Renderer';
import type { Camera } from '@/render/Camera';
import type { Renderable } from '@/render/Renderer';
import { Light, LightType } from '@/render/Light';
import { Transform } from './Transform';
import { MeshRenderer } from './MeshRenderer';

/**
 * ECS rendering system. Each frame it walks the {@link World}, builds the
 * {@link Renderable} list from every entity holding a {@link Transform} +
 * {@link MeshRenderer}, gathers all {@link Light} components, updates the
 * camera matrices, and submits everything to {@link Renderer.renderScene}.
 *
 * A {@link Light} attached to an entity that also has a {@link Transform} has
 * its world-space {@link Light.position} synced from the transform each frame
 * (for point/spot lights), so moving the transform moves the light.
 */
export class RenderSystem implements EngineModule {
  readonly name = 'renderSystem';

  private readonly world: World;
  private readonly renderer: Renderer;
  private readonly camera: Camera;

  /** Reused per-frame buffers to avoid per-frame allocation. */
  private readonly renderables: Renderable[] = [];
  private readonly lights: Light[] = [];

  constructor(world: World, renderer: Renderer, camera: Camera) {
    this.world = world;
    this.renderer = renderer;
    this.camera = camera;
  }

  /**
   * Build the scene from the ECS and render it.
   *
   * @param alpha Fixed-step interpolation factor in [0,1] (unused here; transforms
   *   already reflect the latest state, but accepted to satisfy {@link EngineModule}).
   */
  render(_alpha: number): void {
    const renderables = this.renderables;
    const lights = this.lights;
    renderables.length = 0;
    lights.length = 0;

    // Opaque/mesh objects: Transform + MeshRenderer.
    this.world.query(Transform, MeshRenderer, (_e: Entity, t: Transform, mr: MeshRenderer) => {
      t.updateMatrix();
      renderables.push({
        mesh: mr.mesh,
        material: mr.material,
        worldMatrix: t.worldMatrix,
        castShadow: mr.castShadow,
        receiveShadow: mr.receiveShadow,
      });
    });

    // Lights: a @/render Light instance attached directly as an ECS component.
    // Sync point/spot light position from the entity's Transform when present.
    this.world.query(Light, (e: Entity, light: Light) => {
      if (light.type === LightType.Point || light.type === LightType.Spot) {
        const t = this.world.get(e, Transform);
        if (t) {
          light.position.copy(t.position);
        }
      }
      lights.push(light);
    });

    this.camera.updateMatrices();
    this.renderer.renderScene(this.camera, renderables, lights);
  }
}
