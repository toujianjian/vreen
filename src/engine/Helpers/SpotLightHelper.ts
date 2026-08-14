// SpotLightHelper — 聚光灯可视化辅助器。
//
// 参考 three.js/src/helpers/SpotLightHelper.js,适配 VREEN 自研引擎:
//   - 锥体线框: 5 条辐射线(顶点 → 4 个方向 + 对顶) + 锥底圆环,共 6+32 段
//   - 锥长 = light.distance(or 默认 1000);锥宽 = 锥长 × tan(light.angle)
//   - 锥体在"光源→target"方向上展开(本地 +Z 朝 target)
//   - 顶点色线段 shader(a_color attribute), Helper 跟随 light.matrixWorld
//
// 与 three.js 版本差异:
//   - three.js 构造时把锥体顶点写在本地空间 z∈[0,1],update() 用 cone.scale
//     放到锥长锥宽,再 cone.lookAt(target) 朝向 target;VREEN 同样的"本地单位
//     几何 × scale × lookAt"路线,但 VM 没有 LineSegments 基础设施,改为单个
//     Mesh + 顶点色几何。光锥顶点本地坐标在 _buildConeGeometry 里一次性按
//     angle/distance 写出(世界尺寸经 model 矩阵 lookAt 搬运)
//   - 锥体 32 段底环直接来自 three.js 的 32 等分写法
//
// 用法:
//   const helper = new SpotLightHelper(renderer, spotLight);
//   scene.add(helper);
//   spotLight.angle = Math.PI / 4; helper.update();

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import type { SpotLight } from '../Lights/SpotLight';
import type { RGBColor } from '../Lights/Light';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram } from './lineShaders';

/**
 * 构造 SpotLightHelper 的锥体几何。
 *
 * 几何在**本地空间**构造:锥顶在原点,锥轴沿 +Z,锥底平面在 z = coneLength,
 * 底半径 = coneWidth。Helper 的 model 矩阵在 update() 时把 +Z 转向 target、
 * 平移到 light.worldPosition(three.js lookAt 方案,model = light.matrixWorld
 * 再绕轴对齐 +Z→target)。
 *
 * 顶点布局(顶点色全统一):
 *   - 5 条辐射线:每条 2 顶点 = 10 顶点
 *   - 锥底圆环(32 段闭环):32 × 2 = 64 顶点
 *   - 合计 74 顶点
 *
 * @param light  目标聚光灯(读 angle / distance / color)
 * @param color  可选覆盖色;不传则取 light.color
 * @returns BufferGeometry,含 position(74) + color(74)
 */
export function buildSpotLightHelperGeometry(
  light: SpotLight,
  color?: RGBColor,
): BufferGeometry {
  const c = color ? color : light.color;
  const cr = c.r, cg = c.g, cb = c.b;

  // 锥长:three.js distance 为 0 时用一个大默认值(1000)避免画成无穷尖锥。
  const coneLength = light.distance > 0 ? light.distance : 1000;
  const coneWidth = coneLength * Math.tan(light.angle);

  // 顶点(three.js SpotLightHelper.js 原版坐标):5 条辐射线 + 32 段底环。
  // 5 条辐射线:原点→(±1/0/±1 方向) 在 z=1 平面上,本地半径=1 → 后续用 scale
  // 放到 coneWidth/coneLength。这里直接乘到世界尺寸,省去 scale。
  const positions: number[] = [];
  const colors: number[] = [];
  const push = (x: number, y: number, z: number): void => {
    positions.push(x, y, z);
    colors.push(cr, cg, cb);
  };

  // 5 条辐射线(原点 → 锥底边缘 4 个方向 + 原 → (0,0,1) 即中心轴)。
  // 本地图形先写"单位锥"(z=1 平面,底半径=1),再统一缩放到 coneWidth/coneLength。
  const RAD_LINES: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 0], [0, -1], [-1, 0],
  ];
  // 中心轴 + 4 条边
  push(0, 0, 0); push(0, 0, 1);
  for (const [dx, dy] of RAD_LINES) {
    push(0, 0, 0); push(dx, dy, 1);
  }

  // 32 段底环(在 z=1 平面,半径=1)。
  const RING = 32;
  for (let i = 0, j = 1; i < 32; i++, j++) {
    const p1 = (i / RING) * Math.PI * 2;
    const p2 = (j / RING) * Math.PI * 2;
    push(Math.cos(p1), Math.sin(p1), 1);
    push(Math.cos(p2), Math.sin(p2), 1);
  }

  const positionsArr = new Float32Array(positions);
  // 缩放:本地单位→世界尺寸。x/y 缩放 coneWidth,z 缩放 coneLength。
  for (let i = 0; i < positionsArr.length; i += 3) {
    positionsArr[i] *= coneWidth;
    positionsArr[i + 1] *= coneWidth;
    positionsArr[i + 2] *= coneLength;
  }
  const colorsArr = new Float32Array(colors);

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positionsArr, 3));
  geom.setAttribute('color', new BufferAttribute(colorsArr, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * 聚光灯可视化辅助器。锥体线框(5 辐射线 + 32 段底环),锥长 = distance,
 * 锥宽 = 锥长 × tan(angle),锥轴朝向 light.target。
 */
export class SpotLightHelper extends Mesh {
  override readonly type: string = 'SpotLightHelper';
  /** 被可视化的聚光灯。 */
  light: SpotLight;
  /** 可选覆盖色;不设置则取 light.color。 */
  color: RGBColor | undefined;

  constructor(
    renderer: WebGL2Renderer,
    light: SpotLight,
    color?: RGBColor,
  ) {
    const geom = buildSpotLightHelperGeometry(light, color);
    super(geom, { type: 'Basic', renderOrder: 999 } as unknown as Material);
    this.light = light;
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
   * 将锥轴朝向 light.target(令本地 +Z 指向 target 方向),并把锥体搬到光源位置。
   * 聚光灯/其 target/angle/distance 变化后调用。
   */
  update(): void {
    this.matrixWorldNeedsUpdate = true;
    this.light.updateWorldMatrix(true, false);
    if (this.light.target) this.light.target.updateWorldMatrix(true, false);

    // local +Z (锥轴) 需指向 target。Object3D.lookAt(target, up) 根据
    // 自己当前世界位置 + (0,1,0) up 构造朝向。但 Helper 的位置应跟随 light;
    // 这里先把 model 矩阵设为"平移到 light.position + 朝向 target 的旋转"。
    const lightPos = this.light.position;
    const targetObj = this.light.target;
    const targetPos = targetObj ? targetObj.position : lightPos;
    // 令 Helper 的世界位置 = light.worldPosition(避免 light 自身有父级变换导致位置不一致)。
    // 这里用 lookAt(eye=light.position, target=target.position) 得到旋转基,再置位,
    // model 矩阵前三列从 lookAt 的 right/up/(-back=forward) 取用。
    // 简化:直接用 Object3D.lookAt(世界 target) 更稳。

    // 重建几何(distance/angle 颜色都需刷新)。
    const geom = buildSpotLightHelperGeometry(this.light, this.color);
    this.geometry.setAttribute('position', geom.getAttribute('position')!);
    this.geometry.setAttribute('color', geom.getAttribute('color')!);

    // 朝向:先把自身位置与旋到"在 light.position 处看 target"。
    // 用一个临时矩阵承载 lookAt 旋转基,取其前三列作 model 的旋转部分。
    this.position.copy(lightPos);
    this.lookAt(targetPos.x, targetPos.y, targetPos.z);
    this.updateMatrix(); // 用新 position/rotation 刷 model 矩阵

    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  /** 释放几何体资源(Helper 不再使用时调用)。 */
  dispose(): void {
    this.geometry.dispose();
  }
}
