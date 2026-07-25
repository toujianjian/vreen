// SerializerRegistry — 序列化器注册表。
//
// 设计目标：
//   - 按"类型标识字符串"注册 (serialize, deserialize) 对；
//   - serialize(obj) 自动查表分派；deserialize(json) 同样按 json.type 分派。
//   - 不绑定具体类型：可注册任意 T 的序列化器，只要 type 字符串不冲突。
//
// 与 SceneSerializer 的关系：
//   - SceneSerializer 持有一个 SerializerRegistry 实例，把 Mesh/Group/Light 等
//     子对象的序列化委托给注册表中对应 type 的 serializer；
//   - 注册表是开放扩展点（第三方可注册自定义 Object3D 子类的序列化器）。

import { createLogger } from '@/lib/logger';

const log = createLogger('SerializerRegistry');

/** 序列化器接口：把 T 序列化为 JSON 片段 / 从 JSON 还原 T。 */
export interface Serializer<T, J extends { type: string }> {
  /** 把对象序列化为 JSON。返回值必须含 type 字段以供反序列化分派。 */
  serialize(obj: T): J;
  /** 从 JSON 还原对象。context 可选，用于注入外部依赖（如 AssetLoader）。 */
  deserialize(json: J, context?: unknown): T;
}

export class SerializerRegistry {
  private _serializers = new Map<string, Serializer<unknown, { type: string }>>();

  /** 注册某 type 的序列化器。重复注册后者覆盖前者。 */
  register<T, J extends { type: string }>(type: string, serializer: Serializer<T, J>): void {
    const prev = this._serializers.has(type);
    this._serializers.set(type, serializer as Serializer<unknown, { type: string }>);
    log.info(`register("${type}") ${prev ? '(overriding previous)' : '(new)'}`);
  }

  /** 取消注册。 */
  unregister(type: string): void {
    this._serializers.delete(type);
  }

  /** 查询某 type 是否已注册。 */
  has(type: string): boolean {
    return this._serializers.has(type);
  }

  /** 取出某 type 的序列化器。 */
  get<T, J extends { type: string } = { type: string }>(type: string): Serializer<T, J> | undefined {
    return this._serializers.get(type) as Serializer<T, J> | undefined;
  }

  /** 已注册的所有 type。 */
  types(): string[] {
    return Array.from(this._serializers.keys());
  }

  /** 自动分派序列化。type 取自 obj 的 type 字段（约定）。
   *  未注册时抛错。 */
  serialize<T extends { type: string }>(obj: T): { type: string } {
    const ser = this._serializers.get(obj.type);
    if (!ser) {
      throw new Error(`SerializerRegistry: no serializer for type "${obj.type}"`);
    }
    return ser.serialize(obj);
  }

  /** 自动分派反序列化。type 取自 json.type。
   *  未注册时抛错。 */
  deserialize<T = unknown, J extends { type: string } = { type: string }>(
    json: J,
    context?: unknown,
  ): T {
    const ser = this._serializers.get(json.type);
    if (!ser) {
      throw new Error(`SerializerRegistry: no serializer for type "${json.type}"`);
    }
    return ser.deserialize(json, context) as T;
  }

  /** 清空所有注册。 */
  clear(): void {
    this._serializers.clear();
  }
}

/** 全局单例。 */
let _default: SerializerRegistry | null = null;
export function getDefaultSerializerRegistry(): SerializerRegistry {
  if (!_default) _default = new SerializerRegistry();
  return _default;
}

/** 测试 / 资源回收：重置全局单例。 */
export function resetDefaultSerializerRegistry(): void {
  _default?.clear();
  _default = null;
}
