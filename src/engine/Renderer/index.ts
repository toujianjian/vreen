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
// 全局光照系统(光探针 SH2 + VXGI 简化版,补充 PBR 间接光)。
export {
  GlobalIllumination,
  computeSH,
  evaluateSH,
  type GIMode,
  type LightProbe,
  MAX_GI_PROBES,
  SH2_COEFF_COUNT,
  SH2_RGB_FLOATS,
} from './GlobalIllumination';
// CPU 侧运动模糊 Pass(基于 Float32Array 速度缓冲,不依赖 WebGL)。
// 与 PostProcess/MotionBlurPass.ts(GPU 纹理版)互补:本类用于离线 / 无头环境。
export {
  MotionBlurPass,
  type MotionBlurOptions,
  type MotionBlurInput,
  type MotionBlurStats,
  type MotionBlurCamera,
} from './MotionBlurPass';
// 增强版 SSR / VolumetricFog Pass(顶层,API 更完整,与 PostProcess/ 同名基础版互补)。
// SSRPass 接收 GBuffer 整体对象,支持 roughnessCutoff / maxDistance / fadeDistance / temporalEnabled。
// VolumetricFogPass 接收 Light[] 数组,支持 heightFog / lightScattering / froxelResolution。
export {
  SSRPass,
  type SSRPassOptions,
  type SSRStats,
} from './SSRPass';
export {
  VolumetricFogPass,
  type VolumetricFogPassOptions,
  type VolumetricFogStats,
  type FogColor,
  type FroxelResolution,
} from './VolumetricFogPass';
// 增强版 GTAO / ContactShadows Pass(顶层,API 更完整,与 PostProcess/ 同名基础版互补)。
// GTAOPass 接收 GBuffer 整体对象,支持 directions / samples / colorBleed / temporal / resolutionScale。
// ContactShadowsPass 仅需 input + camera,基于亮度高度代理做接触处柔和阴影,
// 支持 gaussian / box 两种模糊核。
export {
  GTAOPass,
  type GTAOPassOptions,
  type GTAOStats,
} from './GTAOPass';
export {
  ContactShadowsPass,
  type ContactShadowsPassOptions,
  type ContactShadowsStats,
} from './ContactShadowsPass';
// GPU 驱动渲染(间接绘制 indirect draw + 视锥/遮挡剔除 + 排序 + indirect buffer 打包)。
// 与 WebGL2Renderer(前向)/ DeferredRenderer(延迟)互补:适合海量实例的批量提交。
export {
  GPUDrivenRenderer,
  type DrawCommand,
  type GPUDrivenRendererOptions,
  type GPUDrivenRendererStats,
  INDIRECT_COMMAND_UINTS,
  INDIRECT_COMMAND_FLOATS,
} from './GPUDrivenRenderer';

