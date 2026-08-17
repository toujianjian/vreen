// DecalGeometry — 贴花几何体,将目标物体的几何投影到局部贴花空间并裁剪到盒子内。
// 参考: three.js/src/geometries/DecalGeometry.js
//        http://blog.wolfire.com/2009/06/how-to-project-decals/
//
// 算法 (Sutherland–Hodgman 三角面盒裁剪):
//   1. 构造投影器矩阵 projectorMatrix = T(position) × R(orientation),
//      并求逆 projectorMatrixInverse。
//   2. 遍历目标几何体的每个三角面(经索引或非索引),将顶点从 mesh 局部空间
//      经 mesh.matrixWorld 变换到世界空间,再经 projectorMatrixInverse 变换到
//      投影器局部空间;法线经 mesh.matrixWorld 的旋转部分(transformDirection)
//      变换到世界空间。三个连续 DecalVertex 构成一个面。
//   3. 对投影器局部空间中的三角面,依次用 6 个裁剪平面 (±X, ±Y, ±Z) 做
//      Sutherland–Hodgman 裁剪。每个平面裁剪后,被切开的三角形重新三角化,
//      保持拓扑连续。裁剪阈值 s = 0.5 × |size · planeNormal|。
//   4. 输出阶段:UV = (0.5 + localX/size.x, 0.5 + localY/size.y);
//      位置经 projectorMatrix 变回世界空间;法线保持世界空间。
//
// 与 three.js 的差异:
//   - orientation 参数使用 Quaternion(three.js 用 Euler),通过 compose 构建。
//   - 输出非索引几何体(three.js 同样非索引)。
//   - 法线缺失时回退到 (0,0,1)(three.js 不做回退,会报错)。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Object3D } from '../Core/Object3D';
import { Matrix4, Quaternion, Vector3 } from '../Math';

/** 贴花顶点:位置(投影器局部空间)+ 法线(世界空间)。 */
class DecalVertex {
  constructor(
    public position: Vector3,
    public normal: Vector3,
  ) {}

  clone(): DecalVertex {
    return new DecalVertex(this.position.clone(), this.normal.clone());
  }
}

/**
 * 贴花几何体。构造为内部使用,请通过 `DecalGeometry.create()` 创建。
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

    // 投影器矩阵 = T(position) × R(orientation) × S(1)。
    const projectorMatrix = new Matrix4().compose(
      position,
      orientation,
      _UNIT_SCALE,
    );
    const projectorMatrixInverse = new Matrix4()
      .copy(projectorMatrix)
      .invert();

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const geom = (target as unknown as { geometry?: BufferGeometry }).geometry;
    const posAttr = geom?.getAttribute('position');
    const normAttr = geom?.getAttribute('normal');

    if (posAttr && size.x !== 0 && size.y !== 0 && size.z !== 0) {
      // 确保世界矩阵最新。
      target.updateMatrixWorld(true);

      // ── Step 1: 构造 DecalVertex 数组(投影器局部空间) ──
      const decalVertices: DecalVertex[] = [];
      const v = new Vector3();
      const n = new Vector3();

      const pushVertex = (idx: number): void => {
        readAttribute3(posAttr! as BufferAttribute, idx, v);
        // mesh 局部 → 世界 → 投影器局部
        v.applyMatrix4(target.matrixWorld).applyMatrix4(projectorMatrixInverse);
        if (normAttr) {
          readAttribute3(normAttr as BufferAttribute, idx, n);
          n.transformDirection(target.matrixWorld); // 世界空间法线
        } else {
          n.set(0, 0, 1);
        }
        decalVertices.push(new DecalVertex(v.clone(), n.clone()));
      };

      const index = geom!.index;
      if (index) {
        const idxArr = index.array;
        for (let i = 0; i < idxArr.length; i++) {
          pushVertex(idxArr[i]);
        }
      } else {
        const count = posAttr.count;
        for (let i = 0; i < count; i++) {
          pushVertex(i);
        }
      }

      // ── Step 2: 依次用 6 个平面做 Sutherland–Hodgman 裁剪 ──
      let clipped = decalVertices;
      clipped = clipGeometry(clipped, _plane.set(1, 0, 0), size);
      clipped = clipGeometry(clipped, _plane.set(-1, 0, 0), size);
      clipped = clipGeometry(clipped, _plane.set(0, 1, 0), size);
      clipped = clipGeometry(clipped, _plane.set(0, -1, 0), size);
      clipped = clipGeometry(clipped, _plane.set(0, 0, 1), size);
      clipped = clipGeometry(clipped, _plane.set(0, 0, -1), size);

      // ── Step 3: 生成最终缓冲(世界空间位置 + 世界空间法线 + UV) ──
      for (let i = 0; i < clipped.length; i++) {
        const dv = clipped[i];
        // UV 在投影器局部空间计算。
        uvs.push(
          0.5 + dv.position.x / size.x,
          0.5 + dv.position.y / size.y,
        );
        // 位置变回世界空间(不修改原始顶点,用临时向量)。
        _tmp
          .copy(dv.position)
          .applyMatrix4(projectorMatrix);
        positions.push(_tmp.x, _tmp.y, _tmp.z);
        normals.push(dv.normal.x, dv.normal.y, dv.normal.z);
      }
    }

    this.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(normals), 3),
    );
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
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

// ── 内部工具 ────────────────────────────────────────────────────────────

const _UNIT_SCALE = new Vector3(1, 1, 1);
const _plane = new Vector3();
const _tmp = new Vector3();

/** 从 BufferAttribute 读取第 index 个 vec3 到 out。 */
function readAttribute3(
  attr: BufferAttribute,
  index: number,
  out: Vector3,
): void {
  const o = index * 3;
  const a = attr.array;
  out.set(a[o], a[o + 1], a[o + 2]);
}

/**
 * Sutherland–Hodgman 三角面裁剪:对 inVertices 中每 3 个连续顶点构成的
 * 三角形,用平面 plane (法线方向,s = 0.5×|size·plane| 为阈值) 裁剪。
 *
 * 裁剪后重新三角化:
 *   - 0 顶点在外 → 保留原三角形 (1 个三角形输出)
 *   - 1 顶点在外 → 四边形拆分为 2 个三角形
 *   - 2 顶点在外 → 1 个三角形
 *   - 3 顶点在外 → 丢弃
 *
 * 约定:d = position·plane − s > 0 表示顶点在裁剪平面外侧(被裁掉)。
 */
function clipGeometry(
  inVertices: DecalVertex[],
  plane: Vector3,
  size: Vector3,
): DecalVertex[] {
  const out: DecalVertex[] = [];
  const s = 0.5 * Math.abs(size.x * plane.x + size.y * plane.y + size.z * plane.z);

  for (let i = 0; i < inVertices.length; i += 3) {
    const v1 = inVertices[i];
    const v2 = inVertices[i + 1];
    const v3 = inVertices[i + 2];

    const d1 = v1.position.dot(plane) - s;
    const d2 = v2.position.dot(plane) - s;
    const d3 = v3.position.dot(plane) - s;

    const v1Out = d1 > 0;
    const v2Out = d2 > 0;
    const v3Out = d3 > 0;

    const total = (v1Out ? 1 : 0) + (v2Out ? 1 : 0) + (v3Out ? 1 : 0);

    switch (total) {
      case 0: {
        // 整个三角形在平面内侧,无需裁剪。
        out.push(v1, v2, v3);
        break;
      }
      case 1: {
        // 1 个顶点在外 → 四边形拆分为 2 个三角形。
        let nV1: DecalVertex, nV2: DecalVertex, nV3: DecalVertex, nV4: DecalVertex;
        if (v1Out) {
          // v1 在外,nV1=v2, nV2=v3, nV3=clip(v1→v2), nV4=clip(v1→v3)
          nV1 = v2;
          nV2 = v3;
          nV3 = clip(v1, nV1, plane, s);
          nV4 = clip(v1, nV2, plane, s);
          out.push(nV1, nV2, nV3, nV4, nV3, nV2);
        } else if (v2Out) {
          // v2 在外,nV1=v1, nV2=v3, nV3=clip(v2→v1), nV4=clip(v2→v3)
          nV1 = v1;
          nV2 = v3;
          nV3 = clip(v2, nV1, plane, s);
          nV4 = clip(v2, nV2, plane, s);
          out.push(nV3, nV2, nV1, nV2, nV3, nV4);
        } else {
          // v3 在外,nV1=v1, nV2=v2, nV3=clip(v3→v1), nV4=clip(v3→v2)
          nV1 = v1;
          nV2 = v2;
          nV3 = clip(v3, nV1, plane, s);
          nV4 = clip(v3, nV2, plane, s);
          out.push(nV1, nV2, nV3, nV4, nV3, nV2);
        }
        break;
      }
      case 2: {
        // 2 个顶点在外 → 1 个三角形(仅保留内侧顶点 + 两个交点)。
        if (!v1Out) {
          const nV2 = clip(v1, v2, plane, s);
          const nV3 = clip(v1, v3, plane, s);
          out.push(v1, nV2, nV3);
        } else if (!v2Out) {
          const nV2 = clip(v2, v3, plane, s);
          const nV3 = clip(v2, v1, plane, s);
          out.push(v2, nV2, nV3);
        } else {
          const nV2 = clip(v3, v1, plane, s);
          const nV3 = clip(v3, v2, plane, s);
          out.push(v3, nV2, nV3);
        }
        break;
      }
      // case 3: 整个三角形在外侧,丢弃。
    }
  }
  return out;
}

/**
 * 在 v0 → v1 边上求与裁剪平面的交点(位置 + 法线线性插值)。
 * t = d0 / (d0 − d1),其中 d = position·plane − s。
 */
function clip(
  v0: DecalVertex,
  v1: DecalVertex,
  plane: Vector3,
  s: number,
): DecalVertex {
  const d0 = v0.position.dot(plane) - s;
  const d1 = v1.position.dot(plane) - s;
  const t = d0 / (d0 - d1);
  return new DecalVertex(
    new Vector3(
      v0.position.x + t * (v1.position.x - v0.position.x),
      v0.position.y + t * (v1.position.y - v0.position.y),
      v0.position.z + t * (v1.position.z - v0.position.z),
    ),
    new Vector3(
      v0.normal.x + t * (v1.normal.x - v0.normal.x),
      v0.normal.y + t * (v1.normal.y - v0.normal.y),
      v0.normal.z + t * (v1.normal.z - v0.normal.z),
    ),
  );
}
