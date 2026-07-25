// Mesh — the only drawable node in our minimal scene graph for now.
// Holds a BufferGeometry + Material (or array of materials when groups
// are in use). Extends Object3D so the same traversal/transform logic
// applies.

import { Object3D } from './Object3D';
import { BufferGeometry } from './BufferGeometry';
import type { Material } from './Material';
import { Ray } from '../Math/Ray';
import { Matrix4 } from '../Math/Matrix4';
import { intersectGeometry, type Raycaster, type Intersection } from './Raycaster';

const _inverseMatrix = new Matrix4();
const _localRay = new Ray();

export class Mesh extends Object3D {
  override readonly type: string = 'Mesh';
  geometry: BufferGeometry;
  material: Material | Material[];

  /** Convenience flag — many loaders (glTF/OBJ) set this. */
  isMesh: boolean = true;
  castShadow: boolean = true;
  receiveShadow: boolean = true;
  /** 渲染排序权重(数值越小越先绘制)。供多层 shell/描边等需要按层级绘制的特性使用。 */
  renderOrder: number = 0;

  constructor(geometry: BufferGeometry, material: Material | Material[]) {
    super();
    this.geometry = geometry;
    this.material = material;
  }

  /** 射线检测:把世界射线变到 mesh 局部空间,对 geometry 三角形逐个求交。
   *  调用前需保证 matrixWorld 已更新(由 Raycaster 的调用方负责)。 */
  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const geometry = this.geometry;
    if (!geometry.attributes.position) return;

    // 世界射线 → mesh 局部空间
    _inverseMatrix.getInverse(this.matrixWorld);
    _localRay.copy(raycaster.ray).applyMatrix4(_inverseMatrix);

    // 包围球剔除(boundingSphere 与 localRay 都在 mesh 局部空间)。
    // 直接用 distanceSqToPoint 内联判定,避免把结构化 boundingSphere 适配到 Sphere 类。
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const bs = geometry.boundingSphere;
    if (bs !== null && _localRay.distanceSqToPoint(bs.center) > bs.radius * bs.radius) return;

    const hits = intersectGeometry(this, geometry, _localRay, raycaster, this.matrixWorld);
    for (let i = 0; i < hits.length; i++) intersects.push(hits[i]);
  }
}

