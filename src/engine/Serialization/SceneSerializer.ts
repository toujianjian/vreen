// SceneSerializer — Scene ↔ SceneJSON。
//
// 设计目标：
//   - 顶层 serialize(scene) → SceneJSON，deserialize(json) → Scene；
//   - 内部走 SerializerRegistry 分派子对象（Scene / Group / Mesh / Object3D）；
//   - Mesh 的 geometry 走 GeometrySerializer；material 走 MaterialSerializer；
//   - Scene 的 fog / background / environment 也序列化（environment 仅记 URL）。
//
// 扩展点：
//   - 通过 registerObjectHandler(type, serializer) 注册自定义 Object3D 子类；
//   - 通过 materialContext 注入纹理加载器（异步加载材质贴图）。
//
// 与 Object3D.toJSON() 的关系：
//   - Object3D.toJSON() 已序列化 transform/visible/children，但不含 geometry/material；
//   - 本序列化器在该基础上扩展为完整的 SceneJSON（可往返）。

import { Scene } from '../Core/Scene';
import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Color } from '../Math/Color';
import { Fog } from '../Core/Fog';
import { FogExp2 } from '../Core/FogExp2';
import type { CubeTexture } from '../Core/CubeTexture';
import type { Material } from '../Core/Material';
import { BasicMaterial } from '../Core/Material';

import {
  GeometrySerializer,
} from './GeometrySerializer';
import {
  serializeMaterial,
  deserializeMaterial,
  type MaterialDeserializeContext,
} from './MaterialSerializer';
import {
  SerializerRegistry,
  type Serializer,
} from './SerializerRegistry';
import type {
  SceneJSON,
  ObjectJSON,
  GeometryJSON,
  MaterialJSON,
  FogJSON,
  SceneMetadata,
} from './types';
import { createLogger } from '@/lib/logger';

const log = createLogger('SceneSerializer');

export const SCENE_SERIALIZER_VERSION = '1.0.0';

/** 反序列化上下文：注入外部依赖（如 AssetLoader）。 */
export interface SceneDeserializeContext {
  /** 材质贴图加载器（异步）。 */
  materialContext?: MaterialDeserializeContext;
  /** 几何体 URL 加载器（异步）；若 json.geometry 为 string 形式时使用。 */
  loadGeometry?: (url: string) => Promise<BufferGeometry>;
  /** 材质 URL 加载器（异步）；若 json.material 为 string 形式时使用。 */
  loadMaterial?: (url: string) => Promise<Material>;
}

// ── Object3D 处理器 ───────────────────────────────────────────

/** 通用 Object3D 序列化（不含 geometry/material）。Mesh/Group 复用此基础。 */
function serializeObject3DBase(obj: Object3D): Omit<ObjectJSON, 'geometry' | 'material'> {
  return {
    uuid: obj.uuid,
    type: obj.type,
    name: obj.name,
    position: obj.position.toArray() as [number, number, number],
    rotation: obj.rotation.toArray() as [number, number, number, number],
    scale: obj.scale.toArray() as [number, number, number],
    visible: obj.visible,
    children: obj.children.map((c) => serializeObject(c)),
    ...(Object.keys(obj.userData).length > 0 ? { userData: { ...obj.userData } } : {}),
  };
}

function deserializeObject3DBase(json: ObjectJSON, into: Object3D): void {
  into.name = json.name ?? '';
  if (json.position) into.position.fromArray(json.position);
  if (json.rotation && json.rotation.length >= 4) {
    // Quaternion 没有 fromArray；显式 set。
    into.rotation.set(json.rotation[0], json.rotation[1], json.rotation[2], json.rotation[3]);
  }
  if (json.scale) into.scale.fromArray(json.scale);
  if (json.visible !== undefined) into.visible = json.visible;
  if (json.userData) into.userData = { ...json.userData };
  // children 在外层 deserializeObject 中处理（需递归 + add）
}

// ── 各 type 的 Serializer ─────────────────────────────────────

const Object3DSerializer: Serializer<Object3D, ObjectJSON> = {
  serialize(obj: Object3D): ObjectJSON {
    return serializeObject3DBase(obj) as ObjectJSON;
  },
  deserialize(json: ObjectJSON, _ctx?: unknown): Object3D {
    const obj = new Object3D();
    deserializeObject3DBase(json, obj);
    if (json.children) {
      for (const childJSON of json.children) {
        const child = deserializeObject(childJSON);
        if (child) obj.add(child);
      }
    }
    return obj;
  },
};

const GroupSerializer: Serializer<Group, ObjectJSON> = {
  serialize(obj: Group): ObjectJSON {
    return { ...serializeObject3DBase(obj), type: 'Group' };
  },
  deserialize(json: ObjectJSON, _ctx?: unknown): Group {
    const g = new Group();
    deserializeObject3DBase(json, g);
    if (json.children) {
      for (const childJSON of json.children) {
        const child = deserializeObject(childJSON);
        if (child) g.add(child);
      }
    }
    return g;
  },
};

const MeshSerializer: Serializer<Mesh, ObjectJSON> = {
  serialize(mesh: Mesh): ObjectJSON {
    const base = serializeObject3DBase(mesh);
    // geometry
    let geometry: GeometryJSON | string | undefined;
    // 若 geometry 有 userData.url（或 name），序列化为 URL 引用
    const geomURL = (mesh.geometry.userData?.url as string | undefined) ?? (mesh.geometry.userData?.name as string | undefined);
    if (geomURL) {
      geometry = geomURL;
    } else {
      geometry = GeometrySerializer.serialize(mesh.geometry);
    }
    // material
    let material: MaterialJSON | string | (MaterialJSON | string)[] | undefined;
    if (Array.isArray(mesh.material)) {
      material = mesh.material.map((m) => serializeMaterial(m));
    } else {
      material = serializeMaterial(mesh.material);
    }
    const json: ObjectJSON = {
      ...base,
      type: 'Mesh',
    };
    if (geometry !== undefined) json.geometry = geometry;
    if (material !== undefined) json.material = material;
    return json;
  },
  deserialize(json: ObjectJSON, ctx?: unknown): Mesh {
    const sctx = ctx as SceneDeserializeContext | undefined;
    // geometry
    let geometry: BufferGeometry;
    if (typeof json.geometry === 'string') {
      if (!sctx?.loadGeometry) {
        log.warn(`Mesh "${json.name}" geometry is URL ref "${json.geometry}" but no loadGeometry in context — using empty geometry`);
        geometry = new BufferGeometry();
      } else {
        // 异步加载，先占位；加载完成后会替换实例的 geometry 字段（调用方需注意）
        geometry = new BufferGeometry();
        sctx.loadGeometry(json.geometry).then((g) => {
          log.info(`Mesh "${json.name}" geometry loaded from "${json.geometry}"`);
          // 注意：此处无法直接替换 Mesh.geometry（实例已被返回），调用方应在
          // 异步加载完成后再触发一次场景刷新。此处仅 log。
          void g;
        }).catch((err) => {
          log.error(`loadGeometry("${json.geometry}") failed: ${(err as Error).message ?? err}`);
        });
      }
    } else if (json.geometry && typeof json.geometry === 'object') {
      geometry = GeometrySerializer.deserialize(json.geometry);
    } else {
      geometry = new BufferGeometry();
    }
    // material
    let material: Material | Material[];
    if (json.material === undefined) {
      // 默认给一个 BasicMaterial 占位
      material = new BasicMaterial();
    } else if (Array.isArray(json.material)) {
      material = json.material.map((m) => {
        if (typeof m === 'string') {
          // URL 引用：异步加载，先占位
          if (sctx?.loadMaterial) {
            sctx.loadMaterial(m).catch((err) => {
              log.error(`loadMaterial("${m}") failed: ${(err as Error).message ?? err}`);
            });
          }
          return new BasicMaterial() as Material;
        }
        return deserializeMaterial(m, sctx?.materialContext);
      });
    } else if (typeof json.material === 'string') {
      if (sctx?.loadMaterial) {
        sctx.loadMaterial(json.material).catch((err) => {
          log.error(`loadMaterial("${json.material}") failed: ${(err as Error).message ?? err}`);
        });
      }
      material = new BasicMaterial();
    } else {
      material = deserializeMaterial(json.material, sctx?.materialContext);
    }
    const mesh = new Mesh(geometry, material);
    deserializeObject3DBase(json, mesh);
    if (json.children) {
      for (const childJSON of json.children) {
        const child = deserializeObject(childJSON);
        if (child) mesh.add(child);
      }
    }
    return mesh;
  },
};

// ── 全局对象分派表 ─────────────────────────────────────────────

const _objectRegistry = new SerializerRegistry();
_objectRegistry.register('Object3D', Object3DSerializer);
_objectRegistry.register('Group', GroupSerializer);
_objectRegistry.register('Mesh', MeshSerializer);

/** 注册自定义 Object3D 子类的序列化器。 */
export function registerObjectHandler<T extends Object3D, J extends ObjectJSON>(
  type: string,
  serializer: Serializer<T, J>,
): void {
  _objectRegistry.register(type, serializer as Serializer<unknown, { type: string }>);
}

/** 序列化单个 Object3D（按 type 分派）。 */
export function serializeObject(obj: Object3D): ObjectJSON {
  const ser = _objectRegistry.get<Object3D, ObjectJSON>(obj.type);
  if (ser) return ser.serialize(obj);
  // 未注册的 type：退化为 Object3D（保留 type 字符串）
  log.warn(`serializeObject — no handler for type "${obj.type}", fallback to Object3D`);
  return Object3DSerializer.serialize(obj);
}

/** 反序列化单个 Object3D（按 json.type 分派）。 */
export function deserializeObject(json: ObjectJSON, ctx?: SceneDeserializeContext): Object3D {
  const ser = _objectRegistry.get<Object3D, ObjectJSON>(json.type);
  if (ser) return ser.deserialize(json, ctx);
  log.warn(`deserializeObject — no handler for type "${json.type}", fallback to Object3D`);
  return Object3DSerializer.deserialize(json, ctx);
}

// ── Scene 顶层序列化 ───────────────────────────────────────────

/** 序列化场景背景。 */
function serializeBackground(bg: Scene['background']): number | string | null {
  if (bg === null) return null;
  if (bg instanceof Color) return bg.getHex();
  if (typeof bg === 'string') return bg;
  return null;
}

/** 序列化雾。 */
function serializeFog(fog: Scene['fog']): FogJSON | null {
  if (!fog) return null;
  if (fog instanceof Fog) {
    return {
      type: 'Fog',
      name: fog.name,
      color: fog.color.getHex(),
      near: fog.near,
      far: fog.far,
    };
  }
  if (fog instanceof FogExp2) {
    return {
      type: 'FogExp2',
      name: fog.name,
      color: fog.color.getHex(),
      density: fog.density,
    };
  }
  return null;
}

/** 反序列化雾。 */
function deserializeFog(json: FogJSON | null): Fog | FogExp2 | null {
  if (!json) return null;
  if (json.type === 'Fog') {
    const f = new Fog(json.color, json.near ?? 1, json.far ?? 1000);
    if (json.name) f.name = json.name;
    return f;
  }
  if (json.type === 'FogExp2') {
    const f = new FogExp2(json.color, json.density ?? 0.00025);
    if (json.name) f.name = json.name;
    return f;
  }
  return null;
}

/** 序列化环境贴图（仅记 URL；CubeTexture 暂无 URL 字段，用 name 兜底）。 */
function serializeEnvironment(env: CubeTexture | null): string | null {
  if (!env) return null;
  return env.name || null;
}

export interface SceneSerializerOptions {
  /** 元数据中的 generator 字段。 */
  generator?: string;
  /** 是否内联 Mesh.geometry（true）还是引用 URL（false，需 mesh.userData.url）。
   *  默认 true（内联）。 */
  inlineGeometry?: boolean;
  /** 是否内联 Mesh.material。默认 true。 */
  inlineMaterial?: boolean;
}

export class SceneSerializer {
  /** 默认实例（无选项）。 */
  static readonly default = new SceneSerializer();

  /** 序列化场景。 */
  static serialize(scene: Scene, opts?: SceneSerializerOptions): SceneJSON {
    return new SceneSerializer(opts ?? {}).serialize(scene);
  }

  /** 反序列化场景。 */
  static deserialize(json: SceneJSON, ctx?: SceneDeserializeContext): Scene {
    return new SceneSerializer().deserialize(json, ctx);
  }

  constructor(private readonly opts: SceneSerializerOptions = {}) {}

  /** 序列化。 */
  serialize(scene: Scene): SceneJSON {
    const meta: SceneMetadata = {
      generator: this.opts.generator ?? 'VREEN SceneSerializer',
      version: SCENE_SERIALIZER_VERSION,
      created: new Date().toISOString(),
    };
    const objects: ObjectJSON[] = scene.children.map((c) => serializeObject(c));
    const json: SceneJSON = {
      version: SCENE_SERIALIZER_VERSION,
      metadata: meta,
      background: serializeBackground(scene.background),
      environment: serializeEnvironment(scene.environment),
      fog: serializeFog(scene.fog),
      objects,
    };
    log.info(`serialize — ${objects.length} root objects, fog=${json.fog?.type ?? 'none'}`);
    return json;
  }

  /** 反序列化。 */
  deserialize(json: SceneJSON, ctx?: SceneDeserializeContext): Scene {
    const scene = new Scene();
    if (json.background !== undefined && json.background !== null) {
      if (typeof json.background === 'number') {
        scene.background = new Color(json.background);
      } else if (typeof json.background === 'string') {
        scene.background = json.background;
      }
    }
    if (json.fog) {
      scene.fog = deserializeFog(json.fog);
    }
    // environment 需要外部加载，这里只记 URL（写入 userData 供调用方读取）
    if (json.environment) {
      scene.userData.environmentURL = json.environment;
    }
    if (json.objects) {
      for (const objJSON of json.objects) {
        const obj = deserializeObject(objJSON, ctx);
        if (obj) scene.add(obj);
      }
    }
    log.info(`deserialize — ${scene.children.length} root objects, version=${json.version}`);
    return scene;
  }
}
