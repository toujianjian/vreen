// TransformControls — 场景内物体的 gizmo 变换器(平移 / 旋转 / 缩放)。
//
// 适配 three.js TransformControls.js + o3de 编辑器视口 gizmo 交互范式。
//
// 核心思路:
//   1. attach(object) 把 gizmo 锚定到一个 Object3D。gizmo 是一棵 Object3D
//      子树(getHelper() 返回根,用户把它加进 scene),由 update()
//      对齐到物体的世界位姿,并根据相机距离自动缩放,保证屏幕上恒定大小。
//   2. 鼠标悬停时用 Raycaster 对 picker 子树(不可见但可命中)求交,命中的
//      mesh.name 即为当前激活轴('X'/'Y'/'Z'/'XY'/'YZ'/'XZ'/'XYZ'/'E'/'XYZE')。
//   3. 按下后构建一个"拖拽平面"——以激活轴为法线、过物体世界中心的数学 Plane,
//      把相机射线投射到该平面得到拖拽点。pointerMove 时算 pointStart→pointEnd
//      的世界增量,再按轴/空间投影到物体的本地 position / rotation / scale。
//   4. releasePointerCapture + dispose 解绑所有事件,避免泄漏。
//
// 与 three.js 的关键适配差异:
//   - VREEN 的 Object3D.rotation 字段就是 Quaternion(three.js 是 Euler +
//     独立 quaternion 字段)。本文件一律用 object.rotation 表示旋转,
//     不引用 object.quaternion。
//   - 变换数学抽成纯函数 computeTranslate / computeRotate / computeScale /
//     buildDragPlane,无 DOM / WebGL 依赖,可在 Node 环境直接单元测试。
//   - gizmo 几何用 VREEN 的 BoxGeometry / CylinderGeometry / TorusGeometry /
//     SphereGeometry / PlaneGeometry + MeshBasicMaterial;picker 子树
//     visible=false 但仍参与 raycast(Mesh.raycast 不检查 visible)。
//   - 拖拽平面用数学 Plane + Ray.intersectPlane,不再依赖一个超大 plane mesh。
//
// 三种模式 × 两种空间:
//   translate: X / Y / Z / XY / YZ / XZ / XYZ    空间 world | local
//   rotate:    X / Y / Z / E(视向) / XYZE(轨道) 空间 world | local
//   scale:     X / Y / Z / XY / YZ / XZ / XYZ    空间强制 local(沿物体本地轴)
//
// 吸附(snap):
//   translationSnap(世界单位)/ rotationSnap(弧度)/ scaleSnap(倍数),
//   null 表示连续拖拽。吸附在本地空间内取整后再转回世界应用,与 three.js 一致。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { Plane } from '../Math/Plane';
import { Raycaster } from '../Core/Raycaster';
import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { CylinderGeometry } from '../Geometries/CylinderGeometry';
import { TorusGeometry } from '../Geometries/TorusGeometry';
import { SphereGeometry } from '../Geometries/SphereGeometry';
import type { Camera } from '../Cameras/Camera';

// ── 类型 ──────────────────────────────────────────────────────────

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'world' | 'local';

/** 所有合法的轴标识。 */
export type TransformAxis =
  | 'X' | 'Y' | 'Z'
  | 'XY' | 'YZ' | 'XZ'
  | 'XYZ' | 'E' | 'XYZE';

export interface TransformControlsOptions {
  /** 初始模式。默认 'translate'。 */
  mode?: TransformMode;
  /** 初始空间。默认 'world'。scale 模式下强制 'local'。 */
  space?: TransformSpace;
  /** gizmo 屏幕大小因子。默认 1。 */
  size?: number;
  /** 平移吸附步长(世界单位)。null = 连续。默认 null。 */
  translationSnap?: number | null;
  /** 旋转吸附步长(弧度)。null = 连续。默认 null。 */
  rotationSnap?: number | null;
  /** 缩放吸附步长(倍数)。null = 连续。默认 null。 */
  scaleSnap?: number | null;
  /** 是否在按下时阻止浏览器默认手势(contextmenu / touch-scroll)。默认 true。 */
  preventDefaultGestures?: boolean;
  /** 平移最小/最大本地坐标限制。默认 ±Infinity。 */
  minX?: number; maxX?: number;
  minY?: number; maxY?: number;
  minZ?: number; maxZ?: number;
  /** 是否允许悬停时改变 axis(关闭则只能通过点击命中)。默认 true。 */
  enableHover?: boolean;
}

/** 颜色配置(setColors 用)。RGB 0..1。 */
export interface TransformColors {
  xAxis: { r: number; g: number; b: number };
  yAxis: { r: number; g: number; b: number };
  zAxis: { r: number; g: number; b: number };
  active: { r: number; g: number; b: number };
}

// ── 临时复用变量(避免每帧 new) ───────────────────────────────────

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _offset = new Vector3();
const _startNorm = new Vector3();
const _endNorm = new Vector3();
const _tempQ = new Quaternion();
const _unitX = new Vector3(1, 0, 0);
const _unitY = new Vector3(0, 1, 0);
const _unitZ = new Vector3(0, 0, 1);
const _identityQ = new Quaternion();
const _raycaster = new Raycaster();
const _dragPlane = new Plane();
const _planeHit = new Vector3();

// ── 纯数学函数(无 DOM / WebGL 依赖,可直接单测) ─────────────────

/**
 * 计算拖拽平面的法线。平面过 worldPosition,法线方向由 axis + mode + space 决定:
 *   - 单轴平移/缩放(X/Y/Z):平面包含该轴且面向相机。法线 = axisDir × (eye × axisDir)
 *     的归一化,使平面在屏幕上呈现为一条沿 axis 的线段,鼠标横向移动产生最大位移。
 *   - 双轴平面(XY/YZ/XZ):法线 = 该平面法线(XY→Z, YZ→X, XZ→Y)。
 *   - XYZ/E(平移):平面平行相机,法线 = eyeDir。
 *   - rotate:始终平行相机(法线 = eyeDir),绕视向旋转。
 *
 * @param axis         当前激活轴
 * @param mode         变换模式
 * @param space        坐标空间(scale 强制 local)
 * @param eyeDir       相机→物体的视向(归一化)
 * @param worldPos     物体当前世界位置(平面过此点)
 * @param worldQuat    物体当前世界旋转(local 空间时轴方向需用它变换)
 * @param target       写入结果的 Plane(normal + constant)
 */
export function buildDragPlane(
  axis: TransformAxis,
  mode: TransformMode,
  space: TransformSpace,
  eyeDir: Vector3,
  worldPos: Vector3,
  worldQuat: Quaternion,
  target: Plane,
): Plane {
  const localSpace = space === 'local' || mode === 'scale';

  // 三个轴方向(local 空间下用 worldQuaternion 变换)
  const ax = _v1.copy(_unitX);
  const ay = _v2.copy(_unitY);
  const az = _v3.copy(_unitZ);
  if (localSpace) {
    ax.applyQuaternion(worldQuat);
    ay.applyQuaternion(worldQuat);
    az.applyQuaternion(worldQuat);
  }

  let normal: Vector3;

  switch (mode) {
    case 'translate':
    case 'scale': {
      switch (axis) {
        case 'X':
          // alignVec = eye × X; normal = X × alignVec → 平面包含 X 且面向相机
          _offset.copy(eyeDir).cross(ax);
          normal = ax.clone().cross(_offset);
          break;
        case 'Y':
          _offset.copy(eyeDir).cross(ay);
          normal = ay.clone().cross(_offset);
          break;
        case 'Z':
          _offset.copy(eyeDir).cross(az);
          normal = az.clone().cross(_offset);
          break;
        case 'XY':
          normal = az; // 法线 = Z
          break;
        case 'YZ':
          normal = ax; // 法线 = X
          break;
        case 'XZ':
          normal = ay; // 法线 = Y
          break;
        case 'XYZ':
        case 'E':
        default:
          normal = eyeDir;
          break;
      }
      break;
    }
    case 'rotate':
    default:
      normal = eyeDir;
      break;
  }

  if (normal.lengthSq() === 0) {
    normal = eyeDir;
  }
  normal.normalize();
  target.setFromNormalAndCoplanarPoint(normal, worldPos);
  return target;
}

/** computeTranslate 的输入上下文。所有向量在调用期间不被修改。 */
export interface TranslateContext {
  axis: TransformAxis;
  space: TransformSpace;
  /** 拖拽起点(拖拽平面上的世界交点 - worldPositionStart)。 */
  pointStart: Vector3;
  /** 拖拽当前点(拖拽平面上的世界交点 - worldPositionStart)。 */
  pointEnd: Vector3;
  /** 物体拖拽开始时的世界旋转的逆。 */
  worldQuaternionInv: Quaternion;
  /** 物体拖拽开始时的本地旋转。 */
  quaternionStart: Quaternion;
  /** 父节点世界旋转的逆。 */
  parentQuaternionInv: Quaternion;
  /** 父节点世界缩放。 */
  parentScale: Vector3;
  /** 物体拖拽开始时的本地位置(结果 = positionStart + offset)。 */
  positionStart: Vector3;
  /** 平移吸附步长(null = 连续)。 */
  translationSnap: number | null;
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

/**
 * 平移数学(纯函数)。返回写入 target 的本地位置。
 * 算法 1:1 对齐 three.js TransformControls.pointerMove 的 translate 分支:
 *   offset = pointEnd - pointStart
 *   若 local 且非 XYZ:offset 先用 worldQuaternionInv 转到本地
 *   按 axis 屏蔽分量(X/Y/Z)
 *   若 local:offset 用 quaternionStart 转回世界,再除 parentScale
 *   否则:offset 用 parentQuaternionInv 转回父空间,再除 parentScale
 *   position = positionStart + offset
 *   吸附:local 下转到本地取整再转回;world 下对本地坐标取整
 *   钳制到 [min,max]
 */
export function computeTranslate(ctx: TranslateContext, target: Vector3): Vector3 {
  const { axis, pointStart, pointEnd, worldQuaternionInv, quaternionStart,
    parentQuaternionInv, parentScale, positionStart, translationSnap } = ctx;

  let space = ctx.space;
  if (axis === 'XYZ') space = 'world'; // XYZ 始终世界自由平移

  _offset.copy(pointEnd).sub(pointStart);

  if (space === 'local' && axis !== 'XYZ') {
    _offset.applyQuaternion(worldQuaternionInv);
  }

  // 按 axis 屏蔽分量
  if (axis.indexOf('X') === -1) _offset.x = 0;
  if (axis.indexOf('Y') === -1) _offset.y = 0;
  if (axis.indexOf('Z') === -1) _offset.z = 0;

  if (space === 'local' && axis !== 'XYZ') {
    _offset.applyQuaternion(quaternionStart).divide(parentScale);
  } else {
    _offset.applyQuaternion(parentQuaternionInv).divide(parentScale);
  }

  target.copy(_offset).add(positionStart);

  // 吸附
  if (translationSnap) {
    if (space === 'local') {
      target.applyQuaternion(_tempQ.copy(quaternionStart).invert());
      if (axis.indexOf('X') !== -1)
        target.x = Math.round(target.x / translationSnap) * translationSnap;
      if (axis.indexOf('Y') !== -1)
        target.y = Math.round(target.y / translationSnap) * translationSnap;
      if (axis.indexOf('Z') !== -1)
        target.z = Math.round(target.z / translationSnap) * translationSnap;
      target.applyQuaternion(quaternionStart);
    } else {
      // world 空间吸附:three.js 用 object.parent.worldToLocal 转换。
      // 纯函数无 parent.matrixWorld,这里对本地坐标取整——当父节点在原点
      // 无旋转无缩放时与世界空间取整等价(编辑器常见场景)。
      if (axis.indexOf('X') !== -1)
        target.x = Math.round(target.x / translationSnap) * translationSnap;
      if (axis.indexOf('Y') !== -1)
        target.y = Math.round(target.y / translationSnap) * translationSnap;
      if (axis.indexOf('Z') !== -1)
        target.z = Math.round(target.z / translationSnap) * translationSnap;
    }
  }

  // 钳制(本地坐标)
  target.x = Math.max(ctx.minX, Math.min(ctx.maxX, target.x));
  target.y = Math.max(ctx.minY, Math.min(ctx.maxY, target.y));
  target.z = Math.max(ctx.minZ, Math.min(ctx.maxZ, target.z));

  return target;
}

/** computeScale 的输入上下文。 */
export interface ScaleContext {
  axis: TransformAxis;
  pointStart: Vector3;
  pointEnd: Vector3;
  /** 物体拖拽开始时的世界旋转的逆。 */
  worldQuaternionInv: Quaternion;
  /** 物体拖拽开始时的本地缩放。 */
  scaleStart: Vector3;
  /** 缩放吸附步长(null = 连续)。 */
  scaleSnap: number | null;
}

/**
 * 缩放数学(纯函数)。返回写入 target 的本地缩放。
 * 算法对齐 three.js scale 分支:
 *   XYZ: d = |pointEnd| / |pointStart|,方向相反则取负;scale = scaleStart * d(三轴)
 *   单/双轴:把 start/end 用 worldQuaternionInv 转本地,end.divide(start),
 *   屏蔽非激活轴为 1,scale = scaleStart * ratio
 *   吸附:每轴 round(scale/snap)*snap || snap
 */
export function computeScale(ctx: ScaleContext, target: Vector3): Vector3 {
  const { axis, pointStart, pointEnd, worldQuaternionInv, scaleStart, scaleSnap } = ctx;

  if (axis.indexOf('XYZ') !== -1) {
    let d = pointEnd.length() / (pointStart.length() || 1e-10);
    if (pointEnd.dot(pointStart) < 0) d *= -1;
    target.set(d, d, d).multiply(scaleStart);
  } else {
    _v1.copy(pointStart);
    _v2.copy(pointEnd);
    _v1.applyQuaternion(worldQuaternionInv);
    _v2.applyQuaternion(worldQuaternionInv);
    _v2.divide(_v1);
    if (axis.indexOf('X') === -1) _v2.x = 1;
    if (axis.indexOf('Y') === -1) _v2.y = 1;
    if (axis.indexOf('Z') === -1) _v2.z = 1;
    target.copy(scaleStart).multiply(_v2);
  }

  if (scaleSnap) {
    if (axis.indexOf('X') !== -1)
      target.x = Math.round(target.x / scaleSnap) * scaleSnap || scaleSnap;
    if (axis.indexOf('Y') !== -1)
      target.y = Math.round(target.y / scaleSnap) * scaleSnap || scaleSnap;
    if (axis.indexOf('Z') !== -1)
      target.z = Math.round(target.z / scaleSnap) * scaleSnap || scaleSnap;
  }

  return target;
}

/** computeRotate 的输入上下文。 */
export interface RotateContext {
  axis: TransformAxis;
  space: TransformSpace;
  /** 拖拽起点(平面交点 - worldPositionStart)。 */
  pointStart: Vector3;
  /** 拖拽当前点。 */
  pointEnd: Vector3;
  /** 拖拽增量(pointEnd - pointStart)。 */
  offset: Vector3;
  /** 相机视向(归一化,从物体指向相机)。 */
  eye: Vector3;
  /** 物体拖拽开始时的世界位置(算旋转速度用)。 */
  worldPosition: Vector3;
  /** 相机世界位置(算旋转速度用)。 */
  cameraPosition: Vector3;
  /** 物体拖拽开始时的世界旋转。 */
  worldQuaternion: Quaternion;
  /** 父节点世界旋转的逆。 */
  parentQuaternionInv: Quaternion;
  /** 物体拖拽开始时的本地旋转。 */
  quaternionStart: Quaternion;
  /** 旋转吸附步长(弧度,null = 连续)。 */
  rotationSnap: number | null;
}

/** 旋转结果:写入 target 的本地四元数。返回 rotationAxis 与 rotationAngle 供调试。 */
export interface RotateResult {
  rotationAxis: Vector3;
  rotationAngle: number;
}

/**
 * 旋转数学(纯函数)。把结果四元数写入 target,并返回 { rotationAxis, rotationAngle }。
 * 算法对齐 three.js rotate 分支:
 *   XYZE: rotationAxis = offset × eye(归一化);angle = offset · (axis × eye) * SPEED
 *   X/Y/Z: axisDir = unit[axis];local 下用 worldQuaternion 变换;
 *          crossEye = axisDir × eye;若为 0(平行)→ in-plane 旋转;
 *          否则 angle = offset · crossEye.normalize() * SPEED
 *   E / in-plane: rotationAxis = eye;angle = pointEnd.angleTo(pointStart),
 *                 方向由 endNorm × startNorm · eye 的符号决定
 *   吸附:angle = round(angle / snap) * snap
 *   应用:local 且非 E/XYZE:target = quaternionStart * setFromAxisAngle(axis, angle)
 *         否则:axis 用 parentQuaternionInv 转换;target = setFromAxisAngle(axis, angle) * quaternionStart
 *   SPEED = 20 / distance(worldPosition, cameraPosition)
 */
export function computeRotate(
  ctx: RotateContext,
  target: Quaternion,
  out: RotateResult,
): RotateResult {
  const { axis, pointStart, pointEnd, offset, eye, worldPosition,
    cameraPosition, worldQuaternion, parentQuaternionInv, quaternionStart,
    rotationSnap } = ctx;

  let space = ctx.space;
  if (axis === 'E' || axis === 'XYZE' || axis === 'XYZ') space = 'world';

  const rotationAxis = out.rotationAxis;
  let rotationAngle = 0;
  let inPlaneRotation = false;

  const SPEED = 20 / (worldPosition.distanceTo(cameraPosition) || 1e-10);

  if (axis === 'XYZE') {
    rotationAxis.copy(offset).cross(eye).normalize();
    rotationAngle = offset.dot(_v1.copy(rotationAxis).cross(eye)) * SPEED;
  } else if (axis === 'X' || axis === 'Y' || axis === 'Z') {
    const unit = axis === 'X' ? _unitX : axis === 'Y' ? _unitY : _unitZ;
    rotationAxis.copy(unit);
    _v1.copy(unit);
    if (space === 'local') _v1.applyQuaternion(worldQuaternion);
    _v1.cross(eye);
    if (_v1.length() === 0) {
      inPlaneRotation = true;
    } else {
      rotationAngle = offset.dot(_v1.normalize()) * SPEED;
    }
  }

  if (axis === 'E' || inPlaneRotation) {
    rotationAxis.copy(eye);
    rotationAngle = pointEnd.angleTo(pointStart);
    _startNorm.copy(pointStart).normalize();
    _endNorm.copy(pointEnd).normalize();
    rotationAngle *= _endNorm.cross(_startNorm).dot(eye) < 0 ? 1 : -1;
  }

  if (rotationSnap) rotationAngle = Math.round(rotationAngle / rotationSnap) * rotationSnap;

  if (space === 'local' && axis !== 'E' && axis !== 'XYZE') {
    target.copy(quaternionStart);
    target.multiply(_tempQ.setFromAxisAngle(rotationAxis, rotationAngle)).normalize();
  } else {
    rotationAxis.applyQuaternion(parentQuaternionInv);
    target.copy(_tempQ.setFromAxisAngle(rotationAxis, rotationAngle));
    target.multiply(quaternionStart).normalize();
  }

  out.rotationAngle = rotationAngle;
  return out;
}

// ── gizmo 几何构建 ────────────────────────────────────────────────

/** 在 VREEN 中 BufferGeometry 没有 translate 方法,这里用顶点位移实现。 */
function bakeTranslate(geo: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  const pos = geo.attributes.position;
  if (pos) {
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += x;
      arr[i + 1] += y;
      arr[i + 2] += z;
    }
    pos.version++;
  }
  return geo;
}

/** 默认颜色(RGB 0..1)。 */
const DEFAULT_COLORS: TransformColors = {
  xAxis: { r: 1, g: 0.2, b: 0.2 },
  yAxis: { r: 0.2, g: 1, b: 0.2 },
  zAxis: { r: 0.2, g: 0.4, b: 1 },
  active: { r: 1, g: 1, b: 0.2 },
};

/** XYZ 欧拉(顺序 XYZ)→ 四元数。 */
function eulerToQuaternion(rx: number, ry: number, rz: number, out: Quaternion): Quaternion {
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  out.x = sx * cy * cz + cx * sy * sz;
  out.y = cx * sy * cz - sx * cy * sz;
  out.z = cx * cy * sz + sx * sy * cz;
  out.w = cx * cy * cz - sx * sy * sz;
  return out;
}

/** 对几何体顶点做四元数旋转。 */
function rotateGeometry(g: BufferGeometry, q: Quaternion): BufferGeometry {
  const pos = g.attributes.position;
  if (!pos) return g;
  const arr = pos.array as Float32Array;
  const v = new Vector3();
  for (let i = 0; i < arr.length; i += 3) {
    v.set(arr[i], arr[i + 1], arr[i + 2]).applyQuaternion(q);
    arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
  }
  const nrm = g.attributes.normal;
  if (nrm) {
    const na = nrm.array as Float32Array;
    for (let i = 0; i < na.length; i += 3) {
      v.set(na[i], na[i + 1], na[i + 2]).applyQuaternion(q);
      na[i] = v.x; na[i + 1] = v.y; na[i + 2] = v.z;
    }
    nrm.version++;
  }
  pos.version++;
  return g;
}

/** 构建一个不可见但可 raycast 的 mesh。 */
function invisibleMesh(geo: BufferGeometry): Mesh {
  const mat = new MeshBasicMaterial({
    color: { r: 0, g: 0, b: 0 },
    opacity: 0,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return new Mesh(geo, mat);
}

/** 构建一个可见 gizmo mesh。 */
function gizmoMesh(geo: BufferGeometry, color: { r: number; g: number; b: number }, opacity = 1): Mesh {
  const mat = new MeshBasicMaterial({
    color: { ...color },
    opacity,
    transparent: opacity < 1,
    depthTest: false,
    depthWrite: false,
  });
  return new Mesh(geo, mat);
}

/** 把 [mesh, position, rotationEuler] 应用为 mesh 的本地变换(永久基础变换)。 */
function place(mesh: Mesh,
               position?: [number, number, number],
               rotation?: [number, number, number]): Mesh {
  if (position) mesh.position.set(position[0], position[1], position[2]);
  if (rotation) {
    const q = new Quaternion();
    eulerToQuaternion(rotation[0], rotation[1], rotation[2], q);
    mesh.rotation.copy(q);
  }
  return mesh;
}

/** 圆环(torus)用于 rotate gizmo,绕指定轴对齐。 */
function circleGeometry(radius: number, arc: number, tube = 0.0075): TorusGeometry {
  // three.js: TorusGeometry(radius, 0.0075, 3, 64, arc*2π),再 rotateY(π/2).rotateX(π/2)
  const g = new TorusGeometry(radius, tube, 3, 64, arc * Math.PI * 2);
  const q = new Quaternion();
  // 组合 rotateY(π/2) 再 rotateX(π/2):q = Qx(π/2) * Qy(π/2)
  const qx = new Quaternion().setFromAxisAngle(_unitX, Math.PI / 2);
  const qy = new Quaternion().setFromAxisAngle(_unitY, Math.PI / 2);
  q.copy(qx).multiply(qy);
  rotateGeometry(g, q);
  return g;
}

/** arrow:圆锥,沿 +Y 朝上,尖端在 y=+0.1。 */
function makeArrowGeometry(): BufferGeometry {
  const cone = new CylinderGeometry(0, 0.04, 0.1, 12);
  bakeTranslate(cone, 0, 0.05, 0);
  return cone;
}

/** 短杆:细圆柱,沿 Y,长 0.5,中心在 y=0.25。 */
function makeShaftGeometry(): BufferGeometry {
  const shaft = new CylinderGeometry(0.0075, 0.0075, 0.5, 3);
  bakeTranslate(shaft, 0, 0.25, 0);
  return shaft;
}

/** scale 立方体手柄,沿 +Y,中心在 y=0.04。 */
function makeScaleHandleGeometry(): BufferGeometry {
  const box = new BoxGeometry(0.08, 0.08, 0.08);
  bakeTranslate(box, 0, 0.04, 0);
  return box;
}

/** 平移 gizmo 的可见手柄定义。 */
function buildTranslateGizmo(colors: TransformColors): Record<string, Mesh[]> {
  const arrow = makeArrowGeometry();
  const shaft = makeShaftGeometry();
  return {
    X: [
      place(gizmoMesh(arrow, colors.xAxis), [0.5, 0, 0], [0, 0, -Math.PI / 2]),
      place(gizmoMesh(arrow.clone(), colors.xAxis), [-0.5, 0, 0], [0, 0, Math.PI / 2]),
      place(gizmoMesh(shaft, colors.xAxis), [0, 0, 0], [0, 0, -Math.PI / 2]),
    ],
    Y: [
      place(gizmoMesh(arrow.clone(), colors.yAxis), [0, 0.5, 0]),
      place(gizmoMesh(arrow.clone(), colors.yAxis), [0, -0.5, 0], [Math.PI, 0, 0]),
      place(gizmoMesh(shaft.clone(), colors.yAxis)),
    ],
    Z: [
      place(gizmoMesh(arrow.clone(), colors.zAxis), [0, 0, 0.5], [Math.PI / 2, 0, 0]),
      place(gizmoMesh(arrow.clone(), colors.zAxis), [0, 0, -0.5], [-Math.PI / 2, 0, 0]),
      place(gizmoMesh(shaft.clone(), colors.zAxis), [0, 0, 0], [Math.PI / 2, 0, 0]),
    ],
    XYZ: [
      place(gizmoMesh(new SphereGeometry(0.1, 12, 8), { r: 1, g: 1, b: 1 }, 0.25)),
    ],
    XY: [
      place(gizmoMesh(new BoxGeometry(0.15, 0.15, 0.01), colors.zAxis, 0.5), [0.15, 0.15, 0]),
    ],
    YZ: [
      place(gizmoMesh(new BoxGeometry(0.15, 0.15, 0.01), colors.xAxis, 0.5), [0, 0.15, 0.15], [0, Math.PI / 2, 0]),
    ],
    XZ: [
      place(gizmoMesh(new BoxGeometry(0.15, 0.15, 0.01), colors.yAxis, 0.5), [0.15, 0, 0.15], [-Math.PI / 2, 0, 0]),
    ],
  };
}

/** 平移 picker(不可见,大命中区)。 */
function buildTranslatePicker(): Record<string, Mesh[]> {
  const cyl = (): BufferGeometry => new CylinderGeometry(0.2, 0, 0.6, 4);
  return {
    X: [
      place(invisibleMesh(cyl()), [0.3, 0, 0], [0, 0, -Math.PI / 2]),
      place(invisibleMesh(cyl()), [-0.3, 0, 0], [0, 0, Math.PI / 2]),
    ],
    Y: [
      place(invisibleMesh(cyl()), [0, 0.3, 0]),
      place(invisibleMesh(cyl()), [0, -0.3, 0], [0, 0, Math.PI]),
    ],
    Z: [
      place(invisibleMesh(cyl()), [0, 0, 0.3], [Math.PI / 2, 0, 0]),
      place(invisibleMesh(cyl()), [0, 0, -0.3], [-Math.PI / 2, 0, 0]),
    ],
    XYZ: [
      place(invisibleMesh(new SphereGeometry(0.2, 12, 8))),
    ],
    XY: [
      place(invisibleMesh(new BoxGeometry(0.2, 0.2, 0.01)), [0.15, 0.15, 0]),
    ],
    YZ: [
      place(invisibleMesh(new BoxGeometry(0.2, 0.2, 0.01)), [0, 0.15, 0.15], [0, Math.PI / 2, 0]),
    ],
    XZ: [
      place(invisibleMesh(new BoxGeometry(0.2, 0.2, 0.01)), [0.15, 0, 0.15], [-Math.PI / 2, 0, 0]),
    ],
  };
}

/** 旋转 gizmo(彩色圆环)。 */
function buildRotateGizmo(colors: TransformColors): Record<string, Mesh[]> {
  const gray = { r: 0.47, g: 0.47, b: 0.47 };
  return {
    XYZE: [
      place(gizmoMesh(circleGeometry(0.5, 1), gray), [0, 0, 0], [0, Math.PI / 2, 0]),
    ],
    X: [
      place(gizmoMesh(circleGeometry(0.5, 0.5), colors.xAxis)),
    ],
    Y: [
      place(gizmoMesh(circleGeometry(0.5, 0.5), colors.yAxis), [0, 0, 0], [0, 0, -Math.PI / 2]),
    ],
    Z: [
      place(gizmoMesh(circleGeometry(0.5, 0.5), colors.zAxis), [0, 0, 0], [0, Math.PI / 2, 0]),
    ],
    E: [
      place(gizmoMesh(circleGeometry(0.75, 1), colors.active, 0.5), [0, 0, 0], [0, Math.PI / 2, 0]),
    ],
  };
}

/** 旋转 picker(不可见 torus / sphere)。 */
function buildRotatePicker(): Record<string, Mesh[]> {
  const torus = (r: number, tube: number, rad: number, tub: number): BufferGeometry =>
    new TorusGeometry(r, tube, rad, tub);
  return {
    XYZE: [
      place(invisibleMesh(new SphereGeometry(0.25, 12, 10))),
    ],
    X: [
      place(invisibleMesh(torus(0.5, 0.1, 4, 24)), [0, 0, 0], [0, -Math.PI / 2, -Math.PI / 2]),
    ],
    Y: [
      place(invisibleMesh(torus(0.5, 0.1, 4, 24)), [0, 0, 0], [Math.PI / 2, 0, 0]),
    ],
    Z: [
      place(invisibleMesh(torus(0.5, 0.1, 4, 24)), [0, 0, 0], [0, 0, -Math.PI / 2]),
    ],
    E: [
      place(invisibleMesh(torus(0.75, 0.1, 2, 24))),
    ],
  };
}

/** 缩放 gizmo。 */
function buildScaleGizmo(colors: TransformColors): Record<string, Mesh[]> {
  const handle = makeScaleHandleGeometry();
  const shaft = makeShaftGeometry();
  return {
    X: [
      place(gizmoMesh(handle, colors.xAxis), [0.5, 0, 0], [0, 0, -Math.PI / 2]),
      place(gizmoMesh(shaft, colors.xAxis), [0, 0, 0], [0, 0, -Math.PI / 2]),
      place(gizmoMesh(handle.clone(), colors.xAxis), [-0.5, 0, 0], [0, 0, Math.PI / 2]),
    ],
    Y: [
      place(gizmoMesh(handle.clone(), colors.yAxis), [0, 0.5, 0]),
      place(gizmoMesh(shaft.clone(), colors.yAxis)),
      place(gizmoMesh(handle.clone(), colors.yAxis), [0, -0.5, 0], [0, 0, Math.PI]),
    ],
    Z: [
      place(gizmoMesh(handle.clone(), colors.zAxis), [0, 0, 0.5], [Math.PI / 2, 0, 0]),
      place(gizmoMesh(shaft.clone(), colors.zAxis), [0, 0, 0], [Math.PI / 2, 0, 0]),
      place(gizmoMesh(handle.clone(), colors.zAxis), [0, 0, -0.5], [-Math.PI / 2, 0, 0]),
    ],
    XYZ: [
      place(gizmoMesh(new BoxGeometry(0.1, 0.1, 0.1), { r: 1, g: 1, b: 1 }, 0.25)),
    ],
  };
}

/** 缩放 picker。 */
function buildScalePicker(): Record<string, Mesh[]> {
  const cyl = (): BufferGeometry => new CylinderGeometry(0.2, 0, 0.6, 4);
  return {
    X: [
      place(invisibleMesh(cyl()), [0.3, 0, 0], [0, 0, -Math.PI / 2]),
      place(invisibleMesh(cyl()), [-0.3, 0, 0], [0, 0, Math.PI / 2]),
    ],
    Y: [
      place(invisibleMesh(cyl()), [0, 0.3, 0]),
      place(invisibleMesh(cyl()), [0, -0.3, 0], [0, 0, Math.PI]),
    ],
    Z: [
      place(invisibleMesh(cyl()), [0, 0, 0.3], [Math.PI / 2, 0, 0]),
      place(invisibleMesh(cyl()), [0, 0, -0.3], [-Math.PI / 2, 0, 0]),
    ],
    XYZ: [
      place(invisibleMesh(new BoxGeometry(0.2, 0.2, 0.2))),
    ],
  };
}

/** 把 gizmo 定义表装配成一棵 Object3D 子树,每个 mesh.name = 轴名。 */
function setupGizmo(map: Record<string, Mesh[]>): Object3D {
  const root = new Object3D();
  for (const axisName of Object.keys(map)) {
    for (const mesh of map[axisName]) {
      mesh.name = axisName;
      mesh.visible = true;
      root.add(mesh);
    }
  }
  return root;
}

// ── TransformControls 类 ─────────────────────────────────────────

/**
 * gizmo 变换控制器。用法:
 *   const tc = new TransformControls(camera, domElement);
 *   scene.add(tc.getHelper());
 *   tc.attach(selectedObject);
 *   // 渲染循环里:tc.update();  (内部会 updateMatrixWorld)
 *   // 销毁:tc.dispose();
 */
export class TransformControls {
  readonly camera: Camera;
  readonly domElement: HTMLElement;

  // ── 配置 ───────────────────────────────────────────────────────
  mode: TransformMode;
  space: TransformSpace;
  size: number;
  translationSnap: number | null;
  rotationSnap: number | null;
  scaleSnap: number | null;
  preventDefaultGestures: boolean;
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
  enableHover: boolean;

  /** 当前激活轴(null = 无悬停/拖拽)。 */
  axis: TransformAxis | null = null;
  /** 是否正在拖拽。 */
  dragging: boolean = false;
  /** 启用开关。false 时忽略所有指针事件。 */
  enabled: boolean = true;

  // ── gizmo 子树 ─────────────────────────────────────────────────
  /** gizmo 根(用户加进 scene)。 */
  private _root: Object3D;
  /** 三种模式的可见 gizmo 子树。 */
  private _gizmo: Record<TransformMode, Object3D>;
  /** 三种模式的 picker 子树(不可见,可 raycast)。 */
  private _picker: Record<TransformMode, Object3D>;
  /** 颜色库(供 setColors 修改)。 */
  private _colors: TransformColors = { ...DEFAULT_COLORS };

  // ── 拖拽状态 ───────────────────────────────────────────────────
  private _attached: Object3D | null = null;
  private _worldPosition = new Vector3();
  private _worldPositionStart = new Vector3();
  private _worldQuaternion = new Quaternion();
  private _worldQuaternionStart = new Quaternion();
  private _worldQuaternionInv = new Quaternion();
  private _cameraPosition = new Vector3();
  private _eye = new Vector3();
  private _pointStart = new Vector3();
  private _pointEnd = new Vector3();
  private _parentQuaternion = new Quaternion();
  private _parentQuaternionInv = new Quaternion();
  private _parentScale = new Vector3(1, 1, 1);
  private _worldScale = new Vector3(1, 1, 1);
  private _worldScaleStart = new Vector3(1, 1, 1);
  private _positionStart = new Vector3();
  private _quaternionStart = new Quaternion();
  private _scaleStart = new Vector3(1, 1, 1);
  /** computeRotate 的可复用输出(避免每次 pointerMove 分配)。 */
  private _rotateResult: RotateResult = { rotationAxis: new Vector3(), rotationAngle: 0 };

  // ── 事件句柄 ───────────────────────────────────────────────────
  private _disposed = false;
  private _onPointerDown = (e: PointerEvent) => this._handlePointerDown(e);
  private _onPointerHover = (e: PointerEvent) => this._handlePointerHover(e);
  private _onPointerMove = (e: PointerEvent) => this._handlePointerMove(e);
  private _onPointerUp = (e: PointerEvent) => this._handlePointerUp(e);
  private _onContextMenu = (e: MouseEvent) => {
    if (this.preventDefaultGestures) e.preventDefault();
  };

  // ── 回调(替代 three.js 的事件派发) ────────────────────────────
  /** 任何变化(物体或 gizmo 位姿)时触发。 */
  onChange: (() => void) | null = null;
  /** 按下且命中轴时触发一次。 */
  onMouseDown: (() => void) | null = null;
  /** 抬起且结束拖拽时触发一次。 */
  onMouseUp: (() => void) | null = null;
  /** 物体本身位姿变化时触发(拖拽中高频)。 */
  onObjectChange: (() => void) | null = null;

  constructor(camera: Camera, domElement: HTMLElement, opts: TransformControlsOptions = {}) {
    this.camera = camera;
    this.domElement = domElement;

    this.mode = opts.mode ?? 'translate';
    this.space = opts.space ?? 'world';
    this.size = opts.size ?? 1;
    this.translationSnap = opts.translationSnap ?? null;
    this.rotationSnap = opts.rotationSnap ?? null;
    this.scaleSnap = opts.scaleSnap ?? null;
    this.preventDefaultGestures = opts.preventDefaultGestures ?? true;
    this.minX = opts.minX ?? -Infinity;
    this.maxX = opts.maxX ?? Infinity;
    this.minY = opts.minY ?? -Infinity;
    this.maxY = opts.maxY ?? Infinity;
    this.minZ = opts.minZ ?? -Infinity;
    this.maxZ = opts.maxZ ?? Infinity;
    this.enableHover = opts.enableHover ?? true;

    // 构建子树
    this._gizmo = {
      translate: setupGizmo(buildTranslateGizmo(this._colors)),
      rotate: setupGizmo(buildRotateGizmo(this._colors)),
      scale: setupGizmo(buildScaleGizmo(this._colors)),
    };
    this._picker = {
      translate: setupGizmo(buildTranslatePicker()),
      rotate: setupGizmo(buildRotatePicker()),
      scale: setupGizmo(buildScalePicker()),
    };
    // picker 永远不可见(但仍参与 raycast —— Mesh.raycast 不检查 visible)
    this._picker.translate.visible = false;
    this._picker.rotate.visible = false;
    this._picker.scale.visible = false;

    this._root = new Object3D();
    this._root.name = 'TransformControlsRoot';
    this._root.visible = false;
    // VREEN 的 Object3D.add/remove 是单参数签名(three.js 是变参),逐个子节点添加。
    this._root.add(this._gizmo.translate);
    this._root.add(this._gizmo.rotate);
    this._root.add(this._gizmo.scale);
    this._root.add(this._picker.translate);
    this._root.add(this._picker.rotate);
    this._root.add(this._picker.scale);

    this._updateModeVisibility();

    // 绑定 DOM 事件
    const el = this.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerHover);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('contextmenu', this._onContextMenu);
  }

  // ── 公开 API ───────────────────────────────────────────────────

  /** 返回 gizmo 根 Object3D,加进 scene 即可渲染。 */
  getHelper(): Object3D {
    return this._root;
  }

  /**
   * 返回指定模式的 picker 子树(不可见但可 raycast)。
   * 主要供调试与测试使用——业务代码通常不直接访问。
   */
  getPicker(mode: TransformMode): Object3D {
    return this._picker[mode];
  }

  /** 返回指定模式的可见 gizmo 子树。供调试/测试使用。 */
  getGizmo(mode: TransformMode): Object3D {
    return this._gizmo[mode];
  }

  /** 锚定到一个物体并显示 gizmo。 */
  attach(object: Object3D): this {
    this._attached = object;
    this._root.visible = true;
    return this;
  }

  /** 解除锚定并隐藏 gizmo。 */
  detach(): this {
    this._attached = null;
    this.axis = null;
    this._root.visible = false;
    return this;
  }

  /** 当前锚定的物体(未锚定返回 null)。 */
  getObject(): Object3D | null {
    return this._attached;
  }

  /** 重置物体到拖拽开始时的位姿(拖拽中调用)。 */
  reset(): void {
    if (!this.enabled || !this._attached) return;
    if (this.dragging) {
      this._attached.position.copy(this._positionStart);
      this._attached.rotation.copy(this._quaternionStart);
      this._attached.scale.copy(this._scaleStart);
      this._emitChange();
      this._emitObjectChange();
      this._pointStart.copy(this._pointEnd);
    }
  }

  setMode(mode: TransformMode): void { this.mode = mode; this._updateModeVisibility(); }
  setSpace(space: TransformSpace): void { this.space = space; }
  setSize(size: number): void { this.size = size; }
  setTranslationSnap(v: number | null): void { this.translationSnap = v; }
  setRotationSnap(v: number | null): void { this.rotationSnap = v; }
  setScaleSnap(v: number | null): void { this.scaleSnap = v; }

  /** 设置 gizmo 颜色。会重建可见 gizmo 子树以应用新颜色。 */
  setColors(xAxis: { r: number; g: number; b: number },
            yAxis: { r: number; g: number; b: number },
            zAxis: { r: number; g: number; b: number },
            active: { r: number; g: number; b: number }): void {
    this._colors.xAxis = { ...xAxis };
    this._colors.yAxis = { ...yAxis };
    this._colors.zAxis = { ...zAxis };
    this._colors.active = { ...active };
    const oldT = this._gizmo.translate, oldR = this._gizmo.rotate, oldS = this._gizmo.scale;
    // Object3D.remove/add 单参数签名,逐个处理。
    this._root.remove(oldT); this._root.remove(oldR); this._root.remove(oldS);
    disposeSubtree(oldT); disposeSubtree(oldR); disposeSubtree(oldS);
    this._gizmo.translate = setupGizmo(buildTranslateGizmo(this._colors));
    this._gizmo.rotate = setupGizmo(buildRotateGizmo(this._colors));
    this._gizmo.scale = setupGizmo(buildScaleGizmo(this._colors));
    this._root.add(this._gizmo.translate);
    this._root.add(this._gizmo.rotate);
    this._root.add(this._gizmo.scale);
    this._updateModeVisibility();
  }

  /**
   * 每帧由渲染循环调用。对齐 gizmo 到物体、按相机距离缩放、根据当前轴高亮手柄。
   * 内部会 updateMatrixWorld,确保 picker 的 matrixWorld 最新(raycast 需要)。
   */
  update(): void {
    if (this._disposed) return;
    this._updateGizmo();
  }

  /** 销毁,解绑所有事件并释放 gizmo 几何/材质。 */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    const el = this.domElement;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointermove', this._onPointerHover);
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('contextmenu', this._onContextMenu);
    el.style.touchAction = '';
    disposeSubtree(this._root);
    this._root.parent?.remove(this._root);
  }

  // ── 内部:gizmo 更新 ────────────────────────────────────────────

  private _updateModeVisibility(): void {
    this._gizmo.translate.visible = this.mode === 'translate';
    this._gizmo.rotate.visible = this.mode === 'rotate';
    this._gizmo.scale.visible = this.mode === 'scale';
  }

  /**
   * 对齐 gizmo:解算物体/相机世界位姿与 eye 视向,把 root 对齐到
   * worldPosition + orientQ + scale(s),然后 updateMatrixWorld 让子树
   * (gizmo + picker)的 matrixWorld 更新(raycast 前提)。最后高亮 axis。
   *
   * 子树里每个手柄的本地变换(position/rotation)是构造时设定的"基础变换",
   * 永久不变——root 的 transform 通过矩阵传播把它们摆到世界正确位置。
   */
  private _updateGizmo(): void {
    const obj = this._attached;
    if (!obj) {
      this._root.visible = false;
      return;
    }
    this._root.visible = true;

    // 物体世界位姿
    obj.updateMatrixWorld();
    if (obj.parent) {
      obj.parent.updateMatrixWorld();
      obj.parent.matrixWorld.decompose(_v1, this._parentQuaternion, this._parentScale);
    } else {
      this._parentQuaternion.copy(_identityQ);
      this._parentScale.set(1, 1, 1);
    }
    obj.matrixWorld.decompose(this._worldPosition, this._worldQuaternion, this._worldScale);
    this._parentQuaternionInv.copy(this._parentQuaternion).invert();
    this._worldQuaternionInv.copy(this._worldQuaternion).invert();

    // 相机
    this.camera.updateMatrixWorld();
    this.camera.matrixWorld.decompose(this._cameraPosition, _tempQ, _v1);
    const cam = this.camera as Camera & {
      isPerspectiveCamera?: boolean; isOrthographicCamera?: boolean;
      fov?: number; zoom?: number; top?: number; bottom?: number;
    };
    if (cam.isOrthographicCamera) {
      // OrthographicCamera: eye = -getWorldDirection
      this.camera.getWorldDirection(this._eye);
      this._eye.negate();
    } else {
      this._eye.copy(this._cameraPosition).sub(this._worldPosition).normalize();
    }

    // root 对齐:位置 = worldPosition;旋转 = orientQ(local 用 worldQuaternion,world 用单位);
    // 缩放 = s(屏幕恒定大小)
    const space: TransformSpace = this.mode === 'scale' ? 'local' : this.space;
    const orientQ = space === 'local' ? this._worldQuaternion : _identityQ;

    let factor: number;
    if (cam.isOrthographicCamera) {
      factor = ((cam.top ?? 1) - (cam.bottom ?? -1)) / (cam.zoom ?? 1);
    } else {
      factor = this._worldPosition.distanceTo(this._cameraPosition) *
        Math.min(1.9 * Math.tan(Math.PI * (cam.fov ?? 50) / 360) / (cam.zoom ?? 1), 7);
    }
    const s = factor * this.size / 4;

    this._root.position.copy(this._worldPosition);
    this._root.rotation.copy(orientQ);
    this._root.scale.set(s, s, s);
    // 强制整棵子树重算 matrixWorld(picker raycast 依赖)
    this._root.updateMatrixWorld(true);

    // 高亮当前 axis
    this._applyHighlight();
  }

  /** 高亮当前 axis 命中的手柄(修改可见 gizmo 子树的材质颜色)。 */
  private _applyHighlight(): void {
    const handles = this._gizmo[this.mode].children;
    for (const handle of handles) {
      const mesh = handle as Mesh;
      const mat = mesh.material as MeshBasicMaterial | MeshBasicMaterial[];
      if (Array.isArray(mat)) continue;
      if (!mat) continue;
      // 缓存原始色
      const cached = mesh as unknown as {
        _origColor?: { r: number; g: number; b: number };
        _origOpacity?: number;
      };
      if (!cached._origColor) {
        cached._origColor = { ...mat.color };
        cached._origOpacity = mat.opacity;
      }
      mat.color = { ...cached._origColor };
      mat.opacity = cached._origOpacity ?? 1;

      if (this.enabled && this.axis) {
        const name = mesh.name;
        if (name === this.axis) {
          mat.color = { ...this._colors.active };
          mat.opacity = 1;
        } else if (this.axis.split('').some((a) => name === a)) {
          mat.color = { ...this._colors.active };
          mat.opacity = 1;
        }
      }
    }
  }

  // ── 内部:指针事件 ──────────────────────────────────────────────

  /** 把 PointerEvent 转成 NDC 坐标 {x,y ∈ [-1,1]}。 */
  private _getPointer(e: PointerEvent): { x: number; y: number; button: number } {
    const rect = this.domElement.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      button: e.button,
    };
  }

  private _handlePointerHover(e: PointerEvent): void {
    if (!this.enabled || !this._attached || this.dragging || !this.enableHover) return;
    // 确保 picker 的 matrixWorld 最新
    this._updateGizmo();
    this.pointerHover(this._getPointer(e));
  }

  private _handlePointerDown(e: PointerEvent): void {
    if (!this.enabled || !this._attached || this.dragging) return;
    if (e.button !== 0) return; // 仅左键
    this.domElement.setPointerCapture(e.pointerId);
    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this._updateGizmo();
    const p = this._getPointer(e);
    this.pointerHover(p);
    this.pointerDown(p);
  }

  private _handlePointerMove(e: PointerEvent): void {
    if (!this.enabled) return;
    this.pointerMove(this._getPointer(e));
  }

  private _handlePointerUp(e: PointerEvent): void {
    if (!this.enabled) return;
    try { this.domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.pointerUp(this._getPointer(e));
  }

  /** 悬停:raycast picker 子树,确定 axis。 */
  pointerHover(pointer: { x: number; y: number }): void {
    if (!this._attached || this.dragging) return;
    _raycaster.setFromCamera(pointer, this.camera);
    this.axis = intersectPicker(this._picker[this.mode], _raycaster);
  }

  /** 按下:若命中轴,记录起始状态并 raycast 拖拽平面取起点。 */
  pointerDown(pointer: { x: number; y: number }): void {
    if (!this._attached || this.dragging || this.axis === null) return;
    const obj = this._attached;
    _raycaster.setFromCamera(pointer, this.camera);

    // 构建拖拽平面并求交
    buildDragPlane(
      this.axis, this.mode, this.space,
      this._eye, this._worldPosition, this._worldQuaternion, _dragPlane,
    );
    const hit = _raycaster.ray.intersectPlane(_dragPlane, _planeHit);
    if (!hit) return;

    obj.updateMatrixWorld();
    if (obj.parent) obj.parent.updateMatrixWorld();

    this._positionStart.copy(obj.position);
    this._quaternionStart.copy(obj.rotation);
    this._scaleStart.copy(obj.scale);

    obj.matrixWorld.decompose(this._worldPositionStart, this._worldQuaternionStart, this._worldScaleStart);
    this._pointStart.copy(hit).sub(this._worldPositionStart);

    this.dragging = true;
    this.onMouseDown?.();
  }

  /** 移动:raycast 平面,算 pointEnd,应用变换。 */
  pointerMove(pointer: { x: number; y: number }): void {
    const axis = this.axis;
    const mode = this.mode;
    const obj = this._attached;
    if (!obj || axis === null || !this.dragging) return;

    let space = this.space;
    if (mode === 'scale') space = 'local';
    else if (axis === 'E' || axis === 'XYZE' || axis === 'XYZ') space = 'world';

    _raycaster.setFromCamera(pointer, this.camera);
    buildDragPlane(
      axis, mode, space,
      this._eye, this._worldPositionStart, this._worldQuaternionStart, _dragPlane,
    );
    const hit = _raycaster.ray.intersectPlane(_dragPlane, _planeHit);
    if (!hit) return;
    this._pointEnd.copy(hit).sub(this._worldPositionStart);

    if (mode === 'translate') {
      computeTranslate({
        axis, space,
        pointStart: this._pointStart, pointEnd: this._pointEnd,
        worldQuaternionInv: this._worldQuaternionInv,
        quaternionStart: this._quaternionStart,
        parentQuaternionInv: this._parentQuaternionInv,
        parentScale: this._parentScale,
        positionStart: this._positionStart,
        translationSnap: this.translationSnap,
        minX: this.minX, maxX: this.maxX,
        minY: this.minY, maxY: this.maxY,
        minZ: this.minZ, maxZ: this.maxZ,
      }, obj.position);
    } else if (mode === 'scale') {
      computeScale({
        axis,
        pointStart: this._pointStart, pointEnd: this._pointEnd,
        worldQuaternionInv: this._worldQuaternionInv,
        scaleStart: this._scaleStart,
        scaleSnap: this.scaleSnap,
      }, obj.scale);
    } else { // rotate
      _offset.copy(this._pointEnd).sub(this._pointStart);
      computeRotate({
        axis, space,
        pointStart: this._pointStart, pointEnd: this._pointEnd,
        offset: _offset,
        eye: this._eye,
        worldPosition: this._worldPositionStart,
        cameraPosition: this._cameraPosition,
        worldQuaternion: this._worldQuaternionStart,
        parentQuaternionInv: this._parentQuaternionInv,
        quaternionStart: this._quaternionStart,
        rotationSnap: this.rotationSnap,
      }, obj.rotation, this._rotateResult);
    }

    this._emitChange();
    this._emitObjectChange();
  }

  /** 抬起:结束拖拽。 */
  pointerUp(_pointer: { x: number; y: number }): void {
    if (this.dragging && this.axis !== null) {
      this.onMouseUp?.();
    }
    this.dragging = false;
    this.axis = null;
  }

  private _emitChange(): void { this.onChange?.(); }
  private _emitObjectChange(): void { this.onObjectChange?.(); }
}

// ── 辅助函数 ─────────────────────────────────────────────────────

/** 释放子树所有 mesh 的 geometry / material。 */
function disposeSubtree(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry && typeof (m.geometry as BufferGeometry).dispose === 'function') {
      (m.geometry as BufferGeometry).dispose();
    }
    if (m.material) {
      const mat = m.material as MeshBasicMaterial;
      if (typeof (mat as unknown as { dispose?: () => void }).dispose === 'function') {
        (mat as unknown as { dispose: () => void }).dispose();
      }
    }
  });
}

/**
 * raycast picker 子树,返回命中的 mesh.name(轴名)。
 * picker 子树 visible=false,但 Mesh.raycast 不检查 visible,仍可命中。
 * 命中按 distance 排序,取最近的可见或任意命中。
 */
function intersectPicker(picker: Object3D, raycaster: Raycaster): TransformAxis | null {
  const hits = raycaster.intersectObject(picker, true);
  for (const h of hits) {
    if (h.object.name) return h.object.name as TransformAxis;
  }
  return null;
}
