// Math barrel — 引擎数学库的统一导入出口。
// 与 three.js 的 `THREE` 命名空间对齐,便于跨引擎桥接。

// 向量
export { Vector2 } from './Vector2';
export { Vector3 } from './Vector3';
export { Vector4 } from './Vector4';

// 矩阵
// Matrix2 — 2×2 矩阵(列主序),three.js r169 Matrix2 的完整线性代数等价物:
// 补齐 three.js 原版缺失的行列式/求逆/转置/乘法/2D 旋转与缩放构造与
// 向量作用能力,可用于 2D 变换/纹理 UV/小矩阵数学。
export { Matrix2 } from './Matrix2';
export { Matrix3 } from './Matrix3';
export { Matrix4 } from './Matrix4';

// 旋转
export { Quaternion } from './Quaternion';
export { Euler, type EulerOrder } from './Euler';

// 几何图元
export { Box3 } from './Box3';
export { Sphere } from './Sphere';
export { Plane } from './Plane';
export { Ray } from './Ray';
export { Line3 } from './Line3';
export { Triangle } from './Triangle';
export { Frustum } from './Frustum';
export { OBB } from './OBB';
// ConvexHull — 凸包计算 (convex hull),QuickHull 增量算法。
// 适配 three.js ConvexHull.js,返回结构化面数据供碰撞检测/物理/阴影用。
export { ConvexHull, type ConvexHullFace, type ConvexHullResult } from './ConvexHull';
// ImprovedNoise — Ken Perlin 改进噪声 (3D Perlin),程序化生成基础。
// 适配 three.js ImprovedNoise.js,支持 noise/noise2D/noise1D/fBm。
export { ImprovedNoise } from './ImprovedNoise';
// SimplexNoise — Stefan Gustavson Simplex 噪声 (2D/3D/4D),程序化生成基础。
// 适配 three.js SimplexNoise.js,无方向性伪影,计算成本低于 Perlin。
export { SimplexNoise } from './SimplexNoise';

// 球/柱坐标
export { Spherical } from './Spherical';
export { Cylindrical } from './Cylindrical';

// 插值器(Interpolant 家族,适配 three.js r169 src/math/Interpolant.js)。
// 关键帧动画轨道(KeyframeTrack)的核心基石:给定参数序列 + 采样值序列,在
// 任意位置 t 求出插值结果。基类承担区间查找(缓存下标 + 线扫 + 二分回退),
// 子类覆写 interpolate_ 完成具体插值。常量(Interpolate*/Ending*)与上游数值一致。
export {
  Interpolant,
  InterpolateDiscrete,
  InterpolateLinear,
  InterpolateSmooth,
  ZeroCurvatureEnding,
  ZeroSlopeEnding,
  WrapAroundEnding,
  type InterpolantSettings,
  type EndingPolicy,
} from './Interpolant';
export { DiscreteInterpolant } from './interpolants/DiscreteInterpolant';
export { LinearInterpolant } from './interpolants/LinearInterpolant';
export { CubicInterpolant } from './interpolants/CubicInterpolant';
export { QuaternionLinearInterpolant } from './interpolants/QuaternionLinearInterpolant';
export { BezierInterpolant } from './interpolants/BezierInterpolant';

// 坐标系常量 (three.js WebGLCoordinateSystem/WebGPUCoordinateSystem)
export { WebGLCoordinateSystem, WebGPUCoordinateSystem } from './Matrix4';

// 颜色
export { Color, type HSL } from './Color';

// Tonemapping — HDR → LDR 色调映射算子 + 色彩空间转换(CPU 侧纯函数)。
// 适配 three.js tonemapping_pars_fragment.glsl.js,提供 ACESFilmic/Reinhard/Filmic 算子,
// sRGB/ACEScg 色彩空间转换,以及 ColorManagement 线性工作流管理。
// 注意:不从此 barrel 导出 `RGBColor`(引擎根 barrel 已由 ./Lights 提供,结构相同),
// 亦不导出 `ToneMappingMode`(与 ./Renderer 的数值 enum 同名)。本模块的算子枚举改名为
// `TonemappingOperator`(字符串联合),与 Renderer 的 GPU pass `ToneMappingMode` 区分。
// 直接从 './Tonemapping' 子模块导入仍可得 RGBColor / TonemappingOptions 等。
export {
  applyTonemapping,
  acesFilmicScalar,
  reinhardScalar,
  reinhardExtendedScalar,
  hableCurve,
  filmicScalar,
  linearToSRGB,
  sRGBToLinear,
  linearToSRGBGamma,
  sRGBGammaToLinear,
  linearToSRGBColor,
  sRGBToLinearColor,
  linearSRGBToACEScg,
  acescgToLinearSRGB,
  applyExposure,
  luminance,
  middleGrayOutput,
  ColorManagement,
  type TonemappingOperator,
  type TonemappingOptions,
  type WorkingSpace,
} from './Tonemapping';

// 工具
export * as MathUtils from './MathUtils';
export { DataUtils, toHalfFloat, fromHalfFloat } from './DataUtils';
