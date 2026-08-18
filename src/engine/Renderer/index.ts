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
  type FilmGrainParams,
  type FGColor,
  type GrainNoiseType,
  filmGrainPixel,
  hash21,
  DEFAULT_FILM_GRAIN_PARAMS,
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
// GPU Picking — O(1) 物体拾取(离屏 ID 渲染 + readPixels)。
// 适配 three.js ColorPickMesh + o3de Atom EditorMeshPickPass。
// 把每个可拾取物体编码为唯一 24-bit pickId,渲染到离屏 MRT FBO
// (attachment 0 = 物体 id,attachment 1 = 实例 id),开启深度测试,
// pick() 用 readPixels 单像素 O(1) 读取并解码。
// 与 Core/Raycaster 互补:Raycaster 逐三角形求交得精确 faceIndex/uv,
// O(三角形数);GPUPicking 只得 object+instanceId,O(1),适合海量物体
// 的编辑器框选 / 悬停高亮。纯函数 encodeId24/decodeId24 与 GLSL 1:1,
// 可在 Node/无头环境测试。44 个单元测试。
export {
  GPUPicking,
  encodeId24,
  decodeId24,
  encodeId24Uniform,
  MAX_PICK_ID,
  type GPUPickResult,
  type GPUPickingOptions,
} from './GPUPicking';
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
// SSGI — 屏幕空间全局光照 CPU 参考实现(纯函数,无 WebGL 依赖)。
// 适配自 Crytek SSDO (Ritschel 2009) / o3de Atom ScreenSpaceGlobalIllumination /
// UE5 Lumen Screen Space GI / EA SEED Stable SSAO。
// 与 PostProcess/SSGIPass.ts(GPU 纹理版)互补:本模块在 CPU 侧维护
// Float32Array 纹理,可在 Node/无头环境运行,用于验证 GPU shader 正确性
// + 离线光照贴图烘焙。
// 与 GLSL `SSGI_FRAG` chunk 1:1 对应:ign 抖动 / TBN 正交基 /
// 余弦加权半球采样 / 视空间厚度检测 / 自适应步长 / 边缘衰减。
// 额外提供生产级特性:temporalAccumulate() 时序累积(重投影+邻域夹稳) /
// denoiseSpatial() 空间降噪(边保持模糊) / varianceClip() 方差裁剪(鬼影抑制)。
// 与 SSR/GTAO 互补:SSR=镜面反射,SSGI=漫反射间接光,GTAO=环境遮蔽。
// 与 GlobalIllumination/DDGIVolume 互补:DDGI=世界空间低频基底,SSGI=屏幕空间高频细节。
// 91 个单元测试,纯函数,不依赖 WebGL。
export {
  ign,
  buildTBN,
  cosineSampleHemisphere,
  projectToUV,
  viewDepth,
  sampleTextureClamp,
  hitTestVS,
  smoothstep,
  marchRay,
  computeSSGIPixel,
  executeSSGI,
  temporalAccumulate,
  ssgiNeighborhoodMinMax,
  denoiseSpatial,
  varianceClip,
  vadd,
  vsub,
  vscale,
  vdot,
  vcross,
  vlength,
  vnormalize,
  mat4TransformVec3,
  mat4ProjectVec3,
  applySSGIDefaults,
  DEFAULT_SSGI_OPTIONS,
  SSGI_TEMPORAL_FRAG,
  SSGI_DENOISE_FRAG,
  type SSGIVec3,
  type SSGITextureData,
  type SSGIMat4,
  type SSGICamera,
  type SSGIInput,
  type SSGIOptions,
  type SSGIStats,
  type SSGIRayHit,
} from './SSGI';
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
// BloomEnhancedPass — 深度感知保边 Bloom(PostProcess/ 顶层重导出)。
// 单 mip + FastDepthAwareBlur(H+V)→ bloom 限制在同一深度层内,前景/背景不互相污染。
// 与 UnrealBloomPass(5 级 mip + 普通高斯,跨深度边缘产生 halo)互补:
//   - BloomEnhanced:边缘锐利,适合 neon/cyberpunk 高对比场景
//   - UnrealBloom:大面积柔和辉光,适合户外 HDR 场景
// 4 次 GPU draw:Bright pass(soft knee)+ H blur + V blur + Composite(additive + dirt + tint)。
// 1:1 CPU/GPU 参考(luminance / brightPassPixel / bloomCompositePixel)。
// soup3D 仅有单级 box blur Bloom,无深度感知、无 soft knee、无 lens dirt、无 tint。
export {
  BloomEnhancedPass,
  brightPassPixel,
  bloomCompositePixel,
  DEFAULT_BLOOM_ENHANCED_PARAMS,
  type BEColor,
  type BrightPassParams,
  type BloomEnhancedOptions,
} from './PostProcess';
// DOFEnhancedPass — 增强景深后处理 Pass(PostProcess/ 顶层重导出)。
// 基于 Circle of Confusion (CoC) 的物理散景模型,支持圆/六边形/八边形散景形状。
// 16 方向采样 + bokehWeight 形状判定 + mix(center, blurred, coc) 合成。
// 1:1 CPU/GPU 参考(dofReconstructViewPos / dofBokehWeight / computeCoC /
// dofBokehRadius / dofSampleColor / dofPixel / computeDOF),纯函数不依赖 WebGL。
// 适配 Potmesil & Chakravarty 1981 + GPU Gems 1 Ch.23 + three.js BokehShader +
// o3de Atom DepthOfFieldBokehBlurPass。
// soup3D 无景深实现。
export {
  DOFEnhancedPass,
  dofReconstructViewPos,
  dofBokehWeight,
  computeCoC,
  dofBokehRadius,
  dofSampleColor,
  dofPixel,
  computeDOF,
  DEFAULT_DOF_PARAMS,
  DOF_SAMPLES,
  type DOFEnhancedPassOptions,
  type DOFParams,
  type DOFCameraParams,
  type DOFColor,
} from './PostProcess';

// LightingChannelMask — 灯光通道掩码(适配自 o3de Atom LightingChannelConfiguration)。
// 每盏灯与每个物体各持一个 32 位通道掩码;渲染时 (lightMask & objectMask) != 0 才照亮。
// 用途:角色专属灯(手电筒只照玩家)、枪口闪光(只照敌人/近物,不照整张地图)、
// UI 灯(发光面板不污染角色)、分区灯(室内不漏到室外)、触发器灯。
// o3de 用 5 通道,VREEN 扩展为 32 通道(与 Unreal 对齐)。默认全开(向后兼容)。
// soup3D 无通道概念,所有灯照亮所有物体。
export {
  LightingChannelConfiguration,
  channelMask,
  channelsMask,
  getChannel,
  setChannel,
  affects as lightingChannelAffects,
  hasAnyChannel,
  countChannels,
  listChannels,
  MAX_LIGHTING_CHANNELS,
  ALL_LIGHTING_CHANNELS,
  NO_LIGHTING_CHANNELS,
  DEFAULT_LIGHTING_CHANNEL,
  LIGHTING_CHANNEL_GLSL,
  type LightingChannelMask,
} from './LightingChannelMask';
// HierarchicalZBuffer — 层次化 Z 缓冲遮挡剔除(适配自 o3de Atom / UE5 HZB)。
// 把上一帧深度缓冲构建成 mip 金字塔(每级存最大深度),
// 对每个物体 AABB 投影到屏幕空间,选择合适 mip 级采样,
// 物体最近深度 > HZB 深度 → 被遮挡,可跳过绘制。
// 用途:GPU 驱动渲染海量物体批量遮挡剔除、室内场景墙后物体剔除、开放世界山体后物体剔除。
// 与视锥剔除互补:视锥内但被遮挡的物体也被跳过。
// o3de 用 MaskedOcclusionCulling(Intel SSE/AVX CPU 光栅化器)+ OcclusionCullingPlane(平面遮挡);
// VREEN 用纯 CPU Float32Array mip 金字塔,无 WebGL 依赖,可在 Node/无头环境测试。
// soup3D 无遮挡剔除,所有视锥内物体都提交绘制。
export {
  buildHZB,
  isOccluded,
  occlusionCull,
  makeFlatDepth,
  makeOccluderDepth,
  identityMatrix,
  orthoMatrix,
  HZB_GLSL,
  type HZB,
  type HZBMipLevel,
  type Occludee,
  type HZBCullResult,
  type HZBCullStats,
  type OcclusionTestOptions,
  type Vec3 as HZBVec3,
} from './HierarchicalZBuffer';
// AreaLightLTC — Linearly Transformed Cosines 区域光求值(CPU 参考实现)。
// 适配自 Heitz et al. 2016 "Real-Time Polygonal-Light Shading with Linearly
// Transformed Cosines" + three.js LTC.js + o3de Atom LtcCommon.cpp。
// 提供 ltcEvaluate(矩形面光源 irradiance 求值)+ ltcUv(LUT 采样坐标)+
// ltcEdgeVectorFormFactor / ltcClippedSphereFormFactor(球面形式因子)+
// evaluateRectAreaLight(specular + diffuse)+ computeAreaLighting(批量)+
// approximateLTCMatrix(测试用解析近似)+ makeRectVertices(顶点生成)。
// 纯函数,不依赖 WebGL,可在 Node/无头环境测试。
// soup3D 仅有点光源 / 方向光,无面光源。
export {
  ltcUv,
  ltcEdgeVectorFormFactor,
  ltcClippedSphereFormFactor,
  ltcEvaluate,
  evaluateRectAreaLight,
  computeAreaLighting,
  approximateLTCMatrix,
  makeRectVertices,
  mat3MulVec as ltcMat3MulVec,
  mat3MulMat3 as ltcMat3MulMat3,
  vec3 as ltcVec3,
  sub as ltcSub,
  add as ltcAdd,
  scale as ltcScale,
  dot as ltcDot,
  cross as ltcCross,
  length as ltcLength,
  normalize as ltcNormalize,
  saturate as ltcSaturate,
  LTC_LUT_SIZE,
  LTC_LUT_SCALE,
  LTC_LUT_BIAS,
  type Vec3 as LTCVec3,
  type Mat3 as LTCMat3,
  type LTCColor,
  type RectLightParams,
  type SurfacePoint as LTCSurfacePoint,
  type LTCResult,
} from './AreaLightLTC';
// MeshletRenderer — Meshlet 渲染器(meshlet 生成 + 可见性剔除 + indirect draw 打包)。
// 适配自 three.js meshopt_clusterizer / o3de Atom MeshletsModule / UE5 Nanite。
// 把大网格切分为 meshlet 簇(≤256 顶点 / ≤512 三角形),每个 meshlet 独立包围球 +
// 法线锥,支持视锥剔除 + 背面剔除 + HZB 遮挡剔除,可见 meshlet 打包为 indirect draw。
// 纯 CPU,不依赖 WebGL,可在 Node/无头环境测试。
// soup3D 无 meshlet / GPU 驱动渲染能力,所有 mesh 整体提交。
export {
  buildMeshlets,
  computeMeshletBounds,
  meshletInFrustum,
  meshletIsFrontFacing,
  meshletIsVisibleHZB,
  cullMeshlets,
  packMeshletDrawCommands,
  buildMeshletVertexIndexBuffers,
  meshletStats,
  type MeshletVec3,
  type MeshletData,
  type MeshletBounds,
  type MeshletBuildOptions,
  type MeshletBuildResult,
  type MeshletCullOptions,
  type MeshletCullResult,
  type MeshletDrawCommand,
} from './MeshletRenderer';
// VisibilityBuffer — 可见性缓冲(UE5 Nanite / o3de Atom 核心配套)。
// 适配自 o3de Atom `VisibilityBuffer.azsli`(packing 格式 + unpack 工具)+
// `DeferredMaterial`(visibility buffer pass + deferred shading)+ UE5 Nanite。
// 每像素写几何 ID(meshInfoIndex + triangleId + barycentrics + isFrontFace),
// 后续 shading pass 读 visbuf → 查表 → 插值 → 着色(完全解耦材质类型)。
// 与 GBuffer 对比:带宽减半,材质类型无限,与 meshlet/GPU 驱动渲染天然配合。
// 提供 CPU 软件光栅化参考实现 + 位打包/解包工具 + GLSL chunks(pack vert/frag + unpack utility)。
// 纯 CPU,不依赖 WebGL,可在 Node/无头环境测试。
// soup3D 无 visibility buffer / 延迟材质系统,采用前向渲染 + 简单 GBuffer。
export {
  // 位打包常量
  MESHINFO_BITS,
  MAX_MESHINFO,
  MESHINFO_MASK,
  MESHINFO_INVALID_BIT,
  MESHINFO_INVALID_MASK,
  FRONTFACE_BIT,
  FRONTFACE_MASK,
  // 位转换工具
  uintAsFloat,
  floatAsUint,
  // 打包/解包
  packVisibilityBuffer,
  unpackVisibilityBuffer,
  getMeshInfoIndex,
  // 重心坐标
  computeBarycentric2D,
  edgeFunctionBarycentric,
  // 光栅化
  rasterizeTriangle,
  buildVisibilityBuffer,
  pixelOffset,
  // 解压(用于延迟着色)
  decompressPixel,
  interpolateAttributes,
  fetchTriangleVertices,
  fetchInterpolatedPosition,
  // GLSL chunks
  VISIBILITY_BUFFER_PACK_UTILITY,
  VISIBILITY_BUFFER_PACK_VERT,
  VISIBILITY_BUFFER_PACK_FRAG,
  VISIBILITY_BUFFER_UNPACK_UTILITY,
  // 类型
  type VBVec3,
  type VBVec2,
  type VisibilityBufferEntry,
  type VisibilityBufferPacked,
  type MeshInfo,
  type VisibilityTriangle,
  type VisibilityBufferOptions,
  type VisibilityBufferResult,
  type VisibilityBufferStats,
  type DecompressedPixel,
} from './VisibilityBuffer';
// ExponentialShadowMap — 指数阴影贴图 (ESM) CPU 参考实现。
// 适配自 o3de Atom `EsmShadowmapsPass` + `DepthExponentiationPass` +
// Salvi 2008 "Fast Shadow Maps on a 1K Budget" + Annen et al. 2008 "Exponential Shadow Maps"。
// 把阴影贴图深度 d 通过 exp(c·d) 变换存储,利用 exp 的可加性使线性 / Gaussian 滤波合法,
// 从而避免 PCF 的 N×N 深度比较 + aliasing。滤波后 ESM 纹理可硬件 bilinear 采样,
// 软阴影只需 1-9 tap(PCSS 需 16-41 tap)。
// 与 ShadowMapManager(type='basic'|'pcf'|'pcss') 互补:VREEN 现有 4 种阴影方案。
// 与 o3de `ESM.azsli` SampleESM 函数 1:1 对应,纯 CPU Float32Array,无 WebGL 依赖。
// soup3D 仅 basic 硬阴影,无 ESM / 软阴影 / PCSS。
export {
  expDepthMap,
  filterESM,
  gaussianWeights,
  sampleESM,
  sampleESMFiltered,
  sampleESMPCF,
  makeBlockerShadowMapESM,
  makeFlatShadowMapESM,
  getESMStats,
  ESM_SAMPLE_GLSL,
  type ESMTexture,
  type ESMOptions,
  type ESMFilterOptions,
  type ESMStats,
} from './ExponentialShadowMap';
// VirtualShadowMap — 虚拟阴影贴图 (VSM) CPU 参考实现。
// 适配自 UE5 Virtual Shadow Maps (Engstrom & Persson, SIGGRAPH 2021) +
// o3de Atom VirtualShadowMapPass。把阴影贴图视为虚拟资源:将阴影视锥体
// 划分为固定大小 page(128×128),按需分配到物理 atlas(8192×8192),
// 对远离相机的区域使用更低 mip 级别,实现"每像素阴影分辨率自适应"。
// 核心数据结构:PageTable(虚拟 page → 物理 page 映射,LRU 淘汰)、
// PhysicalAtlas(大尺寸阴影纹理)。 mip 选择基于屏幕空间 texel 密度:
// texelRatio ≤ texelDensity → mip 0(最高分辨率),每翻倍升 1 级 mip。
// 与 ShadowMapManager(basic/PCF/PCSS)、CSMShadowMap、ESM 互补:
// VREEN 现有 5 种阴影方案覆盖全精度-性能谱。纯 CPU Float32Array,无 WebGL 依赖。
// soup3D 仅 basic 硬阴影,无虚拟阴影贴图。
export {
  computePagesPerSide,
  computeVirtualResolution,
  selectMipLevel,
  computePageId,
  packPageUV,
  computeAtlasPagesPerSide,
  computeAtlasCapacity,
  applyVSMDefaults,
  PageTable,
  sampleVSM,
  writePageToAtlas,
  readPageFromAtlas,
  vsmVisibility,
  vsmVisibilityPCF4,
  computeVisiblePages,
  VSM_SAMPLE_GLSL,
  DEFAULT_VSM_OPTIONS,
  type VSMOptions,
  type VirtualPageId,
  type PhysicalPage,
  type VSMSampleResult,
} from './VirtualShadowMap';
// ShadowmapAtlas — 阴影图集四叉树打包算法(适配自 o3de Atom ShadowmapAtlas)。
// 把不同尺寸的阴影贴图打包进一张 image array atlas,并构造 GPU 可用的扁平化
// 阴影索引表(根子表=切片数,非根子表=4,子表偏移跳转)。纯数据层,11 个单测。
// 与 VirtualShadowMap(VSM 虚拟分页)互补:后者做 on-demand 虚拟页表,
// 本类做经典"多阴影共享一张 atlas"的静态打包。
export {
  ShadowmapAtlas,
  INVALID_SHADOWMAP_INDEX,
  MIN_SHADOWMAP_IMAGE_SIZE,
  MAX_SHADOWMAP_IMAGE_SIZE,
  type ShadowmapAtlasOrigin,
  type ShadowmapIndexNode,
  type ShadowmapAtlasOptions,
} from './ShadowmapAtlas';
// MeshShaderPipeline — Mesh Shader 管线(Task + Mesh 两阶段,CPU 参考 + GLSL 模拟)。
// 适配自 o3de Atom MeshShaderPass / MeshShaderDispatchItem +
// NVIDIA Turing Mesh Shaders (SIGGRAPH 2019) + Vulkan VK_EXT_mesh_shader。
// 把传统 IA → VS → HS → DS → GS → RS → PS 管线替换为 Task Shader → Mesh Shader → RS → PS:
//   - Task Shader 在 GPU 上做 meshlet 级剔除(视锥/法线锥/HZB/LOD),只发射可见 meshlet;
//   - Mesh Shader 在 workgroup 内直接发射顶点和三角形,无需 IA、无 vertex buffer fetch。
// WebGL2 不原生支持 Mesh Shader,本模块提供 CPU 参考实现(可在 Node/无头环境运行)+
// GLSL chunks(用于未来 WebGL2 模拟 / WebGPU 集成)。
// 与 MeshletRenderer 互补:前者在 CPU 上做 meshlet 构建 + culling + indirect draw 打包;
// 本模块在 GPU 上做 meshlet culling + dispatch(更高效,避免 GPU→CPU readback)。
// 74 个单元测试,纯函数,不依赖 WebGL。
export {
  sphereInFrustum,
  coneBackfaceCulled,
  isMeshletOccluded,
  computeMeshletLOD,
  executeTaskShader,
  executeMeshShader,
  executeMeshShaderPipeline,
  mat4Multiply,
  meshletBoundsToCullData,
  flattenMeshShaderOutput,
  applyTaskShaderDefaults,
  applyMeshShaderDefaults,
  applyMeshShaderPipelineDefaults,
  DEFAULT_TASK_SHADER_OPTIONS,
  DEFAULT_MESH_SHADER_OPTIONS,
  DEFAULT_MESH_SHADER_PIPELINE_OPTIONS,
  TASK_SHADER_GLSL,
  MESH_SHADER_GLSL,
  type MSVec3,
  type MSMatrix4,
  type MeshletCullData,
  type TaskDispatchItem,
  type MeshShaderVertex,
  type MeshShaderTriangle,
  type MeshShaderOutput,
  type MeshShaderPipelineStats,
  type TaskShaderOptions,
  type MeshShaderOptions,
  type MeshShaderPipelineOptions,
  type TaskShaderInput,
  type MeshShaderInput,
} from './MeshShaderPipeline';
// MeshDistanceField — 网格距离场 (MDF) + 距离场软阴影 (DFSS) + 距离场环境光遮蔽 (DFAO)。
// 适配自 UE5 "Mesh Distance Fields" + "Distance Field Shadowing" +
// "Distance Field Ambient Occlusion" + Hart 1996 "Sphere Tracing" +
// Crassin et al. 2011 "Interactive Indirect Illumination Using Voxel Cone Tracing" +
// Ericson 2005 "Real-Time Collision Detection" §5.1.5(点-三角形距离)。
// 把网格表面编码为 3D 均匀网格上的有符号距离场,球面追踪沿光线步进,
// 每步前进"当前点到表面的最短距离",保证不穿透表面 → 无 aliasing,无 acne,自然软阴影。
// 与 ShadowMapManager(basic/PCF/PCSS)/ ESM / VSM / CSM 互补:
// 光空间方案受限于纹理分辨率与投影几何,SDF 是世界空间方案,无 bias 调参,无漏光。
// 同一 SDF 可复用于阴影 (DFSS)、AO (DFAO)、碰撞、GI、粒子碰撞,内存独立于场景复杂度。
// 纯 CPU Float32Array 实现,无 WebGL 依赖,可在 Node/无头环境测试。
// soup3D 仅 basic 硬阴影,无 SDF / DFSS / DFAO;VREEN 现有 6 种阴影方案覆盖全精度-性能谱。
export {
  // 向量工具
  vadd as mdfVadd,
  vsub as mdfVsub,
  vscale as mdfVscale,
  vdot as mdfVdot,
  vcross as mdfVcross,
  vlength as mdfVlength,
  vnormalize as mdfVnormalize,
  // 几何基础
  pointTriangleDistanceSq,
  pointAABBSignedDistance,
  // SDF 构建
  computeMeshAABB,
  collectTriangles,
  isPointInsideMesh,
  rayTriangleIntersect,
  buildMeshSDF,
  buildSphereSDF,
  buildBoxSDF,
  // 索引与坐标变换
  idx3,
  idx3Dim,
  worldToVoxel,
  voxelToWorld,
  isInsideGrid,
  // SDF 采样
  sampleSDFNearest,
  sampleSDFTrilinear,
  sampleSDFGradient,
  // 球面追踪
  rayMarchSDF,
  // DFSS / DFAO
  dfssShadow,
  dfao,
  // 工具
  sdfMemoryBytes,
  sdfMemoryMB,
  getSDFStats,
  // GLSL 着色器块
  SDF_SAMPLE_GLSL,
  DFSS_SHADOW_GLSL,
  DFAO_GLSL,
  MESH_DISTANCE_FIELD_GLSL,
  // 类型
  type MDFVec3,
  type MeshData as MDFMeshData,
  type SDFGrid,
  type SDFBuildOptions,
  type RayMarchResult,
  type DFSSOptions,
  type DFAOOptions,
} from './MeshDistanceField';

// VirtualTexturing — 稀疏虚拟纹理(Sparse Virtual Texture, SVT)系统。
// 适配自 o3de Atom "Virtual Texture" (Gems/Atom/Asset/ImageStreaming) +
// UE5 "Virtual Texturing" (TexturePageTable + FeedbackBuffer) +
// Mellor 2004 "Virtual Texture Mapping" + Niesner 2009
// "Practical Virtual Texture Rendering"。
// 把超大虚拟纹理(如 16384×16384)分页化,按需把被采样到的页面加载到有限的
// 物理纹理图集中,突破 GPU 显存上限。与 VirtualShadowMap(阴影虚拟纹理)同构:
// 两者都使用 PageTable(mip + pageX + pageY → physicalPage)+ PhysicalAtlas 模式。
// 与 TextureStreaming(Mip 级别流式)互补:TextureStreaming 按距离决定加载到
// 第几层 mip,整张纹理一次性加载某层完整 mip,适合"中等分辨率纹理 × N 张";
// VirtualTexturing 把单张超大纹理分页,只加载被采样的页面,
// 适合"单张超大纹理(地形 mega-texture、卫星图、8K+ 角色)"。
// 工作流程:GPU 渲染时写 FeedbackBuffer → CPU 分析反馈 → 分配物理槽位
// (无空闲时 LRU 驱逐)→ 异步加载页面数据 → 上传物理图集 → 更新 PageTable
// → shader 通过 PageTable 重映射 UV 采样物理图集。
// 纯 CPU 参考实现,无 WebGL 依赖,可在 Node/无头环境测试。
// soup3D 无虚拟纹理/纹理流式系统;VREEN 有 TextureStreaming + SVT 双方案。
export {
  // 工具函数
  ceilLog2 as vtCeilLog2,
  computeMipCount as vtComputeMipCount,
  pagesAtMip as vtPagesAtMip,
  pageByteSize as vtPageByteSize,
  physicalPagesPerSide as vtPhysicalPagesPerSide,
  physicalSlotCount as vtPhysicalSlotCount,
  physicalIndexToOffset as vtPhysicalIndexToOffset,
  virtualUVToPageCoord as vtVirtualUVToPageCoord,
  pageCoordToLinearIndex as vtPageCoordToLinearIndex,
  desiredMipForScreenSize as vtDesiredMipForScreenSize,
  // 类
  PageTable as VTPageTable,
  PhysicalTextureAtlas as VTPhysicalTextureAtlas,
  VirtualTexture as VTVirtualTexture,
  VirtualTexturingSystem,
  // 常量
  DEFAULT_VT_CONFIG,
  // GLSL 着色器块
  VIRTUAL_TEXTURE_GLSL,
  VT_FEEDBACK_GLSL,
  VT_PAGE_TABLE_GLSL,
  // 类型
  type VirtualTextureDescriptor,
  type PageStatus,
  type VirtualPageCoord as VTVirtualPageCoord,
  type PageTableEntry as VTPageTableEntry,
  type FeedbackEntry as VTFeedbackEntry,
  type PhysicalPageSlot as VTPhysicalPageSlot,
  type PageProvider as VTPageProvider,
  type VirtualTexturingConfig,
  type VirtualTexturingStats,
} from './VirtualTexturing';

// VoxelConeTracing — 体素锥追踪全局光照(VXGI)。
// 适配自 Crassin et al. 2011 "Interactive Indirect Illumination Using Voxel
// Cone Tracing" + El Garawany 2013 SIGGRAPH course。
// 把场景体素化为 3D 网格(颜色 + 占据率 + 法线),构建 mip 链用于多分辨率采样。
// 沿锥形方向追踪,累积遮挡率与间接光照,同时产生 diffuse GI(宽锥,半球多锥)
// 和 specular GI(窄锥,反射方向单锥)。为离屏表面提供间接光照,无需探针布局。
// 与 SSGI(屏幕空间,仅可见表面)、DDGI(探针,需布局)、PathTracer(离线)互补:
// VXGI 是体素空间方案,覆盖离屏表面,无需探针,比 SSGI 精确(不受屏幕边界限制),
// 比 DDGI 灵活(无需手动放置探针),比 PathTracer 快(锥追踪 ≈ 10-30 步)。
// 纯 CPU 参考实现,无 WebGL 依赖,可在 Node/无头环境测试。
// soup3D 无任何 GI 系统;VREEN 现有 4 种 GI 方案(SSGI + DDGI + VXGI + PathTracer)。
export {
  // 向量工具
  vctVadd as vxgiVadd,
  vctVsub as vxgiVsub,
  vctVscale as vxgiVscale,
  vctVdot as vxgiVdot,
  vctVcross as vxgiVcross,
  vctVlength as vxgiVlength,
  vctVnormalize as vxgiVnormalize,
  vctVreflect as vxgiVreflect,
  // 颜色工具
  vctColorLerp as vxgiColorLerp,
  // 体素场景构建
  vctIdx3 as vxgiIdx3,
  worldToVoxelF as vxgiWorldToVoxelF,
  worldToVoxelI as vxgiWorldToVoxelI,
  voxelToWorld as vxgiVoxelToWorld,
  isVoxelInside as vxgiIsVoxelInside,
  collectTriangles as vxgiCollectTriangles,
  computeMeshAABB as vxgiComputeMeshAABB,
  voxelizeScene,
  // 采样
  sampleOccupancyTrilinear as vxgiSampleOccupancy,
  sampleColorTrilinear as vxgiSampleColor,
  // 锥追踪
  traceCone as vxgiTraceCone,
  fibonacciHemisphere as vxgiFibonacciHemisphere,
  traceDiffuseGI as vxgiTraceDiffuseGI,
  traceSpecularGI as vxgiTraceSpecularGI,
  traceIndirectLighting as vxgiTraceIndirectLighting,
  // 统计
  getVoxelSceneStats as vxgiGetStats,
  // GLSL 着色器块
  VOXEL_CONE_TRACING_GLSL,
  VOXELIZATION_GLSL,
  VOXEL_MIP_CHAIN_GLSL,
  // 类型
  type VCTColor as VXGIColor,
  type VCTVec3 as VXGIVec3,
  type VCTMeshData as VXGIMeshData,
  type VoxelMipLevel,
  type VoxelScene,
  type Cone as VXGICone,
  type ConeTraceResult,
  type DiffuseGIOptions,
  type SpecularGIOptions,
} from './VoxelConeTracing';

// LightPropagationVolume — 光传播体(LPV)全局光照。
// 适配自 Kaplanyan 2009 "Light Propagation Volumes in CryEngine 3" +
// Kaplanyan & Dachsbacher 2010 "Propagation of Radiance"。
// 把直接光照注入到 3D SH2 网格,迭代传播产生多 bounce 间接光照,
// 采样时三线性插值 8 个邻近 cell 的 SH 系数 + evaluateSH 得到漫反射间接光。
// 与 SSGI(屏幕空间,仅可见表面)、DDGI(探针,需布局)、VXGI(体素,需体素化)、
// PathTracer(离线)互补:LPV 是网格传播方案,无需探针布局/体素化,
// 覆盖离屏表面,支持多 bounce,实时性能好(SH 传播 O(N³ × iterations × 6))。
// VREEN 现有 5 种 GI 方案(SSGI + DDGI + VXGI + LPV + PathTracer)。
// 纯 CPU 参考实现,无 WebGL 依赖,可在 Node/无头环境测试。
// soup3D 无任何 GI 系统;VREEN 在 GI 完整性上具有压倒性优势。
export {
  // 常量
  SH2_COEFFS_PER_CELL as LPV_SH2_COEFFS_PER_CELL,
  // 向量工具
  lpvNormalize,
  lpvDot,
  // SH2 工具
  shBasis as lpvShBasis,
  computeSHRGB as lpvComputeSHRGB,
  evaluateSHRGB as lpvEvaluateSHRGB,
  // 网格索引
  cellIndex as lpvCellIndex,
  worldToCellF as lpvWorldToCellF,
  worldToCellI as lpvWorldToCellI,
  isCellInside as lpvIsCellInside,
  isCellBlocked as lpvIsCellBlocked,
  // 网格创建与管理
  createLPV,
  resetLPV,
  getCellSH as lpvGetCellSH,
  addToCellSH as lpvAddToCellSH,
  // 光注入
  injectPointLight as lpvInjectPointLight,
  injectDirectionalLight as lpvInjectDirectionalLight,
  injectEmissiveSurface as lpvInjectEmissiveSurface,
  injectEmissiveSurfaces as lpvInjectEmissiveSurfaces,
  // 光传播
  propagateStep as lpvPropagateStep,
  propagateLight as lpvPropagateLight,
  // 采样
  sampleLPV,
  sampleDiffuseGI as lpvSampleDiffuseGI,
  // 几何体
  buildGeometryVolume as lpvBuildGeometryVolume,
  // 统计
  getLPVStats,
  // GLSL 着色器块
  LPV_GLSL,
  LPV_INJECTION_GLSL,
  LPV_PROPAGATION_GLSL,
  // 类型
  type LPVVec3,
  type LPVColor,
  type LPVPointLight,
  type LPVDirectionalLight,
  type LPVEmissiveSurface,
  type LPVConfig,
  type LPVGrid,
} from './LightPropagationVolume';

// VariableRateShading — 可变速率着色 (VRS) 瓦片分类系统。
// 适配自 o3de Atom `AZ::RHI::ShadingRate` + `RasterPass::FragmentShadingRate` +
// UE5 VariableRateShading 插件 + VK_KHR_fragment_shading_rate / D3D12 VRS。
// 把屏幕划分为瓦片(8×8 / 16×16 / 32×32),每瓦片指定一个着色速率
// (1x1 / 1x2 / 2x1 / 2x2 / 2x4 / 4x2 / 4x4),GPU 在低速率瓦片内减少像素着色器调用。
// 4 种分类策略可组合:Motion(速度大→降低)、Depth(平坦→降低)、
// Foveated(外围→降低,VR 用)、Luminance(低对比度→降低)。
// VRSTileClassifier 取多策略中最保守(最高)速率,确保不丢关键细节。
// WebGL2 无硬件 VRS,提供 multi-resolution 合成器作为软件降级方案 +
// GLSL chunks 供未来 WebGPU / 硬件 VRS 集成。
// 与 TAA/TSR 协同:VRS 提供性能,TAA/TSR 重建细节。
// 与 HZB 正交:HZB 减少顶点处理(剔除不可见物体),VRS 减少像素处理(降低低敏感区域)。
// soup3D 无 VRS / 注视点渲染;VREEN 在性能优化维度领先。
// 50 个单元测试,纯函数,不依赖 WebGL。
export {
  ShadingRate,
  ALL_SHADING_RATES,
  shadingRateCoverage,
  shadingRateHStep,
  shadingRateVStep,
  shadingRateName,
  createVRSImage,
  getTileRate,
  setTileRate,
  pixelToTile,
  getPixelRate,
  computeVRSStats,
  classifyMotionVRS,
  classifyDepthVRS,
  classifyFoveatedVRS,
  classifyLuminanceVRS,
  VRSTileClassifier,
  compositeMultiResolution,
  VRS_PRESETS,
  VRS_GLSL,
  VRS_FEEDBACK_GLSL,
  type VRSImage,
  type VRSStats,
  type MotionVRSOptions,
  type DepthVRSOptions,
  type FoveatedVRSOptions,
  type LuminanceVRSOptions,
  type VRSStrategy,
  type VRSPreset,
} from './VariableRateShading';

