// PolarGridHelper — 极坐标网格辅助器。
// 参考: three.js/src/helpers/PolarGridHelper.js,适配 VREEN 自研引擎:
//   - rings 个同心圆(半径 i*radius/rings),每个圆用 divisions 段折线逼近
//   - sectors 条从圆心到外圆的径向线
//   - 圆周线用 color2,径向线用 color1(顶点色,与 GridHelper3D 一致)
//   - 走 helper 旁路 gl.LINES 绘制
//
// 用法:
//   const grid = new PolarGridHelper(renderer, 10, 16, 8, 64);

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram, type RGBTuple } from './lineShaders';

/** 默认颜色(等价 0x444444 / 0x888888 归一化到 0..1)。 */
const DEFAULT_COLOR1: RGBTuple = [0x44 / 255, 0x44 / 255, 0x44 / 255];
const DEFAULT_COLOR2: RGBTuple = [0x88 / 255, 0x88 / 255, 0x88 / 255];

/** 将 0xRRGGBB 整数转换为 [r, g, b] 归一化三元组。 */
function hexToRGB(hex: number): RGBTuple {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  ];
}

/**
 * 构造极坐标网格的几何体(顶点色)。纯数据,不依赖 WebGL,便于测试。
 * @param radius   外圆半径
 * @param sectors  径向线条数
 * @param rings    同心圆数量
 * @param divisions 每个圆的折线段数
 * @param color1   径向线颜色 [r, g, b]
 * @param color2   圆周线颜色 [r, g, b]
 * @returns BufferGeometry,含 position + color
 */
export function buildPolarGridGeometry(
  radius: number = 10,
  sectors: number = 16,
  rings: number = 8,
  divisions: number = 64,
  color1: RGBTuple = DEFAULT_COLOR1,
  color2: RGBTuple = DEFAULT_COLOR2,
): BufferGeometry {
  // 顶点数 = 同心圆(rings * divisions * 2) + 径向线(sectors * 2)
  const vertexCount = rings * divisions * 2 + sectors * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  let vi = 0; // 顶点写入索引
  const writeVertex = (x: number, z: number, c: RGBTuple): void => {
    positions[vi * 3] = x;
    positions[vi * 3 + 1] = 0;
    positions[vi * 3 + 2] = z;
    colors[vi * 3] = c[0];
    colors[vi * 3 + 1] = c[1];
    colors[vi * 3 + 2] = c[2];
    vi++;
  };

  // ── 同心圆:每个圆由 divisions 段折线组成 ────────────────────
  for (let r = 1; r <= rings; r++) {
    const radius_r = (r * radius) / rings;
    for (let j = 0; j < divisions; j++) {
      const a1 = (j / divisions) * Math.PI * 2;
      const a2 = ((j + 1) / divisions) * Math.PI * 2;
      writeVertex(Math.cos(a1) * radius_r, Math.sin(a1) * radius_r, color2);
      writeVertex(Math.cos(a2) * radius_r, Math.sin(a2) * radius_r, color2);
    }
  }

  // ── 径向线:从圆心到外圆 ─────────────────────────────────────
  for (let s = 0; s < sectors; s++) {
    const a = (s / sectors) * Math.PI * 2;
    writeVertex(0, 0, color1);
    writeVertex(Math.cos(a) * radius, Math.sin(a) * radius, color1);
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeBoundingBox();
  return geom;
}

/** 极坐标网格辅助器。 */
export class PolarGridHelper extends Mesh {
  override readonly type: string = 'PolarGridHelper';
  readonly radius: number;
  readonly sectors: number;
  readonly rings: number;
  readonly divisions: number;

  constructor(
    renderer: WebGL2Renderer,
    radius: number = 10,
    sectors: number = 16,
    rings: number = 8,
    divisions: number = 64,
    color1: number = 0x444444,
    color2: number = 0x888888,
  ) {
    const geom = buildPolarGridGeometry(
      radius,
      sectors,
      rings,
      divisions,
      hexToRGB(color1),
      hexToRGB(color2),
    );
    super(geom, { type: 'Basic', renderOrder: 0 } as unknown as Material);
    this.radius = radius;
    this.sectors = sectors;
    this.rings = rings;
    this.divisions = divisions;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getVertexColorLineProgram(renderer.gl),
      uniforms: {
        u_alpha: 1,
      },
    };
  }
}
