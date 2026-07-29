// DebugRenderer — 统一调试绘制管理器。
//
// 设计目标:
//   - 集中管理所有调试用线段 / 点 / 文字的「绘制请求 + 生命周期」
//   - 与 PhysicsDebugRenderer 互补:PhysicsDebugRenderer 专门读 ECS 物理
//     状态自动绘制 collider/contact/velocity;DebugRenderer 提供 API 让
//     调用方按需绘制任意几何(AABB / 球 / 射线 / 法线 / 视锥 / ...)
//   - 每个绘制调用可选 duration 参数:正数 = 显示 N 秒后自动移除;
//     0 或省略 = 单帧(下一帧 update 后移除);负数 = 永久(直到 clear)
//
// 渲染数据通过 getMeshData() 取出,由调用方灌入 LineMesh / 点 sprite /
// Text atlas 上传到 GPU。这样 DebugRenderer 本身不依赖 WebGL,可在
// Node 测试环境纯逻辑运行。
//
// 数据结构:
//   - lines: DebugLine[] (每段 2 端点 + 颜色 + 剩余时长)
//   - points: DebugPoint[] (位置 + 颜色 + 大小 + 剩余时长)
//   - text: DebugText[] (位置 + 字符串 + 颜色 + 剩余时长)
//
// 帧流程:
//   1. 调用方在帧内任意时刻调 drawXxx(...) 加入绘制请求
//   2. 渲染前调 getMeshData() 拉取本帧应绘制的顶点数据
//   3. 帧末调 update(dt) 推进 duration,移除过期元素

import { Vector3 } from '../Math/Vector3';
import { Vector4 } from '../Math/Vector4';
import type { Box3 } from '../Math/Box3';
import type { Sphere } from '../Math/Sphere';
import type { Frustum } from '../Math/Frustum';
import type { BufferGeometry } from '../Core/BufferGeometry';
import { clamp } from '../Math/MathUtils';

/** RGB 颜色,各分量 [0,1]。 */
export type DebugColor = [number, number, number];

/** 一条调试线段。 */
export interface DebugLine {
  /** 起点 xyz。 */
  from: Vector3;
  /** 终点 xyz。 */
  to: Vector3;
  /** RGB。 */
  color: DebugColor;
  /** 剩余显示时长(秒)。<=0 表示已过期。NaN/Infinity 表示永久。 */
  remaining: number;
}

/** 一个调试点。 */
export interface DebugPoint {
  /** 点位置。 */
  position: Vector3;
  /** RGB。 */
  color: DebugColor;
  /** 像素大小(屏幕空间)。 */
  size: number;
  /** 剩余显示时长(秒)。 */
  remaining: number;
}

/** 一段调试文字。 */
export interface DebugText {
  /** 文字锚点(世界空间)。 */
  position: Vector3;
  /** 文字内容。 */
  text: string;
  /** RGB。 */
  color: DebugColor;
  /** 剩余显示时长(秒)。 */
  remaining: number;
}

/** 渲染数据快照——调用方据此上传到 GPU。 */
export interface DebugRenderData {
  /** 线段顶点:每段 2 顶点 × 3 (xyz) = 6 floats,紧跟着 6 floats 颜色(rgb rgb)。 */
  lineVertices: Float32Array;
  /** lineVertices 中有效 float 数(6 的倍数表示段数 = N/6)。 */
  lineVertexCount: number;
  /** 线段颜色(与 lineVertices 对齐,每段 6 floats)。 */
  lineColors: Float32Array;
  /** 点位置 xyz。 */
  pointVertices: Float32Array;
  /** pointVertices 有效 float 数(3 的倍数)。 */
  pointVertexCount: number;
  /** 点颜色(每点 3 floats)。 */
  pointColors: Float32Array;
  /** 点大小(每点 1 float)。 */
  pointSizes: Float32Array;
}

/** 统计信息。 */
export interface DebugRendererStats {
  lineCount: number;
  pointCount: number;
  textCount: number;
  /** 自创建以来累计的 draw 调用次数。 */
  totalDrawCalls: number;
  /** 当前 enabled 状态。 */
  enabled: boolean;
}

/** 默认显示时长:0 = 单帧。 */
const DEFAULT_DURATION = 0;

/** 永久显示标记。 */
const FOREVER = Number.POSITIVE_INFINITY;

/** 临时 Vector3 池,避免每次 draw 分配。 */
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _v5 = new Vector3();
const _v6 = new Vector3();
const _v7 = new Vector3();

/**
 * DebugRenderer — 统一调试绘制管理器。
 *
 * 不依赖 WebGL,所有绘制请求暂存为数据,通过 getMeshData() 拉取后由调用方
 * 渲染。这样可在 Node 测试环境纯逻辑运行,也方便多后端(Three.js / 自研
 * WebGL2 引擎)共享同一份调试数据。
 */
export class DebugRenderer {
  /** 所有未过期的线段。 */
  lines: DebugLine[] = [];
  /** 所有未过期的点。 */
  points: DebugPoint[] = [];
  /** 所有未过期的文字。 */
  text: DebugText[] = [];

  /** 总开关:false 时所有 draw 调用静默忽略,getMeshData 返回空数据。 */
  enabled: boolean = true;

  /** 默认显示时长(秒)。0 = 单帧;Infinity = 永久。 */
  duration: number = DEFAULT_DURATION;

  /** 自创建以来累计的 draw 调用次数(统计用)。 */
  private _totalDrawCalls: number = 0;

  /** 内部渲染缓冲(避免每帧分配)。 */
  private _lineVertsBuf: Float32Array = new Float32Array(256 * 6);
  private _lineColorsBuf: Float32Array = new Float32Array(256 * 6);
  private _pointVertsBuf: Float32Array = new Float32Array(256 * 3);
  private _pointColorsBuf: Float32Array = new Float32Array(256 * 3);
  private _pointSizesBuf: Float32Array = new Float32Array(256);

  /**
   * 绘制线段。
   * @param from    起点
   * @param to      终点
   * @param color   RGB [0,1],默认青色
   * @param duration 显示时长(秒);省略 = this.duration;负数 = 永久
   */
  drawLine(
    from: Vector3,
    to: Vector3,
    color: DebugColor = [0, 1, 1],
    duration?: number,
  ): void {
    if (!this.enabled) return;
    this._totalDrawCalls++;
    const remaining = this._resolveDuration(duration);
    this.lines.push({
      from: from.clone(),
      to: to.clone(),
      color,
      remaining,
    });
  }

  /**
   * 绘制射线。
   * @param origin    起点
   * @param direction 方向(不必归一化,内部会归一化)
   * @param color     RGB
   * @param distance  射线长度
   * @param duration  显示时长
   */
  drawRay(
    origin: Vector3,
    direction: Vector3,
    color: DebugColor = [1, 1, 0],
    distance: number = 1,
    duration?: number,
  ): void {
    if (!this.enabled) return;
    _v1.copy(direction).normalize();
    _v2.copy(origin).addScaledVector(_v1, distance);
    this.drawLine(origin, _v2, color, duration);
  }

  /**
   * 绘制 AABB 包围盒(12 条边)。
   * @param box     Box3
   * @param color   RGB
   * @param duration 显示时长
   */
  drawBox(
    box: Box3,
    color: DebugColor = [0, 1, 0.5],
    duration?: number,
  ): void {
    if (!this.enabled) return;
    if (box.isEmpty()) return;
    const min = box.min;
    const max = box.max;
    // 8 个角点
    const x0 = min.x, y0 = min.y, z0 = min.z;
    const x1 = max.x, y1 = max.y, z1 = max.z;
    // 12 条边,用 12 次 drawLine(便于统一 duration 管理)
    // 底面 4 边
    _v1.set(x0, y0, z0); _v2.set(x1, y0, z0); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x1, y0, z0); _v2.set(x1, y0, z1); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x1, y0, z1); _v2.set(x0, y0, z1); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x0, y0, z1); _v2.set(x0, y0, z0); this.drawLine(_v1, _v2, color, duration);
    // 顶面 4 边
    _v1.set(x0, y1, z0); _v2.set(x1, y1, z0); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x1, y1, z0); _v2.set(x1, y1, z1); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x1, y1, z1); _v2.set(x0, y1, z1); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x0, y1, z1); _v2.set(x0, y1, z0); this.drawLine(_v1, _v2, color, duration);
    // 立柱 4 边
    _v1.set(x0, y0, z0); _v2.set(x0, y1, z0); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x1, y0, z0); _v2.set(x1, y1, z0); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x1, y0, z1); _v2.set(x1, y1, z1); this.drawLine(_v1, _v2, color, duration);
    _v1.set(x0, y0, z1); _v2.set(x0, y1, z1); this.drawLine(_v1, _v2, color, duration);
  }

  /**
   * 绘制球体(3 个正交圆环近似,共 3 × segments 段)。
   * @param sphere   Sphere
   * @param color    RGB
   * @param duration 显示时长
   * @param segments 每圆环段数(默认 16)
   */
  drawSphere(
    sphere: Sphere,
    color: DebugColor = [0.3, 0.8, 1],
    duration?: number,
    segments: number = 16,
  ): void {
    if (!this.enabled) return;
    if (sphere.isEmpty()) return;
    const cx = sphere.center.x;
    const cy = sphere.center.y;
    const cz = sphere.center.z;
    const r = sphere.radius;
    const steps = Math.max(4, segments | 0);
    // xy / xz / yz 三个平面圆环
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * Math.PI * 2;
      const a1 = ((i + 1) / steps) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      // xy 平面
      _v1.set(cx + r * c0, cy + r * s0, cz);
      _v2.set(cx + r * c1, cy + r * s1, cz);
      this.drawLine(_v1, _v2, color, duration);
      // xz 平面
      _v3.set(cx + r * c0, cy, cz + r * s0);
      _v4.set(cx + r * c1, cy, cz + r * s1);
      this.drawLine(_v3, _v4, color, duration);
      // yz 平面
      _v5.set(cx, cy + r * c0, cz + r * s0);
      _v6.set(cx, cy + r * c1, cz + r * s1);
      this.drawLine(_v5, _v6, color, duration);
    }
  }

  /**
   * 绘制圆(在以 normal 为法线的平面内)。
   * @param center   圆心
   * @param radius   半径
   * @param normal   平面法线(无需归一化)
   * @param color    RGB
   * @param duration 显示时长
   * @param segments 段数(默认 32)
   */
  drawCircle(
    center: Vector3,
    radius: number,
    normal: Vector3,
    color: DebugColor = [1, 0.5, 0.3],
    duration?: number,
    segments: number = 32,
  ): void {
    if (!this.enabled) return;
    if (radius <= 0) return;
    // 求与 normal 正交的两个单位向量
    _v1.copy(normal).normalize();
    // 选一个与 _v1 不平行的参考向量
    if (Math.abs(_v1.y) < 0.99) {
      _v2.set(0, 1, 0);
    } else {
      _v2.set(1, 0, 0);
    }
    // u = v2 × v1,再归一化
    _v3.copy(_v2).cross(_v1).normalize();
    // w = v1 × u
    _v4.copy(_v1).cross(_v3).normalize();
    const steps = Math.max(8, segments | 0);
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * Math.PI * 2;
      const a1 = ((i + 1) / steps) * Math.PI * 2;
      _v5.copy(center)
        .addScaledVector(_v3, radius * Math.cos(a0))
        .addScaledVector(_v4, radius * Math.sin(a0));
      _v6.copy(center)
        .addScaledVector(_v3, radius * Math.cos(a1))
        .addScaledVector(_v4, radius * Math.sin(a1));
      this.drawLine(_v5, _v6, color, duration);
    }
  }

  /**
   * 绘制箭头(杆身 + 4 棱头部,共 5 段)。
   * @param origin   起点
   * @param direction 方向(不必归一化)
   * @param color    RGB
   * @param length   箭头总长度
   * @param duration 显示时长
   */
  drawArrow(
    origin: Vector3,
    direction: Vector3,
    color: DebugColor = [1, 1, 0],
    length: number = 1,
    duration?: number,
  ): void {
    if (!this.enabled) return;
    if (length <= 0) return;
    _v1.copy(direction).normalize();
    const headLen = Math.min(length * 0.2, 0.3);
    const headWidth = headLen * 0.5;
    // 尖端
    _v2.copy(origin).addScaledVector(_v1, length);
    // 杆身
    this.drawLine(origin, _v2, color, duration);
    // 头部底面中心
    _v3.copy(origin).addScaledVector(_v1, Math.max(0.0001, length - headLen));
    // 求与 _v1 正交的两个单位向量
    if (Math.abs(_v1.y) < 0.99) {
      _v4.set(0, 1, 0);
    } else {
      _v4.set(1, 0, 0);
    }
    _v5.copy(_v4).cross(_v1).normalize();
    _v6.copy(_v1).cross(_v5).normalize();
    // 4 条头部棱线
    _v7.copy(_v3).addScaledVector(_v5, headWidth);
    this.drawLine(_v2, _v7, color, duration);
    _v7.copy(_v3).addScaledVector(_v6, headWidth);
    this.drawLine(_v2, _v7, color, duration);
    _v7.copy(_v3).addScaledVector(_v5, -headWidth);
    this.drawLine(_v2, _v7, color, duration);
    _v7.copy(_v3).addScaledVector(_v6, -headWidth);
    this.drawLine(_v2, _v7, color, duration);
  }

  /**
   * 绘制十字标记(3 轴短线段)。
   * @param position 中心
   * @param size     半臂长
   * @param color    RGB
   * @param duration 显示时长
   */
  drawCross(
    position: Vector3,
    size: number = 0.2,
    color: DebugColor = [1, 1, 1],
    duration?: number,
  ): void {
    if (!this.enabled) return;
    const s = Math.abs(size);
    _v1.set(position.x - s, position.y, position.z);
    _v2.set(position.x + s, position.y, position.z);
    this.drawLine(_v1, _v2, color, duration);
    _v1.set(position.x, position.y - s, position.z);
    _v2.set(position.x, position.y + s, position.z);
    this.drawLine(_v1, _v2, color, duration);
    _v1.set(position.x, position.y, position.z - s);
    _v2.set(position.x, position.y, position.z + s);
    this.drawLine(_v1, _v2, color, duration);
  }

  /**
   * 绘制地面网格(XZ 平面,以 Y=0 为基准)。
   * @param size      网格半边长(总边长 = size × 2)
   * @param divisions 等分数
   * @param color     RGB
   * @param duration  显示时长
   */
  drawGrid(
    size: number = 10,
    divisions: number = 10,
    color: DebugColor = [0.5, 0.5, 0.5],
    duration?: number,
  ): void {
    if (!this.enabled) return;
    if (size <= 0 || divisions <= 0) return;
    const step = (size * 2) / divisions;
    const half = size;
    for (let i = 0; i <= divisions; i++) {
      const p = -half + i * step;
      // 沿 X 方向的线(固定 Z)
      _v1.set(-half, 0, p);
      _v2.set(half, 0, p);
      this.drawLine(_v1, _v2, color, duration);
      // 沿 Z 方向的线(固定 X)
      _v1.set(p, 0, -half);
      _v2.set(p, 0, half);
      this.drawLine(_v1, _v2, color, duration);
    }
  }

  /**
   * 绘制点(以十字或 sprite 形式,由调用方决定)。
   * @param position 位置
   * @param color    RGB
   * @param size     像素大小
   * @param duration 显示时长
   */
  drawPoint(
    position: Vector3,
    color: DebugColor = [1, 1, 1],
    size: number = 4,
    duration?: number,
  ): void {
    if (!this.enabled) return;
    this._totalDrawCalls++;
    const remaining = this._resolveDuration(duration);
    this.points.push({
      position: position.clone(),
      color,
      size: Math.max(1, size),
      remaining,
    });
  }

  /**
   * 绘制文字(世界空间锚点)。
   * @param position 锚点
   * @param text     字符串
   * @param color    RGB
   * @param duration 显示时长
   */
  drawText(
    position: Vector3,
    text: string,
    color: DebugColor = [1, 1, 1],
    duration?: number,
  ): void {
    if (!this.enabled) return;
    if (!text) return;
    this._totalDrawCalls++;
    const remaining = this._resolveDuration(duration);
    this.text.push({
      position: position.clone(),
      text,
      color,
      remaining,
    });
  }

  /**
   * 绘制视锥(6 平面 12 条边)。
   * 注意:Frustum 类只存 6 个平面,不直接给角点。本方法用平面两两求交
   * 的方式近似——简单实现:取每条边为两平面交线上的代表性线段。
   * 简化实现:遍历 8 个角点(由 near/far 与 4 个侧平面相交得到)。
   * 由于 Frustum 不直接暴露角点,这里通过平面交点迭代求解。
   * @param frustum  Frustum(6 平面:left,right,bottom,top,near,far)
   * @param color    RGB
   * @param duration 显示时长
   */
  drawFrustum(
    frustum: Frustum,
    color: DebugColor = [0.8, 0.4, 1],
    duration?: number,
  ): void {
    if (!this.enabled) return;
    // 8 个角点 = 3 平面组合 (left/right) × (bottom/top) × (near/far)
    const planes = frustum.planes;
    if (planes.length < 6) return;
    const idx = [
      [0, 2, 4], [1, 2, 4], [0, 3, 4], [1, 3, 4], // near 4 角
      [0, 2, 5], [1, 2, 5], [0, 3, 5], [1, 3, 5], // far 4 角
    ];
    const corners: Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const c = this._intersect3Planes(
        planes[idx[i][0]], planes[idx[i][1]], planes[idx[i][2]],
      );
      if (c) corners.push(c);
    }
    if (corners.length !== 8) return;
    // near 4 边
    this.drawLine(corners[0], corners[1], color, duration);
    this.drawLine(corners[1], corners[3], color, duration);
    this.drawLine(corners[3], corners[2], color, duration);
    this.drawLine(corners[2], corners[0], color, duration);
    // far 4 边
    this.drawLine(corners[4], corners[5], color, duration);
    this.drawLine(corners[5], corners[7], color, duration);
    this.drawLine(corners[7], corners[6], color, duration);
    this.drawLine(corners[6], corners[4], color, duration);
    // 4 立柱
    this.drawLine(corners[0], corners[4], color, duration);
    this.drawLine(corners[1], corners[5], color, duration);
    this.drawLine(corners[2], corners[6], color, duration);
    this.drawLine(corners[3], corners[7], color, duration);
  }

  /**
   * 绘制几何体法线(每个顶点一条法线段)。
   * @param geometry BufferGeometry,需要 'position' + 'normal' 属性
   * @param color    RGB
   * @param length   每条法线长度
   * @param duration 显示时长
   */
  drawNormals(
    geometry: BufferGeometry,
    color: DebugColor = [0.5, 1, 0.5],
    length: number = 0.2,
    duration?: number,
  ): void {
    if (!this.enabled) return;
    const posAttr = geometry.getAttribute('position');
    const nrmAttr = geometry.getAttribute('normal');
    if (!posAttr || !nrmAttr) return;
    const pos = posAttr.array as ArrayLike<number>;
    const nrm = nrmAttr.array as ArrayLike<number>;
    const count = Math.min(posAttr.count, nrmAttr.count);
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      _v1.set(pos[ix], pos[ix + 1], pos[ix + 2]);
      _v2.set(nrm[ix], nrm[ix + 1], nrm[ix + 2]).normalize();
      _v3.copy(_v1).addScaledVector(_v2, length);
      this.drawLine(_v1, _v3, color, duration);
    }
  }

  /**
   * 绘制三角形(3 条边 + 可选法线)。
   * @param a        顶点 A
   * @param b        顶点 B
   * @param c        顶点 C
   * @param color    RGB
   * @param duration 显示时长
   */
  drawTriangle(
    a: Vector3,
    b: Vector3,
    c: Vector3,
    color: DebugColor = [1, 0.7, 0.3],
    duration?: number,
  ): void {
    if (!this.enabled) return;
    this.drawLine(a, b, color, duration);
    this.drawLine(b, c, color, duration);
    this.drawLine(c, a, color, duration);
  }

  /**
   * 帧末推进 duration,移除过期元素。
   * - remaining > 0:递减 dt,<=0 时移除
   * - remaining === 0:单帧,update 后立即移除
   * - remaining === Infinity:永久,保留
   */
  update(dt: number): void {
    if (dt < 0) dt = 0;
    // lines
    if (this.lines.length > 0) {
      const keep: DebugLine[] = [];
      for (let i = 0; i < this.lines.length; i++) {
        const l = this.lines[i];
        if (l.remaining === FOREVER) {
          keep.push(l);
        } else {
          l.remaining -= dt;
          if (l.remaining > 0) keep.push(l);
        }
      }
      this.lines = keep;
    }
    // points
    if (this.points.length > 0) {
      const keep: DebugPoint[] = [];
      for (let i = 0; i < this.points.length; i++) {
        const p = this.points[i];
        if (p.remaining === FOREVER) {
          keep.push(p);
        } else {
          p.remaining -= dt;
          if (p.remaining > 0) keep.push(p);
        }
      }
      this.points = keep;
    }
    // text
    if (this.text.length > 0) {
      const keep: DebugText[] = [];
      for (let i = 0; i < this.text.length; i++) {
        const t = this.text[i];
        if (t.remaining === FOREVER) {
          keep.push(t);
        } else {
          t.remaining -= dt;
          if (t.remaining > 0) keep.push(t);
        }
      }
      this.text = keep;
    }
  }

  /** 清空所有调试元素。 */
  clear(): void {
    this.lines.length = 0;
    this.points.length = 0;
    this.text.length = 0;
  }

  /**
   * 拉取本帧渲染数据(线段 + 点)。文字单独由调用方遍历 this.text。
   * 返回的 Float32Array 是内部缓冲的引用,调用方不应持有跨帧。
   */
  getMeshData(): DebugRenderData {
    // 线段
    const lineSegs = this.lines.length;
    const needLineFloats = lineSegs * 6;
    if (this._lineVertsBuf.length < needLineFloats) {
      // 倍增扩容
      let cap = this._lineVertsBuf.length;
      while (cap < needLineFloats) cap *= 2;
      this._lineVertsBuf = new Float32Array(cap);
      this._lineColorsBuf = new Float32Array(cap);
    }
    for (let i = 0; i < lineSegs; i++) {
      const l = this.lines[i];
      const o = i * 6;
      this._lineVertsBuf[o + 0] = l.from.x;
      this._lineVertsBuf[o + 1] = l.from.y;
      this._lineVertsBuf[o + 2] = l.from.z;
      this._lineVertsBuf[o + 3] = l.to.x;
      this._lineVertsBuf[o + 4] = l.to.y;
      this._lineVertsBuf[o + 5] = l.to.z;
      const c = l.color;
      this._lineColorsBuf[o + 0] = c[0];
      this._lineColorsBuf[o + 1] = c[1];
      this._lineColorsBuf[o + 2] = c[2];
      this._lineColorsBuf[o + 3] = c[0];
      this._lineColorsBuf[o + 4] = c[1];
      this._lineColorsBuf[o + 5] = c[2];
    }

    // 点
    const ptCount = this.points.length;
    const needPtFloats = ptCount * 3;
    if (this._pointVertsBuf.length < needPtFloats) {
      let cap = this._pointVertsBuf.length;
      while (cap < needPtFloats) cap *= 2;
      this._pointVertsBuf = new Float32Array(cap);
      this._pointColorsBuf = new Float32Array(cap);
      this._pointSizesBuf = new Float32Array(Math.floor(cap / 3));
    }
    for (let i = 0; i < ptCount; i++) {
      const p = this.points[i];
      const o = i * 3;
      this._pointVertsBuf[o + 0] = p.position.x;
      this._pointVertsBuf[o + 1] = p.position.y;
      this._pointVertsBuf[o + 2] = p.position.z;
      const c = p.color;
      this._pointColorsBuf[o + 0] = c[0];
      this._pointColorsBuf[o + 1] = c[1];
      this._pointColorsBuf[o + 2] = c[2];
      this._pointSizesBuf[i] = p.size;
    }

    return {
      lineVertices: this._lineVertsBuf,
      lineVertexCount: needLineFloats,
      lineColors: this._lineColorsBuf,
      pointVertices: this._pointVertsBuf,
      pointVertexCount: needPtFloats,
      pointColors: this._pointColorsBuf,
      pointSizes: this._pointSizesBuf,
    };
  }

  /** 返回当前统计。 */
  getStats(): DebugRendererStats {
    return {
      lineCount: this.lines.length,
      pointCount: this.points.length,
      textCount: this.text.length,
      totalDrawCalls: this._totalDrawCalls,
      enabled: this.enabled,
    };
  }

  /** 解析 duration 参数:undefined → this.duration;负数 → 永久。 */
  private _resolveDuration(duration?: number): number {
    if (duration === undefined) return this.duration;
    if (duration < 0) return FOREVER;
    return duration;
  }

  /**
   * 求 3 平面交点。若三平面无交点(法线行列式 ~0)返回 null。
   * 实现:Cramer's rule on 3x3 system。
   */
  private _intersect3Planes(
    p1: { normal: Vector3; constant: number },
    p2: { normal: Vector3; constant: number },
    p3: { normal: Vector3; constant: number },
  ): Vector3 | null {
    const n1 = p1.normal, n2 = p2.normal, n3 = p3.normal;
    const c1 = p1.constant, c2 = p2.constant, c3 = p3.constant;
    // 行列式 det = n1 · (n2 × n3)
    const cx = n2.y * n3.z - n2.z * n3.y;
    const cy = n2.z * n3.x - n2.x * n3.z;
    const cz = n2.x * n3.y - n2.y * n3.x;
    const det = n1.x * cx + n1.y * cy + n1.z * cz;
    if (Math.abs(det) < 1e-9) return null;
    // 解 x = (-c1, -c2, -c3) · (n2×n3, n3×n1, n1×n2) / det
    // 这里直接构造向量 a = (-c1, -c2, -c3),b = 三平面法线两两叉乘
    // 用 Cramer 法则:xi = det([替换 i 列为 -c 向量]) / det
    // 简化形式:
    _v7.set(-c1, -c2, -c3);
    // 三个替换矩阵的行列式
    // x 行列式 = [-c1, n2.x, n3.x; -c2, n2.y, n3.y; -c3, n2.z, n3.z]
    const dx = _v7.x * (n2.y * n3.z - n2.z * n3.y)
             - n2.x * (-c2 * n3.z - (-c3) * n3.y)
             + n3.x * (-c2 * n2.z - (-c3) * n2.y);
    // 实际上等价于 _v7 · (n2 × n3) / det,用点积更稳:
    const x = (-c1 * cx + -c2 * (n3.z * n1.x - n3.x * n1.z) + -c3 * (n1.x * n2.y - n1.y * n2.x)) / det;
    void dx; // 防止 lint
    // 用更直接的公式: result = (-c1 * (n2 × n3) - c2 * (n3 × n1) - c3 * (n1 × n2)) / det
    const a1 = -c1;
    const a2 = -c2;
    const a3 = -c3;
    // u = n2 × n3
    const ux = n2.y * n3.z - n2.z * n3.y;
    const uy = n2.z * n3.x - n2.x * n3.z;
    const uz = n2.x * n3.y - n2.y * n3.x;
    // v = n3 × n1
    const vx = n3.y * n1.z - n3.z * n1.y;
    const vy = n3.z * n1.x - n3.x * n1.z;
    const vz = n3.x * n1.y - n3.y * n1.x;
    // w = n1 × n2
    const wx = n1.y * n2.z - n1.z * n2.y;
    const wy = n1.z * n2.x - n1.x * n2.z;
    const wz = n1.x * n2.y - n1.y * n2.x;
    const px = (a1 * ux + a2 * vx + a3 * wx) / det;
    const py = (a1 * uy + a2 * vy + a3 * wy) / det;
    const pz = (a1 * uz + a2 * vz + a3 * wz) / det;
    void x;
    return new Vector3(px, py, pz);
  }
}

/**
 * 构建 DebugRenderer 默认颜色调色板(参考 Unity / Unreal debug colors)。
 * 返回一组常用颜色,供调用方按场景挑选。
 */
export const DebugColors = {
  white: [1, 1, 1] as DebugColor,
  red: [1, 0, 0] as DebugColor,
  green: [0, 1, 0] as DebugColor,
  blue: [0, 0, 1] as DebugColor,
  yellow: [1, 1, 0] as DebugColor,
  cyan: [0, 1, 1] as DebugColor,
  magenta: [1, 0, 1] as DebugColor,
  orange: [1, 0.5, 0] as DebugColor,
  purple: [0.7, 0, 1] as DebugColor,
  gray: [0.5, 0.5, 0.5] as DebugColor,
} as const;

/** Vector4 临时变量,供 future API 使用。 */
export const _dv4 = new Vector4(0, 0, 0, 1);

export { clamp };
