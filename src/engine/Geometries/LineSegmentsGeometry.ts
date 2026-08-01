// LineSegmentsGeometry — 粗线几何体,配合 LineSegments2 / Line2 使用。
//
// 参考 three.js examples/jsm/lines/LineSegmentsGeometry.js。核心思想:
// 把每条线段作为一个"实例",用一份共享的四边形模板(8 顶点 / 18 索引)
// 实例化绘制,顶点着色器根据 instanceStart/instanceEnd 与模板的 position/uv
// 在屏幕空间把四边形扩展成带宽度的线段(含端点圆角帽)。
//
// 适配 VREEN 自研 InstancedGeometry:
//   - three.js 用 InstancedInterleavedBuffer + InterleavedBufferAttribute 存储
//     instanceStart/instanceEnd(interleaved xyz,xyz);
//   - VREEN 用 InstancedGeometry.customAttributes(itemSize=3)分别存储
//     instanceStart / instanceEnd,渲染器按 instanced vertex attrib 绑定。
//   - instanceMatrix 保持 identity(每实例),线段端点直接由 instanceStart/End
//     给出,经 matrixWorld 变换到世界空间。
//
// 模板几何(three.js 原值,不要改动 — shader 依赖):
//   position: [-1,2,0, 1,2,0, -1,1,0, 1,1,0, -1,0,0, 1,0,0, -1,-1,0, 1,-1,0]
//   uv:       [-1,2, 1,2, -1,1, 1,1, -1,-1, 1,-1, -1,-2, 1,-2]
//   index:    [0,2,1, 2,3,1, 2,4,3, 4,5,3, 4,6,5, 6,7,5]
// position.x ∈ {-1,1} 控制垂直于线段方向的左右偏移;
// position.y ∈ {-1,0,1,2} 配合 uv.y 控制沿线段方向的位置与端帽。

import { InstancedGeometry } from './InstancedGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math/Vector3';

// 模板几何(three.js 原值,shader 依赖,勿改)。
const BASE_POSITIONS = new Float32Array([
  -1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0,
]);
const BASE_UVS = new Float32Array([-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2]);
const BASE_INDEX = [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5];

// computeBoundingBox / computeBoundingSphere 内部复用。
const _vec = new Vector3();
const _center = new Vector3();

/**
 * 粗线段几何体 — 每条线段一个实例,配合 LineSegments2 + LineMaterial 绘制带宽度的线。
 *
 * 用 `setPositions([x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3, ...])` 喂入
 * 线段端点对(每 6 个 float 一段)。可选 `setColors([r0,g0,b0, r1,g1,b1, ...])`
 * 设置逐段顶点颜色。
 */
export class LineSegmentsGeometry extends InstancedGeometry {
  readonly type: string = 'LineSegmentsGeometry';
  /** 类型标志。 */
  isLineSegmentsGeometry: boolean = true;

  constructor() {
    super();
    this.setIndex(BASE_INDEX);
    this.setAttribute('position', new BufferAttribute(BASE_POSITIONS.slice(), 3));
    this.setAttribute('uv', new BufferAttribute(BASE_UVS.slice(), 2));
  }

  /**
   * 设置线段端点对。array 为扁平 [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...],
   * 每 6 个 float 构成一段(instanceStart + instanceEnd)。
   */
  setPositions(array: ArrayLike<number>): this {
    const src = array instanceof Float32Array ? array : new Float32Array(array);
    if (src.length % 6 !== 0) {
      throw new Error(
        `LineSegmentsGeometry.setPositions: length must be a multiple of 6 (got ${src.length})`,
      );
    }
    const segmentCount = src.length / 6;
    this.allocate(segmentCount); // instanceCount = segmentCount,instanceMatrix 全 identity

    // 直接填充 instanceStart / instanceEnd(interleaved xyz,xyz → 两个 itemSize=3 属性)。
    const startBuf = new Float32Array(segmentCount * 3);
    const endBuf = new Float32Array(segmentCount * 3);
    for (let i = 0; i < segmentCount; i++) {
      const s = i * 6;
      const d = i * 3;
      startBuf[d] = src[s];
      startBuf[d + 1] = src[s + 1];
      startBuf[d + 2] = src[s + 2];
      endBuf[d] = src[s + 3];
      endBuf[d + 1] = src[s + 4];
      endBuf[d + 2] = src[s + 5];
    }
    this.customAttributes.set('instanceStart', startBuf);
    this.customAttributeSizes.set('instanceStart', 3);
    this.customAttributeVersions.set('instanceStart', (this.customAttributeVersions.get('instanceStart') ?? 0) + 1);
    this.customAttributes.set('instanceEnd', endBuf);
    this.customAttributeSizes.set('instanceEnd', 3);
    this.customAttributeVersions.set('instanceEnd', (this.customAttributeVersions.get('instanceEnd') ?? 0) + 1);

    this.computeBoundingBox();
    this.computeBoundingSphere();
    return this;
  }

  /**
   * 设置逐段顶点颜色。array 为扁平 [r0,g0,b0, r1,g1,b1, ...],
   * 每 6 个 float 构成一段(instanceColorStart + instanceColorEnd)。
   * 长度必须与 setPositions 的端点对数一致。
   */
  setColors(array: ArrayLike<number>): this {
    const src = array instanceof Float32Array ? array : new Float32Array(array);
    if (src.length % 6 !== 0) {
      throw new Error(
        `LineSegmentsGeometry.setColors: length must be a multiple of 6 (got ${src.length})`,
      );
    }
    const segmentCount = src.length / 6;
    if (segmentCount !== this.instanceCount) {
      throw new Error(
        `LineSegmentsGeometry.setColors: color segment count (${segmentCount}) ` +
          `does not match position segment count (${this.instanceCount})`,
      );
    }
    const startBuf = new Float32Array(segmentCount * 3);
    const endBuf = new Float32Array(segmentCount * 3);
    for (let i = 0; i < segmentCount; i++) {
      const s = i * 6;
      const d = i * 3;
      startBuf[d] = src[s];
      startBuf[d + 1] = src[s + 1];
      startBuf[d + 2] = src[s + 2];
      endBuf[d] = src[s + 3];
      endBuf[d + 1] = src[s + 4];
      endBuf[d + 2] = src[s + 5];
    }
    this.customAttributes.set('instanceColorStart', startBuf);
    this.customAttributeSizes.set('instanceColorStart', 3);
    this.customAttributeVersions.set('instanceColorStart', (this.customAttributeVersions.get('instanceColorStart') ?? 0) + 1);
    this.customAttributes.set('instanceColorEnd', endBuf);
    this.customAttributeSizes.set('instanceColorEnd', 3);
    this.customAttributeVersions.set('instanceColorEnd', (this.customAttributeVersions.get('instanceColorEnd') ?? 0) + 1);
    return this;
  }

  /** 从 WireframeGeometry / EdgesGeometry 的 position 数组导入(非索引)。 */
  fromWireframeGeometry(positions: ArrayLike<number>): this {
    this.setPositions(positions);
    return this;
  }

  /** 从非索引 LineSegments 的 position 数组导入。 */
  fromLineSegments(positions: ArrayLike<number>): this {
    this.setPositions(positions);
    return this;
  }

  /**
   * 把 instanceStart/instanceEnd 整体应用矩阵(用于批量变换几何体)。
   * 与 three.js LineSegmentsGeometry.applyMatrix4 等价。
   */
  override applyMatrix4(matrix: { elements: Float32Array | number[] }): this {
    const start = this.customAttributes.get('instanceStart');
    const end = this.customAttributes.get('instanceEnd');
    if (start && end) {
      for (let i = 0; i < start.length; i += 3) {
        _vec.set(start[i], start[i + 1], start[i + 2]).applyMatrix4(matrix);
        start[i] = _vec.x;
        start[i + 1] = _vec.y;
        start[i + 2] = _vec.z;
        _vec.set(end[i], end[i + 1], end[i + 2]).applyMatrix4(matrix);
        end[i] = _vec.x;
        end[i + 1] = _vec.y;
        end[i + 2] = _vec.z;
      }
      this.customAttributeVersions.set('instanceStart', (this.customAttributeVersions.get('instanceStart') ?? 0) + 1);
      this.customAttributeVersions.set('instanceEnd', (this.customAttributeVersions.get('instanceEnd') ?? 0) + 1);
    }
    if (this.boundingBox) this.computeBoundingBox();
    if (this.boundingSphere) this.computeBoundingSphere();
    return this;
  }

  override computeBoundingBox(): void {
    const start = this.customAttributes.get('instanceStart');
    const end = this.customAttributes.get('instanceEnd');
    if (!start || !end) {
      this.boundingBox = null;
      return;
    }
    // 遍历所有 instanceStart/instanceEnd 点,取 min/max。
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < start.length; i += 3) {
      _vec.set(start[i], start[i + 1], start[i + 2]);
      min.min(_vec);
      max.max(_vec);
    }
    for (let i = 0; i < end.length; i += 3) {
      _vec.set(end[i], end[i + 1], end[i + 2]);
      min.min(_vec);
      max.max(_vec);
    }
    this.boundingBox = { min, max };
  }

  override computeBoundingSphere(): void {
    if (this.boundingBox === null) this.computeBoundingBox();
    const bb = this.boundingBox;
    if (!bb) {
      this.boundingSphere = null;
      return;
    }
    const start = this.customAttributes.get('instanceStart');
    const end = this.customAttributes.get('instanceEnd');
    if (!start || !end) return;
    // 中心 = (min + max) / 2,半径 = 所有端点到中心的最大距离。
    _center.copy(bb.min).add(bb.max).multiplyScalar(0.5);
    let maxRadiusSq = 0;
    for (let i = 0; i < start.length; i += 3) {
      _vec.set(start[i], start[i + 1], start[i + 2]);
      maxRadiusSq = Math.max(maxRadiusSq, _center.distanceToSquared(_vec));
      _vec.set(end[i], end[i + 1], end[i + 2]);
      maxRadiusSq = Math.max(maxRadiusSq, _center.distanceToSquared(_vec));
    }
    this.boundingSphere = { center: _center.clone(), radius: Math.sqrt(maxRadiusSq) };
  }
}
