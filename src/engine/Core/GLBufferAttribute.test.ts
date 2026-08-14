// GLBufferAttribute 单元测试。
// 验证直接持 GPU buffer 句柄的顶点属性:构造、链式 setter、version 自增、
// byteLength、copy/clone(buffer 句柄别名共享)、toJSON(buffer 记 null)、
// glElementSize 查表与未知 type 兜底。纯数据层、无 WebGL 依赖(buffer 用对象占位)。

import { describe, it, expect } from 'vitest';
import {
  GLBufferAttribute,
  GL_BYTE,
  GL_UNSIGNED_BYTE,
  GL_SHORT,
  GL_UNSIGNED_SHORT,
  GL_INT,
  GL_UNSIGNED_INT,
  GL_FLOAT,
  GL_ELEMENT_SIZE,
  glElementSize,
} from './GLBufferAttribute';

/** 造一个假 WebGLBuffer 句柄(无 GL 环境)。 */
function fakeBuffer(id = 'vbo'): { id: string } {
  return { id };
}

describe('GLBufferAttribute', () => {
  describe('构造', () => {
    it('基本字段 + elementSize 按 type 自动查表(FLOAT→4)', () => {
      const buf = fakeBuffer();
      const a = new GLBufferAttribute(buf, GL_FLOAT, 3, undefined, 10);
      expect(a.buffer).toBe(buf);
      expect(a.type).toBe(GL_FLOAT);
      expect(a.itemSize).toBe(3);
      expect(a.elementSize).toBe(4); // Float32 = 4 字节
      expect(a.count).toBe(10);
      expect(a.normalized).toBe(false);
      expect(a.version).toBe(0);
      expect(a.name).toBe('');
      expect(a.isGLBufferAttribute).toBe(true);
    });

    it('elementSize 按 type 自动查表各类型', () => {
      expect(new GLBufferAttribute(fakeBuffer(), GL_BYTE, 1, undefined, 0).elementSize).toBe(1);
      expect(new GLBufferAttribute(fakeBuffer(), GL_UNSIGNED_BYTE, 1, undefined, 0).elementSize).toBe(1);
      expect(new GLBufferAttribute(fakeBuffer(), GL_SHORT, 1, undefined, 0).elementSize).toBe(2);
      expect(new GLBufferAttribute(fakeBuffer(), GL_UNSIGNED_SHORT, 1, undefined, 0).elementSize).toBe(2);
      expect(new GLBufferAttribute(fakeBuffer(), GL_INT, 1, undefined, 0).elementSize).toBe(4);
      expect(new GLBufferAttribute(fakeBuffer(), GL_UNSIGNED_INT, 1, undefined, 0).elementSize).toBe(4);
      expect(new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 1, undefined, 0).elementSize).toBe(4);
    });

    it('显式 elementSize 覆盖自动查表', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, 8, 10);
      // 显式传 8,即使 FLOAT 查表是 4,也用传入值(半精度双分量打包等场景)
      expect(a.elementSize).toBe(8);
    });

    it('count 默认 0,normalized 默认 false', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3);
      expect(a.count).toBe(0);
      expect(a.normalized).toBe(false);
    });

    it('normalized 可设 true(整型量化属性)', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_UNSIGNED_SHORT, 1, undefined, 100, true);
      expect(a.normalized).toBe(true);
    });

    it('name 默认 "",可赋值', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 10);
      expect(a.name).toBe('');
      a.name = 'gpuSkinResult';
      expect(a.name).toBe('gpuSkinResult');
    });
  });

  describe('needsUpdate → version', () => {
    it('needsUpdate=true 自增 version, false 不增', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 10);
      expect(a.version).toBe(0);
      a.needsUpdate = true;
      expect(a.version).toBe(1);
      a.needsUpdate = true;
      expect(a.version).toBe(2);
      a.needsUpdate = false;
      expect(a.version).toBe(2); // 不回退
    });
  });

  describe('byteLength', () => {
    it('count×itemSize×elementSize = 字节数', () => {
      // 100 顶点 × 3 分量 × 4 字节(FLOAT) = 1200
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 100);
      expect(a.byteLength).toBe(1200);
    });

    it('UNSIGNED_SHORT elementSize=2 算入', () => {
      // 50 顶点 × 1 分量 × 2 字节 = 100
      const a = new GLBufferAttribute(fakeBuffer(), GL_UNSIGNED_SHORT, 1, undefined, 50);
      expect(a.byteLength).toBe(100);
    });

    it('count=0 时 byteLength=0', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 0);
      expect(a.byteLength).toBe(0);
    });
  });

  describe('链式 setter', () => {
    it('setBuffer 替换句柄并链式返回 this', () => {
      const a = new GLBufferAttribute(fakeBuffer('v1'), GL_FLOAT, 3, undefined, 10);
      const ret = a.setBuffer(fakeBuffer('v2'));
      expect(ret).toBe(a);
      expect((a.buffer as { id: string }).id).toBe('v2');
    });

    it('setType 同时更新 elementSize(查表)', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 10);
      expect(a.elementSize).toBe(4);
      a.setType(GL_UNSIGNED_SHORT);
      expect(a.type).toBe(GL_UNSIGNED_SHORT);
      expect(a.elementSize).toBe(2); // 自动按新 type 查表
    });

    it('setType 显式 elementSize 覆盖', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 10);
      a.setType(GL_FLOAT, 8);
      expect(a.type).toBe(GL_FLOAT);
      expect(a.elementSize).toBe(8);
    });

    it('setItemSize / setCount 链式', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 10);
      a.setItemSize(4).setCount(7);
      expect(a.itemSize).toBe(4);
      expect(a.count).toBe(7);
    });
  });

  describe('copy', () => {
    it('复制全部字段(含 name),返回 this', () => {
      const buf = fakeBuffer();
      const src = new GLBufferAttribute(buf, GL_FLOAT, 3, undefined, 10, false);
      src.name = 'source';
      const dst = new GLBufferAttribute(fakeBuffer('other'), GL_BYTE, 1, undefined, 0);
      const ret = dst.copy(src);
      expect(ret).toBe(dst);
      expect(dst.buffer).toBe(buf); // 浅拷贝句柄别名
      expect(dst.type).toBe(GL_FLOAT);
      expect(dst.itemSize).toBe(3);
      expect(dst.elementSize).toBe(4);
      expect(dst.count).toBe(10);
      expect(dst.normalized).toBe(false);
      expect(dst.name).toBe('source');
    });

    it('copy 是浅拷贝 buffer 句柄(共享同一 GPU VBO)', () => {
      const buf = fakeBuffer();
      const src = new GLBufferAttribute(buf, GL_FLOAT, 3, undefined, 10);
      const dst = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 10);
      dst.copy(src);
      expect(dst.buffer).toBe(src.buffer); // 同一引用
    });
  });

  describe('clone', () => {
    it('clone 产出新实例,字段相同,buffer 句柄别名共享', () => {
      const buf = fakeBuffer();
      const src = new GLBufferAttribute(buf, GL_UNSIGNED_SHORT, 1, undefined, 50, true);
      src.name = 'index';
      const c = src.clone();
      expect(c).not.toBe(src); // 新实例
      expect(c.isGLBufferAttribute).toBe(true);
      expect(c.buffer).toBe(buf); // 句柄别名(同一 GPU VBO)
      expect(c.type).toBe(GL_UNSIGNED_SHORT);
      expect(c.itemSize).toBe(1);
      expect(c.elementSize).toBe(2);
      expect(c.count).toBe(50);
      expect(c.normalized).toBe(true);
      expect(c.name).toBe('index');
    });

    it('clone 后修改 clone 不影响源(元数据独立,buffer 仍别名)', () => {
      const buf = fakeBuffer();
      const src = new GLBufferAttribute(buf, GL_FLOAT, 3, undefined, 10);
      const c = src.clone();
      c.setItemSize(4).setCount(20);
      expect(src.itemSize).toBe(3);
      expect(src.count).toBe(10);
      // buffer 仍是同一句柄(设计如此 — VBO 是 GPU 单例)
      expect(c.buffer).toBe(src.buffer);
    });
  });

  describe('toJSON', () => {
    it('记录元数据,buffer 记 null(GPU 资源不序列化)', () => {
      const a = new GLBufferAttribute(fakeBuffer(), GL_FLOAT, 3, undefined, 10, false);
      a.name = 'gpuParticles';
      const json = a.toJSON();
      expect(json.isGLBufferAttribute).toBe(true);
      expect(json.name).toBe('gpuParticles');
      expect(json.type).toBe(GL_FLOAT);
      expect(json.itemSize).toBe(3);
      expect(json.elementSize).toBe(4);
      expect(json.count).toBe(10);
      expect(json.normalized).toBe(false);
      expect(json.buffer).toBeNull(); // 句柄不进 JSON
    });
  });
});

describe('glElementSize 查表', () => {
  it('GL_ELEMENT_SIZE 表覆盖全部 7 种类型', () => {
    expect(GL_ELEMENT_SIZE[GL_BYTE]).toBe(1);
    expect(GL_ELEMENT_SIZE[GL_UNSIGNED_BYTE]).toBe(1);
    expect(GL_ELEMENT_SIZE[GL_SHORT]).toBe(2);
    expect(GL_ELEMENT_SIZE[GL_UNSIGNED_SHORT]).toBe(2);
    expect(GL_ELEMENT_SIZE[GL_INT]).toBe(4);
    expect(GL_ELEMENT_SIZE[GL_UNSIGNED_INT]).toBe(4);
    expect(GL_ELEMENT_SIZE[GL_FLOAT]).toBe(4);
  });

  it('glElementSize() 已知 type 返回对应字节数', () => {
    expect(glElementSize(GL_FLOAT)).toBe(4);
    expect(glElementSize(GL_UNSIGNED_SHORT)).toBe(2);
    expect(glElementSize(GL_BYTE)).toBe(1);
  });

  it('glElementSize() 未知 type 兜底返回 4(最常见 Float)', () => {
    expect(glElementSize(0x9999)).toBe(4);
    expect(glElementSize(-1)).toBe(4);
    expect(glElementSize(0)).toBe(4);
  });
});
