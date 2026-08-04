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
#ifdef USE_INSTANCING
// Per-instance model matrix, 4 columns at locations 7..10 (mat4 takes 4 slots).
layout(location = 7) in mat4 a_instanceMatrix;
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

#ifdef USE_INSTANCING
  // Instanced: per-instance model matrix replaces u_model.
  // u_model 仍设为 identity(renderer 保证),实例变换全部由 a_instanceMatrix 提供。
  // 法线用 mat3(instanceMatrix) 近似(非均匀缩放下不准确,均匀缩放 OK)。
  vec4 worldPos = a_instanceMatrix * localPos;
  v_worldNormal = normalize(mat3(a_instanceMatrix) * localNrm);
#else
  vec4 worldPos = u_model * localPos;
  v_worldNormal = normalize(u_normalMatrix * localNrm);
#endif
  v_worldPos = worldPos.xyz;
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
uniform sampler2D u_normalMap;
uniform int       u_normalMapEnabled;
uniform float     u_normalScale;
uniform sampler2D u_emissiveMap;
uniform int       u_emissiveMapEnabled;

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

  // ── Normal map (derivative-based TBN, no precomputed tangents) ──
  // 参考 Christian Schüler "Normal Mapping Without Precomputed Tangents"
  // 用屏幕导数构建 TBN,无需 a_tangent 顶点属性,所有 mesh 通用。
  if (u_normalMapEnabled == 1) {
    vec3 dp1 = dFdx(v_worldPos);
    vec3 dp2 = dFdy(v_worldPos);
    vec2 duv1 = dFdx(v_uv);
    vec2 duv2 = dFdy(v_uv);
    vec3 dp2perp = cross(dp2, N);
    vec3 dp1perp = cross(N, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
    float invLen = inversesqrt(max(dot(T, T), dot(B, B)));
    T *= invLen;
    B *= invLen;
    mat3 TBN = mat3(T, B, N);
    // 解码切线空间法线 [0,1] → [-1,1],乘 normalScale 控制强度
    vec3 sampled = texture(u_normalMap, v_uv).xyz * 2.0 - 1.0;
    sampled.xy *= u_normalScale;
    N = normalize(TBN * sampled);
  }

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
#ifdef USE_SPECULAR_AA
  // SpecularAA (Toksvig / LEAN): screen-space normal variance → roughness boost.
  // 消除远距离高频法线区域的镜面高光闪烁/爬行。
  // 参考 UE5 "Anti-Aliasing Specular Highlights" + o3de Atom SpecularAA。
  {
    vec3 dNdx_aa = dFdx(N);
    vec3 dNdy_aa = dFdy(N);
    float variance_aa = dot(dNdx_aa, dNdx_aa) + dot(dNdy_aa, dNdy_aa);
    roughness = clamp(sqrt(roughness * roughness + variance_aa * 0.25), 0.045, 1.0);
  }
#endif
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

  // ── Emissive map(自发光贴图,与 u_emissive uniform 相乘)──
  vec3 emissive = u_emissive;
  if (u_emissiveMapEnabled == 1) {
    emissive *= texture(u_emissiveMap, v_uv).rgb;
  }

  vec3 color = ambient * ao + ibl * ao + lighting * shadow + emissive * u_emissiveIntensity;

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

// ── 后处理管线扩展 shader ───────────────────────────────────────────
// 注:已有 SSAO_FRAG 是 G-buffer(depth+normal)版本,供主渲染器使用。
// 这里新增 SSAO_POST_FRAG 是 post-processing pipeline 兼容的简化版
// (仅 colorMap 输入),作为框架占位;真实 SSAO 应走 G-buffer 路径。

// SSAO 简化版:仅基于 colorMap 的亮度对比度近似遮蔽(非真实 SSAO,
// 仅作 pipeline 框架占位)。radius 控制采样半径,intensity 控制暗度。
export const SSAO_POST_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_screenSize;
uniform float u_ssaoRadius;
uniform float u_ssaoIntensity;

void main() {
  vec3 center = texture(u_colorMap, v_uv).rgb;
  vec2 texel = 1.0 / u_screenSize;

  // 8 邻域采样,统计亮度差异作为简易遮蔽因子
  float lumCenter = dot(center, vec3(0.2126, 0.7152, 0.0722));
  float occlusion = 0.0;
  const int samples = 8;
  for (int i = 0; i < samples; i++) {
    float a = float(i) * 0.7853981; // PI/4
    vec2 off = vec2(cos(a), sin(a)) * u_ssaoRadius * texel;
    vec3 n = texture(u_colorMap, v_uv + off).rgb;
    float lumN = dot(n, vec3(0.2126, 0.7152, 0.0722));
    occlusion += max(0.0, lumN - lumCenter);
  }
  occlusion /= float(samples);
  float ao = 1.0 - u_ssaoIntensity * occlusion;
  outColor = vec4(center * ao, 1.0);
}
`;

// FXAA:简化版快速近似抗锯齿。基于亮度梯度的 4-tap 边缘检测 + 双向混合。
// 参考 three.js FXAAShader,精简为单 pass 可读版本。
export const FXAA_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_screenSize;

const float EDGE_THRESHOLD = 0.125;
const float EDGE_THRESHOLD_MIN = 0.0312;

float luminance(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 texel = 1.0 / u_screenSize;
  vec3 m = texture(u_colorMap, v_uv).rgb;
  vec3 n = texture(u_colorMap, v_uv + vec2(0.0,  texel.y)).rgb;
  vec3 s = texture(u_colorMap, v_uv + vec2(0.0, -texel.y)).rgb;
  vec3 w = texture(u_colorMap, v_uv + vec2(-texel.x, 0.0)).rgb;
  vec3 e = texture(u_colorMap, v_uv + vec2( texel.x, 0.0)).rgb;

  float lM = luminance(m);
  float lN = luminance(n);
  float lS = luminance(s);
  float lW = luminance(w);
  float lE = luminance(e);

  float lMin = min(min(min(min(lN, lS), lW), lE), lM);
  float lMax = max(max(max(max(lN, lS), lW), lE), lM);
  float range = lMax - lMin;

  if (range < max(EDGE_THRESHOLD_MIN, lMax * EDGE_THRESHOLD)) {
    outColor = vec4(m, 1.0);
    return;
  }

  // 简化:取最大梯度方向的 2-tap 混合
  float blendN = abs(lN - lM);
  float blendS = abs(lS - lM);
  float blendW = abs(lW - lM);
  float blendE = abs(lE - lM);

  bool isHorizontal = (blendN + blendS) > (blendW + blendE);
  float stepLen = isHorizontal ? texel.y : texel.x;
  float signDir = isHorizontal
    ? (blendN > blendS ? 1.0 : -1.0)
    : (blendE > blendW ? 1.0 : -1.0);

  float lOpp = isHorizontal
    ? (blendN > blendS ? lS : lN)
    : (blendE > blendW ? lW : lE);
  float gradient = isHorizontal
    ? (blendN > blendS ? blendN : blendS)
    : (blendE > blendW ? blendE : blendW);

  float edgeLum = (lM + lOpp) * 0.5;
  float threshold = gradient * 0.25;

  // 沿边缘方向走两步,寻找端点(简化:固定 2 步)
  vec2 dirOff = isHorizontal
    ? vec2(0.0, signDir * stepLen)
    : vec2(signDir * stepLen, 0.0);
  float lA = luminance(texture(u_colorMap, v_uv + dirOff).rgb);
  float lB = luminance(texture(u_colorMap, v_uv - dirOff).rgb);
  bool aEnd = abs(lA - edgeLum) >= threshold;
  bool bEnd = abs(lB - edgeLum) >= threshold;

  float pDist = aEnd ? 1.0 : 2.0;
  float nDist = bEnd ? 1.0 : 2.0;
  float shortest = min(pDist, nDist);
  float edgeBlend = 0.5 - shortest / (pDist + nDist);
  edgeBlend = max(0.0, edgeBlend);

  // 子像素混合(简化)
  float avg = (lN + lS + lW + lE) * 0.25;
  float subBlend = clamp(abs(avg - lM) / max(range, 1e-5), 0.0, 1.0);
  subBlend = subBlend * subBlend;

  float finalBlend = max(subBlend, edgeBlend);
  vec2 sampleOff = isHorizontal
    ? vec2(0.0, signDir * stepLen * finalBlend)
    : vec2(signDir * stepLen * finalBlend, 0.0);

  outColor = vec4(texture(u_colorMap, v_uv + sampleOff).rgb, 1.0);
}
`;

// 色调映射:支持 ACES Filmic / Reinhard / Linear 三种模式。
// u_mode: 0=Linear(直通), 1=Reinhard, 2=ACES Filmic
export const TONE_MAPPING_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_exposure;
uniform int u_mode;

vec3 acesFilmic(vec3 x) {
  // Narkowicz ACES approximation
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 reinhard(vec3 x) {
  return x / (x + vec3(1.0));
}

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb * u_exposure;
  if (u_mode == 2) {
    color = acesFilmic(color);
  } else if (u_mode == 1) {
    color = reinhard(color);
  }
  // mode == 0: Linear 直通
  outColor = vec4(color, 1.0);
}
`;

// 伽马校正:线性 → sRGB。u_gamma 默认 2.2。
export const GAMMA_CORRECT_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_gamma;

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb;
  color = pow(max(color, vec3(0.0)), vec3(1.0 / u_gamma));
  outColor = vec4(color, 1.0);
}
`;

// 景深简化版:基于屏幕空间亮度近似深度的圆形散景模糊。
// 非真实 DOF(需 depth buffer),仅作框架占位。
// u_focusDistance:归一化焦点距离(0..1,基于亮度近似)
// u_focusRange:焦点范围(范围外开始模糊)
// u_bokeh:散景圆半径(texel 倍数)
export const DOF_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_screenSize;
uniform float u_focusDistance;
uniform float u_focusRange;
uniform float u_bokeh;

void main() {
  vec2 texel = 1.0 / u_screenSize;
  vec3 center = texture(u_colorMap, v_uv).rgb;

  // 用亮度作为深度代理(简化):亮 → 远,暗 → 近
  float depthProxy = dot(center, vec3(0.2126, 0.7152, 0.0722));
  float dist = abs(depthProxy - u_focusDistance);
  float blur = smoothstep(u_focusRange, u_focusRange * 2.0, dist);

  if (blur < 0.001) {
    outColor = vec4(center, 1.0);
    return;
  }

  // 圆形散景采样(16 tap)
  vec3 accum = vec3(0.0);
  float total = 0.0;
  const int taps = 16;
  for (int i = 0; i < taps; i++) {
    float a = float(i) * (6.2831853 / float(taps));
    float r = (u_bokeh * blur) * texel.x;
    vec2 off = vec2(cos(a), sin(a)) * r;
    accum += texture(u_colorMap, v_uv + off).rgb;
    total += 1.0;
  }
  vec3 blurred = accum / total;
  outColor = vec4(mix(center, blurred, blur), 1.0);
}
`;

// ── 阴影系统 shader ───────────────────────────────────────────────────
// 参考 three.js ShaderLib/depth.glsl.js 与 shadow.glsl.js。
// 与已有 SHADOW_VERT/SHADOW_FRAG 区别:
//   - 已有 SHADOW_* 是 WebGL2Renderer 内部使用的精简版,只写 gl_FragDepth,
//     无 varyings,无 packing,不支持自定义 uniform;
//   - 新增 SHADOW_DEPTH_* 是 ShadowMapManager 使用的完整版本,显式输出
//     线性化深度到 R 通道(供 PCF 软阴影手动采样),支持 skinning 变体,
//     与 ShadowMaterial 配合可在主 pass 渲染纯阴影物体;
//   - PCF_SHADOW_FRAG 是 GLSL chunk,可被 PBR_FRAG 或自定义 shader 注入,
//     提供 3x3 / 5-tap PCF 软阴影采样函数,基于阴影贴图分辨率调半径。

/** 深度渲染顶点着色器:写入线性深度到 R 通道,供 PCF 软阴影手动采样。
 *  支持 USE_SKINNING 变体(由 ShadowMapManager 在 SkinnedMesh 上注入)。 */
export const SHADOW_DEPTH_VERT = /* glsl */ `#version 300 es
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

/** 深度渲染片段着色器:输出 NDC 深度 0..1 到 R 通道。
 *  使用 gl_FragCoord.z(WebGL2 自动透视投影线性化),避免手算 w 倒数。 */
export const SHADOW_DEPTH_FRAG = /* glsl */ `#version 300 es
precision highp float;

out vec4 outDepth;

void main() {
  // gl_FragCoord.z 已是 0..1 的窗口空间深度;写入 R 通道供 PCF 手动采样。
  // 与 DEPTH_COMPONENT24 + UNSIGNED_INT 路径兼容(只需 .r 单通道)。
  outDepth = vec4(gl_FragCoord.z, gl_FragCoord.z, gl_FragCoord.z, 1.0);
}
`;

/** PCF 软阴影采样 chunk:可注入到任意 fragment shader。
 *  依赖外部 uniform:u_shadowMap / u_lightVP / u_shadowBias / u_shadowMapSize。
 *  提供 sampleShadowPCF(worldPos) 返回 0..1 可见性因子。
 *  3x3 共 9 tap(中心 + 8 邻域),半径基于阴影贴图分辨率。 */
export const PCF_SHADOW_FRAG = /* glsl */ `

// ── PCF 软阴影 chunk(注入 PBR_FRAG 或自定义 shader) ──────────────
// 依赖外部声明的 uniform(若 shader 未声明会编译失败):
//   uniform sampler2D u_shadowMap;
//   uniform mat4      u_lightVP;
//   uniform float     u_shadowBias;
//   uniform vec2      u_shadowMapSize;
//   uniform int       u_shadowEnabled;

float sampleShadowPCF(vec3 worldPos) {
  if (u_shadowEnabled == 0) return 1.0;
  vec4 lp = u_lightVP * vec4(worldPos, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0 || ndc.z < -1.0 || ndc.z > 1.0) {
    return 1.0;
  }
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float ref = ndc.z * 0.5 + 0.5 - u_shadowBias;
  // 半径 = 1.5 texel,软度足够且 cost 低
  vec2 texel = 1.5 / u_shadowMapSize;

  // 3x3 共 9 tap,手动展开避免循环开销
  float visible = 0.0;
  visible += (texture(u_shadowMap, uv + vec2(-texel.x, -texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( 0.0,      -texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( texel.x, -texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2(-texel.x,  0.0     )).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv                              ).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( texel.x,  0.0     )).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2(-texel.x,  texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( 0.0,       texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( texel.x,  texel.y)).r > ref) ? 1.0 : 0.0;
  return visible / 9.0;
}
`;

// ── 增强后处理 shader(ColorGrading / LUT / FilmGrain / Afterimage / Pixelation)──
// 这些 shader 配合 Renderer/PostProcess/ 下的 Pass 类使用,与 RenderPass.ts
// 中的基础后处理 shader 平行。POST_VERT 复用现有全屏三角形顶点着色器。

// 色彩分级:一站式 color grading,包含色温/色调/饱和度/对比度/gain/lift/gamma/色相偏移。
// 参考 DaVinci Resolve 与 three.js ColorCorrectionShader 的合并思路。
//   u_temperature (-1..1): 色温,负=冷(蓝),正=暖(橙)
//   u_tint        (-1..1): 色调,负=绿,正=洋红
//   u_saturation  (0..2):  饱和度,1=原色
//   u_contrast    (0..2):  对比度,1=原色
//   u_gain        (0..2):  增益(高光),>1 提亮
//   u_lift        (-1..1): 提升(阴影),正=提亮阴影
//   u_gamma       (0.1..4):伽马,默认 1.0(不调整)
//   u_hueShift    (0..360):色相偏移角度
export const COLOR_GRADING_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_temperature;
uniform float u_tint;
uniform float u_saturation;
uniform float u_contrast;
uniform float u_gain;
uniform float u_lift;
uniform float u_gamma;
uniform float u_hueShift;

// RGB <-> HSV (hue 0..1)
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb;

  // 1. Lift/Gamma/Gain (ASC-CDL 风格简化)
  color = color * u_gain + u_lift * (1.0 - color);

  // 2. 色温/色调:在 RGB 空间偏移
  color.r += u_temperature * 0.1;
  color.b -= u_temperature * 0.1;
  color.g += u_tint * 0.05;
  color.r -= u_tint * 0.05;
  color.b -= u_tint * 0.05;

  // 3. Gamma
  color = pow(max(color, vec3(0.0)), vec3(1.0 / max(u_gamma, 1.0e-4)));

  // 4. 对比度:围绕中灰 0.5
  color = (color - 0.5) * u_contrast + 0.5;

  // 5. 色相偏移 + 饱和度:走 HSV
  vec3 hsv = rgb2hsv(color);
  hsv.x = fract(hsv.x + u_hueShift / 360.0);
  hsv.y = clamp(hsv.y * u_saturation, 0.0, 1.0);
  color = hsv2rgb(hsv);

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

// LUT 3D: 使用 sampler3D 进行 3D 查找表映射。
//   u_lut3D    : 3D 纹理(sampler3D)
//   u_lutSize  : 每轴格点数(通常 16 或 32)
//   u_intensity: 0..1 混合系数
export const LUT_3D_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler3D u_lut3D;
uniform float u_lutSize;
uniform float u_intensity;

void main() {
  vec4 src = texture(u_colorMap, v_uv);
  // 半像素内缩,使采样落在边缘像素中心(避免越界)
  float pixelWidth = 1.0 / u_lutSize;
  float halfPixel = 0.5 / u_lutSize;
  vec3 uvw = vec3(halfPixel) + src.rgb * (1.0 - pixelWidth);
  vec3 graded = texture(u_lut3D, uvw).rgb;
  outColor = vec4(mix(src.rgb, graded, u_intensity), src.a);
}
`;

// LUT 2D strip: 使用 2D 横向 strip 纹理(每片 lutSize×lutSize,共 lutSize 片横向排开)。
//   u_lut2D     : 2D 纹理(sampler2D)
//   u_lutSize   : 每轴格点数
//   u_intensity : 0..1 混合系数
export const LUT_2D_STRIP_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_lut2D;
uniform float u_lutSize;

uniform float u_intensity;

void main() {
  vec4 src = texture(u_colorMap, v_uv);
  // strip 总宽度 = lutSize * lutSize,高度 = lutSize
  // 对 B 通道选 slice,在 slice 内用 R/G 寻址
  float slice = clamp(src.b, 0.0, 1.0) * (u_lutSize - 1.0);
  float sliceF = floor(slice);
  float sliceT = fract(slice);
  float halfTexel = 0.5 / (u_lutSize * u_lutSize);
  float halfTexelY = 0.5 / u_lutSize;

  // slice 0..lutSize-1, 每片宽度 1/(lutSize*lutSize)
  float x0 = (sliceF * u_lutSize + 0.5) / (u_lutSize * u_lutSize);
  float x1 = ((sliceF + 1.0) * u_lutSize + 0.5) / (u_lutSize * u_lutSize);
  vec2 uv0 = vec2(x0 + src.r * (u_lutSize - 1.0) / (u_lutSize * u_lutSize), halfTexelY + src.g * (1.0 - 2.0 * halfTexelY));
  vec2 uv1 = vec2(x1 + src.r * (u_lutSize - 1.0) / (u_lutSize * u_lutSize), halfTexelY + src.g * (1.0 - 2.0 * halfTexelY));
  vec3 c0 = texture(u_lut2D, uv0).rgb;
  vec3 c1 = texture(u_lut2D, uv1).rgb;
  vec3 graded = mix(c0, c1, sliceT);
  outColor = vec4(mix(src.rgb, graded, u_intensity), src.a);
}
`;

// 增强色差:支持 Vector2 偏移、径向调制、径向中心。
//   u_offset    : vec2 色差偏移(R 与 B 反向偏移)
//   u_radialMod : 1=按到中心距离放大偏移,0=常数偏移
//   u_center    : 径向中心(默认 0.5, 0.5)
export const CA_ENHANCED_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_offset;
uniform int u_radialMod;
uniform vec2 u_center;

void main() {
  vec2 dir = v_uv - u_center;
  float dist = length(dir);
  vec2 off = u_offset;
  if (u_radialMod == 1) {
    off *= dist;
  }

  float r = texture(u_colorMap, v_uv + off).r;
  float g = texture(u_colorMap, v_uv).g;
  float b = texture(u_colorMap, v_uv - off).b;

  outColor = vec4(r, g, b, 1.0);
}
`;

// 增强暗角:支持 offset/darkness + 颜色染色。
//   u_offset   : 暗角起始偏移(0..2)
//   u_darkness : 暗角强度(0..2)
//   u_color    : 暗角颜色(默认黑色)
export const VIGNETTE_ENHANCED_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_offset;
uniform float u_darkness;
uniform vec3 u_color;

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb;
  vec2 uv = v_uv - 0.5;
  float dist = length(uv);
  float vignette = smoothstep(u_offset + 0.4, u_offset, dist);
  vec3 darkTint = u_color * (1.0 - vignette) * u_darkness;
  color = mix(color, color * (1.0 - u_darkness * (1.0 - vignette)) + darkTint * 0.5, 1.0);
  outColor = vec4(color, 1.0);
}
`;

// 胶片颗粒:基于 hash 噪声的颗粒叠加,可动画。
//   u_intensity: 0..1
//   u_size     : 颗粒大小(texel 倍数)
//   u_animated : 1=每帧变化,0=固定
//   u_time     : 时间种子(秒)
//   u_screenSize: 屏幕尺寸
export const FILM_GRAIN_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_intensity;
uniform float u_size;
uniform int u_animated;
uniform float u_time;
uniform vec2 u_screenSize;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb;
  vec2 px = v_uv * u_screenSize / max(u_size, 1.0);
  if (u_animated == 1) {
    px += fract(u_time) * 79.0;
  }
  float grain = hash21(floor(px)) - 0.5;
  // 颗粒在亮度上叠加,避免过度染色
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float amount = u_intensity * (0.5 + 0.5 * (1.0 - lum));
  color += grain * amount;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

// 残影:把当前帧与上一帧按 damp 系数混合。
//   u_damp: 0..1,值越大残影越强(0=无残影,1=完全保留)
//   u_colorMap: 当前帧
//   u_oldMap:   上一帧
export const AFTERIMAGE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_oldMap;
uniform float u_damp;

void main() {
  vec3 cur = texture(u_colorMap, v_uv).rgb;
  vec3 old = texture(u_oldMap, v_uv).rgb;
  // damp = 0 → 只用 cur;damp = 1 → 只用 old
  vec3 mixColor = mix(cur, old, clamp(u_damp, 0.0, 0.95));
  outColor = vec4(mixColor, 1.0);
}
`;

// 像素化:把屏幕分块降采样,每块取单点。
//   u_pixelSize: 像素块大小(texel 倍数)
//   u_screenSize: 屏幕尺寸
export const PIXELATION_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_pixelSize;
uniform vec2 u_screenSize;

void main() {
  vec2 size = u_screenSize / max(u_pixelSize, 1.0);
  vec2 pix = floor(v_uv * size) / size + 0.5 / size;
  outColor = texture(u_colorMap, pix);
}
`;

// ── SSR (Screen-Space Reflection) ──────────────────────────────────
// 基于 GBuffer 的 position / normal + 颜色缓冲,屏幕空间射线步进。
// 流程:
//   1. 从世界位置 + 法线计算反射方向
//   2. 在世界空间步进,每步把射线端点投影到屏幕 UV
//   3. 检测 UV 处采样的 positionTexture.z 是否落在射线端点厚度内
//   4. 命中后做 8 步二分查找细化
//   5. 边缘衰减 + Fresnel 权重
//
// 输入纹理:
//   u_colorMap    — 当前帧颜色
//   u_positionMap — 世界位置(RGBA16F,xyz)
//   u_normalMap   — 世界法线(RGBA16F,xyz)
// uniforms:
//   u_projection / u_view  — 把世界位置投影到 clip space
//   u_cameraPos            — 视点位置(计算 view dir)
//   u_screenSize           — 视口尺寸(目前未使用,留给未来边缘检测)
//   u_maxSteps             — 射线步进次数
//   u_thickness            — 厚度容差(世界单位)
//   u_reflectionStrength   — 反射强度(0..1)
export const SSR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_positionMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_roughnessMap;   // R=roughness[0,1];u_hasRoughness=0 时不读
uniform mat4 u_projection;
uniform mat4 u_view;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform int   u_maxSteps;
uniform float u_thickness;
uniform float u_reflectionStrength;
uniform float u_roughnessCutoff;    // roughness > cutoff → 跳过 SSR(漫反射面)
uniform float u_jitterScale;        // 抖动幅度(0=关,1=默认)
uniform float u_stepGrowth;         // 自适应步长增长因子(1=匀速,1.5=每步×1.5)
uniform float u_frame;              // 帧计数(时序抖动)
uniform int   u_hasRoughness;       // 1=有粗糙度纹理,0=无(按镜面处理)

// Interleaved Gradient Noise (Jorge Jimenez 2014) — 时序抖动去条带。
float ign(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

// 把世界位置投影到屏幕 UV(0..1)。
vec2 projectToUV(vec3 worldPos) {
  vec4 clip = u_projection * u_view * vec4(worldPos, 1.0);
  return (clip.xy / clip.w) * 0.5 + 0.5;
}

// 视空间深度(沿相机轴的距离,正值=前方)。比世界 Z 更正确 —— 不依赖世界朝向。
float viewDepth(vec3 worldPos) {
  return -(u_view * vec4(worldPos, 1.0)).z;
}

// 厚度检测(视空间):UV 越界返回 false;否则比较 rayPos 与采样几何的视空间深度,
// 当射线在几何后方(rayDepth > sampledDepth,即 depthDiff>0)且在厚度内 → 击中。
bool hitTestVS(vec3 rayPos, vec2 uv, out float depthDiff) {
  depthDiff = 1e9;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return false;
  vec3 sampledPos = texture(u_positionMap, uv).xyz;
  float rayDepth = viewDepth(rayPos);
  float sampledDepth = viewDepth(sampledPos);
  depthDiff = rayDepth - sampledDepth;
  return depthDiff > 0.0 && depthDiff < u_thickness;
}

void main() {
  vec3 sceneColor  = texture(u_colorMap,    v_uv).rgb;
  vec3 worldPos    = texture(u_positionMap, v_uv).xyz;
  vec3 worldNormal = texture(u_normalMap,   v_uv).xyz;

  // 粗糙度(u_hasRoughness=0 时按 0 = 镜面处理)
  float roughness = 0.0;
  if (u_hasRoughness > 0) {
    roughness = texture(u_roughnessMap, v_uv).r;
  }

  // 早退:无法线(天空) / 背面 / 过粗糙 → 直接输出原色
  if (length(worldNormal) < 0.01 || roughness > u_roughnessCutoff) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }
  worldNormal = normalize(worldNormal);

  vec3 viewDir = normalize(u_cameraPos - worldPos);
  // 背面剔除:法线背离相机不反射
  if (dot(viewDir, worldNormal) <= 0.0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  vec3 reflDir = reflect(-viewDir, worldNormal);

  // 时序抖动:每像素 + 每帧不同偏移,配合 TAA 消除条带/痤疮
  float jitter = ign(v_uv * u_screenSize + vec2(u_frame * 0.61803398875, 0.0));
  jitter = (jitter - 0.5) * u_jitterScale;

  // 自适应步长:近距离小步(精度),远距离大步(速度)
  float baseStep = u_thickness * 0.25;
  vec3 rayPos = worldPos + reflDir * baseStep * (0.5 + jitter);
  vec2 uv = projectToUV(rayPos);
  vec2 hitUV = uv;
  vec3 hitPos = rayPos;
  bool hit = false;

  // 自适应光线步进
  for (int i = 0; i < 64; i++) {
    if (i >= u_maxSteps) break;
    float dd;
    if (hitTestVS(rayPos, uv, dd)) {
      hit = true;
      hitPos = rayPos;
      hitUV = uv;
      break;
    }
    // 步长随迭代线性增长(受 u_stepGrowth 控制),近期步小、远期步大
    float stepSize = baseStep * (1.0 + float(i) * u_stepGrowth) * (1.0 + jitter * 0.25);
    rayPos += reflDir * stepSize;
    uv = projectToUV(rayPos);
  }

  // 二分查找细化(8 步,误差压到 thickness/256)
  if (hit) {
    vec3 lo = worldPos;
    vec3 hi = hitPos;
    for (int i = 0; i < 8; i++) {
      vec3 mid = (lo + hi) * 0.5;
      vec2 midUV = projectToUV(mid);
      float dd;
      if (hitTestVS(mid, midUV, dd)) {
        hi = mid;
        hitUV = midUV;
      } else {
        lo = mid;
      }
    }
  }

  if (hit) {
    // 粗糙度调制反射:光滑→锐利,粗糙→模糊(4 邻域采样)
    vec3 reflectionColor;
    if (roughness < 0.2) {
      reflectionColor = texture(u_colorMap, hitUV).rgb;
    } else {
      vec2 texel = 1.0 / u_screenSize;
      float blurRadius = roughness * 3.5;
      reflectionColor  = texture(u_colorMap, hitUV + vec2( blurRadius, 0.0) * texel).rgb;
      reflectionColor += texture(u_colorMap, hitUV + vec2(-blurRadius, 0.0) * texel).rgb;
      reflectionColor += texture(u_colorMap, hitUV + vec2(0.0,  blurRadius) * texel).rgb;
      reflectionColor += texture(u_colorMap, hitUV + vec2(0.0, -blurRadius) * texel).rgb;
      reflectionColor *= 0.25;
    }

    // 边缘衰减:命中 UV 越靠近屏幕边缘,反射越弱
    vec2 edgeDist = min(hitUV, 1.0 - hitUV);
    float edgeFade = smoothstep(0.0, 0.1, min(edgeDist.x, edgeDist.y));

    // Fresnel 权重:掠射角反射更强
    float fresnel = pow(1.0 - max(dot(viewDir, worldNormal), 0.0), 3.0);

    // 粗糙度衰减:粗糙面反射更暗(非金属粗糙面几乎不反射)
    float roughAtten = 1.0 - smoothstep(0.0, u_roughnessCutoff, roughness);

    float strength = u_reflectionStrength * edgeFade * (0.5 + 0.5 * fresnel) * roughAtten;

    outColor = vec4(mix(sceneColor, reflectionColor, clamp(strength, 0.0, 1.0)), 1.0);
  } else {
    outColor = vec4(sceneColor, 1.0);
  }
}
`;

// ── Volumetric Fog ─────────────────────────────────────────────────
// 基于深度纹理的体积雾 + 简化光散射(体积光 god rays)。
// 流程:
//   1. 从 NDC 深度重建世界坐标
//   2. 计算像素到相机距离,按指数衰减计算雾密度
//   3. fogStart / fogEnd 限制雾作用范围
//   4. 沿光源方向计算散射项,叠加到雾色上(god rays)
//   5. mix(sceneColor, fogColor, fogFactor)
//
// 输入纹理:
//   u_colorMap  — 当前帧颜色
//   u_depthMap  — NDC 深度(0..1)
// uniforms:
//   u_projectionInverse / u_viewInverse — 把 NDC 还原到世界空间
//   u_cameraPos                         — 视点位置
//   u_density                           — 雾密度(指数衰减系数)
//   u_fogColor                          — 雾色
//   u_fogStart / u_fogEnd               — 雾作用距离范围
//   u_lightDir                          — 光照方向(指向光源)
//   u_lightColor                        — 光色
//   u_godRaysStrength                   — 体积光强度(0 关闭)
export const VOLUMETRIC_FOG_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_depthMap;
uniform mat4 u_projectionInverse;
uniform mat4 u_viewInverse;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform float u_density;
uniform vec3  u_fogColor;
uniform float u_fogStart;
uniform float u_fogEnd;
uniform vec3  u_lightDir;
uniform vec3  u_lightColor;
uniform float u_godRaysStrength;

// 从 NDC 深度重建世界坐标。depth 为 0..1 的采样器原始值。
vec3 reconstructWorldPos(vec2 uv, float depth) {
  vec4 ndc   = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = u_viewInverse * u_projectionInverse * ndc;
  return world.xyz / world.w;
}

void main() {
  vec3  sceneColor = texture(u_colorMap, v_uv).rgb;
  float depth      = texture(u_depthMap, v_uv).r;

  // 深度为 1.0(远裁面)时跳过重建(除以 w 会出现 inf)
  if (depth >= 0.99999) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  vec3  worldPos = reconstructWorldPos(v_uv, depth);
  float dist     = length(worldPos - u_cameraPos);

  // 指数雾密度
  float fogFactor = 1.0 - exp(-u_density * max(dist, 0.0));
  fogFactor = clamp(fogFactor, 0.0, 1.0);

  // 距离范围裁剪
  if (dist < u_fogStart) fogFactor = 0.0;
  if (dist > u_fogEnd)   fogFactor = 1.0;

  // 体积光散射:沿光线方向的相函数近似
  vec3  viewDir     = normalize(worldPos - u_cameraPos);
  float scatter     = max(dot(viewDir, -normalize(u_lightDir)), 0.0);
  scatter           = pow(scatter, 8.0);
  vec3  fogColor    = u_fogColor + u_lightColor * scatter * u_godRaysStrength;

  vec3 finalColor   = mix(sceneColor, fogColor, fogFactor);
  outColor          = vec4(finalColor, 1.0);
}
`;

// ── Velocity (motion vectors) ──────────────────────────────────────
// 从 GBuffer 世界位置 + 当前/上一帧 view-projection 计算屏幕空间速度。
//
// 输入纹理:
//   u_positionMap — GBuffer 世界位置(RGBA16F,xyz=worldPos)
// uniforms:
//   u_currViewProjection — 当前帧 view * projection
//   u_prevViewProjection — 上一帧 view * projection
//   u_screenSize         — 视口尺寸(用于 jitter 缩放,可选)
//
// 输出:RG = 屏幕空间速度(curr - prev),单位为像素的归一化 (-1..1)。
// 速度的 R 通道在 shader 内已乘以 0.5 以映射到 [0..1] 便于 LINEAR 采样;
// 这里直接输出 NDC 差值,下游采样时按需缩放。
export const VELOCITY_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_positionMap;
uniform mat4 u_currViewProjection;
uniform mat4 u_prevViewProjection;

void main() {
  vec3 worldPos = texture(u_positionMap, v_uv).xyz;

  // 把世界位置投影到当前 / 上一帧的 NDC
  vec4 currClip = u_currViewProjection * vec4(worldPos, 1.0);
  vec4 prevClip = u_prevViewProjection * vec4(worldPos, 1.0);

  // 防御性 w=0(空像素)
  if (abs(currClip.w) < 1e-6 || abs(prevClip.w) < 1e-6) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 currNdc = currClip.xy / currClip.w;
  vec2 prevNdc = prevClip.xy / prevClip.w;

  // 速度 = 当前帧 NDC - 上一帧 NDC(范围 -2..2,实际场景通常 << 1)
  vec2 velocity = (currNdc - prevNdc) * 0.5;

  outColor = vec4(velocity, 0.0, 1.0);
}
`;

// ── TAA (Temporal Anti-Aliasing) ───────────────────────────────────
// 时间抗锯齿:用上一帧累积历史 + 当前帧做邻域裁剪(clamp)后混合。
//
// 输入纹理:
//   u_colorMap    — 当前帧颜色(已用 jitter 投影渲染)
//   u_historyMap  — 上一帧累积颜色
//   u_velocityMap — 速度缓冲(RG = NDC 速度)
// uniforms:
//   u_blendFactor    — 当前帧权重(0..1,默认 0.1;越小越平滑)
//   u_screenSize     — 屏幕尺寸(像素)
//   u_jitter         — 当前帧投影 jitter(用于 history 复原,单位像素)
//
// 流程:
//   1. 采样 velocity → 反推上一帧 UV(history 采样位置)
//   2. 在 3x3 邻域采样当前帧,构造 min/max 包围盒
//   3. 把 history clamp 到包围盒内(避免拖影)
//   4. mix(history, current, blendFactor)
export const TAA_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_historyMap;
uniform sampler2D u_velocityMap;
uniform float u_blendFactor;
uniform vec2 u_screenSize;
uniform vec2 u_jitter;

// 3x3 邻域 min/max 包围盒(邻域裁剪 neighborhood clamping)。
void neighborhoodClamp(vec2 uv, out vec3 colorMin, out vec3 colorMax) {
  vec2 texel = 1.0 / u_screenSize;
  colorMin = vec3(1e9);
  colorMax = vec3(-1e9);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = texture(u_colorMap, uv + vec2(float(x), float(y)) * texel).rgb;
      colorMin = min(colorMin, c);
      colorMax = max(colorMax, c);
    }
  }
}

void main() {
  vec2 velocity = texture(u_velocityMap, v_uv).rg;
  // velocity 已乘 0.5,反推 NDC 差值后取上一帧 UV
  vec2 historyUv = v_uv - velocity;

  vec3 current = texture(u_colorMap, v_uv).rgb;

  // 邻域裁剪
  vec3 cMin, cMax;
  neighborhoodClamp(v_uv, cMin, cMax);

  // history 越界 → 用当前帧(避免边缘拖影)
  if (historyUv.x < 0.0 || historyUv.x > 1.0 ||
      historyUv.y < 0.0 || historyUv.y > 1.0) {
    outColor = vec4(current, 1.0);
    return;
  }

  vec3 history = texture(u_historyMap, historyUv).rgb;
  // 把 history 限制在当前帧邻域内(去除明显错误的历史像素)
  history = clamp(history, cMin, cMax);

  vec3 color = mix(history, current, u_blendFactor);
  outColor = vec4(color, 1.0);
}
`;

// ── Motion Blur ───────────────────────────────────────────────────
// 基于速度缓冲的方向性模糊:沿速度向量采样多次并平均。
//
// 输入纹理:
//   u_colorMap    — 当前帧颜色
//   u_velocityMap — 速度缓冲(RG = NDC 速度,已乘 0.5)
// uniforms:
//   u_strength    — 模糊强度(0..1+,默认 1.0)
//   u_maxSamples  — 最大采样数(偶数,默认 16)
//   u_screenSize  — 屏幕尺寸(像素)
export const MOTION_BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_velocityMap;
uniform float u_strength;
uniform int   u_maxSamples;
uniform vec2 u_screenSize;

void main() {
  vec2 velocity = texture(u_velocityMap, v_uv).rg;
  // 反推 NDC 速度 → 像素速度
  vec2 pixelVel = velocity * 2.0 * u_screenSize * 0.5;
  pixelVel *= u_strength;

  float velLen = length(pixelVel);
  // 速度过小 → 直接输出(节省采样)
  if (velLen < 0.5) {
    outColor = texture(u_colorMap, v_uv);
    return;
  }

  // 采样数随速度自适应(clamp 到 u_maxSamples)
  int sampleCount = int(clamp(velLen, 1.0, float(u_maxSamples)));
  float invCount = 1.0 / float(sampleCount);

  // 沿速度向量两侧采样(sampleCount 个点)
  vec2 dir = normalize(pixelVel);
  vec2 texel = dir / u_screenSize;

  vec3 color = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= sampleCount) break;
    float t = (float(i) + 0.5) * invCount - 0.5;
    color += texture(u_colorMap, v_uv + texel * t * velLen).rgb;
  }
  color *= invCount;

  outColor = vec4(color, 1.0);
}
`;

// ── Auto Exposure (luminance downsample) ───────────────────────────
// 第一步:把输入纹理降采样到 1x1 计算平均对数亮度。
//
// 该 shader 用于降采样中间 pass:每次把 2x2 → 1x1 平均,
// 用对数亮度避免高亮像素主导(参考 EA "Average Luminance" 技术)。
//
// uniforms:
//   u_screenSize — 输入纹理尺寸(像素)
//   u_inputSize  — 输入纹理尺寸(同 u_screenSize,保留以匹配 API)
//
// 注:实际多级降采样由 AutoExposurePass 在 CPU 端循环调用此 shader 实现。
export const AUTO_EXPOSURE_LUMINANCE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_screenSize;

void main() {
  // 2x2 box filter 计算本 tile 平均对数亮度
  vec2 texel = 1.0 / u_screenSize;
  float logLum = 0.0;
  float count = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec3 c = texture(u_colorMap, v_uv + vec2(float(x), float(y)) * texel * 0.5).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // 防止 log(0):最小亮度 1e-4
      l = max(l, 1e-4);
      logLum += log(l);
      count += 1.0;
    }
  }
  logLum /= count;
  // 输出对数亮度到 R 通道(B 通道存原始亮度用于调试)
  outColor = vec4(logLum, 0.0, 0.0, 1.0);
}
`;

// ── Auto Exposure apply ────────────────────────────────────────────
// 第二步:根据平均亮度计算曝光值,把场景色调向目标曝光适应。
//
// 输入纹理:
//   u_colorMap      — 当前帧颜色(HDR)
//   u_luminanceMap  — 1x1 平均亮度(对数)纹理
// uniforms:
//   u_currentExposure — 当前曝光(CPU 端维护,经 adaptationSpeed 适应)
//   u_minExposure     — 最小曝光(EV)
//   u_maxExposure     — 最大曝光(EV)
//   u_deltaTime       — 帧间隔(秒,用于适应速率)
//   u_adaptationSpeed — 适应速度(默认 1.5)
//
// 流程:
//   1. 采样 u_luminanceMap 得到平均对数亮度 → exp 还原平均亮度
//   2. 目标曝光 = clamp(-0.5 * log2(avgLum) + keyOffset, min, max)
//   3. 适应:currentExposure = mix(current, target, 1 - exp(-adaptationSpeed * dt))
//   4. 输出 color * exp(currentExposure)
//
// 注:CPU 端在 apply() 后会回读 currentExposure 并保存到下一帧使用。
//     但由于不能跨帧持有 GLSL 计算结果,此处把适应过程放在 CPU 端做,
//     shader 只负责应用曝光 + 输出新曝光到 R 通道(B 用于读回)。
//     实际实现:CPU 在 apply() 中先读取 1x1 纹理(通过 readPixels),
//     计算 currentExposure,再把曝光作为 uniform 喂给本 shader。
//     此 shader 不再修改 currentExposure,只渲染最终颜色。
export const AUTO_EXPOSURE_APPLY_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_exposure;  // 已适应的曝光(由 CPU 端计算)

void main() {
  vec3 color = texture(u_colorMap, v_uv).rgb;
  // 曝光应用:scene *= 2^exposure
  color *= exp2(u_exposure);
  outColor = vec4(color, 1.0);
}
`;

// ── GTAO (Ground Truth Ambient Occlusion) ──────────────────────────
// 基于深度 + 法线纹理的高质量环境光遮蔽。
// 流程:
//   1. 从 NDC 深度重建视图空间位置
//   2. 世界法线 → 视图法线
//   3. 在屏幕空间沿 4 个方向采样,找到每个方向的地平线角(horizon angle)
//   4. 半球积分得到 AO,用 power 指数调整强度
//
// 输入纹理:
//   u_depthMap  — NDC 深度(0..1)
//   u_normalMap — 世界空间法线(RGBA16F,xyz)
// uniforms:
//   u_projectionInverse — NDC → 视图空间
//   u_viewMatrix        — 世界 → 视图(把世界法线转到视图空间)
//   u_screenSize        — 视口尺寸
//   u_radius            — 采样半径(屏幕空间像素缩放)
//   u_thickness         — 厚度容差(世界单位,大于此距离的几何不算遮蔽)
//   u_power             — 强度指数(>1 更锐利,<1 更柔)
//   u_maxPixels         — 每方向最大采样数(1..32)
//
// 输出:R=G=B=AO(0..1,1=无遮蔽),A=1。
export const GTAO_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_depthMap;
uniform sampler2D u_normalMap;
uniform mat4 u_projectionInverse;
uniform mat4 u_viewMatrix;
uniform vec2 u_screenSize;
uniform float u_radius;
uniform float u_thickness;
uniform float u_power;
uniform int   u_maxPixels;

// 从 NDC 深度重建视图空间位置。
vec3 reconstructViewPos(vec2 uv, float depth) {
  vec4 ndc  = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = u_projectionInverse * ndc;
  return view.xyz / view.w;
}

void main() {
  float depth = texture(u_depthMap, v_uv).r;
  if (depth >= 0.99999) {
    outColor = vec4(1.0);
    return;
  }

  vec3 viewPos = reconstructViewPos(v_uv, depth);
  vec3 worldN  = texture(u_normalMap, v_uv).xyz;
  if (length(worldN) < 0.01) {
    outColor = vec4(1.0);
    return;
  }
  vec3 viewN = normalize((u_viewMatrix * vec4(worldN, 0.0)).xyz);

  vec2 texel = 1.0 / u_screenSize;
  int  samples = max(1, min(32, u_maxPixels));

  // 4 个采样方向(0°, 90°, 45°, 135°)
  vec2 dirs[4];
  dirs[0] = vec2( 1.0,  0.0);
  dirs[1] = vec2( 0.0,  1.0);
  dirs[2] = vec2( 0.7071,  0.7071);
  dirs[3] = vec2(-0.7071,  0.7071);

  float occlusion = 0.0;
  for (int d = 0; d < 4; d++) {
    float horizon = 0.0;
    for (int i = 1; i <= 32; i++) {
      if (i > samples) break;
      vec2 offset = dirs[d] * texel * u_radius * (float(i) / float(samples));
      vec2 sUV = v_uv + offset;
      if (sUV.x < 0.0 || sUV.x > 1.0 || sUV.y < 0.0 || sUV.y > 1.0) break;

      float sDepth = texture(u_depthMap, sUV).r;
      if (sDepth >= 0.99999) continue;
      vec3 sPos = reconstructViewPos(sUV, sDepth);
      vec3 delta = sPos - viewPos;

      float dist = length(delta);
      if (dist < 1e-4 || dist > u_thickness) continue;

      float sinA = dot(viewN, delta) / dist;
      horizon = max(horizon, asin(clamp(sinA, -1.0, 1.0)));
    }
    occlusion += max(0.0, horizon);
  }
  occlusion /= 4.0;

  // 归一化(π/2)→ 0..1,再用 power 调整
  float norm = occlusion / 1.5707963;
  float ao = 1.0 - pow(clamp(norm, 0.0, 1.0), u_power);
  outColor = vec4(ao, ao, ao, 1.0);
}
`;

// ── SSSS (Screen-Space Subsurface Scattering) ──────────────────────
// 可分离高斯模糊 + 深度感知 + 次表面颜色混合。
// 流程(每趟):
//   1. 沿 u_blurDir 采样 maxSamples 个点
//   2. 用 u_kernel 高斯核加权
//   3. 深度差大时降低权重(避免背景渗透)
//   4. 混合次表面颜色
//
// 输入纹理:
//   u_colorMap — 当前帧颜色(对 SSSS 通常是 skin color buffer)
//   u_depthMap — NDC 深度(0..1)
// uniforms:
//   u_blurDir          — 模糊方向(屏幕空间,1.0=全屏;典型 (1,0)/(0,1))
//   u_screenSize       — 视口尺寸
//   u_strength         — 强度(0..1+)
//   u_falloff          — 深度衰减(越大越锐利)
//   u_subsurfaceColor  — 次表面颜色(皮肤/蜡/玉石)
//   u_maxSamples       — 采样数(奇数,1..17)
//   u_kernel[17]       — 高斯核(kernel[8]=中心)
//
// 注:可分离 = 水平一趟 + 垂直一趟,由 CPU 端调用方分两次 apply 实现。
//     本 shader 只做单趟;Pass 内部用 ping-pong FBO 完成两趟。
export const SSSS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_depthMap;
uniform vec2  u_blurDir;
uniform vec2  u_screenSize;
uniform float u_strength;
uniform float u_falloff;
uniform vec3  u_subsurfaceColor;
uniform int   u_maxSamples;
uniform float u_kernel[17];

void main() {
  vec3  centerColor = texture(u_colorMap, v_uv).rgb;
  float centerDepth = texture(u_depthMap, v_uv).r;

  vec2 texel = u_blurDir / u_screenSize;
  int  halfSamples = u_maxSamples / 2;

  vec3  color = vec3(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < 17; i++) {
    if (i >= u_maxSamples) break;
    float weight = u_kernel[i];
    int offset = i - halfSamples;
    vec2 uvOffset = texel * float(offset);

    vec3  sColor = texture(u_colorMap, v_uv + uvOffset).rgb;
    float sDepth = texture(u_depthMap, v_uv + uvOffset).r;

    // 深度感知权重:深度差越大,贡献越低(避免背景渗透)
    float depthDiff = abs(sDepth - centerDepth);
    float depthWeight = exp(-depthDiff * u_falloff * 100.0);
    weight *= depthWeight;

    color += sColor * weight;
    totalWeight += weight;
  }

  color /= max(totalWeight, 1e-6);

  // 混合:基础颜色 ↔ 模糊颜色 ↔ 次表面颜色
  vec3 blurred = mix(centerColor, color, u_strength);
  vec3 result = mix(blurred, color * u_subsurfaceColor, u_strength * 0.5);
  outColor = vec4(result, 1.0);
}
`;

// ── DOF Enhanced (Circle of Confusion + Bokeh Shape) ───────────────
// 增强景深:基于深度的 CoC 计算 + 散景形状(圆形/六边形/八边形)采样。
// 流程:
//   1. 从深度重建视图空间 Z,计算到焦点的偏差
//   2. CoC = |dist - focusDistance| / focusRange,clamp 0..1
//   3. radius = CoC * bokehSize,clamp 到 maxRadius
//   4. 沿圆周采样 SAMPLES 个点,按 bokehShape 过滤形状
//   5. 按 CoC 混合原始色与散景色
//
// 输入纹理:
//   u_colorMap — 当前帧颜色
//   u_depthMap — NDC 深度(0..1)
// uniforms:
//   u_projectionInverse — NDC → 视图空间
//   u_screenSize        — 视口尺寸
//   u_focusDistance     — 焦点距离(视图空间 Z,正值)
//   u_focusRange        — 焦点范围(范围内清晰)
//   u_bokehShape        — 0=circle, 1=hexagon, 2=octagon
//   u_bokehSize         — 散景大小(像素)
//   u_maxRadius         — 最大散景半径(像素,限制开销)
export const DOF_ENHANCED_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_depthMap;
uniform mat4 u_projectionInverse;
uniform vec2 u_screenSize;
uniform float u_focusDistance;
uniform float u_focusRange;
uniform int   u_bokehShape;
uniform float u_bokehSize;
uniform float u_maxRadius;

vec3 reconstructViewPos(vec2 uv, float depth) {
  vec4 ndc  = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = u_projectionInverse * ndc;
  return view.xyz / view.w;
}

// 散景形状权重:返回 1.0(在形状内) 或 0.0(形状外)。
// offset 为单位方向向量(|offset|<=1)。
float bokehWeight(vec2 offset, int shape) {
  float r = length(offset);
  if (r < 1e-4) return 1.0;
  if (shape == 0) {
    // 圆形
    return r <= 1.0 ? 1.0 : 0.0;
  } else if (shape == 1) {
    // 六边形:6 条边的菱形近似
    float a = atan(offset.y, offset.x);
    float d = 0.8660254 * abs(cos(a)) + 0.5 * abs(sin(a));
    return (r * d) <= 0.8660254 ? 1.0 : 0.0;
  } else {
    // 八边形:max(|cos|,|sin|) 近似
    float a = atan(offset.y, offset.x);
    float d = max(abs(cos(a)), abs(sin(a)));
    return (r * d) <= 0.9238795 ? 1.0 : 0.0;
  }
}

void main() {
  vec3  centerColor = texture(u_colorMap, v_uv).rgb;
  float depth = texture(u_depthMap, v_uv).r;

  if (depth >= 0.99999) {
    outColor = vec4(centerColor, 1.0);
    return;
  }

  vec3  viewPos = reconstructViewPos(v_uv, depth);
  float dist = -viewPos.z;  // 视图空间 Z(正值=前方)

  // Circle of Confusion
  float coc = clamp(abs(dist - u_focusDistance) / max(u_focusRange, 1e-4), 0.0, 1.0);
  float radius = min(coc * u_bokehSize, u_maxRadius);

  // 半径太小 → 跳过(像素清晰)
  if (radius < 0.5) {
    outColor = vec4(centerColor, 1.0);
    return;
  }

  vec2 texel = 1.0 / u_screenSize;
  vec3 color = vec3(0.0);
  float totalWeight = 0.0;

  const int SAMPLES = 16;
  for (int i = 0; i < SAMPLES; i++) {
    float angle = 6.2831853 * (float(i) + 0.5) / float(SAMPLES);
    vec2 dir = vec2(cos(angle), sin(angle));
    float w = bokehWeight(dir, u_bokehShape);
    vec2 offset = dir * radius * texel;
    vec3 sColor = texture(u_colorMap, v_uv + offset).rgb;
    color += sColor * w;
    totalWeight += w;
  }

  color /= max(totalWeight, 1e-6);
  vec3 result = mix(centerColor, color, coc);
  outColor = vec4(result, 1.0);
}
`;

// ── Digital Glitch (赛博朋克故障效果) ──────────────────────────────
// 适配自 three.js examples/jsm/shaders/DigitalGlitch.js
// 基于 staffantans 的 Unity glitch shader + RGB shift。
//
// 输入纹理:
//   u_colorMap — 当前帧颜色
//   u_dispMap  — 位移噪声纹理(用于数字方块故障)
// uniforms:
//   u_byp        — 1=旁路(直通),0=应用故障
//   u_amount     — 故障量(0..1,越大越剧烈)
//   u_angle      — RGB shift 角度
//   u_seed       — 随机种子
//   u_seedX      — X 位移种子(-1..1)
//   u_seedY      — Y 位移种子(-1..1)
//   u_distortionX — 水平扭曲带位置(0..1)
//   u_distortionY — 垂直扭曲带位置(0..1)
//   u_colS       — 扭曲带宽度系数
export const GLITCH_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform int u_byp;
uniform sampler2D u_colorMap;
uniform sampler2D u_dispMap;
uniform float u_amount;
uniform float u_angle;
uniform float u_seed;
uniform float u_seedX;
uniform float u_seedY;
uniform float u_distortionX;
uniform float u_distortionY;
uniform float u_colS;

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  if (u_byp < 1) {
    vec2 p = v_uv;
    float xs = floor(gl_FragCoord.x / 0.5);
    float ys = floor(gl_FragCoord.y / 0.5);
    // 数字方块位移
    float disp = texture(u_dispMap, p * u_seed * u_seed).r;
    // 水平扭曲带
    if (p.y < u_distortionX + u_colS && p.y > u_distortionX - u_colS * u_seed) {
      if (u_seedX > 0.0) {
        p.y = 1.0 - (p.y + u_distortionY);
      } else {
        p.y = u_distortionY;
      }
    }
    // 垂直扭曲带
    if (p.x < u_distortionY + u_colS && p.x > u_distortionY - u_colS * u_seed) {
      if (u_seedY > 0.0) {
        p.x = u_distortionX;
      } else {
        p.x = 1.0 - (p.x + u_distortionX);
      }
    }
    p.x += disp * u_seedX * (u_seed / 5.0);
    p.y += disp * u_seedY * (u_seed / 5.0);
    // RGB shift
    vec2 offset = u_amount * vec2(cos(u_angle), sin(u_angle));
    vec4 cr = texture(u_colorMap, p + offset);
    vec4 cga = texture(u_colorMap, p);
    vec4 cb = texture(u_colorMap, p - offset);
    outColor = vec4(cr.r, cga.g, cb.b, cga.a);
    // 雪花噪声
    vec4 snow = 200.0 * u_amount * vec4(rand(vec2(xs * u_seed, ys * u_seed * 50.0)) * 0.2);
    outColor += snow;
  } else {
    outColor = texture(u_colorMap, v_uv);
  }
}
`;

// ── SMAA (Subpixel Morphological Antialiasing) ──────────────────────
// 3-pass 抗锯齿管线:边缘检测 → 混合权重计算 → 邻域混合。
// 适配自 three.js examples/jsm/shaders/SMAAShader.js (SMAA v2.8, MIT)。
// 关键改动:
//   - GLSL ES 3.0 语法(varying→in/out, texture2D→texture, gl_FragColor→outColor)
//   - 偏移计算从顶点着色器移至片元着色器(复用 POST_VERT)
//   - uniform 命名遵循 VREEN 约定(u_ 前缀)
// 参考: Jorge Jimenez et al., "SMAA: Enhanced Subpixel Morphological Antialiasing"
//   https://www.iryoku.com/smaa/

/** SMAA Pass 1 — 颜色边缘检测。 */
export const SMAA_EDGES_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_resolution;

#define SMAA_THRESHOLD 0.1

vec4 SMAAColorEdgeDetectionPS(vec2 texcoord, sampler2D colorTex) {
  vec2 threshold = vec2(SMAA_THRESHOLD);
  vec4 delta;
  vec3 C = texture(colorTex, texcoord).rgb;

  // 左 / 上 邻居
  vec3 Cleft = texture(colorTex, texcoord + u_resolution * vec2(-1.0, 0.0)).rgb;
  vec3 t = abs(C - Cleft);
  delta.x = max(max(t.r, t.g), t.b);

  vec3 Ctop = texture(colorTex, texcoord + u_resolution * vec2(0.0, 1.0)).rgb;
  t = abs(C - Ctop);
  delta.y = max(max(t.r, t.g), t.b);

  // 阈值化
  vec2 edges = step(threshold, delta.xy);

  // 无边缘则 discard(节省后续带宽)
  if (dot(edges, vec2(1.0)) == 0.0) discard;

  // 右 / 下 邻居
  vec3 Cright = texture(colorTex, texcoord + u_resolution * vec2(1.0, 0.0)).rgb;
  t = abs(C - Cright);
  delta.z = max(max(t.r, t.g), t.b);

  vec3 Cbottom = texture(colorTex, texcoord + u_resolution * vec2(0.0, -1.0)).rgb;
  t = abs(C - Cbottom);
  delta.w = max(max(t.r, t.g), t.b);

  // 邻域最大 delta
  float maxDelta = max(max(max(delta.x, delta.y), delta.z), delta.w);

  // 左左 / 上上 邻居
  vec3 Cleftleft = texture(colorTex, texcoord + u_resolution * vec2(-2.0, 0.0)).rgb;
  t = abs(C - Cleftleft);
  delta.z = max(max(t.r, t.g), t.b);

  vec3 Ctoptop = texture(colorTex, texcoord + u_resolution * vec2(0.0, 2.0)).rgb;
  t = abs(C - Ctoptop);
  delta.w = max(max(t.r, t.g), t.b);

  maxDelta = max(max(maxDelta, delta.z), delta.w);

  // 局部对比度自适应
  edges.xy *= step(0.5 * maxDelta, delta.xy);

  return vec4(edges, 0.0, 0.0);
}

void main() {
  outColor = SMAAColorEdgeDetectionPS(v_uv, u_colorMap);
}
`;

/** SMAA Pass 2 — 混合权重计算(需要 area + search LUT)。 */
export const SMAA_WEIGHTS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_edgesMap;
uniform sampler2D u_areaMap;
uniform sampler2D u_searchMap;
uniform vec2 u_resolution;

#define SMAA_MAX_SEARCH_STEPS 8
#define SMAA_AREATEX_MAX_DISTANCE 16
#define SMAA_AREATEX_PIXEL_SIZE (1.0 / vec2(160.0, 560.0))
#define SMAA_AREATEX_SUBTEX_SIZE (1.0 / 7.0)

vec2 round2(vec2 x) {
  return sign(x) * floor(abs(x) + 0.5);
}

float SMAASearchLength(sampler2D searchTex, vec2 e, float bias, float scale) {
  e.r = bias + e.r * scale;
  return 255.0 * texture(searchTex, e, 0.0).r;
}

float SMAASearchXLeft(sampler2D edgesTex, sampler2D searchTex, vec2 texcoord, float end) {
  vec2 e = vec2(0.0, 1.0);
  for (int i = 0; i < SMAA_MAX_SEARCH_STEPS; i++) {
    e = texture(edgesTex, texcoord, 0.0).rg;
    texcoord -= vec2(2.0, 0.0) * u_resolution;
    if (!(texcoord.x > end && e.g > 0.8281 && e.r == 0.0)) break;
  }
  texcoord.x += 0.25 * u_resolution.x;
  texcoord.x += u_resolution.x;
  texcoord.x += 2.0 * u_resolution.x;
  texcoord.x -= u_resolution.x * SMAASearchLength(searchTex, e, 0.0, 0.5);
  return texcoord.x;
}

float SMAASearchXRight(sampler2D edgesTex, sampler2D searchTex, vec2 texcoord, float end) {
  vec2 e = vec2(0.0, 1.0);
  for (int i = 0; i < SMAA_MAX_SEARCH_STEPS; i++) {
    e = texture(edgesTex, texcoord, 0.0).rg;
    texcoord += vec2(2.0, 0.0) * u_resolution;
    if (!(texcoord.x < end && e.g > 0.8281 && e.r == 0.0)) break;
  }
  texcoord.x -= 0.25 * u_resolution.x;
  texcoord.x -= u_resolution.x;
  texcoord.x -= 2.0 * u_resolution.x;
  texcoord.x += u_resolution.x * SMAASearchLength(searchTex, e, 0.5, 0.5);
  return texcoord.x;
}

float SMAASearchYUp(sampler2D edgesTex, sampler2D searchTex, vec2 texcoord, float end) {
  vec2 e = vec2(1.0, 0.0);
  for (int i = 0; i < SMAA_MAX_SEARCH_STEPS; i++) {
    e = texture(edgesTex, texcoord, 0.0).rg;
    texcoord += vec2(0.0, 2.0) * u_resolution;
    if (!(texcoord.y > end && e.r > 0.8281 && e.g == 0.0)) break;
  }
  texcoord.y -= 0.25 * u_resolution.y;
  texcoord.y -= u_resolution.y;
  texcoord.y -= 2.0 * u_resolution.y;
  texcoord.y += u_resolution.y * SMAASearchLength(searchTex, e.gr, 0.0, 0.5);
  return texcoord.y;
}

float SMAASearchYDown(sampler2D edgesTex, sampler2D searchTex, vec2 texcoord, float end) {
  vec2 e = vec2(1.0, 0.0);
  for (int i = 0; i < SMAA_MAX_SEARCH_STEPS; i++) {
    e = texture(edgesTex, texcoord, 0.0).rg;
    texcoord -= vec2(0.0, 2.0) * u_resolution;
    if (!(texcoord.y < end && e.r > 0.8281 && e.g == 0.0)) break;
  }
  texcoord.y += 0.25 * u_resolution.y;
  texcoord.y += u_resolution.y;
  texcoord.y += 2.0 * u_resolution.y;
  texcoord.y -= u_resolution.y * SMAASearchLength(searchTex, e.gr, 0.5, 0.5);
  return texcoord.y;
}

vec2 SMAAArea(sampler2D areaTex, vec2 dist, float e1, float e2, float offset) {
  // Rounding prevents precision errors of bilinear filtering
  vec2 texcoord = float(SMAA_AREATEX_MAX_DISTANCE) * round2(4.0 * vec2(e1, e2)) + dist;
  texcoord = SMAA_AREATEX_PIXEL_SIZE * texcoord + (0.5 * SMAA_AREATEX_PIXEL_SIZE);
  texcoord.y += SMAA_AREATEX_SUBTEX_SIZE * offset;
  return texture(areaTex, texcoord, 0.0).rg;
}

vec4 SMAABlendingWeightCalculationPS(vec2 texcoord, vec2 pixcoord, sampler2D edgesTex,
                                      sampler2D areaTex, sampler2D searchTex) {
  vec4 weights = vec4(0.0);
  vec2 e = texture(edgesTex, texcoord).rg;

  vec2 vOffset0 = texcoord.xyxy.xy + u_resolution.xyxy * vec4(-0.25, 0.125, 1.25, 0.125);
  vec2 vOffset1 = texcoord.xyxy.xy + u_resolution.xyxy * vec4(-0.125, 0.25, -0.125, -1.25);
  // 搜索终点
  float endX0 = vOffset0.x - 2.0 * u_resolution.x * float(SMAA_MAX_SEARCH_STEPS);
  float endX1 = vOffset0.z + 2.0 * u_resolution.x * float(SMAA_MAX_SEARCH_STEPS);
  float endY0 = vOffset1.y + 2.0 * u_resolution.y * float(SMAA_MAX_SEARCH_STEPS);
  float endY1 = vOffset1.w - 2.0 * u_resolution.y * float(SMAA_MAX_SEARCH_STEPS);

  if (e.g > 0.0) {
    // North edge
    vec2 d;
    vec2 coords;
    coords.x = SMAASearchXLeft(edgesTex, searchTex, vOffset0.xy, endX0);
    coords.y = vOffset1.y;
    d.x = coords.x;
    float e1 = texture(edgesTex, coords, 0.0).r;
    coords.x = SMAASearchXRight(edgesTex, searchTex, vOffset0.zw, endX1);
    d.y = coords.x;
    d = d / u_resolution.x - pixcoord.x;
    vec2 sqrt_d = sqrt(abs(d));
    coords.y -= 1.0 * u_resolution.y;
    float e2 = texture(edgesTex, coords + u_resolution * vec2(1.0, 0.0), 0.0).r;
    weights.rg = SMAAArea(areaTex, sqrt_d, e1, e2, 0.0);
  }

  if (e.r > 0.0) {
    // West edge
    vec2 d;
    vec2 coords;
    coords.y = SMAASearchYUp(edgesTex, searchTex, vOffset1.xy, endY0);
    coords.x = vOffset0.x;
    d.x = coords.y;
    float e1 = texture(edgesTex, coords, 0.0).g;
    coords.y = SMAASearchYDown(edgesTex, searchTex, vOffset1.zw, endY1);
    d.y = coords.y;
    d = d / u_resolution.y - pixcoord.y;
    vec2 sqrt_d = sqrt(abs(d));
    coords.y -= 1.0 * u_resolution.y;
    float e2 = texture(edgesTex, coords + u_resolution * vec2(0.0, 1.0), 0.0).g;
    weights.ba = SMAAArea(areaTex, sqrt_d, e1, e2, 0.0);
  }

  return weights;
}

void main() {
  vec2 pixcoord = v_uv / u_resolution;
  outColor = SMAABlendingWeightCalculationPS(v_uv, pixcoord, u_edgesMap, u_areaMap, u_searchMap);
}
`;

/** SMAA Pass 3 — 邻域混合。 */
export const SMAA_BLEND_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_blendMap;
uniform vec2 u_resolution;

vec4 SMAANeighborhoodBlendingPS(vec2 texcoord, sampler2D colorTex, sampler2D blendTex) {
  // 当前像素 + 4 邻居的偏移
  vec4 offset0 = texcoord.xyxy + u_resolution.xyxy * vec4(-1.0, 0.0, 0.0, 1.0);
  vec4 offset1 = texcoord.xyxy + u_resolution.xyxy * vec4(1.0, 0.0, 0.0, -1.0);

  // 获取混合权重
  vec4 a;
  a.xz = texture(blendTex, texcoord).xz;
  a.y = texture(blendTex, offset1.zw).g;
  a.w = texture(blendTex, offset1.xy).a;

  // 无权重 → 直通
  if (dot(a, vec4(1.0)) < 1e-5) {
    return texture(colorTex, texcoord, 0.0);
  }

  // 选择最大权重方向
  vec2 offset;
  offset.x = a.a > a.b ? a.a : -a.b;  // left vs right
  offset.y = a.g > a.r ? -a.g : a.r;  // top vs bottom

  if (abs(offset.x) > abs(offset.y)) {
    offset.y = 0.0;
  } else {
    offset.x = 0.0;
  }

  // 混合
  vec4 C = texture(colorTex, texcoord, 0.0);
  texcoord += sign(offset) * u_resolution;
  vec4 Cop = texture(colorTex, texcoord, 0.0);
  float s = abs(offset.x) > abs(offset.y) ? abs(offset.x) : abs(offset.y);

  // Gamma 校正后混合(避免线性空间插值偏暗)
  C.xyz = pow(C.xyz, vec3(2.2));
  Cop.xyz = pow(Cop.xyz, vec3(2.2));
  vec4 mixed = mix(C, Cop, s);
  mixed.xyz = pow(mixed.xyz, vec3(1.0 / 2.2));

  return mixed;
}

void main() {
  outColor = SMAANeighborhoodBlendingPS(v_uv, u_colorMap, u_blendMap);
}
`;

// ── UnrealBloomPass ─────────────────────────────────────────────
// 多层 mip 高斯 Bloom,适配自 three.js UnrealBloomPass.js (MIT, inspired by Unreal Engine 4).
// 5 级 mip 金字塔 + 可分离高斯 + 加权合成 + TAA 兼容(线性空间工作,不写 alpha)。

/** UnrealBloom Pass 1:亮度高通,提取高亮区域。 */
export const BLOOM_HIGHPASS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_luminosityThreshold;  // threshold
uniform float u_smoothWidth;          // knee soft width

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 texel = texture(u_colorMap, v_uv);
  float v = luminance(texel.rgb);

  // knee curve: soft rolloff from threshold to threshold+smoothWidth
  float knee = u_luminosityThreshold * u_smoothWidth + 1e-5;
  float soft = v - u_luminosityThreshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = soft * soft * (1.0 / (4.0 * knee + 1e-5));
  float contribution = max(soft, v - u_luminosityThreshold);
  contribution /= max(v, 1e-5);

  outColor = vec4(texel.rgb * contribution, 1.0);
}
`;

/** UnrealBloom Pass 2:可分离高斯模糊(H 或 V,由 u_direction 控制)。 */
export function BLOOM_GAUSSIAN_FRAG(kernelRadius: number): string {
  const coeffs: string[] = [];
  const sigma = kernelRadius / 3.0;
  for (let i = 0; i < kernelRadius; i++) {
    const c = (0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma).toFixed(8);
    coeffs.push(c);
  }
  return /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_invSize;
uniform vec2 u_direction;

const int KERNEL_RADIUS = ${kernelRadius};
const float GAUSSIAN[KERNEL_RADIUS] = float[KERNEL_RADIUS](${coeffs.join(', ')});

void main() {
  float weightSum = GAUSSIAN[0];
  vec3 diffuseSum = texture(u_colorMap, v_uv).rgb * weightSum;

  for (int i = 1; i < KERNEL_RADIUS; i++) {
    float x = float(i);
    float w = GAUSSIAN[i];
    vec2 uvOffset = u_direction * u_invSize * x;
    vec3 s1 = texture(u_colorMap, v_uv + uvOffset).rgb;
    vec3 s2 = texture(u_colorMap, v_uv - uvOffset).rgb;
    diffuseSum += (s1 + s2) * w;
    weightSum += 2.0 * w;
  }

  outColor = vec4(diffuseSum / max(weightSum, 1e-5), 1.0);
}
`;
}

/** UnrealBloom Pass 3:合成 5 个 mip 层级(加权 + tint + radius)。 */
export const BLOOM_COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_blurTex0;
uniform sampler2D u_blurTex1;
uniform sampler2D u_blurTex2;
uniform sampler2D u_blurTex3;
uniform sampler2D u_blurTex4;
uniform float u_bloomStrength;
uniform float u_bloomRadius;
uniform float u_bloomFactors[5];
uniform vec3  u_bloomTints[5];
uniform sampler2D u_dirtTexture;   // 可选污渍纹理,u_dirtStrength=0 时跳过
uniform float u_dirtStrength;

float lerpBloomFactor(float factor) {
  float mirrorFactor = 1.2 - factor;
  return mix(factor, mirrorFactor, u_bloomRadius);
}

void main() {
  // 3.0 为与 three.js 向后兼容的强度倍率
  vec3 bloom = 3.0 * u_bloomStrength * (
    lerpBloomFactor(u_bloomFactors[0]) * u_bloomTints[0] * texture(u_blurTex0, v_uv).rgb +
    lerpBloomFactor(u_bloomFactors[1]) * u_bloomTints[1] * texture(u_blurTex1, v_uv).rgb +
    lerpBloomFactor(u_bloomFactors[2]) * u_bloomTints[2] * texture(u_blurTex2, v_uv).rgb +
    lerpBloomFactor(u_bloomFactors[3]) * u_bloomTints[3] * texture(u_blurTex3, v_uv).rgb +
    lerpBloomFactor(u_bloomFactors[4]) * u_bloomTints[4] * texture(u_blurTex4, v_uv).rgb
  );

  // Lens dirt overlay
  if (u_dirtStrength > 1e-4) {
    vec3 dirt = texture(u_dirtTexture, v_uv).rgb;
    bloom += bloom * dirt * u_dirtStrength;
  }

  float bloomAlpha = max(bloom.r, max(bloom.g, bloom.b));
  outColor = vec4(bloom, bloomAlpha);
}
`;

/** UnrealBloom Pass 4:加法混合 Bloom 到原图(additive blend,不写 alpha 以兼容 TAA)。 */
export const BLOOM_ADDITIVE_BLEND_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;     // 原始 color buffer
uniform sampler2D u_bloomMap;     // composite bloom output
uniform float u_bloomStrength;   // 最终强度微调

void main() {
  vec4 color = texture(u_colorMap, v_uv);
  vec4 bloom = texture(u_bloomMap, v_uv);
  // Additive:颜色相加 + 独立 alpha。线性空间工作,后续由 OutputPass/ToneMap 做 gamma。
  vec3 rgb = color.rgb + bloom.rgb * u_bloomStrength;
  outColor = vec4(rgb, color.a);
}
`;

// ── SkyAtmosphere ───────────────────────────────────────────────
// GPU 物理大气散射(UE5 SkyAtmosphere / Unity HDRP 风格)。
// 光线步进单次散射 + Ozone 臭氧吸收 + 简化多重散射(Bruneton ψ 近似)。
// 超越 three.js Preetham 解析模型(仅 Rayleigh+Mie,无 Ozone,无多重散射)。
//
// 物理参数(归一化到行星半径 = 1.0,即 6371km):
//   - Rayleigh 散射系数 βR (海平面),波长相关(蓝>红)
//   - Mie 散射系数 βM,Henyey-Greenstein g
//   - Ozone 吸收系数 βO,层中心 ~25km,厚度 ~30km(吸收而非散射,Chappuis 吸收带)
//   - Rayleigh 标高 HR ≈ 8km,Mie 标高 HM ≈ 1.2km
//   - 大气层顶半径 ≈ 1.0157(=6471km)

/** SkyAtmosphere 顶点着色器:输出世界方向供片元光线步进。 */
export const SKY_ATMOSPHERE_VERT = /* glsl */ `#version 300 es
precision highp float;

in vec3 a_position;

uniform mat4 u_viewMatrix;
uniform mat4 u_projectionMatrix;
uniform vec3 u_cameraPos;       // 相机世界位置(归一化单位,地表≈1.0)

out vec3 v_worldDir;            // 天空盒方向(世界空间,已归一化)

void main() {
  // 天空盒以相机为中心,移除平移分量
  vec4 worldPos = u_viewMatrix * vec4(a_position, 0.0);
  gl_Position = u_projectionMatrix * worldPos;
  gl_Position.z = gl_Position.w; // 强制 z=w → 深度永远最远
  v_worldDir = normalize(a_position);
}
`;

/** SkyAtmosphere 片元着色器:沿视线方向光线步进积分大气散射。 */
export const SKY_ATMOSPHERE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldDir;

out vec4 outColor;

// ── 大气参数(归一化单位,行星半径=1.0) ──────────────────────
uniform vec3  u_sunDirection;      // 归一化太阳方向
uniform vec3  u_sunColor;          // 太阳光颜色(线性,已含强度)
uniform float u_sunIntensity;      // 太阳辐照强度倍率
uniform vec3  u_betaR;             // Rayleigh 海平面散射系数 (1/长度)
uniform vec3  u_betaM;             // Mie 海平面散射系数
uniform float u_betaO;             // Ozone 吸收系数(峰值,标量,作用于绿光)
uniform float u_g;                 // Henyey-Greenstein 非对称参数 [-1,1],典型 0.76
uniform float u_planetRadius;      // 行星半径,默认 1.0
uniform float u_atmosphereRadius;  // 大气层顶半径,默认 1.0157
uniform float u_HR;                // Rayleigh 标高,默认 8/6371
uniform float u_HM;                // Mie 标高,默认 1.2/6371
uniform float u_multiScatter;      // 多重散射强度(0=单次,0.3~1.0 推荐范围)
uniform float u_showSunDisc;       // 1=绘制太阳圆盘,0=隐藏
uniform vec3  u_groundAlbedo;      // 地面反照率(多次反射用)

const float PI = 3.14159265358979;

// ── 相位函数 ──────────────────────────────────────────────────
float rayleighPhase(float cosTheta) {
  // 3/(16π) * (1 + cos²θ)
  return 0.05968310365946075 * (1.0 + cosTheta * cosTheta);
}

float miePhase(float cosTheta, float g) {
  float g2 = g * g;
  float inv = 1.0 / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
  // 1/(4π) * (1-g²) / (...)，HG 相位函数
  return 0.07957747154594767 * (1.0 - g2) * inv;
}

// ── Ozone 高度剖面(钟形,中心 ~25km,半宽 ~15km) ───────────
// 归一化单位:25km → 25/6371, 15km → 15/6371
float ozoneDensity(float h) {
  float center = 25.0 / 6371.0;
  float width  = 15.0 / 6371.0;
  float d = (h - center) / width;
  return exp(-d * d);
}

// ── 射线-球求交 ──────────────────────────────────────────────
// 返回 tNear/tFar(从原点沿 dir 的参数)。无交点返回 false。
bool raySphere(vec3 ro, vec3 rd, vec3 center, float radius, out float tNear, out float tFar) {
  vec3 oc = ro - center;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return false;
  float sq = sqrt(disc);
  tNear = -b - sq;
  tFar  = -b + sq;
  return true;
}

// ── 沿太阳方向计算从点 p 到大气层顶的透射率 ─────────────────
vec3 transmittanceToSun(vec3 p, vec3 sunDir) {
  float tNear, tFar;
  if (!raySphere(p, sunDir, vec3(0.0), u_atmosphereRadius, tNear, tFar)) {
    return vec3(1.0); // 在大气外或方向背离
  }
  // 从 p 到大气层顶的距离
  float dist = max(0.0, tFar);
  const int SUN_SAMPLES = 8;
  float ds = dist / float(SUN_SAMPLES);
  vec3 opticalDepth = vec3(0.0);
  for (int i = 0; i < SUN_SAMPLES; i++) {
    float t = (float(i) + 0.5) * ds;
    vec3 sp = p + sunDir * t;
    float h = length(sp) - u_planetRadius;
    if (h < 0.0) return vec3(0.0); // 被行星遮挡
    float dR = exp(-h / u_HR) * ds;
    float dM = exp(-h / u_HM) * ds;
    float dO = ozoneDensity(h) * ds;
    opticalDepth += vec3(u_betaR * dR + u_betaM * dM + vec3(u_betaO * 0.4, u_betaO, u_betaO * 0.4) * dO);
  }
  return exp(-opticalDepth);
}

void main() {
  vec3 dir = normalize(v_worldDir);
  vec3 cam = vec3(0.0, u_planetRadius + 0.0001, 0.0); // 相机贴地表(可外置)

  // 主视线与大气层求交
  float tNear, tFar;
  if (!raySphere(cam, dir, vec3(0.0), u_atmosphereRadius, tNear, tFar)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  tNear = max(0.0, tNear);

  // 与行星求交(若视线朝下,会被地面截断)
  float tGround = 1e9;
  float gNear, gFar;
  if (raySphere(cam, dir, vec3(0.0), u_planetRadius, gNear, gFar)) {
    if (gNear > 0.0) tGround = gNear;
  }
  float tEnd = min(tFar, tGround);
  float tStart = tNear;

  if (tEnd <= tStart) {
    // 视线指向地下
    outColor = vec4(u_groundAlbedo * 0.1, 1.0);
    return;
  }

  const int PRIMARY_SAMPLES = 32;
  float segLen = (tEnd - tStart) / float(PRIMARY_SAMPLES);

  vec3 transmittance = vec3(1.0);
  vec3 luminance = vec3(0.0);
  float cosTheta = dot(dir, u_sunDirection);

  // 主环:沿视线步进,累积单次散射
  for (int i = 0; i < PRIMARY_SAMPLES; i++) {
    float t = tStart + (float(i) + 0.5) * segLen;
    vec3 p = cam + dir * t;
    float h = length(p) - u_planetRadius;
    if (h < 0.0) break;

    float dR = exp(-h / u_HR) * segLen;
    float dM = exp(-h / u_HM) * segLen;
    float dO = ozoneDensity(h) * segLen;

    // 该点散射系数(参与衰减)
    vec3 extinction = u_betaR * dR + u_betaM * dM + vec3(u_betaO * 0.4, u_betaO, u_betaO * 0.4) * dO;

    // 太阳到该点的透射率
    vec3 sunTrans = transmittanceToSun(p, u_sunDirection);

    // 单次散射相位
    float pR = rayleighPhase(cosTheta);
    float pM = miePhase(cosTheta, u_g);

    // 散射到视线方向的光(Rayleigh + Mie)
    vec3 scattering = (u_betaR * dR * pR + u_betaM * dM * pM) * sunTrans * u_sunColor * u_sunIntensity;

    // 简化多重散射(Bruneton ψ 近似):用一个恒定环境项代表被大气散射多次的光,
    // 强度正比于当前点的太阳透射率与多重散射因子
    vec3 multiScatter = u_betaR * dR * sunTrans * u_sunColor * u_sunIntensity * u_multiScatter * 0.15;
    scattering += multiScatter;

    // 累积:散射光 × 当前透射率
    luminance += transmittance * scattering;

    // 衰减透射率(Beer-Lambert)
    transmittance *= exp(-extinction);
  }

  // 地面反射:视线击中地面时,加入地面反照率 × 到达地面的透射率 × 太阳光
  if (tGround < tFar) {
    vec3 groundPos = cam + dir * tGround;
    vec3 groundSunTrans = transmittanceToSun(groundPos, u_sunDirection);
    vec3 groundLit = u_groundAlbedo * groundSunTrans * u_sunColor * u_sunIntensity / PI;
    luminance += transmittance * groundLit;
  }

  // 太阳圆盘(高光圆盘,角度 ~0.53°)
  if (u_showSunDisc > 0.5) {
    float sunCos = 0.999956676946448443553574619906976478926848692873900859324;
    float disc = smoothstep(sunCos - 0.0008, sunCos + 0.0008, cosTheta);
    luminance += u_sunColor * u_sunIntensity * disc * 200.0;
  }

  outColor = vec4(luminance, 1.0);
}
`;

// ── SSR Separable Rough-Reflection Blur ───────────────────────────
// 粗糙反射的空间降噪:9-tap 可分离高斯模糊,带逐像素粗糙度半径
// 和法线边缘感知权重。运行两次(H + V)产生 9×9 等效核。
//
// 设计参考:
//   - McGuire & Mara "Efficient GPU Screen-Space Ray Tracing" (2014) §4.3
//   - o3de Atom RPI SSRBlurShader
//   - UE5 ScreenSpaceReflections.usf 的 SpatialFilterPass
//
// 关键点:
//   1. 粗糙度 < 0.2 的像素(镜面)跳过模糊,保持锐利反射;
//   2. 模糊半径 = roughness × u_blurRadiusScale,粗糙面更模糊;
//   3. 法线边缘感知:相邻像素法线夹角 > 阈值时,权重 → 0,
//      避免反射跨越几何边缘泄漏(如墙面 → 地面);
//   4. 9-tap 高斯核预计算权重 (σ = 2.0),归一化总和 = 1。
export const SSR_BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;        // SSR 输出(H pass 后 = H-blurred,V pass 后 = final)
uniform sampler2D u_normalMap;       // GBuffer 世界法线
uniform sampler2D u_roughnessMap;    // R = roughness [0,1];u_hasRoughness=0 时不读
uniform vec2  u_blurDir;             // (1,0)=H pass,(0,1)=V pass
uniform vec2  u_screenSize;
uniform float u_blurRadiusScale;     // 最大模糊半径(texel 数,默认 4.0)
uniform int   u_hasRoughness;        // 1=有粗糙度纹理,0=无(按镜面处理)
uniform float u_roughnessCutoff;     // roughness > cutoff → 跳过 SSR(漫反射面)

// 9-tap 高斯权重 (σ=2.0,归一化),偏移单位为 texel
// 偏移: -4, -3, -2, -1, 0, 1, 2, 3, 4
// 权重: 0.0156, 0.0913, 0.1520, 0.2417, 0.3829, 0.2417, 0.1520, 0.0913, 0.0156
// (注:居中权重稍高以保证镜面像素不被相邻粗糙像素稀释)
const int TAPS = 4; // 单侧 4 tap,共 9 tap
const float WEIGHTS[9] = float[9](
  0.0156, 0.0913, 0.1520, 0.2417, 0.3829, 0.2417, 0.1520, 0.0913, 0.0156
);

void main() {
  vec3 centerColor = texture(u_colorMap, v_uv).rgb;
  vec3 centerNormal = texture(u_normalMap, v_uv).xyz;

  // 粗糙度(u_hasRoughness=0 → 按镜面 0 处理)
  float roughness = 0.0;
  if (u_hasRoughness > 0) {
    roughness = texture(u_roughnessMap, v_uv).r;
  }

  // 跳过条件:镜面(roughness < 0.2)、漫反射面(> cutoff)、无法线(天空)
  if (length(centerNormal) < 0.01 || roughness < 0.2 || roughness > u_roughnessCutoff) {
    outColor = vec4(centerColor, 1.0);
    return;
  }

  vec2 texel = 1.0 / u_screenSize;
  // 模糊半径:粗糙度线性映射到 [0, u_blurRadiusScale]
  float blurRadius = (roughness - 0.2) / max(0.001, u_roughnessCutoff - 0.2) * u_blurRadiusScale;
  vec2 dir = u_blurDir * texel * blurRadius;

  // 边缘感知:法线点积阈值(0.85 ≈ 32°,超过则视为不同表面)
  const float edgeThreshold = 0.85;
  vec3 N = normalize(centerNormal);

  vec3 color = vec3(0.0);
  float totalWeight = 0.0;

  for (int i = -TAPS; i <= TAPS; i++) {
    float t = float(i);
    vec2 sampleUV = v_uv + dir * t;
    vec3 sampleColor = texture(u_colorMap, sampleUV).rgb;
    vec3 sampleNormal = texture(u_normalMap, sampleUV).xyz;

    // 边缘感知权重:相邻像素法线与中心法线夹角过大 → 权重 0
    float edgeWeight = 1.0;
    if (length(sampleNormal) > 0.01) {
      edgeWeight = step(edgeThreshold, dot(N, normalize(sampleNormal)));
    }

    float w = WEIGHTS[i + TAPS] * edgeWeight;
    color += sampleColor * w;
    totalWeight += w;
  }

  // 归一化(防止边缘像素总权重 < 1 导致偏暗)
  if (totalWeight > 0.0) {
    color /= totalWeight;
  } else {
    color = centerColor;
  }

  outColor = vec4(color, 1.0);
}
`;

// ── SSSR (Stochastic Screen-Space Reflections) ───────────────────
// 随机屏幕空间反射 —— 用 GGX 重要性采样生成射线方向,产生物理正确的粗糙反射。
//
// 与 SSR_FRAG 的区别:
//   - SSR_FRAG:镜面反射方向 + box/blur 近似粗糙(不物理,模糊核固定)
//   - SSSR_FRAG:每像素按 GGX NDF 重要性采样半向量 H,reflect(-V, H) 得到
//     射线方向。粗糙度越大,采样方向越分散,多帧时序累积收敛到正确模糊。
//     这是 Intel SSSR / UE5 的做法,物理正确且支持动态模糊反射。
//
// 算法:
//   1. 读 GBuffer:世界位置、世界法线、粗糙度、场景颜色
//   2. 跳过天空 / 过粗糙 / 背面
//   3. GGX 重要性采样:
//      a. φ = 2π·ξ₁,  cosθ = √((1-ξ₂)/(1+(α²-1)·ξ₂)),  α=roughness²
//      b. H = TBN·(sinθcosφ, sinθsinφ, cosθ)
//      c. rayDir = reflect(-viewDir, H)
//   4. 屏幕空间自适应步长射线步进 + 二分查找细化
//   5. 边缘衰减 + 距离衰减 + Fresnel(Schlick) + 粗糙度衰减
//   6. 时序累积:用速度纹理重投影历史帧反射,按 confidence 混合
//   7. 输出 RGB=反射色×强度×Fresnel,A=confidence(调用方按 α 混合)
//
// 参考:
//   - Intel "Deferred Stochastic Screen-Space Reflections" (Stachowiak 2018)
//   - UE5 "Stochastic SSR" (Karis 2014)
//   - o3de Atom "ScreenSpaceReflections" pass
//   - three.js SSRPass(本实现在其基础上增加 GGX 重要性采样)
export const SSSR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;        // 场景颜色(反射源)
uniform sampler2D u_positionMap;     // GBuffer 世界位置 (RGBA16F)
uniform sampler2D u_normalMap;       // GBuffer 世界法线 (RGBA16F)
uniform sampler2D u_roughnessMap;    // R = roughness [0,1];u_hasRoughness=0 时不读
uniform sampler2D u_historyMap;      // 上一帧累积反射(时序复用);u_hasHistory=0 时不读
uniform sampler2D u_velocityMap;     // 像素速度(屏幕 UV 偏移);u_hasVelocity=0 时不读
uniform mat4 u_projection;
uniform mat4 u_view;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform int   u_maxSteps;            // 射线最大步进次数(默认 64)
uniform float u_thickness;           // 厚度容差(世界单位,默认 0.5)
uniform float u_reflectionStrength;  // 反射强度(默认 0.5)
uniform float u_roughnessCutoff;     // roughness > cutoff → 跳过(默认 0.8,比 SSR 更宽)
uniform float u_roughnessBias;       // 粗糙度偏移(降低有效粗糙度,默认 0.0)
uniform float u_temporalWeight;      // 时序混合权重(0=不累积,0.9=强累积,默认 0.88)
uniform float u_frame;               // 帧计数(时序抖动)
uniform int   u_hasRoughness;        // 1=有粗糙度纹理,0=无
uniform int   u_hasHistory;          // 1=有历史纹理可复用,0=首帧
uniform int   u_hasVelocity;         // 1=有速度纹理

#define PI 3.14159265359

// Interleaved Gradient Noise (Jorge Jimenez 2014) — 时序抖动去条带。
float ign(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

// GGX 重要性采样:生成半向量 H(在法线半球内,服从 GGX NDF)。
// 输入:xi(两个均匀随机数 [0,1)),N(法线,世界空间),roughness
// 输出:半向量 H(世界空间,归一化)
//
// 数学:
//   α = roughness²
//   φ = 2π·ξ₁
//   cos²θ = (1-ξ₂) / (1+(α²-1)·ξ₂)     ← GGX NDF 的逆 CDF
//   sinθ  = √(1-cos²θ)
//   H_tangent = (sinθ·cosφ, sinθ·sinφ, cosθ)
//   H_world   = TBN · H_tangent
vec3 importanceSampleGGX(vec2 xi, vec3 N, float roughness) {
  float a = roughness * roughness;
  float phi = 2.0 * PI * xi.x;
  float cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  float sinTheta = sqrt(1.0 - cosTheta * cosTheta);

  vec3 H;
  H.x = sinTheta * cos(phi);
  H.y = sinTheta * sin(phi);
  H.z = cosTheta;

  // tangent → world(法线为 z 轴的切线空间基)
  vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);
  return normalize(T * H.x + B * H.y + N * H.z);
}

// 世界位置 → 屏幕 UV(0..1)。
vec2 projectToUV(vec3 worldPos) {
  vec4 clip = u_projection * u_view * vec4(worldPos, 1.0);
  return (clip.xy / clip.w) * 0.5 + 0.5;
}

// 视空间深度(沿相机轴的距离,正值=前方)。
float viewDepth(vec3 worldPos) {
  return -(u_view * vec4(worldPos, 1.0)).z;
}

// 厚度检测(视空间):UV 越界返回 false;射线在几何后方且在厚度内 → 击中。
bool hitTestVS(vec3 rayPos, vec2 uv, out float depthDiff) {
  depthDiff = 1e9;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return false;
  vec3 sampledPos = texture(u_positionMap, uv).xyz;
  float rayDepth = viewDepth(rayPos);
  float sampledDepth = viewDepth(sampledPos);
  depthDiff = rayDepth - sampledDepth;
  return depthDiff > 0.0 && depthDiff < u_thickness;
}

void main() {
  vec3 sceneColor  = texture(u_colorMap,    v_uv).rgb;
  vec3 worldPos    = texture(u_positionMap, v_uv).xyz;
  vec3 worldNormal = texture(u_normalMap,   v_uv).xyz;

  float roughness = 0.0;
  if (u_hasRoughness > 0) {
    roughness = texture(u_roughnessMap, v_uv).r;
  }
  // 有效粗糙度(偏移降低噪声,Intel SSSR 建议 0.0~0.1)
  float effRoughness = clamp(roughness - u_roughnessBias, 0.0, 1.0);

  // 早退:天空(无法线)/ 过粗糙 / 背面
  if (length(worldNormal) < 0.01 || roughness > u_roughnessCutoff) {
    outColor = vec4(sceneColor, 0.0); // alpha=0 = 无反射
    return;
  }
  worldNormal = normalize(worldNormal);

  vec3 viewDir = normalize(u_cameraPos - worldPos);
  if (dot(viewDir, worldNormal) <= 0.0) {
    outColor = vec4(sceneColor, 0.0);
    return;
  }

  // GGX 重要性采样:生成半向量,反射得到射线方向
  vec2 xi = vec2(
    ign(v_uv * u_screenSize + vec2(u_frame * 0.61803398875, 0.0)),
    ign(v_uv * u_screenSize + vec2(0.0, u_frame * 0.61803398875))
  );
  vec3 H = importanceSampleGGX(xi, worldNormal, effRoughness);
  vec3 rayDir = reflect(-viewDir, H);

  // 背面剔除:射线打入表面(粗糙采样的半向量可能偏到法线下方)
  if (dot(rayDir, worldNormal) <= 0.0) {
    outColor = vec4(sceneColor, 0.0);
    return;
  }

  // 屏幕空间射线步进(自适应步长 + 时序抖动)
  float baseStep = u_thickness * 0.5;
  float jitter = ign(v_uv * u_screenSize + vec2(u_frame * 1.61803398875, 0.0));
  vec3 rayPos = worldPos + rayDir * baseStep * (0.5 + jitter * 0.5);
  vec2 uv = projectToUV(rayPos);
  vec2 hitUV = uv;
  vec3 hitPos = rayPos;
  bool hit = false;

  for (int i = 0; i < 64; i++) {
    if (i >= u_maxSteps) break;
    float dd;
    if (hitTestVS(rayPos, uv, dd)) {
      hit = true;
      hitPos = rayPos;
      hitUV = uv;
      break;
    }
    float stepSize = baseStep * (1.0 + float(i) * 0.5);
    rayPos += rayDir * stepSize;
    uv = projectToUV(rayPos);
  }

  // 二分查找细化(8 步,误差压到 thickness/256)
  if (hit) {
    vec3 lo = worldPos;
    vec3 hi = hitPos;
    for (int i = 0; i < 8; i++) {
      vec3 mid = (lo + hi) * 0.5;
      vec2 midUV = projectToUV(mid);
      float dd;
      if (hitTestVS(mid, midUV, dd)) {
        hi = mid;
        hitUV = midUV;
      } else {
        lo = mid;
      }
    }
  }

  // 边缘衰减:接近屏幕边缘的命中不可靠
  float edgeFade = 1.0;
  edgeFade *= smoothstep(0.0, 0.1, hitUV.x) * smoothstep(0.0, 0.1, 1.0 - hitUV.x);
  edgeFade *= smoothstep(0.0, 0.1, hitUV.y) * smoothstep(0.0, 0.1, 1.0 - hitUV.y);

  // 距离衰减:远距离命中衰减
  float hitDist = length(hitPos - worldPos);
  float distFade = exp(-hitDist * 0.01);

  // Fresnel (Schlick 近似)
  float NdotV = max(dot(worldNormal, viewDir), 0.0);
  float fresnel = pow(1.0 - NdotV, 5.0);
  float F0 = 0.04;
  float fresnelTerm = F0 + (1.0 - F0) * fresnel;

  // 粗糙度衰减:粗糙表面的反射更弱
  float roughFade = 1.0 - smoothstep(0.3, u_roughnessCutoff, roughness);

  vec3 reflectionColor = vec3(0.0);
  float confidence = 0.0;
  if (hit) {
    reflectionColor = texture(u_colorMap, hitUV).rgb;
    confidence = edgeFade * distFade * roughFade;
  }

  // 时序累积:重投影历史帧反射,按 confidence 混合
  vec3 finalReflection = reflectionColor;
  if (u_hasHistory > 0 && u_hasVelocity > 0 && u_temporalWeight > 0.0) {
    vec2 velocity = texture(u_velocityMap, v_uv).xy;
    vec2 historyUV = v_uv - velocity;
    if (historyUV.x >= 0.0 && historyUV.x <= 1.0 &&
        historyUV.y >= 0.0 && historyUV.y <= 1.0) {
      vec4 history = texture(u_historyMap, historyUV);
      // confidence 低时更信任历史(时序累积),confidence 高时更信任当前帧
      float w = u_temporalWeight * (1.0 - confidence);
      finalReflection = mix(reflectionColor, history.rgb, w);
      confidence = max(confidence, mix(1.0, history.a, u_temporalWeight));
    }
  }

  // 输出:反射颜色 × 强度 × Fresnel,alpha = confidence
  outColor = vec4(finalReflection * u_reflectionStrength * fresnelTerm, confidence);
}
`;

// ── SSGI (Screen-Space Global Illumination) ──────────────────────
// 屏幕空间全局光照 —— 在屏幕空间做漫反射间接光采样,产生彩色反弹光。
// 与 SSR 的区别:
//   - SSR 反射 viewDir 关于法线的镜像方向(镜面);SSGI 在法线半球内
//     采多条余弦加权射线(漫反射),累积间接辐照度。
//   - SSR 输出"反射颜色"(混合替换);SSGI 输出"间接辐照度"(叠加到场景)。
//   - SSR 受粗糙度调制;SSGI 对漫反射面最有意义(粗糙度高的表面)。
//
// 算法:
//   1. 读 GBuffer:世界位置、世界法线、场景颜色
//   2. 跳过天空(无法线)
//   3. 建立法线正交基 TBN
//   4. 对 NUM_RAYS 条射线(默认 8):
//      a. 余弦加权半球采样:θ=asin(√ξ₁), φ=2π·ξ₂ + frame·goldenAngle
//         (每帧旋转采样模式,配合 TAA 消除噪声)
//      b. 射线方向 = TBN · (sinθcosφ, sinθsinφ, cosθ)
//      c. 屏幕空间自适应步长射线步进(复用 SSR 的视空间厚度检测)
//      d. 命中时采样颜色,权重 = N·rayDir(余弦权重)
//      e. 边缘衰减 + 距离衰减
//   5. 间接辐照度 = Σ(hitColor × weight) / Σ(weight)
//   6. 输出 = indirectIrradiance × strength(由调用方叠加到场景颜色)
//
// 参考:
//   - Crytek "Real-time Diffuse Global Illumination in Screen Space" (SSDO)
//   - o3de Atom "ScreenSpaceGlobalIllumination" pass
//   - EA SEED "Stable SSAO" GDC 演讲(时序抖动策略)
export const SSGI_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;       // 场景颜色(反弹光源)
uniform sampler2D u_positionMap;    // GBuffer 世界位置(RGBA16F)
uniform sampler2D u_normalMap;      // GBuffer 世界法线(RGBA16F)
uniform mat4 u_projection;
uniform mat4 u_view;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform int   u_maxSteps;           // 每射线最大步进次数(默认 32)
uniform float u_thickness;          // 厚度容差(世界单位,默认 0.5)
uniform float u_strength;           // 间接光强度(默认 0.5)
uniform float u_radius;             // 采样半径(世界单位,默认 0.5)
uniform float u_frame;              // 帧计数(时序旋转)
uniform int   u_numRays;            // 射线数(1..8,默认 8)
uniform float u_jitterScale;        // 抖动幅度(0=关,1=默认)

#define MAX_RAYS 8

// Interleaved Gradient Noise (Jorge Jimenez 2014)
float ign(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

// 把世界位置投影到屏幕 UV(0..1)
vec2 projectToUV(vec3 worldPos) {
  vec4 clip = u_projection * u_view * vec4(worldPos, 1.0);
  return (clip.xy / clip.w) * 0.5 + 0.5;
}

// 视空间深度(沿相机轴的距离)
float viewDepth(vec3 worldPos) {
  return -(u_view * vec4(worldPos, 1.0)).z;
}

// 厚度检测(视空间):UV 越界返回 false
bool hitTestVS(vec3 rayPos, vec2 uv, out float depthDiff) {
  depthDiff = 1e9;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return false;
  vec3 sampledPos = texture(u_positionMap, uv).xyz;
  float rayDepth = viewDepth(rayPos);
  float sampledDepth = viewDepth(sampledPos);
  depthDiff = rayDepth - sampledDepth;
  return depthDiff > 0.0 && depthDiff < u_thickness;
}

void main() {
  vec3 worldPos   = texture(u_positionMap, v_uv).xyz;
  vec3 worldNormal = texture(u_normalMap, v_uv).xyz;
  vec3 sceneColor = texture(u_colorMap, v_uv).rgb;

  // 跳过天空(无法线)→ 输出黑色(无间接光)
  if (length(worldNormal) < 0.01) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  worldNormal = normalize(worldNormal);

  // 背面剔除:法线背离相机不产生间接光
  vec3 viewDir = normalize(u_cameraPos - worldPos);
  if (dot(viewDir, worldNormal) <= 0.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // 构建 TBN 正交基(不依赖切线属性,由法线推导)
  vec3 up = abs(worldNormal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, worldNormal));
  vec3 B = cross(worldNormal, T);

  // 时序旋转角(每帧旋转黄金角 ≈ 137.5°)
  float goldenAngle = 2.39996323;
  float frameRot = u_frame * goldenAngle;

  // 每像素抖动(IGN)
  float jitter = ign(v_uv * u_screenSize + vec2(u_frame * 0.61803398875, 0.0));
  jitter = (jitter - 0.5) * u_jitterScale;

  vec3 indirect = vec3(0.0);
  float totalWeight = 0.0;
  int rays = min(u_numRays, MAX_RAYS);

  for (int r = 0; r < MAX_RAYS; r++) {
    if (r >= rays) break;

    // 余弦加权半球采样(重要性采样):cos(θ)=√ξ₁
    float xi1 = fract(ign(v_uv * u_screenSize + vec2(r * 7.13 + u_frame * 0.31, r * 3.17)) + jitter);
    float xi2 = fract(ign(v_uv * u_screenSize + vec2(r * 5.91, r * 11.37 + u_frame * 0.47)) + jitter);

    float theta = asin(sqrt(xi1));
    float phi = 2.0 * 3.14159265 * xi2 + frameRot;

    vec3 rayDir = T * (sin(theta) * cos(phi))
                + B * (sin(theta) * sin(phi))
                + worldNormal * cos(theta);

    // 射线步进(自适应步长,近小远大)
    float baseStep = u_radius * 0.1;
    vec3 rayPos = worldPos + rayDir * baseStep * (0.5 + jitter);
    vec2 uv = projectToUV(rayPos);
    vec2 hitUV = uv;
    bool hit = false;

    for (int i = 0; i < 64; i++) {
      if (i >= u_maxSteps) break;
      float dd;
      if (hitTestVS(rayPos, uv, dd)) {
        hit = true;
        hitUV = uv;
        break;
      }
      float stepSize = baseStep * (1.0 + float(i) * 0.5) * (1.0 + jitter * 0.25);
      rayPos += rayDir * stepSize;
      uv = projectToUV(rayPos);
    }

    if (hit) {
      // 边缘衰减:命中 UV 靠近屏幕边缘 → 权重衰减
      vec2 edgeDist = min(hitUV, 1.0 - hitUV);
      float edgeFade = smoothstep(0.0, 0.1, min(edgeDist.x, edgeDist.y));

      // 采样命中点颜色作为间接光
      vec3 hitColor = texture(u_colorMap, hitUV).rgb;

      // 距离衰减:远处命中贡献更弱(模拟间接光随距离衰减)
      float hitDist = length(rayPos - worldPos);
      float distAtten = 1.0 / (1.0 + hitDist * hitDist * 2.0);

      // 余弦权重(采样方向已隐含,显式写出以确保正确性)
      float cosWeight = max(dot(worldNormal, rayDir), 0.0);

      float w = edgeFade * distAtten * cosWeight;
      indirect += hitColor * w;
      totalWeight += w;
    }
  }

  // 归一化:除以总权重得到平均辐照度
  vec3 indirectIrradiance;
  if (totalWeight > 0.0) {
    indirectIrradiance = indirect / totalWeight;
  } else {
    indirectIrradiance = vec3(0.0);
  }

  // 乘以强度(由调用方决定是否再乘 albedo / π)
  outColor = vec4(indirectIrradiance * u_strength, 1.0);
}
`;

// ── Screen-Space Shadow (光照方向射线步进接触阴影) ──────────────
// 沿光照方向在屏幕空间射线步进深度缓冲,产生阴影贴图无法捕捉的
// 小尺度方向性接触阴影。
//
// 与 ContactShadowsPass 的区别:
//   - ContactShadowsPass 用亮度作为高度代理,不使用深度,无方向性
//   - SSShadowPass 用实际深度缓冲,沿光照方向步进,有正确方向性
//
// 与 PCSS 的区别:
//   - PCSS 采样阴影贴图(大范围阴影,受阴影贴图分辨率限制)
//   - SSShadowPass 采样深度缓冲(小范围接触阴影,像素级精度)
//
// 算法:
//   1. 从深度缓冲重建视空间位置
//   2. 将光向变换到视空间
//   3. 沿视空间光向步进,每步投影到屏幕空间
//   4. 比较射线深度与采样深度:射线在几何体后方 → 被遮挡
//   5. 距离衰减:远离接触点 → 阴影渐消(避免大范围假阴影)
//
// 参考:
//   - UE5 ScreenSpaceContactShadows
//   - o3de Atom ScreenSpaceShadow pass
export const SSSHADOW_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_depthMap;       // 场景深度(GL_DEPTH_COMPONENT 或 RGBA16F 打包)
uniform mat4 u_invProjection;       // 投影逆矩阵(用于位置重建)
uniform mat4 u_projection;          // 投影矩阵(用于步进投影)
uniform vec3 u_lightDirVS;          // 视空间光向(已归一化,指向光源)
uniform vec2 u_screenSize;
uniform int   u_maxSteps;           // 最大步进次数(默认 16)
uniform float u_stepSize;           // 步长(视空间单位,默认 0.1)
uniform float u_thickness;          // 厚度容差(视空间,默认 0.05)
uniform float u_maxDistance;        // 最大射线距离(视空间,默认 1.0)
uniform float u_bias;               // 深度偏移(避免自阴影,默认 0.001)

// 从深度 + UV 重建视空间位置(NDC → 逆投影)
vec3 reconstructViewPos(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 viewPos = u_invProjection * ndc;
  return viewPos.xyz / viewPos.w;
}

// 视空间位置 → 屏幕 UV
vec2 projectToUV(vec3 viewPos) {
  vec4 clip = u_projection * vec4(viewPos, 1.0);
  return (clip.xy / clip.w) * 0.5 + 0.5;
}

void main() {
  float depth = texture(u_depthMap, v_uv).r;
  // 深度 = 1.0 → 天空(远裁面),跳过
  if (depth >= 1.0) {
    outColor = vec4(1.0, 1.0, 1.0, 1.0); // 无遮挡
    return;
  }

  vec3 viewPos = reconstructViewPos(v_uv, depth);

  // 沿光向步进(指向光源)
  vec3 rayDir = normalize(u_lightDirVS);
  vec3 rayPos = viewPos + rayDir * (u_stepSize + u_bias);

  float shadow = 1.0; // 1 = 无遮挡

  for (int i = 0; i < 64; i++) {
    if (i >= u_maxSteps) break;

    // 射线已超出最大距离 → 停止
    float rayDist = length(rayPos - viewPos);
    if (rayDist > u_maxDistance) break;

    vec2 uv = projectToUV(rayPos);
    // 射线超出屏幕 → 停止
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

    float sampledDepth = texture(u_depthMap, uv).r;
    if (sampledDepth >= 1.0) {
      // 采样点为天空 → 无遮挡,继续
      rayPos += rayDir * u_stepSize;
      continue;
    }

    vec3 sampledPos = reconstructViewPos(uv, sampledDepth);
    float rayDepth = -rayPos.z;   // 视空间深度(正值,越远越大)
    float sampledDepthVS = -sampledPos.z;

    // 射线在几何体后方(射线比采样点更远 → 被遮挡)
    float depthDiff = rayDepth - sampledDepthVS;
    if (depthDiff > 0.0 && depthDiff < u_thickness) {
      // 距离衰减:越远 → 阴影越淡
      float fade = 1.0 - smoothstep(0.0, u_maxDistance, rayDist);
      shadow = min(shadow, 1.0 - fade);
      break; // 找到遮挡即停止
    }

    rayPos += rayDir * u_stepSize;
  }

  outColor = vec4(shadow, shadow, shadow, 1.0);
}
`;

// ── 色调映射 (HDR → LDR) ──────────────────────────────────────────
// 支持 5 种算子:Linear(直通)、ACES Filmic(Narkowicz 近似)、Reinhard、
// AGX(Blender 简化)、Uncharted 2 (Hable)。
//
// 管线位置:Bloom → ColorGrading → **Tonemapping** → 输出
// 必须在所有 HDR 效果(Bloom/SSR/SSGI)之后、最终显示之前应用。
//
// 参考:
//   - Narkowicz 2015 "ACES Filmic Tone Mapping Curve"
//   - Reinhard et al. 2002 "Photographic Tone Reproduction"
//   - Blender AGX (Troy Sobotka)
//   - Hable 2010 "Uncharted 2: HDR Lighting"
export const TONEMAP_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform float u_exposure;   // 曝光倍数(默认 1.0)
uniform int   u_mode;       // 0=Linear, 1=ACES, 2=Reinhard, 3=AGX, 4=Uncharted2

// ── ACES Filmic (Narkowicz 近似) ─────────────────────────────────
vec3 acesFilmic(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// ── Reinhard ─────────────────────────────────────────────────────
vec3 reinhardTonemap(vec3 x) {
  return x / (x + vec3(1.0));
}

// ── AGX (Blender, 简化版) ────────────────────────────────────────
// 完整 AGX 需要 OSACES/ACEScg 色彩空间变换;此简化版保留核心 sigmoid
// 特性:中间调平滑、高光不裁剪、暗部不挤压。
vec3 agxSimplified(vec3 x) {
  // 前置压缩(类似 log 编码)
  vec3 x_log = log2(vec3(1.0) + x * 2.0) / log2(vec3(3.0));
  // Sigmoid 映射(AGX 核心曲线)
  vec3 mapped = x_log / (x_log + vec3(0.6));
  // 后置伽马校正
  return pow(clamp(mapped, 0.0, 1.0), vec3(1.8));
}

// ── Uncharted 2 (Hable) ──────────────────────────────────────────
vec3 uncharted2Partial(vec3 x) {
  const float A = 0.15;
  const float B = 0.50;
  const float C = 0.10;
  const float D = 0.20;
  const float E = 0.02;
  const float F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

vec3 uncharted2Tonemap(vec3 x, float exposureBias) {
  vec3 curr = uncharted2Partial(x * exposureBias);
  vec3 whiteScale = vec3(1.0) / uncharted2Partial(vec3(11.2));
  return clamp(curr * whiteScale, 0.0, 1.0);
}

void main() {
  vec3 hdr = texture(u_colorMap, v_uv).rgb;

  // 应用曝光
  hdr *= u_exposure;

  vec3 ldr;
  if (u_mode == 0) {
    // Linear: 仅裁剪,无色调映射
    ldr = clamp(hdr, 0.0, 1.0);
  } else if (u_mode == 1) {
    ldr = acesFilmic(hdr);
  } else if (u_mode == 2) {
    ldr = reinhardTonemap(hdr);
  } else if (u_mode == 3) {
    ldr = agxSimplified(hdr);
  } else {
    // Uncharted 2 (默认 exposure bias = 2.0)
    ldr = uncharted2Tonemap(hdr, 2.0);
  }

  outColor = vec4(ldr, 1.0);
}
`;

// ── 指数高度雾 ─────────────────────────────────────────────────────
// 从深度纹理重建世界位置,根据世界高度 Y 计算指数衰减雾密度。
// 参考: UE5 Exponential Height Fog。

export const HEIGHT_FOG_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_depthMap;
uniform mat4 u_inverseViewProjection;
uniform vec3 u_cameraPos;

uniform float u_fogDensity;
uniform float u_fogHeightFalloff;
uniform float u_fogHeight;
uniform vec3 u_fogColor;
uniform float u_maxDistance;

uniform int u_inscatteringEnabled;
uniform vec3 u_sunDirection;
uniform vec3 u_sunColor;
uniform float u_inscatteringStrength;

void main() {
  vec3 sceneColor = texture(u_colorMap, v_uv).rgb;

  // 从深度纹理重建世界位置
  float depth = texture(u_depthMap, v_uv).r;
  // 深度 1.0 = 远裁面(天空)→ 完全雾化
  if (depth >= 1.0) {
    outColor = vec4(u_fogColor, 1.0);
    return;
  }

  // NDC → 世界空间
  vec4 worldPos = u_inverseViewProjection * vec4(v_uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  worldPos.xyz /= worldPos.w;

  // 像素到相机的距离
  float viewDist = length(worldPos.xyz - u_cameraPos);
  viewDist = min(viewDist, u_maxDistance);

  // 指数高度雾密度:随高度上升指数衰减
  float heightFactor = exp(-u_fogHeightFalloff * (worldPos.y - u_fogHeight));
  float density = u_fogDensity * heightFactor;

  // 雾因子
  float fogFactor = 1.0 - exp(-density * viewDist);
  fogFactor = clamp(fogFactor, 0.0, 1.0);

  vec3 finalFogColor = u_fogColor;

  // 入射散射:太阳方向与视线方向同向时雾色偏暖
  if (u_inscatteringEnabled > 0) {
    vec3 viewDir = normalize(worldPos.xyz - u_cameraPos);
    float sunDot = dot(viewDir, -u_sunDirection);
    // 指数散射:太阳方向附近增强
    float inscatter = pow(max(sunDot, 0.0), 8.0) * u_inscatteringStrength;
    finalFogColor = mix(u_fogColor, u_sunColor, inscatter * 0.5);
  }

  outColor = vec4(mix(sceneColor, finalFogColor, fogFactor), 1.0);
}
`;

// CAS — Contrast Adaptive Sharpening (AMD FidelityFX, fragment-shader port).
// 4-neighbor Laplacian edge enhancement with contrast-adaptive weight +
// min/max clamp to prevent haloing. Runs after TAA to restore detail.
// 参考: AMD FidelityFX-CAS, o3de Atom SharpenPass.
export const CAS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_screenSize;
uniform float u_sharpness; // 0..1, 0 = passthrough

void main() {
  vec3 b = texture(u_colorMap, v_uv).rgb;

  if (u_sharpness <= 0.0) {
    outColor = vec4(b, 1.0);
    return;
  }

  vec2 t = 1.0 / u_screenSize;

  // 4-neighbor cross
  vec3 n = texture(u_colorMap, v_uv + vec2(0.0, -t.y)).rgb;
  vec3 s = texture(u_colorMap, v_uv + vec2(0.0,  t.y)).rgb;
  vec3 w = texture(u_colorMap, v_uv + vec2(-t.x, 0.0)).rgb;
  vec3 e = texture(u_colorMap, v_uv + vec2( t.x, 0.0)).rgb;

  // Laplacian (edge detector): sum of neighbors - 4 * center
  vec3 lap = n + s + w + e - 4.0 * b;

  // Local contrast range (5-tap min/max including center)
  vec3 mn = min(min(n, s), min(w, e));
  mn = min(mn, b);
  vec3 mx = max(max(n, s), max(w, e));
  mx = max(mx, b);
  vec3 rng = mx - mn;

  // Adaptive weight: strong sharpening where contrast is LOW (detail areas),
  // weak where contrast is HIGH (edges — prevents haloing).
  // peak ∈ [5, 8] for sharpness ∈ [1, 0].
  float peak = 8.0 - 3.0 * u_sharpness;
  vec3 wgt = peak / (rng * 4.0 + 1.0);

  // Sharpened = center + weight * laplacian * sharpness
  vec3 sharp = b + lap * wgt * u_sharpness * 0.25;

  // Clamp to neighborhood range — the key CAS anti-overshoot step.
  sharp = clamp(sharp, mn, mx);

  outColor = vec4(sharp, 1.0);
}
`;

// FSR EASU — Edge-Adaptive Spatial Upsampling (AMD FidelityFX FSR1 适配)。
// 9-tap 双边加权双线性上采样:用 luma 梯度检测边缘,在边缘处按 luma 相似度
// 调制 4 角权重,避免跨边缘混合导致的模糊。平滑区域使用标准双线性。
//
// 管线:EASU(本 Pass,低→高分辨率) → RCAS(SharpenPass,高分辨率锐化)。
// 输入:低分辨率颜色纹理。输出:高分辨率上采样纹理。
// 参考:AMD FidelityFX-FSR1 (MIT),o3de Atom UpscalingPass。
export const FSR_EASU_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform vec2 u_inputSize;      // 低分辨率输入尺寸
uniform vec2 u_invInputSize;   // 1.0 / u_inputSize

void main() {
  // 将输出 UV 映射到输入纹理空间(带亚像素偏移)
  vec2 pos = v_uv * u_inputSize - 0.5;
  vec2 ip = floor(pos);
  vec2 f = pos - ip;  // 亚像素分数 [0,1)
  vec2 tc = (ip + 0.5) * u_invInputSize;
  vec2 off = u_invInputSize;

  // 3x3 邻域(9 taps)
  vec3 tl = texture(u_colorMap, tc + vec2(-off.x, -off.y)).rgb;
  vec3 tm = texture(u_colorMap, tc + vec2(  0.0,  -off.y)).rgb;
  vec3 tr = texture(u_colorMap, tc + vec2( off.x, -off.y)).rgb;
  vec3 ml = texture(u_colorMap, tc + vec2(-off.x,   0.0 )).rgb;
  vec3 mm = texture(u_colorMap, tc).rgb;
  vec3 mr = texture(u_colorMap, tc + vec2( off.x,   0.0 )).rgb;
  vec3 bl = texture(u_colorMap, tc + vec2(-off.x,  off.y)).rgb;
  vec3 bm = texture(u_colorMap, tc + vec2(  0.0,   off.y)).rgb;
  vec3 br = texture(u_colorMap, tc + vec2( off.x,  off.y)).rgb;

  // Rec. 601 luma(边缘检测)
  vec3 LUMA = vec3(0.299, 0.587, 0.114);
  float ltl = dot(tl, LUMA), ltr = dot(tr, LUMA);
  float lbl = dot(bl, LUMA), lbr = dot(br, LUMA);
  float lml = dot(ml, LUMA), lmr = dot(mr, LUMA);
  float ltm = dot(tm, LUMA), lbm = dot(bm, LUMA);
  float lmm = dot(mm, LUMA);

  // 标准双线性(平滑区域)
  vec3 bilerp = mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y);

  // 边缘检测:水平 & 垂直 luma 梯度
  float dH = abs(ltl + lbl - ltr - lbr) + 2.0 * abs(lmr - lml);
  float dV = abs(ltl + ltr - lbl - lbr) + 2.0 * abs(ltm - lbm);
  float edgeStrength = min((dH + dV) * 0.5, 1.0);

  // 边缘感知加权双线性:用 luma 相似度调制 4 角权重。
  // 边缘另一侧的角点获得低权重,防止跨边缘模糊(双边滤波思想)。
  float sigma = 0.15;
  float wTL = exp(-abs(ltl - lmm) / sigma) * (1.0 - f.x) * (1.0 - f.y);
  float wTR = exp(-abs(ltr - lmm) / sigma) *  f.x        * (1.0 - f.y);
  float wBL = exp(-abs(lbl - lmm) / sigma) * (1.0 - f.x) *  f.y;
  float wBR = exp(-abs(lbr - lmm) / sigma) *  f.x        *  f.y;
  float wSum = wTL + wTR + wBL + wBR + 1e-6;
  vec3 edgeAware = (tl * wTL + tr * wTR + bl * wBL + br * wBR) / wSum;

  // 混合:平滑区域 → 双线性,边缘 → 边缘感知
  vec3 result = mix(bilerp, edgeAware, edgeStrength);

  outColor = vec4(result, 1.0);
}
`;

// ── Caustics ──────────────────────────────────────────────────────
// 水下焦散 fragment shader — 屏幕空间深度重建 + 程序化波纹焦散。
//
// 算法(参考 GPU Gems 2 "Effective Water Simulation" + o3de Atom Water):
//   1. 从 u_depthMap 重建世界位置(逆 viewProjection);
//   2. 若 worldPos.y > waterLevel(水面以上)或深度=1.0(天空)→ 跳过;
//   3. 深度衰减 depthAtten = 1/(1 + depthBelow * absorption)(Beer-Lambert);
//   4. 程序化焦散图案:三组方向各异的正弦波叠加,三次方增强亮带
//      (模拟水面折射光能聚焦),支持 RGB 色散偏移(波长差异);
//   5. 合成:outColor = sceneColor + causticColor * intensity * depthAtten。
//
// 输入纹理:
//   - u_colorMap : 当前帧场景颜色
//   - u_depthMap : NDC 深度
//
// 参考:
//   - GPU Gems 2, Ch. 18 "Effective Water Simulation from Physical Models"
//   - o3de Atom Water highlights / caustics pass
//   - ShaderToy "Caustic" by Dave_Hoskins
export const CAUSTICS_FRAG = /* glsl */ `#version 300 es
precision highp float;

// 水下焦散 — 屏幕空间深度重建 + 程序化波纹焦散
// 参考: GPU Gems 2 Ch.18 "Effective Water Simulation" / o3de Atom Water

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;          // 场景颜色
uniform sampler2D u_depthMap;          // NDC 深度

uniform mat4  u_inverseViewProjection; // NDC → 世界
uniform vec3  u_cameraPos;
uniform vec2  u_screenSize;

uniform vec3  u_causticColor;          // 焦散颜色(默认青蓝)
uniform float u_causticIntensity;      // 强度(默认 0.6)
uniform float u_waterLevel;            // 水面高度(世界 Y)
uniform float u_worldScale;            // 世界→UV 缩放(默认 8)
uniform float u_waveSpeed;             // 波纹速度(默认 0.8)
uniform float u_waveFrequency;         // 波纹频率(默认 8)
uniform float u_wavePhase;             // 相位偏移(默认 0)
uniform float u_absorption;            // 深度吸收率(默认 0.02)
uniform float u_dispersion;            // RGB 色散偏移(默认 0.3)
uniform float u_power;                 // 聚焦幂(默认 3.0,越大亮带越锐利)
uniform float u_time;                  // 时间(秒)
uniform int   u_enabled;               // 0=禁用,1=启用

// 三组方向各异的正弦波,模拟水面折射后的光能聚焦
// p: 世界 XZ 平面 UV(已缩放); power: 聚焦幂,>1 增强亮带(模拟焦散)
float causticPattern(vec2 p, float power) {
  float t = u_time * u_waveSpeed;
  float f = u_waveFrequency;
  // 三组方向(30° / 120° / -60°),覆盖均匀
  float w1 = sin(dot(p, vec2( 0.8660,  0.5000)) * f + t * 1.3);
  float w2 = sin(dot(p, vec2(-0.5000,  0.8660)) * f + t * 1.7);
  float w3 = sin(dot(p, vec2( 0.5000, -0.8660)) * f + t * 0.9);
  float s = (w1 + w2 + w3) / 3.0;            // [-1, 1]
  // 仅保留正瓣并幂增强(光线聚焦处更亮)
  return pow(max(0.0, s), power);
}

void main() {
  vec3 sceneColor = texture(u_colorMap, v_uv).rgb;

  if (u_enabled == 0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // 天空(远裁面)无焦散
  float depth = texture(u_depthMap, v_uv).r;
  if (depth >= 1.0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // 重建世界位置
  vec4 worldPosH = u_inverseViewProjection * vec4(v_uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 worldPos = worldPosH.xyz / worldPosH.w;

  // 仅水面以下应用焦散
  if (worldPos.y > u_waterLevel) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // 深度衰减:越深焦散越弱(Beer-Lambert 近似)
  float depthBelow = u_waterLevel - worldPos.y;
  float depthAtten = 1.0 / (1.0 + depthBelow * u_absorption);

  // 焦散图案(世界 XZ 投影 + 相位偏移)
  vec2 causticUV = worldPos.xz / u_worldScale + vec2(u_wavePhase);

  // RGB 色散:每通道用略有偏移的 UV,模拟波长差异折射
  float causticR = causticPattern(causticUV + vec2( u_dispersion * 0.5, 0.0), u_power);
  float causticG = causticPattern(causticUV, u_power);
  float causticB = causticPattern(causticUV + vec2(-u_dispersion * 0.5, 0.0), u_power);
  vec3 caustic = vec3(causticR, causticG, causticB);

  // 加性合成
  vec3 causticColor = u_causticColor * caustic * u_causticIntensity * depthAtten;
  outColor = vec4(sceneColor + causticColor, 1.0);
}
`;

// ── Water Surface ─────────────────────────────────────────────────
// 屏幕空间平面水面 fragment shader — 射线-平面求交 + Gerstner 波 + Fresnel。
//
// 算法(参考 GPU Gems 1 Ch.9 "Effective Water Simulation" + o3de Atom Water):
//   1. 从 depth 重建场景世界位置 + 相机射线方向;
//   2. 射线与水面平面 y=waterLevel 求交得 tHit;
//      - tHit < 0:平面在相机后方 → 不画水;
//      - tHit >= sceneDist:几何在水面之前 → 不画水(几何遮挡水面);
//   3. 在交点 XZ 计算 Gerstner 波叠加(4 组方向)得位移 height + 法线(有限差分);
//   4. Schlick Fresnel:由视角-法线夹角决定反射/折射混合比;
//   5. 反射:沿反射方向采样天空渐变(skyColor → horizonColor);
//      折射:偏移 UV 采样场景色,叠加水深吸收(waterColor * absorption);
//   6. 太阳 Blinn-Phong 镜面高光;
//   7. 合成:color = mix(refraction, reflection, fresnel) + sunSpecular。
//
// 输入纹理:
//   - u_colorMap : 当前帧场景颜色(折射源 + 反射 fallback)
//   - u_depthMap : NDC 深度
//
// 参考:
//   - GPU Gems 1, Ch. 9 "Effective Water Simulation from Physical Models"
//   - o3de Atom Water surface pass
//   - Schlick (1994) Fresnel approximation
export const WATER_SURFACE_FRAG = /* glsl */ `#version 300 es
precision highp float;

// 屏幕空间平面水面 — 射线-平面求交 + Gerstner 波 + Schlick Fresnel
// 参考: GPU Gems 1 Ch.9 / o3de Atom Water

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;          // 场景颜色(折射源 + 反射 fallback)
uniform sampler2D u_depthMap;          // NDC 深度

uniform mat4  u_inverseViewProjection; // NDC → 世界
uniform vec3  u_cameraPos;
uniform vec2  u_screenSize;

uniform float u_waterLevel;            // 水面高度(世界 Y)
uniform vec3  u_waterColor;            // 深水颜色(吸收色)
uniform vec3  u_skyColor;              // 天顶颜色(反射)
uniform vec3  u_horizonColor;          // 地平线颜色(反射渐变)
uniform vec3  u_sunDirection;          // 太阳方向(归一化,指向太阳)
uniform vec3  u_sunColor;              // 太阳颜色
uniform float u_sunSpecular;           // 太阳镜面强度
uniform float u_sunShininess;          // Blinn-Phong shininess

uniform float u_waveTime;              // 时间(秒)
uniform float u_waveAmplitude;         // 波幅(默认 0.3)
uniform float u_waveFrequency;         // 波频率(默认 0.1)
uniform float u_waveSpeed;             // 波速(默认 1.0)
uniform float u_fresnelPower;          // Fresnel 幂(默认 5.0)
uniform float u_fresnelBias;           // Fresnel 偏移(默认 0.02)
uniform float u_refractionOffset;      // 折射 UV 偏移强度(默认 0.01)
uniform float u_absorption;            // 水深吸收率(默认 0.05)
uniform int   u_enabled;               // 0=禁用,1=启用

#define PI 3.14159265359

// 4 组波方向(归一化),覆盖均匀
const vec2 WAVE_DIRS[4] = vec2[4](
  vec2( 1.0, 0.0),
  vec2( 0.7, 0.7),
  vec2( 0.0, 1.0),
  vec2(-0.7, 0.7)
);

// Gerstner 波高度(垂直位移)叠加 — 4 组方向
// pos: 世界 XZ;返回累积波高(已乘振幅)
float waveHeight(vec2 pos) {
  float t = u_waveTime * u_waveSpeed;
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 d = normalize(WAVE_DIRS[i]);
    float phase = dot(d, pos) * u_waveFrequency + t * (1.0 + float(i) * 0.27);
    h += sin(phase) * u_waveAmplitude / (1.0 + float(i));
  }
  return h;
}

// 有限差分法线(中心差分)
vec3 waveNormal(vec2 pos) {
  float eps = 1.0 / u_waveFrequency * 0.25;
  float hL = waveHeight(pos - vec2(eps, 0.0));
  float hR = waveHeight(pos + vec2(eps, 0.0));
  float hD = waveHeight(pos - vec2(0.0, eps));
  float hU = waveHeight(pos + vec2(0.0, eps));
  vec3 n = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
  return n;
}

// Schlick Fresnel 近似
float fresnelSchlick(float cosTheta, float bias, float power) {
  return bias + (1.0 - bias) * pow(1.0 - max(cosTheta, 0.0), power);
}

void main() {
  vec3 sceneColor = texture(u_colorMap, v_uv).rgb;

  if (u_enabled == 0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // 重建场景世界位置 + 距离
  float depth = texture(u_depthMap, v_uv).r;
  vec4 sceneNDC = vec4(v_uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 sceneWorldH = u_inverseViewProjection * sceneNDC;
  vec3 sceneWorldPos = sceneWorldH.xyz / sceneWorldH.w;
  float sceneDist = length(sceneWorldPos - u_cameraPos);

  // 相机射线方向(用远裁面 NDC 重建以处理天空像素)
  vec4 farNDC = vec4(v_uv * 2.0 - 1.0, 1.0, 1.0);
  vec4 farWorldH = u_inverseViewProjection * farNDC;
  vec3 rayDir = normalize(farWorldH.xyz / farWorldH.w - u_cameraPos);

  // 射线-平面求交:y = waterLevel
  if (abs(rayDir.y) < 1e-6) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }
  float tHit = (u_waterLevel - u_cameraPos.y) / rayDir.y;
  if (tHit < 0.0) {
    // 水面在相机后方
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // 几何遮挡:若几何在水面之前(sceneDist < tHit),不画水
  // (天空像素 depth>=1.0 → sceneDist 极大 → 不遮挡)
  if (depth < 1.0 && sceneDist < tHit) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // 水面交点(加波高微扰)
  vec3 waterPos = u_cameraPos + rayDir * tHit;
  float h = waveHeight(waterPos.xz);
  waterPos.y += h;
  vec3 normal = waveNormal(waterPos.xz);

  // 视线方向(从水面指向相机)
  vec3 viewDir = normalize(u_cameraPos - waterPos);

  // ── Fresnel ──────────────────────────────────────────────────
  float cosTheta = clamp(dot(viewDir, normal), 0.0, 1.0);
  float fresnel = fresnelSchlick(cosTheta, u_fresnelBias, u_fresnelPower);

  // ── 反射:沿反射方向采样天空渐变 ────────────────────────────
  vec3 reflectDir = reflect(-rayDir, normal);
  float skyT = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 reflection = mix(u_horizonColor, u_skyColor, skyT);

  // ── 折射:偏移 UV 采样场景色 + 水深吸收 ─────────────────────
  // 水下几何(sceneWorldPos.y < waterLevel)的深度 → 吸收着色
  vec2 refractUV = v_uv + normal.xz * u_refractionOffset;
  vec3 refractionColor = texture(u_colorMap, refractUV).rgb;

  float depthBelow = max(0.0, u_waterLevel - sceneWorldPos.y);
  float absorb = 1.0 - exp(-depthBelow * u_absorption);
  vec3 refraction = mix(refractionColor, u_waterColor, absorb);

  // ── 太阳 Blinn-Phong 镜面 ───────────────────────────────────
  vec3 halfDir = normalize(u_sunDirection + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), u_sunShininess);
  vec3 specular = u_sunColor * spec * u_sunSpecular;

  // ── 合成 ────────────────────────────────────────────────────
  vec3 waterColor = mix(refraction, reflection, fresnel) + specular;
  outColor = vec4(waterColor, 1.0);
}
`;

// ── Volumetric Clouds ─────────────────────────────────────────────
// GPU ray-marched 体积云 fragment shader — 与 VolumetricClouds 数据层
// (src/engine/Environment/VolumetricClouds.ts) 配套。
//
// 算法(对标 UE5 Volumetric Clouds / Horizon Zero Dawn "Nubis" 2015):
//   1. 从像素世界方向重建相机射线(逆 viewProjection)
//   2. 与云层 AABB [cloudHeight, cloudHeight+cloudThickness] 求交,
//      得到 tEnter / tExit
//   3. 沿射线等距采样 steps 次:
//      a. 世界位置 → UVW(归一化 + 风偏移) → 采样 3D 噪声纹理
//      b. 高度密度调制(底部浓密、顶部羽化)
//      c. 覆盖度调制(coverage 越高密度越大)
//      d. 若密度 <= 阈值跳过(空跳优化)
//   4. 沿太阳方向 shadow march shadowSteps 次累积光学深度 τ:
//      a. Beer-Lambert:           beer    = exp(-τ)
//      b. Beer-Powder (Bouthors): powder  = 1 - exp(-2τ)
//         combined = beer * (1 - 0.5*powder) + 0.5 * powder * beer
//      c. 多散射近似 (Wenzel 2019):
//         L_ms = (1 - exp(-τ·msFactor)) * Σ exp(-τ·msFactor/msSteps)
//   5. 双叶 Henyey-Greenstein 相位函数:
//      phase = lerp(HG(g1, cosθ), HG(g2, cosθ), 1 - forwardWeight)
//      cosθ = dot(viewDir, sunDir)
//   6. 前向合成:scatter = (1 - stepTransmittance) * transmittance
//      color += scatter * (ambient * ambientFactor + sunColor * (beerPowder + msEnergy) * phase)
//      transmittance *= stepTransmittance
//      早期终止:transmittance < 0.01
//   7. 合成到 sceneColor:
//      finalColor = mix(sceneColor, cloudColor, 1 - transmittance)
//
// 输入纹理:
//   - u_colorMap  : 当前帧场景颜色 (RGBA8/RGBA16F)
//   - u_depthMap  : NDC 深度 (0..1,用于早期云前不透明物剔除)
//   - u_noiseMap  : 3D 噪声密度场 (R8/R16F, sampler3D)
//
// 参考:
//   - Schneider & Vosin "Volumetric Clouds" (Horizon Zero Dawn, SIGGRAPH 2015)
//   - Wenzel 2019 "Real-time Global Illumination with Photon Mapping"
//   - Bouthors 2008 "Real-Time Realistic Atmospheric Scattering"
//   - UE5 Volumetric Clouds plugin
//   - o3de Atom SkyAtmosphere + Clouds pass
export const VOLUMETRIC_CLOUDS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;          // 场景颜色
uniform sampler2D u_depthMap;          // NDC 深度
uniform sampler3D u_noiseMap;          // 3D 噪声密度场 (sampler3D)

uniform mat4  u_inverseViewProjection; // NDC → 世界
uniform vec3  u_cameraPos;             // 相机世界位置
uniform vec2  u_screenSize;

uniform vec3  u_cloudColor;            // 云基础颜色
uniform float u_cloudCoverage;         // 覆盖度 [0,1]
uniform float u_cloudDensity;          // 密度倍率
uniform float u_cloudHeight;           // 云层底部高度
uniform float u_cloudThickness;        // 云层厚度
uniform vec3  u_windOffset;            // 风偏移(世界空间累积)
uniform float u_worldScale;            // 世界→UVW 缩放(默认 1024)

uniform vec3  u_ambientColor;          // 环境光(云中阴影色)
uniform vec3  u_sunColor;              // 太阳颜色
uniform vec3  u_sunDirection;          // 太阳方向(归一化,指向太阳)

uniform int   u_steps;                 // 主光线步进数(默认 64)
uniform int   u_shadowSteps;           // 阴影步进数(默认 16)
uniform float u_shadowStepLen;         // 阴影步长(世界单位,默认 8)

uniform float u_multiScatteringFactor; // 多散射强度(0..1)
uniform int   u_multiScatteringSteps;  // 多散射近似步数
uniform float u_hgForwardG;            // 前向 HG g (0..0.99)
uniform float u_hgBackwardG;           // 后向 HG g (-0.99..0)
uniform float u_hgForwardWeight;       // 前向权重(0..1)
uniform float u_heightDensityBottom;   // 底部密度衰减(0..1)
uniform float u_heightDensityTop;      // 顶部密度衰减(0..1)
uniform float u_coneRadius;            // 锥形阴影半径(0=点采样)
uniform float u_densityCutoff;         // 密度跳过阈值(默认 0.01)

uniform int   u_enabled;               // 0=禁用,1=启用

// ── v3 时序累积(blue-noise 抖动 + EMA 重投影)──────────────────────
uniform sampler2D u_historyMap;        // 上一帧合成结果(时序累积源)
uniform mat4  u_prevViewProjection;    // 上一帧 VP(world → NDC,重投影用)
uniform float u_temporalBlend;         // 时序 EMA 系数 [0,0.95):0=禁用
uniform int   u_frameIndex;            // 帧序号(IGN 动画 + 时序)
uniform int   u_hasHistory;            // 0=首帧/resize 后无历史,1=有历史

#define PI 3.14159265359

float clamp01(float x) { return clamp(x, 0.0, 1.0); }

float smoothstep01(float e0, float e1, float x) {
  float t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3.0 - 2.0 * t);
}

// Interleaved Gradient Noise (Jimenez 2014) — 蓝噪声近似,无纹理依赖
// 抖动光线起始位置 → 打散步进 banding,配合时序 EMA 收敛
float ign(vec2 px, int frame) {
  px += vec2(float(frame) * 47.0, float(frame) * 17.0) * 0.695;
  return fract(52.9829189 * fract(0.06711056 * px.x + 0.005837 * px.y));
}

// Henyey-Greenstein 相位函数
float hg(float g, float cosTheta) {
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * pow(max(denom, 1e-6), 1.5));
}

// 双叶 HG:lerp(HG(g1, cosθ), HG(g2, cosθ), 1 - forwardWeight)
float dualLobedHG(float cosTheta) {
  float forward = hg(u_hgForwardG, cosTheta);
  float backward = hg(u_hgBackwardG, cosTheta);
  return mix(forward, backward, 1.0 - u_hgForwardWeight);
}

// 采样云密度(世界坐标 → UVW + 风偏移 + 高度密度调制)
float sampleCloudDensity(vec3 worldPos) {
  float yBottom = u_cloudHeight;
  float yTop = u_cloudHeight + u_cloudThickness;
  if (worldPos.y < yBottom || worldPos.y > yTop) return 0.0;

  // 归一化 UVW (X/Z 环绕,Y 在 [0,1])
  vec3 uvw;
  uvw.x = (worldPos.x + u_windOffset.x) / u_worldScale;
  uvw.y = (worldPos.y - yBottom) / u_cloudThickness;
  uvw.z = (worldPos.z + u_windOffset.z) / u_worldScale;

  float noise = texture(u_noiseMap, uvw).r;

  // 覆盖度调制
  float coverageFactor = 1.0 - (1.0 - u_cloudCoverage) * (1.0 - u_cloudCoverage);

  // 高度密度调制
  float heightT = clamp01((worldPos.y - yBottom) / u_cloudThickness);
  float bottomAtten = 1.0 - u_heightDensityBottom * (1.0 - smoothstep01(0.0, 0.2, heightT));
  float topAtten    = 1.0 - u_heightDensityTop    * smoothstep01(0.6, 1.0, heightT);

  return clamp01(noise * coverageFactor * bottomAtten * topAtten);
}

// 沿太阳方向累积光学深度 (可选锥形扩散)
float marchShadowOpticalDepth(vec3 pos) {
  float opticalDepth = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i >= u_shadowSteps) break;
    float t = float(i + 1) * u_shadowStepLen;
    vec3 sp = pos + u_sunDirection * t;
    if (u_coneRadius > 0.0) {
      // 锥形扩散(黄金角分布,时序去条带)
      float angle = float(i) * 2.39996323;
      float radius = u_coneRadius * t * 0.1;
      sp += vec3(cos(angle) * radius, sin(angle) * radius, 0.0);
    }
    opticalDepth += sampleCloudDensity(sp) * u_cloudDensity * u_shadowStepLen * 0.01;
  }
  return opticalDepth;
}

void main() {
  vec3 sceneColor = texture(u_colorMap, v_uv).rgb;

  if (u_enabled == 0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // 从深度重建世界位置(用于早期云前不透明物 → 不画云)
  float depth = texture(u_depthMap, v_uv).r;
  vec4 worldPosH = u_inverseViewProjection * vec4(v_uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 hitWorldPos = worldPosH.xyz / worldPosH.w;
  float sceneDist = length(hitWorldPos - u_cameraPos);

  // 构建相机射线方向
  // 远裁面用 depth=1.0 → 视为天空方向
  vec3 rayDir;
  if (depth >= 1.0) {
    // 天空:用远裁面中心方向构造射线
    vec4 skyH = u_inverseViewProjection * vec4(v_uv * 2.0 - 1.0, 1.0, 1.0);
    rayDir = normalize(skyH.xyz / skyH.w - u_cameraPos);
  } else {
    rayDir = normalize(hitWorldPos - u_cameraPos);
  }

  // 与云层 [yBottom, yTop] 求交
  float yBottom = u_cloudHeight;
  float yTop = u_cloudHeight + u_cloudThickness;
  float tEnter, tExit;
  if (abs(rayDir.y) < 1e-6) {
    // 水平射线:若已在云层中则贯穿,否则无云
    if (u_cameraPos.y < yBottom || u_cameraPos.y > yTop) {
      outColor = vec4(sceneColor, 1.0);
      return;
    }
    tEnter = 0.0;
    tExit = 10000.0;
  } else {
    float tToBottom = (yBottom - u_cameraPos.y) / rayDir.y;
    float tToTop = (yTop - u_cameraPos.y) / rayDir.y;
    tEnter = min(tToBottom, tToTop);
    tExit  = max(tToBottom, tToTop);
    if (tExit <= 0.0) {
      outColor = vec4(sceneColor, 1.0);
      return;
    }
    tEnter = max(tEnter, 0.0);
    if (tExit <= tEnter) {
      outColor = vec4(sceneColor, 1.0);
      return;
    }
  }

  // 不透明物在云层前 → 不画云
  if (sceneDist < tEnter && depth < 1.0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }
  // 不透明物在云层中 → 截断 tExit
  if (depth < 1.0 && sceneDist < tExit) {
    tExit = sceneDist;
  }

  // 光线步进
  int n = max(1, u_steps);
  float stepLen = (tExit - tEnter) / float(n);
  vec3 viewDir = -rayDir;
  float cosTheta = clamp01(dot(viewDir, u_sunDirection));
  float phase = dualLobedHG(cosTheta);

  // Blue-noise 抖动:每像素每帧偏移采样位置,打散步进 banding
  // (单帧为高频噪点,时序 EMA 累积后收敛为平滑结果)
  float jitter = ign(gl_FragCoord.xy, u_frameIndex) - 0.5;  // [-0.5, 0.5]

  float transmittance = 1.0;
  vec3 accumColor = vec3(0.0);

  for (int i = 0; i < 512; i++) {
    if (i >= n) break;
    float t = tEnter + stepLen * (float(i) + 0.5 + jitter);
    vec3 p = u_cameraPos + rayDir * t;

    float density = sampleCloudDensity(p);
    if (density <= u_densityCutoff) continue;

    float extinction = density * u_cloudDensity * stepLen * 0.01;
    float stepTransmittance = exp(-extinction);

    // 阴影 march
    float opticalDepth = marchShadowOpticalDepth(p);
    float beer = exp(-opticalDepth);
    float powder = 1.0 - exp(-2.0 * opticalDepth);
    float beerPowder = beer * (1.0 - 0.5 * powder) + 0.5 * powder * beer;

    // 多散射近似 (Wenzel 2019)
    float msEnergy = 0.0;
    if (u_multiScatteringFactor > 0.0) {
      float msTau = opticalDepth * u_multiScatteringFactor;
      int msN = max(1, u_multiScatteringSteps);
      float term = 1.0;
      float sum = 0.0;
      for (int j = 0; j < 16; j++) {
        if (j >= msN) break;
        sum += term;
        term *= exp(-msTau / float(msN));
      }
      msEnergy = (1.0 - exp(-msTau)) * sum / float(msN);
    }

    // 合成光照
    float ambientFactor = clamp01(1.0 - density * 0.5);
    vec3 ambient = u_ambientColor * ambientFactor;
    vec3 sunLight = u_sunColor * (beerPowder + msEnergy) * phase;
    vec3 lighting = u_cloudColor * (ambient + sunLight);

    float scatter = (1.0 - stepTransmittance) * transmittance;
    accumColor += scatter * lighting;
    transmittance *= stepTransmittance;

    if (transmittance < 0.01) break;
  }

  // 与场景颜色合成 (云覆盖在场景之上)
  float cloudAlpha = clamp01(1.0 - transmittance);
  vec3 finalColor = mix(sceneColor, accumColor + sceneColor * transmittance, cloudAlpha);

  // ── v3 时序累积:重投影 + EMA ──────────────────────────────────
  // 把当前像素世界位置重投影到上一帧 NDC,采样历史帧并指数加权平均
  // (blue-noise 抖动产生的高频噪点经 EMA 收敛为平滑结果,等效 10x 步进数)
  vec3 outRgb = finalColor;
  if (u_temporalBlend > 0.0 && u_hasHistory == 1) {
    vec4 prevNDC = u_prevViewProjection * vec4(hitWorldPos, 1.0);
    vec2 prevUV = (prevNDC.xy / prevNDC.w) * 0.5 + 0.5;
    // 重投影 UV 越界 → 视为遮挡断裂,丢弃历史
    if (all(greaterThanEqual(prevUV, vec2(0.0))) && all(lessThanEqual(prevUV, vec2(1.0)))) {
      vec3 histColor = texture(u_historyMap, prevUV).rgb;
      outRgb = mix(finalColor, histColor, u_temporalBlend);
    }
  }

  outColor = vec4(outRgb, 1.0);
}
`;

// ── God Rays (Volumetric Light Shafts) ─────────────────────────────
// 屏幕空间体积光束(crepuscular rays)— 单 pass 径向采样后处理。
//
// 算法(Sekulic 2004 / GPU Gems 3 Ch.13 "Volumetric Light Scattering in
// Post-Space" / o3de Atom volumetric rays):
//   1. 把光源世界位置投影到 NDC → lightScreenUV;
//   2. 若光源在相机后方(clip w <= 0)→ 直接输出场景色,跳过;
//   3. 对每个像素,沿 像素UV → lightScreenUV 方向径向步进 samples 次;
//   4. 每步:
//      a. 采样场景色 → 提取亮度(threshold)作为光束贡献源;
//      b. 采样深度 → 几何遮挡(深度 < 1.0 的前景几何阻挡光束);
//      c. contribution = lightMask * illuminationDecay * occlusion;
//      d. accumulated += contribution;
//      e. illuminationDecay *= decay(指数衰减,越远越弱);
//   5. rays = accumulated * exposure * lightColor * intensity;
//   6. outColor = sceneColor + rays(加性合成)。
//
// 输入纹理:
//   - u_colorMap : 当前帧场景颜色(HDR)
//   - u_depthMap : NDC 深度(0..1,用于遮挡判定)
//
// 与 VolumetricFogPass 的区别:
//   * VolumetricFogPass 是完整 ray-march 体积雾(含参与介质散射),开销大;
//   * GodRaysPass 是屏幕空间径向模糊,仅模拟光束散射外观,~10x 便宜;
//   * 二者可共存:GodRaysPass 作廉价 fallback 或与体积雾叠加增强光束。
//
// 参考:
//   - GPU Gems 3, Ch.13 "Volumetric Light Scattering in Post-Space" (Sekulic)
//   - o3de Atom, Volumetric rays pass
//   - Mittring 2007 "Finding Next Gen — CryEngine 2" (light shafts)
export const GOD_RAYS_FRAG = /* glsl */ `#version 300 es
precision highp float;

// 屏幕空间体积光束(crepuscular rays)— 径向采样 + 深度遮挡
// 参考: GPU Gems 3 Ch.13 / o3de Atom

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;          // 场景颜色(HDR)
uniform sampler2D u_depthMap;          // NDC 深度(0..1)

uniform mat4  u_viewProjection;        // 世界 → NDC(投影光源)
uniform vec3  u_lightPosition;         // 光源世界位置
uniform vec3  u_lightColor;            // 光束颜色
uniform float u_lightIntensity;        // 光束强度

uniform int   u_samples;               // 径向采样数(默认 80)
uniform float u_decay;                 // 指数衰减率(默认 0.96)
uniform float u_exposure;              // 曝光(默认 0.5)
uniform float u_density;               // 步进密度(默认 1.0)
uniform float u_threshold;             // 亮度阈值,提取光束源(默认 0.8)
uniform float u_maxDepth;              // 前景遮挡深度阈值(默认 0.99,>=此值视为天空)
uniform int   u_enabled;               // 0=禁用,1=启用

#define PI 3.14159265359

// 提取亮度(luminance),高于 threshold 的部分作为光束贡献
float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec3 sceneColor = texture(u_colorMap, v_uv).rgb;

  if (u_enabled == 0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // ── 投影光源到 NDC ─────────────────────────────────────────────
  vec4 lightClip = u_viewProjection * vec4(u_lightPosition, 1.0);
  // 光源在相机后方(裁剪空间 w <= 0)→ 光束不可见,直接输出场景
  if (lightClip.w <= 0.0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }
  vec3 lightNDC = lightClip.xyz / lightClip.w;
  vec2 lightScreenUV = lightNDC.xy * 0.5 + 0.5;

  // ── 径向采样参数 ───────────────────────────────────────────────
  // delta = (lightScreenUV - pixelUV) * density / samples
  // 从像素向光源方向步进
  vec2 deltaTexCoord = (lightScreenUV - v_uv) * u_density;
  deltaTexCoord *= 1.0 / float(u_samples);

  // 边界 clamp:防止采样 UV 跑出 [0,1] 产生接缝(用 texel fetch 行为)
  // 这里不做硬 clamp,让衰减自然处理边界(超出区域纹理边框采样)

  vec2 sampleUV = v_uv;
  float illuminationDecay = 1.0;
  vec3 accumulated = vec3(0.0);

  // ── 径向累积(手动循环展开上限 256,实际由 u_samples 控制) ────
  // GLSL ES 3.0 要求循环上界为常量,用 MAX_SAMPLES 作上界,内部 break
  const int MAX_SAMPLES = 256;
  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= u_samples) break;

    sampleUV += deltaTexCoord;

    // 采样场景色 + 深度
    vec3 sampleColor = texture(u_colorMap, sampleUV).rgb;
    float sampleDepth = texture(u_depthMap, sampleUV).r;

    // 亮度阈值提取:仅亮度 > threshold 的部分作为光束源(太阳盘 + 亮天空)
    float lum = luminance(sampleColor);
    float lightMask = max(0.0, lum - u_threshold);

    // 深度遮挡:前景几何(depth < maxDepth)阻挡光束,天空放行
    // depth >= maxDepth 视为天空/无穷远 → occlusion = 1(光通过)
    // depth <  maxDepth 视为前景几何    → occlusion = 0(光被挡)
    float occlusion = step(u_maxDepth, sampleDepth);

    // 累积(指数衰减 + 遮挡)
    accumulated += sampleColor * lightMask * illuminationDecay * occlusion;
    illuminationDecay *= u_decay;
  }

  // ── 合成 ───────────────────────────────────────────────────────
  vec3 rays = accumulated * u_exposure * u_lightColor * u_lightIntensity;
  outColor = vec4(sceneColor + rays, 1.0);
}
`;

export const LENS_FLARE_FRAG = /* glsl */ `#version 300 es
precision highp float;

// 屏幕空间镜头光晕(Screen-Space Lens Flare)
// 参考: Jorge Jimenez 2014 "Next Generation Post Processing in CoD:AW"
//       Madsen 2011 "Real-Time Lens Flare" / Unity HDRP / o3de Atom
//
// 特性:
//   - 多重 ghost 重影(沿光源→屏幕中心轴,带 RGB 色散)
//   - 环形 halo 光晕(围绕光源的环形高斯)
//   - 星芒 starburst(围绕光源的多射线叠加)
//   - 全局衰减(距光源越远越暗)
//   - 屏幕外淡出(光源移出屏幕时光晕渐隐)
//   - 深度遮挡(前景几何挡住光晕)
//
// 与 GodRaysPass 的区别:
//   * GodRaysPass 模拟大气散射光束(crepuscular rays),需径向步进采样;
//   * LensFlarePass 模拟镜头玻璃内部反射产生的重影/光环/星芒,
//     单次采样合成,~5x 便宜,适合电影级镜头表现。
//   * 二者可共存:GodRays 给光束,LensFlare 给镜头质感。

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;          // 场景颜色(HDR)
uniform sampler2D u_depthMap;          // NDC 深度(0..1)

uniform mat4  u_viewProjection;        // 世界 → NDC(投影光源)
uniform vec3  u_lightPosition;         // 光源世界位置
uniform vec3  u_lightColor;            // 光晕颜色
uniform float u_lightIntensity;        // 光晕整体强度

uniform int   u_ghostCount;            // ghost 重影数(默认 8,上限 16)
uniform float u_ghostSpacing;          // ghost 轴向间距(默认 0.2)
uniform float u_ghostRadius;           // ghost 半径(默认 0.08)
uniform float u_ghostIntensity;        // ghost 强度(默认 1.0)

uniform float u_haloRadius;            // halo 环半径(默认 0.4)
uniform float u_haloThickness;         // halo 环厚度(默认 0.1)
uniform float u_haloIntensity;         // halo 强度(默认 0.5)

uniform float u_starburstIntensity;    // 星芒强度(默认 0.3)
uniform int   u_starburstRays;         // 星芒射线数(默认 6,上限 16)

uniform float u_maxDepth;              // 前景遮挡深度阈值(默认 0.99)
uniform float u_chromaticAberration;   // ghost 色散强度(默认 0.005)
uniform float u_globalFalloff;         // 全局距离衰减率(默认 1.5)
uniform int   u_enabled;               // 0=禁用,1=启用

#define PI 3.14159265359

// 高斯径向掩码:以 center 为中心,半径 radius 处衰减到 1/e
float radialGauss(vec2 uv, vec2 center, float radius) {
  float d = distance(uv, center);
  return exp(-d * d / (radius * radius));
}

void main() {
  vec3 sceneColor = texture(u_colorMap, v_uv).rgb;

  if (u_enabled == 0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // ── 投影光源到屏幕 NDC ─────────────────────────────────────────
  vec4 lightClip = u_viewProjection * vec4(u_lightPosition, 1.0);
  // 光源在相机后方(clip w <= 0)→ 光晕不可见
  if (lightClip.w <= 0.0) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }
  vec3 lightNDC = lightClip.xyz / lightClip.w;
  vec2 lightUV = lightNDC.xy * 0.5 + 0.5;

  // ── 屏幕外淡出:光源移出屏幕时光晕渐隐 ─────────────────────────
  vec2 offVec = max(abs(lightUV - vec2(0.5)) - vec2(0.5), vec2(0.0));
  float offDist = length(offVec);
  float visibilityFade = 1.0 - smoothstep(0.0, 1.5, offDist);
  if (visibilityFade <= 0.001) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }

  // ── 深度遮挡:前景几何(depth < maxDepth)挡住光晕 ──────────────
  float pixelDepth = texture(u_depthMap, v_uv).r;
  float occlusion = step(u_maxDepth, pixelDepth);

  vec2 toCenter = vec2(0.5) - lightUV;
  vec3 flare = vec3(0.0);

  // ── 1) Ghost 重影(沿光源→中心轴,带 RGB 色散) ────────────────
  // 每个 ghost 在 lightUV + toCenter * (spacing * i) 处,距光源越远越暗
  const int MAX_GHOSTS = 16;
  for (int i = 0; i < MAX_GHOSTS; i++) {
    if (i >= u_ghostCount) break;
    float fi = float(i + 1);
    float displacement = u_ghostSpacing * fi;
    vec2 ghostUV = lightUV + toCenter * displacement;
    // RGB 色散:R 通道正向偏移,B 通道反向偏移,G 通道不偏移
    float ca = u_chromaticAberration * fi;
    vec3 ghostColor;
    ghostColor.r = texture(u_colorMap, ghostUV + vec2(ca, 0.0)).r;
    ghostColor.g = texture(u_colorMap, ghostUV).g;
    ghostColor.b = texture(u_colorMap, ghostUV - vec2(ca, 0.0)).b;
    // 径向高斯衰减 + 距光源越远越暗(1/i falloff)
    float mask = radialGauss(v_uv, ghostUV, u_ghostRadius);
    float falloff = 1.0 / fi;
    flare += ghostColor * mask * falloff * u_ghostIntensity;
  }

  // ── 2) Halo 光环(围绕光源的环形高斯) ─────────────────────────
  // 在 dist == haloRadius 处最亮,两侧高斯衰减
  float distToLight = distance(v_uv, lightUV);
  float haloRing = exp(-pow((distToLight - u_haloRadius) / u_haloThickness, 2.0));
  flare += sceneColor * haloRing * u_haloIntensity;

  // ── 3) Starburst 星芒(围绕光源的多射线叠加) ──────────────────
  if (u_starburstIntensity > 0.0) {
    vec2 toLight = v_uv - lightUV;
    float angle = atan(toLight.y, toLight.x);
    float dist = length(toLight);
    // 多射线叠加:每条射线由 sin(angle * rays + phase) 调制
    float rays = 0.0;
    const int MAX_RAYS = 16;
    for (int i = 0; i < MAX_RAYS; i++) {
      if (i >= u_starburstRays) break;
      float a = angle * float(u_starburstRays) + float(i) * PI;
      rays += abs(sin(a));
    }
    rays = pow(max(0.0, rays - float(u_starburstRays) * 0.5), 2.0);
    float starMask = exp(-dist * 8.0);
    flare += u_lightColor * rays * starMask * u_starburstIntensity;
  }

  // ── 4) 全局衰减 + 加性合成 ───────────────────────────────────
  // 注:distToLight 已在 halo 阶段计算,这里复用作为全局距离衰减
  float globalFalloff = exp(-distToLight * u_globalFalloff);
  vec3 finalFlare = flare * u_lightColor * u_lightIntensity
                    * globalFalloff * occlusion * visibilityFade;

  outColor = vec4(sceneColor + finalFlare, 1.0);
}
`;

// ════════════════════════════════════════════════════════════════════════
// GPU 粒子系统着色器(GPUParticleSystem)
// ════════════════════════════════════════════════════════════════════════
//
// 数据布局(每粒子 1 texel,maxParticles = sizeX * sizeY):
//   positionTex (RGBA32F) ping-pong: xyz = 世界位置, w = life ratio [0,1]
//     (1 = 刚复活, 0 = 死亡)
//   velocityTex (RGBA32F) ping-pong: xyz = 速度 (m/s), w = age (秒, 已存活)
//   metaTex (RGBA32F) 静态: r = maxLife (s), g = startSize, b = endSize,
//     a = seed (用于 spawn 随机)
//
// 模拟流程(MRT 单 pass,同时写 positionTex + velocityTex):
//   1. 读旧 position/velocity/meta
//   2. 判断 texelId 是否在 [u_spawnStart, u_spawnStart+u_spawnCount) 环形范围
//      内且 life<=0 → 复活(emitterPos + 偏移, emitterVel + 随机方向)
//   3. 否则积分:pos += vel*dt; vel += gravity*dt; vel *= (1-drag*dt);
//      age += dt; life = max(0, 1 - age/maxLife)
//
// 渲染流程(POINTS + gl_VertexID):
//   vertex: tid → texelCoord → fetch positionTex/metaTex → clipPos + PointSize
//   fragment: 圆形 sprite + color over life + alpha fade
//
// 参考:
//   - GPU Gems 3 Ch.23 "High-Performance Screen-Space Particles"
//   - o3de Atom, RPI ParticleSystem
//   - three.js GPGPU particles (Yomboprime)
//   - Thomas 2014 "DirectCompute Optimizations for GPU Particles"

// ── 模拟 fragment shader(MRT 输出 2 张 RGBA32F) ─────────────────────────
export const GPU_PARTICLE_SIM_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

// 旧位置纹理(xyz=pos, w=life[0,1])
uniform sampler2D u_positionTex;
// 旧速度纹理(xyz=vel, w=age[s])
uniform sampler2D u_velocityTex;
// 静态元数据纹理(r=maxLife, g=startSize, b=endSize, a=seed)
uniform sampler2D u_metaTex;

uniform vec2  u_texelSize;      // (1/sizeX, 1/sizeY)
uniform int   u_sizeX;          // 纹理宽度(texel)
uniform int   u_maxParticles;   // sizeX * sizeY

uniform float u_dt;             // 帧时间(秒)
uniform vec3  u_emitterPos;     // 发射器世界位置
uniform vec3  u_emitterVel;     // 发射器初始速度(基础方向)
uniform float u_emitterRadius;  // 发射器球形半径(随机偏移)
uniform float u_startSpeed;     // 初始速度大小
uniform float u_startSpeedVar;  // 初始速度随机变化(0..1)
uniform vec3  u_gravity;        // 重力加速度(m/s²)
uniform float u_drag;           // 速度阻尼(1/秒)

uniform int   u_spawnStart;     // 本帧复活 texel 起始 id(环形)
uniform int   u_spawnCount;     // 本帧复活 texel 数量
uniform float u_time;           // 全局时间(用于随机种子)

uniform int   u_enabled;        // 0=禁用(仅 passthrough),1=启用

// MRT 输出
layout(location = 0) out highp vec4 outPosition;  // xyz=pos, w=life
layout(location = 1) out highp vec4 outVelocity;  // xyz=vel, w=age

// ── 哈希随机(返回 [0,1)) ─────────────────────────────────────────
// 基于 PCG hash,seed = texelId + frame
uint pcg(uint state) {
  state = state * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float rand(uint seed) {
  return float(pcg(seed)) / 4294967296.0;  // 2^32
}

void main() {
  // 当前 texel 坐标(0-based)
  ivec2 tc = ivec2(gl_FragCoord.xy) - ivec2(0);
  // 注意:gl_FragCoord 是像素中心 (x.5, y.5),ivec2 截断 → 0-based texel id
  int texelId = tc.y * u_sizeX + tc.x;

  // UV(用于纹理采样)
  vec2 uv = (vec2(tc) + 0.5) * u_texelSize;

  // 读取旧状态
  vec4 oldPos = texture(u_positionTex, uv);
  vec4 oldVel = texture(u_velocityTex, uv);
  vec4 meta   = texture(u_metaTex, uv);

  float maxLife  = meta.x;
  float life     = oldPos.w;
  float age      = oldVel.w;

  // ── 默认 passthrough(禁用或不复活不积分) ─────────────────────
  vec3 newPos = oldPos.xyz;
  vec3 newVel = oldVel.xyz;
  float newLife = life;
  float newAge  = age;

  if (u_enabled == 1) {
    // ── 判断是否本帧复活 ───────────────────────────────────────
    // 环形范围:[start, start+count) mod maxParticles
    int rel = texelId - u_spawnStart;
    if (rel < 0) rel += u_maxParticles;
    bool shouldSpawn = (life <= 0.0) && (rel < u_spawnCount);

    if (shouldSpawn) {
      // 复活:在 emitterPos 球形范围内随机出生
      uint s1 = uint(texelId) * 1973u + uint(u_time * 1000.0);
      uint s2 = uint(texelId) * 9277u + uint(u_time * 1000.0) + 17u;
      uint s3 = uint(texelId) * 26699u + uint(u_time * 1000.0) + 31u;
      float rx = rand(s1) * 2.0 - 1.0;
      float ry = rand(s2) * 2.0 - 1.0;
      float rz = rand(s3) * 2.0 - 1.0;
      // 球内均匀分布(拒绝采样简化为立方体近似,够用)
      vec3 offset = vec3(rx, ry, rz) * u_emitterRadius;

      // 随机方向(单位球面)
      float theta = rand(s1 + 7u) * 6.2831853;        // [0, 2π)
      float phi   = acos(rand(s2 + 13u) * 2.0 - 1.0); // [0, π]
      vec3 dir = vec3(
        sin(phi) * cos(theta),
        sin(phi) * sin(theta),
        cos(phi)
      );

      float speed = u_startSpeed * (1.0 - u_startSpeedVar + u_startSpeedVar * rand(s3 + 23u));

      newPos    = u_emitterPos + offset;
      newVel    = u_emitterVel + dir * speed;
      newLife   = 1.0;
      newAge    = 0.0;
    } else if (life > 0.0) {
      // 积分:半隐式 Euler
      newVel = oldVel.xyz + u_gravity * u_dt;
      float dragFactor = max(0.0, 1.0 - u_drag * u_dt);
      newVel *= dragFactor;
      newPos = oldPos.xyz + newVel * u_dt;

      newAge = age + u_dt;
      newLife = max(0.0, 1.0 - newAge / max(maxLife, 0.0001));
      if (newLife <= 0.0) {
        // 死亡:位置清零避免后续帧渲染(但保留 life=0 标记)
        newLife = 0.0;
      }
    }
  }

  outPosition = vec4(newPos, newLife);
  outVelocity = vec4(newVel, newAge);
}
`;

// ── 渲染 vertex shader(POINTS + gl_VertexID fetch) ──────────────────────
export const GPU_PARTICLE_RENDER_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D u_positionTex;  // xyz=pos, w=life
uniform sampler2D u_metaTex;      // r=maxLife, g=startSize, b=endSize
uniform vec2  u_texelSize;        // (1/sizeX, 1/sizeY)
uniform int   u_sizeX;            // 纹理宽度
uniform mat4  u_viewProjection;   // 世界 → NDC
uniform vec2  u_viewportSize;     // (width, height) 像素
uniform float u_sizeScale;        // 全局大小缩放
uniform float u_pixelRatio;       // devicePixelRatio

out float v_life;     // 生命 ratio [0,1](fragment 着色用)
out float v_tid;      // texel id(fragment 随机用)

void main() {
  int tid = gl_VertexID;
  int x = tid % u_sizeX;
  int y = tid / u_sizeX;
  vec2 uv = (vec2(float(x), float(y)) + 0.5) * u_texelSize;

  vec4 pos  = texture(u_positionTex, uv);  // xyz, w=life
  vec4 meta = texture(u_metaTex, uv);

  v_life = pos.w;
  v_tid = float(tid);

  // 死亡粒子裁剪(NDC 远处)
  if (pos.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 clipPos = u_viewProjection * vec4(pos.xyz, 1.0);
  gl_Position = clipPos;

  // 大小:life ratio 插值 startSize → endSize
  float t = 1.0 - pos.w;  // age ratio
  float size = mix(meta.g, meta.b, t);

  // 透视投影下点大小衰减(近大远小)
  // gl_PointSize = worldSize * viewportHeight / clipW * pixelRatio
  float pointSize = size * u_sizeScale * u_viewportSize.y * u_pixelRatio
                    / max(0.001, clipPos.w);
  gl_PointSize = clamp(pointSize, 1.0, 256.0);
}
`;

// ── 渲染 fragment shader(圆形 sprite + color over life + alpha fade) ────
export const GPU_PARTICLE_RENDER_FRAG = /* glsl */ `#version 300 es
precision highp float;

in float v_life;   // [0,1]
in float v_tid;

uniform vec3  u_startColor;   // t=0(刚复活)颜色
uniform vec3  u_endColor;     // t=1(将死)颜色
uniform float u_alphaScale;   // 全局 alpha 缩放
uniform int   u_blendMode;    // 0=加性,1=普通 alpha

out vec4 outColor;

void main() {
  // 圆形 sprite:gl_PointCoord ∈ [0,1]²,中心 (0.5, 0.5)
  vec2 d = gl_PointCoord * 2.0 - 1.0;  // [-1,1]
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;  // 圆外丢弃

  // 软边缘(1 - r²) 让边缘平滑
  float edge = 1.0 - r2;

  // life fade:刚复活(1)和将死(0)时略透明,中段最实
  // 用 sin(life * π) 让中段最亮
  float lifeFade = sin(v_life * 3.14159265);

  float alpha = edge * lifeFade * u_alphaScale;
  if (alpha <= 0.0) discard;

  // color over life:life=1 → startColor, life=0 → endColor
  float t = 1.0 - v_life;
  vec3 color = mix(u_startColor, u_endColor, t);

  if (u_blendMode == 0) {
    // 加性混合:颜色预乘 alpha,输出 RGB + alpha(用作加性权重)
    outColor = vec4(color * alpha, alpha);
  } else {
    // 普通 alpha:输出颜色 + alpha
    outColor = vec4(color, alpha);
  }
}
`;



