// ParametricGeometry — 参数化曲面几何体。
// 参考: three.js/src/geometries/ParametricGeometry.js
//
// 由用户提供的参数函数 (u, v, target) 在 [0,1]×[0,1] 网格上采样,
// 生成 (slices+1) × (stacks+1) 个顶点,按四边形双三角化得到索引,
// 最后用 computeVertexNormals() 计算平滑顶点法线。
//
// 三角形绕序: CCW(逆时针),与 three.js / PlaneGeometry 一致:
//   单元四角 a(左下) b(左上) c(右上) d(右下) → (a,b,d)+(b,c,d)

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math/Vector3';

/** 参数函数:在参数 处求值,把结果点写入 target。 */
export type ParametricFunction = (u: number, v: number, target: Vector3) => void;

/**
 * 参数化曲面几何体。
 *
 * @example
 * // 平面:func = (u, v, t) => t.set(u, v, 0)
 * const geo = new ParametricGeometry((u, v, t) => t.set(u, v, 0), 8, 8);
 *
 * @param func    参数求值函数
 * @param slices  u 方向分段数(默认 8)
 * @param stacks  v 方向分段数(默认 8)
 */
export class ParametricGeometry extends BufferGeometry {
  constructor(func: ParametricFunction, slices: number = 8, stacks: number = 8) {
    super();

    slices = Math.max(1, Math.floor(slices));
    stacks = Math.max(1, Math.floor(stacks));

    const slices1 = slices + 1;
    const stacks1 = stacks + 1;

    const indices: number[] = [];
    const vertices: number[] = [];
    const uvs: number[] = [];

    const target = new Vector3();

    // 生成顶点与 uv:按行主序排列(先 v 后 u)。
    for (let iv = 0; iv < stacks1; iv++) {
      const v = iv / stacks;
      for (let iu = 0; iu < slices1; iu++) {
        const u = iu / slices;
        func(u, v, target);
        vertices.push(target.x, target.y, target.z);
        uvs.push(u, v);
      }
    }

    // 生成索引:每个单元两个三角形 (CCW)。
    // a = iu + iv * slices1 (左下)
    // b = iu + (iv+1) * slices1 (左上)
    // c = (iu+1) + (iv+1) * slices1 (右上)
    // d = (iu+1) + iv * slices1 (右下)
    for (let iv = 0; iv < stacks; iv++) {
      for (let iu = 0; iu < slices; iu++) {
        const a = iu + slices1 * iv;
        const b = iu + slices1 * (iv + 1);
        const c = iu + 1 + slices1 * (iv + 1);
        const d = iu + 1 + slices1 * iv;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeVertexNormals();
    this.computeBoundingBox();
  }
}
