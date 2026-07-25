// Serialization barrel — 场景序列化模块统一导出。
//
// 模块职责：
//   - SerializerRegistry  — 序列化器注册表（按 type 分派）
//   - GeometrySerializer  — BufferGeometry ↔ GeometryJSON
//   - MaterialSerializer  — Material ↔ MaterialJSON
//   - SceneSerializer     — Scene ↔ SceneJSON（顶层入口）
//   - types               — JSON Schema 类型定义

export {
  SerializerRegistry,
  getDefaultSerializerRegistry,
  resetDefaultSerializerRegistry,
  type Serializer,
} from './SerializerRegistry';
export {
  GeometrySerializer,
  GEOMETRY_TYPE,
} from './GeometrySerializer';
export {
  MaterialSerializer,
  serializeMaterial,
  deserializeMaterial,
  registerMaterialType,
  getMaterialTypeMeta,
  type MaterialConstructor,
  type MaterialTypeMeta,
  type MaterialDeserializeContext,
} from './MaterialSerializer';
export {
  SceneSerializer,
  serializeObject,
  deserializeObject,
  registerObjectHandler,
  SCENE_SERIALIZER_VERSION,
  type SceneSerializerOptions,
  type SceneDeserializeContext,
} from './SceneSerializer';
export type {
  SceneJSON,
  ObjectJSON,
  GeometryJSON,
  MaterialJSON,
  FogJSON,
  SceneMetadata,
  BufferAttributeJSON,
  MaterialUniformValue,
} from './types';
