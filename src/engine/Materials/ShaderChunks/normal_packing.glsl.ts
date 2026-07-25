// NORMAL_PACK_CHUNK — 法线/深度打包与解包片段。
//
// 提供 [-1,1] 法线 <-> [0,1] RGB 的双向打包,以及 0..1 浮点深度到
// RGBA8 / RGB / RG 的多通道打包(用于阴影贴图、G-buffer 等)。
// 参考: three.js src/renderers/shaders/ShaderChunk/packing.glsl.js

/** 法线打包/解包、深度打包/解包片段。 */
export const NORMAL_PACK_CHUNK = /* glsl */ `
// ── normal / depth packing chunk ──────────────────────────────────────
// 法线 [-1,1] -> RGB [0,1]
vec3 packNormalToRGB(const in vec3 normal) {
  return normalize(normal) * 0.5 + 0.5;
}

// RGB [0,1] -> 法线 [-1,1]
vec3 unpackRGBToNormal(const in vec3 rgb) {
  return 2.0 * rgb - 1.0;
}

// ── depth packing (float -> 8-bit channels) ──────────────────────────
const float PackUpscale = 256.0 / 255.0;       // fraction -> 0..1 (含 1)
const float UnpackDownscale = 255.0 / 256.0;   // 0..1 -> fraction (不含 1)
const float ShiftRight8 = 1.0 / 256.0;
const float Inv255 = 1.0 / 255.0;

const vec4 PackFactors = vec4(1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0);
const vec2 UnpackFactors2 = vec2(UnpackDownscale, 1.0 / PackFactors.g);
const vec3 UnpackFactors3 = vec3(UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b);
const vec4 UnpackFactors4 = vec4(UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a);

// 浮点深度 -> RGBA(8-bit x 4)。
vec4 packDepthToRGBA(const in float v) {
  if (v <= 0.0) return vec4(0.0, 0.0, 0.0, 0.0);
  if (v >= 1.0) return vec4(1.0, 1.0, 1.0, 1.0);
  float vuf;
  float af = modf(v * PackFactors.a, vuf);
  float bf = modf(vuf * ShiftRight8, vuf);
  float gf = modf(vuf * ShiftRight8, vuf);
  return vec4(vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af);
}

// 浮点深度 -> RGB(8-bit x 3,精度 16-bit)。
vec3 packDepthToRGB(const in float v) {
  if (v <= 0.0) return vec3(0.0);
  if (v >= 1.0) return vec3(1.0);
  float vuf;
  float bf = modf(v * PackFactors.b, vuf);
  float gf = modf(vuf * ShiftRight8, vuf);
  return vec3(vuf * Inv255, gf * PackUpscale, bf);
}

// 浮点深度 -> RG(8-bit x 2,精度 8-bit)。
vec2 packDepthToRG(const in float v) {
  if (v <= 0.0) return vec2(0.0);
  if (v >= 1.0) return vec2(1.0);
  float vuf;
  float gf = modf(v * 256.0, vuf);
  return vec2(vuf * Inv255, gf);
}

// RGBA -> 浮点深度。
float unpackRGBAToDepth(const in vec4 v) {
  return dot(v, UnpackFactors4);
}

// RGB -> 浮点深度。
float unpackRGBToDepth(const in vec3 v) {
  return dot(v, UnpackFactors3);
}

// RG -> 浮点深度。
float unpackRGToDepth(const in vec2 v) {
  return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}

// vec2 -> RGBA(将两个 half-float 打包到 4 个 8-bit 通道)。
vec4 pack2HalfToRGBA(const in vec2 v) {
  vec4 r = vec4(v.x, fract(v.x * 255.0), v.y, fract(v.y * 255.0));
  return vec4(r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w);
}

// RGBA -> vec2(两个 half-float 解包)。
vec2 unpackRGBATo2Half(const in vec4 v) {
  return vec2(v.x + (v.y / 255.0), v.z + (v.w / 255.0));
}

// ── view-space Z <-> depth ───────────────────────────────────────────
// viewZ 为相机空间 z 坐标(相机前方为负)。

// 正交: viewZ -> depth([-near]->0, [-far]->1)。
float viewZToOrthographicDepth(const in float viewZ, const in float near, const in float far) {
  return (viewZ + near) / (near - far);
}

// 正交: depth -> viewZ。
float orthographicDepthToViewZ(const in float depth, const in float near, const in float far) {
#ifdef USE_REVERSED_DEPTH_BUFFER
  return depth * (far - near) - far;
#else
  return depth * (near - far) - near;
#endif
}

// 透视: viewZ -> depth。
float viewZToPerspectiveDepth(const in float viewZ, const in float near, const in float far) {
  return ((near + viewZ) * far) / ((far - near) * viewZ);
}

// 透视: depth -> viewZ。
float perspectiveDepthToViewZ(const in float depth, const in float near, const in float far) {
#ifdef USE_REVERSED_DEPTH_BUFFER
  return (near * far) / ((near - far) * depth - near);
#else
  return (near * far) / ((far - near) * depth - far);
#endif
}
`;
