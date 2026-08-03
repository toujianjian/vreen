// SpecularAA shader chunk — Toksvig / LEAN 镜面抗锯齿。
//
// PBR 引擎在高频法线区域(法线贴图 + 距离)会产生镜面高光闪烁 /
// 爬行(specular shimmering/crawling),因为每像素的法线采样不足以
// 表示亚像素法线变化。本 chunk 用屏幕空间导数(dFdx/dFdy)估计法线
// 局部方差,据此提升有效 roughness,使高光在远距离下平滑衰减而非闪烁。
//
// 算法:
//   variance = |dFdx(N)|² + |dFdy(N)|²
//   roughness = clamp(sqrt(roughness² + variance * k), 0.045, 1.0)
//
// 这是 UE5 "Anti-Aliasing Specular Highlights" 和 o3de Atom SpecularAA
// 的标准做法。k 控制抗锯齿强度(默认 0.25,UE5 用值)。
//
// 参考:
//   - Toksvig (2005) "Mipmapping Normal Maps"
//   - Olano & Baker (2010) "LEAN Mapping"
//   - UE5 "Anti-Aliasing Specular Highlights"
//   - o3de Atom SpecularAA pass
//
// 用法(自定义 shader):
//   #include <specular_aa>
//   // 在法线贴图采样后、GGX 计算前调用:
//   roughness = applySpecularAA(N, roughness);
//
// 注意:需要 GLSL ES 3.0(dFdx/dFdy 在 fragment shader 中可用)。

/** SpecularAA 函数片段。调用 applySpecularAA(N, roughness) 返回修正后的 roughness。 */
export const SPECULAR_AA_CHUNK = /* glsl */ `
// SpecularAA (Toksvig / LEAN filtering) — 镜面抗锯齿。
// 根据屏幕空间法线方差提升有效 roughness,消除远距离镜面闪烁。
float applySpecularAA(vec3 N, float roughness) {
  vec3 dNdx = dFdx(N);
  vec3 dNdy = dFdy(N);
  float variance = dot(dNdx, dNdx) + dot(dNdy, dNdy);
  // variance 越大(法线变化越剧烈)→ roughness 越高 → 高光越平滑
  return clamp(sqrt(roughness * roughness + variance * 0.25), 0.045, 1.0);
}
`;

/** SpecularAA 内联片段(无函数包装,供 #ifdef 直接嵌入 PBR_FRAG)。 */
export const SPECULAR_AA_INLINE = /* glsl */ `
  // SpecularAA (Toksvig): screen-space normal variance → roughness boost
  vec3 dNdx_aa = dFdx(N);
  vec3 dNdy_aa = dFdy(N);
  float variance_aa = dot(dNdx_aa, dNdx_aa) + dot(dNdy_aa, dNdy_aa);
  roughness = clamp(sqrt(roughness * roughness + variance_aa * 0.25), 0.045, 1.0);
`;
