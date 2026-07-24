// WireframeGeometry — 线框几何体,从 three.js 移植并适配 VREEN 引擎。
// 从一个 BufferGeometry 中抽取所有唯一的三角形边,输出为按线段排布的顶点流。
// 不输出索引(每两个顶点构成一条线段),适合 LineSegments 渲染。
// 参考: three.js/src/geometries/WireframeGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math';

/** 线框:从现有几何体抽取所有不重复的边。 */
export class WireframeGeometry extends BufferGeometry {
  constructor(geometry: BufferGeometry | null = null) {
    super();

    if (geometry !== null) {
      const vertices: number[] = [];
      // 用字符串集合去重,正反两种顺序都视为同一条边
      const edges = new Set<string>();

      const start = new Vector3();
      const end = new Vector3();

      const position = geometry.attributes.position;
      if (!position) {
        // 没有位置属性的几何体无法生成线框
        this.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
        return;
      }

      const index = geometry.index;
      const posArr = position.array;

      if (index !== null) {
        // 索引几何体:按 groups 划分(若无 group 视为整体)
        let groups = geometry.groups;
        if (groups.length === 0) {
          groups = [{ start: 0, count: index.count, materialIndex: 0 }];
        }

        for (let o = 0, ol = groups.length; o < ol; o++) {
          const group = groups[o];
          const groupStart = group.start;
          const groupCount = group.count;

          for (let i = groupStart, l = groupStart + groupCount; i < l; i += 3) {
            for (let j = 0; j < 3; j++) {
              const index1 = index.array[i + j];
              const index2 = index.array[i + ((j + 1) % 3)];

              fromBufferAttribute(start, posArr, index1);
              fromBufferAttribute(end, posArr, index2);

              if (isUniqueEdge(start, end, edges)) {
                vertices.push(start.x, start.y, start.z);
                vertices.push(end.x, end.y, end.z);
              }
            }
          }
        }
      } else {
        // 非索引几何体:每三个顶点构成一个三角形
        for (let i = 0, l = position.count / 3; i < l; i++) {
          for (let j = 0; j < 3; j++) {
            const index1 = 3 * i + j;
            const index2 = 3 * i + ((j + 1) % 3);

            fromBufferAttribute(start, posArr, index1);
            fromBufferAttribute(end, posArr, index2);

            if (isUniqueEdge(start, end, edges)) {
              vertices.push(start.x, start.y, start.z);
              vertices.push(end.x, end.y, end.z);
            }
          }
        }
      }

      this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    }
  }
}

/** 从 BufferAttribute 数组读取第 index 个三维顶点到 target。
 *  VREEN 的 BufferAttribute.array 是 Float32Array,itemSize=3。 */
function fromBufferAttribute(target: Vector3, arr: ArrayLike<number>, index: number): Vector3 {
  const o = index * 3;
  target.x = arr[o];
  target.y = arr[o + 1];
  target.z = arr[o + 2];
  return target;
}

/** 判断 (start→end) 是否为尚未见过的边;若是则加入集合。 */
function isUniqueEdge(start: Vector3, end: Vector3, edges: Set<string>): boolean {
  const hash1 = `${start.x},${start.y},${start.z}-${end.x},${end.y},${end.z}`;
  const hash2 = `${end.x},${end.y},${end.z}-${start.x},${start.y},${start.z}`;

  if (edges.has(hash1) || edges.has(hash2)) {
    return false;
  }
  edges.add(hash1);
  edges.add(hash2);
  return true;
}
