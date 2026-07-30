// Box3Helper — AABB 包围盒线框辅助器(基于 Box3 而非 Object3D 子树)。
// 参考: three.js/src/helpers/Box3Helper.js,适配 VREEN 自研引擎:
//   - 直接读取 Box3 的 min/max,生成 12 条棱的线段
//   - 非索引:12 边 × 2 顶点 = 24 个 position
//   - 单色线段 shader(u_color uniform),与 BoxHelper 一致
//
// 与 BoxHelper 的区别:BoxHelper 追踪 Object3D 子树的世界 AABB 并可 update();
// Box3Helper 直接接受一个静态 Box3,无追踪。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import { Box3 } from '../Math';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getLineProgram, type RGBTuple } from './lineShaders';

// 12 条棱,引用下方 8 个角点索引。每对 (i, j) 为一条线段。
const BOX_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0], // +Z 面
  [4, 5], [5, 6], [6, 7], [7, 4], // -Z 面
  [0, 4], [1, 5], [2, 6], [3, 7], // 立柱
];

/**
 * 构造 Box3Helper 的几何体(12 边 × 2 顶点 = 24 顶点)。纯数据,便于测试。
 * @param box 目标包围盒
 * @returns BufferGeometry,含 position(24 顶点)
 */
export function buildBox3Geometry(box: Box3): BufferGeometry {
  const min = box.min;
  const max = box.max;

  // 8 个角点(索引与 BOX_EDGES 对齐)。
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [max.x, max.y, max.z], // 0
    [min.x, max.y, max.z], // 1
    [min.x, min.y, max.z], // 2
    [max.x, min.y, max.z], // 3
    [max.x, max.y, min.z], // 4
    [min.x, max.y, min.z], // 5
    [min.x, min.y, min.z], // 6
    [max.x, min.y, min.z], // 7
  ];

  const positions = new Float32Array(BOX_EDGES.length * 2 * 3); // 12 × 2 × 3 = 72
  let vi = 0;
  for (const [i, j] of BOX_EDGES) {
    const a = corners[i];
    const b = corners[j];
    positions[vi++] = a[0]; positions[vi++] = a[1]; positions[vi++] = a[2];
    positions[vi++] = b[0]; positions[vi++] = b[1]; positions[vi++] = b[2];
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.computeBoundingBox();
  return geom;
}

/** 将 0xRRGGBB 转换为 [r, g, b] 归一化三元组。 */
function hexToRGB(hex: number): RGBTuple {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  ];
}

/** AABB 包围盒线框辅助器。 */
export class Box3Helper extends Mesh {
  override readonly type: string = 'Box3Helper';
  /** 被可视化的包围盒。 */
  box: Box3;
  /** 线框颜色 [r, g, b],0..1。 */
  color: RGBTuple;

  constructor(renderer: WebGL2Renderer, box: Box3, color: number = 0xffff00) {
    const geom = buildBox3Geometry(box);
    super(geom, { type: 'Basic', renderOrder: 1 } as unknown as Material);
    this.box = box;
    this.color = hexToRGB(color);
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getLineProgram(renderer.gl),
      uniforms: {
        u_color: this.color,
        u_alpha: 1,
      },
    };
  }
}
