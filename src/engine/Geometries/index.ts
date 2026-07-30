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
export { WireframeGeometry } from './WireframeGeometry';
export { EdgesGeometry } from './EdgesGeometry';
export { Shape } from './Shape';
export { ExtrudeGeometry, type ExtrudeOptions } from './ExtrudeGeometry';
// InstancedGeometry — 实例化几何体 (per-instance matrix + color + 自定义属性)。
// 参考 three.js InstancedBufferGeometry,叠加显式 setInstanceMatrix/Color/CustomAttribute API。
export { InstancedGeometry } from './InstancedGeometry';
