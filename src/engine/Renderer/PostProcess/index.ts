// PostProcess barrel — 增强后处理 Pass 集合。
//
// 与 RenderPass.ts 中的基础后处理 Bloom/CA/Vignette/FinalCompose 平行。
// 本模块提供 38 个增强 Pass + 1 个 LUT 混合器 + 1 个亮度直方图工具 + 1 个白平衡 Pass + 1 个 ACES 输出变换 Pass:
//   - ColorGradingPass  : 色彩分级(8 个 ASC-CDL 参数)
//   - LUTPass           : LUT 色彩查找表(3D 或 2D strip)
//   - ChromaticAberrationPass : 增强色差(Vector2 偏移 + 径向调制)
//   - VignettePass      : 增强暗角(offset/darkness + 颜色染色)
//   - FilmGrainPass     : 胶片颗粒(强度/大小/动画)
//   - AfterimagePass    : 残影(跨帧累积)
//   - PixelationPass    : 像素化(马赛克)
//   - SSRPass           : 屏幕空间反射(独立类,不继承 RenderPass)
//   - SSSRPass          : 随机屏幕空间反射(GGX 重要性采样 + 时序累积)
//   - VolumetricFogPass : 体积雾 + 体积光(独立类,不继承 RenderPass)
//   - VelocityPass     : 速度缓冲生成(供 TAA / MotionBlur 消费)
//   - TAAPass          : 时间抗锯齿(Halton jitter + 邻域裁剪 + 历史混合)
//   - MotionBlurPass   : 运动模糊(基于速度的方向性模糊)
//   - AutoExposurePass : 自动曝光(眼适应,降采样 + 对数平均 + 指数适应)
//   - GTAOPass         : Ground Truth 环境光遮蔽(半球地平线积分)
//   - SSSSPass         : 屏幕空间次表面散射(可分离高斯 + 深度感知)
//   - DOFEnhancedPass  : 增强景深(CoC + 圆/六/八边形散景)
//   - GlitchPass       : 数字故障(扫描线 + 像素抖动 + RGB 分裂)
//   - SMAAPass         : 子像素形态学抗锯齿(3 pass + procedural LUT)
//   - UnrealBloomPass  : Unreal 风格多层 mip 高斯 Bloom + lens dirt
//   - SSGIPass         : 屏幕空间全局光照(8 射线余弦半球采样 + 时序抖动)
//   - ScreenSpaceShadowPass : 屏幕空间方向性接触阴影(深度缓冲 + 光向射线步进)
//   - TonemappingPass   : HDR→LDR 色调映射(ACES/Reinhard/AGX/Uncharted2/Linear)
//   - HeightFogPass    : UE5 风格指数高度雾(单 pass Beer-Lambert 闭式积分)
//   - SharpenPass       : 对比度自适应锐化(AMD FidelityFX CAS,TAA 后细节恢复)
//   - FSRUpscalePass    : FSR1 EASU 空间上采样(低→高分辨率,边缘自适应)
//   - WaterSurfacePass  : 屏幕空间水面(Gerstner 波 + Schlick Fresnel 反射/折射)
//   - GodRaysPass       : 屏幕空间体积光束(crepuscular rays,径向采样 + 深度遮挡)
//   - ScreenSpaceLensFlarePass : 屏幕空间镜头光晕(ghosts + halo + starburst + 色散)
//   - LocalExposurePass : 局部曝光(对数空间局部-全局亮度差异驱动的曝光补偿)
//   - LensDistortionPass: 镜头畸变(Brown-Conrady 径向畸变 + RGB 色差,模拟广角/长焦镜头)
//   - ScreenSpaceRefractionPass : 屏幕空间折射(任意透明表面 + IOR + 色散 + Beer-Lambert 吸收)
//   - CloudShadowPass : 体积云阴影(沿太阳方向 ray-march 3D 噪声场,Beer-Lambert 透射率压暗场景)
//   - MotionBlurEnhancedPass : 深度感知运动模糊(邻域速度钳制 + 深度拒绝 + Halton 抖动)
//   - ScreenSpaceDecalPass : 屏幕空间延迟贴花(GBuffer 深度/法线重建世界位置 + 体积/角度剔除 + 4 混合模式 + ping-pong 链式)
//   - VolumetricCloudsPass : GPU 体积云 ray-march(3D 噪声 + Beer-Powder + 双叶 HG + 多散射 + 可选 v3 时序累积)
//   - PaniniProjectionPass : Panini 宽 FOV 圆柱投影(保持垂直线垂直 + 可选垂直投影 + 裁剪补偿)
//   - LookModificationPass : ASC-CDL 色彩决策表(Slope/Offset/Power + Saturation,影视行业标准)
//   - LUTBlender           : 多 LUT 层级混合器(最多 4 个 LUT 按 intensity+override 层级混合)
//   - LuminanceHistogram   : 128-bin 亮度直方图 + 自动曝光(百分位裁剪 + 非对称眼适应,与 o3de 对齐)
//   - WhiteBalancePass     : 白平衡(Bradford 色彩适应变换 CAT,temperature/tint → CIE xy → LMS 缩放)
//   - OutputTransformPass  : ACES 输出变换(10 种色调映射 + ACEScg→sRGB 色彩空间转换 + PQ HDR10 编码)
//   - SAOPass             : Scalable Ambient Obscurance(螺旋采样 28 点,比 GTAO 更快,性能敏感场景适用)
//   - FXAAEnhancedPass    : FXAA 3.11 增强版(12 步边缘搜索,3 种质量预设,可配置参数)
//
// 注意:
//   - 前 7 个 Pass 都实现 RenderPass 接口,可直接加入 PostProcessingPipeline。
//   - SSRPass / VolumetricFogPass / VelocityPass / TAAPass / MotionBlurPass /
//     AutoExposurePass / GTAOPass / SSSSPass / DOFEnhancedPass / SSGIPass /
//     WaterSurfacePass / GodRaysPass / ScreenSpaceLensFlarePass 等签名包含
//     额外的 GBuffer 纹理参数,不适配 RenderPass.apply(input, ctx) 抽象,
//     因此独立管理 FBO / program。
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
export { SSRPass, type SSRPassOptions } from './SSRPass';
export { SSSRPass, type SSSRPassOptions, importanceSampleGGX, schlickFresnel, reflectVec, type Vec3 } from './SSSRPass';
export { VolumetricFogPass, type VolumetricFogPassOptions } from './VolumetricFogPass';
export { VelocityPass, type VelocityPassOptions } from './VelocityPass';
export { TAAPass, type TAAPassOptions } from './TAAPass';
export { MotionBlurPass, type MotionBlurPassOptions } from './MotionBlurPass';
export { AutoExposurePass, type AutoExposurePassOptions } from './AutoExposurePass';
export { GTAOPass, type GTAOPassOptions } from './GTAOPass';
export { SSSSPass, type SSSSPassOptions } from './SSSSPass';
export { DOFEnhancedPass, type DOFEnhancedPassOptions } from './DOFEnhancedPass';
export { GlitchPass, type GlitchPassOptions } from './GlitchPass';
export { SMAAPass, type SMAAPassOptions } from './SMAAPass';
export {
  UnrealBloomPass,
  type UnrealBloomOptions,
} from './UnrealBloomPass';
export { SSGIPass, type SSGIPassOptions } from './SSGIPass';
export { ScreenSpaceShadowPass, type ScreenSpaceShadowPassOptions } from './ScreenSpaceShadowPass';
export { TonemappingPass, type TonemappingPassOptions, type TonemappingMode } from './TonemappingPass';
export { HeightFogPass, type HeightFogOptions } from './HeightFogPass';
export { SharpenPass, type SharpenPassOptions } from './SharpenPass';
export { FSRUpscalePass, type FSRUpscaleOptions } from './FSRUpscalePass';
export { WaterSurfacePass, type WaterSurfaceOptions } from './WaterSurfacePass';
export { GodRaysPass, type GodRaysOptions } from './GodRaysPass';
export {
  ScreenSpaceLensFlarePass,
  type ScreenSpaceLensFlareOptions,
} from './ScreenSpaceLensFlarePass';
export { LocalExposurePass, type LocalExposureOptions } from './LocalExposurePass';
export {
  LensDistortionPass,
  type LensDistortionOptions,
  type PrincipalPoint,
} from './LensDistortionPass';
export {
  ScreenSpaceRefractionPass,
  type ScreenSpaceRefractionOptions,
  type AbsorptionColor,
} from './ScreenSpaceRefractionPass';
export {
  CloudShadowPass,
  type CloudShadowOptions,
  type CloudShadowParams,
  type SunDirection,
  type WindOffset,
  type HeightDensity,
} from './CloudShadowPass';
export {
  MotionBlurEnhancedPass,
  type MotionBlurEnhancedOptions,
} from './MotionBlurEnhancedPass';
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
} from './ScreenSpaceDecalPass';
export {
  VolumetricCloudsPass,
  type VolumetricCloudsPassOptions,
} from './VolumetricCloudsPass';
export {
  PaniniProjectionPass,
  type PaniniProjectionOptions,
  type ProjectionCenter,
  paniniProject,
} from './PaniniProjectionPass';
export {
  LookModificationPass,
  type LookModificationOptions,
  type ASCCDLParams,
  type CDLColor,
  REC709_LUMA,
  ascCDL,
  isIdentityCDL,
} from './LookModificationPass';
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
} from './LUTBlender';
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
} from './LuminanceHistogram';
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
} from './WhiteBalancePass';
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
} from './OutputTransformPass';
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
} from './SAOPass';
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
} from './FXAAEnhancedPass';

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
} from './FastDepthAwareBlurPass';
