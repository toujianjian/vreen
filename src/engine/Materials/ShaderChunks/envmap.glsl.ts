// ENVMAP_CHUNK — 环境贴图采样片段。
//
// 提供 IBL(基于图像的光照)辐射度与辐照度采样函数。基于 samplerCube
// + textureLod(roughness 控制 mip)。调用方需声明:
//   uniform samplerCube u_envMap;
//   uniform int         u_envMapEnabled;
//   uniform float       u_envMapIntensity;  // 可选,默认 1.0
// 参考: three.js envmap_physical_pars_fragment.glsl.js

/** 环境贴图采样片段(IBL 辐射度 + 辐照度)。 */
export const ENVMAP_CHUNK = /* glsl */ `
// ── envmap chunk ──────────────────────────────────────────────────────
// 基于粗糙度的镜面反射 IBL 辐射度(预滤波环境贴图)。
// viewDir = 从表面指向相机的方向, normal = 表面法线。
vec3 getIBLRadiance(vec3 viewDir, vec3 normal, float roughness) {
  if (u_envMapEnabled == 0) return vec3(0.0);
  vec3 reflectVec = reflect(-viewDir, normal);
  // 混合反射与法线,避免粗糙物体从切平面后方采到光(Epic 建议)。
  reflectVec = normalize(mix(reflectVec, normal, pow4(roughness)));
  float mipLevel = roughness * 4.0;
  vec3 envColor = textureLod(u_envMap, reflectVec, mipLevel).rgb;
  return envColor * u_envMapIntensity;
}

// 漫反射 IBL 辐照度(用法线直接采样低 mip)。
vec3 getIBLIrradiance(vec3 normal) {
  if (u_envMapEnabled == 0) return vec3(0.0);
  vec3 envColor = textureLod(u_envMap, normal, 4.0).rgb;
  return PI * envColor * u_envMapIntensity;
}

// 完整 IBL 贡献(镜面 + 漫反射,带 Fresnel 与金属度调制)。
// f0=Fresnel 0°, roughness=粗糙度, metallic=金属度。
vec3 getIBLContribution(vec3 viewDir, vec3 normal, vec3 f0,
                        float roughness, float metallic) {
  if (u_envMapEnabled == 0) return vec3(0.0);
  float NoV = max(dot(normal, viewDir), 0.0);
  vec3 F = F_Schlick_Rough(f0, roughness, NoV);
  vec3 specularIBL = getIBLRadiance(viewDir, normal, roughness) * F;
  vec3 kd = (vec3(1.0) - F) * (1.0 - metallic);
  vec3 diffuseIBL = kd * getIBLIrradiance(normal) * 0.5;
  return diffuseIBL + specularIBL * 0.5;
}
`;
