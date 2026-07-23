// CameraHelper — 相机视锥辅助器,用线段可视化相机的 frustum。
//
// 参考 three.js CameraHelper.js,适配 VREEN 自研引擎:
//   - 显示 near/far 平面、侧边、up 指示、target 连线、cross 十字线
//   - 使用顶点色线段 shader,各区域颜色独立(frustum 橙 / cone 红 / up 蓝 / target 白 / cross 灰)
//   - update() 通过 projectionMatrixInverse + matrixWorld 把 NDC 点反投影到世界空间
//   - VREEN 使用 WebGL 坐标系(depth [-1, 1]),nearZ = -1, farZ = 1
//
// 用法:
//   const helper = new CameraHelper(renderer, camera);
//   scene.add(helper);
//   // 相机投影或变换变化后:
//   helper.update();

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import { Vector3 } from '../Math';
import type { Camera } from '../Cameras/Camera';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { getVertexColorLineProgram, type RGBTuple } from './lineShaders';

// 复用临时向量
const _vec = new Vector3();

/** 线段定义:[点A名, 点B名]。顺序与 three.js 一致。 */
const LINE_DEFS: Array<[string, string]> = [
  // near (4)
  ['n1', 'n2'], ['n2', 'n4'], ['n4', 'n3'], ['n3', 'n1'],
  // far (4)
  ['f1', 'f2'], ['f2', 'f4'], ['f4', 'f3'], ['f3', 'f1'],
  // sides (4)
  ['n1', 'f1'], ['n2', 'f2'], ['n3', 'f3'], ['n4', 'f4'],
  // cone (4)
  ['p', 'n1'], ['p', 'n2'], ['p', 'n3'], ['p', 'n4'],
  // up (3)
  ['u1', 'u2'], ['u2', 'u3'], ['u3', 'u1'],
  // target (2)
  ['c', 't'], ['p', 'c'],
  // cross (4)
  ['cn1', 'cn2'], ['cn3', 'cn4'],
  ['cf1', 'cf2'], ['cf3', 'cf4'],
];

/** 每条线对应的颜色区域索引(用于 setColors 分段着色):
 *  0=frustum, 1=cone, 2=up, 3=target, 4=cross */
const LINE_COLOR_GROUP: number[] = [
  0, 0, 0, 0,  // near
  0, 0, 0, 0,  // far
  0, 0, 0, 0,  // sides
  1, 1, 1, 1,  // cone
  2, 2, 2,     // up
  3, 4,        // target (c-t=3, p-c=4)
  4, 4, 4, 4,  // cross
];

/** 各命名点的 NDC 坐标定义 [x, y, z]。z: near=-1, far=1 (WebGL)。
 *  与 three.js CameraHelper.update() 中的 setPoint 调用一一对应。 */
const POINT_NDC: Record<string, [number, number, number]> = {
  // center / target
  c:  [0, 0, -1],
  t:  [0, 0, 1],
  // near 四角
  n1: [-1, -1, -1],
  n2: [1, -1, -1],
  n3: [-1, 1, -1],
  n4: [1, 1, -1],
  // far 四角
  f1: [-1, -1, 1],
  f2: [1, -1, 1],
  f3: [-1, 1, 1],
  f4: [1, 1, 1],
  // up 指示
  u1: [0.7, 1.1, -1],
  u2: [-0.7, 1.1, -1],
  u3: [0, 2, -1],
  // cross (near)
  cn1: [-1, 0, -1],
  cn2: [1, 0, -1],
  cn3: [0, -1, -1],
  cn4: [0, 1, -1],
  // cross (far)
  cf1: [-1, 0, 1],
  cf2: [1, 0, 1],
  cf3: [0, -1, 1],
  cf4: [0, 1, 1],
  // 原点(相机位置)
  p: [0, 0, -1],
};

/** 构造 CameraHelper 的几何体(50 顶点, position + color,初始全 0)。
 *  纯数据,不依赖 WebGL,便于测试。
 *  @returns { geometry, pointMap } —— pointMap 记录每个命名点对应的顶点索引列表 */
export function buildCameraHelperGeometry(): {
  geometry: BufferGeometry;
  pointMap: Record<string, number[]>;
} {
  const lineCount = LINE_DEFS.length; // 25
  const vertexCount = lineCount * 2;  // 50
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  const pointMap: Record<string, number[]> = {};
  let vertexIndex = 0;

  for (const [a, b] of LINE_DEFS) {
    // 点 A
    positions[vertexIndex * 3] = 0;
    positions[vertexIndex * 3 + 1] = 0;
    positions[vertexIndex * 3 + 2] = 0;
    if (!pointMap[a]) pointMap[a] = [];
    pointMap[a].push(vertexIndex);
    vertexIndex++;
    // 点 B
    positions[vertexIndex * 3] = 0;
    positions[vertexIndex * 3 + 1] = 0;
    positions[vertexIndex * 3 + 2] = 0;
    if (!pointMap[b]) pointMap[b] = [];
    pointMap[b].push(vertexIndex);
    vertexIndex++;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  return { geometry: geom, pointMap };
}

/** 相机视锥辅助器。 */
export class CameraHelper extends Mesh {
  override readonly type: string = 'CameraHelper';
  /** 被可视化的相机。 */
  camera: Camera;
  /** 命名点 → 顶点索引列表的映射(update 时按此写入位置)。 */
  pointMap: Record<string, number[]>;

  constructor(renderer: WebGL2Renderer, camera: Camera) {
    const { geometry, pointMap } = buildCameraHelperGeometry();
    super(geometry, { type: 'Basic', renderOrder: 1 } as unknown as Material);
    this.camera = camera;
    this.pointMap = pointMap;
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;

    this.userData = {
      __helper: 'line',
      program: getVertexColorLineProgram(renderer.gl),
      uniforms: {
        u_alpha: 1,
      },
    };

    // 确保投影矩阵最新
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    this.update();

    // 默认配色:frustum 橙 / cone 红 / up 蓝 / target 白 / cross 灰
    this.setColors(
      [1, 0.667, 0],
      [1, 0, 0],
      [0, 0.667, 1],
      [1, 1, 1],
      [0.2, 0.2, 0.2],
    );
  }

  /** 按区域设置线段颜色。
   *  @param frustum  near/far/sides 线色
   *  @param cone     原点到 near 四角的线色
   *  @param up       up 指示三角线色
   *  @param target   center→target 线色
   *  @param cross    cross 十字线色 */
  setColors(frustum: RGBTuple, cone: RGBTuple, up: RGBTuple, target: RGBTuple, cross: RGBTuple): this {
    const colorAttr = this.geometry.getAttribute('color');
    if (!colorAttr) return this;
    const palette: RGBTuple[] = [frustum, cone, up, target, cross];
    for (let i = 0; i < LINE_DEFS.length; i++) {
      const group = LINE_COLOR_GROUP[i];
      const [r, g, b] = palette[group];
      const base = i * 2 * 3; // 每条线 2 顶点 × 3 floats
      colorAttr.array[base] = r;
      colorAttr.array[base + 1] = g;
      colorAttr.array[base + 2] = b;
      colorAttr.array[base + 3] = r;
      colorAttr.array[base + 4] = g;
      colorAttr.array[base + 5] = b;
    }
    colorAttr.needsUpdate = true;
    return this;
  }

  /** 根据相机当前投影矩阵和世界变换刷新视锥顶点。 */
  update(): void {
    const camera = this.camera;
    camera.updateMatrixWorld(true);

    const posAttr = this.geometry.getAttribute('position');
    if (!posAttr) return;
    const arr = posAttr.array;

    // 对每个命名点:取 NDC → 反投影到世界空间 → 写入所有引用该点的顶点
    for (const [name, ndc] of Object.entries(POINT_NDC)) {
      const indices = this.pointMap[name];
      if (!indices) continue;
      _vec.set(ndc[0], ndc[1], ndc[2]);
      // NDC → view space: apply projectionMatrixInverse
      _vec.applyMatrix4(camera.projectionMatrixInverse);
      // view space → world space: apply camera.matrixWorld
      _vec.applyMatrix4(camera.matrixWorld);
      for (const idx of indices) {
        arr[idx * 3] = _vec.x;
        arr[idx * 3 + 1] = _vec.y;
        arr[idx * 3 + 2] = _vec.z;
      }
    }
    posAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
