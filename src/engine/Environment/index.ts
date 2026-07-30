// Environment barrel — 环境系统统一导出。
//
// 包含:
//   * WeatherSystem        — 天气系统(类型/强度/风/雾/光照)
//   * SkySystem            — 天空系统(日夜循环 / 太阳月亮位置 / 颜色)
//   * CloudSystem          — 云系统(粒子化云团 + 风漂移)
//   * PrecipitationSystem  — 降水系统(雨/雪粒子 + 重生)
//   * VegetationSystem     — 植被系统(大规模草地/树木 InstancedMesh + LOD)
//   * VegetationType       — 植被类型定义(几何/材质/放置规则)
//   * WaterSystem          — 水域系统(水面网格 + 波动 + 水下雾)
//   * WaterSimulation      — 水面波动模拟(2D 波动方程 ripples)

export {
  WeatherSystem,
  type WeatherType,
  type WeatherFogColor,
  type WeatherParams,
  type WeatherShaderUniforms,
} from './WeatherSystem';
export { SkySystem, type DayPhase } from './SkySystem';
// ProceduralSky — 程序化天空 (Preetham 大气散射近似 + 太阳/月亮/星星/云)
// 与 SkySystem 互补:SkySystem 用关键帧调色;ProceduralSky 基于物理近似,可对接 shader uniform。
export {
  ProceduralSky,
  type SkyRGB,
  type AtmosphereSample,
  type ProceduralSkyStats,
  type ProceduralSkyUniforms,
} from './ProceduralSky';
export {
  CloudSystem,
  type Cloud,
  type CloudParticle,
  type CloudMeshData,
} from './CloudSystem';
export {
  PrecipitationSystem,
  type PrecipitationType,
  type PrecipitationParticle,
  type PrecipitationMeshData,
} from './PrecipitationSystem';
export {
  VegetationSystem,
  type VegetationPatch,
  type VegetationInstance,
  type VegetationStats,
} from './VegetationSystem';
export {
  VegetationType,
  type VegetationTypeOptions,
} from './VegetationType';
export {
  VegetationRenderer,
  // 重命名:VegetationPatch 与 VegetationSystem 中的同名接口冲突,
  // barrel 以 VegetationRenderPatch 别名导出 VegetationRenderer 的版本。
  // 直接 import 自 './VegetationRenderer' 仍可用原名 VegetationPatch。
  type VegetationPatch as VegetationRenderPatch,
  type VegetationTypeKind,
  type Season,
  type VegetationRendererOptions,
  type VegetationLODInfo,
  type VegetationRendererStats,
} from './VegetationRenderer';
export {
  WaterSystem,
  type UnderwaterFog,
} from './WaterSystem';
export {
  WaterSimulation,
} from './WaterSimulation';
// VolumetricClouds — 体积云渲染系统(噪声生成 + 光线步进 + 照明)。
// 数据/计算层,产出密度场与着色器 uniform,由 renderer / 天空盒 shader 消费。
export {
  VolumetricClouds,
  type CloudRGB,
  type NoiseResolution,
  type VolumetricCloudsUniforms,
  type VolumetricCloudsData,
  type VolumetricCloudsStats,
} from './VolumetricClouds';
