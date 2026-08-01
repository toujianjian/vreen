// RoundedBoxGeometry — 圆角盒子几何体 (rounded box)。
//
// 适配 three.js `examples/jsm/geometries/RoundedBoxGeometry.js` 并重构。
// 生成一个所有棱角被圆滑过渡的长方体,用于:
//   - UI 按钮 / 卡片 / 面板的 3D 表示
//   - 风格化低多边形场景
//   - 游戏中的圆角道具 / 容器
//
// 原理:
//   1. 先生成普通分段 BoxGeometry 顶点(均匀网格);
//   2. 对每个顶点,判断它位于哪个"区域":
//      - 面区域(距离所有边 ≥ radius):保持原位
//      - 边区域(1 个轴超出内框):沿该边方向做圆柱过渡
//      - 角区域(2-3 个轴超出内框):做球面过渡
//   3. 区域判定:对每个轴 i,若 |v[i]| > half[i] - radius,则该轴"超出"
//   4. 将超出轴的坐标限制到内框边界,然后用球面/圆柱公式修正
//
// 不变量:
//   - radius ≤ min(width, height, depth) / 2;
//   - 顶点数 = (segments+1)² × 6(每面网格);
//   - 法线从顶点位置计算(圆角法线自动正确)。
//
// 参考:
//   - three.js examples/jsm/geometries/RoundedBoxGeometry.js
//   - "Rounded Box" by Inigo Quilez

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/**
 * 圆角盒子几何体。
 *
 * 继承 BufferGeometry,在构造时生成圆角盒子顶点/法线/UV。
 */
export class RoundedBoxGeometry extends BufferGeometry {
  /**
   * @param width X 方向尺寸。默认 1。
   * @param height Y 方向尺寸。默认 1。
   * @param depth Z 方向尺寸。默认 1。
   * @param segments 每面分段数(越高越圆滑)。默认 2。
   * @param radius 圆角半径。默认 0.1。
   */
  constructor(
    width: number = 1,
    height: number = 1,
    depth: number = 1,
    segments: number = 2,
    radius: number = 0.1,
  ) {
    super();

    width = Math.max(0.001, width);
    height = Math.max(0.001, height);
    depth = Math.max(0.001, depth);

    // 确保半径不超过最小尺寸的一半
    const maxRadius = Math.min(width, height, depth) / 2;
    radius = Math.max(0, Math.min(radius, maxRadius));

    segments = Math.max(1, Math.floor(segments));

    this._build(width, height, depth, segments, radius);
  }

  private _build(
    width: number,
    height: number,
    depth: number,
    segments: number,
    radius: number,
  ): void {
    const halfW = width / 2;
    const halfH = height / 2;
    const halfD = depth / 2;

    // 内框边界(面区域的外边界)
    const innerW = halfW - radius;
    const innerH = halfH - radius;
    const innerD = halfD - radius;

    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // 构建 6 面,每面 (segments+1) × (segments+1) 顶点
    // 面定义: [uAxis, vAxis, wAxis, uDir, vDir, wSize, uSize, vSize]
    // uAxis/vAxis 是面内的两个轴,wAxis 是法线轴
    const faces = [
      // +X 面: 法线 +X,面内 Y-Z
      { uAxis: 1, vAxis: 2, wAxis: 0, uDir: 1, vDir: 1, wSign: 1, uSize: height, vSize: depth, wSize: width },
      // -X 面: 法线 -X
      { uAxis: 1, vAxis: 2, wAxis: 0, uDir: 1, vDir: 1, wSign: -1, uSize: height, vSize: depth, wSize: width },
      // +Y 面: 法线 +Y,面内 X-Z
      { uAxis: 0, vAxis: 2, wAxis: 1, uDir: 1, vDir: 1, wSign: 1, uSize: width, vSize: depth, wSize: height },
      // -Y 面: 法线 -Y
      { uAxis: 0, vAxis: 2, wAxis: 1, uDir: 1, vDir: 1, wSign: -1, uSize: width, vSize: depth, wSize: height },
      // +Z 面: 法线 +Z,面内 X-Y
      { uAxis: 0, vAxis: 1, wAxis: 2, uDir: 1, vDir: 1, wSign: 1, uSize: width, vSize: height, wSize: depth },
      // -Z 面: 法线 -Z
      { uAxis: 0, vAxis: 1, wAxis: 2, uDir: 1, vDir: 1, wSign: -1, uSize: width, vSize: height, wSize: depth },
    ];

    let vertexOffset = 0;

    for (const face of faces) {
      const { uAxis, vAxis, wAxis, wSign, uSize, vSize, wSize } = face;

      // 面的 w 坐标(固定值)
      const wCoord = wSign * (wSize / 2);

      // 面内顶点范围: [-uSize/2, uSize/2] × [-vSize/2, vSize/2]
      const uHalf = uSize / 2;
      const vHalf = vSize / 2;

      for (let iy = 0; iy <= segments; iy++) {
        const v = -vHalf + (iy / segments) * vSize;
        for (let ix = 0; ix <= segments; ix++) {
          const u = -uHalf + (ix / segments) * uSize;

          // 构建顶点坐标
          const pos = [0, 0, 0];
          pos[uAxis] = u;
          pos[vAxis] = v;
          pos[wAxis] = wCoord;

          // 应用圆角变形
          const rounded = this._roundVertex(pos, innerW, innerH, innerD, radius);

          vertices.push(rounded[0], rounded[1], rounded[2]);

          // 法线 = 从内框中心指向顶点(球面法线)
          // 对面区域:法线 = 面法线
          // 对边/角区域:法线 = 从内框点指向顶点
          const normal = this._computeNormal(pos, rounded, innerW, innerH, innerD, wAxis, wSign);
          normals.push(normal[0], normal[1], normal[2]);

          // UV: [0,1] × [0,1]
          uvs.push(ix / segments, iy / segments);
        }
      }

      // 索引
      const rowCount = segments + 1;
      for (let iy = 0; iy < segments; iy++) {
        for (let ix = 0; ix < segments; ix++) {
          const a = vertexOffset + iy * rowCount + ix;
          const b = vertexOffset + iy * rowCount + ix + 1;
          const c = vertexOffset + (iy + 1) * rowCount + ix;
          const d = vertexOffset + (iy + 1) * rowCount + ix + 1;

          // 根据 wSign 决定绕序(确保法线朝外)
          if (wSign > 0) {
            indices.push(a, c, b, b, c, d);
          } else {
            indices.push(a, b, c, b, d, c);
          }
        }
      }

      vertexOffset += rowCount * rowCount;
    }

    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(indices);
    this.computeBoundingBox();
    this.computeBoundingSphere();
  }

  /**
   * 对顶点应用圆角变形。
   *
   * 对每个轴,如果 |pos[i]| > inner[i],则该轴"超出",需要圆角。
   * 将超出轴的坐标限制到 inner 边界,然后从限制后的点向原顶点方向
   * 偏移 radius 距离(球面/圆柱过渡)。
   */
  private _roundVertex(
    pos: number[],
    innerW: number,
    innerH: number,
    innerD: number,
    radius: number,
  ): number[] {
    const inner = [innerW, innerH, innerD];
    const result = [pos[0], pos[1], pos[2]];

    // 对每个轴检查是否超出内框
    const clamped = [0, 0, 0];
    const exceeds = [false, false, false];
    let exceedCount = 0;

    for (let i = 0; i < 3; i++) {
      if (Math.abs(pos[i]) > inner[i]) {
        exceeds[i] = true;
        exceedCount++;
        clamped[i] = Math.sign(pos[i]) * inner[i];
      } else {
        clamped[i] = pos[i];
      }
    }

    if (exceedCount === 0) {
      // 面区域:不变形
      return result;
    }

    // 从 clamped 点出发,沿 (pos - clamped) 方向偏移 radius
    const dx = pos[0] - clamped[0];
    const dy = pos[1] - clamped[1];
    const dz = pos[2] - clamped[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < 1e-9) {
      return clamped;
    }

    // 归一化方向,乘以 radius
    const scale = radius / dist;
    result[0] = clamped[0] + dx * scale;
    result[1] = clamped[1] + dy * scale;
    result[2] = clamped[2] + dz * scale;

    return result;
  }

  /**
   * 计算顶点法线。
   *
   * 面区域:法线 = 面法线。
   * 边/角区域:法线 = 从内框点指向圆角后的顶点(球面法线)。
   */
  private _computeNormal(
    originalPos: number[],
    roundedPos: number[],
    innerW: number,
    innerH: number,
    innerD: number,
    wAxis: number,
    wSign: number,
  ): number[] {
    const inner = [innerW, innerH, innerD];

    // 检查是否在面区域
    let onFace = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(originalPos[i]) > inner[i] + 1e-9) {
        onFace = false;
        break;
      }
    }

    if (onFace) {
      // 面区域:法线 = 面法线
      const n = [0, 0, 0];
      n[wAxis] = wSign;
      return n;
    }

    // 边/角区域:法线 = 从内框点指向圆角顶点
    const clamped = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(originalPos[i]) > inner[i]) {
        clamped[i] = Math.sign(originalPos[i]) * inner[i];
      } else {
        clamped[i] = originalPos[i];
      }
    }

    const nx = roundedPos[0] - clamped[0];
    const ny = roundedPos[1] - clamped[1];
    const nz = roundedPos[2] - clamped[2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (len < 1e-9) {
      const n = [0, 0, 0];
      n[wAxis] = wSign;
      return n;
    }

    return [nx / len, ny / len, nz / len];
  }
}
