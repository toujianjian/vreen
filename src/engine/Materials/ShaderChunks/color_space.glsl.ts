// COLOR_SPACE_CHUNK — 颜色空间转换片段。
//
// 提供 sRGB <-> Linear RGB 的双向转换,以及亮度计算与 sRGB 输出编码。
// GLSL ES 3.0 兼容,使用 pow + clamp 实现近似 sRGB 传递函数。
// 参考: three.js colorspace_fragment.glsl.js + colorspace_pars_fragment.glsl.js

/** 颜色空间转换片段:sRGB <-> Linear,亮度,sRGB 编码。 */
export const COLOR_SPACE_CHUNK = /* glsl */ `
// ── color space chunk ────────────────────────────────────────────────
// sRGB 通道传递函数(0..1 输入)。
float sRGBToLinearChannel(float c) {
  if (c <= 0.04045) {
    return c / 12.92;
  }
  return pow((c + 0.055) / 1.055, 2.4);
}

// Linear 通道传递函数(0..1 输入)。
float linearToSRGBChannel(float c) {
  if (c <= 0.0031308) {
    return c * 12.92;
  }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

// sRGB -> Linear RGB(vec3)。
vec3 sRGBToLinear(vec3 c) {
  return vec3(
    sRGBToLinearChannel(c.r),
    sRGBToLinearChannel(c.g),
    sRGBToLinearChannel(c.b)
  );
}

// Linear RGB -> sRGB(vec3)。
vec3 linearToSRGB(vec3 c) {
  return vec3(
    linearToSRGBChannel(c.r),
    linearToSRGBChannel(c.g),
    linearToSRGBChannel(c.b)
  );
}

// 快速 sRGB <-> Linear(使用 pow 2.2 近似,性能更优)。
vec3 sRGBToLinearFast(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.2));
}

vec3 linearToSRGBFast(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}

// Rec.709 亮度。
float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Rec.601 亮度(用于 NTSC/JPEG)。
float luminance601(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// ACEScg 中性灰 -> ACES2065-1 简化近似(仅用于调试 LDR 输出)。
vec3 linearToACEScgApprox(vec3 c) {
  return c * vec3(0.6131, 0.6131, 0.6131) + vec3(0.3869, 0.3869, 0.3869) * 0.0;
}
`;
