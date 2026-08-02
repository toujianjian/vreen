// CSM (Cascaded Shadow Maps) GLSL shader chunk。
//
// 提供级联选择和采样函数,供 PBR / Standard 材质的阴影路径使用。
// 调用方负责声明 uniform 数组并绑定级联阴影贴图纹理。
//
// 用法:
//   1. 在 fragment shader 中 #include 本 chunk;
//   2. 声明 uniform:
//        uniform mat4 u_csmVP[4];       // 每级视图投影
//        uniform float u_csmSplits[4];  // 每级远裁面
//        uniform sampler2D u_csmMaps[4]; // 每级阴影贴图
//        uniform int u_csmCount;        // 级联数
//        uniform float u_csmBlend;      // 过渡比例
//        uniform float u_csmBias;       // 深度偏移
//   3. 调用 sampleCSM(worldPos) 获取阴影因子(0=阴影, 1=照亮)。

/** CSM 级联选择 + 采样 shader chunk。 */
export const CSM_SAMPLE_CHUNK = /* glsl */ `
// ── CSM (Cascaded Shadow Maps) 采样 ────────────────────────────────
// 根据片段的视图空间深度选择合适的级联,采样对应的阴影贴图。
// 在级联边界处做线性混合,避免硬接缝。

// 调用方需声明以下 uniform:
// uniform mat4 u_csmVP[CSM_MAX_CASCADES];
// uniform float u_csmSplits[CSM_MAX_CASCADES];
// uniform sampler2D u_csmMaps[CSM_MAX_CASCADES];
// uniform int u_csmCount;
// uniform float u_csmBlend;
// uniform float u_csmBias;

#define CSM_MAX_CASCADES 8

// 单次 PCF 采样(3×3 = 9 tap)
float csmPCF3x3(sampler2D shadowMap, vec3 shadowCoord, float bias) {
  vec2 texel = 1.0 / vec2(textureSize(shadowMap, 0));
  float shadow = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 offset = vec2(float(x), float(y)) * texel;
      float depth = texture(shadowMap, shadowCoord.xy + offset).r;
      shadow += (shadowCoord.z - bias > depth) ? 0.0 : 1.0;
    }
  }
  return shadow / 9.0;
}

// 级联选择 + 采样
// worldPos: 世界空间片段位置
// viewDepth: 视图空间深度(正值,距相机远近)
// 返回:阴影因子 [0, 1](0=全阴影, 1=全照亮)
float sampleCSM(vec3 worldPos, float viewDepth) {
  // 选择级联:找到第一个 split > viewDepth 的级联
  int cascadeIdx = 0;
  for (int i = 0; i < CSM_MAX_CASCADES; i++) {
    if (i >= u_csmCount) break;
    if (viewDepth <= u_csmSplits[i]) {
      cascadeIdx = i;
      break;
    }
    cascadeIdx = i; // fallback:最后一个级联
  }

  // 采样当前级联
  vec4 shadowCoord = u_csmVP[cascadeIdx] * vec4(worldPos, 1.0);
  shadowCoord.xyz /= shadowCoord.w;
  shadowCoord.xyz = shadowCoord.xyz * 0.5 + 0.5; // NDC → [0,1]

  // 超出纹理范围 → 无阴影(边界外)
  if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 ||
      shadowCoord.y < 0.0 || shadowCoord.y > 1.0) {
    return 1.0;
  }

  float shadow = csmPCF3x3(u_csmMaps[cascadeIdx], shadowCoord.xyz, u_csmBias);

  // 级联过渡混合:在 split 边界附近混合下一级联
  if (cascadeIdx + 1 < u_csmCount) {
    float splitDist = u_csmSplits[cascadeIdx];
    float prevSplit = cascadeIdx > 0 ? u_csmSplits[cascadeIdx - 1] : 0.0;
    float cascadeRange = splitDist - prevSplit;
    float distToBoundary = splitDist - viewDepth;
    float blendFactor = smoothstep(0.0, cascadeRange * u_csmBlend, distToBoundary);

    if (blendFactor < 1.0) {
      // 混合下一级联
      vec4 nextCoord = u_csmVP[cascadeIdx + 1] * vec4(worldPos, 1.0);
      nextCoord.xyz /= nextCoord.w;
      nextCoord.xyz = nextCoord.xyz * 0.5 + 0.5;

      float nextShadow = 1.0;
      if (nextCoord.x >= 0.0 && nextCoord.x <= 1.0 &&
          nextCoord.y >= 0.0 && nextCoord.y <= 1.0) {
        nextShadow = csmPCF3x3(u_csmMaps[cascadeIdx + 1], nextCoord.xyz, u_csmBias);
      }

      shadow = mix(nextShadow, shadow, blendFactor);
    }
  }

  return shadow;
}
`;
