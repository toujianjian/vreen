// BoxHelper — 包围盒线框辅助器,显示 Object3D 子树的世界轴对齐包围盒。
//
// 参考 three.js BoxHelper.js,适配 VREEN 自研引擎:
//   - 12 条边构成立方体线框(24 个索引, 8 个顶点)
//   - 调用 update() 时遍历 object 子树,计算 AABB 并刷新顶点
//   - 使用单色线段 shader,通过 helper 旁路绘制
//
// 用法:
//   const box = new BoxHelper(renderer, mesh, [1, 1, 0]);
//   scene.add(box);
//   // object 变换后:
//   box.update();

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Object3D } from '../Core/Object3D';
import type { Material } from '../Core/Material';
import { Box3, Matrix4, Vector3 } from '../Math';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getLineProgram, type RGBTuple } from './lineShaders';

// 12 条边的索引(0-1, 1-2, 2-3, 3-0, 4-5, 5-6, 6-7, 7-4, 0-4, 1-5, 2-6, 3-7)
const BOX_INDICES = new Uint16Array([
  0, 1,  1, 2,  2, 3,  3, 0,  // 上面
  4, 5,  5, 6,  6, 7,  7, 4,  // 下面
  0, 4,  1, 5,  2, 6,  3, 7,  // 立柱
]);

// 复用临时变量,避免每帧分配
const _box = new Box3();
const _invMatrix = new Matrix4();
const _corner = new Vector3();

/** 构造 BoxHelper 的几何体(8 顶点 + 24 索引,初始位置全 0,update() 后填充)。
 *  纯数据,不依赖 WebGL,便于测试。 */
export function buildBoxGeometry(): BufferGeometry {
  const positions = new Float32Array(8 * 3); // 8 顶点,初始全 0
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setIndex(BOX_INDICES);
  return geom;
}

/** 遍历 object 子树,收集所有 Mesh 的 geometry AABB,合并为世界空间 AABB。
 *  VREEN 的 Box3 没有 setFromObject,这里手动实现(等价于 three.js 版本)。 */
function computeObjectBoundingBox(object: Object3D, target: Box3): Box3 {
  target.makeEmpty();
  object.updateMatrixWorld(true);
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!(mesh instanceof Mesh)) return;
    if (!mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return;
    // 把 8 个角点变换到世界空间后并入 target
    _invMatrix.copy(mesh.matrixWorld);
    const min = bb.min;
    const max = bb.max;
    const corners: Array<[number, number, number]> = [
      [min.x, min.y, min.z], [min.x, min.y, max.z],
      [min.x, max.y, min.z], [min.x, max.y, max.z],
      [max.x, min.y, min.z], [max.x, min.y, max.z],
      [max.x, max.y, min.z], [max.x, max.y, max.z],
    ];
    for (const [cx, cy, cz] of corners) {
      _corner.set(cx, cy, cz).applyMatrix4(_invMatrix);
      target.expandByPoint(_corner);
    }
  });
  return target;
}

/** 包围盒线框辅助器。 */
export class BoxHelper extends Mesh {
  override readonly type: string = 'BoxHelper';
  /** 被追踪的物体。 */
  object: Object3D | null;
  /** 线框颜色 [r, g, b],0..1。 */
  color: RGBTuple;

  constructor(renderer: WebGL2Renderer, object: Object3D | null = null, color: RGBTuple = [1, 1, 0]) {
    const geom = buildBoxGeometry();
    super(geom, { type: 'Basic', renderOrder: 1 } as unknown as Material);
    this.object = object;
    this.color = color;
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getLineProgram(renderer.gl),
      uniforms: {
        u_color: color,
        u_alpha: 1,
      },
    };

    if (object) this.update();
  }

  /** 刷新线框顶点以匹配 object 的当前世界空间 AABB。 */
  update(): void {
    if (!this.object) return;
    computeObjectBoundingBox(this.object, _box);
    if (_box.isEmpty()) return;

    const min = _box.min;
    const max = _box.max;
    const posAttr = this.geometry.getAttribute('position');
    if (!posAttr) return;
    const a = posAttr.array;

    /*
      5____4
    1/___0/|
    | 6__|_7
    2/___3/

    0: max.x, max.y, max.z
    1: min.x, max.y, max.z
    2: min.x, min.y, max.z
    3: max.x, min.y, max.z
    4: max.x, max.y, min.z
    5: min.x, max.y, min.z
    6: min.x, min.y, min.z
    7: max.x, min.y, min.z
    */
    a[0] = max.x; a[1] = max.y; a[2] = max.z;
    a[3] = min.x; a[4] = max.y; a[5] = max.z;
    a[6] = min.x; a[7] = min.y; a[8] = max.z;
    a[9] = max.x; a[10] = min.y; a[11] = max.z;
    a[12] = max.x; a[13] = max.y; a[14] = min.z;
    a[15] = min.x; a[16] = max.y; a[17] = min.z;
    a[18] = min.x; a[19] = min.y; a[20] = min.z;
    a[21] = max.x; a[22] = min.y; a[23] = min.z;
    posAttr.needsUpdate = true;

    this.geometry.computeBoundingSphere();
  }

  /** 切换追踪的物体并立即刷新。 */
  setFromObject(object: Object3D): this {
    this.object = object;
    this.update();
    return this;
  }

  /** 修改线框颜色。 */
  setColor(color: RGBTuple): this {
    this.color = color;
    const uniforms = this.userData as { uniforms?: { u_color?: RGBTuple } };
    if (uniforms.uniforms) uniforms.uniforms.u_color = color;
    return this;
  }
}
