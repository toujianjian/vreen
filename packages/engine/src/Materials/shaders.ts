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

uniform sampler2D u_baseColorMap;
uniform int       u_baseColorMapEnabled;
uniform sampler2D u_metallicRoughnessMap;
uniform int       u_metallicRoughnessMapEnabled;

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

uniform sampler2D u_ssaoMap;
uniform int       u_ssaoEnabled;

uniform samplerCube u_envMap;
uniform int         u_envMapEnabled;

// ── constants ───────────────────────────────────────────────────────
const float PI = 3.14159265359;

// ── shadow PCF (Poisson disk, 16-tap) ──────────────────────────────
const vec2 poissonDisk[16] = vec2[16](
  vec2(-0.94201624, -0.39906216),
  vec2( 0.94558609, -0.76890725),
  vec2(-0.09418410, -0.92938870),
  vec2( 0.34495938,  0.29387760),
  vec2(-0.91588581,  0.45771432),
  vec2(-0.81544232, -0.87912464),
  vec2(-0.38277543,  0.27676845),
  vec2( 0.97484398,  0.75648379),
  vec2( 0.44323325, -0.97511554),
  vec2( 0.53742981, -0.47373420),
  vec2(-0.26496911, -0.41893023),
  vec2( 0.79197514,  0.19090188),
  vec2(-0.24188840,  0.99706507),
  vec2(-0.81409955,  0.91437590),
  vec2( 0.19984126,  0.78641367),
  vec2( 0.14383161, -0.14100790)
);

float sampleShadow(vec3 worldPos) {
  if (u_shadowEnabled == 0) return 1.0;
  vec4 lp = u_lightVP * vec4(worldPos, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0 || ndc.z < -1.0 || ndc.z > 1.0) {
    return 1.0;
  }
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float depth = ndc.z * 0.5 + 0.5;

  // 屏幕空间导数 → 动态模糊半径
  float radius = max(1.0 / u_shadowMapSize.x, length(vec2(dFdx(depth), dFdy(depth))) * 4.0);

  float sum = 0.0;
  for (int i = 0; i < 16; ++i) {
    vec2 off = poissonDisk[i] * radius;
    float d = texture(u_shadowMap, uv + off).r;
    sum += (depth - u_shadowBias > d) ? 0.0 : 1.0;
  }
  return sum / 16.0;
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

vec3 getIBLContribution(vec3 N, vec3 V, vec3 f0, float roughness, float metallic) {
  if (u_envMapEnabled == 0) return vec3(0.0);

  vec3 R = reflect(-V, N);
  float mipLevel = roughness * 4.0;
  vec3 envColor = textureLod(u_envMap, R, mipLevel).rgb;

  float NoV = max(dot(N, V), 0.0);
  vec3 F = F_Schlick_Rough(NoV, f0, roughness);

  vec3 kd = (vec3(1.0) - F) * (1.0 - metallic);
  vec3 diffEnv = textureLod(u_envMap, N, 4.0).rgb;

  return kd * diffEnv * 0.5 + F * envColor * 0.5;
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
  float metallic = u_metallic;
  float roughness = u_roughness;

  if (u_baseColorMapEnabled == 1) {
    baseColor *= texture(u_baseColorMap, v_uv).rgb;
  }
  if (u_metallicRoughnessMapEnabled == 1) {
    // GLTF 2.0 convention: G = roughness, B = metallic
    vec4 mr = texture(u_metallicRoughnessMap, v_uv);
    metallic *= mr.b;
    roughness *= mr.g;
  }
  a = max(roughness * roughness, 0.0025);
  vec3 f0 = mix(vec3(0.04), baseColor, metallic);

  float D  = D_GGX(NoH, a);
  float Vs = V_SmithGGXCorrelated(NoV, NoL, a);
  vec3  F  = F_Schlick(VoH, f0);

  vec3 spec = D * Vs * F;
  vec3 kd = (vec3(1.0) - F) * (1.0 - metallic);
  vec3 diff = kd * baseColor / PI;

  vec3 lighting = (diff + spec) * NoL * u_lightColor * u_lightIntensity;

  float upWeight = 0.5 + 0.5 * N.y;
  vec3 ambient = mix(u_ambientGround, u_ambientSky, upWeight) * baseColor * u_ambientColor;

  vec3 ibl = getIBLContribution(N, V, f0, roughness, metallic);

  float shadow = sampleShadow(v_worldPos);

  float ao = u_ssaoEnabled == 1 ? texture(u_ssaoMap, gl_FragCoord.xy / u_shadowMapSize).r : 1.0;

  vec3 color = ambient * ao + ibl * ao + lighting * shadow + u_emissive * u_emissiveIntensity;

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

export const DEPTH_NORMAL_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;

out vec3 v_worldPos;
out vec3 v_worldNormal;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  gl_Position = u_projection * u_view * worldPos;
}
`;

export const DEPTH_NORMAL_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;

out vec4 outDepth;
out vec4 outNormal;

void main() {
  float depth = gl_FragCoord.z;
  outDepth = vec4(depth, depth, depth, 1.0);
  outNormal = vec4(normalize(v_worldNormal) * 0.5 + 0.5, 1.0);
}
`;

export const SSAO_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;

out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 1.0);
}
`;

export const SSAO_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;

out vec4 outAO;

uniform sampler2D u_depthMap;
uniform sampler2D u_normalMap;
uniform mat4 u_projection;
uniform mat4 u_projectionInverse;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform float u_ssaoRadius;
uniform float u_ssaoBias;
uniform int u_ssaoEnabled;

const float PI = 3.14159265359;

vec3 getViewPos(vec2 uv, float depth) {
  vec4 clipPos = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 viewPos = u_projectionInverse * clipPos;
  return viewPos.xyz / viewPos.w;
}

float random(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  if (u_ssaoEnabled == 0) {
    outAO = vec4(1.0);
    return;
  }

  float depth = texture(u_depthMap, v_uv).r;
  vec3 normal = texture(u_normalMap, v_uv).xyz * 2.0 - 1.0;
  vec3 viewPos = getViewPos(v_uv, depth);

  if (depth >= 1.0) {
    outAO = vec4(1.0);
    return;
  }

  vec2 noiseScale = u_screenSize / 4.0;
  float rand = random(v_uv * noiseScale);
  float angle = rand * PI * 2.0;
  vec2 offsetDir = vec2(cos(angle), sin(angle));

  float occlusion = 0.0;
  const int samples = 16;
  float radius = u_ssaoRadius;

  for (int i = 0; i < samples; i++) {
    float theta = float(i) / float(samples) * PI * 2.0 + angle;
    float phi = acos(2.0 * random(vec2(float(i), rand)) - 1.0);
    float r = sqrt(random(vec2(rand, float(i))));

    vec3 sampleDir = vec3(
      sin(phi) * cos(theta),
      sin(phi) * sin(theta),
      cos(phi)
    );

    sampleDir = normalize(mix(sampleDir, normal, 0.5));

    vec3 samplePos = viewPos + sampleDir * r * radius;

    vec4 clipSample = u_projection * vec4(samplePos, 1.0);
    clipSample.xyz /= clipSample.w;
    vec2 sampleUV = clipSample.xy * 0.5 + 0.5;

    float sampleDepth = texture(u_depthMap, sampleUV).r;
    vec3 sampleViewPos = getViewPos(sampleUV, sampleDepth);

    float rangeCheck = smoothstep(0.0, 1.0, radius / abs(viewPos.z - sampleViewPos.z));
    float depthDiff = sampleViewPos.z - samplePos.z;
    float visibility = depthDiff >= u_ssaoBias ? 1.0 : 0.0;
    occlusion += (1.0 - visibility) * rangeCheck;
  }

  occlusion = 1.0 - (occlusion / float(samples));
  outAO = vec4(pow(occlusion, 2.0));
}
`;

export const POST_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;

out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 1.0);
}
`;

export const BLOOM_EXTRACT_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_bloomThreshold;

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb;
  float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
  if (brightness > u_bloomThreshold) {
    outColor = vec4(color, 1.0);
  } else {
    outColor = vec4(0.0);
  }
}
`;

export const BLOOM_BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_blurDir;
uniform float u_blurStrength;
uniform vec2 u_screenSize;

void main() {
  vec2 texel = 1.0 / u_screenSize;
  vec3 color = vec3(0.0);
  float total = 0.0;

  const int samples = 11;
  for (int i = -samples; i <= samples; i++) {
    float t = float(i);
    float weight = exp(-t * t / (2.0 * u_blurStrength * u_blurStrength));
    color += texture(u_colorMap, v_uv + u_blurDir * texel * t).rgb * weight;
    total += weight;
  }

  outColor = vec4(color / total, 1.0);
}
`;

export const CHROMATIC_ABERRATION_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_caOffset;

void main() {
  vec2 uv = v_uv - 0.5;
  float dist = length(uv);
  vec2 offset = uv * dist * u_caOffset;

  float r = texture(u_colorMap, v_uv + offset).r;
  float g = texture(u_colorMap, v_uv).g;
  float b = texture(u_colorMap, v_uv - offset).b;

  outColor = vec4(r, g, b, 1.0);
}
`;

export const VIGNETTE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_vignetteDarkness;
uniform float u_vignetteOffset;

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb;
  vec2 uv = v_uv - 0.5;
  float dist = length(uv);
  float vignette = smoothstep(u_vignetteOffset + 0.4, u_vignetteOffset, dist);
  color *= 1.0 - u_vignetteDarkness * (1.0 - vignette);
  outColor = vec4(color, 1.0);
}
`;

export const FINAL_COMPOSE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_bloomMap;
uniform float u_bloomIntensity;
uniform int u_bloomEnabled;

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb;
  if (u_bloomEnabled == 1) {
    vec3 bloom = texture(u_bloomMap, v_uv).rgb;
    color += bloom * u_bloomIntensity;
  }
  color = color / (color + vec3(1.0));
  outColor = vec4(color, 1.0);
}
`;
