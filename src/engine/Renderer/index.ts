// Renderer barrel.

export { WebGL2Renderer, type RendererStats } from './WebGL2Renderer';
export { ShaderProgram } from './ShaderProgram';
export type { Renderer } from './Renderer';
export {
  RenderPass,
  PostProcessingPipeline,
  BloomPass,
  FinalComposePass,
  SSAOPass,
  FXAAPass,
  ToneMappingPass,
  GammaCorrectPass,
  DOFPass,
  ToneMappingMode,
  type PassContext,
  type PostProcessingFBOs,
} from './RenderPass';
// 增强后处理 Pass 集合(色彩分级 / LUT / 增强色差 / 增强暗角 / 胶片颗粒 / 残影 / 像素化)。
// 这些 Pass 与 RenderPass.ts 中的 BloomPass / FinalComposePass 互补,可加入
// PostProcessingPipeline 组合使用。ChromaticAberrationPass / VignettePass 的
// "增强版"位于此模块,API 与 RenderPass.ts 中同名基础版不同(Vector2 偏移 / Color 染色)。
export {
  ColorGradingPass,
  type ColorGradingOptions,
  LUTPass,
  type LUTPassOptions,
  ChromaticAberrationPass,
  type ChromaticAberrationEnhancedOptions,
  VignettePass,
  type VignetteEnhancedOptions,
  FilmGrainPass,
  type FilmGrainOptions,
  AfterimagePass,
  type AfterimageOptions,
  PixelationPass,
  type PixelationOptions,
} from './PostProcess';
export {
  ShadowMapManager,
  type ShadowType,
  type ShadowMapManagerOptions,
  isCastShadowLight,
} from './ShadowMapManager';
// 多渲染目标(MRT)+ 几何缓冲(GBuffer,延迟渲染用)。
export { MRTTarget, type MRTSetupOptions } from './MRTTarget';
export { GBuffer, type GBufferOptions } from './GBuffer';
// 延迟渲染器(基于 GBuffer,geometry + lighting 双 pass)。
export {
  DeferredRenderer,
  type DeferredRendererOptions,
  type DeferredRendererStats,
  type DeferredLight,
} from './DeferredRenderer';
// 反射探针 + 管理器(局部 IBL 立方体贴图捕获)。
export { ReflectionProbe, type ReflectionProbeOptions } from './ReflectionProbe';
export {
  ReflectionProbeManager,
  type ReflectionProbeManagerOptions,
} from './ReflectionProbeManager';
// CPU 简化路径追踪器(参考/验证用,渐进式累积)。
export { PathTracer, type PathTracerOptions } from './PathTracer';

