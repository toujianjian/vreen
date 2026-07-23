// GridHelper3D — 三平面 3D 网格辅助器(VREEN 特有)。
//
// 在 XY / YZ / XZ 三个平面上各画一组网格,中心线用 colorCenterLine,
// 其余用 colorGrid。适合在 3D 空间中直观显示坐标系方位。
//
// 与 GridHelper(平面 shader fade 网格)的区别:
//   - GridHelper 是单平面 + 着色器抗锯齿 + 距离衰减,适合地面
//   - GridHelper3D 是三平面线段网格,固定线宽,适合 debug 坐标空间
//
// 用法:
//   const grid = new GridHelper3D(renderer, 10, 10, [0, 0.94, 1], [0.3, 0.3, 0.3]);
//   scene.add(grid);

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram, type RGBTuple } from './lineShaders';

/** 单平面网格的轴向定义:每平面有两组平行线。 */
interface PlaneAxis {
  /** 第一组线的方向向量。 */
  dir1: [number, number, number];
  /** 第二组线的方向向量。 */
  dir2: [number, number, number];
  /** 第一组线的法线(固定坐标)。 */
  fixed1: [number, number, number];
  /** 第二组线的法线(固定坐标)。 */
  fixed2: [number, number, number];
}

// XY / YZ / XZ 三平面的轴向定义
const PLANES: PlaneAxis[] = [
  // XY plane (z=0): 线沿 X 方向(变 Y) + 线沿 Y 方向(变 X)
  { dir1: [1, 0, 0], dir2: [0, 1, 0], fixed1: [0, 0, 1], fixed2: [0, 0, 1] },
  // YZ plane (x=0): 线沿 Y 方向(变 Z) + 线沿 Z 方向(变 Y)
  { dir1: [0, 1, 0], dir2: [0, 0, 1], fixed1: [1, 0, 0], fixed2: [1, 0, 0] },
  // XZ plane (y=0): 线沿 X 方向(变 Z) + 线沿 Z 方向(变 X)
  { dir1: [1, 0, 0], dir2: [0, 0, 1], fixed1: [0, 1, 0], fixed2: [0, 1, 0] },
];

/** 构造三平面网格的几何体(顶点色)。
 *  纯数据,不依赖 WebGL,便于测试。
 *  @param size           网格总边长
 *  @param divisions      每轴分段数(每平面有 divisions+1 条线/方向)
 *  @param colorCenterLine 中心线颜色 [r, g, b]
 *  @param colorGrid      普通网格线颜色 [r, g, b]
 *  @returns BufferGeometry,含 position + color */
export function buildGrid3DGeometry(
  size: number = 10,
  divisions: number = 10,
  colorCenterLine: RGBTuple = [0, 0.94, 1],
  colorGrid: RGBTuple = [0.3, 0.3, 0.3],
): BufferGeometry {
  const half = size / 2;
  const step = size / divisions;
  // 每平面 2*(divisions+1) 条线,3 平面共 6*(divisions+1) 条
  const lineCount = 6 * (divisions + 1);
  const vertexCount = lineCount * 2;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  let vi = 0; // 顶点写入索引

  for (const plane of PLANES) {
    // 两组平行线
    for (let group = 0; group < 2; group++) {
      const dir = group === 0 ? plane.dir1 : plane.dir2;
      const fixed = group === 0 ? plane.fixed1 : plane.fixed2;
      // 沿垂直方向布 (divisions+1) 条线
      for (let i = 0; i <= divisions; i++) {
        const offset = -half + i * step;
        // 中心线判定:offset ≈ 0
        const isCenter = Math.abs(offset) < step * 0.01;
        const col = isCenter ? colorCenterLine : colorGrid;

        // 线起点 = fixed * offset - dir * half
        const x0 = fixed[0] * offset - dir[0] * half;
        const y0 = fixed[1] * offset - dir[1] * half;
        const z0 = fixed[2] * offset - dir[2] * half;
        // 线终点 = fixed * offset + dir * half
        const x1 = fixed[0] * offset + dir[0] * half;
        const y1 = fixed[1] * offset + dir[1] * half;
        const z1 = fixed[2] * offset + dir[2] * half;

        // 写入 2 个顶点
        positions[vi * 3] = x0;
        positions[vi * 3 + 1] = y0;
        positions[vi * 3 + 2] = z0;
        colors[vi * 3] = col[0];
        colors[vi * 3 + 1] = col[1];
        colors[vi * 3 + 2] = col[2];
        vi++;
        positions[vi * 3] = x1;
        positions[vi * 3 + 1] = y1;
        positions[vi * 3 + 2] = z1;
        colors[vi * 3] = col[0];
        colors[vi * 3 + 1] = col[1];
        colors[vi * 3 + 2] = col[2];
        vi++;
      }
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeBoundingBox();
  return geom;
}

/** 三平面 3D 网格辅助器。 */
export class GridHelper3D extends Mesh {
  override readonly type: string = 'GridHelper3D';
  /** 网格边长。 */
  readonly size: number;
  /** 分段数。 */
  readonly divisions: number;

  constructor(
    renderer: WebGL2Renderer,
    size: number = 10,
    divisions: number = 10,
    colorCenterLine: RGBTuple = [0, 0.94, 1],
    colorGrid: RGBTuple = [0.3, 0.3, 0.3],
  ) {
    const geom = buildGrid3DGeometry(size, divisions, colorCenterLine, colorGrid);
    super(geom, { type: 'Basic', renderOrder: 0 } as unknown as Material);
    this.size = size;
    this.divisions = divisions;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getVertexColorLineProgram(renderer.gl),
      uniforms: {
        u_alpha: 0.6,
      },
    };
  }
}
