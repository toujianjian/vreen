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
uniform mat4 u_projection;
uniform mat4 u_view;
uniform vec3 u_cameraPos;
uniform vec2 u_screenSize;
uniform int   u_maxSteps;
uniform float u_thickness;
uniform float u_reflectionStrength;

// 把世界位置投影到屏幕 UV(0..1)。
vec2 projectToUV(vec3 worldPos) {
  vec4 clip = u_projection * u_view * vec4(worldPos, 1.0);
  return (clip.xy / clip.w) * 0.5 + 0.5;
}

// 厚度检测:UV 越界返回 false;否则比较 sampledPos.z 与 rayPos.z,
// 当几何在射线前方(深度差为正)且在厚度内 → 击中。
bool hitTest(vec3 rayPos, vec2 uv, out float depthDiff) {
  depthDiff = 1e9;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return false;
  vec3 sampledPos = texture(u_positionMap, uv).xyz;
  depthDiff = sampledPos.z - rayPos.z;
  return depthDiff > 0.0 && depthDiff < u_thickness;
}

void main() {
  vec3 sceneColor  = texture(u_colorMap,    v_uv).rgb;
  vec3 worldPos    = texture(u_positionMap, v_uv).xyz;
  vec3 worldNormal = texture(u_normalMap,   v_uv).xyz;

  // 法线过小 → 几何未写入,直接输出原色(避免反射空中)
  if (length(worldNormal) < 0.01) {
    outColor = vec4(sceneColor, 1.0);
    return;
  }
  worldNormal = normalize(worldNormal);

  vec3 viewDir  = normalize(u_cameraPos - worldPos);
  vec3 reflDir  = reflect(-viewDir, worldNormal);

  // 步长基于厚度的一半,保证 step > thickness 才能跨过薄层
  vec3 stepDir  = reflDir * (u_thickness * 0.5);
  vec3 rayPos   = worldPos + stepDir;
  vec2 uv       = projectToUV(rayPos);
  vec2 hitUV    = uv;
  vec3 hitPos   = rayPos;
  bool  hit     = false;

  // Ray march
  for (int i = 0; i < 64; i++) {
    if (i >= u_maxSteps) break;
    float dd;
    if (hitTest(rayPos, uv, dd)) {
      hit    = true;
      hitPos = rayPos;
      hitUV  = uv;
      break;
    }
    rayPos += stepDir;
    uv = projectToUV(rayPos);
  }

  // 二分查找细化(8 步足够把误差压到 thickness/256)
  if (hit) {
    vec3 lo = worldPos;
    vec3 hi = hitPos;
    for (int i = 0; i < 8; i++) {
      vec3 mid   = (lo + hi) * 0.5;
      vec2 midUV = projectToUV(mid);
      float dd;
      if (hitTest(mid, midUV, dd)) {
        hi     = mid;
        hitUV  = midUV;
      } else {
        lo = mid;
      }
    }
  }

  if (hit) {
    vec3 reflectionColor = texture(u_colorMap, hitUV).rgb;

    // 边缘衰减:命中 UV 越靠近屏幕边缘,反射越弱
    vec2  edgeDist = min(hitUV, 1.0 - hitUV);
    float edgeFade = smoothstep(0.0, 0.1, min(edgeDist.x, edgeDist.y));

    // Fresnel 权重:掠射角反射更强
    float fresnel = pow(1.0 - max(dot(viewDir, worldNormal), 0.0), 3.0);
    float strength = u_reflectionStrength * edgeFade * (0.5 + 0.5 * fresnel);

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

