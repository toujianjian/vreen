// SkeletonHelper — 骨骼可视化辅助器。
//
// 参考 three.js/src/helpers/SkeletonHelper.js,适配 VREEN 自研引擎:
//   - 遍历传入 Object3D(常为 SkinnedMesh 或 Bone 根)的子树,收集所有 isBone 节点
//   - 每对"bone → 其父 bone"画一条线段(骨连杆)
//   - 颜色按骨在列表中的顺序从 color1(根骨)线性渐变到 color2(末骨)
//   - 顶点色线段 shader(a_color),默认两色为蓝→绿(three.js 约定)
//   - updateMatrixWorld(force) 时把每根骨的世界位置(相对 root.matrixWorld 的逆
//     变换后落回本地坐标)刷新进 position 属性 → 骨动则线段实时跟随
//
// 与 three.js 版本差异:
//   - three.js 继承 LineSegments;VREEN 无 LineSegments 基础设施,改为单个 Mesh
//     + 顶点色几何(2 顶点/线段,走 __helper='line' 旁路以 gl.LINES 绘制)
//   - 颜色由 setColors(color1, color2) 重写;VREEN 接受 VREEN Color 或 RGBColor
//
// 用法:
//   const helper = new SkeletonHelper(renderer, skinnedMesh);
//   scene.add(helper);
//   skinnedMesh.skeleton.update(); helper.updateMatrixWorld();

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Object3D } from '../Core/Object3D';
import type { Material } from '../Core/Material';
import type { RGBColor } from '../Lights/Light';
import { Matrix4, Vector3 } from '../Math';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram } from './lineShaders';

// 复用临时变量,避免每帧分配。
const _vector = new Vector3();
const _boneMatrix = new Matrix4();
const _matrixWorldInv = new Matrix4();

/** 递归收集节点子树里所有 isBone 的节点(深度优先,保持场景树顺序)。 */
export function collectBones(root: Object3D): Object3D[] {
  const list: Object3D[] = [];
  const visit = (node: Object3D): void => {
    if ((node as unknown as { isBone?: boolean }).isBone === true) {
      list.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return list;
}

/**
 * 构造 SkeletonHelper 初始几何 + 颜色。
 *
 * - 几何:对所有"有父 bone 的 bone",写一对零顶点占位(position 在
 *   updateMatrixWorld 时再按骨世界位置回填)。
 * - 颜色:第 2i / 2i+1 顶点(第 i 条线段的两端)分别由 color1→color2 线性
 *   插值得到,两端的插值系数相同(同一条段两端同色,使段内一色;不同段不同色
 *   形成整体渐变)。
 *
 * @param root    要可视化的对象(通常 SkinnedMesh 或 Bone 根)
 * @param color1  根骨端颜色(可选,默认 0x0000ff 蓝)
 * @param color2  末骨端颜色(可选,默认 0x00ff00 绿)
 * @returns BufferGeometry,含 position + color(顶点数随骨连杆对数)
 */
export function buildSkeletonHelperGeometry(
  root: Object3D,
  color1?: RGBColor,
  color2?: RGBColor,
): { geometry: BufferGeometry; bones: Object3D[] } {
  const bones = collectBones(root);

  // 统计"有父 bone 的骨"数量(每根一根连杆线)。
  let segCount = 0;
  for (const bone of bones) {
    if (bone.parent && (bone.parent as unknown as { isBone?: boolean }).isBone === true) {
      segCount++;
    }
  }
  const vertCount = segCount * 2;
  const positions = new Float32Array(vertCount * 3); // 初始全 0,updateMatrixWorld 回填
  const colors = new Float32Array(vertCount * 3);

  // 颜色渐变:color1 → color2,按段索引线性插值;段两端同色。
  const c1 = color1 ?? { r: 0, g: 0, b: 1 }; // 默认蓝
  const c2 = color2 ?? { r: 0, g: 1, b: 0 }; // 默认绿
  let i = 0;
  let ci = 0;
  for (let bi = 0; bi < bones.length; bi++) {
    const bone = bones[bi];
    if (bone.parent && (bone.parent as unknown as { isBone?: boolean }).isBone === true) {
      const t = segCount > 1 ? i / (segCount - 1) : 0;
      const r = c1.r + (c2.r - c1.r) * t;
      const g = c1.g + (c2.g - c1.g) * t;
      const b = c1.b + (c2.b - c1.b) * t;
      // 两端同色。
      colors[ci] = r; colors[ci + 1] = g; colors[ci + 2] = b;
      colors[ci + 3] = r; colors[ci + 4] = g; colors[ci + 5] = b;
      ci += 6;
      i++;
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return { geometry: geom, bones };
}

/** 骨骼可视化辅助器。每对 bone→ 父 bone 画一条线,蓝→绿渐变,跟随骨运动。 */
export class SkeletonHelper extends Mesh {
  override readonly type: string = 'SkeletonHelper';
  /** 被可视化的对象(通常 SkinnedMesh 或 Bone 根)。 */
  root: Object3D;
  /** 收集到的骨列表(按深度优先顺序)。 */
  bones: Object3D[];
  /** 渐变起点色。 */
  color1: RGBColor;
  /** 渐变终点色。 */
  color2: RGBColor;

  constructor(
    renderer: WebGL2Renderer,
    root: Object3D,
    color1?: RGBColor,
    color2?: RGBColor,
  ) {
    const { geometry, bones } = buildSkeletonHelperGeometry(root, color1, color2);
    super(geometry, { type: 'Basic', renderOrder: 999 } as unknown as Material);
    this.root = root;
    this.bones = bones;
    this.color1 = color1 ?? { r: 0, g: 0, b: 1 };
    this.color2 = color2 ?? { r: 0, g: 1, b: 0 };
    // 骨位置以 root.matrixWorld 为参照;helper 自身不参与场景图变换。
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getVertexColorLineProgram(renderer.gl),
      uniforms: { u_alpha: 1 },
    };

    // 立即刷一次顶点位置。
    this.updateMatrixWorld(true);
  }

  /**
   * 复写 updateMatrixWorld:先把每根骨的世界位置回填到 position 属性
   * (相对 root.matrixWorld 的局部坐标),再调用基类逻辑。
   *
   * 调用方在骨骼更新后调用 `helper.updateMatrixWorld(true)` 即可让线段跟随骨动。
   */
  override updateMatrixWorld(force: boolean): void {
    const posAttribute = this.geometry.getAttribute('position');
    if (!posAttribute) {
      super.updateMatrixWorld(force);
      return;
    }
    const posArr = posAttribute.array as Float32Array;

    // root 的逆世界矩阵,把骨世界位置映射回"以 root 为局部原点"的坐标。
    this.root.updateWorldMatrix(true, false);
    _matrixWorldInv.copy(this.root.matrixWorld).invert();

    let wIdx = 0; // 写指针(顶点序)
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i];
      if (bone.parent && (bone.parent as unknown as { isBone?: boolean }).isBone === true) {
        // bone 端
        _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld);
        _vector.setFromMatrixPosition(_boneMatrix);
        posArr[wIdx] = _vector.x; posArr[wIdx + 1] = _vector.y; posArr[wIdx + 2] = _vector.z;
        // parent 端
        _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.parent.matrixWorld);
        _vector.setFromMatrixPosition(_boneMatrix);
        posArr[wIdx + 3] = _vector.x; posArr[wIdx + 4] = _vector.y; posArr[wIdx + 5] = _vector.z;
        wIdx += 6;
      }
    }
    posAttribute.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    super.updateMatrixWorld(force);
  }

  /** 重设渐变两色。 */
  setColors(color1: RGBColor, color2: RGBColor): this {
    this.color1 = color1;
    this.color2 = color2;
    // 重建颜色属性。
    const { geometry } = buildSkeletonHelperGeometry(this.root, color1, color2);
    this.geometry.setAttribute('color', geometry.getAttribute('color')!);
    return this;
  }

  /** 释放几何体资源(Helper 不再使用时调用)。 */
  dispose(): void {
    this.geometry.dispose();
  }
}
