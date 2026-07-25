// TONEMAP_ACES_CHUNK / TONEMAP_REINHARD_CHUNK — 色调映射片段。
//
// 提供 HDR -> LDR 的色调映射函数。调用方负责先做曝光,再调用本函数。
// 参考: three.js tonemapping_pars_fragment.glsl.js + Narkowicz ACES 近似

/** ACES Filmic 色调映射片段(Narkowicz 近似)。 */
export const TONEMAP_ACES_CHUNK = /* glsl */ `
// ── ACES Filmic tonemap chunk (Narkowicz approximation) ──────────────
vec3 acesFilmic(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// ACES tonemap,接受 RGB,返回 LDR RGB。
vec3 toneMapACES(vec3 color) {
  return acesFilmic(color);
}
`;

/** Reinhard 色调映射片段。 */
export const TONEMAP_REINHARD_CHUNK = /* glsl */ `
// ── Reinhard tonemap chunk ───────────────────────────────────────────
vec3 reinhard(vec3 x) {
  return x / (x + vec3(1.0));
}

// Reinhard extended(白点版本,白色压缩到 L <= 1)。
vec3 reinhardExtended(vec3 x, float whiteLuminance) {
  vec3 white = vec3(whiteLuminance * whiteLuminance);
  return (x * (1.0 + x / white)) / (1.0 + x);
}

// Reinhard tonemap,接受 RGB,返回 LDR RGB。
vec3 toneMapReinhard(vec3 color) {
  return reinhard(color);
}
`;
