// UV_TRANSFORM_CHUNK — UV 变换片段。
//
// 提供基于 mat3 的 UV 变换(平移/旋转/缩放),以及常用投影变换
// (平面投影/三轴投影)。GLSL ES 3.0 兼容。
// 参考: three.js uv_pars_fragment.glsl.js / uv_vertex.glsl.js

/** UV 变换片段:mat3 变换、平面投影、三轴投影。 */
export const UV_TRANSFORM_CHUNK = /* glsl */ `
// ── uv transform chunk ───────────────────────────────────────────────
// 用 mat3(2D 仿射)变换 UV。mat3 排列:
//   [ scale.x    skew   translate.x ]
//   [ skew       scale.y translate.y ]
//   [ 0          0       1           ]
vec2 transformUv(vec2 uv, mat3 uvTransform) {
  vec3 transformed = uvTransform * vec3(uv, 1.0);
  return transformed.xy;
}

// 平面投影:把 3D 位置投影到 UV(基于 planeAxis: 0=Y, 1=X, 2=Z)。
vec2 planarUv(vec3 position, int planeAxis, float scale) {
  if (planeAxis == 0) {
    return position.xz * scale;
  } else if (planeAxis == 1) {
    return position.zy * scale;
  } else {
    return position.xy * scale;
  }
}

// 三轴投影:基于法线最大分量选择投影平面(用于无 UV 的网格)。
vec2 triplanarUv(vec3 position, vec3 normal, float scale) {
  vec3 absNormal = abs(normal);
  if (absNormal.x > absNormal.y && absNormal.x > absNormal.z) {
    return position.zy * scale;
  } else if (absNormal.y > absNormal.z) {
    return position.xz * scale;
  } else {
    return position.xy * scale;
  }
}

// 三轴权重(用于三轴纹理混合)。
vec3 triplanarWeights(vec3 normal) {
  vec3 absNormal = abs(normal);
  float total = absNormal.x + absNormal.y + absNormal.z + EPSILON;
  return absNormal / total;
}
`;
