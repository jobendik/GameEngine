/**
 * `@/render` barrel — the high-level renderer surface.
 *
 * Re-exports the renderer, scene primitives (Camera/Light/Material/Mesh/
 * Primitives), their public interfaces, and the entire `@/render/gl` wrapper
 * layer for convenience.
 */
export { Renderer } from './Renderer';
export { Camera } from './Camera';
export { Light, LightType } from './Light';
export { Material } from './Material';
export { Mesh } from './Mesh';
export { Primitives } from './Primitives';

export type { GeometryData } from './Mesh';
export type { MaterialParams } from './Material';
export type { Renderable, RenderSettings } from './Renderer';

export * from './gl';
