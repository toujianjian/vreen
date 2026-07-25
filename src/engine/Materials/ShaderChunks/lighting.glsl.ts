// LIGHTING_CHUNK — 光照计算片段。
//
// 提供 BRDF (Lambert / GGX / Schlick) 与 Cook-Torrance 直接光照积分。
// 与 COMMON_CHUNK 配合使用(依赖 PI / RECIPROCAL_PI / saturate)。
// 参考: three.js bsdfs.glsl.js + lights_physical_pars_fragment.glsl.js

/** 光照计算片段:漫反射、镜面反射、BRDF (Cook-Torrance)。 */
export const LIGHTING_CHUNK = /* glsl */ `
// ── lighting chunk ────────────────────────────────────────────────────
// Lambert 漫反射 BRDF。
vec3 BRDF_Lambert(const in vec3 diffuseColor) {
  return RECIPROCAL_PI * diffuseColor;
}

// Burley 漫反射 BRDF(更接近物理,Disney SIGGRAPH 2012)。
vec3 BRDF_Burley(const in vec3 diffuseColor, const in float roughness,
                 const in float NoV, const in float NoL, const in float VoH) {
  float f0 = 0.5 - 0.5 * VoH;
  float f90 = 0.5 + VoH;
  float FL = pow(1.0 - NoL, 5.0);
  float FV = pow(1.0 - NoV, 5.0);
  float FD = 0.5 + 2.0 * NoL * VoH * f0;
  float rr = roughness * roughness;
  vec3 Fd = (1.0 + rr * (FD - 1.0)) * (1.0 + rr * (FD - 1.0));
  return RECIPROCAL_PI * Fd * diffuseColor * (1.0 - 0.3333 * rr);
}

// Trowbridge-Reitz / GGX 法线分布函数。
float D_GGX(const in float NoH, const in float a) {
  float a2 = a * a;
  float f = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * f * f + EPSILON);
}

// Smith 联合几何函数(GGX correlated,Smith joint)。
float V_SmithGGXCorrelated(const in float NoV, const in float NoL, const in float a) {
  float a2 = a * a;
  float GGXL = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  float GGXV = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  return 0.5 / (GGXV + GGXL + EPSILON);
}

// Schlick Fresnel(vec3 版本,Epic 优化)。
vec3 F_Schlick(const in vec3 f0, const in float f90, const in float dotVH) {
  float fresnel = exp2((-5.55473 * dotVH - 6.98316) * dotVH);
  return f0 * (1.0 - fresnel) + (f90 * fresnel);
}

// Schlick Fresnel(标量版本)。
float F_Schlick(const in float f0, const in float f90, const in float dotVH) {
  float fresnel = exp2((-5.55473 * dotVH - 6.98316) * dotVH);
  return f0 * (1.0 - fresnel) + (f90 * fresnel);
}

// Schlick Fresnel(基于 roughness 的 IBL 版本)。
vec3 F_Schlick_Rough(const in vec3 f0, const in float roughness, const in float dotVH) {
  float fresnel = exp2((-5.55473 * dotVH - 6.98316) * dotVH);
  vec3 fr = f0 + (max(vec3(1.0 - roughness), f0) - f0) * fresnel;
  return fr;
}

// Cook-Torrance 直接光照(单光源),返回直接辐射度。
// N=表面法线, V=视角方向, L=光线方向, color=albedo, f0=Fresnel 0°,
// roughness=粗糙度, metallic=金属度, lightColor=辐射 RGB, lightIntensity=强度。
vec3 evaluateDirectLight(vec3 N, vec3 V, vec3 L, vec3 baseColor,
                         vec3 f0, float roughness, float metallic,
                         vec3 lightColor, float lightIntensity) {
  vec3 H = normalize(V + L);
  float NoL = max(dot(N, L), 0.0);
  float NoV = max(dot(N, V), 0.0);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);

  float a = max(roughness * roughness, 0.0025);
  float D = D_GGX(NoH, a);
  float Vis = V_SmithGGXCorrelated(NoV, NoL, a);
  vec3 F = F_Schlick(f0, 1.0, VoH);

  vec3 specular = D * Vis * F;
  vec3 kd = (vec3(1.0) - F) * (1.0 - metallic);
  vec3 diffuse = kd * BRDF_Lambert(baseColor);

  return (diffuse + specular) * NoL * lightColor * lightIntensity;
}

// 半球环境光(基于法线 y 分量在天/地颜色间插值)。
vec3 evaluateHemisphereAmbient(vec3 N, vec3 baseColor,
                               vec3 ambientColor,
                               vec3 skyColor, vec3 groundColor) {
  float upWeight = 0.5 + 0.5 * N.y;
  vec3 ambient = mix(groundColor, skyColor, upWeight) * baseColor * ambientColor;
  return ambient;
}
`;
