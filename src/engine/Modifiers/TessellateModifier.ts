// TessellateModifier — 细分修饰器,从 three.js TessellateModifier 移植并适配 VREEN 引擎。
// 反复细分三角形面:任一边长超过 maxEdgeLength 时,在最长边中点分裂为两个三角形,
// 直到没有边超限或达到 maxIterations。法线/UV 在中点处线性插值。
// 参考: three.js/examples/jsm/modifiers/TessellateModifier.js
//
// 与 three.js 版本的差异:
//   - VREEN BufferGeometry 无 toNonIndexed,内部手动展开索引为非索引数组。
//   - 仅处理三角形 (VREEN 引擎面索引按每 3 个一组)。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 细分选项。 */
export interface TessellateOptions {
  /** 触发细分的最长边阈值 (默认 0.1)。 */
  maxEdgeLength?: number;
  /** 若为 true,输出仅含三角形 (默认 true)。VREEN 总是输出三角形。 */
  triangles?: boolean;
  /** 最大细分迭代次数 (默认 10)。 */
  maxIterations?: number;
}

/**
 * 细分几何体面,使任一边长不超过 maxEdgeLength。
 *
 * 每次迭代:
 *   1. 对每个三角形,计算三边长度平方。
 *   2. 若任一边 > maxEdgeLength,在最长边中点分裂 → 2 个新三角形。
 *   3. 在中点处对法线/UV 做线性插值。
 * 重复至无超限边或达到 maxIterations。
 */
export class TessellateModifier {
  readonly maxEdgeLength: number;
  readonly triangles: boolean;
  readonly maxIterations: number;

  constructor(options: TessellateOptions = {}) {
    this.maxEdgeLength = options.maxEdgeLength ?? 0.1;
    this.triangles = options.triangles ?? true;
    this.maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 10));
  }

  /** 对 geometry 应用细分。返回一个新的 BufferGeometry,原几何体不变。 */
  modify(geometry: BufferGeometry): BufferGeometry {
    const posAttr = geometry.getAttribute('position');
    const result = new BufferGeometry();
    if (!posAttr) return result;

    const hasNormal = !!geometry.getAttribute('normal');
    const hasUv = !!geometry.getAttribute('uv');

    // 展开为非索引数组 (每三角形 3 顶点)
    let positions: number[] = [];
    let normals: number[] = [];
    let uvs: number[] = [];

    const pa = posAttr.array;
    const na = hasNormal ? geometry.getAttribute('normal')!.array : null;
    const ua = hasUv ? geometry.getAttribute('uv')!.array : null;
    const idx = geometry.index;

    if (idx) {
      const ia = idx.array as unknown as ArrayLike<number>;
      for (let i = 0; i < ia.length; i++) {
        const vi = ia[i];
        positions.push(pa[vi * 3], pa[vi * 3 + 1], pa[vi * 3 + 2]);
        if (na) normals.push(na[vi * 3], na[vi * 3 + 1], na[vi * 3 + 2]);
      }
      if (ua) {
        for (let i = 0; i < ia.length; i++) {
          const vi = ia[i];
          uvs.push(ua[vi * 2], ua[vi * 2 + 1]);
        }
      }
    } else {
      for (let i = 0; i < pa.length; i++) positions.push(pa[i]);
      if (na) for (let i = 0; i < na.length; i++) normals.push(na[i]);
      if (ua) for (let i = 0; i < ua.length; i++) uvs.push(ua[i]);
    }

    const maxEdgeLengthSquared = this.maxEdgeLength * this.maxEdgeLength;
    let iteration = 0;
    let tessellating = true;

    while (tessellating && iteration < this.maxIterations) {
      iteration++;
      tessellating = false;

      const newPositions: number[] = [];
      const newNormals: number[] = [];
      const newUvs: number[] = [];

      for (let i = 0, i2 = 0; i < positions.length; i += 9, i2 += 6) {
        const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
        const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
        const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];

        const dab = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
        const dbc = (bx - cx) ** 2 + (by - cy) ** 2 + (bz - cz) ** 2;
        const dac = (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2;

        if (dab > maxEdgeLengthSquared || dbc > maxEdgeLengthSquared || dac > maxEdgeLengthSquared) {
          tessellating = true;

          if (dab >= dbc && dab >= dac) {
            // 在 ab 中点分裂 → (a, m, c) + (m, b, c)
            const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
            newPositions.push(ax, ay, az, mx, my, mz, cx, cy, cz);
            newPositions.push(mx, my, mz, bx, by, bz, cx, cy, cz);
            if (hasNormal) {
              const i3 = i;
              const na0 = normals[i3], na1 = normals[i3 + 1], na2 = normals[i3 + 2];
              const nb0 = normals[i3 + 3], nb1 = normals[i3 + 4], nb2 = normals[i3 + 5];
              const nc0 = normals[i3 + 6], nc1 = normals[i3 + 7], nc2 = normals[i3 + 8];
              const m0 = (na0 + nb0) / 2, m1 = (na1 + nb1) / 2, m2 = (na2 + nb2) / 2;
              newNormals.push(na0, na1, na2, m0, m1, m2, nc0, nc1, nc2);
              newNormals.push(m0, m1, m2, nb0, nb1, nb2, nc0, nc1, nc2);
            }
            if (hasUv) {
              const uax = uvs[i2], uay = uvs[i2 + 1];
              const ubx = uvs[i2 + 2], uby = uvs[i2 + 3];
              const ucx = uvs[i2 + 4], ucy = uvs[i2 + 5];
              const umx = (uax + ubx) / 2, umy = (uay + uby) / 2;
              newUvs.push(uax, uay, umx, umy, ucx, ucy);
              newUvs.push(umx, umy, ubx, uby, ucx, ucy);
            }
          } else if (dbc >= dab && dbc >= dac) {
            // 在 bc 中点分裂 → (a, b, m) + (m, c, a)
            const mx = (bx + cx) / 2, my = (by + cy) / 2, mz = (bz + cz) / 2;
            newPositions.push(ax, ay, az, bx, by, bz, mx, my, mz);
            newPositions.push(mx, my, mz, cx, cy, cz, ax, ay, az);
            if (hasNormal) {
              const i3 = i;
              const na0 = normals[i3], na1 = normals[i3 + 1], na2 = normals[i3 + 2];
              const nb0 = normals[i3 + 3], nb1 = normals[i3 + 4], nb2 = normals[i3 + 5];
              const nc0 = normals[i3 + 6], nc1 = normals[i3 + 7], nc2 = normals[i3 + 8];
              const m0 = (nb0 + nc0) / 2, m1 = (nb1 + nc1) / 2, m2 = (nb2 + nc2) / 2;
              newNormals.push(na0, na1, na2, nb0, nb1, nb2, m0, m1, m2);
              newNormals.push(m0, m1, m2, nc0, nc1, nc2, na0, na1, na2);
            }
            if (hasUv) {
              const uax = uvs[i2], uay = uvs[i2 + 1];
              const ubx = uvs[i2 + 2], uby = uvs[i2 + 3];
              const ucx = uvs[i2 + 4], ucy = uvs[i2 + 5];
              const umx = (ubx + ucx) / 2, umy = (uby + ucy) / 2;
              newUvs.push(uax, uay, ubx, uby, umx, umy);
              newUvs.push(umx, umy, ucx, ucy, uax, uay);
            }
          } else {
            // 在 ac 中点分裂 → (a, b, m) + (m, b, c)
            const mx = (ax + cx) / 2, my = (ay + cy) / 2, mz = (az + cz) / 2;
            newPositions.push(ax, ay, az, bx, by, bz, mx, my, mz);
            newPositions.push(mx, my, mz, bx, by, bz, cx, cy, cz);
            if (hasNormal) {
              const i3 = i;
              const na0 = normals[i3], na1 = normals[i3 + 1], na2 = normals[i3 + 2];
              const nb0 = normals[i3 + 3], nb1 = normals[i3 + 4], nb2 = normals[i3 + 5];
              const nc0 = normals[i3 + 6], nc1 = normals[i3 + 7], nc2 = normals[i3 + 8];
              const m0 = (na0 + nc0) / 2, m1 = (na1 + nc1) / 2, m2 = (na2 + nc2) / 2;
              newNormals.push(na0, na1, na2, nb0, nb1, nb2, m0, m1, m2);
              newNormals.push(m0, m1, m2, nb0, nb1, nb2, nc0, nc1, nc2);
            }
            if (hasUv) {
              const uax = uvs[i2], uay = uvs[i2 + 1];
              const ubx = uvs[i2 + 2], uby = uvs[i2 + 3];
              const ucx = uvs[i2 + 4], ucy = uvs[i2 + 5];
              const umx = (uax + ucx) / 2, umy = (uay + ucy) / 2;
              newUvs.push(uax, uay, ubx, uby, umx, umy);
              newUvs.push(umx, umy, ubx, uby, ucx, ucy);
            }
          }
        } else {
          // 保留原三角形
          newPositions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
          if (hasNormal) {
            for (let k = 0; k < 9; k++) newNormals.push(normals[i + k]);
          }
          if (hasUv) {
            for (let k = 0; k < 6; k++) newUvs.push(uvs[i2 + k]);
          }
        }
      }

      positions = newPositions;
      normals = newNormals;
      uvs = newUvs;
    }

    result.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    if (hasNormal) {
      result.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    } else {
      result.computeVertexNormals();
    }
    if (hasUv) {
      result.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    }
    result.computeBoundingBox();
    return result;
  }
}
