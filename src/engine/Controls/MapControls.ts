// MapControls — 地图视角控制器，继承自 OrbitControls，零 three 依赖。
//
// 与 OrbitControls 的区别：
//   - 左键 (button 0) = 平移（OrbitControls 是旋转）
//   - 右键 (button 2) = 旋转（OrbitControls 是平移）
//   - 中键 (button 1) = 平移（与 OrbitControls 一致）
//   - screenSpacePanning 默认 false：平移发生在世界 xz 地面平面上，
//     而非相机屏幕平面，更符合地图交互直觉。
//
// 参考 three.js MapControls，但简化了射线投射实现：
// 地面平移用相机水平前向 + 右向直接构造位移，不依赖 Raycaster/Plane。

import { OrbitControls, type OrbitControlsOptions, type PointerEntry } from './OrbitControls';
import { Camera } from '../Cameras/Camera';
import { Vector3 } from '../Math/Vector3';

export interface MapControlsOptions extends OrbitControlsOptions {
  /** 是否启用屏幕空间平移（true=相机平面，false=世界 xz 地面平面）。默认 false。 */
  screenSpacePanning?: boolean;
}

export class MapControls extends OrbitControls {
  /** 是否启用屏幕空间平移。false = 地面平面平移（地图风格）。 */
  screenSpacePanning: boolean;

  constructor(camera: Camera, domElement: HTMLElement, opts: MapControlsOptions = {}) {
    super(camera, domElement, opts);
    this.screenSpacePanning = opts.screenSpacePanning ?? false;
  }

  /**
   * 重写单指移动的按钮映射：
   *   左键 (0) → pan
   *   右键 (2) → rotate
   *   中键 (1) → pan（保持与 OrbitControls 一致）
   */
  protected override _handleSinglePointerMove(e: PointerEntry): void {
    const dx = e.curX - e.startX;
    const dy = e.curY - e.startY;
    e.startX = e.curX;
    e.startY = e.curY;

    if (e.button === 0 && this.enablePan) {
      // 左键 = pan
      this._panByPixels(dx, dy);
    } else if (e.button === 2 && this.enableRotate) {
      // 右键 = rotate
      this._rotateByPixels(dx, dy);
    } else if (e.button === 1 && this.enablePan) {
      // 中键 = pan
      this._panByPixels(dx, dy);
    }
  }

  /**
   * 重写平移：当 screenSpacePanning=false 时，在世界 xz 地面平面上平移。
   * 当 screenSpacePanning=true 时，退回到 OrbitControls 的屏幕空间平移。
   */
  override panByWorldDelta(x: number, y: number, z: number): void {
    if (this.screenSpacePanning) {
      super.panByWorldDelta(x, y, z);
      return;
    }
    // 地面平面平移：用相机水平前向 + 右向构造位移
    const forward = new Vector3().copy(this.camera.position).sub(this.target);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) {
      // 相机正上方时退化处理
      forward.set(0, 0, 1);
    }
    forward.normalize();
    const up = new Vector3(0, 1, 0);
    // right = forward × up（与 OrbitControls 同一约定）
    const right = new Vector3().copy(forward).cross(up).normalize();
    // move = right * x + forward * y + forward * z（z 在 _panByPixels 中不用）
    const move = new Vector3(
      right.x * x + forward.x * y + forward.x * z,
      0,
      right.z * x + forward.z * y + forward.z * z,
    );
    this._panOffsetTarget.add(move);
    this.target.add(move);
  }
}
