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
// 级联阴影贴图 (CSM/PSSM) — 大型户外场景多级阴影。
// 适配 three.js CSM.js 与 o3de Atom CascadedShadows。
// 提供 logarithmic / uniform / practical (PSSM λ 混合) 三种分割方案 +
// tight 光源正交投影 + texel grid 稳定化,消除相机移动时的阴影抖动。
export {
  CascadedShadowMap,
  type Cascade,
  type SplitScheme,
  type CascadedShadowMapOptions,
} from './CascadedShadowMap';
// 镜头光晕 (Lens Flare) — CPU 侧合成 Pass。
// 适配 three.js Lensflare.js 与 o3de Atom LensFlarePass。
// 提供 core/halo/ghost/streak 四种 flare 元素 + 沿轴分布 +
// 方向判定 + 可选 ray-sphere 遮挡测试 + additive 合成到 RGBA 像素。
// 不依赖 WebGL,可在 Node/无头环境运行(与 MotionBlurPass/TAAPass 同构)。
export {
  LensFlare,
  DEFAULT_FLARES,
  type FlareKind,
  type FlareElement,
  type LensFlareOptions,
  type LensFlareStats,
  type LensFlareInput,
  type LensFlareCamera,
  type OccluderSphere,
} from './LensFlare';
// Weighted Blended Order-Independent Transparency (OIT) — CPU 侧合成。
// 适配 McGuire & Bavoil 2013 (GPU Pro 5) / three.js / o3de Atom。
// accumulate + revealage 双缓冲,深度加权,顺序无关。
// 不依赖 WebGL,可在 Node/无头环境运行 (与 LensFlare/MotionBlurPass 同构)。
export {
  WeightedBlendedOIT,
  type OITFragment,
  type OITOptions,
} from './OIT';
// OutlinePass — 物体描边/轮廓高亮 (CPU 侧合成)。
// 适配 three.js OutlinePass.js,mask → 高斯模糊 → 边缘检测 → 叠加。
// 不依赖 WebGL,可在 Node/无头环境运行 (与 LensFlare/OIT 同构)。
export {
  OutlinePass,
  type OutlineOptions,
  type OutlineInput,
} from './OutlinePass';
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
// 程序化房间环境贴图(简化版,数据驱动,不依赖 WebGL)。
// 适配自 three.js RoomEnvironment,生成 6 面 cube 数据用作 PBR IBL 默认光源,
// 可在无头 / 测试环境下直接采样或喂给 IBL 预过滤 pass。
export {
  RoomEnvironment,
  type RoomEnvironmentOptions,
  type CubeFaceData,
  type EnvironmentCubeData,
} from './RoomEnvironment';
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
// 离线光照贴图烘焙器(CPU 实现,directional/point/ambient 光源 + 可选 Monte Carlo AO + 高斯模糊降噪)。
// 与 PathTracer/GlobalIllumination 互补:本类用于离线烘焙静态光,运行时零计算成本。
export {
  LightmapBaker,
  type BakerLight,
  type BakerGeometry,
  type BakeOptions,
  type BakeResult,
} from './LightmapBaker';
// 平面镜面反射 (Planar Reflection) — CPU 侧反射数学库。
// 适配 three.js Reflector.js + Lengyel 斜截投影。
// 提供反射矩阵 / 镜像相机 / 斜截投影 / 纹理矩阵,不依赖 WebGL,可在 Node/无头环境测试。
export {
  Reflector,
  type ReflectorOptions,
  type MirrorCamera,
} from './Reflector';
// 平面折射 (Planar Refraction) — CPU 侧折射数学库。
// 适配 three.js Refractor.js + GLSL refract()。
// 提供 Snell 折射方向 / 全反射判定 / 临界角 / UV 位移估算 / 虚拟位置,
// 不依赖 WebGL,可在 Node/无头环境测试。与 Reflector 互补。
export {
  Refractor,
  refract,
  type RefractorOptions,
} from './Refractor';
// 红蓝立体合成 (Anaglyph Stereo) — CPU 侧左右眼图像合成。
// 适配 three.js AnaglyphEffect.js,支持 redCyan/redGreen/redBlue/amberBlue 4 种色彩模式。
// 不依赖 WebGL,可在 Node/无头环境测试。与 StereoCamera 互补。
export {
  AnaglyphEffect,
  createSolidImage,
  type AnaglyphOptions,
  type AnaglyphColorMode,
  type ImageData4,
} from './AnaglyphEffect';
// 视差屏障立体 (Parallax Barrier Stereo) — CPU 侧隔行/隔列交错左右眼。
// 适配 three.js ParallaxBarrierEffect.js,支持 horizontal/vertical/checkerboard 三种交错模式。
// 不依赖 WebGL,可在 Node/无头环境测试。与 AnaglyphEffect 互补。
export {
  ParallaxBarrierEffect,
  type ParallaxBarrierOptions,
  type InterlaceMode,
  type PBImageData,
} from './ParallaxBarrierEffect';
// GPUComputationRenderer — GPGPU 通用计算编排器(纹理 ping-pong + 依赖图)。
// 适配 three.js GPUComputationRenderer.js:Variable(数据纹理)+ 依赖图 +
// 拓扑序计算 + ping-pong 双缓冲 + CPU 内核(无头测试/降级)+ GLSL 包装生成。
// 不绑定 GL 上下文:实际渲染提交由调用方(WebGL2Renderer)完成,可在 Node/无头环境测试。
export {
  GPUComputationRenderer,
  type GPUKernel,
  type GPUVariableData,
  type GPUVariableUniforms,
  type GPUInitError,
  type GPUComputeStats,
} from './GPUComputationRenderer';
// PMREMGenerator — 预滤波 mipmap 辐照度环境贴图生成器(CPU 实现)。
// 适配 three.js PMREMGenerator.js + Karis 2013 split-sum GGX 重要性采样。
// 消费 RoomEnvironment / CubeCamera 输出的 cube data,生成 specular IBL mip 链
// + diffuse irradiance 卷积。纯 CPU,不依赖 WebGL,可在 Node/无头环境测试。
export {
  PMREMGenerator,
  type PMREMGeneratorOptions,
  type PMREMData,
  type PMREMFace,
  type PMREMFaceMip,
} from './PMREMGenerator';

