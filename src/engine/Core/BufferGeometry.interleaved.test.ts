// BufferGeometry 交错属性集成测试 — 验证 setAttribute 接 InterleavedBufferAttribute
// 后,各遍历方法对交错布局透明工作。
//
// 核心断言:
//   • BufferGeometry 顶层 API 对 interleaved position/normal/uv 与 compact 等价:
//       computeBoundingBox / computeVertexNormals / computeTangents / applyMatrix4
//   • 产物 normal/tangent 永远是独立 compact BufferAttribute(three.js 语义,
//     计算产物脱离共享 buffer)
//   • toNonIndexed 把交错 indexed 几何展开为紧凑非索引,逐顶点数值正确
//   • clone 保留 interleaved 身份且共享底层 ib(去重)
//   • toJSON 输出 interleavedBuffers/arrayBuffers 去重字典
//   • hasAttribute 工作于两种属性
//
// 对比 soup3D:几何体属性为散列 list,无交错布局、无共享 buffer、无 toNonIndexed、
// 无计算法线/切线;VREEN BufferGeometry 透明支持三类承载类(CPU array / 交错 / GPU 句柄)
// 的统一遍历。

import { describe, it, expect } from 'vitest';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { InterleavedBuffer, InstancedInterleavedBuffer } from './InterleavedBuffer';
import { InterleavedBufferAttribute } from './InterleavedBufferAttribute';

const approximatelyEqual = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

/**
 * 构建一个与 makeIndexedQuad 等价的"交错版":position+normal+uv 三个属性共享一个
 * stride=8 的 InterleavedBuffer(offset 0/3/6)。数值与 compact 版逐顶点一致,便于对比。
 */
function makeInterleavedIndexedQuad(): BufferGeometry {
  // 4 顶点 × (pos3 + nrm3 + uv2) = 8 个 float/顶点
  const data = new Float32Array([
    // v0: pos(0,0,0) nrm(0,0,1) uv(0,0)
    0, 0, 0,  0, 0, 1,  0, 0,
    // v1: pos(1,0,0) nrm(0,0,1) uv(1,0)
    1, 0, 0,  0, 0, 1,  1, 0,
    // v2: pos(1,1,0) nrm(0,0,1) uv(1,1)
    1, 1, 0,  0, 0, 1,  1, 1,
    // v3: pos(0,1,0) nrm(0,0,1) uv(0,1)
    0, 1, 0,  0, 0, 1,  0, 1,
  ]);
  const ib = new InterleavedBuffer(data, 8);
  const position = new InterleavedBufferAttribute(ib, 3, 0);
  const normal = new InterleavedBufferAttribute(ib, 3, 3);
  const uv = new InterleavedBufferAttribute(ib, 2, 6);

  const g = new BufferGeometry();
  g.setAttribute('position', position);
  g.setAttribute('normal', normal);
  g.setAttribute('uv', uv);
  g.setIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  return g;
}

/**
 * 构建一个等价的 compact indexed quad(数值完全相同),作为对照基线。
 */
function makeCompactIndexedQuad(): BufferGeometry {
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

// ─────────────────────────────────────────────────────────────────────

describe('BufferGeometry — setAttribute 接接 InterleavedBufferAttribute', () => {
  it('getAttribute 返回 InterleavedBufferAttribute 实例', () => {
    const g = makeInterleavedIndexedQuad();
    const pos = g.getAttribute('position');
    expect(pos).toBeInstanceOf(InterleavedBufferAttribute);
    expect((pos as InterleavedBufferAttribute).isInterleavedBufferAttribute).toBe(true);
    expect(pos!.itemSize).toBe(3);
    expect(pos!.count).toBe(4);
  });

  it('hasAttribute 对交错属性工作', () => {
    const g = makeInterleavedIndexedQuad();
    expect(g.hasAttribute('position')).toBe(true);
    expect(g.hasAttribute('normal')).toBe(true);
    expect(g.hasAttribute('uv')).toBe(true);
    expect(g.hasAttribute('tangent')).toBe(false);
  });

  it('deleteAttribute 移除交错属性', () => {
    const g = makeInterleavedIndexedQuad();
    g.deleteAttribute('normal');
    expect(g.hasAttribute('normal')).toBe(false);
    expect(g.hasAttribute('position')).toBe(true);
  });
});

describe('BufferGeometry — computeBoundingBox 对交错 position 透明', () => {
  it('包围盒与 compact 版逐分量一致', () => {
    const gi = makeInterleavedIndexedQuad();
    const gc = makeCompactIndexedQuad();
    gi.computeBoundingBox();
    gc.computeBoundingBox();
    expect(gi.boundingBox).toBeDefined();
    expect(approximatelyEqual(gi.boundingBox!.min.x, gc.boundingBox!.min.x)).toBe(true);
    expect(approximatelyEqual(gi.boundingBox!.max.x, gc.boundingBox!.max.x)).toBe(true);
    expect(approximatelyEqual(gi.boundingBox!.min.y, gc.boundingBox!.min.y)).toBe(true);
    expect(approximatelyEqual(gi.boundingBox!.max.y, gc.boundingBox!.max.y)).toBe(true);
    // z 全 0
    expect(approximatelyEqual(gi.boundingBox!.max.z, 0)).toBe(true);
  });
});

describe('BufferGeometry — computeVertexNormals 对交错 position 透明', () => {
  it('从交错 position 生成法线,产物为独立 compact BufferAttribute', () => {
    // 新建一个只有交错 position 的几何(normal 待生成)
    const data = new Float32Array([
      0, 0, 0,  0, 0, 1,  0, 0,  // v0 pos, 占位 nrm(忽略), 占位
      1, 0, 0,  0, 0, 1,  0, 0,
      1, 1, 0,  0, 0, 1,  0, 0,
      0, 1, 0,  0, 0, 1,  0, 0,
    ]);
    const ib = new InterleavedBuffer(data, 8);
    const g = new BufferGeometry();
    g.setAttribute('position', new InterleavedBufferAttribute(ib, 3, 0));
    g.setIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    g.computeVertexNormals();

    const n = g.getAttribute('normal');
    expect(n).toBeInstanceOf(BufferAttribute);
    expect((n as BufferAttribute).itemSize).toBe(3);
    const arr = (n as BufferAttribute).array as Float32Array;
    // XY 平面四边形 → 法线沿 +z
    for (let i = 0; i < 4; i++) {
      expect(approximatelyEqual(arr[i * 3], 0)).toBe(true);
      expect(approximatelyEqual(arr[i * 3 + 1], 0)).toBe(true);
      expect(approximatelyEqual(arr[i * 3 + 2], 1)).toBe(true);
    }
  });

  it('交错 position 与 compact position 生成的法线逐顶点一致', () => {
    // compact 版
    const gc = makeCompactIndexedQuad();
    gc.computeVertexNormals();
    // interleaved 版(删 normal 让它重算)
    const gi = makeInterleavedIndexedQuad();
    gi.deleteAttribute('normal');
    gi.computeVertexNormals();

    const a = (gc.getAttribute('normal') as BufferAttribute).array as Float32Array;
    const b = (gi.getAttribute('normal') as BufferAttribute).array as Float32Array;
    for (let i = 0; i < 12; i++) {
      expect(approximatelyEqual(a[i], b[i])).toBe(true);
    }
  });
});

describe('BufferGeometry — computeTangents 对交错 position/normal/uv 透明', () => {
  it('从交错属性生成切线,产物 vec4,与 compact 版逐顶点一致', () => {
    const gc = makeCompactIndexedQuad();
    gc.computeTangents();
    const gi = makeInterleavedIndexedQuad();
    gi.computeTangents();

    const ti = gi.getAttribute('tangent');
    expect(ti).toBeInstanceOf(BufferAttribute);
    expect((ti as BufferAttribute).itemSize).toBe(4);

    const a = (gc.getAttribute('tangent') as BufferAttribute).array as Float32Array;
    const b = (ti as BufferAttribute).array as Float32Array;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(approximatelyEqual(a[i], b[i], 1e-5)).toBe(true);
    }
    // 切线沿 +u(+x),手性 +1(标准 UV 布局)
    for (let i = 0; i < 4; i++) {
      expect(b[i * 4]).toBeGreaterThan(0.5);
      expect(approximatelyEqual(b[i * 4 + 3], 1)).toBe(true);
    }
  });
});

describe('BufferGeometry — applyMatrix4 对交错 position 透明', () => {
  it('平移交错 position,共享 buffer 被原地改写', () => {
    const gi = makeInterleavedIndexedQuad();
    const pos = gi.getAttribute('position') as InterleavedBufferAttribute;
    const ib = pos.data;

    gi.applyMatrix4({ elements: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      5, 6, 7, 1,
    ]) } as unknown as { elements: Float32Array });

    // 顶点0 pos(0,0,0) → (5,6,7),在 array[0,1,2]
    expect(ib.array[0]).toBe(5);
    expect(ib.array[1]).toBe(6);
    expect(ib.array[2]).toBe(7);
    // 顶点1 pos(1,0,0) → (6,6,7),在 array[8,9,10](stride=8)
    expect(ib.array[8]).toBe(1 + 5);
    expect(ib.array[9]).toBe(0 + 6);
    expect(ib.array[10]).toBe(0 + 7);
    // normal 分量(offset 3..5)不应被 applyMatrix4 触碰
    expect(ib.array[3]).toBe(0);
    expect(ib.array[4]).toBe(0);
    expect(ib.array[5]).toBe(1);
  });
});

describe('BufferGeometry — toNonIndexed 展开交错几何', () => {
  it('把交错 indexed quad 展开为紧凑非索引,6 顶点逐分量正确', () => {
    const gi = makeInterleavedIndexedQuad();
    const non = gi.toNonIndexed();
    expect(non.index).toBeNull();
    const pos = non.getAttribute('position') as BufferAttribute;
    expect(pos).toBeInstanceOf(BufferAttribute);
    expect(pos.count).toBe(6); // 2 三角形 × 3
    const p = pos.array as Float32Array;
    // 索引 [0,1,2,0,2,3] → 顶点序列 (0,0,0)(1,0,0)(1,1,0)(0,0,0)(1,1,0)(0,1,0)
    const expected = [
      0, 0, 0,  1, 0, 0,  1, 1, 0,
      0, 0, 0,  1, 1, 0,  0, 1, 0,
    ];
    for (let i = 0; i < 18; i++) {
      expect(approximatelyEqual(p[i], expected[i])).toBe(true);
    }
  });

  it('展开后 normal/uv 也被正确 de-interleave 到独立紧凑 array', () => {
    const gi = makeInterleavedIndexedQuad();
    const non = gi.toNonIndexed();
    const nrm = (non.getAttribute('normal') as BufferAttribute).array as Float32Array;
    const uv = (non.getAttribute('uv') as BufferAttribute).array as Float32Array;
    // 6 顶点 normal 全 +z
    for (let i = 0; i < 6; i++) {
      expect(approximatelyEqual(nrm[i * 3 + 2], 1)).toBe(true);
    }
    // uv 按 [0,1,2,0,2,3] 展开
    const expectedUV = [
      0, 0,  1, 0,  1, 1,
      0, 0,  1, 1,  0, 1,
    ];
    for (let i = 0; i < 12; i++) {
      expect(approximatelyEqual(uv[i], expectedUV[i])).toBe(true);
    }
  });

  it('非索引几何调用 toNonIndexed 返回 this(已是非索引)', () => {
    const gi = makeInterleavedIndexedQuad();
    const already = gi.toNonIndexed(); // indexed → non-indexed
    const again = already.toNonIndexed(); // 再次调用应返回自身
    expect(again).toBe(already);
  });
});

describe('BufferGeometry — clone 保留交错语义且共享底层 ib', () => {
  it('clone 的属性仍为 InterleavedBufferAttribute,data 与原 ib 不同(深拷贝)', () => {
    const gi = makeInterleavedIndexedQuad();
    const c = gi.clone();
    const posC = c.getAttribute('position') as InterleavedBufferAttribute;
    const posOrig = gi.getAttribute('position') as InterleavedBufferAttribute;
    expect(posC.isInterleavedBufferAttribute).toBe(true);
    expect(posC.data).not.toBe(posOrig.data); // 深拷贝 buffer
    expect(posC.offset).toBe(posOrig.offset);
    expect(posC.itemSize).toBe(posOrig.itemSize);
    // 数值一致
    for (let i = 0; i < 4; i++) {
      expect(posC.getX(i)).toBe(posOrig.getX(i));
    }
  });

  it('clone 共享底层 ib:position/normal 复用同一克隆 buffer', () => {
    const gi = makeInterleavedIndexedQuad();
    const c = gi.clone();
    const posC = c.getAttribute('position') as InterleavedBufferAttribute;
    const nrmC = c.getAttribute('normal') as InterleavedBufferAttribute;
    expect(posC.data).toBe(nrmC.data); // 同一克隆 ib
  });

  it('克隆后改写不影响源(深度隔离)', () => {
    const gi = makeInterleavedIndexedQuad();
    const c = gi.clone();
    const posC = c.getAttribute('position') as InterleavedBufferAttribute;
    posC.setX(0, 999);
    const posOrig = gi.getAttribute('position') as InterleavedBufferAttribute;
    expect(posOrig.getX(0)).toBe(0);
  });
});

describe('BufferGeometry — toJSON 输出交错去重字典', () => {
  it('交错几何 toJSON 含 interleavedBuffers 与 arrayBuffers 顶层分类', () => {
    const gi = makeInterleavedIndexedQuad();
    const json = gi.toJSON();
    const attrs = json.attributes as Record<string, unknown>;
    // 三属性都是 interleaved 引用式
    expect((attrs.position as { isInterleavedBufferAttribute: boolean }).isInterleavedBufferAttribute).toBe(true);
    expect((attrs.normal as { isInterleavedBufferAttribute: boolean }).isInterleavedBufferAttribute).toBe(true);
    expect((attrs.uv as { isInterleavedBufferAttribute: boolean }).isInterleavedBufferAttribute).toBe(true);
    // 顶层去重字典存在
    expect(json.interleavedBuffers).toBeDefined();
    expect(json.arrayBuffers).toBeDefined();
    // 只有一份 ib(3 属性共享)
    expect(Object.keys(json.interleavedBuffers as object).length).toBe(1);
    // 只有一份底层 ArrayBuffer
    expect(Object.keys(json.arrayBuffers as object).length).toBe(1);
  });

  it('compact 几何 toJSON 不含去重字典(向后兼容既有形态)', () => {
    const gc = makeCompactIndexedQuad();
    const json = gc.toJSON();
    expect(json.interleavedBuffers).toBeUndefined();
    expect(json.arrayBuffers).toBeUndefined();
    const attrs = json.attributes as Record<string, unknown>;
    expect((attrs.position as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute).toBeUndefined();
    expect(Array.isArray((attrs.position as { array: number[] }).array)).toBe(true);
  });
});

describe('BufferGeometry — dispose 对交错属性走 needsUpdate', () => {
  it('dispose 不抛错,交错属性经 needsUpdate 标脏底层 buffer', () => {
    const gi = makeInterleavedIndexedQuad();
    const ib = (gi.getAttribute('position') as InterleavedBufferAttribute).data;
    const v0 = ib.version;
    gi.dispose();
    expect(ib.version).toBeGreaterThan(v0);
  });
});

describe('BufferGeometry — InstancedInterleavedBuffer 也可挂载', () => {
  it('InstancedInterleavedBuffer + InterleavedBufferAttribute 可在 setAttribute 中存活', () => {
    const data = new Float32Array([0, 0, 0, 1, 1, 1]);
    const iib = new InstancedInterleavedBuffer(data, 3, 1);
    const attr = new InterleavedBufferAttribute(iib, 3, 0);
    const g = new BufferGeometry();
    g.setAttribute('instanceOffset', attr);
    const got = g.getAttribute('instanceOffset') as InterleavedBufferAttribute;
    expect(got.isInterleavedBufferAttribute).toBe(true);
    expect(got.count).toBe(2);
    // InstancedInterleavedBuffer 仍是 InterleavedBuffer 子类,meshPerAttribute 保留
    expect((got.data as InstancedInterleavedBuffer).meshPerAttribute).toBe(1);
  });
});
