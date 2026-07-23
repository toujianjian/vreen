// ArrowHelper — 箭头辅助器,用于可视化 3D 方向向量。
//
// 参考 three.js ArrowHelper.js,适配 VREEN 自研引擎:
//   - 由 5 条线段组成:1 条杆身 + 4 条箭头棱线(从尖端到头部底面四角)
//   - three.js 用 Cone mesh 做头部;VREEN 改为线段(无需走标准渲染管线,
//     整个箭头复用 helper 旁路 LINES 绘制,简洁高效)
//   - 使用单色线段 shader
//
// 用法:
//   const arrow = new ArrowHelper(renderer, dir, origin, length, color);
//   scene.add(arrow);
//   arrow.setDirection(newDir);

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import { Vector3 } from '../Math';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getLineProgram, type RGBTuple } from './lineShaders';

// 5 条线段 = 10 顶点
const ARROW_VERTEX_COUNT = 10;

// 复用临时向量
const _dir = new Vector3();
const _up = new Vector3();
const _perp1 = new Vector3();
const _perp2 = new Vector3();
const _tip = new Vector3();
const _base = new Vector3();
const _corner = new Vector3();

/** 计算两个与 dir 正交的单位向量(perp1, perp2)。
 *  内部使用,无 WebGL 依赖。 */
function computePerpendiculars(dir: Vector3, perp1: Vector3, perp2: Vector3): void {
  // 选一个与 dir 不平行的参考向量
  if (Math.abs(dir.y) < 0.99) {
    _up.set(0, 1, 0);
  } else {
    _up.set(1, 0, 0);
  }
  // perp1 = dir × up,归一化
  perp1.copy(dir).cross(_up).normalize();
  // perp2 = dir × perp1,归一化
  perp2.copy(dir).cross(perp1).normalize();
}

/** 构造 ArrowHelper 的几何体(10 顶点,初始位置全 0)。
 *  纯数据,不依赖 WebGL,便于测试。
 *  调用 fillArrowVertices() 可填充实际顶点。 */
export function buildArrowGeometry(): BufferGeometry {
  const positions = new Float32Array(ARROW_VERTEX_COUNT * 3);
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.computeBoundingBox();
  return geom;
}

/** 根据方向 / 原点 / 长度参数填充箭头顶点数据。
 *  @param positions  Float32Array,长度 >= 30 (10 顶点 × 3)
 *  @param dir        归一化方向向量(会被复制,不修改入参)
 *  @param origin     箭头起点
 *  @param length     箭头总长度
 *  @param headLength 头部长度
 *  @param headWidth  头部宽度 */
export function fillArrowVertices(
  positions: Float32Array,
  dir: Vector3,
  origin: Vector3,
  length: number,
  headLength: number,
  headWidth: number,
): void {
  _dir.copy(dir).normalize();

  // 尖端 = origin + dir * length
  _tip.copy(origin).addScaledVector(_dir, length);
  // 头部底面中心 = origin + dir * (length - headLength)
  _base.copy(origin).addScaledVector(_dir, Math.max(0.0001, length - headLength));

  // 两个正交向量
  computePerpendiculars(_dir, _perp1, _perp2);

  const hw = headWidth * 0.5;

  // Line 0: 杆身 origin → base
  positions[0] = origin.x; positions[1] = origin.y; positions[2] = origin.z;
  positions[3] = _base.x;  positions[4] = _base.y;  positions[5] = _base.z;

  // Line 1-4: 尖端 → 头部底面四角
  // 角 1: base + perp1 * hw
  _corner.copy(_base).addScaledVector(_perp1, hw);
  positions[6] = _tip.x;   positions[7] = _tip.y;   positions[8] = _tip.z;
  positions[9] = _corner.x; positions[10] = _corner.y; positions[11] = _corner.z;

  // 角 2: base + perp2 * hw
  _corner.copy(_base).addScaledVector(_perp2, hw);
  positions[12] = _tip.x;   positions[13] = _tip.y;   positions[14] = _tip.z;
  positions[15] = _corner.x; positions[16] = _corner.y; positions[17] = _corner.z;

  // 角 3: base - perp1 * hw
  _corner.copy(_base).addScaledVector(_perp1, -hw);
  positions[18] = _tip.x;   positions[19] = _tip.y;   positions[20] = _tip.z;
  positions[21] = _corner.x; positions[22] = _corner.y; positions[23] = _corner.z;

  // 角 4: base - perp2 * hw
  _corner.copy(_base).addScaledVector(_perp2, -hw);
  positions[24] = _tip.x;   positions[25] = _tip.y;   positions[26] = _tip.z;
  positions[27] = _corner.x; positions[28] = _corner.y; positions[29] = _corner.z;
}

/** 箭头辅助器。5 条线段(1 杆身 + 4 箭头棱线)。 */
export class ArrowHelper extends Mesh {
  override readonly type: string = 'ArrowHelper';

  /** 方向(归一化)。 */
  dir: Vector3;
  /** 起点。 */
  origin: Vector3;
  /** 总长度。 */
  length: number;
  /** 头部长度。 */
  headLength: number;
  /** 头部宽度。 */
  headWidth: number;
  /** 颜色 [r, g, b],0..1。 */
  color: RGBTuple;

  constructor(
    renderer: WebGL2Renderer,
    dir: Vector3 = new Vector3(0, 0, 1),
    origin: Vector3 = new Vector3(0, 0, 0),
    length: number = 1,
    color: RGBTuple = [1, 1, 0],
    headLength?: number,
    headWidth?: number,
  ) {
    const geom = buildArrowGeometry();
    super(geom, { type: 'Basic', renderOrder: 1 } as unknown as Material);
    this.dir = dir.clone().normalize();
    this.origin = origin.clone();
    this.length = length;
    this.headLength = headLength ?? length * 0.2;
    this.headWidth = headWidth ?? this.headLength * 0.2;
    this.color = color;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getLineProgram(renderer.gl),
      uniforms: {
        u_color: color,
        u_alpha: 1,
      },
    };

    this._rebuild();
  }

  /** 重新计算所有顶点位置(内部调用)。 */
  private _rebuild(): void {
    const posAttr = this.geometry.getAttribute('position');
    if (!posAttr) return;
    fillArrowVertices(
      posAttr.array as Float32Array,
      this.dir,
      this.origin,
      this.length,
      this.headLength,
      this.headWidth,
    );
    posAttr.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  /** 设置方向(dir 会被归一化)。 */
  setDirection(dir: Vector3): this {
    this.dir.copy(dir).normalize();
    this._rebuild();
    return this;
  }

  /** 设置箭头尺寸。 */
  setLength(length: number, headLength?: number, headWidth?: number): this {
    this.length = length;
    this.headLength = headLength ?? length * 0.2;
    this.headWidth = headWidth ?? this.headLength * 0.2;
    this._rebuild();
    return this;
  }

  /** 设置起点。 */
  setOrigin(origin: Vector3): this {
    this.origin.copy(origin);
    this._rebuild();
    return this;
  }

  /** 设置颜色。 */
  setColor(color: RGBTuple): this {
    this.color = color;
    const uniforms = this.userData as { uniforms?: { u_color?: RGBTuple } };
    if (uniforms.uniforms) uniforms.uniforms.u_color = color;
    return this;
  }
}
