// MaterialSerializer — Material ↔ MaterialJSON。
//
// 设计策略：
//   - 不为每种 Material 子类单独写文件；通过"已知字段名集合"枚举式序列化。
//   - 序列化时按 type 字符串查表（每个 type 对应一组 uniform 字段名 + maps 字段名），
//     把这些字段从实例读出来塞进 uniforms/maps。
//   - 反序列化时按 type 构造对应类实例，并把 uniforms/maps 写回。
//   - Texture 字段（map/normalMap/...）只序列化为 URL（texture.name 或 texture.url）；
//     若无 URL 则写 null，反序列化时由调用方根据 maps 异步加载纹理。
//
// 已支持类型：
//   - Basic / MeshBasic
//   - Phong
//   - Standard / Physical
//   - Normal (无 uniforms)
//   - Shadow (无 uniforms)
//
// 扩展点：registerMaterialType(type, ctor, uniformFields, mapFields) 可注册新类型。

import type { Material, RGB } from '../Core/Material';
import { BasicMaterial } from '../Core/Material';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { PhysicalMaterial } from '../Materials/MeshPhysicalMaterial';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import { PhongMaterial } from '../Materials/MeshPhongMaterial';
import { NormalMaterial } from '../Materials/MeshNormalMaterial';
import { ShadowMaterial } from '../Materials/ShadowMaterial';
import type { Texture } from '../Core/Texture';
import type { MaterialJSON, MaterialUniformValue } from './types';
import type { Serializer } from './SerializerRegistry';
import { createLogger } from '@/lib/logger';

const log = createLogger('MaterialSerializer');

/** Material 构造器签名。 */
export interface MaterialConstructor {
  new (...args: any[]): Material;
}

/** 单个材质类型的元信息。 */
export interface MaterialTypeMeta {
  /** type 字符串，与 material.type 一致。 */
  type: string;
  /** 构造器（无参构造）。 */
  ctor: MaterialConstructor;
  /** 需要序列化为 uniforms 的字段名。 */
  uniformFields: string[];
  /** 需要序列化为 maps（URL 引用）的字段名。 */
  mapFields: string[];
}

/** 已注册的材质类型表。 */
const _materialTypes = new Map<string, MaterialTypeMeta>();

/** 注册一个材质类型。 */
export function registerMaterialType(meta: MaterialTypeMeta): void {
  _materialTypes.set(meta.type, meta);
  log.debug(`registerMaterialType("${meta.type}") — ${meta.uniformFields.length} uniforms, ${meta.mapFields.length} maps`);
}

/** 查询某 type 的元信息。 */
export function getMaterialTypeMeta(type: string): MaterialTypeMeta | undefined {
  return _materialTypes.get(type);
}

// ── 默认注册：内置材质 ────────────────────────────────────────

registerMaterialType({
  type: 'Basic',
  ctor: BasicMaterial,
  uniformFields: ['renderOrder', 'depthTest', 'depthWrite', 'wireframe'],
  mapFields: [],
});

registerMaterialType({
  type: 'MeshBasic',
  ctor: MeshBasicMaterial,
  uniformFields: ['color', 'opacity', 'transparent', 'renderOrder', 'depthTest', 'depthWrite', 'wireframe'],
  mapFields: ['map'],
});

registerMaterialType({
  type: 'Phong',
  ctor: PhongMaterial,
  uniformFields: ['color', 'specular', 'shininess', 'emissive', 'emissiveIntensity', 'opacity', 'transparent', 'flatShading', 'renderOrder', 'depthTest', 'depthWrite', 'wireframe'],
  mapFields: ['map'],
});

registerMaterialType({
  type: 'Standard',
  ctor: StandardMaterial,
  uniformFields: ['baseColor', 'metallic', 'roughness', 'emissive', 'emissiveIntensity', 'opacity', 'receiveShadow', 'renderOrder', 'depthTest', 'depthWrite', 'wireframe'],
  mapFields: ['map', 'normalMap', 'metallicRoughnessMap', 'emissiveMap'],
});

registerMaterialType({
  type: 'Physical',
  ctor: PhysicalMaterial,
  uniformFields: [
    'baseColor', 'metallic', 'roughness', 'emissive', 'emissiveIntensity', 'opacity',
    'receiveShadow', 'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenColor',
    'sheenRoughness', 'transmission', 'thickness', 'ior',
    'attenuationColor', 'attenuationDistance', 'specularIntensity', 'specularColor',
    'renderOrder', 'depthTest', 'depthWrite', 'wireframe',
  ],
  mapFields: ['map', 'normalMap', 'metallicRoughnessMap', 'emissiveMap'],
});

registerMaterialType({
  type: 'Normal',
  ctor: NormalMaterial,
  uniformFields: ['renderOrder', 'depthTest', 'depthWrite', 'wireframe'],
  mapFields: [],
});

registerMaterialType({
  type: 'Shadow',
  ctor: ShadowMaterial,
  uniformFields: ['renderOrder', 'depthTest', 'depthWrite', 'wireframe'],
  mapFields: [],
});

// ── 序列化器实现 ──────────────────────────────────────────────

function readField(obj: Record<string, unknown>, field: string): MaterialUniformValue | undefined {
  const v = obj[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'object') {
    // RGB {r,g,b} 或数组
    if (Array.isArray(v)) return v as number[];
    if ('r' in (v as object) && 'g' in (v as object) && 'b' in (v as object)) {
      const c = v as RGB;
      return { r: c.r, g: c.g, b: c.b };
    }
  }
  return undefined;
}

function writeField(obj: Record<string, unknown>, field: string, value: MaterialUniformValue): void {
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    obj[field] = value;
    return;
  }
  if (Array.isArray(value)) {
    obj[field] = value.slice();
    return;
  }
  // RGB
  obj[field] = { ...value };
}

/** 把 Texture 序列化为 URL 引用（或 null）。 */
function textureToURL(tex: Texture | null | undefined): string | null {
  if (!tex) return null;
  // 优先用 name 字段；未来若有 source.url，可在此扩展。
  return tex.name || null;
}

/** 序列化单个 Material。 */
export function serializeMaterial(material: Material): MaterialJSON {
  const meta = _materialTypes.get(material.type);
  if (!meta) {
    log.warn(`serializeMaterial — unknown type "${material.type}", fallback to Basic`);
    // 降级：仅记录 type + userData
    return {
      type: material.type,
      uuid: material.uuid,
      uniforms: {},
      userData: { ...material.userData },
    };
  }
  const uniforms: Record<string, MaterialUniformValue> = {};
  const obj = material as unknown as Record<string, unknown>;
  for (const f of meta.uniformFields) {
    const v = readField(obj, f);
    if (v !== undefined) uniforms[f] = v;
  }
  const maps: Record<string, string | null> = {};
  let hasMaps = false;
  for (const f of meta.mapFields) {
    const tex = obj[f] as Texture | null | undefined;
    const url = textureToURL(tex);
    maps[f] = url;
    hasMaps = true;
  }
  const json: MaterialJSON = {
    type: meta.type,
    uuid: material.uuid,
    uniforms,
  };
  if (hasMaps) json.maps = maps;
  if (Object.keys(material.userData).length > 0) json.userData = { ...material.userData };
  return json;
}

/** 反序列化单个 Material。
 *  context 可选：若提供 { loadTexture: (url) => Promise<Texture|null> }，
 *  会异步加载纹理并写入对应字段；否则纹理字段保持 null。 */
export interface MaterialDeserializeContext {
  loadTexture?: (url: string) => Promise<Texture | null>;
}

export function deserializeMaterial(
  json: MaterialJSON,
  context?: MaterialDeserializeContext,
): Material {
  const meta = _materialTypes.get(json.type);
  if (!meta) {
    log.warn(`deserializeMaterial — unknown type "${json.type}", fallback to BasicMaterial`);
    const fallback = new BasicMaterial();
    fallback.userData = { ...(json.userData ?? {}), originalType: json.type };
    return fallback;
  }
  const mat = new meta.ctor() as Material & Record<string, unknown>;
  const uniforms = json.uniforms ?? {};
  for (const [field, value] of Object.entries(uniforms)) {
    writeField(mat as Record<string, unknown>, field, value);
  }
  if (json.userData) {
    mat.userData = { ...json.userData };
  }
  // 纹理：若提供了 context.loadTexture，则异步加载并写入字段。
  // 注意：本方法返回同步 Material 实例；纹理会在加载完成后才被填入。
  if (json.maps && context?.loadTexture) {
    for (const [field, url] of Object.entries(json.maps)) {
      if (!url) continue;
      context.loadTexture(url).then((tex) => {
        if (tex) {
          (mat as Record<string, unknown>)[field] = tex;
        }
      }).catch((err) => {
        log.warn(`loadTexture("${url}") for field "${field}" failed: ${(err as Error).message ?? err}`);
      });
    }
  }
  return mat;
}

/** Serializer 接口适配器（供 SerializerRegistry 使用）。 */
export const MaterialSerializer: Serializer<Material, MaterialJSON> = {
  serialize: serializeMaterial,
  deserialize: (json: MaterialJSON, ctx?: unknown) => deserializeMaterial(json, ctx as MaterialDeserializeContext | undefined),
};
