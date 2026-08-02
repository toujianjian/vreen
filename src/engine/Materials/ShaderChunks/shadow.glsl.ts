// SHADOW_CHUNK — 阴影计算片段。
//
// 提供三种阴影采样函数:
//   - sampleShadowHard  : 硬阴影(1-tap,最快)
//   - sampleShadowPCF   : PCF 软阴影(9-tap,固定半径)
//   - sampleShadowPCSS  : PCSS 软阴影(32-tap,变量半径 — 接触点锐利,远离光源处柔和)
//
// PCSS(Percentage-Closer Soft Shadows)是 UE5 / o3de Atom 使用的物理软阴影:
//   Stage 1: Blocker Search — 在光源尺寸范围内搜索遮挡体,求平均遮挡深度
//   Stage 2: Penumbra Estimation — 由遮挡体-接收体距离差估算半影宽度
//   Stage 3: PCF Filter — 用估算的半影半径做 Poisson 盘 PCF 采样
// 效果: 遮挡体越靠近接收体 → 阴影越锐利(接触硬);越远 → 阴影越柔和(发散软)
//
// 调用方需在 shader 顶部声明相关 uniform:
//   uniform sampler2D u_shadowMap;
//   uniform mat4      u_lightVP;
//   uniform float     u_shadowBias;
//   uniform vec2      u_shadowMapSize;
//   uniform int       u_shadowEnabled;
// PCSS 额外需要:
//   uniform float     u_lightSize;     // 光源尺寸(世界单位,控制半影宽度)
// 返回 0..1 可见性(0=完全阴影,1=完全照亮)。
// 参考: three.js shadowmap_pars_fragment.glsl.js + UE5 PCSS + o3de Atom Shadow

/** PCF / PCSS 软阴影采样片段。 */
export const SHADOW_CHUNK = /* glsl */ `
// ── Poisson disk (16 samples) ───────────────────────────────────────
// 用于 PCSS 的 blocker search 和 PCF filter。
const vec2 POISSON_DISK[16] = vec2[16](
  vec2(-0.94201624, -0.39906216),
  vec2( 0.94558609, -0.76890725),
  vec2(-0.09418410, -0.92938870),
  vec2( 0.34495938,  0.29387760),
  vec2(-0.91588581,  0.45771432),
  vec2(-0.81544232, -0.87912464),
  vec2(-0.38279945,  0.32239859),
  vec2(-0.96713238,  0.22461420),
  vec2( 0.45231924,  0.88300513),
  vec2( 0.92658444,  0.37494937),
  vec2( 0.67341858, -0.56784085),
  vec2(-0.38279945, -0.32239859),
  vec2( 0.58076319,  0.57832368),
  vec2(-0.58076319, -0.57832368),
  vec2( 0.58076319, -0.57832368),
  vec2(-0.58076319,  0.57832368)
);

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

// ── PCSS (Percentage-Closer Soft Shadows) ─────────────────────────
// 物理软阴影:接触点锐利,远离光源处柔和。
// 需要额外 uniform: u_lightSize(光源尺寸,世界单位)。
// 3 阶段:
//   1. Blocker Search: 在光源尺寸范围内搜索遮挡体,求平均遮挡深度
//   2. Penumbra:       penumbraWidth = (receiver - blocker) * lightSize / blocker
//   3. PCF:            用 penumbraWidth 半径做 16-tap Poisson PCF
float sampleShadowPCSS(vec3 worldPos) {
  if (u_shadowEnabled == 0) return 1.0;
  vec4 lp = u_lightVP * vec4(worldPos, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 ||
      ndc.y < -1.0 || ndc.y > 1.0 ||
      ndc.z < -1.0 || ndc.z > 1.0) {
    return 1.0;
  }
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float receiverDepth = ndc.z * 0.5 + 0.5 - u_shadowBias;
  vec2 texel = 1.0 / u_shadowMapSize;

  // ── Stage 1: Blocker Search ────────────────────────────────────
  // 搜索半径 = 光源尺寸在阴影贴图上的投影(texel 单位)。
  // 使用 receiverDepth 做透视正确缩放(越远 → 搜索范围越大)。
  float searchRadius = u_lightSize * texel.x * 10.0;
  float blockerSum = 0.0;
  float blockerCount = 0.0;
  for (int i = 0; i < 16; i++) {
    vec2 sampleUV = uv + POISSON_DISK[i] * searchRadius;
    float shadowMapDepth = texture(u_shadowMap, sampleUV).r;
    if (shadowMapDepth < receiverDepth) {
      blockerSum += shadowMapDepth;
      blockerCount += 1.0;
    }
  }
  // 无遮挡体 → 完全照亮
  if (blockerCount < 0.5) return 1.0;
  float avgBlockerDepth = blockerSum / blockerCount;

  // ── Stage 2: Penumbra Estimation ──────────────────────────────
  // 半影宽度与 (receiver - blocker) 成正比,与 blocker 成反比。
  // 遮挡体越近 → 半影越小 → 阴影越锐利;越远 → 半影越大 → 越柔和。
  float penumbra = (receiverDepth - avgBlockerDepth) * u_lightSize / avgBlockerDepth;
  // 限制最大半影半径(防止远处过度模糊)
  float maxRadius = 5.0 * texel.x * 10.0;
  penumbra = clamp(penumbra, 0.0, maxRadius);

  // ── Stage 3: PCF Filter (16-tap Poisson) ─────────────────────
  float visible = 0.0;
  for (int i = 0; i < 16; i++) {
    vec2 sampleUV = uv + POISSON_DISK[i] * penumbra;
    float depth = texture(u_shadowMap, sampleUV).r;
    visible += (depth > receiverDepth) ? 1.0 : 0.0;
  }
  return visible / 16.0;
}
`;
