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
// PCSS (Percentage-Closer Soft Shadows) — 物理软阴影采样器(CPU 参考实现)。
// 实现 Ferrari 2005 三步算法:blocker search + penumbra estimation + variable-rate PCF。
// 与 GLSL `PCSS_SHADOW_FRAG` chunk 1:1 对应,纯函数,不依赖 WebGL,可在 Node/无头环境测试。
// ShadowMapManager(type='pcss') 在 GPU 端用 PCSS_SHADOW_FRAG,本类是其 CPU 参考实现。
export {
  sampleShadowDepth,
  findBlocker,
  computePenumbra,
  samplePCF,
  samplePCSS,
  samplePCSSWithStats,
  makeFlatShadowMap,
  makeBlockerShadowMap,
  POISSON_DISK_16,
  type ShadowMapData,
  type BlockerSearchResult,
  type PCSSOptions,
  type PCSSStats,
} from './PCSSSampler';
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
// CSMShadowMap — 级联阴影贴图管理器 v2(PSSM 分割 + 级联间混合 + texel bias 缩放)。
// 与 CascadedShadowMap 互补:后者偏算法层(分割+tight 投影),前者偏资源管理
// (阴影纹理分配 + 级联元数据 + shader uniform 上传)。两者可配合使用。
export {
  CSMShadowMap,
  type CSMShadowMapOptions,
  type CascadeInfo,
} from './CSMShadowMap';
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
// DDGIVolume — 动态漫反射全局光照(3D 探针网格 + SH2 + 时序累积 + 遮挡测试)。
// 适配 UE5 Lumen IrradianceField / o3de Atom DiffuseGlobalIllumination。
// 纯逻辑,无 GL 依赖,可在 Node/无头环境测试。
export {
  DDGIVolume,
  type DDGIVolumeOptions,
  type IVec3 as DDGIVec3,
  packProbeIndex,
  unpackProbeIndex,
  computeTrilinearWeights,
  blendProbeSH,
  probeOcclusionWeight,
} from './DDGIVolume';
// DDGIDebugVisualizer — DDGI 探针网格调试可视化(位置/有效性/SH2 辐照度/遮挡深度)。
// 把 DDGIVolume 内部状态绘制到 DebugRenderer,对标 o3de Atom DebugDraw / UE5 Lumen.Visualize。
// 纯逻辑,无 GL 依赖,复用 DebugRenderer 数据 API。
export {
  DDGIDebugVisualizer,
  type DDGIDebugOptions,
  heatColor,
  tonemapColor,
  probeIrradianceColor,
  probeValidityColor,
} from './DDGIDebugVisualizer';
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
// BRDFLUT — split-sum BRDF 积分查找表 (Karis 2013 第二部分)。
// 生成 2D RG LUT (NoV × roughness → scale/bias),与 PMREMGenerator 配对
// 完成完整 PBR IBL:specularIBL = prefilteredEnv * (scale*F0 + bias)。
// 纯 CPU,离线烘焙一次,运行时作为 RG 纹理上传。
export {
  BRDFLUT,
  type BRDFLUTOptions,
  type BRDFLUTData,
} from './BRDFLUT';
// SubsurfaceScattering — Pre-Integrated Skin 工具集(曲率 + 背光透射 + 混合)。
// 补充 Core/PreIntegratedSkinLUT.ts(LUT 生成)+ SSSSPass(屏幕空间模糊)+
// SubsurfaceScatteringMaterial(材质 shader)。从 Core 重新导出 LUT API。
export {
  generatePreIntegratedSkinLUT,
  samplePreIntegratedSkinLUT,
  skinScatterProfile,
  curvatureFromRadius,
  computeCurvature,
  computeCurvatureAveraged,
  backLightTransmission,
  mixSSSDiffuse,
  type PreIntegratedSkinLUTOptions,
  type PreIntegratedSkinLUTResult,
  type SkinColor,
} from './SubsurfaceScattering';
// TexturePool — 无绑定纹理池(适配自 o3de Atom Bindless)。
// 将多张纹理打包到 TEXTURE_2D_ARRAY,着色器通过整数索引访问。
// 用于 GPU 驱动渲染、地形材质混合、Instanced 渲染、Decal 系统。
export {
  TexturePool,
  type TexturePoolOptions,
  type TexturePoolStats,
} from './TexturePool';
// TemporalSuperResolution (TSR) — 时间超分辨率上采样 CPU 参考实现。
// 将低分辨率渲染结果上采样到高分辨率,利用时间历史重建细节,匹配 UE5 TSR / FSR2 / DLSS 级别。
// 与 TAAPass(同分辨率 TAA)互补:TSR 处理跨分辨率重建,核心难点是低分辨率输入
// ↔ 高分辨率历史之间的重投影与子像素累积。
// 与 GLSL `TSR_RESOLVE_FRAG` chunk 1:1 对应,纯函数,不依赖 WebGL,可在 Node/无头环境测试。
export {
  halton,
  getJitter,
  bilinearSampleRGBA,
  reprojectToHistory,
  neighborhoodMinMax,
  clampToAABB,
  catmullRomClamp,
  computeConfidence,
  easuSample,
  sharpen,
  resolveTSR,
  makeSolidBuffer,
  makeZeroVelocity,
  type PixelBuffer,
  type VelocityBuffer,
  type DepthBuffer,
  type TSROptions,
  type TSRStats,
} from './TemporalSuperResolution';
// SVGFDenoiserPass — Spatiotemporal Variance-Guided Filtering 去噪器(CPU 参考实现)。
// 适配 Schied et al. 2017 SVGF / UE5 Denoiser / o3de Atom DenoiserPass / NVIDIA NRD。
// 三阶段管线:时序累积(velocity 重投影)+ 方差估计(3×3 邻域)+ A-trous 小波滤波
// (5×5 cross 核 + 深度/法线/亮度边缘停止权重,迭代 4 次等效 33×33 大核)。
// 用于 SSR / SSGI / 路径追踪 / 随机阴影等低样本随机输入的高质量去噪。
// 与 GLSL `SVGF_TEMPORAL_FRAG` / `SVGF_VARIANCE_FRAG` / `SVGF_ATROUS_FRAG` chunks 1:1 对应,
// 纯函数,不依赖 WebGL,可在 Node/无头环境测试。
export {
  luminance as svgfLuminance,
  temporalAccumulation,
  estimateVariance,
  edgeStoppingWeight,
  atrousFilterIteration,
  svgfDenoise,
  makeSolidPixelBuffer,
  makeZeroVelocity as svgfMakeZeroVelocity,
  makeConstantDepth,
  makeConstantNormal,
  type SVGFPixelBuffer,
  type SVGFVelocityBuffer,
  type SVGFDepthBuffer,
  type SVGFNormalBuffer,
  type SVGFOptions,
  type SVGFStats,
} from './SVGFDenoiserPass';
// CausticsGenerator — 水下焦散 CPU 参考实现(与 GLSL `CAUSTICS_FRAG` 1:1 对应)。
// 三种模式:procedural(3-sine)/ gerstner(法线聚焦)/ hybrid(默认,procedural × gerstner)。
// 纯函数:causticPattern3Sin / gerstnerHeightNormal / causticFocusing / beerLambertAttenuation /
// waterLineFade / rgbDispersion / computeCaustics / reconstructWorldPos / resolveCaustics。
// 不依赖 WebGL,可在 Node/无头环境测试。用于 CausticsPass(GPU)的参考实现 + 离线渲染。
export {
  causticPattern3Sin,
  gerstnerHeightNormal,
  causticFocusing,
  beerLambertAttenuation,
  waterLineFade,
  rgbDispersion,
  computeCaustics,
  reconstructWorldPos,
  resolveCaustics,
  defaultGerstnerWaves,
  normalize2 as causticNormalize2,
  normalize3 as causticNormalize3,
  dot2 as causticDot2,
  dot3 as causticDot3,
  makeSolidBuffer as causticMakeSolidBuffer,
  makeConstantDepth as causticMakeConstantDepth,
  makeIdentityMatrix as causticMakeIdentityMatrix,
  type CausticMode,
  type GerstnerWave,
  type Vec2 as CausticVec2,
  type Vec3 as CausticVec3,
  type CausticsOptions as CausticsGeneratorOptions,
  type CausticsStats,
  type PixelBuffer as CausticPixelBuffer,
  type DepthBuffer as CausticDepthBuffer,
} from './CausticsGenerator';
// ScreenSpaceDecalPass — 屏幕空间延迟贴花(GPU Pass,PostProcess/ 顶层重导出)。
// 把贴花纹理投射到 GBuffer(深度/法线)描述的任意几何表面,支持体积剔除 +
// 角度剔除(防跨墙渗漏)+ 4 种混合模式(Alpha/Multiply/Additive/Normal)+
// 边缘淡化 + ping-pong 双缓冲链式多贴花。对标 UE5 Deferred Decals /
// o3de Atom Decal Pass;three.js DecalGeometry 为 CPU 几何式,本 pass 是其屏幕空间泛化。
export {
  ScreenSpaceDecalPass,
  type ScreenSpaceDecalOptions,
  type Decal,
  DecalBlendMode,
  projectToDecalLocal,
  decalAnglePass,
  decalEdgeFade,
  decalBlend,
  buildDecalMatrix,
  transformNormalToView,
} from './PostProcess';
// VolumetricCloudsPass — GPU 体积云 ray-march Pass(PostProcess/ 顶层重导出)。
// 把 VolumetricClouds(数据层)产出的 3D 噪声密度场 + 光照参数灌入
// VOLUMETRIC_CLOUDS_FRAG 片元 shader,执行 GPU ray-march:射线-AABB 求交 +
// 光线步进采样 3D 噪声 + Beer-Lambert/Powder + 双叶 HG 相位 + 多散射近似 +
// 可选 v3 时序累积(blue-noise 抖动 + 重投影 EMA)。对标 UE5 Volumetric Clouds /
// o3de Atom SkyAtmosphere + Clouds / Schneider & Vosin SIGGRAPH 2015。
// soup3D 仅有静态 skybox,无动态体积云。
export {
  VolumetricCloudsPass,
  type VolumetricCloudsPassOptions,
} from './PostProcess';
// PaniniProjectionPass — Panini 宽 FOV 圆柱投影后处理 Pass(PostProcess/ 顶层重导出)。
// 适配 o3de Atom PaniniProjectionPass + Sharpless et al. "Pannini" 投影论文。
// 在保持垂直线垂直的同时允许更宽的水平视场,不产生普通透视投影在广角下的"边缘拉伸"失真。
// depth 参数控制投影强度(0=接近透视,1=标准 Panini,>1=更强圆柱);
// vertical 选项对 Y 轴也应用投影(全景/360°);crop 补偿黑边。
// CPU 纯函数 paniniProject 与 GLSL `PANINI_PROJECTION_FRAG` chunk 1:1 对应,可在无头环境测试。
// soup3D 无投影失真校正。
export {
  PaniniProjectionPass,
  type PaniniProjectionOptions,
  type ProjectionCenter,
  paniniProject,
} from './PostProcess';
// LookModificationPass — ASC-CDL 色彩决策表后处理 Pass(PostProcess/ 顶层重导出)。
// 适配 o3de Atom LookModificationTransformPass + ASC-CDL 1.2 规范。
// 实现影视后期行业标准的 Slope/Offset/Power + Saturation 色彩变换:
//   out = (in * S + O) ^ P,然后 out = luma + sat * (out - luma)
// 与 ColorGradingPass(自有 8 参数)互补:本 Pass 严格遵循 ASC-CDL 标准,
// 可与 DaVinci Resolve / Nuke / Baselight 等专业调色工具交换 .cdl 文件。
// CPU 纯函数 ascCDL 与 GLSL `LOOK_MODIFICATION_FRAG` chunk 1:1 对应,可在无头环境测试。
// 恒等变换(全默认参数)时自动跳过 GPU 工作以节省开销。
// soup3D 无任何色彩决策表支持。
export {
  LookModificationPass,
  type LookModificationOptions,
  type ASCCDLParams,
  type CDLColor,
  REC709_LUMA,
  ascCDL,
  isIdentityCDL,
} from './PostProcess';
// LUTBlender — 多 LUT 层级混合器(PostProcess/ 顶层重导出)。
// 适配 o3de Atom BlendColorGradingLutsPass + LookModificationSettings。
// 将最多 4 个颜色分级 LUT 按优先级 + intensity + overrideStrength 层级混合,
// 生成单个 blended LUT 供 LUTPass 使用。适用于昼夜循环颜色过渡、区域/心情切换、叙事效果。
// 纯 CPU 实现(三线性采样 + o3de 层级权重公式),不依赖 WebGL,可在 Node/无头环境测试。
// 与 LUTPass 互补:LUTPass 应用单个 LUT,LUTBlender 在应用前把多个 LUT 预混合为一个,
// 每帧只需 1 次 LUT 采样(而非 N 次),显著降低 GPU 开销。
// soup3D 无任何 LUT 支持。
export {
  LUTBlender,
  computeBlendWeights,
  sampleLUT3D,
  blendLUTs,
  makeIdentityLUT,
  makeSolidLUT,
  MAX_BLEND_LUTS,
  type LUT3DData,
  type LUTBlendItem,
  type LUTBlendOptions,
} from './PostProcess';
// LuminanceHistogram — 128-bin 亮度直方图 + 自动曝光(PostProcess/ 顶层重导出)。
// 适配 o3de Atom LuminanceHistogramGeneratorPass + ExposureControlSettings。
// 生成 EV100 对数空间 128-bin 直方图,通过低/高百分位裁剪极端像素,
// 计算加权平均 EV 作为目标曝光,再用非对称指数眼适应(亮适应快/暗适应慢)平滑过渡。
// 与 AutoExposurePass(对数平均)互补:直方图法对天空过曝/阴影死黑更鲁棒。
// 纯 CPU 实现,可在 Node/无头环境测试,亦可用于驱动 GPU EyeAdaptationPass 的参数。
// soup3D 仅有简单的自动曝光,无直方图百分位裁剪。
export {
  LuminanceHistogram,
  computeHistogram,
  histogramToExposure,
  adaptExposure,
  luminanceToEV100,
  ev100ToLuminance,
  ev100ToBin,
  binToEV100,
  NUM_HISTOGRAM_BINS,
  DEFAULT_EV_MIN,
  DEFAULT_EV_MAX,
  type HistogramOptions,
  type AutoExposureOptions,
  type HistogramResult,
} from './PostProcess';
// WhiteBalancePass — 白平衡后处理(PostProcess/ 顶层重导出)。
// 适配 o3de Atom WhiteBalancePass + WhiteBalance.azsl。
// 通过 temperature/tint 参数调整场景白点,使用 Bradford 色彩适应变换(CAT):
//   1. (temperature, tint) → CIE xy 色度(目标白点)
//   2. xy → LMS 锥响应空间
//   3. balance = D65_LMS / target_LMS
//   4. input → LMS → LMS*balance → linear
// 与 ColorGradingPass 的 temperature/tint 不同:本 Pass 是物理 CAT 变换
// (改变感知白点,保持色域内颜色相对关系),与相机/电影白平衡一致。
// soup3D 无白平衡特性。
export {
  WhiteBalancePass,
  whiteBalance,
  temperatureTintToWhiteXY,
  xyToLMS,
  computeWhiteBalance,
  isIdentityWhiteBalance,
  D65_WHITE_X,
  D65_WHITE_LMS,
  LIN_2_LMS_MAT,
  LMS_2_LIN_MAT,
  type WBColor,
  type WhiteBalanceOptions,
} from './PostProcess';
// OutputTransformPass — ACES 输出变换后处理(PostProcess/ 顶层重导出)。
// 适配 o3de Atom OutputTransform.azsl + Tonemap.azsli + Aces.azsli。
// 提供 10 种行业级色调映射算子(Reinhard/ACES/AcesFitted/AcesFilmic/Filmic/
// AgX/AgxGolden/AgxPunchy/AgxWarm/PbrNeutral)+ ACEScg→sRGB 色彩空间转换 +
// 2 种传输函数(Gamma 2.2 / SMPTE ST 2084 PQ HDR10)+ EV 曝光补偿。
// 与基础 TonemappingPass(5 种算子,无色彩空间转换,无 HDR 输出)互补:
// 本 Pass 对齐 o3de/ACES/HDR10 工业标准,适用于专业级渲染管线。
// soup3D 仅有一个基础 Reinhard,无色彩空间转换,无 HDR 输出。
export {
  OutputTransformPass,
  outputTransform,
  tonemapReinhard,
  tonemapReinhardExtended,
  tonemapAcesFitted,
  tonemapAcesFilmic,
  tonemapFilmic,
  tonemapAgx,
  tonemapAgxInternal,
  tonemapAgxGolden,
  tonemapAgxPunchy,
  tonemapAgxWarm,
  tonemapPbrNeutral,
  acescgToLinearSrgb,
  perceptualQuantizerRev,
  perceptualQuantizerRevF3,
  linearCVToY,
  ACESCG_TO_SRGB,
  type TonemapperType,
  type TransferFunctionType,
  type OTColor,
  type OutputTransformOptions,
} from './PostProcess';
// SAOPass — Scalable Ambient Obscurance 后处理 Pass(PostProcess/ 顶层重导出)。
// 适配 three.js SAOPass.js + SAOShader.js(McGuire, Mara, Luebke 2012, HPG)。
// 螺旋采样 28 点(默认 numSamples=7 × numRings=4),每采样 O(1) 计算,
// 比 GTAO(4 方向 × 32 步地平线积分)更快,适合中低配 / 移动端 / VR。
// 与 GTAO 互补:GTAO 精度更高但更慢,SAO 性能更优但质量稍低。
// soup3D 无 SAO 实现。
export {
  SAOPass,
  saoRand,
  perspectiveDepthToViewZ,
  reconstructViewPos,
  saoOcclusion,
  saoSpiralSampleUV,
  computeSAO,
  DEFAULT_SAO_PARAMS,
  type SAOPassOptions,
  type SAOParams,
  type SAOCameraParams,
  type ViewSize,
  type SAOColor,
} from './PostProcess';
// FXAAEnhancedPass — FXAA 3.11 增强版抗锯齿 Pass(PostProcess/ 顶层重导出)。
// 适配 Timothy Lottes (NVIDIA) FXAA 3.11,PC High quality preset。
// 3 种质量预设(console/pcHigh/pcExtreme),8-10 步递减步长边缘搜索,
// 可配置 subpixel/edgeThreshold/edgeThresholdMin 参数。
// 与基础 FXAAPass(RenderPass.ts,2 步搜索)互补:增强版对齐工业标准 FXAA 3.11。
// 与 SMAA(3 pass,形态学搜索)/ TAA(时间累积)互补:FXAA 单 pass 最快,
// 适合移动端/VR/低端设备。VREEN 现在拥有 3 种 AA 方案覆盖全部场景。
// soup3D 无任何抗锯齿实现。
export {
  FXAAEnhancedPass,
  fxaaLuma,
  fxaaContrastCheck,
  fxaaEdgeDirection,
  fxaaEdgeWalk,
  fxaaComputeBlendFactor,
  fxaaPixel,
  DEFAULT_FXAA_PARAMS,
  FXAA_QUALITY_STEPS,
  type FXAAQuality,
  type FXAAColor,
  type FXAAParams,
  type FXAAEnhancedPassOptions,
} from './PostProcess';
// FastDepthAwareBlurPass — 深度感知可分离模糊 Pass(PostProcess/ 顶层重导出)。
// 适配 o3de Atom FastDepthAwareBlurPasses(Horizontal + Vertical)。
// 沿模糊方向逐纹素推进,用前后深度斜率差检测边缘,在边缘处递减混合权重,
// 防止前景/背景颜色渗色产生 halo。是 AO/SSGI/Bloom/DoF 等后处理的构建块:
// 普通高斯模糊会跨越深度边缘产生 halo,深度感知模糊把模糊限制在同一深度层内。
// H + V 双 pass(ping-pong FBO),O(2*blurRadius) 采样/像素。
// 1:1 CPU/GPU 参考(calculateDepthFalloff / blurDirection / fastDepthAwareBlurPixel)。
// soup3D 无深度感知模糊,任何需要保边模糊的效果都会产生 halo 或噪声。
export {
  FastDepthAwareBlurPass,
  calculateDepthFalloff,
  blurDirection,
  fastDepthAwareBlurPixel,
  DEFAULT_DAB_PARAMS,
  type BlurDirection,
  type DABColor,
  type DABParams,
  type FastDepthAwareBlurPassOptions,
} from './PostProcess';

