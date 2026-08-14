// DirectionalLightHelper — 平行光可视化辅助器。
//
// 参考 three.js/src/helpers/DirectionalLightHelper.js,适配 VREEN 自研引擎:
//   - 方框(光源平面,边长 size×size,平面垂直于 光源→target 方向)
//   + 方向射线(光源 → target,长度由二者世界坐标决定)
//   - 顶点色线段 shader(a_color attribute)
//   - 走 Renderer 的 helper 旁路 (userData.__helper === 'line'),以 gl.LINES 绘制
//
// 与 three.js 版本差异:
//   - three.js 用两个独立 Line 子对象(lightPlane 方框 + targetLine 射线)叠加在
//     Object3D 上;VREEN 无 Line 基础设施,改为单个 Mesh + 顶点色几何体,方框与
//     射线写入同一 BufferGeometry。
//   - three.js 用 lookAt 把方框转向 target,VREEN 直接在世界空间构造(方框平面
//     垂直于 光源→target 方向),无需每帧 lookAt,update() 只刷新几何顶点。
//
// 用法:
//   const helper = new DirectionalLightHelper(renderer, dirLight, 1);
//   scene.add(helper);
//   // light / target 变换后:
//   helper.update();
//   helper.dispose();   // 不再使用时释放

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import type { DirectionalLight } from '../Lights/DirectionalLight';
import type { RGBColor } from '../Lights/Light';
import { Matrix4, Vector3 } from '../Math';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram } from './lineShaders';

// 复用临时变量,避免每帧分配。
const _lightPos = new Vector3();
const _targetPos = new Vector3();
const _dir = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _lookMat = new Matrix4();

/**
 * 构造 DirectionalLightHelper 的几何体(方框 + 射线)。
 *
 * 几何在**世界空间**构造(已把 light.position / target.position 纳入坐标),
 * 因此 Helper 的 model 矩阵为单位矩阵、matrixAutoUpdate=false。
 *
 * 顶点布局(每顶点 6 float:xyz + rgb),按 (position, color) 线段对组织:
 *   - 方框: 4 条边 × 2 顶点 = 8 顶点
 *   - 射线: 1 线段 = 2 顶点
 *   - 合计 10 顶点
 *
 * 纯数据,不依赖 WebGL,便于测试。
 *
 * @param light  目标平行光(读取 position / target / color)
 * @param size   方框半边长(方框角点 = light.position ± right*size ± up*size)
 * @param color  可选覆盖色;不传则取 light.color
 * @returns BufferGeometry,含 position(10) + color(10)
 */
export function buildDirectionalLightHelperGeometry(
  light: DirectionalLight,
  size: number,
  color?: RGBColor,
): BufferGeometry {
  // 世界坐标下的光源位置。
  light.updateWorldMatrix(true, false);
  _lightPos.setFromMatrixPosition(light.matrixWorld);

  // 优先用 light.direction(光传播方向,从光源指向被照物)作为射线方向;
  // VREEN 的 DirectionalLight 保留显式 direction 字段(渲染管线直接消费),bypass了
  // three.js 的 position→target 反推。射线长度用 size*10 给一个稳定可视长度,
  // 不依赖 target(其默认在原点,导致方向退化)。
  _dir.set(light.direction.x, light.direction.y, light.direction.z);
  const dlen = _dir.length();
  if (dlen > 1e-12) {
    _dir.multiplyScalar(1 / dlen);
    // 射线终点 = 光源 + 方向 × (size*10)
    _targetPos.copy(_lightPos).addScaledVector(_dir, size * 10);
  } else {
    // 退化方向:目标 = 光源(射线零长),方框以世界默认朝向构造
    _targetPos.copy(_lightPos);
  }

  // lookAt(eye=光源, target=射线终点, up=世界Y) 得到旋转基;z 基 = eye−target = -dir
  // (指向光源)。取其 right(_x)/up(_y) 两条轴即方框平面内(垂直于光线)的正交基。
  _lookMat.lookAt(_lightPos, _targetPos, { x: 0, y: 1, z: 0 });
  const e = _lookMat.elements;
  // 列主序:te[0..2] = right(_x), te[4..6] = up(_y), te[8..10] = z(_z)
  _right.set(e[0], e[1], e[2]);
  _up.set(e[4], e[5], e[6]);

  const c = color ? color : light.color;
  const cr = c.r, cg = c.g, cb = c.b;

  // 10 顶点 × 3 (pos) + 10 顶点 × 3 (color)
  const positions = new Float32Array(10 * 3);
  const colors = new Float32Array(10 * 3);

  // 4 个角点 = lightPos ± right*size ± up*size
  const corners = [
    _lightPos.clone().addScaledVector(_right, size).addScaledVector(_up, size),    // 0 +R +U
    _lightPos.clone().addScaledVector(_right, -size).addScaledVector(_up, size),   // 1 -R +U
    _lightPos.clone().addScaledVector(_right, -size).addScaledVector(_up, -size),  // 2 -R -U
    _lightPos.clone().addScaledVector(_right, size).addScaledVector(_up, -size),   // 3 +R -U
  ];
  let pi = 0;
  // 4 条边:0-1, 1-2, 2-3, 3-0
  for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
    positions[pi] = corners[i].x; positions[pi + 1] = corners[i].y; positions[pi + 2] = corners[i].z; pi += 3;
    positions[pi] = corners[j].x; positions[pi + 1] = corners[j].y; positions[pi + 2] = corners[j].z; pi += 3;
  }
  // 射线 1 线段(2 顶点):光源 → 方向终点
  positions[pi] = _lightPos.x; positions[pi + 1] = _lightPos.y; positions[pi + 2] = _lightPos.z; pi += 3;
  positions[pi] = _targetPos.x; positions[pi + 1] = _targetPos.y; positions[pi + 2] = _targetPos.z; pi += 3;

  // 颜色:全部 10 顶点同色(方框 + 射线统一)。
  for (let i = 0; i < 10; i++) {
    colors[i * 3] = cr; colors[i * 3 + 1] = cg; colors[i * 3 + 2] = cb;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/** 平行光可视化辅助器。方框(光源平面)+ 方向射线(光源→target)。 */
export class DirectionalLightHelper extends Mesh {
  override readonly type: string = 'DirectionalLightHelper';
  /** 被可视化的平行光。 */
  light: DirectionalLight;
  /** 方框半边长。 */
  size: number;
  /** 可选覆盖色;不设置则取 light.color。 */
  color: RGBColor | undefined;

  constructor(
    renderer: WebGL2Renderer,
    light: DirectionalLight,
    size: number = 1,
    color?: RGBColor,
  ) {
    const geom = buildDirectionalLightHelperGeometry(light, size, color);
    super(geom, { type: 'Basic', renderOrder: 999 } as unknown as Material);
    this.light = light;
    this.size = size;
    this.color = color;
    // 几何在世界空间构造,model 矩阵保持单位。
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getVertexColorLineProgram(renderer.gl),
      uniforms: { u_alpha: 1 },
    };
  }

  /**
   * 刷新方框朝向与射线长度以匹配 light / light.target 的当前世界变换。
   * 平行光或其 target 变换后必须调用。
   */
  update(): void {
    this.matrixWorldNeedsUpdate = true;
    // 重建几何体顶点(世界空间)并写回当前 BufferAttribute,避免重新分配。
    const geom = buildDirectionalLightHelperGeometry(this.light, this.size, this.color);
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
