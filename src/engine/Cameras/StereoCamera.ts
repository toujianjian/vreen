// StereoCamera — 双目立体相机 (stereoscopic camera)。
//
// 适配 three.js `src/cameras/StereoCamera.js`。
// 生成左右眼两个 PerspectiveCamera,支持 off-axis (非对称) 立体投影,
// 用于 VR / 3D 电影 / 红蓝立体 / 偏振立体渲染。
//
// 原理:
//   - 两个相机水平分离 eyeSeparation(瞳距,~0.064m)
//   - 每只眼的视锥体向内侧偏移(asymmetric frustum),使两眼视线在
//     convergence 距离处汇合
//   - 左眼看到的内容和右眼略有差异 → 大脑合成深度感知
//
// Off-axis 投影(优于 toe-in 投影,无垂直视差):
//   左眼:frustum 右边界向内移动,左边界向外移动
//   右眼:frustum 左边界向内移动,右边界向外移动
//   投影矩阵的 left/right 被偏移:shift = eyeSep * near / convergence
//
// 不变量:
//   - eyeSeparation > 0(默认 0.064,人眼平均瞳距);
//   - 左眼在 -X 方向,右眼在 +X 方向(相机本地坐标);
//   - update() 后左右眼的 projectionMatrix 反映非对称视锥;
//   - 左右眼的 matrixWorld 反映瞳距偏移。
//
// 参考:
//   - three.js src/cameras/StereoCamera.js
//   - Robert Kooima "Generalized Perspective Projection" (2008)
//   - o3de Atom VR/XR rendering

import { PerspectiveCamera } from './PerspectiveCamera';
import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';

/** StereoCamera 配置。 */
export interface StereoCameraOptions {
  /** 瞳距(米)。默认 0.064。 */
  eyeSeparation?: number;
  /** 汇聚距离(世界单位)。默认 10。 */
  convergence?: number;
}

/**
 * 双目立体相机。
 *
 * 持有两个 PerspectiveCamera(stereoL / stereoR),通过 update(camera) 
 * 根据主相机的位置/朝向/投影同步左右眼。
 */
export class StereoCamera {
  /** 左眼相机。 */
  readonly stereoL: PerspectiveCamera;
  /** 右眼相机。 */
  readonly stereoR: PerspectiveCamera;
  /** 瞳距(米)。 */
  eyeSeparation: number;
  /** 汇聚距离(世界单位,两眼视线在此距离汇合)。 */
  convergence: number;

  // 临时变量
  private _eyeLeft = new Vector3();
  private _eyeRight = new Vector3();

  constructor(opts: StereoCameraOptions = {}) {
    this.eyeSeparation = opts.eyeSeparation ?? 0.064;
    this.convergence = opts.convergence ?? 10;
    this.stereoL = new PerspectiveCamera();
    this.stereoR = new PerspectiveCamera();
  }

  /**
   * 根据主相机更新左右眼的投影矩阵和世界变换。
   *
   * 算法 (off-axis):
   *   1. 从主相机的 matrixWorld 提取位置和朝向
   *   2. 计算左右眼位置:沿相机的本地 X 轴偏移 ±eyeSep/2
   *   3. 计算非对称投影:
   *      - 主相机 fov → top = near * tan(fov/2)
   *      - 每只眼的 frustum 在 X 方向偏移: 
   *        eyeShift = (eyeSep/2) * (near / convergence)
   *      - 左眼:left = -aspect*top + eyeShift, right = aspect*top + eyeShift
   *      - 右眼:left = -aspect*top - eyeShift, right = aspect*top - eyeShift
   *   4. 设置左右眼的 projectionMatrix 和 matrixWorld
   *
   * @param camera 主相机(通常为用户的 PerspectiveCamera)。
   */
  update(camera: PerspectiveCamera): void {
    const cameraL = this.stereoL;
    const cameraR = this.stereoR;

    // 同步基础参数
    cameraL.fov = camera.fov;
    cameraL.aspect = camera.aspect * 0.5; // 每只眼占一半宽度
    cameraL.near = camera.near;
    cameraL.far = camera.far;
    cameraR.fov = camera.fov;
    cameraR.aspect = camera.aspect * 0.5;
    cameraR.near = camera.near;
    cameraR.far = camera.far;

    // 确保主相机的世界矩阵是最新的
    camera.updateMatrixWorld(true);
    const m = camera.matrixWorld.elements;

    // 提取主相机的世界坐标轴
    // X 轴(右) = elements[0,1,2]
    const xAxis = { x: m[0], y: m[1], z: m[2] };

    // 主相机世界位置
    const camPos = { x: m[12], y: m[13], z: m[14] };

    // 计算左右眼位置(沿 X 轴偏移 ±eyeSep/2)
    const eyeSepHalf = this.eyeSeparation / 2;
    this._eyeLeft.set(
      camPos.x - xAxis.x * eyeSepHalf,
      camPos.y - xAxis.y * eyeSepHalf,
      camPos.z - xAxis.z * eyeSepHalf,
    );
    this._eyeRight.set(
      camPos.x + xAxis.x * eyeSepHalf,
      camPos.y + xAxis.y * eyeSepHalf,
      camPos.z + xAxis.z * eyeSepHalf,
    );

    // 计算非对称投影 (off-axis)
    const fovRad = (camera.fov * Math.PI) / 180;
    const top = camera.near * Math.tan(fovRad / 2);
    const bottom = -top;
    const halfWidth = cameraL.aspect * top; // 每只眼的半宽
    // frustum 偏移:眼睛在 X 方向偏移 eyeSep/2,在 near 平面上对应
    // 的偏移量 = (eyeSep/2) * (near / convergence)
    const eyeShift = eyeSepHalf * (camera.near / this.convergence);

    // 左眼:frustum 向右偏移 (left += eyeShift, right += eyeShift)
    const leftL = -halfWidth + eyeShift;
    const rightL = halfWidth + eyeShift;
    this._buildOffAxisProjection(cameraL.projectionMatrix, leftL, rightL, top, bottom, camera.near, camera.far);
    cameraL.projectionMatrixInverse.getInverse(cameraL.projectionMatrix);

    // 右眼:frustum 向左偏移 (left -= eyeShift, right -= eyeShift)
    const leftR = -halfWidth - eyeShift;
    const rightR = halfWidth - eyeShift;
    this._buildOffAxisProjection(cameraR.projectionMatrix, leftR, rightR, top, bottom, camera.near, camera.far);
    cameraR.projectionMatrixInverse.getInverse(cameraR.projectionMatrix);

    // 设置左右眼的 matrixWorld(位置 + 朝向与主相机相同)
    // 左眼
    cameraL.matrixWorld.elements.set(m);
    cameraL.matrixWorld.elements[12] = this._eyeLeft.x;
    cameraL.matrixWorld.elements[13] = this._eyeLeft.y;
    cameraL.matrixWorld.elements[14] = this._eyeLeft.z;

    // 右眼
    cameraR.matrixWorld.elements.set(m);
    cameraR.matrixWorld.elements[12] = this._eyeRight.x;
    cameraR.matrixWorld.elements[13] = this._eyeRight.y;
    cameraR.matrixWorld.elements[14] = this._eyeRight.z;
  }

  /**
   * 构建非对称透视投影矩阵 (off-axis)。
   *
   * 标准 WebGL 透视投影矩阵:
   *   [2n/(r-l)    0       (r+l)/(r-l)   0           ]
   *   [0           2n/(t-b) (t+b)/(t-b)   0           ]
   *   [0           0       -(f+n)/(f-n)  -2fn/(f-n)   ]
   *   [0           0       -1             0           ]
   */
  private _buildOffAxisProjection(
    target: Matrix4,
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
  ): void {
    const e = target.elements;
    const rl = right - left;
    const tb = top - bottom;
    const fn = far - near;

    e[0] = (2 * near) / rl;
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;

    e[4] = 0;
    e[5] = (2 * near) / tb;
    e[6] = 0;
    e[7] = 0;

    e[8] = (right + left) / rl;
    e[9] = (top + bottom) / tb;
    e[10] = -(far + near) / fn;
    e[11] = -1;

    e[12] = 0;
    e[13] = 0;
    e[14] = -(2 * far * near) / fn;
    e[15] = 0;
  }
}

/**
 * 立体渲染模式。
 * - SideBySide: 左右并排(VR 头显标准格式)
 * - Anaglyph: 红蓝立体(需要颜色滤镜)
 * - Interlaced: 隔行交错(偏振屏幕)
 */
export type StereoMode = 'sideBySide' | 'anaglyph' | 'interlaced';

/** StereoCamera 渲染配置。 */
export interface StereoRenderConfig {
  mode: StereoMode;
  /** 左眼视口宽度比例(0-1)。默认 0.5。 */
  leftWidth?: number;
  /** 右眼视口宽度比例(0-1)。默认 0.5。 */
  rightWidth?: number;
}

/**
 * 计算左右眼视口参数(用于 side-by-side 渲染)。
 */
export function computeStereoViewports(
  canvasWidth: number,
  canvasHeight: number,
  mode: StereoMode = 'sideBySide',
): { left: { x: number; y: number; w: number; h: number }; right: { x: number; y: number; w: number; h: number } } {
  if (mode === 'sideBySide') {
    const halfW = canvasWidth / 2;
    return {
      left: { x: 0, y: 0, w: halfW, h: canvasHeight },
      right: { x: halfW, y: 0, w: halfW, h: canvasHeight },
    };
  }
  // anaglyph / interlaced: 全屏
  return {
    left: { x: 0, y: 0, w: canvasWidth, h: canvasHeight },
    right: { x: 0, y: 0, w: canvasWidth, h: canvasHeight },
  };
}
