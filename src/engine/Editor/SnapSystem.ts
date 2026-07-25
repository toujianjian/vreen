// SnapSystem — 吸附系统。
// 在编辑器变换过程中把位置/旋转/缩放吸附到规则网格或步长,提升精确放置体验。
//
// 设计:
//   * 三类吸附相互独立(网格/角度/缩放),各自有开关与步长。
//   * snap* 方法不修改输入,返回新 Vector3;调用方决定是否写回。
//   * 吸附规则:对每个分量取 round(value / step) * step。
//   * 步长必须 > 0,set* 方法会校验并回退到默认值。

import { Vector3 } from '../Math/Vector3';

export class SnapSystem {
  /** 是否启用网格(位置)吸附。 */
  gridSnap: boolean = false;
  /** 网格大小(世界单位)。 */
  gridSize: number = 0.25;
  /** 是否启用角度(旋转)吸附。 */
  angleSnap: boolean = false;
  /** 角度步长(弧度)。默认 15° = π/12。 */
  angleStep: number = Math.PI / 12;
  /** 是否启用缩放吸附。 */
  scaleSnap: boolean = false;
  /** 缩放步长。默认 0.25。 */
  scaleStep: number = 0.25;

  /**
   * 位置吸附:三分量分别 round 到 gridSize 整数倍。
   * gridSnap=false 时返回输入的 clone(不修改原值)。
   */
  snapPosition(position: Vector3): Vector3 {
    if (!this.gridSnap) return position.clone();
    return new Vector3(
      snapValue(position.x, this.gridSize),
      snapValue(position.y, this.gridSize),
      snapValue(position.z, this.gridSize),
    );
  }

  /**
   * 旋转吸附:三分量(视为欧拉角弧度)分别 round 到 angleStep 整数倍。
   * angleSnap=false 时返回输入的 clone。
   */
  snapRotation(rotation: Vector3): Vector3 {
    if (!this.angleSnap) return rotation.clone();
    return new Vector3(
      snapValue(rotation.x, this.angleStep),
      snapValue(rotation.y, this.angleStep),
      snapValue(rotation.z, this.angleStep),
    );
  }

  /**
   * 缩放吸附:三分量分别 round 到 scaleStep 整数倍。
   * scaleSnap=false 时返回输入的 clone。
   * 注意:缩放为 0 会被吸附到最近的非零步长(round(0/step)*step = 0),
   * 调用方若需要保底下限应自行 clamp。
   */
  snapScale(scale: Vector3): Vector3 {
    if (!this.scaleSnap) return scale.clone();
    return new Vector3(
      snapValue(scale.x, this.scaleStep),
      snapValue(scale.y, this.scaleStep),
      snapValue(scale.z, this.scaleStep),
    );
  }

  /** 设置网格大小。size<=0 时忽略,保留原值。 */
  setGridSize(size: number): void {
    if (size > 0) this.gridSize = size;
  }

  /** 设置角度步长。step<=0 时忽略。 */
  setAngleStep(step: number): void {
    if (step > 0) this.angleStep = step;
  }

  /** 设置缩放步长。step<=0 时忽略。 */
  setScaleStep(step: number): void {
    if (step > 0) this.scaleStep = step;
  }

  /** 切换网格吸附开关。返回切换后的状态。 */
  toggleGridSnap(): boolean {
    this.gridSnap = !this.gridSnap;
    return this.gridSnap;
  }

  /** 切换角度吸附开关。 */
  toggleAngleSnap(): boolean {
    this.angleSnap = !this.angleSnap;
    return this.angleSnap;
  }

  /** 切换缩放吸附开关。 */
  toggleScaleSnap(): boolean {
    this.scaleSnap = !this.scaleSnap;
    return this.scaleSnap;
  }
}

/**
 * 把 value 吸附到 step 的整数倍。step<=0 时原样返回。
 * 用 Math.round 而非 floor:对负数也能正确吸附到最近格点。
 */
function snapValue(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}
