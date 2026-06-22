/**
 * Post-processing shaders (GLSL ES 3.00).
 *
 * All passes are driven by a single attribute-less fullscreen triangle: the
 * vertex shader synthesizes clip-space positions and UVs from `gl_VertexID`
 * (draw 3 vertices, no VBO required). Fragment passes:
 *
 *  - BRIGHT_PASS  : threshold-extract bright pixels for bloom.
 *  - BLUR         : separable Gaussian blur (uDirection chooses H/V).
 *  - COMPOSITE    : HDR scene + bloom, exposure, ACES tonemap, vignette, sRGB.
 *  - FXAA         : edge-aware antialiasing on the LDR sRGB result.
 */
import { GLSL_TONEMAP, GLSL_COLOR_SPACE } from './common';

/** Fullscreen triangle: gl_VertexID -> NDC + UV, no vertex buffer required. */
export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  // Big triangle covering the screen; UVs in [0,1] over the viewport.
  vec2 pos = vec2(
    float((gl_VertexID << 1) & 2),
    float(gl_VertexID & 2)
  );
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Extract pixels above a luminance threshold with a soft knee for bloom. */
export const BRIGHT_PASS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform float uThreshold;

void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee around the threshold to avoid hard popping.
  float knee = uThreshold * 0.5 + 1e-4;
  float soft = clamp((luma - uThreshold + knee) / (2.0 * knee), 0.0, 1.0);
  float contribution = max(soft, step(uThreshold, luma));
  fragColor = vec4(c * contribution, 1.0);
}
`;

/** Separable 9-tap Gaussian blur. uDirection is the per-texel step (H or V). */
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uDirection; // texel-sized offset along blur axis

const float W0 = 0.227027;
const float W1 = 0.1945946;
const float W2 = 0.1216216;
const float W3 = 0.054054;
const float W4 = 0.016216;

void main() {
  vec3 result = texture(uTex, vUv).rgb * W0;
  result += texture(uTex, vUv + uDirection * 1.0).rgb * W1;
  result += texture(uTex, vUv - uDirection * 1.0).rgb * W1;
  result += texture(uTex, vUv + uDirection * 2.0).rgb * W2;
  result += texture(uTex, vUv - uDirection * 2.0).rgb * W2;
  result += texture(uTex, vUv + uDirection * 3.0).rgb * W3;
  result += texture(uTex, vUv - uDirection * 3.0).rgb * W3;
  result += texture(uTex, vUv + uDirection * 4.0).rgb * W4;
  result += texture(uTex, vUv - uDirection * 4.0).rgb * W4;
  fragColor = vec4(result, 1.0);
}
`;

/**
 * Composite the HDR scene with bloom, apply exposure + tonemapping, a vignette,
 * and gamma-encode to sRGB. Tonemap operator selected by uToneMapping
 * (0 = none, 1 = ACES, 2 = reinhard).
 */
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomStrength;
uniform bool uBloomEnabled;
uniform int uToneMapping;   // 0 none, 1 aces, 2 reinhard
uniform float uVignette;    // 0..1 strength

${GLSL_TONEMAP}
${GLSL_COLOR_SPACE}

void main() {
  vec3 hdr = texture(uScene, vUv).rgb;
  if (uBloomEnabled) {
    hdr += texture(uBloom, vUv).rgb * uBloomStrength;
  }

  hdr *= uExposure;

  vec3 mapped;
  if (uToneMapping == 1) {
    mapped = tonemapACES(hdr);
  } else if (uToneMapping == 2) {
    mapped = tonemapReinhard(hdr);
  } else {
    mapped = clamp(hdr, 0.0, 1.0);
  }

  // Vignette: darken toward the corners.
  vec2 d = vUv - 0.5;
  float vig = 1.0 - uVignette * dot(d, d) * 2.0;
  mapped *= clamp(vig, 0.0, 1.0);

  fragColor = vec4(linearToSRGB(mapped), 1.0);
}
`;

/**
 * FXAA 3.11-style edge antialiasing operating on an LDR sRGB image.
 * Expects uTexel = 1/resolution.
 */
export const FXAA_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uTexel;

const float EDGE_MIN = 1.0 / 128.0;
const float EDGE_MAX = 1.0 / 8.0;
const float SPAN_MAX = 8.0;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec3 rgbM = texture(uTex, vUv).rgb;
  vec3 rgbNW = texture(uTex, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture(uTex, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture(uTex, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 rgbSE = texture(uTex, vUv + vec2( 1.0,  1.0) * uTexel).rgb;

  float lumaM = luma(rgbM);
  float lumaNW = luma(rgbNW);
  float lumaNE = luma(rgbNE);
  float lumaSW = luma(rgbSW);
  float lumaSE = luma(rgbSE);

  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

  if (lumaMax - lumaMin < max(EDGE_MIN, lumaMax * EDGE_MAX)) {
    fragColor = vec4(rgbM, 1.0);
    return;
  }

  vec2 dir;
  dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
  dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

  float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * EDGE_MAX, EDGE_MIN);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-SPAN_MAX), vec2(SPAN_MAX)) * uTexel;

  vec3 rgbA = 0.5 * (
    texture(uTex, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
    texture(uTex, vUv + dir * (2.0 / 3.0 - 0.5)).rgb
  );
  vec3 rgbB = rgbA * 0.5 + 0.25 * (
    texture(uTex, vUv + dir * -0.5).rgb +
    texture(uTex, vUv + dir *  0.5).rgb
  );

  float lumaB = luma(rgbB);
  if (lumaB < lumaMin || lumaB > lumaMax) {
    fragColor = vec4(rgbA, 1.0);
  } else {
    fragColor = vec4(rgbB, 1.0);
  }
}
`;
