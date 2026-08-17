// InterleavedBufferAttribute 测试 — 交错顶点属性切片(引用共享 InterleavedBuffer)。
//
// 验证(three.js r169 InterleavedBufferAttribute 契约):
//   • 构造:持 data/itemSize/offset/normalized;count/array/needsUpdate 代理到底层 buffer
//   • getX/Y/Z/W 与 setX/Y/Z/W 按 index*stride+offset 寻址(非 index*itemSize)
//   • setXYZ/getComponent 连续分量写入(同一属性分量在 stride 内连续)
//   • normalized 量化往返:setX(normalize) ↔ getX(denormalize) 与 MathUtils 一致
//   • clone 无参 → de-interleave 为独立 BufferAttribute(断共享)
//   • clone 带 data → 复用同一底层 InterleavedBuffer(ib uuid 去重)
//   • toJSON 无参 → de-interleave 平坦 JSON
//   • toJSON 带 meta → 引用式 JSON(isInterleavedBufferAttribute + data uuid + offset)
//   • applyMatrix4 按交错寻址变换 position(itemSize=3)
//
// 对比 soup3D:无任何交错/量化/共享缓冲概念,属性为散列 Python list,本类一次 GPU
// fetch 拿整顶点 + 量化省显存 + 多属性共享 buffer 省 VBO 切换。

import { describe, it, expect } from 'vitest';
import { InterleavedBuffer } from './InterleavedBuffer';
import { InterleavedBufferAttribute } from './InterleavedBufferAttribute';
import { BufferAttribute } from './BufferAttribute';
import { Matrix4 } from '../Math/Matrix4';

const approximatelyEqual = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

/** 构建典型交错布局:position(itemSize3,offset0)+ normal(itemSize3,offset3),stride=6。 */
function makeInterleavedPN() {
  // 两顶点:pos0=(0,0,0) nrm0=(1,0,0); pos1=(1,2,3) nrm1=(0,1,0)
  const array = new Float32Array([
    0, 0, 0,  1, 0, 0,
    1, 2, 3,  0, 1, 0,
  ]);
  const ib = new InterleavedBuffer(array, 6);
  const position = new InterleavedBufferAttribute(ib, 3, 0);
  const normal = new InterleavedBufferAttribute(ib, 3, 3);
  return { array, ib, position, normal };
}

describe('InterleavedBufferAttribute — 构造与代理', () => {
  it('持有 data/itemSize/offset,默认 normalized=false', () => {
    const { ib, position } = makeInterleavedPN();
    expect(position.isInterleavedBufferAttribute).toBe(true);
    expect(position.data).toBe(ib);
    expect(position.itemSize).toBe(3);
    expect(position.offset).toBe(0);
    expect(position.normalized).toBe(false);
  });

  it('count 代理到 data.count(array.length/stride)', () => {
    const { position } = makeInterleavedPN();
    expect(position.count).toBe(2);
  });

  it('array getter 返回底层共享 TypedArray', () => {
    const { array, position } = makeInterleavedPN();
    expect(position.array).toBe(array);
  });

  it('needsUpdate 转发到底层 buffer(自增 version)', () => {
    const { ib, position } = makeInterleavedPN();
    const v0 = ib.version;
    position.needsUpdate = true;
    expect(ib.version).toBe(v0 + 1);
  });
});

describe('InterleavedBufferAttribute — getX/Y/Z 按 stride+offset 寻址', () => {
  it('getX/Y/Z 读 position(offset=0)', () => {
    const { position } = makeInterleavedPN();
    expect(position.getX(0)).toBe(0);
    expect(position.getY(0)).toBe(0);
    expect(position.getZ(0)).toBe(0);
    expect(position.getX(1)).toBe(1);
    expect(position.getY(1)).toBe(2);
    expect(position.getZ(1)).toBe(3);
  });

  it('getX/Y/Z 读 normal(offset=3):跨过 position 分量', () => {
    const { normal } = makeInterleavedPN();
    expect(normal.getX(0)).toBe(1);
    expect(normal.getY(0)).toBe(0);
    expect(normal.getZ(0)).toBe(0);
    expect(normal.getX(1)).toBe(0);
    expect(normal.getY(1)).toBe(1);
    expect(normal.getZ(1)).toBe(0);
  });

  it('与等效 compact BufferAttribute 逐顶点值一致', () => {
    const { position } = makeInterleavedPN();
    const compact = new BufferAttribute(new Float32Array([0, 0, 0, 1, 2, 3]), 3);
    for (let i = 0; i < 2; i++) {
      expect(position.getX(i)).toBe(compact.getX(i));
      expect(position.getY(i)).toBe(compact.getY(i));
      expect(position.getZ(i)).toBe(compact.getZ(i));
    }
  });
});

describe('InterleavedBufferAttribute — setX/Y/Z 写入', () => {
  it('setX 写到正确 stride+offset 槽位', () => {
    const { array, position } = makeInterleavedPN();
    position.setX(0, 9);
    // 顶点0 position.x = array[0*6+0] = array[0]
    expect(array[0]).toBe(9);
  });

  it('setZ 写到顶点1的 z(跨 stride)', () => {
    const { array, position } = makeInterleavedPN();
    position.setZ(1, 7.5);
    // 顶点1 position.z = array[1*6+0+2] = array[8]
    expect(array[8]).toBe(7.5);
    // 不能污染 normal(顶点1 normal 在 array[9..11])
    expect(array[9]).toBe(0);
    expect(array[10]).toBe(1);
  });

  it('setXYZ 一次写连续三分量', () => {
    const { array, normal } = makeInterleavedPN();
    normal.setXYZ(0, 0.5, 0.5, 0.707);
    // 顶点0 normal 在 array[0*6+3..5]
    expect(array[3]).toBe(0.5);
    expect(array[4]).toBe(0.5);
    expect(approximatelyEqual(array[5], 0.707)).toBe(true);
    // position(顶点0)不受影响
    expect(array[0]).toBe(0);
    expect(array[1]).toBe(0);
    expect(array[2]).toBe(0);
  });

  it('getComponent/setComponent 按 component 偏移', () => {
    const { position } = makeInterleavedPN();
    expect(position.getComponent(1, 0)).toBe(1); // x
    expect(position.getComponent(1, 1)).toBe(2); // y
    expect(position.getComponent(1, 2)).toBe(3); // z
    position.setComponent(1, 0, 42);
    expect(position.getX(1)).toBe(42);
  });
});

describe('InterleavedBufferAttribute — normalized 量化往返', () => {
  it('Uint8 normalized:setX→normalize, getX→denormalize 往返', () => {
    // stride=2: 一个 quantized uv 分量(u,v) 用 Uint8 存储,normalized。
    const array = new Uint8Array([0, 0, 255, 255]);
    const ib = new InterleavedBuffer(array, 2);
    const uv = new InterleavedBufferAttribute(ib, 2, 0, true);

    // 顶点0:u=0,v=0; 顶点1:u=255→1.0,v=255→1.0
    expect(approximatelyEqual(uv.getX(1), 1.0, 1e-3)).toBe(true);
    expect(approximatelyEqual(uv.getY(1), 1.0, 1e-3)).toBe(true);

    // 写 0.5 → 量化为 128(round(0.5*255))
    uv.setX(0, 0.5);
    expect(array[0]).toBe(128);
    // getX 反量化:128/255 ≈ 0.50196,与 0.5 有 ~0.002 量化误差,用 1e-2 容差。
    expect(approximatelyEqual(uv.getX(0), 0.5, 1e-2)).toBe(true);
  });

  it('Int16 normalized:负值量化往返', () => {
    const array = new Int16Array([0, 0, 0, 0]);
    const ib = new InterleavedBuffer(array, 2);
    const attr = new InterleavedBufferAttribute(ib, 2, 0, true);

    attr.setX(0, -0.5);
    // Math.round(-0.5 * 32767) = Math.round(-16383.5) = -16383
    // (JS Math.round 对 .5 向最近偶数: -16383.5 → -16383)
    expect(array[0]).toBe(-16383);
    const back = attr.getX(0);
    expect(approximatelyEqual(back, -0.5, 1e-4)).toBe(true);
  });
});

describe('InterleavedBufferAttribute — clone', () => {
  it('无参 clone → de-interleave 为独立 BufferAttribute', () => {
    const { position } = makeInterleavedPN();
    const cloned = position.clone();
    expect(cloned).toBeInstanceOf(BufferAttribute);
    expect((cloned as BufferAttribute).itemSize).toBe(3);
    const arr = (cloned as BufferAttribute).array as Float32Array;
    expect(arr.length).toBe(6);
    expect(arr[0]).toBe(0);
    expect(arr[3]).toBe(1); // 顶点1 x
    expect(arr[5]).toBe(3); // 顶点1 z
  });

  it('de-interleave 后不共享底层 buffer(修改不影响源)', () => {
    const { position } = makeInterleavedPN();
    const cloned = position.clone() as BufferAttribute;
    (cloned.array as Float32Array)[0] = 999;
    // 源共享 array 的 position.x 不应被改
    expect(position.getX(0)).toBe(0);
  });

  it('带 data 的 clone → 保留 InterleavedBufferAttribute 身份,复用底层 ib', () => {
    const { ib, position, normal } = makeInterleavedPN();
    const data = {} as { interleavedBuffers?: Record<string, InterleavedBuffer> };
    const p2 = position.clone(data);
    const n2 = normal.clone(data);
    // 两者仍为 InterleavedBufferAttribute
    expect((p2 as InterleavedBufferAttribute).isInterleavedBufferAttribute).toBe(true);
    expect((n2 as InterleavedBufferAttribute).isInterleavedBufferAttribute).toBe(true);
    // 同一底层 ib 复用(dict 去重):position 与 normal 应指向克隆出的同一 ib
    expect(data.interleavedBuffers).toBeDefined();
    expect(Object.keys(data.interleavedBuffers!).length).toBe(1); // 只一次 ib
    expect((p2 as InterleavedBufferAttribute).data).toBe((n2 as InterleavedBufferAttribute).data);
    expect((p2 as InterleavedBufferAttribute).data).not.toBe(ib); // 是克隆不是别名
    // offsets 保留
    expect((p2 as InterleavedBufferAttribute).offset).toBe(0);
    expect((n2 as InterleavedBufferAttribute).offset).toBe(3);
  });
});

describe('InterleavedBufferAttribute — toJSON', () => {
  it('无参 → de-interleave 平坦 JSON(独立 array)', () => {
    const { position } = makeInterleavedPN();
    const json = position.toJSON();
    expect(json.isInterleavedBufferAttribute).toBeUndefined();
    expect(json.itemSize).toBe(3);
    expect(Array.isArray(json.array)).toBe(true);
    expect((json.array as number[]).length).toBe(6);
    expect(json.normalized).toBe(false);
  });

  it('带 meta → 引用式 JSON(isInterleavedBufferAttribute + data uuid + offset)', () => {
    const { ib, position } = makeInterleavedPN();
    const meta = {} as { interleavedBuffers?: Record<string, InterleavedBuffer> };
    const json = position.toJSON(meta);
    expect(json.isInterleavedBufferAttribute).toBe(true);
    expect(json.itemSize).toBe(3);
    expect(json.data).toBe(ib.uuid);
    expect(json.offset).toBe(0);
    expect(json.normalized).toBe(false);
    // meta 里登记了该 ib
    expect(meta.interleavedBuffers).toBeDefined();
    expect(meta.interleavedBuffers![ib.uuid]).toBe(ib);
  });

  it('多条共享 ib 的属性 toJSON 只登记 ib 一次', () => {
    const { ib, position, normal } = makeInterleavedPN();
    const meta = {} as { interleavedBuffers?: Record<string, InterleavedBuffer> };
    position.toJSON(meta);
    normal.toJSON(meta);
    expect(Object.keys(meta.interleavedBuffers!).length).toBe(1);
    expect(meta.interleavedBuffers![ib.uuid]).toBe(ib);
  });
});

describe('InterleavedBufferAttribute — applyMatrix4', () => {
  it('按交错寻址把 position 整体变换(itemSize=3)', () => {
    const { array, position } = makeInterleavedPN();
    // 平移矩阵 (+10,+20,+30)
    const m = new Matrix4();
    m.makeTranslation(10, 20, 30);
    position.applyMatrix4(m);
    // 顶点0 (0,0,0) → (10,20,30); 顶点1 (1,2,3) → (11,22,33)
    expect(array[0]).toBe(10);
    expect(array[1]).toBe(20);
    expect(array[2]).toBe(30);
    // 顶点1 position 在 array[6..8]
    expect(array[6]).toBe(11);
    expect(array[7]).toBe(22);
    expect(array[8]).toBe(33);
    // normal 分量未被 applyMatrix4 改动(只动 position 属性)
    expect(array[3]).toBe(1); // 顶点0 normal.x 未变
    expect(array[4]).toBe(0);
    expect(array[5]).toBe(0);
  });
});
