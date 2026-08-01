// CubeCamera — 立方体相机,从 6 个方向渲染场景生成立方体环境贴图。
//
// 适配 three.js CubeCamera.js。核心用途:
//   - 实时环境贴图捕获(IBL、反射、折射)
//   - 动态天空盒
//   - ReflectionProbe 的低层原语
//   - 点光源阴影映射(与 ShadowMapManager 互补)
//
// 设计:
//   - CubeCamera 继承 Object3D,可放置在场景中任意位置
//   - 内部持有 6 个 PerspectiveCamera(FOV=90°, aspect=1),分别指向 ±X/±Y/±Z
//   - renderTarget 描述立方体贴图渲染目标(分辨率、格式、mipmap)
//   - update(renderer, scene) 方法:渲染器遍历 6 个相机,逐面渲染到立方体 FBO
//   - 遵循 VREEN 约定:本类只负责相机数据(位置/方向/投影),不直接调用 GL
//
// 6 面方向(与 OpenGL cubemap 约定一致):
//   +X (right):  eye = pos, target = pos + (1,0,0),  up = (0,-1,0)
//   -X (left):   eye = pos, target = pos + (-1,0,0), up = (0,-1,0)
//   +Y (top):    eye = pos, target = pos + (0,1,0),  up = (0,0,1)
//   -Y (bottom): eye = pos, target = pos + (0,-1,0), up = (0,0,-1)
//   +Z (front):  eye = pos, target = pos + (0,0,1),  up = (0,-1,0)
//   -Z (back):   eye = pos, target = pos + (0,0,-1), up = (0,-1,0)
//
// 与 three.js 的差异:
//   - three.js CubeCamera 持有 WebGLCubeRenderTarget + 6 PerspectiveCamera,
//     update(renderer, scene) 直接调用 renderer.setRenderTarget + renderer.render
//   - VREEN CubeCamera 只持有相机数据 + renderTarget 描述,不直接调 GL
//   - 渲染由 WebGL2Renderer.updateCubeCamera(camera, scene) 完成
//   - 可在 Node/无头环境测试(相机方向、投影矩阵、位置同步)
//
// 参考:
//   - three.js src/cameras/CubeCamera.js
//   - OpenGL 4.5 Spec Section 8.13.1 (Cube Map Texture Origin)
//   - o3de Atom ReflectionProbe

import { Object3D } from '../Core/Object3D';
import { PerspectiveCamera } from './PerspectiveCamera';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';
import type { Quaternion } from '../Math/Quaternion';

/** 立方体贴图渲染目标描述(供渲染器创建 FBO)。 */
export interface CubeRenderTarget {
  /** 每面分辨率(像素,正方形)。默认 256。 */
  resolution: number;
  /** 纹理格式。默认 'rgba8'。 */
  format: 'rgba8' | 'rgba16f' | 'rgba32f' | 'r11g11b10';
  /** 是否生成 mipmap。默认 true。 */
  generateMipmaps: boolean;
  /** 颜色空间。默认 'srgb'(用于环境贴图显示)。 */
  colorSpace: 'srgb' | 'linear';
}

/** 立方体面索引顺序。 */
export const CUBE_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;
export type CubeFace = (typeof CUBE_FACES)[number];

/** 每面对应的方向向量与 up 向量。 */
const FACE_DIRS: Record<CubeFace, { dir: Vector3; up: Vector3 }> = {
  px: { dir: new Vector3(1, 0, 0), up: new Vector3(0, -1, 0) },
  nx: { dir: new Vector3(-1, 0, 0), up: new Vector3(0, -1, 0) },
  py: { dir: new Vector3(0, 1, 0), up: new Vector3(0, 0, 1) },
  ny: { dir: new Vector3(0, -1, 0), up: new Vector3(0, 0, -1) },
  pz: { dir: new Vector3(0, 0, 1), up: new Vector3(0, -1, 0) },
  nz: { dir: new Vector3(0, 0, -1), up: new Vector3(0, -1, 0) },
};

// lookAt 临时变量。
const _target = new Vector3();
const _viewMatrix = new Matrix4();

/**
 * 立方体相机 — 从 6 个方向渲染场景生成立方体环境贴图。
 *
 * ```ts
 * const cubeCam = new CubeCamera({ near: 0.1, far: 100, resolution: 256 });
 * cubeCam.position.set(0, 5, 0);
 * scene.add(cubeCam);
 *
 * // 每帧(或按需)更新环境贴图
 * renderer.updateCubeCamera(cubeCam, scene);
 *
 * // 使用渲染结果作为环境贴图
 * material.envMap = cubeCam.renderTargetTexture;
 * ```
 */
export class CubeCamera extends Object3D {
  override readonly type: string = 'CubeCamera';
  /** 类型标志。 */
  isCubeCamera: boolean = true;

  /** 6 面 PerspectiveCamera(90° FOV, aspect=1)。顺序: px, nx, py, ny, pz, nz。 */
  readonly cameras: PerspectiveCamera[] = [];
  /** 渲染目标描述(分辨率、格式、mipmap)。 */
  renderTarget: CubeRenderTarget;
  /** 近裁剪面。 */
  near: number;
  /** 远裁剪面。 */
  far: number;
  /** 渲染时是否更新世界矩阵(默认 true)。 */
  autoUpdate: boolean = true;
  /** 版本号,每次 update 递增(渲染器据此判断是否需要重绘)。 */
  version: number = 0;

  constructor(opts: {
    near?: number;
    far?: number;
    resolution?: number;
    format?: CubeRenderTarget['format'];
    generateMipmaps?: boolean;
    colorSpace?: CubeRenderTarget['colorSpace'];
  } = {}) {
    super();
    this.near = opts.near ?? 0.1;
    this.far = opts.far ?? 1000;
    this.renderTarget = {
      resolution: opts.resolution ?? 256,
      format: opts.format ?? 'rgba8',
      generateMipmaps: opts.generateMipmaps ?? true,
      colorSpace: opts.colorSpace ?? 'srgb',
    };

    // 创建 6 个 90° PerspectiveCamera。
    for (let i = 0; i < 6; i++) {
      const cam = new PerspectiveCamera(90, 1, this.near, this.far);
      this.cameras.push(cam);
    }

    this._updateCameras();
  }

  /** 设置近裁剪面(更新所有 6 个相机)。 */
  setNear(near: number): this {
    this.near = near;
    for (const cam of this.cameras) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    return this;
  }

  /** 设置远裁剪面(更新所有 6 个相机)。 */
  setFar(far: number): this {
    this.far = far;
    for (const cam of this.cameras) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    return this;
  }

  /** 设置渲染目标分辨率。 */
  setResolution(res: number): this {
    this.renderTarget.resolution = Math.max(1, Math.floor(res));
    return this;
  }

  /**
   * 更新 6 个相机的位置和方向(基于 CubeCamera 的世界变换)。
   * 在 update() 之前自动调用,也可手动调用来预览方向。
   */
  updateCameras(): void {
    this._updateCameras();
  }

  /**
   * 渲染 6 面到立方体贴图。
   *
   * VREEN 约定:本方法不直接调 GL,而是通知渲染器执行 6 面 render-to-cube。
   * 渲染器实现 `updateCubeCamera(camera, scene)` 方法,遍历 cameras[6] 逐面渲染。
   *
   * @param renderer 渲染器(需支持 updateCubeCamera 接口)。
   * @param scene    要渲染的场景。
   */
  update(renderer: { updateCubeCamera: (cam: CubeCamera, scene: Object3D) => void }, scene: Object3D): void {
    if (this.autoUpdate) this.updateMatrixWorld(true);
    this._updateCameras();
    renderer.updateCubeCamera(this, scene);
    this.version++;
  }

  // ── 内部 ──────────────────────────────────────────────────────

  /**
   * 根据 CubeCamera 的世界位置 + 6 面方向,设置每个 PerspectiveCamera 的位置与朝向。
   *
   * 实现细节:
   *   - 直接用 `Matrix4.makeLookAt(eye, target, up)` 构造 view matrix,绕过
   *     `Object3D.lookAt`(其 up 写死为 (0,1,0),无法表达 ±Y 面的 (0,0,±1) up)。
   *   - view matrix 的旋转部分是正交矩阵,其逆 = 转置;转置后即相机的世界旋转 R。
   *   - 从 R 提取四元数写入 `cam.rotation`,后续 `cam.updateMatrixWorld()` 会据此
   *     重算 matrixWorld,getWorldDirection() 返回的 -Z 轴即对应该面的 dir。
   */
  private _updateCameras(): void {
    const pos = this.position;
    for (let i = 0; i < 6; i++) {
      const face = CUBE_FACES[i];
      const { dir, up } = FACE_DIRS[face];
      const cam = this.cameras[i];

      // 相机位置 = CubeCamera 位置
      cam.position.copy(pos);
      // target = pos + dir
      _target.copy(pos).add(dir);

      // 用自定义 up 构造 view matrix(Object3D.lookAt 无法指定 up)。
      _viewMatrix.makeLookAt(pos, _target, up);

      // view matrix 列主序 elements:
      //   列 0 (right): e[0],e[1],e[2]
      //   列 1 (up):    e[4],e[5],e[6]
      //   列 2 (back):  e[8],e[9],e[10]
      // 行主序的 view 旋转 V:
      //   v00=e[0] v01=e[4] v02=e[8]
      //   v10=e[1] v11=e[5] v12=e[9]
      //   v20=e[2] v21=e[6] v22=e[10]
      // 世界旋转 R = V^T(正交矩阵的逆 = 转置):
      //   r00=v00 r01=v10 r02=v20
      //   r10=v01 r11=v11 r12=v21
      //   r20=v02 r21=v12 r22=v22
      const e = _viewMatrix.elements;
      const v00 = e[0], v01 = e[4], v02 = e[8];
      const v10 = e[1], v11 = e[5], v12 = e[9];
      const v20 = e[2], v21 = e[6], v22 = e[10];
      setQuatFromRotationMatrix(
        cam.rotation,
        v00, v10, v20,
        v01, v11, v21,
        v02, v12, v22,
      );

      // 同步投影矩阵(确保 near/far/fov/aspect 正确)
      cam.aspect = 1;
      cam.fov = 90;
      cam.updateProjectionMatrix();
    }
  }

  // ── Object3D 覆盖 ─────────────────────────────────────────────

  override updateMatrixWorld(force: boolean = false): void {
    super.updateMatrixWorld(force);
    this._updateCameras();
  }
}

/**
 * 从 3x3 旋转矩阵(行主序)提取四元数。与 Object3D.lookAt 内部实现一致,
 * 这里复制一份以避免导出 Object3D 的私有辅助函数。
 *
 * 参考:Ken Shoemake, "Quaternion Calculus and Fast Animation" (1987).
 */
function setQuatFromRotationMatrix(
  q: Quaternion,
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number,
): void {
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q.w = 0.25 / s;
    q.x = (m21 - m12) * s;
    q.y = (m02 - m20) * s;
    q.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q.w = (m21 - m12) / s;
    q.x = 0.25 * s;
    q.y = (m01 + m10) / s;
    q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q.w = (m02 - m20) / s;
    q.x = (m01 + m10) / s;
    q.y = 0.25 * s;
    q.z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q.w = (m10 - m01) / s;
    q.x = (m02 + m20) / s;
    q.y = (m12 + m21) / s;
    q.z = 0.25 * s;
  }
  q.normalize();
}
