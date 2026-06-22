/**
 * `@/render/gl` — thin, typed WebGL2 wrapper.
 *
 * Public surface (CONTRACTS section 4): context/capability probing, shader
 * program management with #define/#include preprocessing, vertex arrays,
 * textures and framebuffers (HDR render targets / shadow maps).
 */
export { GLContext } from './GLContext';
export { Shader } from './Shader';
export { VertexArray } from './VertexArray';
export { Texture } from './Texture';
export { Framebuffer } from './Framebuffer';

export type { TextureOptions } from './Texture';
export type { FramebufferOptions } from './Framebuffer';
export type { AttribLayout } from './VertexArray';
