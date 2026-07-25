// COMMON_CHUNK — 通用着色器片段。
//
// 提供 PI 常量、精度宏、常用工具函数(pow2/3/4, max3, average, saturate, rand,
// transformDirection)。GLSL ES 3.0 兼容。可被任意 vertex/fragment shader 通过
// ShaderChunkRegistry.inject('COMMON') 注入。
//
// 参考: three.js src/renderers/shaders/ShaderChunk/common.glsl.js

/** 通用着色器片段:PI 常量、精度限定、常用工具函数。 */
export const COMMON_CHUNK = /* glsl */ `
// ── common chunk ──────────────────────────────────────────────────────
#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#define LOG2 1.4426950408889634

#ifndef saturate
#define saturate(a) clamp(a, 0.0, 1.0)
#endif
#define whiteComplement(a) (1.0 - saturate(a))

float pow2(const in float x) { return x * x; }
vec3 pow2(const in vec3 x) { return x * x; }
float pow3(const in float x) { return x * x * x; }
float pow4(const in float x) { float x2 = x * x; return x2 * x2; }
float max3(const in vec3 v) { return max(max(v.x, v.y), v.z); }
float min3(const in vec3 v) { return min(min(v.x, v.y), v.z); }
float average(const in vec3 v) { return dot(v, vec3(0.3333333)); }

// 期望输入 [0,1]x[0,1],返回 [0,1]。参考 three.js common.glsl.js。
highp float rand(const in vec2 uv) {
  const highp float a = 12.9898, b = 78.233, c = 43758.5453;
  highp float dt = dot(uv.xy, vec2(a, b));
  highp float sn = mod(dt, PI);
  return fract(sin(sn) * c);
}

// 将方向向量用 4x4 矩阵变换(方向,w=0),归一化后返回。
vec3 transformDirection(in vec3 dir, in mat4 matrix) {
  return normalize((matrix * vec4(dir, 0.0)).xyz);
}

// 判断是否为透视投影矩阵(m[2][3] == -1)。
bool isPerspectiveMatrix(mat4 m) {
  return m[2][3] == -1.0;
}

// 高精度下的安全长度;低精度下做分量缩放避免溢出。
float precisionSafeLength(vec3 v) {
  return length(v);
}

// 等距圆柱投影 UV(用于环境贴图采样)。
vec2 equirectUv(in vec3 dir) {
  float u = atan(dir.z, dir.x) * RECIPROCAL_PI2 + 0.5;
  float v = asin(clamp(dir.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5;
  return vec2(u, v);
}

// 入射光结构。
struct IncidentLight {
  vec3 color;
  vec3 direction;
  bool visible;
};

// 反射光累积结构(直接/间接 漫反射/镜面反射)。
struct ReflectedLight {
  vec3 directDiffuse;
  vec3 directSpecular;
  vec3 indirectDiffuse;
  vec3 indirectSpecular;
};

// 几何体结构(法线/位置/视角方向)。
struct GeometricContext {
  vec3 position;
  vec3 normal;
  vec3 viewDir;
};
`;
