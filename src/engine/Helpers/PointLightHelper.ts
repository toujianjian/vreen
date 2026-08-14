// PointLightHelper — 点光源可视化辅助器。
//
// 参考 three.js/src/helpers/PointLightHelper.js,适配 VREEN 自研引擎:
//   - 线框球体(经线 + 纬线若干段)代表光源位置
//   - 当 light.distance > 0 时,额外绘一个半径 = distance 的外环表示有效范围
//   - 顶点色线段 shader(a_color attribute), Helper 跟随 light.matrixWorld
//
// 与 three.js 版本差异:
//   - three.js 用 SphereGeometry(4 widthSegments × 2 heightSegments) wireframe Mesh;
//     VREEN 无 wireframe 渲染通路,改为显式生成经线 + 纬线线段几何,顶点数/段数
//     受控、旋转对称,且可携带 distance 外环(three.js 把 distance 环注释掉了)
//   - three.js 的 helper 跟随 light.matrixWorld(model 矩阵 = 光源世界矩阵);
//     VREEN 同样把几何置于以 light.position 为原点的**模型空间**,再令
//     this.matrix = light.matrixWorld 由渲染器搬到世界。update() 再刷 matrix
//
// 用法:
//   const helper = new PointLightHelper(renderer, pointLight, 1);
//   scene.add(helper);
//   pointLight.position.set(10, 10, 10); helper.update();

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import type { PointLight } from '../Lights/PointLight';
import type { RGBColor } from '../Lights/Light';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram } from './lineShaders';

/** 单条线段占用的顶点数 / float 数。 */
const SEG_VERTS = 2;
const FLOATS_PER_VERT = 3;

/**
 * 构造 PointLightHelper 的线框球 + (可选)distance 外环几何。
 *
 * 几何在**模型空间**构造(以光源位置为原点,球半径 = sphereSize),
 * Helper 的 model 矩阵在 update() 时设为 light.matrixWorld,由渲染器搬到世界。
 *
 * 经线(longitude):沿 X 轴旋转的一组竖向半圆,每条经线 = (segments) 段。
 * 纬线(latitude):垂直 Y 轴的若干水平圆环,每条纬线 = (rings) 段闭环。
 *
 * @param light       目标点光源(读 distance / color)
 * @param sphereSize  内层线框球的半径
 * @param color       可选覆盖色;不传则取 light.color
 * @param segments    经线分段数(沿每条经线的顶点对数)
 * @param rings       纬线条数(沿 Y 轴均匀分布)
 * @returns BufferGeometry,含 position + color
 */
export function buildPointLightHelperGeometry(
  light: PointLight,
  sphereSize: number,
  color?: RGBColor,
  segments: number = 8,
  rings: number = 3,
): BufferGeometry {
  const c = color ? color : light.color;
  const cr = c.r, cg = c.g, cb = c.b;
  const r = sphereSize > 0 ? sphereSize : 1;

  // 预估顶点数,后续用动态数组(两段一扩容)push:
  //   经线:(segments+1) 段 × 经线条数;这里用 4 条经线(每 π/2 一条)
  //   纬线:rings 条 × (segments+1) 段闭环 = rings × (segments+1) × 2 顶点
  //   外环:1 圆环 = (segments+1) 段闭环 → (segments+1) × 2 顶点
  const lonCount = 4;
  const latSegs = segments + 1;
  const verts =
    lonCount * segments * SEG_VERTS +   // 经线
    rings * latSegs * SEG_VERTS +        // 纬线
    (light.distance > 0 ? latSegs * SEG_VERTS : 0); // 外环
  const positions = new Float32Array(verts * FLOATS_PER_VERT);
  const colors = new Float32Array(verts * FLOATS_PER_VERT);
  let pi = 0;
  const push = (x: number, y: number, z: number): void => {
    positions[pi] = x; positions[pi + 1] = y; positions[pi + 2] = z;
    colors[pi] = cr; colors[pi + 1] = cg; colors[pi + 2] = cb;
    pi += 3;
  };

  // — 经线:每条经线为一个过 Y 轴的整圆,绕 Y 轴旋转 lonCount 次(相位 φ) —
  for (let lon = 0; lon < lonCount; lon++) {
    const phi = (lon / lonCount) * Math.PI * 2; // 绕 Y 轴相位
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    // 经线在 (cosP·r·cosθ, r·sinθ, sinP·r·cosθ) 平面,θ:0..2π
    for (let s = 0; s < segments; s++) {
      const t0 = (s / segments) * Math.PI * 2;
      const t1 = ((s + 1) / segments) * Math.PI * 2;
      push(cosP * r * Math.cos(t0), r * Math.sin(t0), sinP * r * Math.cos(t0));
      push(cosP * r * Math.cos(t1), r * Math.sin(t1), sinP * r * Math.cos(t1));
    }
  }

  // — 纬线:水平圆环(垂直 Y 轴),沿 Y 轴均匀分布在 (-r..r) 之间(避开极点) —
  for (let ring = 0; ring < rings; ring++) {
    // y 从 -r·cos(π/(rings+1)) 到 +,避开 0 处的重合极点
    const theta = ((ring + 1) / (rings + 1)) * Math.PI; // 0..π
    const y = r * Math.cos(theta);
    const rr = r * Math.sin(theta); // 该纬线半径
    for (let s = 0; s < latSegs; s++) {
      const t0 = (s / latSegs) * Math.PI * 2;
      const t1 = ((s + 1) / latSegs) * Math.PI * 2;
      push(rr * Math.cos(t0), y, rr * Math.sin(t0));
      push(rr * Math.cos(t1), y, rr * Math.sin(t1));
    }
  }

  // — 外环:半径 = light.distance,水平圆环(表现有效照明范围) —
  if (light.distance > 0) {
    const R = light.distance;
    for (let s = 0; s < latSegs; s++) {
      const t0 = (s / latSegs) * Math.PI * 2;
      const t1 = ((s + 1) / latSegs) * Math.PI * 2;
      push(R * Math.cos(t0), 0, R * Math.sin(t0));
      push(R * Math.cos(t1), 0, R * Math.sin(t1));
    }
  }

  // 截断到实际写入长度(预估可能略大)。
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions.slice(0, pi), 3));
  geom.setAttribute('color', new BufferAttribute(colors.slice(0, pi), 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/** 点光源可视化辅助器。线框球 + (distance>0 时)有效范围外环。 */
export class PointLightHelper extends Mesh {
  override readonly type: string = 'PointLightHelper';
  /** 被可视化的点光源。 */
  light: PointLight;
  /** 线框球半径。 */
  sphereSize: number;
  /** 可选覆盖色;不设置则取 light.color。 */
  color: RGBColor | undefined;

  constructor(
    renderer: WebGL2Renderer,
    light: PointLight,
    sphereSize: number = 1,
    color?: RGBColor,
  ) {
    const geom = buildPointLightHelperGeometry(light, sphereSize, color);
    super(geom, { type: 'Basic', renderOrder: 999 } as unknown as Material);
    this.light = light;
    this.sphereSize = sphereSize;
    this.color = color;
    // 几何在模型空间(光源为原点),model 矩阵 = 光源世界矩阵;不自动更新。
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
   * 把 helper 的 model 矩阵同步为光源的世界变换(球随光源移动),并刷新颜色。
   * 光源变换后调用。
   */
  update(): void {
    this.matrixWorldNeedsUpdate = true;
    this.light.updateWorldMatrix(true, false);
    this.matrix.copy(this.light.matrixWorld);
    // 颜色随 light.color(若未指定 override)。distance 变化需重建几何 → 重新设置属性。
    const geom = buildPointLightHelperGeometry(this.light, this.sphereSize, this.color);
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
