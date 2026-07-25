// SHADOW_CHUNK — 阴影计算片段。
//
// 提供 PCF 软阴影采样函数。调用方需在 shader 顶部声明相关 uniform:
//   uniform sampler2D u_shadowMap;
//   uniform mat4      u_lightVP;
//   uniform float     u_shadowBias;
//   uniform vec2      u_shadowMapSize;
//   uniform int       u_shadowEnabled;
// 返回 0..1 可见性(0=完全阴影,1=完全照亮)。
// 参考: three.js shadowmap_pars_fragment.glsl.js + VREEN 现有 PCF_SHADOW_FRAG

/** PCF 软阴影采样片段。 */
export const SHADOW_CHUNK = /* glsl */ `
// ── shadow chunk ──────────────────────────────────────────────────────
// 3x3 共 9-tap PCF 软阴影。半径基于阴影贴图分辨率,1.5 texel。
// 与 VREEN PBR_FRAG 内联的 16-tap Poisson 版本相比更轻量,适合注入用户 shader。
float sampleShadowPCF(vec3 worldPos) {
  if (u_shadowEnabled == 0) return 1.0;
  vec4 lp = u_lightVP * vec4(worldPos, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 ||
      ndc.y < -1.0 || ndc.y > 1.0 ||
      ndc.z < -1.0 || ndc.z > 1.0) {
    return 1.0;
  }
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float ref = ndc.z * 0.5 + 0.5 - u_shadowBias;
  vec2 texel = 1.5 / u_shadowMapSize;

  float visible = 0.0;
  visible += (texture(u_shadowMap, uv + vec2(-texel.x, -texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( 0.0,     -texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( texel.x, -texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2(-texel.x,  0.0     )).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv                          ).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( texel.x,  0.0     )).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2(-texel.x,  texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( 0.0,      texel.y)).r > ref) ? 1.0 : 0.0;
  visible += (texture(u_shadowMap, uv + vec2( texel.x,  texel.y)).r > ref) ? 1.0 : 0.0;
  return visible / 9.0;
}

// 简单硬阴影(单 tap),用于性能敏感场景。
float sampleShadowHard(vec3 worldPos) {
  if (u_shadowEnabled == 0) return 1.0;
  vec4 lp = u_lightVP * vec4(worldPos, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 ||
      ndc.y < -1.0 || ndc.y > 1.0 ||
      ndc.z < -1.0 || ndc.z > 1.0) {
    return 1.0;
  }
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float ref = ndc.z * 0.5 + 0.5 - u_shadowBias;
  float depth = texture(u_shadowMap, uv).r;
  return depth > ref ? 1.0 : 0.0;
}
`;
