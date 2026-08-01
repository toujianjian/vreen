// Reflector — 平面镜面反射 (planar reflection)。
//
// 适配 three.js `examples/jsm/objects/Reflector.js` 并重构为 CPU 侧反射数学库:
//   - 反射矩阵 (mirror matrix):任意点 P 关于平面 N·P + C = 0 的镜像
//   - 镜像相机:把主相机的 eye/target/up 关于反射平面翻转,得到虚拟相机
//   - 斜截投影 (oblique projection):修改近裁剪面使其与反射平面重合,
//     裁掉镜子背后的一切(避免反射纹理中出现穿模)
//   - 纹理矩阵 (texture matrix):把世界坐标 → 反射纹理 UV,用于屏幕空间映射
//
// 用途:
//   - 地板/墙面镜面反射(实时渲染场景到镜子纹理)
//   - 水面反射(与 WaterSystem 互补:WaterSystem 做波动 + 折射,Reflector 做平面反射)
//   - 传送门渲染(递归反射)
//   - 潜望镜 / 后视镜
//
// 不变量:
//   - 反射矩阵是正交矩阵 (det = -1,长度保持,角度保持但手性翻转);
//   - 镜像后的相机与原相机关于反射平面对称;
//   - 斜截投影的近裁剪面与反射平面重合(法线指向反射侧);
//   - 反射平面必须归一化 (|N| = 1),否则距离与矩阵不一致。
//
// 参考:
//   - three.js examples/jsm/objects/Reflector.js
//   - Eric Lengyel "Oblique Depth Projection" (Game Programming Gems 5)
//   - o3de Atom ReflectionProbe / SSR

import { Plane } from '../Math/Plane';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';

/** Reflector 配置。 */
export interface ReflectorOptions {
  /** 反射平面(默认 y=0,法线 (0,1,0),constant 0)。会被复制并归一化。 */
  plane?: Plane;
  /** 反射纹理分辨率(像素,正方形)。默认 512。 */
  resolution?: number;
  /** 镜面不透明度 0..1。默认 1.0。 */
  opacity?: number;
  /** 镜面色调 RGB 0..1。默认 [1,1,1](无色调)。 */
  tint?: [number, number, number];
}

/** 镜像相机参数。 */
export interface MirrorCamera {
  eye: Vector3;
  target: Vector3;
  up: Vector3;
}

/**
 * 平面镜面反射器。
 *
 * 提供 CPU 侧反射数学:反射矩阵、镜像相机、斜截投影、纹理矩阵。
 * 实际的 GPU 渲染(把镜像相机视图渲染到纹理)由 WebGL2Renderer 完成,
 * 本类只负责数学计算,可在 Node/无头环境测试。
 */
export class Reflector {
  /** 反射平面(归一化)。 */
  private _plane: Plane;
  /** 反射纹理分辨率。 */
  private _resolution: number;
  /** 不透明度 0..1。 */
  private _opacity: number;
  /** 色调 RGB。 */
  private _tint: [number, number, number];

  /** 反射矩阵缓存。 */
  private _reflectionMatrix: Matrix4;
  /** 斜截投影缓存(每次 setProjection 重新计算)。 */
  private _obliqueProjection: Matrix4;
  /** 纹理矩阵缓存。 */
  private _textureMatrix: Matrix4;

  constructor(opts: ReflectorOptions = {}) {
    this._plane = opts.plane
      ? opts.plane.clone().normalize()
      : new Plane(new Vector3(0, 1, 0), 0);
    this._resolution = opts.resolution ?? 512;
    this._opacity = opts.opacity ?? 1.0;
    this._tint = opts.tint ? [...opts.tint] as [number, number, number] : [1, 1, 1];

    this._reflectionMatrix = new Matrix4();
    this._obliqueProjection = new Matrix4();
    this._textureMatrix = new Matrix4();

    this._updateReflectionMatrix();
  }

  // ── 属性 ──────────────────────────────────────────────────────────

  /** 反射平面(只读视图;修改用 setPlane)。 */
  get plane(): Plane {
    return this._plane;
  }

  /** 反射纹理分辨率。 */
  get resolution(): number {
    return this._resolution;
  }

  /** 不透明度 0..1。 */
  get opacity(): number {
    return this._opacity;
  }

  /** 色调 RGB 0..1。 */
  get tint(): readonly [number, number, number] {
    return this._tint;
  }

  /** 反射矩阵(镜像变换)。点 P 乘此矩阵得到关于平面的镜像 P'。 */
  get reflectionMatrix(): Matrix4 {
    return this._reflectionMatrix;
  }

  /** 斜截投影矩阵(近裁剪面 = 反射平面)。 */
  get obliqueProjection(): Matrix4 {
    return this._obliqueProjection;
  }

  /** 纹理矩阵(world → reflection texture UV)。 */
  get textureMatrix(): Matrix4 {
    return this._textureMatrix;
  }

  // ── 配置 ──────────────────────────────────────────────────────────

  /** 设置反射平面(会被归一化)。 */
  setPlane(plane: Plane): this {
    this._plane.copy(plane).normalize();
    this._updateReflectionMatrix();
    return this;
  }

  /** 设置反射纹理分辨率。 */
  setResolution(res: number): this {
    if (res < 1) res = 1;
    this._resolution = Math.floor(res);
    return this;
  }

  /** 设置不透明度。 */
  setOpacity(opacity: number): this {
    this._opacity = Math.min(1, Math.max(0, opacity));
    return this;
  }

  /** 设置色调。 */
  setTint(r: number, g: number, b: number): this {
    this._tint[0] = r;
    this._tint[1] = g;
    this._tint[2] = b;
    return this;
  }

  // ── 反射数学 ──────────────────────────────────────────────────────

  /**
   * 镜像一个点关于反射平面。
   * P' = P - 2 * (N·P + C) * N
   * @param point 原始点。
   * @param target 写入目标(可选)。
   * @returns 镜像点。
   */
  mirrorPoint(point: Vector3, target: Vector3 = new Vector3()): Vector3 {
    const n = this._plane.normal;
    const c = this._plane.constant;
    // d = N·P + C (到平面的有符号距离)
    const d = n.x * point.x + n.y * point.y + n.z * point.z + c;
    // P' = P - 2d * N
    target.set(
      point.x - 2 * d * n.x,
      point.y - 2 * d * n.y,
      point.z - 2 * d * n.z,
    );
    return target;
  }

  /**
   * 镜像一个方向向量关于反射平面(不平移,只翻转法线分量)。
   * D' = D - 2 * (N·D) * N
   * @param dir 原始方向。
   * @param target 写入目标(可选)。
   * @returns 镜像方向。
   */
  mirrorDirection(dir: Vector3, target: Vector3 = new Vector3()): Vector3 {
    const n = this._plane.normal;
    const d = n.x * dir.x + n.y * dir.y + n.z * dir.z;
    target.set(
      dir.x - 2 * d * n.x,
      dir.y - 2 * d * n.y,
      dir.z - 2 * d * n.z,
    );
    return target;
  }

  /**
   * 镜像相机:把主相机的 eye/target/up 关于反射平面翻转。
   * 注意:up 向量的切线分量翻转,法线分量翻转 → 整体保持右手坐标系
   * (反射后的相机看到的是"镜像世界")。
   *
   * @param eye 相机位置。
   * @param target 相机注视目标。
   * @param up 相机 up 向量。
   * @returns 镜像相机参数(新分配)。
   */
  mirrorCamera(
    eye: Vector3,
    target: Vector3,
    up: Vector3,
  ): MirrorCamera {
    const mirroredEye = this.mirrorPoint(eye);
    const mirroredTarget = this.mirrorPoint(target);
    // up 是方向向量,用 mirrorDirection(不平移)
    const mirroredUp = this.mirrorDirection(up);
    return {
      eye: mirroredEye,
      target: mirroredTarget,
      up: mirroredUp,
    };
  }

  /**
   * 计算斜截投影矩阵:把原投影的近裁剪面替换为反射平面。
   *
   * 算法 (Lengyel):
   *   1. 把反射平面变换到裁剪空间 (plane_clip = (projection^-1)^T · plane_world)
   *   2. 确保 plane_clip 法线 z 分量指向相机前方(flip sign if needed)
   *   3. 构造新的近裁剪面 q = (sign, sign, 1, 1)
   *   4. 修改投影矩阵第 3 行(近裁剪面行)
   *
   * @param projection 原始投影矩阵。
   * @param view 视图矩阵(用于把世界空间平面变换到相机空间)。
   * @returns 斜截投影矩阵(新分配)。
   */
  computeObliqueProjection(
    projection: Matrix4,
    view: Matrix4,
  ): Matrix4 {
    // 把反射平面变换到相机空间(view · plane)
    const n = this._plane.normal;
    const c = this._plane.constant;
    // 相机空间平面: plane_view = (view^T)^-1 · plane_world
    // 等价于 plane_view.normal = view.linear · plane.normal
    //           plane_view.constant = plane.constant - view.linear^T · plane.normal · view.translation
    // 简化:用 view 矩阵的元素直接计算
    const ve = view.elements;
    // view 矩阵的旋转部分 (3x3) 转置
    const r00 = ve[0], r01 = ve[1], r02 = ve[2];
    const r10 = ve[4], r11 = ve[5], r12 = ve[6];
    const r20 = ve[8], r21 = ve[9], r22 = ve[10];
    // 相机空间法线 = view 旋转的逆转置 · 世界法线 (正交矩阵:逆转置 = 旋转本身)
    // view 旋转是正交的,所以 camN = R · worldN
    const camNx = r00 * n.x + r01 * n.y + r02 * n.z;
    const camNy = r10 * n.x + r11 * n.y + r12 * n.z;
    const camNz = r20 * n.x + r21 * n.y + r22 * n.z;
    // 相机空间 constant = worldConstant - camN · translation
    // view 平移 = (ve[12], ve[13], ve[14])
    const camC =
      c - (camNx * ve[12] + camNy * ve[13] + camNz * ve[14]);

    // 把相机空间平面变换到裁剪空间 (projection^T · plane)
    // 裁剪空间平面 = projection 转置 · 相机空间平面
    const pe = projection.elements;
    // clipPlane = (camNx * pe[col0] + camNy * pe[col1] + camNz * pe[col2] + camC * pe[col3])
    // 4 个分量分别对应 x,y,z,w 行
    const clipX = camNx * pe[0] + camNy * pe[4] + camNz * pe[8] + camC * pe[12];
    const clipY = camNx * pe[1] + camNy * pe[5] + camNz * pe[9] + camC * pe[13];
    const clipZ = camNx * pe[2] + camNy * pe[6] + camNz * pe[10] + camC * pe[14];
    const clipW = camNx * pe[3] + camNy * pe[7] + camNz * pe[11] + camC * pe[15];

    // 确保裁剪空间平面法线的 z 分量指向相机前方(> 0)
    // 如果 clipZ < 0,翻转整个平面
    const sign = clipZ > 0 ? 1 : -1;
    const sx = sign * clipX;
    const sy = sign * clipY;
    const sz = sign * clipZ;
    const sw = sign * clipW;

    // 构造新的近裁剪面角点 q
    // q = (sign/sx, sign/sy, 1, 1) — 把裁剪空间角点映射回投影空间
    // 但需要处理 sx/sy 为 0 的情况
    const qx = Math.abs(sx) > 1e-10 ? sign / sx : 0;
    const qy = Math.abs(sy) > 1e-10 ? sign / sy : 0;
    // q.z = 1 (WebGL near plane), q.w = 1
    // 新的近裁剪面 = clipPlane scaled by 2 / (clipPlane · q)
    const dot = sx * qx + sy * qy + sz * 1 + sw * 1;
    if (Math.abs(dot) < 1e-10) {
      // 退化:平面与近裁剪面平行,不修改投影
      return projection.clone();
    }
    const scale = 2 / dot;

    // 修改投影矩阵第 3 行(近裁剪面行):row3 = clipPlane * scale
    const result = projection.clone();
    const re = result.elements;
    // column-major: row 3 = elements[3], [7], [11], [15]
    re[3] = sx * scale;
    re[7] = sy * scale;
    re[11] = sz * scale + 1; // +1 保留原始近裁剪面的 z 映射
    re[15] = sw * scale;
    // 标准做法是 row3 = scale * clipPlane - row3_original
    // 但这里采用 Lengyel 的简化:row3 = scale * clipPlane,然后 z 分量加 1
    // 更精确的做法:
    re[3] = sx * scale - pe[3];
    re[7] = sy * scale - pe[7];
    re[11] = sz * scale - pe[11] + 1; // 保持 far plane 不变
    re[15] = sw * scale - pe[15];

    this._obliqueProjection.copy(result);
    return this._obliqueProjection;
  }

  /**
   * 计算纹理矩阵:world → reflection texture UV。
   * 矩阵 = scaleBias × projection × view_mirror
   * scaleBias 把 NDC [-1,1] 映射到 UV [0,1]。
   *
   * @param projection 镜像相机的投影矩阵。
   * @param viewMirror 镜像相机的视图矩阵。
   * @returns 纹理矩阵(4×4)。
   */
  computeTextureMatrix(
    projection: Matrix4,
    viewMirror: Matrix4,
  ): Matrix4 {
    // scaleBias: NDC [-1,1] → UV [0,1]
    // [0.5  0   0  0.5]
    // [0   0.5  0  0.5]
    // [0   0    0.5 0.5]
    // [0   0    0   1  ]
    const scaleBias = new Matrix4();
    const sb = scaleBias.elements;
    sb[0] = 0.5; sb[5] = 0.5; sb[10] = 0.5;
    sb[12] = 0.5; sb[13] = 0.5; sb[14] = 0.5;

    // textureMatrix = scaleBias × projection × viewMirror
    const pv = new Matrix4().multiplyMatrices(projection, viewMirror);
    this._textureMatrix.multiplyMatrices(scaleBias, pv);
    return this._textureMatrix;
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /** 更新反射矩阵(平面变化时调用)。 */
  private _updateReflectionMatrix(): void {
    const n = this._plane.normal;
    const c = this._plane.constant;
    // 反射矩阵:
    // [1-2xx  -2xy  -2xz  -2xc]
    // [-2yx  1-2yy  -2yz  -2yc]
    // [-2zx  -2zy  1-2zz  -2zc]
    // [0     0     0     1   ]
    const e = this._reflectionMatrix.elements;
    const nx = n.x, ny = n.y, nz = n.z;
    e[0] = 1 - 2 * nx * nx;
    e[1] = -2 * nx * ny;
    e[2] = -2 * nx * nz;
    e[3] = 0;

    e[4] = -2 * nx * ny;
    e[5] = 1 - 2 * ny * ny;
    e[6] = -2 * ny * nz;
    e[7] = 0;

    e[8] = -2 * nx * nz;
    e[9] = -2 * ny * nz;
    e[10] = 1 - 2 * nz * nz;
    e[11] = 0;

    e[12] = -2 * nx * c;
    e[13] = -2 * ny * c;
    e[14] = -2 * nz * c;
    e[15] = 1;
  }
}
