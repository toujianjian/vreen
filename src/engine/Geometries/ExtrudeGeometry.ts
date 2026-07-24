// ExtrudeGeometry — 挤压几何体,从 three.js 移植并适配 VREEN 引擎。
// 将 2D 形状(Vector2[] 或 Shape)沿 Z 轴挤压成 3D 实体,可选倒角。
// 简化版:不支持 extrudePath(沿 3D 样条挤压);不支持自定义 UVGenerator。
// 内置简化版 ear-clipping 三角化算法(支持凸/凹多边形与单个或多个孔洞)。
// 参考: three.js/src/geometries/ExtrudeGeometry.js

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector2 } from '../Math';
import { Shape } from './Shape';

/** 挤压选项。 */
export interface ExtrudeOptions {
  /** 曲线段采样精度(用于把 Shape 的曲线离散为 Vector2[])。 */
  curveSegments?: number;
  /** 沿 Z 轴的挤压步数(每步插值一层)。 */
  steps?: number;
  /** 挤压总深度。 */
  depth?: number;
  /** 是否启用倒角。 */
  bevelEnabled?: boolean;
  /** 倒角切入形状内部的厚度(沿 Z 方向)。 */
  bevelThickness?: number;
  /** 倒角向形状外延伸的距离(在 XY 平面)。 */
  bevelSize?: number;
  /** 倒角起始偏移(在 XY 平面)。 */
  bevelOffset?: number;
  /** 倒角的层数(细分段数)。 */
  bevelSegments?: number;
}

/** 挤压几何体:2D 形状沿 Z 轴挤压成 3D 实体。 */
export class ExtrudeGeometry extends BufferGeometry {
  constructor(
    shape: Shape | Vector2[],
    options: ExtrudeOptions = {},
  ) {
    super();

    const curveSegments = options.curveSegments !== undefined ? options.curveSegments : 12;
    const steps = options.steps !== undefined ? options.steps : 1;
    const depth = options.depth !== undefined ? options.depth : 1;

    let bevelEnabled = options.bevelEnabled !== undefined ? options.bevelEnabled : true;
    let bevelThickness = options.bevelThickness !== undefined ? options.bevelThickness : 0.2;
    let bevelSize = options.bevelSize !== undefined ? options.bevelSize : bevelThickness - 0.1;
    let bevelOffset = options.bevelOffset !== undefined ? options.bevelOffset : 0;
    let bevelSegments = options.bevelSegments !== undefined ? options.bevelSegments : 3;

    if (!bevelEnabled) {
      bevelSegments = 0;
      bevelThickness = 0;
      bevelSize = 0;
      bevelOffset = 0;
    }

    // 提取外轮廓与孔洞
    let contour: Vector2[];
    let holes: Vector2[][];
    if (shape instanceof Shape) {
      const extracted = shape.extractPoints(curveSegments);
      contour = extracted.shape;
      holes = extracted.holes;
    } else {
      contour = shape.slice();
      holes = [];
    }

    // 保证逆时针绕向(三角化算法要求外轮廓 CCW、孔洞 CW)
    if (isClockWise(contour)) {
      contour = contour.reverse();
    }
    for (let h = 0; h < holes.length; h++) {
      if (!isClockWise(holes[h])) {
        holes[h] = holes[h].reverse();
      }
    }

    // 合并重合的相邻点,避免退化三角形
    mergeOverlappingPoints(contour);
    for (const hole of holes) mergeOverlappingPoints(hole);

    // 拼接所有顶点(轮廓 + 所有孔洞)用于全局索引
    const allVertices: Vector2[] = contour.slice();
    for (const hole of holes) {
      allVertices.push(...hole);
    }
    const vlen = allVertices.length;

    // 为每个顶点计算倒角位移方向(相邻两边的角平分线)
    const contourMovements: Vector2[] = [];
    for (let i = 0, il = contour.length; i < il; i++) {
      const j = (i - 1 + il) % il;
      const k = (i + 1) % il;
      contourMovements.push(getBevelVec(contour[i], contour[j], contour[k]));
    }

    const holesMovements: Vector2[][] = [];
    for (const hole of holes) {
      const m: Vector2[] = [];
      for (let i = 0, il = hole.length; i < il; i++) {
        const j = (i - 1 + il) % il;
        const k = (i + 1) % il;
        m.push(getBevelVec(hole[i], hole[j], hole[k]));
      }
      holesMovements.push(m);
    }

    // 合并所有顶点的位移方向
    const verticesMovements: Vector2[] = contourMovements.slice();
    for (const m of holesMovements) {
      verticesMovements.push(...m);
    }

    // 三角化(倒角启用时使用收缩后的轮廓)
    let faces: number[][];
    if (bevelSegments === 0) {
      faces = triangulateShape(contour, holes);
    } else {
      // 收缩轮廓(bevelSize + bevelOffset 位移)
      const bs = bevelSize + bevelOffset;
      const contractedContour: Vector2[] = [];
      for (let i = 0; i < contour.length; i++) {
        contractedContour.push(
          contour[i].clone().addScaledVector(contourMovements[i], bs),
        );
      }
      const expandedHoles: Vector2[][] = [];
      for (let h = 0; h < holes.length; h++) {
        const expanded: Vector2[] = [];
        for (let i = 0; i < holes[h].length; i++) {
          expanded.push(
            holes[h][i].clone().addScaledVector(holesMovements[h][i], bs),
          );
        }
        expandedHoles.push(expanded);
      }
      faces = triangulateShape(contractedContour, expandedHoles);
    }

    const flen = faces.length;
    const bs = bevelSize + bevelOffset;

    // 顶点流:每层 vlen 个顶点,层数 = 2 * bevelSegments + steps + 1
    const placeholder: number[] = [];

    // 前倒角(底面侧)—— bevelSegments 层
    for (let b = 0; b < bevelSegments; b++) {
      const t = b / bevelSegments;
      const z = bevelThickness * Math.cos(t * Math.PI / 2);
      const offset = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;

      for (let i = 0; i < contour.length; i++) {
        const vert = contour[i].clone().addScaledVector(contourMovements[i], offset);
        pushVertex(placeholder, vert.x, vert.y, -z);
      }
      for (let h = 0; h < holes.length; h++) {
        for (let i = 0; i < holes[h].length; i++) {
          const vert = holes[h][i].clone().addScaledVector(holesMovements[h][i], offset);
          pushVertex(placeholder, vert.x, vert.y, -z);
        }
      }
    }

    // 主体(底面 + 每步插值层)
    for (let s = 0; s <= steps; s++) {
      const z = (depth / steps) * s;
      for (let i = 0; i < vlen; i++) {
        const vert = bevelEnabled
          ? allVertices[i].clone().addScaledVector(verticesMovements[i], bs)
          : allVertices[i];
        pushVertex(placeholder, vert.x, vert.y, z);
      }
    }

    // 后倒角(顶面侧)—— bevelSegments 层,从最远往回收缩
    for (let b = bevelSegments - 1; b >= 0; b--) {
      const t = b / bevelSegments;
      const z = bevelThickness * Math.cos(t * Math.PI / 2);
      const offset = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;

      for (let i = 0; i < contour.length; i++) {
        const vert = contour[i].clone().addScaledVector(contourMovements[i], offset);
        pushVertex(placeholder, vert.x, vert.y, depth + z);
      }
      for (let h = 0; h < holes.length; h++) {
        for (let i = 0; i < holes[h].length; i++) {
          const vert = holes[h][i].clone().addScaledVector(holesMovements[h][i], offset);
          pushVertex(placeholder, vert.x, vert.y, depth + z);
        }
      }
    }

    // 总层数
    const totalLayers = 2 * bevelSegments + steps + 1;

    // 现在构建索引
    const indices: number[] = [];

    // 底面(第一层后倒角的最近层 = layer 0;若 bevelEnabled=false 则 layer 0 = body[0])
    // three.js 中底面顶点反向(法线指向 -Z)
    const bottomLayer = 0;
    for (let i = 0; i < flen; i++) {
      const f = faces[i];
      indices.push(
        f[2] + vlen * bottomLayer,
        f[1] + vlen * bottomLayer,
        f[0] + vlen * bottomLayer,
      );
    }

    // 顶面(最后一层)
    const topLayer = totalLayers - 1;
    for (let i = 0; i < flen; i++) {
      const f = faces[i];
      indices.push(
        f[0] + vlen * topLayer,
        f[1] + vlen * topLayer,
        f[2] + vlen * topLayer,
      );
    }

    // 侧面:每层之间用四边形(两个三角形)连接。
    // 对外轮廓和每个孔洞分别构建。
    let layerOffset = 0;
    // 外轮廓侧壁
    buildSideWalls(contour, layerOffset);
    layerOffset += contour.length;
    // 各孔洞侧壁
    for (let h = 0; h < holes.length; h++) {
      buildSideWalls(holes[h], layerOffset);
      layerOffset += holes[h].length;
    }

    // 写入缓冲
    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(placeholder), 3));
    // UV 简化:按顶点在 XY 平面位置归一化(不严格,仅占位)
    const uvArray: number[] = [];
    for (let i = 0; i < placeholder.length; i += 3) {
      uvArray.push(placeholder[i], placeholder[i + 1]);
    }
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvArray), 2));
    // 法线由顶点位置自动计算
    this.computeVertexNormals();
    this.computeBoundingBox();

    /** 在顶点流末尾追加一个 (x, y, z)。 */
    function pushVertex(arr: number[], x: number, y: number, z: number): void {
      arr.push(x, y, z);
    }

    /** 为一条闭合轮廓构建侧壁四边形(相邻层之间)。 */
    function buildSideWalls(loop: Vector2[], offset: number): void {
      for (let i = 0, il = loop.length; i < il; i++) {
        const j = (i + 1) % il;
        for (let s = 0; s < totalLayers - 1; s++) {
          const slen1 = vlen * s;
          const slen2 = vlen * (s + 1);
          const a = offset + j + slen1;
          const b = offset + i + slen1;
          const c = offset + i + slen2;
          const d = offset + j + slen2;
          // 两个三角形:(a,b,d) 与 (b,c,d)
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
    }
  }
}

// ===== 几何工具 =====

/** 计算多边形有向面积;>0 表示逆时针(CCW),<0 表示顺时针(CW)。 */
function polygonArea(contour: Vector2[]): number {
  const n = contour.length;
  let a = 0;
  for (let p = n - 1, q = 0; q < n; p = q++) {
    a += contour[p].x * contour[q].y - contour[q].x * contour[p].y;
  }
  return a * 0.5;
}

/** 多边形是否顺时针绕向。 */
function isClockWise(pts: Vector2[]): boolean {
  return polygonArea(pts) < 0;
}

/** 去除与首点重合的尾点(three.js ShapeUtils.removeDupEndPts)。 */
function removeDupEndPts(points: Vector2[]): void {
  const l = points.length;
  if (l > 2 && points[l - 1].equals(points[0])) {
    points.pop();
  }
}

/** 合并相邻重合或近重合点(three.js ExtrudeGeometry.mergeOverlappingPoints 简化版)。 */
function mergeOverlappingPoints(points: Vector2[]): void {
  const THRESHOLD_SQ = 1e-20; // 比三的 1e-10 更严格,避免数值误差导致的退化
  let prevPos = points[0];
  for (let i = 1; i <= points.length; i++) {
    const currentIndex = i % points.length;
    const currentPos = points[currentIndex];
    const dx = currentPos.x - prevPos.x;
    const dy = currentPos.y - prevPos.y;
    const distSq = dx * dx + dy * dy;
    const scale = Math.max(
      Math.abs(currentPos.x),
      Math.abs(currentPos.y),
      Math.abs(prevPos.x),
      Math.abs(prevPos.y),
    );
    const thresholdSqScaled = THRESHOLD_SQ * scale * scale;
    if (distSq <= thresholdSqScaled) {
      points.splice(currentIndex, 1);
      i--;
      continue;
    }
    prevPos = currentPos;
  }
}

/**
 * 三角化带孔洞的多边形。返回三角形索引数组,每个三角形为 [i,j,k],
 * 索引空间:contour 顶点在前,随后依次追加每个 hole 的顶点。
 *
 * 实现:把外轮廓与孔洞合并成一个简单多边形(通过桥边),
 * 然后用 ear-clipping 算法切出三角形。
 */
function triangulateShape(contour: Vector2[], holes: Vector2[][]): number[][] {
  // 复制并去重尾点
  const contourCopy = contour.slice();
  removeDupEndPts(contourCopy);
  const holesCopy = holes.map((h) => {
    const c = h.slice();
    removeDupEndPts(c);
    return c;
  });

  // 拼接平坦顶点数组(2D)
  const vertices: number[] = [];
  const holeIndices: number[] = [];
  for (const p of contourCopy) {
    vertices.push(p.x, p.y);
  }
  let idx = contourCopy.length;
  for (const hole of holesCopy) {
    holeIndices.push(idx);
    idx += hole.length;
    for (const p of hole) {
      vertices.push(p.x, p.y);
    }
  }

  // 调用 earcut
  const triangles = earcut(vertices, holeIndices, 2);

  // 分组成三元组
  const faces: number[][] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    faces.push([triangles[i], triangles[i + 1], triangles[i + 2]]);
  }
  return faces;
}

/**
 * Earcut 多边形三角化算法(mapbox/earcut 简化移植版)。
 * data: 平坦顶点数组 [x0,y0, x1,y1, ...]
 * holeIndices: 每个孔洞起始顶点索引(基于顶点计数,非分量计数)
 * dim: 每个顶点占用的分量数(此处固定为 2)
 * 返回:三角形索引的平坦数组 [i0,j0,k0, i1,j1,k1, ...]
 */
function earcut(data: number[], holeIndices: number[], dim: number): number[] {
  const hasHoles = holeIndices.length > 0;
  const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles: number[] = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;

  let minX = 0, minY = 0, invSize = 0;
  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);

  // 数据量大时使用 z-order 曲线哈希加速;此处简化,小数据直接 earcut
  if (data.length > 80 * dim) {
    minX = data[0];
    minY = data[1];
    let maxX = minX, maxY = minY;
    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i], y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }

  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
  return triangles;
}

// ===== Earcut 内部数据结构 =====

interface EarcutNode {
  i: number;       // 顶点索引(在 data 中的位置 / dim)
  x: number;
  y: number;
  prev: EarcutNode;
  next: EarcutNode;
  prevZ: EarcutNode | null;
  nextZ: EarcutNode | null;
  steiner: boolean;
  z: number;
}

function createNode(i: number, x: number, y: number): EarcutNode {
  return {
    i, x, y,
    prev: null as unknown as EarcutNode,
    next: null as unknown as EarcutNode,
    prevZ: null,
    nextZ: null,
    steiner: false,
    z: 0,
  };
}

/** 把 data[start..end] 构造成循环双向链表。 */
function linkedList(
  data: number[],
  start: number,
  end: number,
  dim: number,
  clockwise: boolean,
): EarcutNode | null {
  let last: EarcutNode | null = null;
  if (clockwise === (signedArea(data, start, end, dim) > 0)) {
    for (let i = start; i < end; i += dim) {
      last = insertNode((i / dim) | 0, data[i], data[i + 1], last);
    }
  } else {
    for (let i = end - dim; i >= start; i -= dim) {
      last = insertNode((i / dim) | 0, data[i], data[i + 1], last);
    }
  }
  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

/** 在 last 之后插入一个新节点,返回新节点。 */
function insertNode(i: number, x: number, y: number, last: EarcutNode | null): EarcutNode {
  const node = createNode(i, x, y);
  if (!last) {
    node.prev = node;
    node.next = node;
  } else {
    node.next = last.next;
    node.prev = last;
    last.next.prev = node;
    last.next = node;
  }
  return node;
}

function removeNode(p: EarcutNode): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function signedArea(data: number[], start: number, end: number, dim: number): number {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; j = i, i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
  }
  return sum;
}

function equals(a: EarcutNode, b: EarcutNode): boolean {
  return a.x === b.x && a.y === b.y;
}

function area(p: EarcutNode, q: EarcutNode, r: EarcutNode): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

/** 消除孔洞:把每个孔洞通过桥边连接到外轮廓,形成单一简单多边形。 */
function eliminateHoles(
  data: number[],
  holeIndices: number[],
  outerNode: EarcutNode,
  dim: number,
): EarcutNode {
  const queue: EarcutNode[] = [];
  let start: number;
  let end: number;
  let list: EarcutNode | null;

  for (let i = 0, len = holeIndices.length; i < len; i++) {
    start = holeIndices[i] * dim;
    end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    list = linkedList(data, start, end, dim, false);
    if (list === null) continue;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }

  queue.sort(compareX);

  for (let i = 0; i < queue.length; i++) {
    eliminateHole(queue[i], outerNode);
    outerNode = filterPoints(outerNode, outerNode.next);
  }
  return outerNode;
}

function compareX(a: EarcutNode, b: EarcutNode): number {
  return a.x - b.x;
}

function getLeftmost(start: EarcutNode): EarcutNode {
  let p = start;
  let leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

/** 把一个孔洞通过桥边连接到外轮廓。 */
function eliminateHole(hole: EarcutNode, outerNode: EarcutNode): void {
  const bridgeNode = findHoleBridge(hole, outerNode);
  if (bridgeNode) {
    const bridge = splitBridge(bridgeNode, hole);
    filterPoints(bridgeNode, bridgeNode.next);
    filterPoints(bridge, bridge.next);
  }
}

/** 找到连接孔洞最左点到外轮廓的桥接点。 */
function findHoleBridge(hole: EarcutNode, outerNode: EarcutNode): EarcutNode | null {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let q: EarcutNode | null = null;
  // 沿外轮廓找与水平射线相交的边
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const xIntersect = (hx < (p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y)));
      if (xIntersect && q === null) q = p;
      if (hy !== p.y) {
        // 取距离更近的桥接点
        if (xIntersect && p.x >= (q?.x ?? -Infinity)) {
          // 取 x 较大者(更靠近孔洞)
        }
      }
      // 选择 x 最小且大于 hx 的桥接边
      if (xIntersect && (q === null || p.x > q.x)) {
        q = p;
      }
    }
    p = p.next;
  } while (p !== outerNode);

  if (!q) return null;
  return q;
}

/** 在桥接点处把外轮廓分裂,并将孔洞接入。 */
function splitBridge(a: EarcutNode, b: EarcutNode): EarcutNode {
  const a2 = createNode(a.i, a.x, a.y);
  const b2 = createNode(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;

  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;

  return b2;
}

/** 过滤共线或重复点,返回链表的有效起点。 */
function filterPoints(start: EarcutNode, end?: EarcutNode): EarcutNode {
  if (!start) return start;
  if (!end) end = start;

  let p = start;
  let again = false;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== end);
  return end;
}

/** 主体:递归 ear-clip 一个简单多边形。 */
function earcutLinked(
  ear: EarcutNode,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
  pass: number,
): void {
  if (!ear) return;

  if (pass === 0 && invSize > 0) indexCurve(ear, minX, minY, invSize);

  let stop = ear;
  let prev: EarcutNode;
  let next: EarcutNode;

  while (ear.prev !== ear.next) {
    prev = ear.prev;
    next = ear.next;

    if (invSize > 0 ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i / dim, ear.i / dim, next.i / dim);
      removeNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }

    ear = next;
    if (ear === stop) {
      if (pass === 0) {
        earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
      } else if (invSize > 0) {
        earcutLinkedHashed(ear, triangles, dim, minX, minY, invSize);
      }
      break;
    }
  }
}

function isEar(ear: EarcutNode): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;

  if (area(a, b, c) >= 0) return false;

  let p = ear.next.next;
  while (p !== ear.prev) {
    if (
      pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    ) {
      return false;
    }
    p = p.next;
  }
  return true;
}

function isEarHashed(ear: EarcutNode, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;

  if (area(a, b, c) >= 0) return false;

  const minTX = a.x < b.x ? (a.x < c.x ? a.x : c.x) : (b.x < c.x ? b.x : c.x);
  const minTY = a.y < b.y ? (a.y < c.y ? a.y : c.y) : (b.y < c.y ? b.y : c.y);
  const maxTX = a.x > b.x ? (a.x > c.x ? a.x : c.x) : (b.x > c.x ? b.x : c.x);
  const maxTY = a.y > b.y ? (a.y > c.y ? a.y : c.y) : (b.y > c.y ? b.y : c.y);

  const minZ = zOrder(minTX, minTY, minX, minY, invSize);
  const maxZ = zOrder(maxTX, maxTY, minX, minY, invSize);

  let p = ear.prevZ;
  let n = ear.nextZ;

  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (
      p !== ear.prev && p !== ear.next &&
      pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    ) {
      return false;
    }
    p = p.prevZ;

    if (
      n !== ear.prev && n !== ear.next &&
      pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
      area(n.prev, n, n.next) >= 0
    ) {
      return false;
    }
    n = n.nextZ;
  }

  while (p && p.z >= minZ) {
    if (
      p !== ear.prev && p !== ear.next &&
      pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    ) {
      return false;
    }
    p = p.prevZ;
  }

  while (n && n.z <= maxZ) {
    if (
      n !== ear.prev && n !== ear.next &&
      pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
      area(n.prev, n, n.next) >= 0
    ) {
      return false;
    }
    n = n.nextZ;
  }
  return true;
}

function earcutLinkedHashed(
  ear: EarcutNode,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
): void {
  let sorted = false;
  let p: EarcutNode;
  let ear0: EarcutNode = ear;

  for (let iterations = 0; iterations < 100000; iterations++) {
    if (!ear0.prev || ear0.next === ear0.prev) break;

    p = ear0;
    let processed = false;
    do {
      if (isEarHashed(p, minX, minY, invSize)) {
        triangles.push(p.prev.i / dim, p.i / dim, p.next.i / dim);
        removeNode(p);
        p = p.next;
        processed = true;
      } else {
        p = p.next;
      }
    } while (p !== ear0);

    if (!processed) {
      if (!sorted) {
        sortLinked(p);
        sorted = true;
      }
      // Try again
      let found = false;
      p = ear0;
      do {
        if (isEarHashed(p, minX, minY, invSize)) {
          found = true;
          break;
        }
        p = p.next;
      } while (p !== ear0);
      if (!found) break;
    } else {
      ear0 = p;
    }
  }
}

function sortLinked(list: EarcutNode): EarcutNode {
  let p: EarcutNode = list;
  const arr: EarcutNode[] = [];
  do {
    arr.push(p);
    p = p.next;
  } while (p !== list);
  arr.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

  for (let i = 0; i < arr.length; i++) {
    arr[i].nextZ = arr[i + 1] ?? null;
    arr[i].prevZ = arr[i - 1] ?? null;
  }
  return arr[0];
}

function indexCurve(start: EarcutNode, minX: number, minY: number, invSize: number): void {
  let p: EarcutNode = start;
  do {
    p.z = p.x === minX && p.y === minY ? 0 : zOrder(p.x, p.y, minX, minY, invSize);
    p = p.next;
  } while (p !== start);
}

function zOrder(x: number, y: number, minX: number, minY: number, invSize: number): number {
  x = (32767 * (x - minX) * invSize) | 0;
  y = (32767 * (y - minY) * invSize) | 0;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  y = (y | (y << 8)) & 0x00ff00ff;
  y = (y | (y << 4)) & 0x0f0f0f0f;
  y = (y | (y << 2)) & 0x33333333;
  y = (y | (y << 1)) & 0x55555555;
  return x | (y << 1);
}

function pointInTriangle(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  px: number, py: number,
): boolean {
  return (
    (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
    (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
    (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0
  );
}

/**
 * 计算倒角位移方向:返回沿角平分线方向的单位向量(指向形状外侧)。
 * 直接移植 three.js ExtrudeGeometry.getBevelVec。
 */
function getBevelVec(inPt: Vector2, inPrev: Vector2, inNext: Vector2): Vector2 {
  const v_prev_x = inPt.x - inPrev.x;
  const v_prev_y = inPt.y - inPrev.y;
  const v_next_x = inNext.x - inPt.x;
  const v_next_y = inNext.y - inPt.y;
  const v_prev_lensq = v_prev_x * v_prev_x + v_prev_y * v_prev_y;

  const collinear0 = v_prev_x * v_next_y - v_prev_y * v_next_x;

  if (Math.abs(collinear0) > Number.EPSILON) {
    // 非共线:求两条平移边的交点
    const v_prev_len = Math.sqrt(v_prev_lensq);
    const v_next_len = Math.sqrt(v_next_x * v_next_x + v_next_y * v_next_y);

    const ptPrevShift_x = inPrev.x - v_prev_y / v_prev_len;
    const ptPrevShift_y = inPrev.y + v_prev_x / v_prev_len;
    const ptNextShift_x = inNext.x - v_next_y / v_next_len;
    const ptNextShift_y = inNext.y + v_next_x / v_next_len;

    const sf =
      ((ptNextShift_x - ptPrevShift_x) * v_next_y -
        (ptNextShift_y - ptPrevShift_y) * v_next_x) /
      (v_prev_x * v_next_y - v_prev_y * v_next_x);

    let v_trans_x = ptPrevShift_x + v_prev_x * sf - inPt.x;
    let v_trans_y = ptPrevShift_y + v_prev_y * sf - inPt.y;

    const v_trans_lensq = v_trans_x * v_trans_x + v_trans_y * v_trans_y;
    if (v_trans_lensq <= 2) {
      return new Vector2(v_trans_x, v_trans_y);
    }
    const shrink_by = Math.sqrt(v_trans_lensq / 2);
    return new Vector2(v_trans_x / shrink_by, v_trans_y / shrink_by);
  }

  // 共线情况
  let direction_eq = false;
  if (v_prev_x > Number.EPSILON) {
    if (v_next_x > Number.EPSILON) direction_eq = true;
  } else if (v_prev_x < -Number.EPSILON) {
    if (v_next_x < -Number.EPSILON) direction_eq = true;
  } else {
    if (Math.sign(v_prev_y) === Math.sign(v_next_y)) direction_eq = true;
  }

  if (direction_eq) {
    // 同向直线:取左侧法向
    const shrink_by = Math.sqrt(v_prev_lensq);
    return new Vector2(-v_prev_y / shrink_by, v_prev_x / shrink_by);
  }
  // 反向尖刺
  const shrink_by = Math.sqrt(v_prev_lensq / 2);
  return new Vector2(v_prev_x / shrink_by, v_prev_y / shrink_by);
}
