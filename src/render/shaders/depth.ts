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

// The shadow framebuffer has a color attachment (draw buffer 0), so the
// fragment stage must declare a matching output or WebGL2 raises
// "active draw buffers with missing fragment shader outputs" and discards the
// draw. We only care about the depth texture; this value is unused.
out vec4 fragColor;

void main() {
  fragColor = vec4(1.0);
}
`;
