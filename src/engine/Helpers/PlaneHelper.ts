// PlaneHelper — 平面可视化辅助器,绘制平面上的网格 + 法线箭头。
// 参考: three.js/src/helpers/PlaneHelper.js,适配 VREEN 自研引擎:
//   - 平面方框边框(4 条边)+ 中心十字(2 条边)+ 法线线段(1 条)
//   - 单色线段 shader(u_color uniform)
//   - 平面由 normal + constant(Hessian 形式)定义
//
// 用法:
//   const helper = new PlaneHelper(renderer, new Plane(new Vector3(0,1,0), 0), 4);

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import { Plane, Vector3 } from '../Math';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getLineProgram, type RGBTuple } from './lineShaders';

// 复用临时向量,避免每帧分配。
const _normal = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _center = new Vector3();
const _ref = new Vector3();

/** 计算平面内两条正交单位轴 u、v(均与 normal 正交)。 */
function computeInPlaneAxes(normal: Vector3, u: Vector3, v: Vector3): void {
  // 选一个与 normal 不平行的参考向量。
  if (Math.abs(normal.y) < 0.9) {
    _ref.set(0, 1, 0);
  } else {
    _ref.set(1, 0, 0);
  }
  // u = ref × normal(与 normal 正交 → 落在平面内)
  u.copy(_ref).cross(normal);
  if (u.lengthSq() < 1e-12) {
    _ref.set(0, 0, 1);
    u.copy(_ref).cross(normal);
  }
  u.normalize();
  // v = normal × u(同样落在平面内,且与 u 正交)
  v.copy(normal).cross(u).normalize();
}

/**
 * 构造 PlaneHelper 的几何体(平面网格 + 法线)。
 * 纯数据,不依赖 WebGL,便于测试。
 * @param plane 目标平面(normal 应为单位长度)
 * @param size  网格边长 / 法线长度
 * @returns BufferGeometry,含 position(7 线段 × 2 = 14 顶点)
 */
export function buildPlaneHelperGeometry(plane: Plane, size: number = 1): BufferGeometry {
  _normal.copy(plane.normal);
  const nlen = _normal.length();
  if (nlen < 1e-12) {
    // 退化法线 → 输出空几何体。
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    return geom;
  }
  _normal.multiplyScalar(1 / nlen); // 归一化(避免入参非单位法线时尺寸偏差)

  computeInPlaneAxes(_normal, _u, _v);

  // 平面上离原点最近的点 p0 满足 n·p0 + c = 0 ⇒ p0 = -c·n / |n|²。
  // (constant 是相对原始 normal 的 Hessian 常量,因此用原始 |normal|² 缩放。)
  _center.copy(plane.normal).multiplyScalar(-plane.constant / (nlen * nlen));

  const half = size / 2;

  // 4 个边框角点:center ± u*half ± v*half
  const c0 = _center.clone().addScaledVector(_u, half).addScaledVector(_v, half);
  const c1 = _center.clone().addScaledVector(_u, -half).addScaledVector(_v, half);
  const c2 = _center.clone().addScaledVector(_u, -half).addScaledVector(_v, -half);
  const c3 = _center.clone().addScaledVector(_u, half).addScaledVector(_v, -half);

  // 7 条线段,每条 2 个顶点 = 14 顶点。
  const positions = new Float32Array(7 * 2 * 3);
  let vi = 0;
  const push = (a: Vector3, b: Vector3): void => {
    positions[vi++] = a.x; positions[vi++] = a.y; positions[vi++] = a.z;
    positions[vi++] = b.x; positions[vi++] = b.y; positions[vi++] = b.z;
  };
  // 边框
  push(c0, c1);
  push(c1, c2);
  push(c2, c3);
  push(c3, c0);
  // 中心十字
  push(_center.clone().addScaledVector(_u, -half), _center.clone().addScaledVector(_u, half));
  push(_center.clone().addScaledVector(_v, -half), _center.clone().addScaledVector(_v, half));
  // 法线
  push(_center, _center.clone().addScaledVector(_normal, size));

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

/** 平面可视化辅助器。绘制平面网格 + 法线箭头。 */
export class PlaneHelper extends Mesh {
  override readonly type: string = 'PlaneHelper';
  /** 被可视化的平面。 */
  plane: Plane;
  /** 网格 / 法线长度。 */
  size: number;
  /** 线段颜色 [r, g, b],0..1。 */
  color: RGBTuple;

  constructor(
    renderer: WebGL2Renderer,
    plane: Plane,
    size: number = 1,
    hex: number = 0xffff00,
  ) {
    const geom = buildPlaneHelperGeometry(plane, size);
    super(geom, { type: 'Basic', renderOrder: 1 } as unknown as Material);
    this.plane = plane;
    this.size = size;
    this.color = hexToRGB(hex);
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
