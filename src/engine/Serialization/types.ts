// Serialization types — 序列化 JSON Schema。
//
// 与 Core/Object3D.toJSON() 的差异：
//   - Object3D.toJSON() 只覆盖 transform/visible/children，不含 geometry/material；
//   - 本模块定义的 Schema 扩展到几何体属性、材质 uniforms、纹理 URL 引用、
//     场景 fog/background 等完整字段，可往返还原 Scene。
//
// 纹理引用策略：
//   - 序列化时 Texture 仅记录其 URL（或 null），不内联位图数据；
//   - 反序列化时由调用方根据 URL 走 AssetLoader 异步加载，材料先以 null 占位。

// ── Geometry ──────────────────────────────────────────────────

export interface BufferAttributeJSON {
  itemSize: number;
  array: number[];
}

export interface GeometryJSON {
  type: 'BufferGeometry';
  attributes: Record<string, BufferAttributeJSON>;
  index: { array: number[] } | null;
  groups: { start: number; count: number; materialIndex: number }[];
  userData?: Record<string, unknown>;
}

// ── Material ──────────────────────────────────────────────────

/** 材质 uniforms：标量 / 三元组 / 布尔。键名与材质字段名一致。 */
export type MaterialUniformValue =
  | number
  | boolean
  | string
  | { r: number; g: number; b: number }
  | number[];

export interface MaterialJSON {
  type: string;
  uuid: string;
  /** 字段名 → 值。涵盖 color/specular/emissive/metallic/roughness 等。 */
  uniforms: Record<string, MaterialUniformValue>;
  /** 纹理贴图引用：字段名 → URL（或 null）。反序列化时由调用方注入 Texture。 */
  maps?: Record<string, string | null>;
  userData?: Record<string, unknown>;
}

// ── Object3D / Mesh ───────────────────────────────────────────

export interface ObjectJSON {
  uuid: string;
  type: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  visible: boolean;
  userData?: Record<string, unknown>;
  children: ObjectJSON[];
  /** 仅 Mesh 有：几何体（内联 JSON 或 URL 引用）。 */
  geometry?: GeometryJSON | string;
  /** 仅 Mesh 有：材质（内联 JSON 或 URL 引用，单材质或数组）。 */
  material?: MaterialJSON | string | (MaterialJSON | string)[];
}

// ── Scene ─────────────────────────────────────────────────────

export interface FogJSON {
  type: 'Fog' | 'FogExp2';
  name?: string;
  color: number;
  near?: number;
  far?: number;
  density?: number;
}

export interface SceneMetadata {
  generator?: string;
  version?: string;
  created?: string;
  [k: string]: unknown;
}

export interface SceneJSON {
  version: string;
  metadata: SceneMetadata;
  background: number | string | null;
  environment: string | null;
  fog: FogJSON | null;
  objects: ObjectJSON[];
}
