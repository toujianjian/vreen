// PostProcess barrel — 增强后处理 Pass 集合。
//
// 与 RenderPass.ts 中的基础后处理 Bloom/CA/Vignette/FinalCompose 平行。
// 本模块提供 7 个增强 Pass:
//   - ColorGradingPass  : 色彩分级(8 个 ASC-CDL 参数)
//   - LUTPass           : LUT 色彩查找表(3D 或 2D strip)
//   - ChromaticAberrationPass : 增强色差(Vector2 偏移 + 径向调制)
//   - VignettePass      : 增强暗角(offset/darkness + 颜色染色)
//   - FilmGrainPass     : 胶片颗粒(强度/大小/动画)
//   - AfterimagePass    : 残影(跨帧累积)
//   - PixelationPass    : 像素化(马赛克)
//
// 这些 Pass 都实现 RenderPass 接口,可直接加入 PostProcessingPipeline。
//
// 注意:
//   - ChromaticAberrationPass 与 VignettePass 的"增强版"位于本目录,
//     与 RenderPass.ts 中的同名基础版 API 不同(基础版仅 float offset)。
//     Renderer/index.ts 默认从本目录导出增强版;如需基础版请显式
//     从 './RenderPass' 导入。

export { ColorGradingPass, type ColorGradingOptions } from './ColorGradingPass';
export { LUTPass, type LUTPassOptions } from './LUTPass';
export {
  ChromaticAberrationPass,
  type ChromaticAberrationEnhancedOptions,
} from './ChromaticAberrationPass';
export { VignettePass, type VignetteEnhancedOptions } from './VignettePass';
export { FilmGrainPass, type FilmGrainOptions } from './FilmGrainPass';
export { AfterimagePass, type AfterimageOptions } from './AfterimagePass';
export { PixelationPass, type PixelationOptions } from './PixelationPass';
