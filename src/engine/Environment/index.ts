// Environment barrel — 环境系统统一导出。
//
// 包含:
//   * WeatherSystem        — 天气系统(类型/强度/风/雾/光照)
//   * SkySystem            — 天空系统(日夜循环 / 太阳月亮位置 / 颜色)
//   * CloudSystem          — 云系统(粒子化云团 + 风漂移)
//   * PrecipitationSystem  — 降水系统(雨/雪粒子 + 重生)

export {
  WeatherSystem,
  type WeatherType,
  type WeatherData,
} from './WeatherSystem';
export { SkySystem, type DayPhase } from './SkySystem';
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
