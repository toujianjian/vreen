// Raycaster — 射线检测器,用于鼠标拾取、视线碰撞等。
// 参考 three.js Raycaster.js,适配 VREEN 自研引擎的 TypeScript strict 模式。
//
// 设计:
//   * Raycaster 持有一条 Ray(origin + direction)、near/far 距离范围、
//     可选 camera(由 setFromCamera 设置)、params(子类型阈值配置)。
//   * 检测走"委托"模式:intersectObject 调 object.raycast(this, intersects),
//     Object3D 基类是 no-op,Mesh / InstancedMesh 各自覆盖做三角形求交。
//   * 三角形求交逻辑抽到 intersectGeometry,供 Mesh / InstancedMesh 复用,
//     避免重复实现。

import { Ray } from '../Math/Ray';
import { Vector3 } from '../Math/Vector3';
import { Vector2 } from '../Math/Vector2';
import { Matrix4 } from '../Math/Matrix4';
import { Triangle } from '../Math/Triangle';
import type { Object3D } from './Object3D';
import type { BufferGeometry } from './BufferGeometry';
import type { Camera } from '../Cameras/Camera';

/** 命中三角形的顶点索引 + 法线(+ 可选材质组索引)。 */
export interface Face {
  a: number;
  b: number;
  c: number;
  normal: Vector3;
  materialIndex?: number;
}

/** 射线命中结果。distance 为世界空间距离,point 为世界坐标。 */
export interface Intersection {
  /** 射线 origin 到命中点的世界距离。 */
  distance: number;
  /** Points/Sprite 等用的"到射线最近点距离",普通 Mesh 不填。 */
  distanceToRay?: number;
  /** 命中点(世界坐标)。 */
  point: Vector3;
  /** 被命中的物体。 */
  object: Object3D;
  /** 命中的三角形。 */
  face?: Face;
  /** 三角形索引(从 0 开始)。 */
  faceIndex?: number;
  /** 命中点的 UV(若几何体带 uv 属性)。 */
  uv?: Vector2;
  /** InstancedMesh 命中时的实例索引。 */
  instanceId?: number;
}

/** 子类型阈值配置(与 three.js 结构一致;VREEN 仅 Mesh/InstancedMesh 实际使用)。 */
export interface RaycasterParameters {
  Mesh: object;
  Line: { threshold: number };
  LOD: object;
  Points: { threshold: number };
  Sprite: object;
}

// ── intersectGeometry 内部复用的临时变量 ─────────────────────────────
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _bary = new Vector3();
const _uvA = new Vector2();
const _uvB = new Vector2();
const _uvC = new Vector2();
const _localPoint = new Vector3();
const _worldPoint = new Vector3();

/**
 * 对 geometry 的所有三角形与 localRay(已变换到 geometry 局部空间)求交。
 * 命中点经 worldMatrix 变换回世界空间,按 raycaster.near/far 过滤后返回。
 *
 * @param object        被测物体(写入 Intersection.object)
 * @param geometry      BufferGeometry(必须有 position 属性)
 * @param localRay      已变换到 geometry 局部空间的射线
 * @param raycaster     用于读 near/far 与世界 ray.origin(算距离)
 * @param worldMatrix   局部→世界的矩阵(Mesh 传 matrixWorld;InstancedMesh 传 matrixWorld * instanceMatrix)
 * @param instanceId    InstancedMesh 实例索引(普通 Mesh 不传)
 */
export function intersectGeometry(
  object: Object3D,
  geometry: BufferGeometry,
  localRay: Ray,
  raycaster: Raycaster,
  worldMatrix: Matrix4,
  instanceId?: number,
): Intersection[] {
  const result: Intersection[] = [];
  const pos = geometry.attributes.position;
  if (!pos) return result;

  const uvAttr = geometry.attributes.uv;
  const index = geometry.index;
  const posArr = pos.array;
  const uvArr = uvAttr ? (uvAttr.array as unknown as ArrayLike<number>) : null;

  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  const idxArr = index ? (index.array as unknown as ArrayLike<number>) : null;

  for (let f = 0; f < triCount; f++) {
    let i0: number, i1: number, i2: number;
    if (idxArr) {
      i0 = idxArr[f * 3];
      i1 = idxArr[f * 3 + 1];
      i2 = idxArr[f * 3 + 2];
    } else {
      i0 = f * 3;
      i1 = f * 3 + 1;
      i2 = f * 3 + 2;
    }

    _v1.set(posArr[i0 * 3], posArr[i0 * 3 + 1], posArr[i0 * 3 + 2]);
    _v2.set(posArr[i1 * 3], posArr[i1 * 3 + 1], posArr[i1 * 3 + 2]);
    _v3.set(posArr[i2 * 3], posArr[i2 * 3 + 1], posArr[i2 * 3 + 2]);

    const hit = localRay.intersectTriangle(_v1, _v2, _v3, false, _localPoint);
    if (hit === null) continue;

    // 局部命中点 → 世界
    _worldPoint.copy(_localPoint).applyMatrix4(worldMatrix);
    const distance = raycaster.ray.origin.distanceTo(_worldPoint);
    if (distance < raycaster.near || distance > raycaster.far) continue;

    const face: Face = {
      a: i0,
      b: i1,
      c: i2,
      normal: Triangle.getNormal(_v1, _v2, _v3, new Vector3()),
    };

    let uv: Vector2 | undefined;
    if (uvArr) {
      _uvA.set(uvArr[i0 * 2], uvArr[i0 * 2 + 1]);
      _uvB.set(uvArr[i1 * 2], uvArr[i1 * 2 + 1]);
      _uvC.set(uvArr[i2 * 2], uvArr[i2 * 2 + 1]);
      const bary = Triangle.getBarycoord(_localPoint, _v1, _v2, _v3, _bary);
      if (bary) {
        uv = new Vector2(
          _uvA.x * bary.x + _uvB.x * bary.y + _uvC.x * bary.z,
          _uvA.y * bary.x + _uvB.y * bary.y + _uvC.y * bary.z,
        );
      }
    }

    result.push({
      distance,
      point: _worldPoint.clone(),
      object,
      face,
      faceIndex: f,
      uv,
      instanceId,
    });
  }

  return result;
}

function ascSort(a: Intersection, b: Intersection): number {
  return a.distance - b.distance;
}

function intersect(
  object: Object3D,
  raycaster: Raycaster,
  intersects: Intersection[],
  recursive: boolean,
): void {
  // 委托给 object.raycast;基类 Object3D 为 no-op,Mesh/InstancedMesh 覆盖。
  object.raycast(raycaster, intersects);
  if (recursive) {
    const children = object.children;
    for (let i = 0, l = children.length; i < l; i++) {
      intersect(children[i], raycaster, intersects, true);
    }
  }
}

export class Raycaster {
  /** 射线(origin + 归一化 direction)。 */
  ray: Ray;
  /** 命中距离下限(不可为负)。 */
  near: number;
  /** 命中距离上限。 */
  far: number;
  /** setFromCamera 设置;用于 billboard/sprite 等视线相关物体。 */
  camera: Camera | null = null;
  /** 子类型阈值配置。 */
  params: RaycasterParameters;

  constructor(
    origin: Vector3 = new Vector3(),
    direction: Vector3 = new Vector3(0, 0, -1),
    near: number = 0,
    far: number = Infinity,
  ) {
    this.ray = new Ray(origin, direction);
    this.near = near;
    this.far = far;
    this.params = {
      Mesh: {},
      Line: { threshold: 1 },
      LOD: {},
      Points: { threshold: 1 },
      Sprite: {},
    };
  }

  /** 用新的 origin/direction 设置射线(direction 需已归一化)。 */
  set(origin: Vector3, direction: Vector3): void {
    this.ray.set(origin, direction);
  }

  /**
   * 由屏幕 NDC 坐标与相机构建射线。coords.x/coords.y 范围 [-1, 1]。
   * 调用前需确保 camera.matrixWorld 已更新。
   */
  setFromCamera(coords: { x: number; y: number }, camera: Camera): void {
    const cam = camera as Camera & {
      isPerspectiveCamera?: boolean;
      isOrthographicCamera?: boolean;
    };

    if (cam.isPerspectiveCamera) {
      // origin = 相机世界位置(matrixWorld 的平移列)
      const e = camera.matrixWorld.elements;
      this.ray.origin.set(e[12], e[13], e[14]);
      // direction = unproject(ndc 点) - origin,归一化
      // unproject(p) = p.applyMatrix4(projectionMatrixInverse).applyMatrix4(matrixWorld)
      this.ray.direction
        .set(coords.x, coords.y, 0.5)
        .applyMatrix4(camera.projectionMatrixInverse)
        .applyMatrix4(camera.matrixWorld)
        .sub(this.ray.origin)
        .normalize();
      this.camera = camera;
    } else if (cam.isOrthographicCamera) {
      // origin 落在相机平面上(ndc.z 取投影矩阵的 z 平移分量)
      this.ray.origin
        .set(coords.x, coords.y, camera.projectionMatrix.elements[14])
        .applyMatrix4(camera.projectionMatrixInverse)
        .applyMatrix4(camera.matrixWorld);
      this.ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
      this.camera = camera;
    } else {
      console.warn('Raycaster: Unsupported camera type: ' + camera.type);
    }
  }

  /**
   * 检测射线与 object(可选包含子孙)的交点,结果按 distance 升序。
   * @param object    被测物体
   * @param recursive 是否递归子孙(默认 true)
   * @param intersects 复用的结果数组(默认新建)
   */
  intersectObject(
    object: Object3D,
    recursive: boolean = true,
    intersects: Intersection[] = [],
  ): Intersection[] {
    intersect(object, this, intersects, recursive);
    intersects.sort(ascSort);
    return intersects;
  }

  /**
   * 检测射线与多个 objects(可选包含子孙)的交点,结果按 distance 升序。
   */
  intersectObjects(
    objects: Object3D[],
    recursive: boolean = true,
    intersects: Intersection[] = [],
  ): Intersection[] {
    for (let i = 0, l = objects.length; i < l; i++) {
      intersect(objects[i], this, intersects, recursive);
    }
    intersects.sort(ascSort);
    return intersects;
  }
}
