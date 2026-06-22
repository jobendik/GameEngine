/**
 * PBR forward shader (GLSL ES 3.00).
 *
 * Metallic-roughness Cook-Torrance lighting with:
 *  - 1 directional light (with a single shadow cascade, 3x3 PCF + slope bias),
 *  - up to MAX_LIGHTS point/spot lights,
 *  - albedo/normal/metallic-roughness/emissive/AO texture maps (with `has` flags),
 *  - normal mapping via a vertex-derived TBN basis,
 *  - exponential fog,
 *  - LINEAR HDR output (tonemapping happens in postfx).
 *
 * Standard attribute locations (CONTRACTS section 4): 0 pos, 1 normal, 2 uv,
 * 3 tangent(xyz + handedness w).
 */
import { GLSL_PBR_LIB } from './common';

/** Max simultaneous punctual (point/spot) lights uploaded as uniform arrays. */
export const MAX_LIGHTS = 8;

export const PBR_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aTangent;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMatrix;
uniform mat4 uLightSpaceMatrix;
uniform vec2 uTiling;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out mat3 vTBN;
out vec4 vLightSpacePos;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vWorldPos = worldPos.xyz;

  vec3 N = normalize(uNormalMatrix * aNormal);
  vec3 T = normalize(uNormalMatrix * aTangent.xyz);
  // Re-orthogonalize T against N (Gram-Schmidt) and build bitangent.
  T = normalize(T - dot(T, N) * N);
  vec3 B = cross(N, T) * aTangent.w;
  vTBN = mat3(T, B, N);
  vNormal = N;

  vUv = aUv * uTiling;
  vLightSpacePos = uLightSpaceMatrix * worldPos;

  gl_Position = uProj * uView * worldPos;
}
`;

export const PBR_FRAG = /* glsl */ `#version 300 es
precision highp float;

#define MAX_LIGHTS ${MAX_LIGHTS}

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in mat3 vTBN;
in vec4 vLightSpacePos;

out vec4 fragColor;

// ---- Camera / environment ----
uniform vec3 uCamPos;
uniform vec3 uAmbient;

// ---- Directional light ----
uniform vec3 uDirLightDir;     // direction the light travels (world space)
uniform vec3 uDirLightColor;   // color * intensity (already premultiplied)

// ---- Punctual lights ----
uniform int  uNumLights;
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];   // color * intensity
uniform vec3 uLightDir[MAX_LIGHTS];     // spot direction
uniform float uLightRange[MAX_LIGHTS];
uniform float uLightType[MAX_LIGHTS];   // 1 = point, 2 = spot, 0 = unused
uniform vec2 uLightCone[MAX_LIGHTS];    // (cosInner, cosOuter)

// ---- Material ----
uniform vec3 uAlbedo;
uniform float uMetallic;
uniform float uRoughness;
uniform vec3 uEmissive;
uniform float uOpacity;

uniform sampler2D uAlbedoMap;
uniform sampler2D uNormalMap;
uniform sampler2D uMRMap;
uniform sampler2D uEmissiveMap;
uniform sampler2D uAoMap;
uniform bool uHasAlbedoMap;
uniform bool uHasNormalMap;
uniform bool uHasMRMap;
uniform bool uHasEmissiveMap;
uniform bool uHasAoMap;

// ---- Shadow ----
uniform sampler2D uShadowMap;
uniform bool uShadowEnabled;

// ---- Fog ----
uniform vec3 uFogColor;
uniform float uFogDensity;

${GLSL_PBR_LIB}

// 3x3 PCF shadow lookup with a slope-scaled depth bias.
float sampleShadow(vec4 lightSpacePos, float NdotL) {
  if (!uShadowEnabled) return 1.0;

  vec3 proj = lightSpacePos.xyz / lightSpacePos.w;
  proj = proj * 0.5 + 0.5;

  // Outside the shadow frustum => fully lit.
  if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) {
    return 1.0;
  }

  float bias = max(0.0025 * (1.0 - NdotL), 0.0005);
  float currentDepth = proj.z - bias;

  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float shadow = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float closest = texture(uShadowMap, proj.xy + vec2(float(x), float(y)) * texel).r;
      shadow += currentDepth <= closest ? 1.0 : 0.0;
    }
  }
  return shadow / 9.0;
}

// Smooth distance attenuation with a hard range cutoff.
float distanceAttenuation(float dist, float range) {
  float atten = 1.0 / max(dist * dist, EPSILON);
  float window = clamp(1.0 - pow(dist / max(range, EPSILON), 4.0), 0.0, 1.0);
  return atten * window * window;
}

// Evaluate one light's outgoing radiance contribution.
vec3 evalLight(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 albedo, float metallic, float roughness, vec3 F0) {
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  if (NdotL <= 0.0) return vec3(0.0);

  float NDF = distributionGGX(N, H, roughness);
  float G = geometrySmith(N, V, L, roughness);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);

  vec3 numerator = NDF * G * F;
  float denom = 4.0 * max(dot(N, V), 0.0) * NdotL + EPSILON;
  vec3 specular = numerator / denom;

  vec3 kS = F;
  vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);

  return (kD * albedo * INV_PI + specular) * radiance * NdotL;
}

void main() {
  // --- Sample material ---
  vec3 albedo = uAlbedo;
  float alpha = uOpacity;
  if (uHasAlbedoMap) {
    vec4 a = texture(uAlbedoMap, vUv);
    albedo *= sRGBToLinear(a.rgb);
    alpha *= a.a;
  }

  float metallic = uMetallic;
  float roughness = uRoughness;
  if (uHasMRMap) {
    vec3 mr = texture(uMRMap, vUv).rgb; // glTF: G=roughness, B=metallic
    roughness *= mr.g;
    metallic *= mr.b;
  }
  roughness = clamp(roughness, 0.04, 1.0);
  metallic = clamp(metallic, 0.0, 1.0);

  float ao = 1.0;
  if (uHasAoMap) ao = texture(uAoMap, vUv).r;

  vec3 emissive = uEmissive;
  if (uHasEmissiveMap) emissive *= sRGBToLinear(texture(uEmissiveMap, vUv).rgb);

  // --- Normal ---
  vec3 N = normalize(vNormal);
  if (uHasNormalMap) {
    vec3 tn = texture(uNormalMap, vUv).xyz * 2.0 - 1.0;
    N = normalize(vTBN * tn);
  }
  if (!gl_FrontFacing) N = -N;

  vec3 V = normalize(uCamPos - vWorldPos);

  vec3 F0 = mix(vec3(0.04), albedo, metallic);

  vec3 Lo = vec3(0.0);

  // --- Directional light + shadow ---
  {
    vec3 L = normalize(-uDirLightDir);
    float NdotL = max(dot(N, L), 0.0);
    float shadow = sampleShadow(vLightSpacePos, NdotL);
    Lo += evalLight(N, V, L, uDirLightColor, albedo, metallic, roughness, F0) * shadow;
  }

  // --- Punctual lights ---
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uNumLights) break;
    float type = uLightType[i];
    if (type < 0.5) continue;

    vec3 toLight = uLightPos[i] - vWorldPos;
    float dist = length(toLight);
    vec3 L = toLight / max(dist, EPSILON);

    float atten = distanceAttenuation(dist, uLightRange[i]);

    if (type > 1.5) {
      // Spot: cone falloff between inner and outer cosines.
      float cd = dot(normalize(-uLightDir[i]), L);
      float spot = clamp((cd - uLightCone[i].y) / max(uLightCone[i].x - uLightCone[i].y, EPSILON), 0.0, 1.0);
      atten *= spot * spot;
    }

    vec3 radiance = uLightColor[i] * atten;
    Lo += evalLight(N, V, L, radiance, albedo, metallic, roughness, F0);
  }

  // --- Ambient (simple diffuse IBL approximation) ---
  vec3 ambient = uAmbient * albedo * ao;

  vec3 color = ambient + Lo + emissive;

  // --- Exponential fog (toward camera) ---
  float dist = length(uCamPos - vWorldPos);
  float fogFactor = 1.0 - exp(-uFogDensity * dist);
  fogFactor = clamp(fogFactor, 0.0, 1.0);
  color = mix(color, uFogColor, fogFactor);

  fragColor = vec4(color, alpha);
}
`;
