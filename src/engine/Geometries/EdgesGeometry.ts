// EdgesGeometry — 边缘几何体,从 three.js 移植并适配 VREEN 引擎。
// 仅在两相邻三角形面法线夹角大于 thresholdAngle(度)时,才输出它们的公共边;
// 同时会输出所有未配对的边界边。输出为按线段排布的顶点流,适合 LineSegments。
// 参考: three.js/src/geometries/EdgesGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math';

const DEG2RAD = Math.PI / 180;

/** 边缘:抽取折角超过阈值或位于边界上的边。 */
export class EdgesGeometry extends BufferGeometry {
  constructor(geometry: BufferGeometry | null = null, thresholdAngle = 1) {
    super();

    if (geometry !== null) {
      // 顶点位置量化精度(小数位数)
      const precisionPoints = 4;
      const precision = Math.pow(10, precisionPoints);
      const thresholdDot = Math.cos(DEG2RAD * thresholdAngle);

      const indexAttr = geometry.index;
      const positionAttr = geometry.attributes.position;
      if (!positionAttr) {
        this.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
        return;
      }

      const indexCount = indexAttr ? indexAttr.count : positionAttr.count;

      const indexArr: [number, number, number] = [0, 0, 0];
      const hashes: [string, string, string] = ['', '', ''];

      // edgeData:键为 "v0_v1",值为该边的另一个顶点索引对与法线;
      // 当遇到反向键("v1_v0")时表示已找到配对边。
      const edgeData: Record<string, {
        index0: number;
        index1: number;
        normal: Vector3;
      } | null> = {};
      const vertices: number[] = [];

      const va = new Vector3();
      const vb = new Vector3();
      const vc = new Vector3();
      const normal = new Vector3();

      for (let i = 0; i < indexCount; i += 3) {
        if (indexAttr) {
          indexArr[0] = indexAttr.array[i];
          indexArr[1] = indexAttr.array[i + 1];
          indexArr[2] = indexAttr.array[i + 2];
        } else {
          indexArr[0] = i;
          indexArr[1] = i + 1;
          indexArr[2] = i + 2;
        }

        fromBufferAttribute(va, positionAttr.array, indexArr[0]);
        fromBufferAttribute(vb, positionAttr.array, indexArr[1]);
        fromBufferAttribute(vc, positionAttr.array, indexArr[2]);
        // 法线 = (b-a) × (c-a) 归一化
        getNormal(va, vb, vc, normal);

        // 为三个顶点生成量化后的字符串哈希(用于跨三角形识别同一边)
        hashes[0] = `${Math.round(va.x * precision)},${Math.round(va.y * precision)},${Math.round(va.z * precision)}`;
        hashes[1] = `${Math.round(vb.x * precision)},${Math.round(vb.y * precision)},${Math.round(vb.z * precision)}`;
        hashes[2] = `${Math.round(vc.x * precision)},${Math.round(vc.y * precision)},${Math.round(vc.z * precision)}`;

        // 跳过退化三角形(任意两点重合)
        if (
          hashes[0] === hashes[1] ||
          hashes[1] === hashes[2] ||
          hashes[2] === hashes[0]
        ) {
          continue;
        }

        // 枚举三条边
        for (let j = 0; j < 3; j++) {
          const jNext = (j + 1) % 3;
          const vecHash0 = hashes[j];
          const vecHash1 = hashes[jNext];
          const v0 = j === 0 ? va : j === 1 ? vb : vc;
          const v1 = jNext === 0 ? va : jNext === 1 ? vb : vc;

          const hash = `${vecHash0}_${vecHash1}`;
          const reverseHash = `${vecHash1}_${vecHash0}`;

          const existing = edgeData[reverseHash];
          if (existing) {
            // 找到配对边:夹角大于阈值则输出
            if (normal.dot(existing.normal) <= thresholdDot) {
              vertices.push(v0.x, v0.y, v0.z);
              vertices.push(v1.x, v1.y, v1.z);
            }
            edgeData[reverseHash] = null;
          } else if (!(hash in edgeData)) {
            edgeData[hash] = {
              index0: indexArr[j],
              index1: indexArr[jNext],
              normal: normal.clone(),
            };
          }
        }
      }

      // 输出所有未匹配的边界边
      for (const key in edgeData) {
        const data = edgeData[key];
        if (data) {
          fromBufferAttribute(va, positionAttr.array, data.index0);
          fromBufferAttribute(vb, positionAttr.array, data.index1);
          vertices.push(va.x, va.y, va.z);
          vertices.push(vb.x, vb.y, vb.z);
        }
      }

      this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    }
  }
}

/** 从 BufferAttribute 数组读取第 index 个三维顶点到 target。 */
function fromBufferAttribute(target: Vector3, arr: ArrayLike<number>, index: number): Vector3 {
  const o = index * 3;
  target.x = arr[o];
  target.y = arr[o + 1];
  target.z = arr[o + 2];
  return target;
}

/** 计算 (a,b,c) 三角形法线写入 target(归一化)。 */
function getNormal(a: Vector3, b: Vector3, c: Vector3, target: Vector3): Vector3 {
  const bx = c.x - b.x;
  const by = c.y - b.y;
  const bz = c.z - b.z;
  const ax = a.x - b.x;
  const ay = a.y - b.y;
  const az = a.z - b.z;
  // target = (c-b) × (a-b)
  target.x = by * az - bz * ay;
  target.y = bz * ax - bx * az;
  target.z = bx * ay - by * ax;
  const lenSq = target.x * target.x + target.y * target.y + target.z * target.z;
  if (lenSq > 0) {
    const inv = 1 / Math.sqrt(lenSq);
    target.x *= inv;
    target.y *= inv;
    target.z *= inv;
  } else {
    target.set(0, 0, 0);
  }
  return target;
}
