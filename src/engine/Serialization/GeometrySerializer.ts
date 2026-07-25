// GeometrySerializer — BufferGeometry ↔ GeometryJSON。
//
// 字段映射：
//   attributes[name] = { itemSize, array: number[] }
//   index = { array: number[] } | null
//   groups = [{ start, count, materialIndex }]
//   userData = { ... }
//
// 与 BufferGeometry.toJSON() 的差异：
//   - 输出类型为 GeometryJSON（带 type='BufferGeometry'），便于注册表分派；
//   - 反序列化时正确重建 BufferAttribute / index 的 typed array；
//   - 保留 userData 与 groups，往返一致。
//
// 注意：typed array 在 JSON 中以普通 number[] 形式存储，反序列化时由
// BufferAttribute 构造器重新转回 Float32Array；index 的 Uint16/Uint32 选择
// 由 BufferGeometry.setIndex 自动判定。

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import type { GeometryJSON, BufferAttributeJSON } from './types';
import type { Serializer } from './SerializerRegistry';
import { createLogger } from '@/lib/logger';

const log = createLogger('GeometrySerializer');

export const GEOMETRY_TYPE = 'BufferGeometry';

export const GeometrySerializer: Serializer<BufferGeometry, GeometryJSON> = {
  serialize(geometry: BufferGeometry): GeometryJSON {
    const attributes: Record<string, BufferAttributeJSON> = {};
    for (const [name, attr] of Object.entries(geometry.attributes)) {
      attributes[name] = {
        itemSize: attr.itemSize,
        array: Array.from(attr.array),
      };
    }
    let index: { array: number[] } | null = null;
    if (geometry.index) {
      index = {
        array: Array.from(geometry.index.array as unknown as ArrayLike<number>),
      };
    }
    const json: GeometryJSON = {
      type: GEOMETRY_TYPE,
      attributes,
      index,
      groups: geometry.groups.map((g) => ({ ...g })),
    };
    if (Object.keys(geometry.userData).length > 0) {
      json.userData = { ...geometry.userData };
    }
    return json;
  },

  deserialize(json: GeometryJSON): BufferGeometry {
    if (json.type !== GEOMETRY_TYPE) {
      throw new Error(`GeometrySerializer: type mismatch (got "${json.type}", expected "${GEOMETRY_TYPE}")`);
    }
    const geom = new BufferGeometry();
    for (const [name, attr] of Object.entries(json.attributes)) {
      const bufferAttr = new BufferAttribute(
        Float32Array.from(attr.array),
        attr.itemSize,
      );
      geom.setAttribute(name, bufferAttr);
    }
    if (json.index && json.index.array.length > 0) {
      // setIndex 自动选择 Uint16/Uint32
      geom.setIndex(json.index.array);
    }
    if (json.groups && json.groups.length > 0) {
      geom.groups = json.groups.map((g) => ({ ...g }));
    }
    if (json.userData) {
      geom.userData = { ...json.userData };
    }
    log.debug(`deserialize — ${Object.keys(json.attributes).join(',')} attributes, ${json.index?.array.length ?? 0} indices`);
    return geom;
  },
};
