// InstancedBufferAttribute 单元测试。
// 验证继承 BufferAttribute 的行为 + meshPerAttribute 配置。

import { describe, it, expect } from 'vitest';
import { InstancedBufferAttribute } from './InstancedBufferAttribute';
import { BufferAttribute } from './BufferAttribute';

describe('InstancedBufferAttribute', () => {
  it('constructs with default meshPerAttribute=1', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(6), 3);
    expect(attr.meshPerAttribute).toBe(1);
    expect(attr.itemSize).toBe(3);
    expect(attr.count).toBe(2);
    expect(attr.isInstancedBufferAttribute).toBe(true);
    // 仍是 BufferAttribute 子类
    expect(attr instanceof BufferAttribute).toBe(true);
  });

  it('constructs with custom meshPerAttribute', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(16), 4, 4);
    expect(attr.meshPerAttribute).toBe(4);
    expect(attr.itemSize).toBe(4);
    expect(attr.count).toBe(4); // 16 / 4
  });

  it('clamps meshPerAttribute to >=1 (zero/negative/float)', () => {
    const a0 = new InstancedBufferAttribute(new Float32Array(3), 3, 0);
    expect(a0.meshPerAttribute).toBe(1);
    const aNeg = new InstancedBufferAttribute(new Float32Array(3), 3, -5);
    expect(aNeg.meshPerAttribute).toBe(1);
    const aFloat = new InstancedBufferAttribute(new Float32Array(3), 3, 2.7);
    expect(aFloat.meshPerAttribute).toBe(2);
  });

  it('getArray returns the underlying Float32Array reference', () => {
    const data = new Float32Array([1, 2, 3, 4]);
    const attr = new InstancedBufferAttribute(data, 2);
    expect(attr.getArray()).toBe(data);
  });

  it('setArray replaces the array and recomputes count', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(6), 3);
    expect(attr.count).toBe(2);
    attr.setArray(new Float32Array(9));
    expect(attr.count).toBe(3);
    expect(attr.array.length).toBe(9);
  });

  it('setArray bumps version (inherited from BufferAttribute)', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(6), 3);
    const v = attr.version;
    attr.setArray(new Float32Array(12));
    expect(attr.version).toBe(v + 1);
  });

  it('setMeshPerAttribute updates meshPerAttribute with clamp', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(6), 3);
    attr.setMeshPerAttribute(8);
    expect(attr.meshPerAttribute).toBe(8);
    attr.setMeshPerAttribute(0);
    expect(attr.meshPerAttribute).toBe(1);
    attr.setMeshPerAttribute(-3);
    expect(attr.meshPerAttribute).toBe(1);
    attr.setMeshPerAttribute(3.9);
    expect(attr.meshPerAttribute).toBe(3);
  });

  it('setMeshPerAttribute is chainable', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(6), 3);
    const ret = attr.setMeshPerAttribute(2);
    expect(ret).toBe(attr);
  });

  it('copy duplicates array data and meshPerAttribute from source', () => {
    const src = new InstancedBufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6]), 3, 2);
    const dst = new InstancedBufferAttribute(new Float32Array(6), 3, 1);
    dst.copy(src);
    expect(dst.meshPerAttribute).toBe(2);
    // 数组内容一致
    expect(Array.from(dst.array)).toEqual([1, 2, 3, 4, 5, 6]);
    // 是深拷贝(独立数组)
    expect(dst.array).not.toBe(src.array);
    dst.array[0] = 99;
    expect(src.array[0]).toBe(1);
  });

  it('copy recomputes count when source array differs in length', () => {
    const src = new InstancedBufferAttribute(new Float32Array(12), 3, 1);
    const dst = new InstancedBufferAttribute(new Float32Array(3), 3, 1);
    expect(dst.count).toBe(1);
    dst.copy(src);
    expect(dst.count).toBe(4); // 12/3
    expect(dst.array.length).toBe(12);
  });

  it('clone returns a new independent instance with same data', () => {
    const src = new InstancedBufferAttribute(new Float32Array([1, 2, 3, 4]), 2, 3);
    const c = src.clone();
    expect(c).not.toBe(src);
    expect(c instanceof InstancedBufferAttribute).toBe(true);
    expect(c.itemSize).toBe(2);
    expect(c.meshPerAttribute).toBe(3);
    expect(Array.from(c.array)).toEqual([1, 2, 3, 4]);
    // 独立数组
    expect(c.array).not.toBe(src.array);
    c.array[0] = 99;
    expect(src.array[0]).toBe(1);
  });

  it('inherited setX/setY/setXYZ from BufferAttribute work and bump version', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(6), 3);
    const v = attr.version;
    attr.setX(0, 5);
    expect(attr.array[0]).toBe(5);
    expect(attr.version).toBe(v + 1);
    attr.setXYZ(1, 7, 8, 9);
    expect(attr.array[3]).toBe(7);
    expect(attr.array[4]).toBe(8);
    expect(attr.array[5]).toBe(9);
  });

  it('inherited needsUpdate setter bumps version', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(6), 3);
    const v = attr.version;
    attr.needsUpdate = true;
    expect(attr.version).toBe(v + 1);
    // false 不 bump
    attr.needsUpdate = false;
    expect(attr.version).toBe(v + 1);
  });

  it('accepts plain array (non-Float32Array) in constructor and converts', () => {
    const attr = new InstancedBufferAttribute([1, 2, 3, 4, 5, 6], 3);
    expect(attr.array instanceof Float32Array).toBe(true);
    expect(attr.count).toBe(2);
    expect(attr.array[0]).toBe(1);
    expect(attr.array[5]).toBe(6);
  });

  it('usage hint is preserved through clone', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(6), 3, 1, 0x88e8 /* DYNAMIC_DRAW */);
    const c = attr.clone();
    expect(c.usage).toBe(0x88e8);
  });
});
