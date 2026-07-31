// TeapotGeometry — 犹他茶壶几何体,从 three.js TeapotGeometry 移植并适配 VREEN 引擎。
// 由 32 个双三次贝塞尔面片 (bicubic Bézier patch) 构成经典的 Utah Teapot。
// 每个面片在 (segments+1)×(segments+1) 网格上求值,单元四边形拆成 2 个三角形。
// 退化三角形 (顶点重合) 在顶端/底端尖点处被剔除。
// 参考: three.js/examples/jsm/geometries/TeapotGeometry.js (源自 OpenGL 茶壶,公开领域)
//
// 求值采用直接 Bernstein 多项式 (等价于 three.js 的 M·G·M^T 矩阵法):
//   Surface(s,t) = Σ_r Σ_c B_r(s) · B_c(t) · P[r][c]
//   其中 P[r][c] = teapotVertices[teapotPatches[surf*16 + r*4 + c]]
// 法线由切向叉积 dS/dt × dS/ds 给出,经坐标变换后输出。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 茶壶构造选项。 */
export interface TeapotGeometryOptions {
  /** 茶壶整体缩放 (默认 50)。茶壶被缩放至垂直方向大致占 [-size, size]。 */
  size?: number;
  /** 每个面片边的分段数 (默认 10),越大越平滑。最小 2。 */
  segments?: number;
  /** 若为 true,包含底面 (默认 false)。 */
  bottom?: boolean;
  /** 若为 true,包含壶盖 (默认 true)。 */
  lid?: boolean;
  /** 若为 true,包含主体 (含 rim,默认 true)。 */
  body?: boolean;
  /** 若为 true,包含壶嘴 (默认 true)。 */
  spout?: boolean;
  /** 若为 true,包含壶把 (默认 true)。 */
  handle?: boolean;
}

// 32 个面片,每个 16 个控制点索引 (4×4 网格,行优先:r*4+c)。
// 分组: rim(0-3) body(4-11) handle(12-15) spout(16-19) lid(20-27) bottom(28-31)
const teapotPatches = [
  // rim
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  3, 16, 17, 18, 7, 19, 20, 21, 11, 22, 23, 24, 15, 25, 26, 27,
  18, 28, 29, 30, 21, 31, 32, 33, 24, 34, 35, 36, 27, 37, 38, 39,
  30, 40, 41, 0, 33, 42, 43, 4, 36, 44, 45, 8, 39, 46, 47, 12,
  // body
  12, 13, 14, 15, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
  15, 25, 26, 27, 51, 60, 61, 62, 55, 63, 64, 65, 59, 66, 67, 68,
  27, 37, 38, 39, 62, 69, 70, 71, 65, 72, 73, 74, 68, 75, 76, 77,
  39, 46, 47, 12, 71, 78, 79, 48, 74, 80, 81, 52, 77, 82, 83, 56,
  56, 57, 58, 59, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95,
  59, 66, 67, 68, 87, 96, 97, 98, 91, 99, 100, 101, 95, 102, 103, 104,
  68, 75, 76, 77, 98, 105, 106, 107, 101, 108, 109, 110, 104, 111, 112, 113,
  77, 82, 83, 56, 107, 114, 115, 84, 110, 116, 117, 88, 113, 118, 119, 92,
  // handle
  120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135,
  123, 136, 137, 120, 127, 138, 139, 124, 131, 140, 141, 128, 135, 142, 143, 132,
  132, 133, 134, 135, 144, 145, 146, 147, 148, 149, 150, 151, 68, 152, 153, 154,
  135, 142, 143, 132, 147, 155, 156, 144, 151, 157, 158, 148, 154, 159, 160, 68,
  // spout
  161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176,
  164, 177, 178, 161, 168, 179, 180, 165, 172, 181, 182, 169, 176, 183, 184, 173,
  173, 174, 175, 176, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196,
  176, 183, 184, 173, 188, 197, 198, 185, 192, 199, 200, 189, 196, 201, 202, 193,
  // lid
  203, 203, 203, 203, 204, 205, 206, 207, 208, 208, 208, 208, 209, 210, 211, 212,
  203, 203, 203, 203, 207, 213, 214, 215, 208, 208, 208, 208, 212, 216, 217, 218,
  203, 203, 203, 203, 215, 219, 220, 221, 208, 208, 208, 208, 218, 222, 223, 224,
  203, 203, 203, 203, 221, 225, 226, 204, 208, 208, 208, 208, 224, 227, 228, 209,
  209, 210, 211, 212, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240,
  212, 216, 217, 218, 232, 241, 242, 243, 236, 244, 245, 246, 240, 247, 248, 249,
  218, 222, 223, 224, 243, 250, 251, 252, 246, 253, 254, 255, 249, 256, 257, 258,
  224, 227, 228, 209, 252, 259, 260, 229, 255, 261, 262, 233, 258, 263, 264, 237,
  // bottom
  265, 265, 265, 265, 266, 267, 268, 269, 270, 271, 272, 273, 92, 119, 118, 113,
  265, 265, 265, 265, 269, 274, 275, 276, 273, 277, 278, 279, 113, 112, 111, 104,
  265, 265, 265, 265, 276, 280, 281, 282, 279, 283, 284, 285, 104, 103, 102, 95,
  265, 265, 265, 265, 282, 286, 287, 266, 285, 288, 289, 270, 95, 94, 93, 92,
];

// 326 个控制点 (x, y, z),公开领域 (源自 OpenGL 茶壶 / Martin Newell 原始数据)。
const teapotVertices = [
  1.4, 0, 2.4,
  1.4, -0.784, 2.4,
  0.784, -1.4, 2.4,
  0, -1.4, 2.4,
  1.3375, 0, 2.53125,
  1.3375, -0.749, 2.53125,
  0.749, -1.3375, 2.53125,
  0, -1.3375, 2.53125,
  1.4375, 0, 2.53125,
  1.4375, -0.805, 2.53125,
  0.805, -1.4375, 2.53125,
  0, -1.4375, 2.53125,
  1.5, 0, 2.4,
  1.5, -0.84, 2.4,
  0.84, -1.5, 2.4,
  0, -1.5, 2.4,
  -0.784, -1.4, 2.4,
  -1.4, -0.784, 2.4,
  -1.4, 0, 2.4,
  -0.749, -1.3375, 2.53125,
  -1.3375, -0.749, 2.53125,
  -1.3375, 0, 2.53125,
  -0.805, -1.4375, 2.53125,
  -1.4375, -0.805, 2.53125,
  -1.4375, 0, 2.53125,
  -0.84, -1.5, 2.4,
  -1.5, -0.84, 2.4,
  -1.5, 0, 2.4,
  -1.4, 0.784, 2.4,
  -0.784, 1.4, 2.4,
  0, 1.4, 2.4,
  -1.3375, 0.749, 2.53125,
  -0.749, 1.3375, 2.53125,
  0, 1.3375, 2.53125,
  -1.4375, 0.805, 2.53125,
  -0.805, 1.4375, 2.53125,
  0, 1.4375, 2.53125,
  -1.5, 0.84, 2.4,
  -0.84, 1.5, 2.4,
  0, 1.5, 2.4,
  0.784, 1.4, 2.4,
  1.4, 0.784, 2.4,
  0.749, 1.3375, 2.53125,
  1.3375, 0.749, 2.53125,
  0.805, 1.4375, 2.53125,
  1.4375, 0.805, 2.53125,
  0.84, 1.5, 2.4,
  1.5, 0.84, 2.4,
  1.75, 0, 1.875,
  1.75, -0.98, 1.875,
  0.98, -1.75, 1.875,
  0, -1.75, 1.875,
  2, 0, 1.35,
  2, -1.12, 1.35,
  1.12, -2, 1.35,
  0, -2, 1.35,
  2, 0, 0.9,
  2, -1.12, 0.9,
  1.12, -2, 0.9,
  0, -2, 0.9,
  -0.98, -1.75, 1.875,
  -1.75, -0.98, 1.875,
  -1.75, 0, 1.875,
  -1.12, -2, 1.35,
  -2, -1.12, 1.35,
  -2, 0, 1.35,
  -1.12, -2, 0.9,
  -2, -1.12, 0.9,
  -2, 0, 0.9,
  -1.75, 0.98, 1.875,
  -0.98, 1.75, 1.875,
  0, 1.75, 1.875,
  -2, 1.12, 1.35,
  -1.12, 2, 1.35,
  0, 2, 1.35,
  -2, 1.12, 0.9,
  -1.12, 2, 0.9,
  0, 2, 0.9,
  0.98, 1.75, 1.875,
  1.75, 0.98, 1.875,
  1.12, 2, 1.35,
  2, 1.12, 1.35,
  1.12, 2, 0.9,
  2, 1.12, 0.9,
  2, 0, 0.45,
  2, -1.12, 0.45,
  1.12, -2, 0.45,
  0, -2, 0.45,
  1.5, 0, 0.225,
  1.5, -0.84, 0.225,
  0.84, -1.5, 0.225,
  0, -1.5, 0.225,
  1.5, 0, 0.15,
  1.5, -0.84, 0.15,
  0.84, -1.5, 0.15,
  0, -1.5, 0.15,
  -1.12, -2, 0.45,
  -2, -1.12, 0.45,
  -2, 0, 0.45,
  -0.84, -1.5, 0.225,
  -1.5, -0.84, 0.225,
  -1.5, 0, 0.225,
  -0.84, -1.5, 0.15,
  -1.5, -0.84, 0.15,
  -1.5, 0, 0.15,
  -2, 1.12, 0.45,
  -1.12, 2, 0.45,
  0, 2, 0.45,
  -1.5, 0.84, 0.225,
  -0.84, 1.5, 0.225,
  0, 1.5, 0.225,
  -1.5, 0.84, 0.15,
  -0.84, 1.5, 0.15,
  0, 1.5, 0.15,
  1.12, 2, 0.45,
  2, 1.12, 0.45,
  0.84, 1.5, 0.225,
  1.5, 0.84, 0.225,
  0.84, 1.5, 0.15,
  1.5, 0.84, 0.15,
  -1.6, 0, 2.025,
  -1.6, -0.3, 2.025,
  -1.5, -0.3, 2.25,
  -1.5, 0, 2.25,
  -2.3, 0, 2.025,
  -2.3, -0.3, 2.025,
  -2.5, -0.3, 2.25,
  -2.5, 0, 2.25,
  -2.7, 0, 2.025,
  -2.7, -0.3, 2.025,
  -3, -0.3, 2.25,
  -3, 0, 2.25,
  -2.7, 0, 1.8,
  -2.7, -0.3, 1.8,
  -3, -0.3, 1.8,
  -3, 0, 1.8,
  -1.5, 0.3, 2.25,
  -1.6, 0.3, 2.025,
  -2.5, 0.3, 2.25,
  -2.3, 0.3, 2.025,
  -3, 0.3, 2.25,
  -2.7, 0.3, 2.025,
  -3, 0.3, 1.8,
  -2.7, 0.3, 1.8,
  -2.7, 0, 1.575,
  -2.7, -0.3, 1.575,
  -3, -0.3, 1.35,
  -3, 0, 1.35,
  -2.5, 0, 1.125,
  -2.5, -0.3, 1.125,
  -2.65, -0.3, 0.9375,
  -2.65, 0, 0.9375,
  -2, -0.3, 0.9,
  -1.9, -0.3, 0.6,
  -1.9, 0, 0.6,
  -3, 0.3, 1.35,
  -2.7, 0.3, 1.575,
  -2.65, 0.3, 0.9375,
  -2.5, 0.3, 1.125,
  -1.9, 0.3, 0.6,
  -2, 0.3, 0.9,
  1.7, 0, 1.425,
  1.7, -0.66, 1.425,
  1.7, -0.66, 0.6,
  1.7, 0, 0.6,
  2.6, 0, 1.425,
  2.6, -0.66, 1.425,
  3.1, -0.66, 0.825,
  3.1, 0, 0.825,
  2.3, 0, 2.1,
  2.3, -0.25, 2.1,
  2.4, -0.25, 2.025,
  2.4, 0, 2.025,
  2.7, 0, 2.4,
  2.7, -0.25, 2.4,
  3.3, -0.25, 2.4,
  3.3, 0, 2.4,
  1.7, 0.66, 0.6,
  1.7, 0.66, 1.425,
  3.1, 0.66, 0.825,
  2.6, 0.66, 1.425,
  2.4, 0.25, 2.025,
  2.3, 0.25, 2.1,
  3.3, 0.25, 2.4,
  2.7, 0.25, 2.4,
  2.8, 0, 2.475,
  2.8, -0.25, 2.475,
  3.525, -0.25, 2.49375,
  3.525, 0, 2.49375,
  2.9, 0, 2.475,
  2.9, -0.15, 2.475,
  3.45, -0.15, 2.5125,
  3.45, 0, 2.5125,
  2.8, 0, 2.4,
  2.8, -0.15, 2.4,
  3.2, -0.15, 2.4,
  3.2, 0, 2.4,
  3.525, 0.25, 2.49375,
  2.8, 0.25, 2.475,
  3.45, 0.15, 2.5125,
  2.9, 0.15, 2.475,
  3.2, 0.15, 2.4,
  2.8, 0.15, 2.4,
  0, 0, 3.15,
  0.8, 0, 3.15,
  0.8, -0.45, 3.15,
  0.45, -0.8, 3.15,
  0, -0.8, 3.15,
  0, 0, 2.85,
  0.2, 0, 2.7,
  0.2, -0.112, 2.7,
  0.112, -0.2, 2.7,
  0, -0.2, 2.7,
  -0.45, -0.8, 3.15,
  -0.8, -0.45, 3.15,
  -0.8, 0, 3.15,
  -0.112, -0.2, 2.7,
  -0.2, -0.112, 2.7,
  -0.2, 0, 2.7,
  -0.8, 0.45, 3.15,
  -0.45, 0.8, 3.15,
  0, 0.8, 3.15,
  -0.2, 0.112, 2.7,
  -0.112, 0.2, 2.7,
  0, 0.2, 2.7,
  0.45, 0.8, 3.15,
  0.8, 0.45, 3.15,
  0.112, 0.2, 2.7,
  0.2, 0.112, 2.7,
  0.4, 0, 2.55,
  0.4, -0.224, 2.55,
  0.224, -0.4, 2.55,
  0, -0.4, 2.55,
  1.3, 0, 2.55,
  1.3, -0.728, 2.55,
  0.728, -1.3, 2.55,
  0, -1.3, 2.55,
  1.3, 0, 2.4,
  1.3, -0.728, 2.4,
  0.728, -1.3, 2.4,
  0, -1.3, 2.4,
  -0.224, -0.4, 2.55,
  -0.4, -0.224, 2.55,
  -0.4, 0, 2.55,
  -0.728, -1.3, 2.55,
  -1.3, -0.728, 2.55,
  -1.3, 0, 2.55,
  -0.728, -1.3, 2.4,
  -1.3, -0.728, 2.4,
  -1.3, 0, 2.4,
  -0.4, 0.224, 2.55,
  -0.224, 0.4, 2.55,
  0, 0.4, 2.55,
  -1.3, 0.728, 2.55,
  -0.728, 1.3, 2.55,
  0, 1.3, 2.55,
  -1.3, 0.728, 2.4,
  -0.728, 1.3, 2.4,
  0, 1.3, 2.4,
  0.224, 0.4, 2.55,
  0.4, 0.224, 2.55,
  0.728, 1.3, 2.55,
  1.3, 0.728, 2.55,
  0.728, 1.3, 2.4,
  1.3, 0.728, 2.4,
  0, 0, 0,
  1.425, 0, 0,
  1.425, 0.798, 0,
  0.798, 1.425, 0,
  0, 1.425, 0,
  1.5, 0, 0.075,
  1.5, 0.84, 0.075,
  0.84, 1.5, 0.075,
  0, 1.5, 0.075,
  -0.798, 1.425, 0,
  -1.425, 0.798, 0,
  -1.425, 0, 0,
  -0.84, 1.5, 0.075,
  -1.5, 0.84, 0.075,
  -1.5, 0, 0.075,
  -1.425, -0.798, 0,
  -0.798, -1.425, 0,
  0, -1.425, 0,
  -1.5, -0.84, 0.075,
  -0.84, -1.5, 0.075,
  0, -1.5, 0.075,
  0.798, -1.425, 0,
  1.425, -0.798, 0,
  0.84, -1.5, 0.075,
  1.5, -0.84, 0.075,
];

// Bernstein 多项式基函数 (三次): B_i(t)
function bernstein(i: number, t: number): number {
  const u = 1 - t;
  switch (i) {
    case 0: return u * u * u;
    case 1: return 3 * t * u * u;
    case 2: return 3 * t * t * u;
    case 3: return t * t * t;
    default: return 0;
  }
}

// Bernstein 基函数的导数: B_i'(t)
function bernsteinDerivative(i: number, t: number): number {
  const u = 1 - t;
  switch (i) {
    case 0: return -3 * u * u;
    case 1: return 3 * u * (1 - 3 * t);
    case 2: return 3 * t * (2 - 3 * t);
    case 3: return 3 * t * t;
    default: return 0;
  }
}

/**
 * 犹他茶壶几何体。由 32 个双三次贝塞尔面片构成的经典 3D 测试模型。
 * 每个面片被细分为 segments×segments 个四边形 (每四边形 2 个三角形),
 * 退化三角形 (顶点重合) 在尖点处被剔除。
 *
 * 采用直接 Bernstein 多项式求值,等价于 three.js 的矩阵法但无 Matrix4 依赖。
 */
export class TeapotGeometry extends BufferGeometry {
  readonly size: number;
  readonly segments: number;

  constructor(options: TeapotGeometryOptions = {}) {
    super();
    this.size = options.size ?? 50;
    this.segments = Math.max(2, Math.floor(options.segments ?? 10));
    this.build(options);
  }

  private build(options: TeapotGeometryOptions): void {
    const segments = this.segments;
    const size = this.size;

    const body = options.body ?? true;
    const lid = options.lid ?? true;
    const spout = options.spout ?? true;
    const handle = options.handle ?? true;
    const bottom = options.bottom ?? false;
    // fitLid: 把壶盖 XY 拉伸 1.077 以遮挡壶身与盖之间的缝隙 (three.js 默认 true)。
    const fitLid = true;
    // blinn=true: 使用 Jim Blinn 缩放后的比例 (现代标准茶壶)。trueSize 基于 maxHeight=3.15。
    const maxHeight = 3.15;
    const maxHeight2 = maxHeight / 2;
    const trueSize = size / maxHeight2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const vertPerRow = segments + 1;
    let surfCount = 0;

    for (let surf = 0; surf < 32; surf++) {
      // 按面片分组过滤
      let include: boolean;
      if (surf < 12) include = body;          // rim (0-3) + body (4-11)
      else if (surf < 16) include = handle;   // handle (12-15)
      else if (surf < 20) include = spout;    // spout (16-19)
      else if (surf < 28) include = lid;      // lid (20-27)
      else include = bottom;                   // bottom (28-31)
      if (!include) continue;

      // 在 (segments+1)×(segments+1) 网格上求值面片
      for (let sstep = 0; sstep <= segments; sstep++) {
        const s = sstep / segments;
        const Bs = [bernstein(0, s), bernstein(1, s), bernstein(2, s), bernstein(3, s)];
        const dBs = [
          bernsteinDerivative(0, s),
          bernsteinDerivative(1, s),
          bernsteinDerivative(2, s),
          bernsteinDerivative(3, s),
        ];

        for (let tstep = 0; tstep <= segments; tstep++) {
          const t = tstep / segments;
          const Bt = [bernstein(0, t), bernstein(1, t), bernstein(2, t), bernstein(3, t)];
          const dBt = [
            bernsteinDerivative(0, t),
            bernsteinDerivative(1, t),
            bernsteinDerivative(2, t),
            bernsteinDerivative(3, t),
          ];

          let px = 0, py = 0, pz = 0;
          let dsx = 0, dsy = 0, dsz = 0;
          let dtx = 0, dty = 0, dtz = 0;

          for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
              const vi = teapotPatches[surf * 16 + r * 4 + c];
              let vx = teapotVertices[vi * 3 + 0];
              let vy = teapotVertices[vi * 3 + 1];
              let vz = teapotVertices[vi * 3 + 2];

              // fitLid: 壶盖面片的 XY 放大 1.077 (Z 不变以保持垂直范围)
              if (fitLid && surf >= 20 && surf < 28) {
                vx *= 1.077;
                vy *= 1.077;
              }

              const bs = Bs[r];
              const bt = Bt[c];
              const w = bs * bt;
              px += vx * w;
              py += vy * w;
              pz += vz * w;

              const dbs = dBs[r];
              const dbt = dBt[c];
              dsx += vx * dbs * bt;
              dsy += vy * dbs * bt;
              dsz += vz * dbs * bt;
              dtx += vx * bs * dbt;
              dty += vy * bs * dbt;
              dtz += vz * bs * dbt;
            }
          }

          // 法线 = dS/dt × dS/ds (与 three.js crossVectors(vtdir, vsdir) 一致)
          const nx = dty * dsz - dtz * dsy;
          const ny = dtz * dsx - dtx * dsz;
          const nz = dtx * dsy - dty * dsx;
          const nlen = Math.hypot(nx, ny, nz) || 1;

          // 坐标变换: 原始 (x,y,z) → 输出 (x, z-shifted, -y),使 Y 朝上
          positions.push(trueSize * px, trueSize * (pz - maxHeight2), -trueSize * py);

          // 法线变换 + 尖点处理: X 与 Y (原始) 均为 0 时,法线指向 +Y 或 -Y
          let onx: number, ony: number, onz: number;
          if (px === 0 && py === 0) {
            onx = 0;
            ony = pz > maxHeight2 ? 1 : -1;
            onz = 0;
          } else {
            onx = nx / nlen;
            ony = nz / nlen;
            onz = -ny / nlen;
          }
          normals.push(onx, ony, onz);

          uvs.push(1 - t, 1 - s);
        }
      }

      // 生成三角形索引
      for (let sstep = 0; sstep < segments; sstep++) {
        for (let tstep = 0; tstep < segments; tstep++) {
          const v1 = surfCount * vertPerRow * vertPerRow + sstep * vertPerRow + tstep;
          const v2 = v1 + 1;
          const v3 = v2 + vertPerRow;
          const v4 = v1 + vertPerRow;

          if (notDegenerate(positions, v1, v2, v3)) {
            indices.push(v1, v2, v3);
          }
          if (notDegenerate(positions, v1, v3, v4)) {
            indices.push(v1, v3, v4);
          }
        }
      }

      surfCount++;
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingSphere();
  }
}

/** 退化三角形检测:任意两个顶点位置完全相同则视为退化。 */
function notDegenerate(positions: number[], a: number, b: number, c: number): boolean {
  const o = (i: number) => i * 3;
  const ax = positions[o(a)], ay = positions[o(a) + 1], az = positions[o(a) + 2];
  const bx = positions[o(b)], by = positions[o(b) + 1], bz = positions[o(b) + 2];
  const cx = positions[o(c)], cy = positions[o(c) + 1], cz = positions[o(c) + 2];
  const ab = ax === bx && ay === by && az === bz;
  const ac = ax === cx && ay === cy && az === cz;
  const bc = bx === cx && by === cy && bz === cz;
  return !(ab || ac || bc);
}
