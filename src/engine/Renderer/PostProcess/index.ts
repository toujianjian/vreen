// PostProcess barrel — 增强后处理 Pass 集合。
//
// 与 RenderPass.ts 中的基础后处理 Bloom/CA/Vignette/FinalCompose 平行。
// 本模块提供 24 个增强 Pass:
//   - ColorGradingPass  : 色彩分级(8 个 ASC-CDL 参数)
//   - LUTPass           : LUT 色彩查找表(3D 或 2D strip)
//   - ChromaticAberrationPass : 增强色差(Vector2 偏移 + 径向调制)
//   - VignettePass      : 增强暗角(offset/darkness + 颜色染色)
//   - FilmGrainPass     : 胶片颗粒(强度/大小/动画)
//   - AfterimagePass    : 残影(跨帧累积)
//   - PixelationPass    : 像素化(马赛克)
//   - SSRPass           : 屏幕空间反射(独立类,不继承 RenderPass)
//   - VolumetricFogPass : 体积雾 + 体积光(独立类,不继承 RenderPass)
//   - VelocityPass     : 速度缓冲生成(供 TAA / MotionBlur 消费)
//   - TAAPass          : 时间抗锯齿(Halton jitter + 邻域裁剪 + 历史混合)
//   - MotionBlurPass   : 运动模糊(基于速度的方向性模糊)
//   - AutoExposurePass : 自动曝光(眼适应,降采样 + 对数平均 + 指数适应)
//   - GTAOPass         : Ground Truth 环境光遮蔽(半球地平线积分)
//   - SSSSPass         : 屏幕空间次表面散射(可分离高斯 + 深度感知)
//   - DOFEnhancedPass  : 增强景深(CoC + 圆/六/八边形散景)
//   - SMAAPass         : 子像素形态学抗锯齿(3 pass + procedural LUT)
//   - UnrealBloomPass  : Unreal 风格多层 mip 高斯 Bloom + lens dirt
//   - SSGIPass         : 屏幕空间全局光照(8 射线余弦半球采样 + 时序抖动)
//   - ScreenSpaceShadowPass : 屏幕空间方向性接触阴影(深度缓冲 + 光向射线步进)
//   - TonemappingPass   : HDR→LDR 色调映射(ACES/Reinhard/AGX/Uncharted2/Linear)
//   - SharpenPass       : 对比度自适应锐化(AMD FidelityFX CAS,TAA 后细节恢复)
//   - FSRUpscalePass    : FSR1 EASU 空间上采样(低→高分辨率,边缘自适应)
//
// 注意:
//   - 前 7 个 Pass 都实现 RenderPass 接口,可直接加入 PostProcessingPipeline。
//   - SSRPass / VolumetricFogPass / VelocityPass / TAAPass / MotionBlurPass /
//     AutoExposurePass / GTAOPass / SSSSPass / DOFEnhancedPass / SSGIPass 签名包含
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
