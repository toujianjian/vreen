// Geometries barrel.
// 各几何体从 three.js 移植并适配 VREEN 自研引擎。

export { BoxGeometry } from './BoxGeometry';
// RoundedBoxGeometry — 圆角盒子几何体 (rounded box)。
// 适配 three.js RoundedBoxGeometry.js,所有棱角圆滑过渡。
export { RoundedBoxGeometry } from './RoundedBoxGeometry';
export { SphereGeometry } from './SphereGeometry';
export { CylinderGeometry } from './CylinderGeometry';
export { ConeGeometry } from './ConeGeometry';
export { TorusGeometry } from './TorusGeometry';
export { PlaneGeometry } from './PlaneGeometry';
export { CircleGeometry } from './CircleGeometry';
export { RingGeometry } from './RingGeometry';
export { CapsuleGeometry } from './CapsuleGeometry';
export { TorusKnotGeometry } from './TorusKnotGeometry';
export { LatheGeometry } from './LatheGeometry';
export { TubeGeometry, type TubeGeometryOptions } from './TubeGeometry';
export { WireframeGeometry } from './WireframeGeometry';
export { EdgesGeometry } from './EdgesGeometry';
export { ConvexGeometry } from './ConvexGeometry';
export { ParametricGeometry, type ParametricFunction } from './ParametricGeometry';
// TeapotGeometry — 犹他茶壶 (32 个贝塞尔面片),适配自 three.js TeapotGeometry。
export { TeapotGeometry, type TeapotGeometryOptions } from './TeapotGeometry';
export { DecalGeometry } from './DecalGeometry';
// PolyhedronGeometry — 正多面体几何体基类 + 4 个柏拉图体 (Tetrahedron/Octahedron/Dodecahedron/Icosahedron)。
// 适配 three.js PolyhedronGeometry.js,支持面细分、球面投影、UV 接缝修正。
export {
  PolyhedronGeometry,
  TetrahedronGeometry,
  OctahedronGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
} from './PolyhedronGeometry';
export { Shape } from './Shape';
export { ExtrudeGeometry, type ExtrudeOptions } from './ExtrudeGeometry';
// InstancedGeometry — 实例化几何体 (per-instance matrix + color + 自定义属性)。
// 参考 three.js InstancedBufferGeometry,叠加显式 setInstanceMatrix/Color/CustomAttribute API。
export { InstancedGeometry } from './InstancedGeometry';
// LineSegmentsGeometry / LineGeometry — 粗线几何体 (屏幕空间四边形扩展)。
// 适配 three.js examples/jsm/lines/LineSegmentsGeometry.js / LineGeometry.js。
// 每条线段作为一个实例,配合 LineSegments2 / Line2 + LineMaterial 绘制带宽度的线。
export { LineSegmentsGeometry } from './LineSegmentsGeometry';
export { LineGeometry } from './LineGeometry';
// MarchingCubes — 等值面提取 (iso-surface extraction)。
// 适配 three.js MarchingCubes.js,Lorensen & Cline 1987 经典算法。
// 支持 density function / metaball / raw field 输入,输出非索引三角形 + 面法线。
export {
  MarchingCubes,
  type MarchingCubesOptions,
  type Metaball,
} from './MarchingCubes';
// TextGeometry — 3D 挤压文本几何体 (简化版 FontDefinition,适配自 three.js TextGeometry)。
export {
  TextGeometry,
  type TextGeometryOptions,
  type FontCharacter,
  type FontDefinition,
  createMinimalFont,
} from './TextGeometry';
