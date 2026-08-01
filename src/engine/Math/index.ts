// Math barrel — 引擎数学库的统一导入出口。
// 与 three.js 的 `THREE` 命名空间对齐,便于跨引擎桥接。

// 向量
export { Vector2 } from './Vector2';
export { Vector3 } from './Vector3';
export { Vector4 } from './Vector4';

// 矩阵
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

// 颜色
export { Color, type HSL } from './Color';

// 工具
export * as MathUtils from './MathUtils';
