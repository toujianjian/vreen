// NetworkLerp — 网络插值与预测工具。
//
// 设计原则：
//   - 纯函数式（除 lerpRotation 内部 clone+slerp）：不修改入参，返回新对象。
//   - lerpPosition / lerpRotation 用于实体平滑插值（基于快照缓冲 prev/next）。
//   - predict 用于客户端预测外推（基于本地速度推算未来位置），带 maxSeconds 上限避免漂移。
//   - reconcile 用于服务器纠正（本地预测与服务器权威状态按 blendFactor 混合）。
//
// 不变量：
//   - t / blendFactor 自动 clamp 到 [0,1]。
//   - lerpRotation 走球面插值（slerp），取最短弧。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 位置 + 旋转组合，用于 reconcile。 */
export interface TransformState {
  position: Vector3;
  rotation: Quaternion;
}

export class NetworkLerp {
  /** 位置线性插值。返回新向量，不修改入参。 */
  static lerpPosition(from: Vector3, to: Vector3, t: number): Vector3 {
    const a = clamp01(t);
    return new Vector3(
      from.x + (to.x - from.x) * a,
      from.y + (to.y - from.y) * a,
      from.z + (to.z - from.z) * a,
    );
  }

  /** 旋转球面插值（slerp，最短弧）。返回新四元数，不修改入参。 */
  static lerpRotation(from: Quaternion, to: Quaternion, t: number): Quaternion {
    const a = clamp01(t);
    // Quaternion.slerp 修改 this，先 clone 再 slerp。
    return from.clone().slerp(to, a);
  }

  /** 外推预测：基于当前位置 + 速度 × dt 预测未来位置。
   *  maxSeconds 限制外推时间窗，避免丢包后漂移过大（默认 0.2s）。 */
  static predict(
    position: Vector3,
    velocity: Vector3,
    dt: number,
    maxSeconds: number = 0.2,
  ): Vector3 {
    const t = Math.min(Math.max(dt, 0), Math.max(0, maxSeconds));
    return new Vector3(
      position.x + velocity.x * t,
      position.y + velocity.y * t,
      position.z + velocity.z * t,
    );
  }

  /** 和解：服务器权威状态 server 与客户端预测 client 差异较大时，
   *  按 blendFactor ∈ [0,1] 混合。0 = 完全保留客户端；1 = 完全采用服务器。
   *  返回新的 { position, rotation }，不修改入参。 */
  static reconcile(
    server: TransformState,
    client: TransformState,
    blendFactor: number,
  ): TransformState {
    const a = clamp01(blendFactor);
    return {
      position: NetworkLerp.lerpPosition(client.position, server.position, a),
      rotation: NetworkLerp.lerpRotation(client.rotation, server.rotation, a),
    };
  }
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}
