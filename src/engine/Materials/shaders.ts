// PBR shaders — Cook-Torrance metallic-roughness, single directional
// light + ambient + IBL ambient. Inline strings keep the bundle simple
// (no extra Vite plugin). Designed to be safe under GLSL ES 3.0.
//
// `USE_SKINNING` is set by the renderer when drawing a SkinnedMesh —
// the vertex shader then deforms the position/normal by 4 weighted
// bone matrices.

export const PBR_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
#ifdef USE_SKINNING
layout(location = 5) in vec4 a_skinIndex;   // bone indices (as float, int-cast in shader)
layout(location = 6) in vec4 a_skinWeight; // bone weights (sum to 1)
#endif

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
#ifdef USE_SKINNING
uniform mat4 u_bindMatrixInverse;
uniform mat4 u_boneMatrices[64];
#endif

out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec2 v_uv;

void main() {
  vec3 pos = a_position;
  vec3 nrm = a_normal;

#ifdef USE_SKINNING
  // Linear blend skinning — up to 4 bones per vertex.
  mat4 skin = u_boneMatrices[int(a_skinIndex.x)] * a_skinWeight.x
            + u_boneMatrices[int(a_skinIndex.y)] * a_skinWeight.y
            + u_boneMatrices[int(a_skinIndex.z)] * a_skinWeight.z
            + u_boneMatrices[int(a_skinIndex.w)] * a_skinWeight.w;
  vec4 skinned = skin * vec4(pos, 1.0);
  // Normals: skin matrix's upper-left 3x3, then bindMatrixInverse.
  mat3 skinN = mat3(skin);
  vec3 skinnedN = normalize(skinN * nrm);

  vec4 localPos = u_bindMatrixInverse * skinned;
  vec3 localNrm = mat3(u_bindMatrixInverse) * skinnedN;
#else
  vec4 localPos = vec4(pos, 1.0);
  vec3 localNrm = nrm;
#endif

  vec4 worldPos = u_model * localPos;
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * localNrm);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

// Cook-Torrance metallic-roughness. Single directional light + ambient
// hemisphere. PCF soft shadow. Designed to be the only fragment shader
// the renderer needs for opaque meshes in step2.2.
export const PBR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;

out vec4 outColor;

uniform vec3  u_cameraPos;
uniform vec3  u_baseColor;
uniform float u_metallic;
uniform float u_roughness;
uniform vec3  u_emissive;
uniform float u_emissiveIntensity;
uniform float u_opacity;

uniform vec3  u_lightDir;     // direction the light points TOWARD (world space)
uniform vec3  u_lightColor;
uniform float u_lightIntensity;
uniform vec3  u_ambientColor;
uniform vec3  u_ambientSky;
uniform vec3  u_ambientGround;

uniform sampler2D u_shadowMap;
uniform mat4      u_lightVP;   // light's viewProjection for shadow lookup
uniform float     u_shadowBias;
uniform int       u_shadowEnabled;
uniform vec2      u_shadowMapSize;

// ── constants ───────────────────────────────────────────────────────
const float PI = 3.14159265359;

// ── shadow PCF (5-tap) ─────────────────────────────────────────────
float sampleShadow(vec3 worldPos) {
  if (u_shadowEnabled == 0) return 1.0;
  vec4 lp = u_lightVP * vec4(worldPos, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0 || ndc.z < -1.0 || ndc.z > 1.0) {
    return 1.0;
  }
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float depth = ndc.z * 0.5 + 0.5;

  float texel = 1.0 / u_shadowMapSize.x;
  float sum = 0.0;
  for (int x = -1; x <= 1; ++x) {
    for (int y = -1; y <= 1; ++y) {
      float d = texture(u_shadowMap, uv + vec2(float(x), float(y)) * texel).r;
      sum += (depth - u_shadowBias > d) ? 0.0 : 1.0;
    }
  }
  return sum / 9.0;
}

// ── GGX / Smith / Schlick ──────────────────────────────────────────
float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float f = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * f * f + 1e-7);
}

float V_SmithGGXCorrelated(float NoV, float NoL, float a) {
  float a2 = a * a;
  float GGXL = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  float GGXV = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  return 0.5 / (GGXV + GGXL + 1e-7);
}

vec3 F_Schlick(float u, vec3 f0) {
  return f0 + (vec3(1.0) - f0) * pow(1.0 - u, 5.0);
}

vec3 F_Schlick_Rough(float u, vec3 f0, float a) {
  return f0 + (max(vec3(1.0 - a), f0) - f0) * pow(1.0 - u, 5.0);
}

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 L = normalize(-u_lightDir);
  vec3 H = normalize(V + L);
  float NoL = max(dot(N, L), 0.0);
  float NoV = max(dot(N, V), 0.0);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);

  float a = max(u_roughness * u_roughness, 0.0025);
  vec3 baseColor = u_baseColor;
  vec3 f0 = mix(vec3(0.04), baseColor, u_metallic);

  float D  = D_GGX(NoH, a);
  float Vs = V_SmithGGXCorrelated(NoV, NoL, a);
  vec3  F  = F_Schlick(VoH, f0);

  vec3 spec = D * Vs * F;
  vec3 kd = (vec3(1.0) - F) * (1.0 - u_metallic);
  vec3 diff = kd * baseColor / PI;

  vec3 lighting = (diff + spec) * NoL * u_lightColor * u_lightIntensity;

  float upWeight = 0.5 + 0.5 * N.y;
  vec3 ambient = mix(u_ambientGround, u_ambientSky, upWeight) * baseColor * u_ambientColor;

  float shadow = sampleShadow(v_worldPos);

  vec3 color = ambient + lighting * shadow + u_emissive * u_emissiveIntensity;

  color = color / (color + vec3(1.0));

  outColor = vec4(color, u_opacity);
}
`;

// Shadow pass — write linear depth to a 2D depth texture. Includes a
// skinning variant so SkinnedMeshes cast correct shadows.
export const SHADOW_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
#ifdef USE_SKINNING
layout(location = 5) in vec4 a_skinIndex;
layout(location = 6) in vec4 a_skinWeight;
#endif

uniform mat4 u_model;
uniform mat4 u_lightVP;
#ifdef USE_SKINNING
uniform mat4 u_bindMatrixInverse;
uniform mat4 u_boneMatrices[64];
#endif

void main() {
#ifdef USE_SKINNING
  mat4 skin = u_boneMatrices[int(a_skinIndex.x)] * a_skinWeight.x
            + u_boneMatrices[int(a_skinIndex.y)] * a_skinWeight.y
            + u_boneMatrices[int(a_skinIndex.z)] * a_skinWeight.z
            + u_boneMatrices[int(a_skinIndex.w)] * a_skinWeight.w;
  vec4 skinned = skin * vec4(a_position, 1.0);
  vec4 localPos = u_bindMatrixInverse * skinned;
#else
  vec4 localPos = vec4(a_position, 1.0);
#endif
  gl_Position = u_lightVP * u_model * localPos;
}
`;

export const SHADOW_FRAG = /* glsl */ `#version 300 es
precision highp float;

void main() {
  // gl_FragDepth is written automatically; nothing else to do.
}
`;
