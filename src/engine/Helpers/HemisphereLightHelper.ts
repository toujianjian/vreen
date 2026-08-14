// HemisphereLightHelper — 半球光可视化辅助器。
//
// 参考 three.js/src/helpers/HemisphereLightHelper.js,适配 VREEN 自研引擎:
//   - 八面体线框上下两套颜色:上半 4 面=light.color(sky),下半 4 面=groundColor
//   - 八面体本地坐标系内以 Y 轴为上下轴(天空在 +Y)
//   - 线框随光源世界矩阵搬到场景(light.matrixWorld)
//
// 与 three.js 版本差异:
//   - three.js 用 wireframe OctahedronGeometry Mesh + 顶点色,顺带 lookAt 把
//     "天空方向"对准光源的三次曲面;VREEN 无 wireframe 渲染通路,改为显式生成
//     八面体 12 条边线段几何,上半 6 边用天空色、下半 6 边用地面色
//   - 颜色阈值取 Y 坐标符号划分(顶点 y>0 → 天空色, y<0 → 地面色, y≈0 → 取天空色)
//
// 用法:
//   const light = new HemisphereLight(0xffffbb, 0x080820, 1);
//   const helper = new HemisphereLightHelper(renderer, light, 5);
//   scene.add(helper);
//   light.color.set(0xffffff); light.groundColor.set(0x000033); helper.update();

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import type { HemisphereLight } from '../Lights/HemisphereLight';
import type { RGBColor } from '../Lights/Light';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram } from './lineShaders';

// 八面体 6 个顶点(本地空间, ±size 沿 three 轴)。
//  0: +X  1: -X  2: +Y (天顶)  3: -Y (地底)  4: +Z  5: -Z
// 12 条边:上半(含天顶)= 与 +Y(顶点2)相连或赤道上相邻;
//         下半(含地底)= 与 -Y(顶点3)相连 或 赤道上相邻。
// 这里按"上/下"显式边集划分颜色。
// 赤道环(4 个赤道顶点 0,1,4,5 相邻成环):既归上半也归下半,three.js 把它算进对应半。
// 顶点色按"边两端点 y 的 最大符号"归类(任一端在上半则该边算上半天空色)。
const OCTA_VERTS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],   // 0 +X
  [-1, 0, 0],  // 1 -X
  [0, 1, 0],   // 2 +Y (天顶)
  [0, -1, 0],  // 3 -Y (地底)
  [0, 0, 1],   // 4 +Z
  [0, 0, -1],  // 5 -Z
];
// 12 条边(端点索引对)。
const OCTA_EDGES: ReadonlyArray<readonly [number, number]> = [
  // 上半 8 边:天顶 2 连四个赤道 + 赤道环四边
  [2, 0], [2, 1], [2, 4], [2, 5],
  [0, 4], [4, 1], [1, 5], [5, 0],
  // 下半 4 边:地底 3 连四个赤道(赤道环已归上半,不重复画,否则重叠)
  [3, 0], [3, 1], [3, 4], [3, 5],
];

/**
 * 构造 HemisphereLightHelper 的八面体线框几何(12 边 × 2 顶点 = 24 顶点)。
 * 上半天空色、下半地面色。几何在**本地空间**(以光源位置为原点,±size)。
 * Helper 的 model 矩阵在 update() 时设为 light.matrixWorld。
 *
 * @param light  目标半球光(读 color / groundColor)
 * @param size   八面体半径(顶点到原点距离)
 * @param color  可选覆盖色;不传则上/下半分别取 light.color / light.groundColor
 * @returns BufferGeometry,含 position(24) + color(24)
 */
export function buildHemisphereLightHelperGeometry(
  light: HemisphereLight,
  size: number,
  color?: RGBColor,
): BufferGeometry {
  const r = size > 0 ? size : 1;
  // 没有 override 时,上/下半分别用 sky/ground;有 override 时全用 override。
  const sky = color ? color : light.color;
  const ground = color ? color : light.groundColor;

  const positions = new Float32Array(OCTA_EDGES.length * 2 * 3);
  const colors = new Float32Array(OCTA_EDGES.length * 2 * 3);
  let pi = 0;
  let ci = 0;
  for (let ei = 0; ei < OCTA_EDGES.length; ei++) {
    const [a, b] = OCTA_EDGES[ei];
    const va = OCTA_VERTS[a];
    const vb = OCTA_VERTS[b];
    // 任一端 y>0 取天空色,否则取地面色;赤道环两端 y=0 时取天空色(上覆盖下)。
    const isUpper = va[1] > 0 || vb[1] > 0;
    const col = isUpper ? sky : ground;
    positions[pi] = va[0] * r; positions[pi + 1] = va[1] * r; positions[pi + 2] = va[2] * r; pi += 3;
    colors[ci] = col.r; colors[ci + 1] = col.g; colors[ci + 2] = col.b; ci += 3;
    positions[pi] = vb[0] * r; positions[pi + 1] = vb[1] * r; positions[pi + 2] = vb[2] * r; pi += 3;
    colors[ci] = col.r; colors[ci + 1] = col.g; colors[ci + 2] = col.b; ci += 3;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/** 半球光可视化辅助器。八面体线框上半天空色 / 下半地面色。 */
export class HemisphereLightHelper extends Mesh {
  override readonly type: string = 'HemisphereLightHelper';
  /** 被可视化的半球光。 */
  light: HemisphereLight;
  /** 八面体半径。 */
  size: number;
  /** 可选覆盖色;不设置则上/下半分别取 light.color / light.groundColor。 */
  color: RGBColor | undefined;

  constructor(
    renderer: WebGL2Renderer,
    light: HemisphereLight,
    size: number = 1,
    color?: RGBColor,
  ) {
    const geom = buildHemisphereLightHelperGeometry(light, size, color);
    super(geom, { type: 'Basic', renderOrder: 999 } as unknown as Material);
    this.light = light;
    this.size = size;
    this.color = color;
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getVertexColorLineProgram(renderer.gl),
      uniforms: { u_alpha: 1 },
    };

    this.update();
  }

  /**
   * 把八面体搬到光源位置(model = light.matrixWorld)并刷新颜色。
   * 半球光 / 其 color / groundColor 变化后调用。
   */
  update(): void {
    this.matrixWorldNeedsUpdate = true;
    this.light.updateWorldMatrix(true, false);
    this.matrix.copy(this.light.matrixWorld);
    // 颜色或 groundColor 变化 → 重建几何属性。
    const geom = buildHemisphereLightHelperGeometry(this.light, this.size, this.color);
    this.geometry.setAttribute('position', geom.getAttribute('position')!);
    this.geometry.setAttribute('color', geom.getAttribute('color')!);
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  /** 释放几何体资源(Helper 不再使用时调用)。 */
  dispose(): void {
    this.geometry.dispose();
  }
}
