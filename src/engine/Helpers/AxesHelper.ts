// AxesHelper — 坐标轴辅助器,可视化世界坐标系的 X / Y / Z 三轴。
//
// 参考 three.js AxesHelper.js,适配 VREEN 自研引擎:
//   - X 轴红色, Y 轴绿色, Z 轴蓝色
//   - 每轴从原点延伸到 size 长度
//   - 使用顶点色线段 shader (a_color attribute),通过 helper 旁路绘制
//
// 用法:
//   const axes = new AxesHelper(renderer, 2);
//   scene.add(axes);

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram, type RGBTuple } from './lineShaders';

/** 构造 AxesHelper 的几何体(纯数据,不依赖 WebGL,便于测试)。
 *  @param size 轴线长度
 *  @returns BufferGeometry,含 position(6 顶点) + color(6 顶点) */
export function buildAxesGeometry(size: number = 1): BufferGeometry {
  const vertices = new Float32Array([
    0, 0, 0,  size, 0, 0,  // X 轴
    0, 0, 0,  0, size, 0,  // Y 轴
    0, 0, 0,  0, 0, size,  // Z 轴
  ]);

  // X 红 / Y 绿 / Z 蓝;每轴两端同色
  const colors = new Float32Array([
    1, 0, 0,  1, 0.6, 0,  // X
    0, 1, 0,  0.6, 1, 0,  // Y
    0, 0, 1,  0, 0.6, 1,  // Z
  ]);

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(vertices, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeBoundingBox();
  return geom;
}

/** 坐标轴辅助器。X 红 / Y 绿 / Z 蓝,每轴长度为 size。 */
export class AxesHelper extends Mesh {
  override readonly type: string = 'AxesHelper';
  /** 轴线长度。 */
  readonly size: number;

  constructor(renderer: WebGL2Renderer, size: number = 1) {
    const geom = buildAxesGeometry(size);
    super(geom, { type: 'Basic', renderOrder: 1 } as unknown as Material);
    this.size = size;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getVertexColorLineProgram(renderer.gl),
      uniforms: {
        u_alpha: 1,
      },
    };
  }

  /** 修改三轴颜色。每个参数为 [r, g, b],范围 0..1。 */
  setColors(xColor: RGBTuple, yColor: RGBTuple, zColor: RGBTuple): this {
    const colorAttr = this.geometry.getAttribute('color');
    if (!colorAttr) return this;
    const arr = colorAttr.array;
    // X 轴 (index 0, 1)
    arr[0] = xColor[0]; arr[1] = xColor[1]; arr[2] = xColor[2];
    arr[3] = xColor[0]; arr[4] = xColor[1]; arr[5] = xColor[2];
    // Y 轴 (index 2, 3)
    arr[6] = yColor[0]; arr[7] = yColor[1]; arr[8] = yColor[2];
    arr[9] = yColor[0]; arr[10] = yColor[1]; arr[11] = yColor[2];
    // Z 轴 (index 4, 5)
    arr[12] = zColor[0]; arr[13] = zColor[1]; arr[14] = zColor[2];
    arr[15] = zColor[0]; arr[16] = zColor[1]; arr[17] = zColor[2];
    colorAttr.needsUpdate = true;
    return this;
  }
}
