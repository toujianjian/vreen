// Line3 — 3D 线段,由起点 start 和终点 end 定义。
// 参考 three.js Line3,适配 VREEN 自研引擎的 TypeScript strict 模式。

import { Vector3 } from './Vector3';
import { Matrix4 } from './Matrix4';
import { clamp } from './MathUtils';

const _startP = new Vector3();
const _startEnd = new Vector3();

export class Line3 {
  start: Vector3;
  end: Vector3;

  constructor(start: Vector3 = new Vector3(), end: Vector3 = new Vector3()) {
    this.start = start;
    this.end = end;
  }

  set(start: Vector3, end: Vector3): this {
    this.start.copy(start);
    this.end.copy(end);
    return this;
  }

  copy(line: Line3): this {
    this.start.copy(line.start);
    this.end.copy(line.end);
    return this;
  }

  clone(): Line3 {
    return new Line3().copy(this);
  }

  /** 线段中点写入 target。 */
  getCenter(target: Vector3): Vector3 {
    return target.addVectors(this.start, this.end).multiplyScalar(0.5);
  }

  /** 方向向量(end - start)写入 target。 */
  delta(target: Vector3): Vector3 {
    return target.subVectors(this.end, this.start);
  }

  /** 线段长度(欧氏距离)。 */
  distance(): number {
    return this.start.distanceTo(this.end);
  }

  /** 线段长度平方。 */
  distanceSq(): number {
    return this.start.distanceToSquared(this.end);
  }

  /** 返回参数 t 处的点(t=0 为 start,t=1 为 end),写入 target。 */
  at(t: number, target: Vector3): Vector3 {
    return this.delta(target).multiplyScalar(t).add(this.start);
  }

  /** 点到线段的最近点。
   *  clampToLine=true 时把 t 限制在 [0,1];false 时返回线段所在直线上的最近点。
   *  结果写入 target。 */
  closestPointToPoint(point: Vector3, clampToLine: boolean, target: Vector3): Vector3 {
    const t = this._closestPointToPointParameter(point, clampToLine);
    return this.delta(target).multiplyScalar(t).add(this.start);
  }

  /** 计算点在线段上的参数 t(归一化),clampToLine 限制到 [0,1]。 */
  private _closestPointToPointParameter(point: Vector3, clampToLine: boolean): number {
    _startP.subVectors(point, this.start);
    _startEnd.subVectors(this.end, this.start);
    const startEnd2 = _startEnd.dot(_startEnd);
    if (startEnd2 === 0) return 0;
    const startEnd_startP = _startEnd.dot(_startP);
    let t = startEnd_startP / startEnd2;
    if (clampToLine) {
      t = clamp(t, 0, 1);
    }
    return t;
  }

  /** 用 4x4 矩阵变换两端点。 */
  applyMatrix4(matrix: Matrix4): this {
    this.start.applyMatrix4(matrix);
    this.end.applyMatrix4(matrix);
    return this;
  }

  /** 值相等比较。 */
  equals(line: Line3): boolean {
    return line.start.equals(this.start) && line.end.equals(this.end);
  }
}
