/**
 * Shared GLSL ES 3.00 source chunks (raw strings).
 *
 * These are concatenated by the concrete shader sources (pbr/postfx) rather than
 * relying on `#include`, which keeps the pipeline robust and free of registry
 * ordering concerns. Every chunk is `#version`-less so it can be spliced after a
 * single `#version 300 es` directive in the consuming source.
 *
 * Provided here: physically-based BRDF helpers (GGX distribution, Smith
 * geometry, Schlick fresnel), tonemapping operators (ACES filmic + reinhard),
 * and sRGB <-> linear conversions plus a small math constants block.
 */

/** Math constants and the dielectric F0 baseline used across the PBR shaders. */
export const GLSL_CONSTANTS = /* glsl */ `
const float PI = 3.14159265359;
const float INV_PI = 0.31830988618;
const float EPSILON = 1e-5;
`;

/** sRGB <-> linear conversion helpers (component + vec3 forms). */
export const GLSL_COLOR_SPACE = /* glsl */ `
vec3 linearToSRGB(vec3 c) {
  // Accurate piecewise sRGB OETF.
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
  return mix(hi, lo, vec3(cutoff));
}

vec3 sRGBToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  return mix(hi, lo, vec3(cutoff));
}
`;

/** Tonemapping operators. ACES (Narkowicz fit) + reinhard. Input is linear HDR. */
export const GLSL_TONEMAP = /* glsl */ `
vec3 tonemapACES(vec3 x) {
  // Narkowicz 2015 "ACES Filmic Tone Mapping Curve" fit.
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 tonemapReinhard(vec3 x) {
  return x / (x + vec3(1.0));
}
`;

/**
 * Cook-Torrance PBR BRDF building blocks for a metallic-roughness workflow.
 * Depends on GLSL_CONSTANTS (PI). Uses roughness (not alpha) as input and
 * squares it internally per Disney remapping.
 */
export const GLSL_PBR = /* glsl */ `
float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float NdotH2 = NdotH * NdotH;
  float denom = (NdotH2 * (a2 - 1.0) + 1.0);
  denom = PI * denom * denom;
  return a2 / max(denom, EPSILON);
}

float geometrySchlickGGX(float NdotV, float roughness) {
  // Direct-lighting remapping of roughness to k.
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  float NdotV = max(dot(N, V), 0.0);
  float NdotL = max(dot(N, L), 0.0);
  float ggxV = geometrySchlickGGX(NdotV, roughness);
  float ggxL = geometrySchlickGGX(NdotL, roughness);
  return ggxV * ggxL;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
`;

/** Convenience: everything the fragment PBR shader needs, in dependency order. */
export const GLSL_PBR_LIB =
  GLSL_CONSTANTS + GLSL_COLOR_SPACE + GLSL_TONEMAP + GLSL_PBR;
