// PostProcess barrel — 增强后处理 Pass 集合。
//
// 与 RenderPass.ts 中的基础后处理 Bloom/CA/Vignette/FinalCompose 平行。
// 本模块提供 32 个增强 Pass:
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
