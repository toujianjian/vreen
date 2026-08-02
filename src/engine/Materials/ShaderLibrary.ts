// ShaderLibrary — 预定义着色器模板库。
//
// 设计目标:
//   - 集中管理命名 GLSL 着色器模板(unlit / diffuse / phong / pbr / 等),
//     供 ShaderMaterial / 用户脚本通过名引用,无需手写大段 GLSL。
//   - 每个模板包含 vertexSource / fragmentSource / uniforms / attributes / tags,
//     其中 uniforms 是 *声明* 列表(name + type),实际值由调用方传入。
//   - 支持 createVariant(name, overrides) 生成模板变体(覆盖源码或 uniform)。
//
// 与 ShaderChunks 的区别:
//   - ShaderChunks 是 GLSL *片段*(可拼接的子字符串,如 NOISE / FOG);
//   - ShaderLibrary 是完整 *着色器*(顶点 + 片段 + 元数据),可直接编译。
//
// 与 StandardMaterial 的关系:
//   - StandardMaterial 是 PBR 材质类(含 uniform 字段、贴图绑定、序列化);
//   - ShaderLibrary 提供 'pbr' 模板作为参考实现 / 验证基线,与 StandardMaterial
//     内部 shader 等价但不绑定到材质类(纯字符串模板,供 ShaderMaterial 使用)。
//
// 用法:
//   import { shaderLibrary } from './ShaderLibrary';
//   const tpl = shaderLibrary.get('unlit-textured')!;
//   const mat = new ShaderMaterial({
//     vertexSrc: tpl.vertexSource,
//     fragmentSrc: tpl.fragmentSource,
//     uniforms: { u_baseColor: [1, 0, 0] },
//   });

import { createLogger } from '@/lib/logger';

const log = createLogger('ShaderLibrary');

/** Uniform 类型(用于声明 / 反射)。 */
export type UniformType =
  | 'float'
  | 'int'
  | 'bool'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'mat3'
  | 'mat4'
  | 'sampler2D'
  | 'samplerCube';

/** Attribute 类型。 */
export type AttributeType =
  | 'float'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'mat3'
  | 'mat4'
  | 'int'
  | 'uint';

/** Uniform 声明。 */
export interface UniformDeclaration {
  name: string;
  type: UniformType;
  /** 默认值(number / 数组,可选)。 */
  default?: number | number[];
  /** 描述(供工具反射)。 */
  description?: string;
}

/** Attribute 声明。 */
export interface AttributeDeclaration {
  name: string;
  type: AttributeType;
  /** layout location(可选,未指定时由 GL 自动分配)。 */
  location?: number;
}

/** 着色器标签(用于按标签过滤,如 'transparent' / 'unlit' / 'pbr')。 */
export type ShaderTag = string;

/** 着色器模板。 */
export interface ShaderTemplate {
  /** 模板名(唯一,如 'unlit-textured')。 */
  name: string;
  /** 顶点着色器源码(GLSL ES 3.0,以 #version 300 es 开头)。 */
  vertexSource: string;
  /** 片段着色器源码。 */
  fragmentSource: string;
  /** Uniform 声明列表。 */
  uniforms: UniformDeclaration[];
  /** Attribute 声明列表。 */
  attributes: AttributeDeclaration[];
  /** 标签(供检索)。 */
  tags: ShaderTag[];
  /** 描述。 */
  description?: string;
}

/** 变体覆盖项。 */
export interface ShaderTemplateOverride {
  /** 覆盖顶点源码(可选)。 */
  vertexSource?: string;
  /** 覆盖片段源码(可选)。 */
  fragmentSource?: string;
  /** 追加 uniform 声明(同 name 则覆盖)。 */
  uniforms?: UniformDeclaration[];
  /** 追加 attribute 声明(同 name 则覆盖)。 */
  attributes?: AttributeDeclaration[];
  /** 追加标签。 */
  tags?: ShaderTag[];
  /** 覆盖描述。 */
  description?: string;
}

// ── 内置着色器源码 ────────────────────────────────────────────────────

const VERSION = '#version 300 es\nprecision highp float;\n';

const UNLIT_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
out vec3 v_worldPos;
void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  gl_Position = u_projection * u_view * worldPos;
}
`;

const UNLIT_FRAG = `${VERSION}
in vec3 v_worldPos;
uniform vec3 u_baseColor;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  fragColor = vec4(u_baseColor, u_opacity);
}
`;

const UNLIT_TEXTURED_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
out vec2 v_uv;
out vec3 v_worldPos;
void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

const UNLIT_TEXTURED_FRAG = `${VERSION}
in vec2 v_uv;
in vec3 v_worldPos;
uniform sampler2D u_map;
uniform vec3 u_baseColor;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec4 tex = texture(u_map, v_uv);
  fragColor = vec4(u_baseColor * tex.rgb, tex.a * u_opacity);
}
`;

const DIFFUSE_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
out vec3 v_worldNormal;
out vec3 v_worldPos;
void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  gl_Position = u_projection * u_view * worldPos;
}
`;

const DIFFUSE_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec3 v_worldPos;
uniform vec3 u_baseColor;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform vec3 u_ambientColor;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 L = normalize(-u_lightDir);
  float NdotL = max(dot(N, L), 0.0);
  vec3 color = u_ambientColor + u_lightColor * NdotL;
  fragColor = vec4(u_baseColor * color, u_opacity);
}
`;

const PHONG_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec3 v_worldPos;
uniform vec3 u_baseColor;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform vec3 u_ambientColor;
uniform vec3 u_specularColor;
uniform float u_shininess;
uniform vec3 u_cameraPos;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 L = normalize(-u_lightDir);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 R = reflect(-L, N);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(R, V), 0.0), u_shininess);
  vec3 color = u_ambientColor + u_lightColor * diff + u_specularColor * spec;
  fragColor = vec4(u_baseColor * color, u_opacity);
}
`;

const BLINN_PHONG_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec3 v_worldPos;
uniform vec3 u_baseColor;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform vec3 u_ambientColor;
uniform vec3 u_specularColor;
uniform float u_shininess;
uniform vec3 u_cameraPos;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 L = normalize(-u_lightDir);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 H = normalize(L + V);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), u_shininess);
  vec3 color = u_ambientColor + u_lightColor * diff + u_specularColor * spec;
  fragColor = vec4(u_baseColor * color, u_opacity);
}
`;

const PBR_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
out vec3 v_worldNormal;
out vec3 v_worldPos;
out vec2 v_uv;
void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

const PBR_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec3 v_worldPos;
in vec2 v_uv;
uniform vec3 u_baseColor;
uniform float u_metallic;
uniform float u_roughness;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform vec3 u_ambientColor;
uniform vec3 u_cameraPos;
uniform float u_opacity;
out vec4 fragColor;

const float PI = 3.14159265359;

float distributionGGX(float NdotH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom);
}

float geometrySchlickGGX(float NdotV, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 L = normalize(-u_lightDir);
  vec3 H = normalize(L + V);

  vec3 F0 = mix(vec3(0.04), u_baseColor, u_metallic);

  float NDF = distributionGGX(max(dot(N, H), 0.0), u_roughness);
  float G = geometrySchlickGGX(max(dot(N, V), 0.0), u_roughness) *
            geometrySchlickGGX(max(dot(N, L), 0.0), u_roughness);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);

  vec3 numerator = NDF * G * F;
  float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
  vec3 specular = numerator / denominator;

  vec3 kS = F;
  vec3 kD = (vec3(1.0) - kS) * (1.0 - u_metallic);

  float NdotL = max(dot(N, L), 0.0);
  vec3 radiance = u_lightColor * u_lightIntensity;
  vec3 Lo = (kD * u_baseColor / PI + specular) * radiance * NdotL;

  vec3 ambient = u_ambientColor * u_baseColor;
  vec3 color = ambient + Lo;
  fragColor = vec4(color, u_opacity);
}
`;

const PBR_IBL_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec3 v_worldPos;
in vec2 v_uv;
uniform vec3 u_baseColor;
uniform float u_metallic;
uniform float u_roughness;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform vec3 u_ambientColor;
uniform vec3 u_cameraPos;
uniform samplerCube u_envMap;
uniform int u_envMapEnabled;
uniform float u_opacity;
out vec4 fragColor;

const float PI = 3.14159265359;

void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 L = normalize(-u_lightDir);
  vec3 H = normalize(L + V);

  vec3 F0 = mix(vec3(0.04), u_baseColor, u_metallic);
  float NdotL = max(dot(N, L), 0.0);
  vec3 radiance = u_lightColor * u_lightIntensity;

  // Diffuse direct
  vec3 kS = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 kD = (vec3(1.0) - kS) * (1.0 - u_metallic);
  vec3 diffuse = kD * u_baseColor / PI * radiance * NdotL;

  // Specular direct (simplified)
  vec3 R = reflect(-V, N);
  float specPow = pow(max(dot(R, L), 0.0), mix(1.0, 64.0, 1.0 - u_roughness));
  vec3 specular = kS * specPow * radiance * NdotL;

  // IBL: 简化采样环境贴图
  vec3 iblDiffuse = u_ambientColor * u_baseColor;
  vec3 iblSpecular = vec3(0.0);
  if (u_envMapEnabled == 1) {
    vec3 envDiff = texture(u_envMap, N).rgb;
    iblDiffuse = envDiff * u_baseColor * (1.0 - u_metallic);
    vec3 envSpec = texture(u_envMap, R).rgb;
    iblSpecular = envSpec * mix(vec3(0.04), u_baseColor, u_metallic);
  }

  vec3 color = iblDiffuse + iblSpecular + diffuse + specular;
  fragColor = vec4(color, u_opacity);
}
`;

const TOON_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec3 v_worldPos;
uniform vec3 u_baseColor;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform vec3 u_ambientColor;
uniform float u_opacity;
uniform int u_levels;
out vec4 fragColor;
void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 L = normalize(-u_lightDir);
  float NdotL = max(dot(N, L), 0.0);
  float level = ceil(NdotL * float(u_levels)) / float(u_levels);
  vec3 color = u_ambientColor + u_lightColor * level;
  fragColor = vec4(u_baseColor * color, u_opacity);
}
`;

const SKYBOX_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
uniform mat4 u_view;
uniform mat4 u_projection;
out vec3 v_dir;
void main() {
  v_dir = a_position;
  // 移除 view 的平移分量(让天空盒跟随相机但不平移)
  mat4 rotView = mat4(mat3(u_view));
  vec4 clipPos = u_projection * rotView * vec4(a_position, 1.0);
  gl_Position = clipPos.xyww; // depth = w → 远裁面
}
`;

const SKYBOX_FRAG = `${VERSION}
in vec3 v_dir;
uniform samplerCube u_envMap;
uniform float u_intensity;
out vec4 fragColor;
void main() {
  vec3 col = texture(u_envMap, normalize(v_dir)).rgb * u_intensity;
  fragColor = vec4(col, 1.0);
}
`;

const ENV_MAP_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec3 v_worldPos;
uniform vec3 u_cameraPos;
uniform samplerCube u_envMap;
uniform float u_reflectivity;
uniform vec3 u_baseColor;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPos - v_worldPos);
  vec3 R = reflect(-V, N);
  vec3 envColor = texture(u_envMap, R).rgb;
  vec3 color = mix(u_baseColor, envColor, u_reflectivity);
  fragColor = vec4(color, u_opacity);
}
`;

const PARALLAX_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
out vec3 v_worldNormal;
out vec3 v_worldPos;
out vec2 v_uv;
void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

const PARALLAX_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec3 v_worldPos;
in vec2 v_uv;
uniform sampler2D u_diffuseMap;
uniform sampler2D u_heightMap;
uniform float u_heightScale;
uniform vec3 u_cameraPos;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec3 V = normalize(u_cameraPos - v_worldPos);
  // 简化视差:沿 view 方向偏移 UV
  vec2 parallaxOffset = (V.xy / max(V.z, 0.1)) * (texture(u_heightMap, v_uv).r - 0.5) * u_heightScale;
  vec2 uv = v_uv - parallaxOffset;
  vec3 col = texture(u_diffuseMap, uv).rgb;
  fragColor = vec4(col, u_opacity);
}
`;

const FUR_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
uniform float u_shellLayer;
uniform float u_furLength;
uniform vec3 u_gravity;
out vec3 v_worldNormal;
out vec2 v_uv;
out float v_layer;
void main() {
  vec3 displaced = a_position + a_normal * u_shellLayer * u_furLength;
  displaced += u_gravity * u_shellLayer * u_shellLayer;
  vec4 worldPos = u_model * vec4(displaced, 1.0);
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  v_layer = u_shellLayer;
  gl_Position = u_projection * u_view * worldPos;
}
`;

const FUR_FRAG = `${VERSION}
in vec3 v_worldNormal;
in vec2 v_uv;
in float v_layer;
uniform vec3 u_furColor;
uniform float u_density;
uniform float u_opacity;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float threshold = mix(1.0, 0.0, v_layer) * u_density;
  if (hash21(v_uv * 50.0) < threshold) discard;
  vec3 col = u_furColor * (1.0 - v_layer * 0.3);
  fragColor = vec4(col, u_opacity);
}
`;

const WATER_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform float u_time;
uniform float u_waveHeight;
out vec3 v_worldPos;
out vec2 v_uv;
void main() {
  vec3 pos = a_position;
  // Gerstner 波简化
  pos.y += sin(pos.x * 2.0 + u_time) * u_waveHeight;
  pos.y += sin(pos.z * 3.0 + u_time * 1.3) * u_waveHeight * 0.5;
  vec4 worldPos = u_model * vec4(pos, 1.0);
  v_worldPos = worldPos.xyz;
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

const WATER_FRAG = `${VERSION}
in vec3 v_worldPos;
in vec2 v_uv;
uniform vec3 u_waterColor;
uniform vec3 u_cameraPos;
uniform float u_time;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec3 V = normalize(u_cameraPos - v_worldPos);
  float fresnel = pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), V), 0.0), 3.0);
  vec3 col = mix(u_waterColor, vec3(0.7, 0.85, 1.0), fresnel);
  fragColor = vec4(col, u_opacity);
}
`;

const PARTICLE_VERT = `${VERSION}
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform float u_size;
out vec4 v_color;
out vec2 v_uv;
void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_color = a_color;
  v_uv = a_uv;
  vec4 clipPos = u_projection * u_view * worldPos;
  // Point size (透视缩放)
  gl_PointSize = u_size / max(clipPos.w, 0.01);
  gl_Position = clipPos;
}
`;

const PARTICLE_FRAG = `${VERSION}
in vec4 v_color;
in vec2 v_uv;
uniform sampler2D u_sprite;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec4 tex = texture(u_sprite, v_uv);
  fragColor = v_color * tex * u_opacity;
}
`;

const POST_PROCESS_VERT = `${VERSION}
layout(location = 0) in vec2 a_position;
layout(location = 2) in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const POST_PROCESS_FRAG = `${VERSION}
in vec2 v_uv;
uniform sampler2D u_colorMap;
out vec4 fragColor;
void main() {
  fragColor = texture(u_colorMap, v_uv);
}
`;

// ── 内置模板定义 ────────────────────────────────────────────────────

const BUILTIN_TEMPLATES: ShaderTemplate[] = [
  {
    name: 'unlit',
    vertexSource: UNLIT_VERT,
    fragmentSource: UNLIT_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
    ],
    tags: ['unlit', 'opaque'],
    description: '纯色无光照。',
  },
  {
    name: 'unlit-textured',
    vertexSource: UNLIT_TEXTURED_VERT,
    fragmentSource: UNLIT_TEXTURED_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_map', type: 'sampler2D' },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_uv', type: 'vec2', location: 2 },
    ],
    tags: ['unlit', 'textured'],
    description: '无光照 + 纹理。',
  },
  {
    name: 'diffuse',
    vertexSource: DIFFUSE_VERT,
    fragmentSource: DIFFUSE_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_lightDir', type: 'vec3', default: [0, -1, 0] },
      { name: 'u_lightColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_ambientColor', type: 'vec3', default: [0.2, 0.2, 0.25] },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
    ],
    tags: ['lit', 'diffuse'],
    description: 'Lambert 漫反射。',
  },
  {
    name: 'phong',
    vertexSource: DIFFUSE_VERT,
    fragmentSource: PHONG_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_lightDir', type: 'vec3', default: [0, -1, 0] },
      { name: 'u_lightColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_ambientColor', type: 'vec3', default: [0.2, 0.2, 0.25] },
      { name: 'u_specularColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_shininess', type: 'float', default: 32 },
      { name: 'u_cameraPos', type: 'vec3' },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
    ],
    tags: ['lit', 'phong', 'specular'],
    description: 'Phong 光照(反射向量)。',
  },
  {
    name: 'blinn-phong',
    vertexSource: DIFFUSE_VERT,
    fragmentSource: BLINN_PHONG_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_lightDir', type: 'vec3', default: [0, -1, 0] },
      { name: 'u_lightColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_ambientColor', type: 'vec3', default: [0.2, 0.2, 0.25] },
      { name: 'u_specularColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_shininess', type: 'float', default: 32 },
      { name: 'u_cameraPos', type: 'vec3' },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
    ],
    tags: ['lit', 'blinn-phong', 'specular'],
    description: 'Blinn-Phong 光照(半向量,常用)。',
  },
  {
    name: 'pbr',
    vertexSource: PBR_VERT,
    fragmentSource: PBR_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_metallic', type: 'float', default: 0 },
      { name: 'u_roughness', type: 'float', default: 0.5 },
      { name: 'u_lightDir', type: 'vec3', default: [0, -1, 0] },
      { name: 'u_lightColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_lightIntensity', type: 'float', default: 1 },
      { name: 'u_ambientColor', type: 'vec3', default: [0.05, 0.05, 0.05] },
      { name: 'u_cameraPos', type: 'vec3' },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
      { name: 'a_uv', type: 'vec2', location: 2 },
    ],
    tags: ['lit', 'pbr', 'metal-roughness'],
    description: 'PBR 金属粗糙度(Cook-Torrance BRDF)。',
  },
  {
    name: 'pbr-ibl',
    vertexSource: PBR_VERT,
    fragmentSource: PBR_IBL_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_metallic', type: 'float', default: 0 },
      { name: 'u_roughness', type: 'float', default: 0.5 },
      { name: 'u_lightDir', type: 'vec3', default: [0, -1, 0] },
      { name: 'u_lightColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_lightIntensity', type: 'float', default: 1 },
      { name: 'u_ambientColor', type: 'vec3', default: [0.05, 0.05, 0.05] },
      { name: 'u_cameraPos', type: 'vec3' },
      { name: 'u_envMap', type: 'samplerCube' },
      { name: 'u_envMapEnabled', type: 'int', default: 0 },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
      { name: 'a_uv', type: 'vec2', location: 2 },
    ],
    tags: ['lit', 'pbr', 'ibl'],
    description: 'PBR + 环境贴图 IBL。',
  },
  {
    name: 'toon',
    vertexSource: DIFFUSE_VERT,
    fragmentSource: TOON_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_lightDir', type: 'vec3', default: [0, -1, 0] },
      { name: 'u_lightColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_ambientColor', type: 'vec3', default: [0.2, 0.2, 0.25] },
      { name: 'u_levels', type: 'int', default: 4 },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
    ],
    tags: ['lit', 'toon', 'cel'],
    description: '卡通着色(量化 N·L 为离散色带)。',
  },
  {
    name: 'skybox',
    vertexSource: SKYBOX_VERT,
    fragmentSource: SKYBOX_FRAG,
    uniforms: [
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_envMap', type: 'samplerCube' },
      { name: 'u_intensity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
    ],
    tags: ['background', 'sky'],
    description: '天空盒背景渲染。',
  },
  {
    name: 'env-map',
    vertexSource: DIFFUSE_VERT,
    fragmentSource: ENV_MAP_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_cameraPos', type: 'vec3' },
      { name: 'u_envMap', type: 'samplerCube' },
      { name: 'u_reflectivity', type: 'float', default: 0.5 },
      { name: 'u_baseColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
    ],
    tags: ['lit', 'reflection'],
    description: '环境反射。',
  },
  {
    name: 'parallax',
    vertexSource: PARALLAX_VERT,
    fragmentSource: PARALLAX_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_diffuseMap', type: 'sampler2D' },
      { name: 'u_heightMap', type: 'sampler2D' },
      { name: 'u_heightScale', type: 'float', default: 0.1 },
      { name: 'u_cameraPos', type: 'vec3' },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
      { name: 'a_uv', type: 'vec2', location: 2 },
    ],
    tags: ['lit', 'parallax', 'textured'],
    description: '视差映射(沿视线偏移 UV)。',
  },
  {
    name: 'fur',
    vertexSource: FUR_VERT,
    fragmentSource: FUR_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_normalMatrix', type: 'mat3' },
      { name: 'u_shellLayer', type: 'float' },
      { name: 'u_furLength', type: 'float', default: 0.1 },
      { name: 'u_gravity', type: 'vec3', default: [0, -1, 0] },
      { name: 'u_furColor', type: 'vec3', default: [0.6, 0.4, 0.2] },
      { name: 'u_density', type: 'float', default: 0.5 },
      { name: 'u_opacity', type: 'float', default: 1 },
      // Kajiya-Kay 各向异性毛发着色
      { name: 'u_lightDir', type: 'vec3', default: [0.577, 0.577, 0.577] },
      { name: 'u_lightColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_cameraPos', type: 'vec3' },
      { name: 'u_rootColor', type: 'vec3', default: [0.6, 0.45, 0.3] },
      { name: 'u_tipColor', type: 'vec3', default: [0.6, 0.45, 0.3] },
      { name: 'u_specularColor', type: 'vec3', default: [1, 1, 1] },
      { name: 'u_specularPower', type: 'float', default: 64 },
      { name: 'u_secondarySpecularColor', type: 'vec3', default: [0.8, 0.7, 0.5] },
      { name: 'u_secondarySpecularPower', type: 'float', default: 16 },
      { name: 'u_specularShift', type: 'float', default: 0.1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
      { name: 'a_uv', type: 'vec2', location: 2 },
    ],
    tags: ['fur', 'shell', 'transparent'],
    description: '多层 shell 毛发。',
  },
  {
    name: 'water',
    vertexSource: WATER_VERT,
    fragmentSource: WATER_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_time', type: 'float' },
      { name: 'u_waveHeight', type: 'float', default: 0.1 },
      { name: 'u_waterColor', type: 'vec3', default: [0, 0.5, 0.8] },
      { name: 'u_cameraPos', type: 'vec3' },
      { name: 'u_opacity', type: 'float', default: 0.8 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_normal', type: 'vec3', location: 1 },
      { name: 'a_uv', type: 'vec2', location: 2 },
    ],
    tags: ['lit', 'water', 'transparent'],
    description: 'Gerstner 波水面 + Fresnel。',
  },
  {
    name: 'particle',
    vertexSource: PARTICLE_VERT,
    fragmentSource: PARTICLE_FRAG,
    uniforms: [
      { name: 'u_model', type: 'mat4' },
      { name: 'u_view', type: 'mat4' },
      { name: 'u_projection', type: 'mat4' },
      { name: 'u_size', type: 'float', default: 10 },
      { name: 'u_sprite', type: 'sampler2D' },
      { name: 'u_opacity', type: 'float', default: 1 },
    ],
    attributes: [
      { name: 'a_position', type: 'vec3', location: 0 },
      { name: 'a_color', type: 'vec4', location: 1 },
      { name: 'a_uv', type: 'vec2', location: 2 },
    ],
    tags: ['particle', 'transparent'],
    description: '粒子点精灵。',
  },
  {
    name: 'post-process',
    vertexSource: POST_PROCESS_VERT,
    fragmentSource: POST_PROCESS_FRAG,
    uniforms: [
      { name: 'u_colorMap', type: 'sampler2D' },
    ],
    attributes: [
      { name: 'a_position', type: 'vec2', location: 0 },
      { name: 'a_uv', type: 'vec2', location: 2 },
    ],
    tags: ['post-process'],
    description: '后处理基础 pass(直通采样)。',
  },
];

/**
 * 着色器模板库。
 *
 * 单例 `shaderLibrary` 默认预装 15 个模板。调用方也可 new 一个空实例作为
 * 沙盒(registry 注入测试常用)。
 */
export class ShaderLibrary {
  /** 命名模板表。 */
  shaders: Map<string, ShaderTemplate> = new Map();

  constructor(autoLoadBuiltins: boolean = true) {
    if (autoLoadBuiltins) {
      for (const tpl of BUILTIN_TEMPLATES) {
        this.shaders.set(tpl.name, tpl);
      }
    }
  }

  /** 获取模板。不存在返回 undefined。 */
  get(name: string): ShaderTemplate | undefined {
    return this.shaders.get(name);
  }

  /** 注册模板。同名覆盖。 */
  register(template: ShaderTemplate): this {
    if (!template.name || template.name.length === 0) {
      throw new Error('ShaderLibrary.register: template.name must be non-empty');
    }
    if (!template.vertexSource || !template.fragmentSource) {
      throw new Error(`ShaderLibrary.register: template "${template.name}" missing vertexSource/fragmentSource`);
    }
    this.shaders.set(template.name, template);
    log.debug(`registered shader template "${template.name}"`);
    return this;
  }

  /** 是否存在。 */
  has(name: string): boolean {
    return this.shaders.has(name);
  }

  /** 列出所有模板名(按字典序)。 */
  list(): string[] {
    return Array.from(this.shaders.keys()).sort();
  }

  /** 已注册模板数。 */
  size(): number {
    return this.shaders.size;
  }

  /** 注销模板。 */
  unregister(name: string): boolean {
    return this.shaders.delete(name);
  }

  /**
   * 创建变体(基于现有模板 + 覆盖项)。
   *
   * @param name 基础模板名(必须存在)
   * @param overrides 覆盖项(任一字段)
   * @returns 新模板(未注册到库,调用方决定是否 register)
   */
  createVariant(name: string, overrides: ShaderTemplateOverride): ShaderTemplate {
    const base = this.shaders.get(name);
    if (!base) {
      throw new Error(`ShaderLibrary.createVariant: base template "${name}" not found`);
    }
    // 合并 uniforms(同 name 覆盖)
    const uniforms = base.uniforms.slice();
    if (overrides.uniforms) {
      for (const ov of overrides.uniforms) {
        const idx = uniforms.findIndex((u) => u.name === ov.name);
        if (idx >= 0) uniforms[idx] = ov;
        else uniforms.push(ov);
      }
    }
    // 合并 attributes(同 name 覆盖)
    const attributes = base.attributes.slice();
    if (overrides.attributes) {
      for (const ov of overrides.attributes) {
        const idx = attributes.findIndex((a) => a.name === ov.name);
        if (idx >= 0) attributes[idx] = ov;
        else attributes.push(ov);
      }
    }
    // 合并 tags(去重)
    const tagSet = new Set(base.tags);
    if (overrides.tags) {
      for (const t of overrides.tags) tagSet.add(t);
    }
    return {
      name: `${name}-variant`,
      vertexSource: overrides.vertexSource ?? base.vertexSource,
      fragmentSource: overrides.fragmentSource ?? base.fragmentSource,
      uniforms,
      attributes,
      tags: Array.from(tagSet),
      description: overrides.description ?? base.description,
    };
  }

  /** 按标签过滤(返回所有包含任一指定标签的模板)。 */
  filterByTags(tags: string[]): ShaderTemplate[] {
    if (tags.length === 0) return Array.from(this.shaders.values());
    const out: ShaderTemplate[] = [];
    for (const tpl of this.shaders.values()) {
      if (tags.some((t) => tpl.tags.includes(t))) {
        out.push(tpl);
      }
    }
    return out;
  }

  /** 清空库。 */
  clear(): void {
    this.shaders.clear();
  }
}

/** 进程级默认模板库单例(预装内置模板)。 */
export const shaderLibrary = new ShaderLibrary(true);

/** 内置模板名列表(便于测试 / 反射)。 */
export const BUILTIN_SHADER_NAMES: readonly string[] = BUILTIN_TEMPLATES.map((t) => t.name);
