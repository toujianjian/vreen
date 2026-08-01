// SceneUtils — 场景图工具集 (scene graph utilities)。
//
// 适配 three.js `examples/jsm/utils/SceneUtils.js` 并适配 VREEN Object3D API。
// 提供:
//   - detach(child, parent, scene):从 parent 移除 child,保持世界变换不变
//   - attach(child, parent, scene):把 child 挂到新 parent,保持世界变换不变
//   - createMultiMaterialObject(geometry, materials):为每个材质创建一个 mesh 子节点
//   - createMeshesFromInstancedGeometry(instancedMesh):把实例化几何拆成独立 mesh
//   - sortChildrenByRenderOrder(object):按 renderOrder 对 children 排序
//   - getWorldPosition/Quaternion/Scale/Direction(obj, target):世界变换提取快捷方法
//
// 用途:
//   - 编辑器:拾取物体后 detach 到根场景,编辑完再 attach 回去
//   - 实例化 → 独立 mesh 转换(批量拾取/修改)
//   - 多材质渲染(透明 + 不透明 pass 分离)
//   - 渲染顺序排序(半透明物体从后往前)
//
// 不变量:
//   - detach/attach 后 child 的世界变换(world matrix)保持不变;
//   - detach/attach 会更新 child 的 position/rotation/scale(从新的本地矩阵 decompose);
//   - 所有操作不修改 child 的几何/材质,只修改变换与父子关系。
//
// 参考:
//   - three.js examples/jsm/utils/SceneUtils.js
//   - three.js src/core/Object3D.js (getWorldPosition/Quaternion/Scale)

import { Object3D } from './Object3D';
import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { Material } from './Material';
import { InstancedMesh } from './InstancedMesh';
import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

// 复用临时矩阵/向量,避免每次调用分配。
const _matrix = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();

/**
 * 从 parent 中分离 child,保持其世界变换不变。
 *
 * 算法:
 *   1. 确保 parent 和 child 的世界矩阵是最新的(updateMatrixWorld)
 *   2. 计算新的本地矩阵:newLocal = parent.matrixWorldInverse * child.matrixWorld
 *      (child 移到 scene/根后,本地 = 世界,但如果 parent 不是根,
 *       需要先"解除" parent 的变换影响)
 *   3. decompose newLocal → child.position / rotation / scale
 *   4. parent.remove(child); scene.add(child) (或直接从 parent.remove)
 *
 * @param child 要分离的子物体。
 * @param parent 当前父物体。
 * @param scene 目标场景(或根 Object3D)。child 会被添加到 scene。
 * @returns child(便于链式调用)。
 */
export function detach(
  child: Object3D,
  parent: Object3D,
  scene: Object3D,
): Object3D {
  // 确保世界矩阵最新
  child.updateMatrixWorld(true);
  parent.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);

  // 计算 scene 的逆世界矩阵(Object3D 不自动更新 matrixWorldInverse)
  scene.matrixWorldInverse.getInverse(scene.matrixWorld);

  // newLocal = scene.matrixWorldInverse * child.matrixWorld
  // (把 child 的世界变换转换为 scene 坐标系下的本地变换)
  _matrix.multiplyMatrices(scene.matrixWorldInverse, child.matrixWorld);

  // decompose → position/rotation/scale
  _matrix.decompose(_position, _quaternion, _scale);
  child.position.copy(_position);
  child.rotation.copy(_quaternion);
  child.scale.copy(_scale);

  // 更新本地矩阵(避免下一帧重算前使用旧值)
  child.updateMatrix();

  // 转移父子关系
  parent.remove(child);
  scene.add(child);

  // 标记世界矩阵需要重算
  child.updateMatrixWorld(true);

  return child;
}

/**
 * 把 child 挂到新 parent,保持其世界变换不变。
 *
 * 算法:
 *   1. 确保 child 和新 parent 的世界矩阵最新
 *   2. 计算新的本地矩阵:newLocal = parent.matrixWorldInverse * child.matrixWorld
 *   3. decompose newLocal → child.position / rotation / scale
 *   4. child.parent.remove(child); parent.add(child)
 *
 * @param child 要移动的子物体。
 * @param parent 新的父物体。
 * @param scene 根场景(用于 updateMatrixWorld)。
 * @returns child(便于链式调用)。
 */
export function attach(
  child: Object3D,
  parent: Object3D,
  scene: Object3D,
): Object3D {
  // 确保世界矩阵最新
  child.updateMatrixWorld(true);
  parent.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);

  // 计算 parent 的逆世界矩阵
  parent.matrixWorldInverse.getInverse(parent.matrixWorld);

  // newLocal = parent.matrixWorldInverse * child.matrixWorld
  _matrix.multiplyMatrices(parent.matrixWorldInverse, child.matrixWorld);

  // decompose → position/rotation/scale
  _matrix.decompose(_position, _quaternion, _scale);
  child.position.copy(_position);
  child.rotation.copy(_quaternion);
  child.scale.copy(_scale);

  // 更新本地矩阵
  child.updateMatrix();

  // 转移父子关系
  if (child.parent) child.parent.remove(child);
  parent.add(child);

  // 标记世界矩阵需要重算
  child.updateMatrixWorld(true);

  return child;
}

/**
 * 为每个材质创建一个独立的 Mesh,共享同一几何体。
 *
 * 用于多材质渲染:第一个 mesh 渲染不透明 pass,后续 mesh 渲染透明 pass,
 * 或不同材质属性叠加(如基础色 + 描边)。
 *
 * @param geometry 共享几何体。
 * @param materials 材质数组。
 * @returns Group,包含 N 个 Mesh 子节点(每个对应一个材质)。
 */
export function createMultiMaterialObject(
  geometry: BufferGeometry,
  materials: Material[],
): Object3D {
  const group = new Object3D();
  for (let i = 0; i < materials.length; i++) {
    const mesh = new Mesh(geometry, materials[i]);
    group.add(mesh);
  }
  return group;
}

/**
 * 把 InstancedMesh 的每个实例拆成独立的 Mesh。
 *
 * 用于:拾取特定实例后需要独立编辑变换 / 批量导出 / 实例化 → 静态网格转换。
 *
 * @param instancedMesh 实例化网格。
 * @param maxCount 最大拆分数量(防止意外创建过多 mesh)。默认 = count。
 * @returns Group,包含 N 个独立 Mesh。
 */
export function createMeshesFromInstancedGeometry(
  instancedMesh: InstancedMesh,
  maxCount?: number,
): Object3D {
  const group = new Object3D();
  const count = Math.min(
    maxCount ?? instancedMesh.count,
    instancedMesh.count,
  );

  const matrix = new Matrix4();
  const elements = new Float32Array(16);

  for (let i = 0; i < count; i++) {
    instancedMesh.getMatrixAt(i, elements);
    matrix.elements.set(elements);
    // decompose 实例矩阵 → position/rotation/scale
    matrix.decompose(_position, _quaternion, _scale);
    const mesh = new Mesh(instancedMesh.geometry, instancedMesh.material);
    mesh.position.copy(_position);
    mesh.rotation.copy(_quaternion);
    mesh.scale.copy(_scale);
    mesh.updateMatrix();
    group.add(mesh);
  }

  return group;
}

/**
 * 按 renderOrder 对 object 的 children 排序(升序)。
 *
 * 用于半透明物体从后往前渲染(renderOrder 越小越先渲染)。
 * 不递归,只排序直接子节点。
 *
 * @param object 要排序的物体。
 * @param descending 是否降序(默认 false = 升序,renderOrder 小的在前)。
 */
export function sortChildrenByRenderOrder(
  object: Object3D,
  descending: boolean = false,
): void {
  if (descending) {
    object.children.sort((a, b) => b.renderOrder - a.renderOrder);
  } else {
    object.children.sort((a, b) => a.renderOrder - b.renderOrder);
  }
}

/**
 * 获取物体的世界位置。
 * @param object 目标物体。
 * @param target 写入目标(可选)。
 */
export function getWorldPosition(
  object: Object3D,
  target: Vector3 = new Vector3(),
): Vector3 {
  object.updateMatrixWorld(true);
  target.set(
    object.matrixWorld.elements[12],
    object.matrixWorld.elements[13],
    object.matrixWorld.elements[14],
  );
  return target;
}

/**
 * 获取物体的世界旋转(四元数)。
 * @param object 目标物体。
 * @param target 写入目标(可选)。
 */
export function getWorldQuaternion(
  object: Object3D,
  target: Quaternion = new Quaternion(),
): Quaternion {
  object.updateMatrixWorld(true);
  object.matrixWorld.decompose(_position, target, _scale);
  return target;
}

/**
 * 获取物体的世界缩放。
 * @param object 目标物体。
 * @param target 写入目标(可选)。
 */
export function getWorldScale(
  object: Object3D,
  target: Vector3 = new Vector3(),
): Vector3 {
  object.updateMatrixWorld(true);
  object.matrixWorld.decompose(_position, _quaternion, target);
  return target;
}

/**
 * 获取物体的世界朝向(forward 方向,-Z 轴)。
 * @param object 目标物体。
 * @param target 写入目标(可选)。
 */
export function getWorldDirection(
  object: Object3D,
  target: Vector3 = new Vector3(),
): Vector3 {
  object.updateMatrixWorld(true);
  // -Z 方向 = matrixWorld 的第 3 列取反
  // 列主序:第 3 列 = elements[8], [9], [10]
  const e = object.matrixWorld.elements;
  target.set(-e[8], -e[9], -e[10]);
  return target;
}

/**
 * 深度遍历场景图,收集所有 Mesh 节点。
 * @param root 遍历起点。
 * @param includeInvisible 是否包含 visible=false 的节点。默认 false。
 * @returns Mesh 数组(顺序 = 深度优先)。
 */
export function getMeshes(
  root: Object3D,
  includeInvisible: boolean = false,
): Mesh[] {
  const result: Mesh[] = [];
  const stack: Object3D[] = [root];
  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (!includeInvisible && !obj.visible) continue;
    if (obj instanceof Mesh) {
      result.push(obj);
    }
    for (let i = obj.children.length - 1; i >= 0; i--) {
      stack.push(obj.children[i]);
    }
  }
  return result;
}

/**
 * 统计场景图中的节点总数(含 root)。
 * @param root 遍历起点。
 * @param includeInvisible 是否包含不可见节点。默认 true。
 */
export function countObjects(
  root: Object3D,
  includeInvisible: boolean = true,
): number {
  let count = 0;
  const stack: Object3D[] = [root];
  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (!includeInvisible && !obj.visible) continue;
    count++;
    for (const child of obj.children) {
      stack.push(child);
    }
  }
  return count;
}
