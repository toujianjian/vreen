// BufferGeometry 测试 — 核心几何体容器与 MikkTSpace 切线空间计算。
//
// 验证:
//   • computeTangents():MikkTSpace 切线空间生成
//     - 缺少属性时安全跳过
//     - 简单三角形/索引四边形生成切线
//     - 切线与法线正交
//     - 切线单位化(长度 = 1)
//     - 切线方向与 UV 方向一致
//     - 手性符号 (w = ±1) 正确
//     - 退化 UV 回退到 identity deltas
//     - 镜像 UV 处理
//     - itemSize = 4 (vec4 with handedness w)
//   • clone(): 深拷贝属性与索引
//   • computeVertexNormals(): 索引/非索引法线生成

import { describe, it, expect } from 'vitest';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';

/** 构建一个简单的非索引三角形。 */
function makeTriangle(
  p0: number[], p1: number[], p2: number[],
  uv0: number[] = [0, 0], uv1: number[] = [1, 0], uv2: number[] = [0, 1],
): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([...p0, ...p1, ...p2]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([...uv0, ...uv1, ...uv2]), 2));
  return g;
}

/** 构建一个索引四边形(2 三角形),UV 沿 +u/+v 方向。 */
function makeIndexedQuad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
  ]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
  ]), 2));
  g.setIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  return g;
}

const approximatelyEqual = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ─────────────────────────────────────────────────────────────────────

describe('BufferGeometry — computeTangents (MikkTSpace)', () => {
  it('缺少 position 时安全跳过', () => {
    const g = new BufferGeometry();
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0]), 2));
    expect(() => g.computeTangents()).not.toThrow();
    expect(g.attributes.tangent).toBeUndefined();
  });

  it('缺少 normal 时安全跳过', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0]), 2));
    expect(() => g.computeTangents()).not.toThrow();
    expect(g.attributes.tangent).toBeUndefined();
  });

  it('缺少 uv 时安全跳过', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1]), 3));
    expect(() => g.computeTangents()).not.toThrow();
    expect(g.attributes.tangent).toBeUndefined();
  });

  it('生成 tangent 属性 (itemSize = 4)', () => {
    const g = makeTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    g.computeTangents();
    const tan = g.attributes.tangent;
    expect(tan).toBeDefined();
    expect(tan.itemSize).toBe(4);
    expect(tan.count).toBe(3); // 3 顶点
  });

  it('索引四边形生成 4 顶点切线', () => {
    const g = makeIndexedQuad();
    g.computeTangents();
    const tan = g.attributes.tangent;
    expect(tan.count).toBe(4);
    expect(tan.array.length).toBe(4 * 4); // 4 顶点 × vec4
  });

  it('切线与法线正交 (dot ≈ 0)', () => {
    const g = makeIndexedQuad();
    g.computeTangents();
    const n = g.attributes.normal.array;
    const t = g.attributes.tangent.array;
    for (let i = 0; i < 4; i++) {
      const dot = n[i * 3] * t[i * 4] + n[i * 3 + 1] * t[i * 4 + 1] + n[i * 3 + 2] * t[i * 4 + 2];
      expect(approximatelyEqual(dot, 0, 1e-5)).toBe(true);
    }
  });

  it('切线单位化 (长度 ≈ 1)', () => {
    const g = makeIndexedQuad();
    g.computeTangents();
    const t = g.attributes.tangent.array;
    for (let i = 0; i < 4; i++) {
      const len = Math.hypot(t[i * 4], t[i * 4 + 1], t[i * 4 + 2]);
      expect(approximatelyEqual(len, 1, 1e-5)).toBe(true);
    }
  });

  it('切线方向沿 +u (UV.x 增长方向)', () => {
    // 四边形:position 沿 +x,UV 沿 +u → 切线应为 +x
    const g = makeIndexedQuad();
    g.computeTangents();
    const t = g.attributes.tangent.array;
    // 4 个顶点的切线 .x 都应为正(沿 +x 方向)
    for (let i = 0; i < 4; i++) {
      expect(t[i * 4]).toBeGreaterThan(0.5);
      expect(approximatelyEqual(t[i * 4 + 1], 0, 1e-5)).toBe(true); // y ≈ 0
      expect(approximatelyEqual(t[i * 4 + 2], 0, 1e-5)).toBe(true); // z ≈ 0
    }
  });

  it('手性符号 w = ±1', () => {
    const g = makeIndexedQuad();
    g.computeTangents();
    const t = g.attributes.tangent.array;
    for (let i = 0; i < 4; i++) {
      const w = t[i * 4 + 3];
      expect(Math.abs(w)).toBe(1);
    }
  });

  it('标准 UV 布局手性为 +1', () => {
    // 标准非镜像 UV:切线沿 +x,副切线沿 +y,法线沿 +z → 右手系 → w = +1
    const g = makeIndexedQuad();
    g.computeTangents();
    const t = g.attributes.tangent.array;
    for (let i = 0; i < 4; i++) {
      expect(t[i * 4 + 3]).toBe(1);
    }
  });

  it('镜像 UV (沿 u 翻转) 导致手性为 -1', () => {
    // 翻转 UV 的 u 分量 → 切线方向反转或手性翻转
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([
      0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
    ]), 3));
    // 镜像 u: 0↔1
    g.setAttribute('uv', new BufferAttribute(new Float32Array([
      1, 0,  0, 0,  0, 1,  1, 1,
    ]), 2));
    g.setIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    g.computeTangents();
    const t = g.attributes.tangent.array;
    // 镜像后切线方向反转(沿 -x),手性应为 -1
    for (let i = 0; i < 4; i++) {
      expect(t[i * 4]).toBeLessThan(-0.5); // 切线沿 -x
      expect(t[i * 4 + 3]).toBe(-1);       // 手性翻转
    }
  });

  it('退化 UV (零面积) 回退到 identity deltas', () => {
    // 三个顶点 UV 相同 → det = 0 → 回退到 identity
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([
      0, 0, 1,  0, 0, 1,  0, 0, 1,
    ]), 3));
    // 全部相同 UV → 退化
    g.setAttribute('uv', new BufferAttribute(new Float32Array([
      0.5, 0.5,  0.5, 0.5,  0.5, 0.5,
    ]), 2));
    g.computeTangents();
    const t = g.attributes.tangent.array;
    // 回退后切线仍应有效(单位化、与法线正交)
    for (let i = 0; i < 3; i++) {
      const len = Math.hypot(t[i * 4], t[i * 4 + 1], t[i * 4 + 2]);
      expect(approximatelyEqual(len, 1, 1e-5)).toBe(true);
    }
  });

  it('非索引三角形与索引三角形结果一致(同拓扑)', () => {
    // 同一个三角形,索引与非索引版本应生成相同切线
    const gNonIndexed = makeTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    gNonIndexed.computeTangents();

    const gIndexed = new BufferGeometry();
    gIndexed.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
    ]), 3));
    gIndexed.setAttribute('normal', new BufferAttribute(new Float32Array([
      0, 0, 1,  0, 0, 1,  0, 0, 1,
    ]), 3));
    gIndexed.setAttribute('uv', new BufferAttribute(new Float32Array([
      0, 0,  1, 0,  0, 1,
    ]), 2));
    gIndexed.setIndex(new Uint16Array([0, 1, 2]));
    gIndexed.computeTangents();

    const a = gNonIndexed.attributes.tangent.array;
    const b = gIndexed.attributes.tangent.array;
    for (let i = 0; i < 12; i++) {
      expect(approximatelyEqual(a[i], b[i], 1e-6)).toBe(true);
    }
  });

  it('切线版本号递增', () => {
    const g = makeIndexedQuad();
    g.computeTangents();
    expect(g.attributes.tangent.version).toBeGreaterThanOrEqual(1);
  });

  it('多次调用 computeTangents 幂等(覆盖旧值)', () => {
    const g = makeIndexedQuad();
    g.computeTangents();
    const first = Float32Array.from(g.attributes.tangent.array);
    g.computeTangents();
    const second = g.attributes.tangent.array;
    for (let i = 0; i < first.length; i++) {
      expect(approximatelyEqual(first[i], second[i], 1e-6)).toBe(true);
    }
  });

  it('3D 立方体切线与法线正交', () => {
    // 简化立方体(每面 2 三角形,8 顶点)
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      // 前 (z = 1)
      -1, -1,  1,   1, -1,  1,   1,  1,  1,  -1,  1,  1,
      // 后 (z = -1)
      -1, -1, -1,   1, -1, -1,   1,  1, -1,  -1,  1, -1,
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([
      0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    ]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([
      0, 0,  1, 0,  1, 1,  0, 1,
      0, 0,  1, 0,  1, 1,  0, 1,
    ]), 2));
    g.setIndex(new Uint16Array([
      0, 1, 2,  0, 2, 3,   // 前
      4, 6, 5,  4, 7, 6,   // 后(翻转绕序保持法线朝外)
    ]));
    g.computeTangents();
    const n = g.attributes.normal.array;
    const t = g.attributes.tangent.array;
    for (let i = 0; i < 8; i++) {
      const dot = n[i * 3] * t[i * 4] + n[i * 3 + 1] * t[i * 4 + 1] + n[i * 3 + 2] * t[i * 4 + 2];
      expect(approximatelyEqual(dot, 0, 1e-5)).toBe(true);
      const len = Math.hypot(t[i * 4], t[i * 4 + 1], t[i * 4 + 2]);
      expect(approximatelyEqual(len, 1, 1e-5)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('BufferGeometry — clone', () => {
  it('深拷贝所有属性', () => {
    const g = makeIndexedQuad();
    g.computeTangents();
    const c = g.clone();
    expect(c).not.toBe(g);
    expect(c.attributes.position).not.toBe(g.attributes.position);
    expect(c.attributes.position.array).not.toBe(g.attributes.position.array);
    expect(c.attributes.tangent).toBeDefined();
    expect(c.attributes.tangent.array).not.toBe(g.attributes.tangent.array);
    // 值相同
    for (let i = 0; i < g.attributes.position.array.length; i++) {
      expect(c.attributes.position.array[i]).toBe(g.attributes.position.array[i]);
    }
  });

  it('深拷贝索引', () => {
    const g = makeIndexedQuad();
    const c = g.clone();
    expect(c.index).not.toBe(g.index);
    expect(c.index!.array).not.toBe(g.index!.array);
  });

  it('拷贝 groups 与 boundingBox', () => {
    const g = makeIndexedQuad();
    g.addGroup(0, 6, 0);
    g.computeBoundingBox();
    const c = g.clone();
    expect(c.groups.length).toBe(1);
    expect(c.groups[0]).toEqual(g.groups[0]);
    expect(c.boundingBox).toBeDefined();
    expect(c.boundingBox!.min.x).toBe(g.boundingBox!.min.x);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('BufferGeometry — computeVertexNormals', () => {
  it('索引四边形生成法线', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    ]), 3));
    g.setIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    g.computeVertexNormals();
    const n = g.attributes.normal.array;
    // XY 平面四边形 → 法线沿 +z
    for (let i = 0; i < 4; i++) {
      expect(approximatelyEqual(n[i * 3], 0, 1e-5)).toBe(true);
      expect(approximatelyEqual(n[i * 3 + 1], 0, 1e-5)).toBe(true);
      expect(approximatelyEqual(n[i * 3 + 2], 1, 1e-5)).toBe(true);
    }
  });

  it('非索引三角形生成法线', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
    ]), 3));
    g.computeVertexNormals();
    const n = g.attributes.normal.array;
    for (let i = 0; i < 3; i++) {
      expect(approximatelyEqual(n[i * 3 + 2], 1, 1e-5)).toBe(true);
    }
  });
});
