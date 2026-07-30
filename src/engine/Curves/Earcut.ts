// Earcut — 多边形三角剖分,适配自 three.js src/extras/Earcut.js (MIT)。
// 移植自 https://github.com/mapbox/earcut (v2.2.4)。
// 输入扁平坐标数组 + 孔洞起始下标,输出三角形顶点索引数组。

interface EarcutNode {
  i: number;
  x: number;
  y: number;
  prev: EarcutNode;
  next: EarcutNode;
  z: number;
  prevZ: EarcutNode | null;
  nextZ: EarcutNode | null;
  steiner: boolean;
}

function createNode(i: number, x: number, y: number): EarcutNode {
  return {
    i, x, y,
    prev: null as unknown as EarcutNode,
    next: null as unknown as EarcutNode,
    z: 0,
    prevZ: null,
    nextZ: null,
    steiner: false,
  };
}

function removeNode(p: EarcutNode): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function insertNode(i: number, x: number, y: number, last: EarcutNode | null): EarcutNode {
  const p = createNode(i, x, y);
  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

function signedArea(data: ArrayLike<number>, start: number, end: number, dim: number): number {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

function linkedList(data: ArrayLike<number>, start: number, end: number, dim: number, clockwise: boolean): EarcutNode | null {
  let last: EarcutNode | null = null;
  if (clockwise === (signedArea(data, start, end, dim) > 0)) {
    for (let i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
  }
  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

function equals(p1: EarcutNode, p2: EarcutNode): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

function area(p: EarcutNode, q: EarcutNode, r: EarcutNode): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function filterPoints(start: EarcutNode, end?: EarcutNode): EarcutNode {
  if (!start) return start;
  if (!end) end = start;
  let p = start;
  let again: boolean;
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

function pointInTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
         (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
         (bx - px) * (cy - py) >= (cx - px) * (by - py);
}

function isEar(ear: EarcutNode): boolean {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  const x0 = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx);
  const y0 = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
  const x1 = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx);
  const y1 = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
  let p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}

function zOrder(x: number, y: number, minX: number, minY: number, invSize: number): number {
  x = ((x - minX) * invSize) | 0;
  y = ((y - minY) * invSize) | 0;
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

function isEarHashed(ear: EarcutNode, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  const x0 = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx);
  const y0 = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
  const x1 = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx);
  const y1 = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
  const minZ = zOrder(x0, y0, minX, minY, invSize);
  const maxZ = zOrder(x1, y1, minX, minY, invSize);
  let p = ear.prevZ;
  let n = ear.nextZ;
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }
  while (p && p.z >= minZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
  }
  while (n && n.z <= maxZ) {
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }
  return true;
}

function sortLinked(list: EarcutNode | null): EarcutNode | null {
  let inSize = 1;
  let numMerges: number;
  do {
    let p: EarcutNode | null = list;
    list = null;
    let tail: EarcutNode | null = null;
    numMerges = 0;
    while (p) {
      numMerges++;
      let q: EarcutNode | null = p;
      let pSize = 0;
      for (let i = 0; i < inSize; i++) {
        pSize++;
        q = q!.nextZ;
        if (!q) break;
      }
      let qSize = inSize;
      while (pSize > 0 || (qSize > 0 && q)) {
        let e: EarcutNode;
        if (pSize !== 0 && (qSize === 0 || !q || p!.z <= q.z)) {
          e = p!;
          p = p!.nextZ;
          pSize--;
        } else {
          e = q!;
          q = q!.nextZ;
          qSize--;
        }
        if (tail) tail.nextZ = e;
        else list = e;
        e.prevZ = tail;
        tail = e;
      }
      p = q;
    }
    if (tail) tail.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);
  return list;
}

function indexCurve(start: EarcutNode, minX: number, minY: number, invSize: number): void {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);
  if (p.prevZ) p.prevZ.nextZ = null;
  p.prevZ = null;
  sortLinked(p);
}

function sign(num: number): number {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}

function onSegment(p: EarcutNode, q: EarcutNode, r: EarcutNode): boolean {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
         q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

function intersects(p1: EarcutNode, q1: EarcutNode, p2: EarcutNode, q2: EarcutNode): boolean {
  const o1 = sign(area(p1, q1, p2));
  const o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1));
  const o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function locallyInside(a: EarcutNode, b: EarcutNode): boolean {
  return area(a.prev, a, a.next) < 0
    ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
    : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a: EarcutNode, b: EarcutNode): boolean {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
      (px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x)) {
      inside = !inside;
    }
    p = p.next;
  } while (p !== a);
  return inside;
}

function isValidDiagonal(a: EarcutNode, b: EarcutNode): boolean {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
    (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
      (area(a.prev, a, b.prev) !== 0 || area(a, b.prev, b) !== 0) ||
      equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
}

function intersectsPolygon(a: EarcutNode, b: EarcutNode): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
      intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}

function splitPolygon(a: EarcutNode, b: EarcutNode): EarcutNode {
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

function getLeftmost(start: EarcutNode): EarcutNode {
  let p = start;
  let leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

function findHoleBridge(hole: EarcutNode, outerNode: EarcutNode): EarcutNode | null {
  let p = outerNode;
  let qx = -Infinity;
  let m: EarcutNode | null = null;
  const hx = hole.x;
  const hy = hole.y;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m) return null;
  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;
  let tan: number;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

function sectorContainsSector(m: EarcutNode, p: EarcutNode): boolean {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

function eliminateHole(hole: EarcutNode, outerNode: EarcutNode): EarcutNode {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}

function eliminateHoles(data: ArrayLike<number>, holeIndices: number[], outerNode: EarcutNode, dim: number): EarcutNode {
  const queue: EarcutNode[] = [];
  for (let i = 0, len = holeIndices.length; i < len; i++) {
    const start = holeIndices[i] * dim;
    const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    let list = linkedList(data, start, end, dim, false);
    if (list) {
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
  }
  queue.sort((a, b) => a.x - b.x);
  for (let i = 0; i < queue.length; i++) {
    outerNode = eliminateHole(queue[i], outerNode);
  }
  return outerNode;
}

function splitEarcut(start: EarcutNode, triangles: number[], dim: number, minX: number, minY: number, invSize: number): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        const c = splitPolygon(a, b);
        a = filterPoints(a, a.next);
        const c2 = filterPoints(c, c.next);
        earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c2, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function cureLocalIntersections(start: EarcutNode, triangles: number[], dim: number): EarcutNode {
  let p = start;
  do {
    const a = p.prev;
    const b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push((a.i / dim) | 0);
      triangles.push((p.i / dim) | 0);
      triangles.push((b.i / dim) | 0);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}

function earcutLinked(ear: EarcutNode | null, triangles: number[], dim: number, minX: number, minY: number, invSize: number, pass: number): void {
  if (!ear) return;
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
  let stop = ear;
  let prev: EarcutNode;
  let next: EarcutNode;
  while (ear.prev !== ear.next) {
    prev = ear.prev;
    next = ear.next;
    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push((prev.i / dim) | 0);
      triangles.push((ear.i / dim) | 0);
      triangles.push((next.i / dim) | 0);
      removeNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) {
        earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
      } else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
        earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
      } else if (pass === 2) {
        splitEarcut(ear, triangles, dim, minX, minY, invSize);
      }
      break;
    }
  }
}

export const Earcut = {
  /**
   * 三角剖分。
   * @param data 扁平坐标 [x0,y0, x1,y1, ...]
   * @param holeIndices 各孔洞在 data 中的起始顶点索引
   * @param dim 每个顶点的分量数 (默认 2)
   * @returns 三角形顶点索引数组 [i0,i1,i2, ...]
   */
  triangulate(data: ArrayLike<number>, holeIndices?: number[], dim = 2): number[] {
    const hasHoles = holeIndices && holeIndices.length;
    const outerLen = hasHoles ? holeIndices![0] * dim : data.length;
    let outerNode = linkedList(data, 0, outerLen, dim, true);
    const triangles: number[] = [];
    if (!outerNode || outerNode.next === outerNode.prev) return triangles;
    let minX = 0, minY = 0, maxX = 0, maxY = 0, x = 0, y = 0, invSize = 0;
    if (hasHoles) outerNode = eliminateHoles(data, holeIndices!, outerNode, dim);
    if (data.length > 80 * dim) {
      minX = maxX = data[0];
      minY = maxY = data[1];
      for (let i = dim; i < outerLen; i += dim) {
        x = data[i];
        y = data[i + 1];
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
  },
};
