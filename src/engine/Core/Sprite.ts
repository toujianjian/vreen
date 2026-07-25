// Sprite — 始终面向相机的 2D 精灵。
//
// 参考 three.js Sprite.js。继承 Object3D,通过 SpriteMaterial 渲染。
// 与 three.js 的差异:
//   * three.js 的 billboard 朝向计算在 shader 中完成;VREEN 在
//     `updateMatrixWorld(force, camera)` 中由 CPU 直接把相机世界旋转
//     写入 sprite 的 matrixWorld(保留 sprite 自身的 position 与 scale)。
//     这样 raycast / 包围盒 / 场景图遍历都能直接消费 matrixWorld,
//     无需 renderer 在着色器阶段做额外几何变换。
//   * 三角形求交参考 three.js Sprite.raycast:把单位 quad (-0.5..0.5)
//     经 `(vertex - center + 0.5) * scale` 变换到相机空间,可选旋转后
//     加上 modelView 位置再变换回世界空间,对两个三角形求交。
//
// 注意:
//   * `material.rotation` 不影响 matrixWorld(billboard 朝向仍跟随相机);
//     rotation 在 raycast 中用于精确命中,以及在 shader 中用于旋转 UV。
//   * Sprite 不投射阴影(castShadow 无效),与 three.js 一致。

import { Object3D } from './Object3D';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { Vector2 } from '../Math/Vector2';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';
import { Triangle } from '../Math/Triangle';
import { SpriteMaterial } from '../Materials/SpriteMaterial';
import type { Raycaster, Intersection } from './Raycaster';
import type { Camera } from '../Cameras/Camera';

// ── raycast 内部复用的临时变量(避免每次分配) ─────────────────────
const _intersectPoint = new Vector3();
const _worldScale = new Vector3();
const _mvPosition = new Vector3();
const _viewWorldMatrix = new Matrix4();
const _camInverse = new Matrix4();
const _vA = new Vector3();
const _vB = new Vector3();
const _vC = new Vector3();
const _uvA = new Vector2();
const _uvB = new Vector2();
const _uvC = new Vector2();
const _bary = new Vector3();
const _out = new Vector2();

/**
 * 一个 2D 精灵(始终面向相机的 4 顶点 quad)。
 *
 * 典型用法:
 * ```ts
 * const tex = new Texture(...);
 * const mat = new SpriteMaterial({ map: tex });
 * const sprite = new Sprite(mat);
 * sprite.scale.set(1, 1, 1);
 * scene.add(sprite);
 * // 每帧前由调用方:
 * sprite.updateMatrixWorld(true, camera);
 * ```
 */
export class Sprite extends Object3D {
  override readonly type: string = 'Sprite';
  /** 类型标志,用于 duck-type 检测。 */
  isSprite: boolean = true;

  /** 精灵几何体(4 顶点 quad,索引为 2 三角形)。所有 Sprite 实例共享同一结构,
   *  但 BufferGeometry 实例按 Sprite 隔离,便于未来扩展(实例化 / 自定义 UV)。 */
  geometry: BufferGeometry;
  /** 精灵材质。 */
  material: SpriteMaterial;

  /** 锚点:精灵本地 (-0.5..0.5) quad 中,哪个点对应 sprite.position。
   *  (0.5, 0.5) → 居中(默认);(0, 0) → 左下角对齐到 position。 */
  center: Vector2 = new Vector2(0.5, 0.5);

  constructor(material: SpriteMaterial = new SpriteMaterial()) {
    super();
    this.material = material;
    this.geometry = createSpriteGeometry();
  }

  /**
   * 覆盖:先按基类逻辑更新 matrixWorld,然后用相机的世界旋转替换
   * matrixWorld 的旋转部分(保留 sprite 自身的世界位置与 scale),
   * 实现 billboard 朝向相机。
   *
   * @param force  是否强制重算(透传给基类)
   * @param camera 当前帧的相机;不传则与基类行为完全一致(普通 Object3D)
   */
  override updateMatrixWorld(force: boolean = false, camera?: Camera): void {
    super.updateMatrixWorld(force);
    if (!camera) return;

    const myE = this.matrixWorld.elements;
    // 提取当前 matrixWorld 的 scale(列向量长度)。
    const sx = Math.hypot(myE[0], myE[1], myE[2]);
    const sy = Math.hypot(myE[4], myE[5], myE[6]);
    const sz = Math.hypot(myE[8], myE[9], myE[10]);

    // 取相机的世界旋转(3x3 部分),写入 matrixWorld,保留 scale。
    const camE = camera.matrixWorld.elements;
    myE[0] = camE[0] * sx;
    myE[1] = camE[1] * sx;
    myE[2] = camE[2] * sx;
    myE[4] = camE[4] * sy;
    myE[5] = camE[5] * sy;
    myE[6] = camE[6] * sy;
    myE[8] = camE[8] * sz;
    myE[9] = camE[9] * sz;
    myE[10] = camE[10] * sz;
    // 平移列 (e[12..14]) 不变,保持 sprite 世界位置。
  }

  /**
   * 射线检测:把单位 quad 的 4 个顶点变换到世界空间,对 2 个三角形求交。
   *
   * 实现参考 three.js Sprite.raycast:
   *   1. worldScale = matrixWorld 的列长度
   *   2. mvPosition = this.position 在相机本地空间的坐标
   *   3. 透视相机 + sizeAttenuation=false 时,scale *= -mvPosition.z
   *   4. 对每个顶点 v ∈ {(-0.5,-0.5),(0.5,-0.5),(0.5,0.5),(-0.5,0.5)}:
   *      aligned = (v - center + 0.5) * worldScale
   *      rotated = (cos * aligned.x - sin * aligned.y, sin * aligned.x + cos * aligned.y)
   *      world   = viewWorldMatrix * (mvPosition + (rotated.x, rotated.y, 0))
   *   5. 对三角形 (v0,v1,v2) 与 (v0,v2,v3) 求交
   *
   * 调用前需保证 raycaster.camera 已设置(setFromCamera 会设置)。
   */
  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    if (raycaster.camera === null) {
      console.warn('Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.');
      return;
    }

    const cam = raycaster.camera as Camera & { isPerspectiveCamera?: boolean };

    // worldScale = matrixWorld 的列向量长度。
    const me = this.matrixWorld.elements;
    _worldScale.set(
      Math.hypot(me[0], me[1], me[2]),
      Math.hypot(me[4], me[5], me[6]),
      Math.hypot(me[8], me[9], me[10]),
    );

    // viewWorldMatrix = camera.matrixWorld (世界→相机反向变换的逆 = 相机→世界)
    _viewWorldMatrix.copy(cam.matrixWorld);

    // modelView 位置:把 sprite 世界位置(matrixWorld 的平移列)变到相机本地空间。
    _camInverse.getInverse(cam.matrixWorld);
    const me2 = this.matrixWorld.elements;
    _mvPosition.set(me2[12], me2[13], me2[14]).applyMatrix4(_camInverse);

    // sizeAttenuation=false 时,透视相机下的 sprite 不随距离缩小,
    // 而是按 -mvPosition.z 等比放大(在屏幕上保持固定像素大小)。
    if (cam.isPerspectiveCamera && this.material.sizeAttenuation === false) {
      _worldScale.multiplyScalar(-_mvPosition.z);
    }

    // 旋转(材质级,不影响 matrixWorld 朝向)。
    const rotation = this.material.rotation;
    let sin: number | undefined;
    let cos: number | undefined;
    if (rotation !== 0) {
      cos = Math.cos(rotation);
      sin = Math.sin(rotation);
    }

    const cx = this.center.x;
    const cy = this.center.y;
    const sx = _worldScale.x;
    const sy = _worldScale.y;

    // 第一个三角形:vA=(-0.5,-0.5), vB=(0.5,-0.5), vC=(0.5,0.5)
    _vA.set(-0.5, -0.5, 0);
    _vB.set(0.5, -0.5, 0);
    _vC.set(0.5, 0.5, 0);
    transformVertex(_vA, _mvPosition, cx, cy, sx, sy, sin, cos, _viewWorldMatrix);
    transformVertex(_vB, _mvPosition, cx, cy, sx, sy, sin, cos, _viewWorldMatrix);
    transformVertex(_vC, _mvPosition, cx, cy, sx, sy, sin, cos, _viewWorldMatrix);

    _uvA.set(0, 0);
    _uvB.set(1, 0);
    _uvC.set(1, 1);

    let hit = raycaster.ray.intersectTriangle(_vA, _vB, _vC, false, _intersectPoint);

    if (hit === null) {
      // 第二个三角形:vA=(-0.5,-0.5), vB=(-0.5,0.5), vC=(0.5,0.5)
      _vB.set(-0.5, 0.5, 0);
      transformVertex(_vB, _mvPosition, cx, cy, sx, sy, sin, cos, _viewWorldMatrix);
      _uvB.set(0, 1);

      hit = raycaster.ray.intersectTriangle(_vA, _vC, _vB, false, _intersectPoint);
      if (hit === null) {
        return;
      }
    }

    const distance = raycaster.ray.origin.distanceTo(_intersectPoint);
    if (distance < raycaster.near || distance > raycaster.far) return;

    // 重心坐标插值 UV(参考 three.js Triangle.getInterpolation,
    //  VREEN Triangle 没有该方法,这里基于 getBarycoord 内联)。
    const uv = interpolateUV(_intersectPoint, _vA, _vB, _vC, _uvA, _uvB, _uvC, _bary, _out);

    intersects.push({
      distance,
      point: _intersectPoint.clone(),
      uv,
      object: this,
    });
  }
}

/** 把单位 quad 的顶点 (vx, vy, 0) 变换到世界空间。
 *  aligned = (v.xy - center + 0.5) * scale
 *  rotated = R(rotation) * aligned
 *  world   = viewWorldMatrix * (mvPosition + (rotated.x, rotated.y, 0)) */
function transformVertex(
  vertexPosition: Vector3,
  mvPosition: Vector3,
  centerX: number,
  centerY: number,
  scaleX: number,
  scaleY: number,
  sin: number | undefined,
  cos: number | undefined,
  viewWorldMatrix: Matrix4,
): void {
  // aligned position in camera space
  const ax = (vertexPosition.x - centerX + 0.5) * scaleX;
  const ay = (vertexPosition.y - centerY + 0.5) * scaleY;

  let rx: number;
  let ry: number;
  if (sin !== undefined && cos !== undefined) {
    rx = cos * ax - sin * ay;
    ry = sin * ax + cos * ay;
  } else {
    rx = ax;
    ry = ay;
  }

  // 把顶点放到 mvPosition + rotated offset,再变换到世界空间。
  vertexPosition.copy(mvPosition);
  vertexPosition.x += rx;
  vertexPosition.y += ry;
  vertexPosition.applyMatrix4(viewWorldMatrix);
}

/** 用重心坐标对 UV 做双线性插值。退化三角形返回 (0,0)。 */
function interpolateUV(
  point: Vector3,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  uvA: Vector2,
  uvB: Vector2,
  uvC: Vector2,
  bary: Vector3,
  out: Vector2,
): Vector2 {
  const r = Triangle.getBarycoord(point, a, b, c, bary);
  if (r === null) {
    return out.set(0, 0);
  }
  // bary = (1-u-v, v, u) → uv = bary.x * uvA + bary.y * uvB + bary.z * uvC
  return out.set(
    uvA.x * bary.x + uvB.x * bary.y + uvC.x * bary.z,
    uvA.y * bary.x + uvB.y * bary.y + uvC.y * bary.z,
  );
}

/** 构造一个 4 顶点 quad 几何体(单位 -0.5..0.5),供 Sprite 渲染与 raycast 复用。 */
function createSpriteGeometry(): BufferGeometry {
  const geo = new BufferGeometry();
  // position(xyz) + uv(uv) 交错布局,与 three.js Sprite 共享 geometry 一致。
  const data = new Float32Array([
    -0.5, -0.5, 0, 0, 0,
    0.5, -0.5, 0, 1, 0,
    0.5, 0.5, 0, 1, 1,
    -0.5, 0.5, 0, 0, 1,
  ]);
  // 拆为两个独立 BufferAttribute,与引擎其他几何体风格一致。
  const position = new Float32Array(12);
  const uv = new Float32Array(8);
  for (let i = 0; i < 4; i++) {
    position[i * 3 + 0] = data[i * 5 + 0];
    position[i * 3 + 1] = data[i * 5 + 1];
    position[i * 3 + 2] = data[i * 5 + 2];
    uv[i * 2 + 0] = data[i * 5 + 3];
    uv[i * 2 + 1] = data[i * 5 + 4];
  }
  geo.setAttribute('position', new BufferAttribute(position, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}
