/**
 * Depth-only shader for the directional shadow map pass (GLSL ES 3.00).
 *
 * Geometry is transformed by `uLightSpaceMatrix * uModel` and the GPU's built-in
 * depth buffer (a sampleable DEPTH_COMPONENT32F texture) records the closest
 * depth per texel. The fragment stage does nothing but let depth be written, so
 * it is intentionally minimal.
 */

export const DEPTH_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;

uniform mat4 uLightSpaceMatrix;
uniform mat4 uModel;

void main() {
  gl_Position = uLightSpaceMatrix * uModel * vec4(aPosition, 1.0);
}
`;

export const DEPTH_FRAG = /* glsl */ `#version 300 es
precision highp float;

void main() {
  // Depth is written automatically; no color output is needed.
}
`;
