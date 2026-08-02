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
// WaterInteraction — 水面交互系统 (涟漪 / 飞溅 / 浮力标记)。
// 解析涟漪叠加 (无网格), 与 WaterSimulation (波动方程网格) / FFTOcean (统计频谱) 解耦,
// 可作为额外高度层叠加, 适合大水面稀疏扰动 (玩家 / 投掷物)。
export {
  WaterInteraction,
  type Ripple,
  type Splash,
  type WaterInteractionOptions,
  type WaterInteractionStats,
} from './WaterInteraction';
// FFTOcean — FFT 海洋渲染系统 (Phillips 频谱 + IFFT + 泡沫 + 反射/折射数据)。
// 数据/计算层,产出 displacementMap / normalMap / foamMap 与着色器 uniform,
// 由 renderer / 水面 shader 消费。与 WaterSimulation (波动方程 ripples) 互补:
// FFTOcean 基于统计频谱,适合大范围开阔海域。
export {
  FFTOcean,
  type OceanRGB,
  type FFTOceanOptions,
  type FFTOceanUniforms,
  type FFTOceanStats,
} from './FFTOcean';
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
// GroundedSkybox — 地面投影天空盒 (适配自 three.js r159+)。
// 将环境贴图无缝投影到穹顶 + 地面,消除传统天空盒的天地夹角。
export { GroundedSkybox } from './GroundedSkybox';
// DecalSystem — 贴花管理系统 (子弹孔 / 血迹 / 弹痕 / 涂鸦 / 车辙)。
// 整合 DecalGeometry + 寿命/FIFO/渐隐/法线对齐,对标 o3de DecalComponent。
// CPU 端管理 Mesh pool,适合中小型 (< 1024) 贴花;未来可平滑升级到 instancing。
export {
  DecalSystem,
  type DecalRecord,
  type DecalSystemOptions,
  type DecalSystemStats,
} from './DecalSystem';
// SkyAtmosphere — GPU 物理大气散射 (UE5 SkyAtmosphere / Unity HDRP 风格)。
// 光线步进 Rayleigh + Mie + Ozone 吸收 + 多重散射近似 + 地面反射。
// 与 ProceduralSky (CPU Preetham 解析) 互补,面向影视级真实天空。
export {
  SkyAtmosphere,
  type AtmosphereRGB,
  type SkyAtmosphereUniforms,
  type SkyAtmosphereStats,
  type AtmospherePreset,
  EARTH_ATMOSPHERE,
  MARS_ATMOSPHERE,
} from './SkyAtmosphere';
