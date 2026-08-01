// Lights barrel.
export { Light, parseColor, type RGBColor } from './Light';
export { AmbientLight } from './AmbientLight';
export { DirectionalLight } from './DirectionalLight';
export { DirectionalLightShadow } from './DirectionalLightShadow';
export { PointLight } from './PointLight';
export { SpotLight } from './SpotLight';
export { HemisphereLight } from './HemisphereLight';
export { RectAreaLight } from './RectAreaLight';
export { LightProbe, SphericalHarmonics3 } from './LightProbe';
export { AmbientLightProbe } from './AmbientLightProbe';
export { HemisphereLightProbe } from './HemisphereLightProbe';
// 光探针生成器 (LightProbeGenerator) — 从立方体贴图积分 SH2 系数。
// 适配 three.js LightProbeGenerator.js,支持精确立体角 + 漫反射卷积。
export { LightProbeGenerator, type CubeMapData, type LightProbeCubeFace, type LightProbeGeneratorOptions } from './LightProbeGenerator';
