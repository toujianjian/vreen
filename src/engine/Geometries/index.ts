// Geometries barrel.
// 各几何体从 three.js 移植并适配 VREEN 自研引擎。

export { BoxGeometry } from './BoxGeometry';
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
export { Shape } from './Shape';
export { ExtrudeGeometry, type ExtrudeOptions } from './ExtrudeGeometry';
// InstancedGeometry — 实例化几何体 (per-instance matrix + color + 自定义属性)。
// 参考 three.js InstancedBufferGeometry,叠加显式 setInstanceMatrix/Color/CustomAttribute API。
export { InstancedGeometry } from './InstancedGeometry';
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
