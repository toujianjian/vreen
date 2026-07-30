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
// Forward+ 渲染器(前向渲染 + 屏幕分块光源剔除,支持大量点光源)。
export {
  ForwardPlusRenderer,
  type ForwardPlusRendererOptions,
  type ForwardPlusStats,
  type ForwardPlusLight,
} from './ForwardPlusRenderer';
// 反射探针 + 管理器(局部 IBL 立方体贴图捕获)。
export { ReflectionProbe, type ReflectionProbeOptions } from './ReflectionProbe';
export {
  ReflectionProbeManager,
  type ReflectionProbeManagerOptions,
} from './ReflectionProbeManager';
// CPU 简化路径追踪器(参考/验证用,渐进式累积)。
export { PathTracer, type PathTracerOptions } from './PathTracer';
// 实时光线追踪渲染器(CPU 路径追踪 + BVH 加速 + 蒙特卡洛采样 + 分块 + 降噪)。
// 与 PathTracer 互补:本类面向准实时渲染,引入 MeshBVH 加速 / 环境贴图 / 分块 / 降噪。
export {
  RayTracingRenderer,
  type RayTracingRendererOptions,
  type RayTracingStats,
  type RayTracingHit,
  type EnvironmentMap,
} from './RayTracingRenderer';
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
// 多线程渲染支持(Web Worker + 命令缓冲 + 同步)。
// 不绑定 GL 上下文:本类是"命令编排器",把 CPU 侧命令准备/排序工作放到
// worker,主线程消费 getSortedCommands() 的输出做实际 GL 提交。
// Worker 不可用时(Node/无头测试)自动降级为主线程同步模式,API 行为一致。
export {
  ThreadedRenderer,
  type RenderCommand,
  type RenderCommandType,
  type DrawCommandData,
  type UpdateBufferCommandData,
  type UpdateTextureCommandData,
  type ThreadedRendererStats,
} from './ThreadedRenderer';
// CPU 侧时间抗锯齿 Pass(基于 Float32Array 历史缓冲,不依赖 WebGL)。
// 与 PostProcess/TAAPass.ts(GPU 纹理版)互补:本类用于离线 / 无头环境,
// 提供 Halton 抖动 + 重投影 + 邻域夹紧(AABB/Catmull-Rom)+ 方差裁剪 +
// 历史混合 + 可选锐化,与 MotionBlurPass.ts(CPU 版)同构。
// 注意:本目录的 `TAAPass` 指 CPU 版;GPU 版需从 `./PostProcess/TAAPass`
// 显式导入(其 TAAPassOptions 与本类的 TAAOptions 不同名,无类型冲突)。
export {
  TAAPass,
  TAAPass as CpuTAAPass,
  type TAAOptions,
  type TAAInput,
  type TAACamera,
  type TAAStats,
  type Vec2 as TAAVec2,
} from './TAAPass';
// 渲染图系统(资源依赖管理 + Pass 调度 + 自动资源回收)。
// 不绑定具体 GL 资源类型:资源用 string 名标识,实际分配/释放由节点 execute
// 回调通过 RenderGraphContext 完成。支持拓扑排序 / 资源生命周期分析 /
// 未使用节点剔除 / 循环 / 冲突检测 / JSON 导入导出。
export {
  RenderGraph,
  type RenderGraphNode,
  type RenderGraphEdge,
  type RenderGraphResource,
  type CompiledPass,
  type ResourceLifetime,
  type RenderGraphStats,
  type RenderGraphExportData,
  type RenderGraphContext,
  type RenderGraphNodeKind,
  type RenderGraphResourceType,
  type RenderGraphResourceLifetime,
} from './RenderGraph';
// 渲染管线管理器(Forward/Deferred/Forward+ 切换 + Pass 组合 + 质量等级 + RenderGraph 集成 + 自动选择)。
// 编排器角色:不直接调用 GL,实际渲染由 PipelinePass.execute 回调完成,
// 使其可在无 WebGL 环境下测试。与具体渲染器(WebGL2Renderer/DeferredRenderer/ForwardPlusRenderer)解耦。
export {
  RenderPipelineManager,
  type RenderPipelineManagerOptions,
  type PipelineType,
  type QualityLevel,
  type PipelinePass,
  type PipelineRenderContext,
  type PipelineStats,
  type PipelineSceneStats,
  type QualitySettings,
  QUALITY_PRESETS,
} from './RenderPipelineManager';

