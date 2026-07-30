// DecalGeometry — 贴花几何体,将目标物体的几何投影到局部贴花空间并裁剪到盒子内。
// 参考: three.js/src/geometries/DecalGeometry.js
//
// ⚠️ 简化版实现(与 three.js 的差异):
//   - three.js 按三角面遍历并使用 Sutherland–Hodgman 对每个三角形做盒裁剪,
//     保留裁剪后的三角形拓扑。本简化版按顶点逐个处理:
//       1. 取目标 position 属性的每个顶点;
//       2. 经 target.matrixWorld 变换到世界空间;
//       3. 用 (position + orientation) 的逆变换到贴花局部空间;
//       4. 丢弃落在 [-size/2, +size/2]³ 之外的顶点;
//       5. UV: u = 0.5 + localX/size.x,v = 0.5 + localY/size.y;
//       6. 法线统一设为贴花局部 +Z(0,0,1)。
//   - 不输出索引缓冲(非索引点云式);适用于占位 / 测试 / 简单贴花投影可视化。
//   - 如需完整裁剪三角形拓扑,应移植 three.js 原版 clipFace 算法。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Object3D } from '../Core/Object3D';
import { Quaternion, Vector3 } from '../Math';

// 复用临时向量,避免逐顶点分配。
const _world = new Vector3();
const _local = new Vector3();
const _invRot = new Quaternion();

/**
 * 贴花几何体(简化版)。构造为内部使用,请通过 `DecalGeometry.create()` 创建。
 *
 * @param target      被投影的目标物体(需有 geometry.attributes.position)
 * @param position    贴花中心在世界空间的位置
 * @param orientation 贴花朝向(单位四元数)
 * @param size        贴花盒尺寸 (sx, sy, sz)
 */
export class DecalGeometry extends BufferGeometry {
  private constructor(
    target: Object3D,
    position: Vector3,
    orientation: Quaternion,
    size: Vector3,
  ) {
    super();

    // 逆旋转 = orientation 的共轭(单位四元数下等于逆)。先归一化保证单位长度。
    _invRot.copy(orientation).normalize().invert();

    const halfX = size.x / 2;
    const halfY = size.y / 2;
    const halfZ = size.z / 2;

    const positions: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];

    // 取目标几何体的 position 属性(若无则输出空几何体)。
    const geom = (target as unknown as { geometry?: BufferGeometry }).geometry;
    const posAttr = geom?.getAttribute('position');

    if (posAttr && size.x !== 0 && size.y !== 0 && size.z !== 0) {
      // 确保世界矩阵最新。
      target.updateMatrixWorld(true);
      const arr = posAttr.array;

      for (let i = 0; i < arr.length; i += 3) {
        // 局部顶点 → 世界空间
        _world.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(target.matrixWorld);
        // 世界 → 贴花局部空间:local = R_inv * (world - position)
        _local.copy(_world).sub(position).applyQuaternion(_invRot);

        // 裁剪:落在贴花盒之外的顶点丢弃。
        if (
          Math.abs(_local.x) > halfX ||
          Math.abs(_local.y) > halfY ||
          Math.abs(_local.z) > halfZ
        ) {
          continue;
        }

        positions.push(_local.x, _local.y, _local.z);
        uvs.push(0.5 + _local.x / size.x, 0.5 + _local.y / size.y);
        normals.push(0, 0, 1);
      }
    }

    this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.computeBoundingBox();
  }

  /**
   * 创建一个贴花几何体。
   * @param target      被投影的目标物体
   * @param position    贴花中心(世界空间)
   * @param orientation 贴花朝向(单位四元数)
   * @param size        贴花盒尺寸
   */
  static create(
    target: Object3D,
    position: Vector3,
    orientation: Quaternion,
    size: Vector3,
  ): DecalGeometry {
    return new DecalGeometry(target, position, orientation, size);
  }
}
