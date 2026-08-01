// MeshSurfaceSampler — 网格表面均匀采样器。
//
// 适配 three.js `examples/jsm/math/MeshSurfaceSampler.js` (r169)。
// 按三角形面积加权随机采样网格表面上的点,可选输出法线与颜色。
// 用途:
//   - 在地形/物体表面散布植被、粒子、装饰物
//   - 程序化分布对象 (Procedural object distribution)
//   - 基于网格的粒子发射器
//
// 算法:
//   1. build(): 遍历所有三角形,计算面积,构建累积分布 (CDF)。
//      若设置了 weightAttribute,面积乘以顶点权重的平均值。
//   2. sample(): 在 CDF 上二分查找选取一个三角形 (面积大的三角形被选中概率更高),
//      再用 barycentric 坐标在三角形内均匀采样一个点。
//
// Barycentric 均匀采样公式:
//   u = random(), v = random()
//   a = 1 - sqrt(u)
//   b = v * sqrt(u)
//   c = 1 - a - b   (= sqrt(u) * (1 - v))
//   point = a*A + b*B + c*C
//   (sqrt(u) 保证均匀分布,否则点会聚集在三角形中心)
//
// 不变量:
//   - build() 必须在 sample() 前调用;
//   - 几何体须为三角形 (索引化或非索引化);
//   - 采样不修改原 geometry;
//   - 法线 (若请求) 通过 Triangle.getNormal 计算 (面法线,非顶点法线)。
//
// 参考:
//   - three.js examples/jsm/math/MeshSurfaceSampler.js
//   - Osada et al. "Shape Distributions" (2002) — barycentric 均匀采样

import { BufferGeometry } from './BufferGeometry';
import { Vector3 } from '../Math/Vector3';
import { Triangle } from '../Math/Triangle';

const _triangle = new Triangle();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

export interface SampleResult {
  /** 采样点世界坐标 (或几何体局部坐标)。 */
  position: Vector3;
  /** 面法线 (若请求)。 */
  normal?: Vector3;
  /** 颜色 (若请求且 geometry 有 color 属性)。 */
  color?: [number, number, number];
}

/**
 * 网格表面采样器。
 *
 * ```ts
 * const sampler = new MeshSurfaceSampler(terrainGeometry);
 * sampler.build();
 *
 * for (let i = 0; i < 1000; i++) {
 *   const { position, normal } = sampler.sample();
 *   placeTreeAt(position, normal);
 * }
 * ```
 */
export class MeshSurfaceSampler {
  private geometry: BufferGeometry;
  /** 累积分布函数: distribution[i] = Σ_{j=0}^{i} area_j。 */
  private distribution: Float32Array | null = null;
  /** 权重属性名 (可选,默认无)。 */
  private weightAttribute: string | null = null;
  /** 三角形数量。 */
  private faceCount = 0;

  constructor(geometry: BufferGeometry) {
    this.geometry = geometry;
  }

  /**
   * 设置权重属性。顶点该属性的值将乘以三角形面积,使高权重区域被更频繁采样。
   * 必须在 build() 前调用。
   */
  setWeightAttribute(name: string): this {
    this.weightAttribute = name;
    return this;
  }

  /**
   * 构建累积分布。遍历所有三角形,计算面积 × 权重,累加。
   * @returns this (链式)
   */
  build(): this {
    const geometry = this.geometry;
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) {
      throw new Error('MeshSurfaceSampler: geometry missing position attribute');
    }

    const positions = posAttr.array as ArrayLike<number>;
    const index = geometry.index;
    const indexArray = index ? (index.array as ArrayLike<number>) : null;

    const weightAttr = this.weightAttribute
      ? geometry.getAttribute(this.weightAttribute)
      : null;
    const weightArray = weightAttr ? (weightAttr.array as ArrayLike<number>) : null;
    const weightItemSize = weightAttr ? weightAttr.itemSize : 0;

    // 三角形数量
    this.faceCount = indexArray ? indexArray.length / 3 : positions.length / 9;
    this.distribution = new Float32Array(this.faceCount);

    const posItemSize = posAttr.itemSize; // 通常为 3

    let cumulative = 0;
    for (let i = 0; i < this.faceCount; i++) {
      const a = indexArray ? (indexArray[i * 3] as number) : i * 3;
      const b = indexArray ? (indexArray[i * 3 + 1] as number) : i * 3 + 1;
      const c = indexArray ? (indexArray[i * 3 + 2] as number) : i * 3 + 2;

      _a.set(
        positions[a * posItemSize],
        positions[a * posItemSize + 1],
        positions[a * posItemSize + 2],
      );
      _b.set(
        positions[b * posItemSize],
        positions[b * posItemSize + 1],
        positions[b * posItemSize + 2],
      );
      _c.set(
        positions[c * posItemSize],
        positions[c * posItemSize + 1],
        positions[c * posItemSize + 2],
      );

      // 面积 = 0.5 * |AB × AC|
      _triangle.set(_a, _b, _c);
      let faceArea = _triangle.getArea();

      // 应用顶点权重 (三角形 3 顶点权重的平均)
      if (weightArray && weightItemSize > 0) {
        let w = 0;
        for (const vIdx of [a, b, c]) {
          // 若权重是多通道 (如 color RGB),取第一个通道
          w += weightArray[vIdx * weightItemSize];
        }
        w /= 3;
        faceArea *= w;
      }

      cumulative += faceArea;
      this.distribution[i] = cumulative;
    }

    // 归一化 (使最后一个元素 = 1),便于后续用 random() 直接比较
    if (cumulative > 0) {
      const invTotal = 1 / cumulative;
      for (let i = 0; i < this.faceCount; i++) {
        this.distribution[i] *= invTotal;
      }
    }

    return this;
  }

  /**
   * 在网格表面采样一个点。
   *
   * @param targetPosition 写入采样位置 (必须提供)。
   * @param targetNormal   写入面法线 (可选)。
   * @param targetColor    写入颜色 [r,g,b] (可选,需 geometry 有 color 属性)。
   * @returns 传入的 targetPosition。
   */
  sample(
    targetPosition: Vector3,
    targetNormal?: Vector3,
    targetColor?: [number, number, number],
  ): Vector3 {
    if (!this.distribution || this.faceCount === 0) {
      throw new Error('MeshSurfaceSampler: call build() before sample()');
    }

    // ── 1. 按 CDF 选取三角形 (二分查找) ──
    const r = Math.random();
    let faceIndex = this._binarySearch(r);

    // 处理边界 (random 可能略大于最后一个元素)
    if (faceIndex >= this.faceCount) faceIndex = this.faceCount - 1;

    // ── 2. 读取三角形顶点 ──
    const geometry = this.geometry;
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) {
      throw new Error('MeshSurfaceSampler: geometry has no position attribute');
    }
    const positions = posAttr.array as ArrayLike<number>;
    const posItemSize = posAttr.itemSize;
    const index = geometry.index;
    const indexArray = index ? (index.array as ArrayLike<number>) : null;

    const a = indexArray ? (indexArray[faceIndex * 3] as number) : faceIndex * 3;
    const b = indexArray ? (indexArray[faceIndex * 3 + 1] as number) : faceIndex * 3 + 1;
    const c = indexArray ? (indexArray[faceIndex * 3 + 2] as number) : faceIndex * 3 + 2;

    _a.set(
      positions[a * posItemSize],
      positions[a * posItemSize + 1],
      positions[a * posItemSize + 2],
    );
    _b.set(
      positions[b * posItemSize],
      positions[b * posItemSize + 1],
      positions[b * posItemSize + 2],
    );
    _c.set(
      positions[c * posItemSize],
      positions[c * posItemSize + 1],
      positions[c * posItemSize + 2],
    );

    // ── 3. Barycentric 均匀采样 ──
    const u = Math.random();
    const v = Math.random();
    const ba = 1 - Math.sqrt(u);
    const bb = v * Math.sqrt(u);
    const bc = 1 - ba - bb;

    targetPosition.set(
      ba * _a.x + bb * _b.x + bc * _c.x,
      ba * _a.y + bb * _b.y + bc * _c.y,
      ba * _a.z + bb * _b.z + bc * _c.z,
    );

    // ── 4. 法线 (面法线) ──
    if (targetNormal) {
      Triangle.getNormal(_a, _b, _c, targetNormal);
    }

    // ── 5. 颜色 (barycentric 插值顶点颜色) ──
    if (targetColor) {
      const colorAttr = geometry.getAttribute('color');
      if (colorAttr) {
        const colors = colorAttr.array as ArrayLike<number>;
        const cs = colorAttr.itemSize;
        targetColor[0] = ba * colors[a * cs] + bb * colors[b * cs] + bc * colors[c * cs];
        targetColor[1] = ba * colors[a * cs + 1] + bb * colors[b * cs + 1] + bc * colors[c * cs + 1];
        targetColor[2] = ba * colors[a * cs + 2] + bb * colors[b * cs + 2] + bc * colors[c * cs + 2];
      } else {
        targetColor[0] = 1;
        targetColor[1] = 1;
        targetColor[2] = 1;
      }
    }

    return targetPosition;
  }

  /**
   * 批量采样 n 个点。
   * @param n 采样数量
   * @returns Vector3 数组 (每个为新分配的 Vector3)
   */
  sampleBatch(n: number): Vector3[] {
    const result: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      result.push(this.sample(new Vector3()));
    }
    return result;
  }

  /** 累积分布的最后一个值 (= 1.0 若归一化,= 总面积 若未归一化)。 */
  get totalArea(): number {
    if (!this.distribution || this.faceCount === 0) return 0;
    return this.distribution[this.faceCount - 1];
  }

  /** 三角形数量。 */
  get triangleCount(): number {
    return this.faceCount;
  }

  // ── 内部 ──────────────────────────────────────────────────

  /**
   * 在 CDF 上二分查找,返回第一个使 distribution[i] >= r 的索引。
   * 这是面积加权采样:面积大的三角形对应的 CDF 区间更长,被命中的概率更高。
   */
  private _binarySearch(r: number): number {
    const dist = this.distribution!;
    let lo = 0;
    let hi = this.faceCount - 1;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (dist[mid] < r) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return lo;
  }
}
