// FOG_CHUNK / FOG_EXP2_CHUNK — 雾效果片段。
//
// 与 three.js fog_fragment.glsl.js 类似,但使用 GLSL ES 3.0 函数式接口:
// 调用方传入颜色与距离,返回雾化后的颜色,而非直接修改全局变量。
// 参考: three.js src/renderers/shaders/ShaderChunk/fog_fragment.glsl.js

/** 线性雾片段:基于 fogNear/fogFar 平滑过渡到 fogColor。 */
export const FOG_CHUNK = /* glsl */ `
// ── linear fog chunk ──────────────────────────────────────────────────
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;

// 线性雾:返回混合后的颜色。distance 通常为 length(v_worldPos - u_cameraPos)。
vec3 applyLinearFog(vec3 color, float distance) {
  float fogFactor = smoothstep(u_fogNear, u_fogFar, distance);
  return mix(color, u_fogColor, fogFactor);
}

// 仅返回雾因子(0=无雾,1=全雾),供调用方自行 mix。
float computeLinearFogFactor(float distance) {
  return smoothstep(u_fogNear, u_fogFar, distance);
}
`;

/** 指数平方雾片段:基于 fogDensity 的 exp(-d²·ρ²) 衰减。 */
export const FOG_EXP2_CHUNK = /* glsl */ `
// ── exp2 fog chunk ────────────────────────────────────────────────────
uniform vec3 u_fogColor;
uniform float u_fogDensity;

// 指数平方雾:返回混合后的颜色。
vec3 applyExp2Fog(vec3 color, float distance) {
  float fogFactor = 1.0 - exp(-u_fogDensity * u_fogDensity * distance * distance);
  fogFactor = saturate(fogFactor);
  return mix(color, u_fogColor, fogFactor);
}

// 仅返回雾因子(0=无雾,1=全雾)。
float computeExp2FogFactor(float distance) {
  float fogFactor = 1.0 - exp(-u_fogDensity * u_fogDensity * distance * distance);
  return saturate(fogFactor);
}
`;
