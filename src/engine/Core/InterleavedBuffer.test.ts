// InterleavedBuffer / InstancedInterleavedBuffer / InterleavedBufferAttribute 单元测试。
//
// 覆盖:
//   - InterleavedBuffer: count/stride、copy 深拷贝、clone 去重(共享底层 ArrayBuffer)、
//     toJSON、needsUpdate→version 自增、updateRanges、setUsage、set/copyAt、onUpload。
//   - InstancedInterleavedBuffer: meshPerAttribute 透传到 clone/copy/toJSON。
//   - InterleavedBufferAttribute: 按 index*stride+offset 寻址读写、normalized 量化/反量化、
//     applyMatrix4/applyNormalMatrix/transformDirection、clone de-interleave(无 data)与
//     共享 dedup(有 data)、toJSON 两种模式。
// 全部纯数据层,不依赖 WebGL。

import { describe, it, expect } from 'vitest';
import {
  InterleavedBuffer,
  InstancedInterleavedBuffer,
  STATIC_DRAW,
} from './InterleavedBuffer';
import { InterleavedBufferAttribute } from './InterleavedBufferAttribute';
import { BufferAttribute } from './BufferAttribute';
import { Matrix4 } from '../Math/Matrix4';
import { Matrix3 } from '../Math/Matrix3';

const DYNAMIC_DRAW = 0x88e8; // gl.DYNAMIC_DRAW

/** clone/toJSON 的共享 data 上下文(three.js 原版契约宽松:clone 写 ArrayBuffer 切片,
 * toJSON 写 number[](Uint32 视图),二者共用同一 arrayBuffers 字典;InterleavedBufferAttribute
 * 用 interleavedBuffers 字典存源 buffer 引用。测试侧用 any 接住,运行时由源码保证字段)。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CloneData = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AttrCloneData = Record<string, any>;

/** 构造一个 2 顶点、stride=6(position[3]+normal[3])的 interleaved buffer。 */
function make2Vert(): InterleavedBuffer {
  return new InterleavedBuffer(
    new Float32Array([
      1, 2, 3, 0, 0, 1, // vertex 0: pos(1,2,3) normal(0,0,1)
      4, 5, 6, 0, 1, 0, // vertex 1: pos(4,5,6) normal(0,1,0)
    ]),
    6,
  );
}

describe('InterleavedBuffer', () => {
  it('构造时按 array.length/stride 计算 count', () => {
    const ib = make2Vert();
    expect(ib.stride).toBe(6);
    expect(ib.count).toBe(2);
    expect(ib.array.length).toBe(12);
    expect(ib.isInterleavedBuffer).toBe(true);
  });

  it('默认 usage=STATIC_DRAW, version=0, 有 uuid', () => {
    const ib = make2Vert();
    expect(ib.usage).toBe(STATIC_DRAW);
    expect(ib.version).toBe(0);
    expect(typeof ib.uuid).toBe('string');
    expect(ib.uuid.length).toBeGreaterThan(0);
  });

  it('needsUpdate=true 自增 version,false 不增', () => {
    const ib = make2Vert();
    expect(ib.version).toBe(0);
    ib.needsUpdate = true;
    expect(ib.version).toBe(1);
    ib.needsUpdate = true;
    expect(ib.version).toBe(2);
    ib.needsUpdate = false;
    expect(ib.version).toBe(2); // 不回退
  });

  it('setUsage 链式设置 usage', () => {
    const ib = make2Vert();
    const ret = ib.setUsage(DYNAMIC_DRAW);
    expect(ret).toBe(ib); // 链式
    expect(ib.usage).toBe(DYNAMIC_DRAW);
  });

  it('updateRanges: addUpdateRange 追加, clearUpdateRanges 清空', () => {
    const ib = make2Vert();
    expect(ib.updateRanges).toHaveLength(0);
    ib.addUpdateRange(0, 6);
    ib.addUpdateRange(6, 6);
    expect(ib.updateRanges).toHaveLength(2);
    expect(ib.updateRanges[0]).toEqual({ start: 0, count: 6 });
    expect(ib.updateRanges[1]).toEqual({ start: 6, count: 6 });
    const ret = ib.clearUpdateRanges();
    expect(ret).toBe(ib); // 链式
    expect(ib.updateRanges).toHaveLength(0);
  });

  it('set 把数组写入指定 offset', () => {
    const ib = new InterleavedBuffer(new Float32Array(12), 6);
    ib.set([1, 2, 3, 4, 5, 6], 0);
    expect(Array.from(ib.array)).toEqual([1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0]);
    ib.set([9, 8], 6);
    expect(ib.array[6]).toBe(9);
    expect(ib.array[7]).toBe(8);
  });

  it('copyAt 把另一 buffer 的整条顶点拷到本 buffer 指定槽位', () => {
    const src = make2Vert();
    const dst = new InterleavedBuffer(new Float32Array(12), 6); // 2 个空顶点
    dst.copyAt(0, src, 1); // dst[0] <- src[1]
    expect(dst.array[0]).toBe(4);
    expect(dst.array[5]).toBe(0); // src[1].normal.y
    dst.copyAt(1, src, 0); // dst[1] <- src[0]
    expect(dst.array[6]).toBe(1);
    expect(dst.array[11]).toBe(1); // src[0].normal.z
  });

  it('copy 深拷贝 array(独立 buffer)并复制 count/stride/usage', () => {
    const src = make2Vert();
    src.setUsage(DYNAMIC_DRAW);
    const dst = new InterleavedBuffer(new Float32Array(12), 6);
    const ret = dst.copy(src);
    expect(ret).toBe(dst);
    expect(dst.stride).toBe(6);
    expect(dst.count).toBe(2);
    expect(dst.usage).toBe(DYNAMIC_DRAW);
    expect(Array.from(dst.array)).toEqual(Array.from(src.array));
    // 深拷贝:修改 dst 不影响 src
    dst.array[0] = 999;
    expect(src.array[0]).toBe(1);
  });

  it('copy 保留原 array 的 TypedArray 类型(Int16)', () => {
    const src = new InterleavedBuffer(new Int16Array([1, 2, 3, 4]), 2);
    const dst = new InterleavedBuffer(new Int16Array(4), 2);
    dst.copy(src);
    expect(dst.array).toBeInstanceOf(Int16Array);
    expect(Array.from(dst.array)).toEqual([1, 2, 3, 4]);
  });

  it('onUpload 注册回调并可通过 onUploadCallback 调用', () => {
    const ib = make2Vert();
    let called = 0;
    ib.onUpload(() => { called++; });
    expect(typeof ib.onUploadCallback).toBe('function');
    ib.onUploadCallback();
    expect(called).toBe(1);
  });

  describe('clone (去重共享底层 ArrayBuffer)', () => {
    it('clone 产出独立 buffer,数据相同但底层 ArrayBuffer 不同', () => {
      const ib = make2Vert();
      const c = ib.clone();
      expect(c.stride).toBe(6);
      expect(c.count).toBe(2);
      expect(Array.from(c.array)).toEqual(Array.from(ib.array));
      expect(c.array).not.toBe(ib.array); //.TypedArray 实例不同
      // 内容独立
      c.array[0] = 7;
      expect(ib.array[0]).toBe(1);
    });

    it('同一 data 上下文 clone 多次复用同一底层 ArrayBuffer(去重)', () => {
      const ib = make2Vert();
      const data: CloneData = {};
      const c1 = ib.clone(data);
      const c2 = ib.clone(data);
      // 共享底层 buffer —— 写 c1 应反映到 c2(因为是同一 ArrayBuffer 切片)
      // 注:vitest jit 下,两次 clone 的底层 buffer 应同一。
      expect(c1.array.buffer).toBe(c2.array.buffer);
      // data.arrayBuffers 应只含一个条目
      expect(Object.keys(data.arrayBuffers!).length).toBe(1);
    });

    it('不同 buffer 在同一 data 上下文下各自去重', () => {
      const a = make2Vert();
      const b = new InterleavedBuffer(new Int16Array([10, 20, 30, 40]), 2);
      const data: CloneData = {};
      a.clone(data);
      b.clone(data);
      expect(Object.keys(data.arrayBuffers!).length).toBe(2);
    });

    it('clone 复制 usage', () => {
      const ib = make2Vert();
      ib.setUsage(DYNAMIC_DRAW);
      const c = ib.clone();
      expect(c.usage).toBe(DYNAMIC_DRAW);
    });
  });

  describe('toJSON', () => {
    it('序列化含 uuid/buffer/type/stride', () => {
      const ib = make2Vert();
      const data: CloneData = {};
      const json = ib.toJSON(data) as Record<string, unknown>;
      expect(json.uuid).toBe(ib.uuid);
      expect(typeof json.buffer).toBe('string'); // ArrayBuffer 的 _uuid
      expect(json.type).toBe('Float32Array');
      expect(json.stride).toBe(6);
      // usage=STATIC_DRAW 时不写 usage
      expect('usage' in json).toBe(false);
    });

    it('非 STATIC_DRAW usage 时写入 usage', () => {
      const ib = make2Vert();
      ib.setUsage(DYNAMIC_DRAW);
      const json = ib.toJSON({}) as Record<string, unknown>;
      expect(json.usage).toBe(DYNAMIC_DRAW);
    });

    it('同一 buffer 多次 toJSON 共享同一 arrayBuffers 条目(去重)', () => {
      const ib = make2Vert();
      const data: CloneData = {};
      ib.toJSON(data);
      const firstSize = Object.keys(data.arrayBuffers!).length;
      ib.toJSON(data);
      expect(Object.keys(data.arrayBuffers!).length).toBe(firstSize);
    });
  });
});

describe('InstancedInterleavedBuffer', () => {
  it('构造带 meshPerAttribute,默认 1', () => {
    const ib = new InstancedInterleavedBuffer(new Float32Array(12), 6);
    expect(ib.meshPerAttribute).toBe(1);
    expect(ib.isInstancedInterleavedBuffer).toBe(true);
    expect(ib.isInterleavedBuffer).toBe(true); // 继承父类标志
    expect(ib.stride).toBe(6);
    expect(ib.count).toBe(2);
  });

  it('自定义 meshPerAttribute', () => {
    const ib = new InstancedInterleavedBuffer(new Float32Array(12), 6, 4);
    expect(ib.meshPerAttribute).toBe(4);
  });

  it('copy 复制 meshPerAttribute', () => {
    const src = new InstancedInterleavedBuffer(new Float32Array(12), 6, 3);
    const dst = new InstancedInterleavedBuffer(new Float32Array(12), 6, 1);
    dst.copy(src);
    expect(dst.meshPerAttribute).toBe(3);
    expect(Array.from(dst.array)).toEqual(Array.from(src.array));
  });

  it('clone 复制 meshPerAttribute', () => {
    const src = new InstancedInterleavedBuffer(new Float32Array(12), 6, 5);
    const c = src.clone();
    expect(c.meshPerAttribute).toBe(5);
    expect(c.isInstancedInterleavedBuffer).toBe(true);
    expect(Array.from(c.array)).toEqual(Array.from(src.array));
  });

  it('toJSON 含 isInstancedInterleavedBuffer 与 meshPerAttribute', () => {
    const src = new InstancedInterleavedBuffer(new Float32Array(12), 6, 2);
    const json = src.toJSON({}) as Record<string, unknown>;
    expect(json.isInstancedInterleavedBuffer).toBe(true);
    expect(json.meshPerAttribute).toBe(2);
    expect(json.stride).toBe(6);
  });
});

describe('InterleavedBufferAttribute', () => {
  it('持有 data/itemSize/offset/normalized,count/getArray 代理 data', () => {
    const ib = make2Vert();
    const pos = new InterleavedBufferAttribute(ib, 3, 0);
    expect(pos.data).toBe(ib);
    expect(pos.itemSize).toBe(3);
    expect(pos.offset).toBe(0);
    expect(pos.normalized).toBe(false);
    expect(pos.count).toBe(2); // 代理 data.count
    expect(pos.array).toBe(ib.array); // 代理 data.array
    expect(pos.isInterleavedBufferAttribute).toBe(true);
  });

  it('默认 name 为空字符串,可赋值', () => {
    const ib = make2Vert();
    const attr = new InterleavedBufferAttribute(ib, 3, 0);
    expect(attr.name).toBe('');
    attr.name = 'position';
    expect(attr.name).toBe('position');
  });

  it('needsUpdate 转发给 data(needsUpdate=true 自增 data.version)', () => {
    const ib = make2Vert();
    const attr = new InterleavedBufferAttribute(ib, 3, 0);
    expect(ib.version).toBe(0);
    attr.needsUpdate = true;
    expect(ib.version).toBe(1);
  });

  describe('按 index*stride+offset 寻址读写', () => {
    it('getX/getY/getZ/getW 读取正确分量', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      expect(pos.getX(0)).toBe(1);
      expect(pos.getY(0)).toBe(2);
      expect(pos.getZ(0)).toBe(3);
      expect(pos.getX(1)).toBe(4);
      expect(pos.getY(1)).toBe(5);
      expect(pos.getZ(1)).toBe(6);
    });

    it('setX/setY/setZ/setW 写入共享底层 array', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      pos.setX(0, 100);
      expect(ib.array[0]).toBe(100); // index*stride+offset = 0*6+0
      pos.setZ(1, 200);
      expect(ib.array[1 * 6 + 0 + 2]).toBe(200);
    });

    it('两个 attribute 共享同一 buffer(offset 不同)互不干扰', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      const normal = new InterleavedBufferAttribute(ib, 3, 3);
      // 写 normal 不影响 pos(同一 stride 内 offset 分开)
      normal.setX(0, 0.5);
      expect(ib.array[3]).toBe(0.5); // normal.offset=3
      expect(pos.getX(0)).toBe(1); // pos.offset=0,未变
    });

    it('getComponent/setComponent 按 component 偏移', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      expect(pos.getComponent(1, 0)).toBe(4); // x
      expect(pos.getComponent(1, 1)).toBe(5); // y
      expect(pos.getComponent(1, 2)).toBe(6); // z
      pos.setComponent(0, 1, 42);
      expect(ib.array[0 * 6 + 0 + 1]).toBe(42);
    });

    it('setXY/setXYZ/setXYZW 写入多个分量', () => {
      const ib = new InterleavedBuffer(new Float32Array(18), 6); // 3 顶点
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      pos.setXYZ(0, 1, 2, 3);
      pos.setXYZ(1, 4, 5, 6);
      expect(ib.array[0]).toBe(1);
      expect(ib.array[2]).toBe(3);
      expect(ib.array[6]).toBe(4);

      // setXYZW 用 4 分量属性
      const ib4 = new InterleavedBuffer(new Float32Array(8), 4); // 2 顶点
      const attr4 = new InterleavedBufferAttribute(ib4, 4, 0);
      attr4.setXYZW(0, 1, 2, 3, 4);
      expect(ib4.array[0]).toBe(1);
      expect(ib4.array[3]).toBe(4);
    });

    it('4 分量 getW 读取第 4 分量', () => {
      const ib = new InterleavedBuffer(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]), 4);
      const attr = new InterleavedBufferAttribute(ib, 4, 0);
      expect(attr.getW(0)).toBe(4);
      expect(attr.getW(1)).toBe(8);
    });
  });

  describe('normalized 量化/反量化', () => {
    it('normalized Uint8Array: setX 量化 0..1 → 0..255, getX 反量化', () => {
      // stride=1, 4 个 unorm8 分量
      const ib = new InterleavedBuffer(new Uint8Array([0, 64, 128, 255]), 1);
      const attr = new InterleavedBufferAttribute(ib, 1, 0, true);
      // 读取:反量化 255 → 1.0
      expect(attr.getX(3)).toBeCloseTo(1.0, 5);
      expect(attr.getComponent(1, 0)).toBeCloseTo(64 / 255, 5);
      // 写入:量化 1.0 → 255
      attr.setX(0, 1.0);
      expect(ib.array[0]).toBe(255);
      attr.setX(0, 0.0);
      expect(ib.array[0]).toBe(0);
    });

    it('normalized Int16Array: 负值反量化带 max(-1) 钳制', () => {
      const ib = new InterleavedBuffer(new Int16Array([-32767, 0, 32767]), 1);
      const attr = new InterleavedBufferAttribute(ib, 1, 0, true);
      expect(attr.getX(0)).toBeCloseTo(-1.0, 4);
      expect(attr.getX(2)).toBeCloseTo(1.0, 4);
      expect(attr.getX(1)).toBe(0);
    });

    it('non-normalized Float32Array: getX 直读(不量化)', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      expect(pos.getX(0)).toBe(1); // 原值
    });

    it('normalized setXYZ 批量量化写入', () => {
      const ib = new InterleavedBuffer(new Uint8Array(6), 3); // 2 顶点
      const attr = new InterleavedBufferAttribute(ib, 3, 0, true);
      attr.setXYZ(0, 1, 0.5, 0);
      expect(ib.array[0]).toBe(255);
      expect(ib.array[1]).toBe(128); // round(0.5*255)=128 (0.5*255=127.5)
      expect(ib.array[2]).toBe(0);
    });
  });

  describe('applyMatrix4 / applyNormalMatrix / transformDirection', () => {
    it('applyMatrix4 把每顶点 position 乘 4×4 矩阵(平移)', () => {
      const ib = new InterleavedBuffer(
        new Float32Array([0, 0, 0, 0, 1, 1, 1, 0]), 4,
      ); // 2 顶点: pos(x,y,z) + 1 extra
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const ret = pos.applyMatrix4(m);
      expect(ret).toBe(pos);
      expect(pos.getX(0)).toBe(10);
      expect(pos.getY(0)).toBe(20);
      expect(pos.getZ(0)).toBe(30);
      expect(pos.getX(1)).toBe(11);  // 1+10
      expect(pos.getY(1)).toBe(21);  // 1+20
      expect(pos.getZ(1)).toBe(31);  // 1+30
      // needsUpdate 已触发(标脏转发 data)
      expect(ib.version).toBeGreaterThan(0);
    });

    it('applyNormalMatrix 用 3×3 变换方向向量(法线)', () => {
      const ib = new InterleavedBuffer(new Float32Array([0, 1, 0, 0, 1, 0]), 3);
      const nrm = new InterleavedBufferAttribute(ib, 3, 0);
      // 绕 Z 旋转 90°:(0,1,0) -> (-1,0,0)
      const m = new Matrix3().setFromMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
      const ret = nrm.applyNormalMatrix(m);
      expect(ret).toBe(nrm);
      expect(nrm.getX(0)).toBeCloseTo(-1, 5);
      expect(nrm.getY(0)).toBeCloseTo(0, 5);
    });

    it('transformDirection 用 4×4 变换方向(忽略平移)', () => {
      const ib = new InterleavedBuffer(new Float32Array([1, 0, 0, 0, 1, 0, 0]), 3);
      const dir = new InterleavedBufferAttribute(ib, 3, 0);
      const m = new Matrix4().makeRotationZ(Math.PI / 2); // 纯旋转,无平移
      m.elements[12] = 999; // 故意加平移,应被忽略
      dir.transformDirection(m);
      expect(dir.getX(0)).toBeCloseTo(0, 5);
      expect(dir.getY(0)).toBeCloseTo(1, 5);
    });
  });

  describe('clone', () => {
    it('无 data: de-interleave 为独立 BufferAttribute(itemSize 抽切片到 Float32Array)', () => {
      const ib = make2Vert();
      const normal = new InterleavedBufferAttribute(ib, 3, 3); // offset=3 取 normal
      const cloned = normal.clone();
      expect(cloned).toBeInstanceOf(BufferAttribute);
      expect(cloned).not.toBeInstanceOf(InterleavedBufferAttribute);
      expect(cloned.itemSize).toBe(3);
      expect(cloned.count).toBe(2);
      // 抽出的是 normal 切片:Array([0,0,1, 0,1,0])
      expect(Array.from((cloned as BufferAttribute).array)).toEqual([
        0, 0, 1, 0, 1, 0,
      ]);
    });

    it('de-interleave 后是独立 Float32Array(修改不影响原 interleaved buffer)', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      const cloned = pos.clone() as BufferAttribute;
      cloned.setX(0, 999);
      expect(ib.array[0]).toBe(1); // 原共享 buffer 不变
    });

    it('有 data: 克隆为 InterleavedBufferAttribute 并共享底层 buffer 去重', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      const normal = new InterleavedBufferAttribute(ib, 3, 3);
      const data: AttrCloneData = {};
      const cp = pos.clone(data) as InterleavedBufferAttribute;
      const cn = normal.clone(data) as InterleavedBufferAttribute;
      expect(cp).toBeInstanceOf(InterleavedBufferAttribute);
      expect(cn).toBeInstanceOf(InterleavedBufferAttribute);
      expect(cp.itemSize).toBe(3);
      expect(cp.offset).toBe(0);
      expect(cn.offset).toBe(3);
      // 两条属性复用同一 InterleavedBuffer(由 dict 去重)
      expect(cp.data).toBe(cn.data);
      expect(Object.keys(data.interleavedBuffers!).length).toBe(1);
    });

    it('有 data: 克隆的底层 buffer 数据与源相同但独立', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      const data: AttrCloneData = {};
      const cp = pos.clone(data) as InterleavedBufferAttribute;
      expect(Array.from(cp.data.array)).toEqual(Array.from(ib.array));
      cp.data.array[0] = 777;
      expect(ib.array[0]).toBe(1); // 独立
    });
  });

  describe('toJSON', () => {
    it('无 data: de-interleave 为普通 attribute JSON(独立 array)', () => {
      const ib = make2Vert();
      const normal = new InterleavedBufferAttribute(ib, 3, 3);
      const json = normal.toJSON() as Record<string, unknown>;
      expect(json.itemSize).toBe(3);
      expect(json.type).toBe('Float32Array');
      expect(json.normalized).toBe(false);
      expect(Array.isArray(json.array)).toBe(true);
      expect(json.array).toEqual([0, 0, 1, 0, 1, 0]); // normal 切片
      expect('isInterleavedBufferAttribute' in json).toBe(false);
    });

    it('有 data: 序列化为 interleaved 引用(只记 uuid/offset)', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      const data: AttrCloneData = {};
      const json = pos.toJSON(data) as Record<string, unknown>;
      expect(json.isInterleavedBufferAttribute).toBe(true);
      expect(json.itemSize).toBe(3);
      expect(json.offset).toBe(0);
      expect(json.normalized).toBe(false);
      expect(json.data).toBe(ib.uuid); // 引用 data uuid
      // data.interleavedBuffers 存入源 buffer
      expect(data.interleavedBuffers![ib.uuid]).toBe(ib);
    });

    it('有 data: 多条属性共享同一 interleavedBuffers 条目', () => {
      const ib = make2Vert();
      const pos = new InterleavedBufferAttribute(ib, 3, 0);
      const normal = new InterleavedBufferAttribute(ib, 3, 3);
      const data: AttrCloneData = {};
      pos.toJSON(data);
      normal.toJSON(data);
      expect(Object.keys(data.interleavedBuffers!).length).toBe(1);
    });
  });
});
