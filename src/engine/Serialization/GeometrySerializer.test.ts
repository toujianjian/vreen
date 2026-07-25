// GeometrySerializer 测试 — BufferGeometry ↔ GeometryJSON 往返
//
// 验证:
//   • attributes / index / groups / userData 完整往返
//   • 缺失 index 的情况
//   • 空 userData 不写入字段
//   • 类型不匹配时抛错
import { describe, it, expect } from 'vitest';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { GeometrySerializer, GEOMETRY_TYPE } from './GeometrySerializer';

describe('GeometrySerializer — 基础往返', () => {
  it('完整 attributes + index 往返一致', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
      ]),
      3,
    ));
    geom.setAttribute('normal', new BufferAttribute(
      new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
      ]),
      3,
    ));
    geom.setAttribute('uv', new BufferAttribute(
      new Float32Array([
        0, 0,
        1, 0,
        1, 1,
      ]),
      2,
    ));
    geom.setIndex([0, 1, 2]);

    const json = GeometrySerializer.serialize(geom);
    expect(json.type).toBe(GEOMETRY_TYPE);
    expect(json.attributes.position.itemSize).toBe(3);
    expect(json.attributes.position.array).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(json.attributes.normal.itemSize).toBe(3);
    expect(json.attributes.uv.itemSize).toBe(2);
    expect(json.index).not.toBeNull();
    expect(json.index!.array).toEqual([0, 1, 2]);

    const restored = GeometrySerializer.deserialize(json);
    expect(restored.attributes.position.itemSize).toBe(3);
    expect(Array.from(restored.attributes.position.array)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(restored.attributes.normal.itemSize).toBe(3);
    expect(restored.attributes.uv.itemSize).toBe(2);
    expect(restored.index).not.toBeNull();
    expect(Array.from(restored.index!.array as unknown as ArrayLike<number>)).toEqual([0, 1, 2]);
  });

  it('无 index 时 json.index=null', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
      3,
    ));
    const json = GeometrySerializer.serialize(geom);
    expect(json.index).toBeNull();
    const restored = GeometrySerializer.deserialize(json);
    expect(restored.index).toBeNull();
  });

  it('groups 往返一致', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    geom.groups = [
      { start: 0, count: 100, materialIndex: 0 },
      { start: 100, count: 50, materialIndex: 1 },
    ];
    const json = GeometrySerializer.serialize(geom);
    expect(json.groups).toEqual([
      { start: 0, count: 100, materialIndex: 0 },
      { start: 100, count: 50, materialIndex: 1 },
    ]);
    const restored = GeometrySerializer.deserialize(json);
    expect(restored.groups).toEqual(geom.groups);
  });

  it('空 groups 时 json.groups=[]', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const json = GeometrySerializer.serialize(geom);
    expect(json.groups).toEqual([]);
  });

  it('userData 往返一致', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    geom.userData = { name: 'myGeom', custom: 42, nested: { a: 1 } };
    const json = GeometrySerializer.serialize(geom);
    expect(json.userData).toEqual({ name: 'myGeom', custom: 42, nested: { a: 1 } });
    const restored = GeometrySerializer.deserialize(json);
    expect(restored.userData).toEqual({ name: 'myGeom', custom: 42, nested: { a: 1 } });
  });

  it('空 userData 不写入字段', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const json = GeometrySerializer.serialize(geom);
    expect(json.userData).toBeUndefined();
  });

  it('Uint32 index 自动选择类型（大索引值）', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    // 索引值 > 65535 → 应触发 Uint32
    geom.setIndex([0, 70000, 1]);
    const json = GeometrySerializer.serialize(geom);
    expect(json.index).not.toBeNull();
    expect(json.index!.array).toEqual([0, 70000, 1]);
    const restored = GeometrySerializer.deserialize(json);
    expect(restored.index).not.toBeNull();
    // setIndex 在 deserialize 时自动判定类型
    expect(restored.index!.array.length).toBe(3);
  });

  it('deserialize 类型不匹配时抛错', () => {
    expect(() => {
      GeometrySerializer.deserialize({
        type: 'NotBufferGeometry' as 'BufferGeometry',
        attributes: {},
        index: null,
        groups: [],
      });
    }).toThrow(/type mismatch/);
  });
});
