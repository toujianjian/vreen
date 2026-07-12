// ShaderChunk — 用户可拼接到自定义 shader 的 GLSL 片段库。
//
// 每一项是一个被 export 的字符串常量。用户在 ShaderMaterial 的
// vertexSrc/fragmentSrc 里用模板字符串直接拼接它们,实现复用:
//
//   const mat = new ShaderMaterial({
//     vertexSrc: `...` + CHUNK.SKINNING_VERT,
//     fragmentSrc: NOISE_GLSL + FOG_GLSL + `
//       in vec3 v_worldPos;
//       void main() {
//         float n = simplex3(v_worldPos * 0.5 + u_time);
//         gl_FragColor = vec4(vec3(n), 1.0);
//       }
//     `,
//   });
//
// 所有 chunk 使用 `vec3` 输入,与自研 Engine 的世界空间约定一致。
// 公共 include 用 `#include NOISE_HASH` 风格的字符串 — 解析留给调用方
// 做简单替换(我们 v1 不做编译器级 include 解析,只提供原始字符串)。

/** 通用 hash 函数(noise / random / 等)。 */
export const HASH_GLSL = /* glsl */ `
// hash11 → 1D pseudo-random
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// hash21 → 2D pseudo-random
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// hash31 → 3D pseudo-random
float hash31(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// hash32 → vec2 random
vec2 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`;

/** 值噪声(value noise)。3D。 */
export const VALUE_NOISE_GLSL = /* glsl */ `
${HASH_GLSL}
float valueNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0,0,0));
  float n100 = hash31(i + vec3(1,0,0));
  float n010 = hash31(i + vec3(0,1,0));
  float n110 = hash31(i + vec3(1,1,0));
  float n001 = hash31(i + vec3(0,0,1));
  float n101 = hash31(i + vec3(1,0,1));
  float n011 = hash31(i + vec3(0,1,1));
  float n111 = hash31(i + vec3(1,1,1));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
`;

/** 3D simplex noise(参考 Ashima 公开实现)。 */
export const SIMPLEX_NOISE_GLSL = /* glsl */ `
${HASH_GLSL}
vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float simplex3(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

/** 简单 Schlick Fresnel。 */
export const FRESNEL_GLSL = /* glsl */ `
float fresnelSchlick(float cosTheta, float F0) {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}
`;

/** 标准顶点/片段壳 — 自研引擎约定。 */
export const STANDARD_VERTEX_HEADER = /* glsl */ `precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec2 v_uv;
`;

export const STANDARD_FRAGMENT_HEADER = /* glsl */ `precision highp float;
in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;
uniform vec3 u_cameraPos;
out vec4 fragColor;
`;

/** 高度雾(fog):随距离淡出到 fogColor。 */
export const FOG_GLSL = /* glsl */ `
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
vec3 applyFog(vec3 color, float distance) {
  float fogFactor = smoothstep(u_fogNear, u_fogFar, distance);
  return mix(color, u_fogColor, fogFactor);
}
`;

/** 全息线扫效果(在用户 shader 中可直接用)。 */
export const HOLOGRAM_GLSL = /* glsl */ `
uniform float u_time;
uniform vec3 u_holoColor;
uniform float u_scanlineStrength;
uniform float u_fresnelPower;

${FRESNEL_GLSL}
${HASH_GLSL}

// 全息线扫 + 视线 Fresnel 边缘 + 轻微噪声
vec3 applyHologram(vec3 baseColor, vec3 normal, vec3 viewDir) {
  float NdotV = max(dot(normal, viewDir), 0.0);
  float edge = pow(1.0 - NdotV, u_fresnelPower);
  float scan = sin(v_worldPos.y * 50.0 + u_time * 4.0) * 0.5 + 0.5;
  scan = pow(scan, 4.0) * u_scanlineStrength;
  float noise = hash31(v_worldPos * 30.0 + vec3(u_time)) * 0.08;
  return baseColor + u_holoColor * (edge * 0.8 + scan + noise);
}
`;

/**
 * 简单 include 解析器 — 把 `#include NAME` 替换为对应 chunk。
 * 仅用于 ShaderMaterial 用户源代码;已知 chunks 名与 HASH_GLSL 等
 * export 同名。
 */
export function resolveIncludes(src: string): string {
  const map: Record<string, string> = {
    HASH: HASH_GLSL,
    VALUE_NOISE: VALUE_NOISE_GLSL,
    SIMPLEX_NOISE: SIMPLEX_NOISE_GLSL,
    FRESNEL: FRESNEL_GLSL,
    FOG: FOG_GLSL,
    HOLOGRAM: HOLOGRAM_GLSL,
  };
  return src.replace(/#include\s+([A-Z_]+)/g, (_, name: string) => map[name] ?? '');
}
