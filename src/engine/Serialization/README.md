# Serialization Module

> Path: `src/engine/Serialization/`
>
> The (de)serialisation subsystem of the `@vreen/engine` kernel. Provides
> a type-dispatched `SerializerRegistry`, concrete serializers for
> `BufferGeometry`, `Material`, and the `Scene` graph, and the JSON
> schema types that define the on-disk shape of a scene. Round-trip
> stable: `serialize` followed by `deserialize` reproduces the scene
> (geometry attributes, material uniforms, transform TRS, fog, background)
> up to texture URL resolution (textures are referenced, not inlined).

---

## Overview

```
SceneSerializer (top-level entry)
   ├── serialize(scene) → SceneJSON
   ├── deserialize(SceneJSON, ctx?) → Scene
   └── delegates per-object to ↓
          │
          ▼
SerializerRegistry (type-dispatched)
   ├── register(type, Serializer)
   ├── serialize(obj)   ← looks up obj.type
   └── deserialize(json) ← looks up json.type
          │
          ▼  (built-in handlers)
Object3DSerializer / GroupSerializer / MeshSerializer
          │
          ▼  (Mesh composes these)
GeometrySerializer     ← BufferGeometry ↔ GeometryJSON
MaterialSerializer     ← Material     ↔ MaterialJSON
   └── serializeMaterial / deserializeMaterial
   └── registerMaterialType / getMaterialTypeMeta

types.ts               ← JSON schema (SceneJSON / ObjectJSON / ...)
```

Three layers, each with a single responsibility:

- **`SerializerRegistry`** — the open extension point. Maps a `type`
  string to a `Serializer<T, J>` pair; `serialize` / `deserialize` look
  up by `obj.type` / `json.type` and throw if the type is unknown.
- **`GeometrySerializer` / `MaterialSerializer`** — concrete serializers
  for the value types referenced from `Mesh`. `MaterialSerializer` is
  data-driven: each material type registers its `uniformFields` +
  `mapFields` so adding a new material needs no code changes here.
- **`SceneSerializer`** — the top-level orchestrator. Walks the scene
  graph, dispatches each node to the registry, serialises fog /
  background / environment, and stamps `SceneMetadata` (version,
  generator, ISO timestamp).

---

## Core Classes

### `SerializerRegistry` (`SerializerRegistry.ts`)

| Export | Role |
|--------|------|
| `SerializerRegistry` | Type → `Serializer<T, J>` map. `register` / `unregister` / `has` / `get` / `types` / `clear`. |
| `Serializer<T, J>` | Interface — `serialize(obj: T): J` + `deserialize(json: J, context?): T`. `J` must carry a `type` field. |
| `getDefaultSerializerRegistry()` | Process-level singleton accessor (lazy). |
| `resetDefaultSerializerRegistry()` | Clears + drops the singleton (for tests / hot reload). |

```ts
export interface Serializer<T, J extends { type: string }> {
  serialize(obj: T): J;
  deserialize(json: J, context?: unknown): T;
}

export class SerializerRegistry {
  register<T, J extends { type: string }>(type: string, s: Serializer<T, J>): void;
  unregister(type: string): void;
  has(type: string): boolean;
  get<T, J>(type: string): Serializer<T, J> | undefined;
  types(): string[];
  serialize<T extends { type: string }>(obj: T): { type: string };
  deserialize<T, J>(json: J, context?: unknown): T;
  clear(): void;
}
```

`serialize` throws if `obj.type` is not registered; `deserialize`
throws if `json.type` is not registered. Re-registering a type overrides
the previous entry (with a log line).

### `GeometrySerializer` (`GeometrySerializer.ts`)

| Export | Role |
|--------|------|
| `GeometrySerializer` | `Serializer<BufferGeometry, GeometryJSON>`. |
| `GEOMETRY_TYPE` | `'BufferGeometry'` — the value of `GeometryJSON.type`. |

```ts
export interface GeometryJSON {
  type: 'BufferGeometry';
  attributes: Record<string, BufferAttributeJSON>;
  index: { array: number[] } | null;
  groups: { start: number; count: number; materialIndex: number }[];
  userData?: Record<string, unknown>;
}

export interface BufferAttributeJSON {
  itemSize: number;
  array: number[]; // JSON-friendly; reconstructed to Float32Array on load
}
```

On serialise, each `BufferAttribute.array` is spread to a plain
`number[]` (JSON cannot carry typed arrays). On deserialise, attribute
arrays are rebuilt as `Float32Array`; the index array is handed to
`BufferGeometry.setIndex`, which auto-selects `Uint16` vs `Uint32` based
on the max value. `groups` and `userData` round-trip exactly.

### `MaterialSerializer` (`MaterialSerializer.ts`)

| Export | Role |
|--------|------|
| `MaterialSerializer` | `Serializer<Material, MaterialJSON>` adapter. |
| `serializeMaterial(material)` | Reads registered `uniformFields` + `mapFields`, packs to `MaterialJSON`. |
| `deserializeMaterial(json, ctx?)` | Constructs the registered `ctor`, writes uniforms back, optionally async-loads textures. |
| `registerMaterialType(meta)` | Registers a `MaterialTypeMeta` (`type` / `ctor` / `uniformFields` / `mapFields`). |
| `getMaterialTypeMeta(type)` | Lookup. |
| `MaterialConstructor` | `new (...args: any[]) => Material`. |
| `MaterialTypeMeta` | `{ type, ctor, uniformFields, mapFields }`. |
| `MaterialDeserializeContext` | `{ loadTexture?: (url) => Promise<Texture \| null> }`. |

```ts
export interface MaterialJSON {
  type: string;
  uuid: string;
  uniforms: Record<string, MaterialUniformValue>;
  maps?: Record<string, string | null>; // field name → texture URL
  userData?: Record<string, unknown>;
}

export type MaterialUniformValue =
  | number
  | boolean
  | string
  | { r: number; g: number; b: number }
  | number[];
```

Built-in registrations (added at module load):

| `type` | Class | Notable uniform fields | Map fields |
|--------|-------|------------------------|------------|
| `'Basic'` | `BasicMaterial` | `renderOrder`, `depthTest`, `depthWrite`, `wireframe` | — |
| `'MeshBasic'` | `MeshBasicMaterial` | `color`, `opacity`, `transparent`, … | `map` |
| `'Phong'` | `PhongMaterial` | `color`, `specular`, `shininess`, `emissive`, … | `map` |
| `'Standard'` | `StandardMaterial` | `baseColor`, `metallic`, `roughness`, `emissive`, … | `map`, `normalMap`, `metallicRoughnessMap`, `emissiveMap` |
| `'Physical'` | `MeshPhysicalMaterial` | adds `clearcoat`, `sheen`, `transmission`, `thickness`, `ior`, … | same as `Standard` |
| `'Normal'` | `NormalMaterial` | `renderOrder`, `depthTest`, `depthWrite`, `wireframe` | — |
| `'Shadow'` | `ShadowMaterial` | `renderOrder`, `depthTest`, `depthWrite`, `wireframe` | — |

Texture handling: textures are serialised as URL strings (via
`texture.name`); the actual bitmap is never inlined. On deserialise, if
`ctx.loadTexture` is provided, each map URL triggers an async load that
writes the texture into the corresponding material field once resolved;
the material is returned synchronously with `null` placeholders.

Unknown material types fall back to `BasicMaterial` (on deserialise) or
a minimal `{ type, uuid, uniforms: {} }` shape (on serialise), with a
warning.

### `SceneSerializer` (`SceneSerializer.ts`)

| Export | Role |
|--------|------|
| `SceneSerializer` | Class — `serialize(scene)` / `deserialize(json, ctx?)`. Also has static `serialize` / `deserialize` convenience methods + a `default` instance. |
| `SCENE_SERIALIZER_VERSION` | `'1.0.0'` — stamped into `SceneJSON.version` + `metadata.version`. |
| `serializeObject(obj)` | Serialise a single `Object3D` by dispatching to the object registry. |
| `deserializeObject(json, ctx?)` | Deserialise a single `ObjectJSON`. |
| `registerObjectHandler(type, serializer)` | Register a custom `Object3D` subclass handler. |
| `SceneSerializerOptions` | `generator?` / `inlineGeometry?` (default true) / `inlineMaterial?` (default true). |
| `SceneDeserializeContext` | `materialContext?` / `loadGeometry?` / `loadMaterial?`. |

Built-in object handlers: `'Object3D'`, `'Group'`, `'Mesh'`. The `Mesh`
handler delegates `geometry` to `GeometrySerializer` (or to
`ctx.loadGeometry` when `geometry` is a URL string) and `material` to
`MaterialSerializer` (or `ctx.loadMaterial` for URL references). When
the geometry / material URL loaders are absent, an empty geometry or
`BasicMaterial` placeholder is used and a warning is logged.

```ts
export interface SceneJSON {
  version: string;
  metadata: SceneMetadata;
  background: number | string | null;     // Color hex | CSS string | null
  environment: string | null;             // CubeTexture URL (name)
  fog: FogJSON | null;
  objects: ObjectJSON[];                  // root-level children
}

export interface ObjectJSON {
  uuid: string;
  type: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number, number]; // Quaternion x, y, z, w
  scale: [number, number, number];
  visible: boolean;
  userData?: Record<string, unknown>;
  children: ObjectJSON[];
  geometry?: GeometryJSON | string;                 // Mesh only
  material?: MaterialJSON | string | (MaterialJSON | string)[]; // Mesh only
}

export interface FogJSON {
  type: 'Fog' | 'FogExp2';
  name?: string;
  color: number;
  near?: number;     // Fog
  far?: number;      // Fog
  density?: number;  // FogExp2
}
```

`environment` is recorded as the `CubeTexture.name` URL only; the
deserialise step writes it to `scene.userData.environmentURL` so the
caller can asynchronously load and assign the cube map.

### `types.ts`

| Export | Role |
|--------|------|
| `SceneJSON` / `ObjectJSON` / `GeometryJSON` / `MaterialJSON` / `FogJSON` | Schema interfaces (see above). |
| `BufferAttributeJSON` | `{ itemSize, array: number[] }`. |
| `SceneMetadata` | `{ generator?, version?, created?, [k]: unknown }`. |
| `MaterialUniformValue` | Union — `number \| boolean \| string \| RGB \| number[]`. |

---

## Usage

### Full scene round-trip

```ts
import { SceneSerializer } from '@vreen/engine/serialization';
import { Scene, Mesh, Group } from '@vreen/engine/core';
import { BoxGeometry } from '@vreen/engine/geometries';
import { StandardMaterial } from '@vreen/engine/materials';
import { Fog } from '@vreen/engine/core';

const scene = new Scene();
scene.background = 0x111122;
scene.fog = new Fog(0x111122, 1, 100);

const mesh = new Mesh(
  new BoxGeometry(1, 1, 1),
  new StandardMaterial({ baseColor: { r: 0.8, g: 0.4, b: 0.2 }, metallic: 0.1, roughness: 0.7 }),
);
mesh.position.set(0, 0.5, 0);
mesh.name = 'crate';
scene.add(mesh);

const json = SceneSerializer.serialize(scene, { generator: 'demo' });
const restored = SceneSerializer.deserialize(json);
// restored.children[0] is a Mesh with matching TRS, geometry, material uniforms
```

### Custom object handler

```ts
import { registerObjectHandler, type Serializer } from '@vreen/engine/serialization';
import { Object3D } from '@vreen/engine/core';

class TriggerVolume extends Object3D {
  radius = 1;
  override readonly type = 'TriggerVolume';
}

const handler: Serializer<TriggerVolume, any> = {
  serialize(obj) {
    return {
      type: 'TriggerVolume',
      uuid: obj.uuid,
      name: obj.name,
      position: obj.position.toArray(),
      rotation: obj.rotation.toArray(),
      scale: obj.scale.toArray(),
      visible: obj.visible,
      children: [],
      userData: { ...obj.userData, radius: obj.radius },
    };
  },
  deserialize(json) {
    const t = new TriggerVolume();
    t.name = json.name;
    t.position.fromArray(json.position);
    t.radius = json.userData?.radius ?? 1;
    return t;
  },
};

registerObjectHandler('TriggerVolume', handler);
```

### Custom material type

```ts
import { registerMaterialType } from '@vreen/engine/serialization';

class WaterMaterial extends BasicMaterial {
  override readonly type = 'Water';
  waveStrength = 0.5;
}

registerMaterialType({
  type: 'Water',
  ctor: WaterMaterial,
  uniformFields: ['color', 'opacity', 'waveStrength', 'wireframe'],
  mapFields: ['map', 'normalMap'],
});
// SceneSerializer.serialize now emits `type: 'Water'` + the extra uniform.
```

### Async texture rehydration

```ts
import { SceneSerializer, type SceneDeserializeContext } from '@vreen/engine/serialization';

const ctx: SceneDeserializeContext = {
  materialContext: { loadTexture: async (url) => assetManager.loadTexture(url) },
  loadGeometry: async (url) => assetManager.loadGeometry(url),
  loadMaterial: async (url) => assetManager.loadMaterial(url),
};
const scene = SceneSerializer.deserialize(json, ctx);
// Mesh materials returned synchronously with null textures;
// ctx.loadTexture resolves async and fills the texture fields.
```

### Registry-driven dispatch

```ts
import { getDefaultSerializerRegistry } from '@vreen/engine/serialization';
const reg = getDefaultSerializerRegistry();
reg.register('MyType', { serialize, deserialize });
const json = reg.serialize({ type: 'MyType', /* ... */ });
const obj = reg.deserialize(json);
```

---

## Invariants

- **Round-trip stability.** `deserialize(serialize(scene))` reproduces
  transform TRS, `visible`, `name`, `userData`, geometry attributes + index
  + groups, material uniforms, fog, and background — modulo textures,
  which are URL references resolved asynchronously by the caller.
- **Type-tagged JSON.** Every JSON object carries a `type` string.
  `SerializerRegistry.serialize` reads `obj.type`; `deserialize` reads
  `json.type`. Unknown types throw synchronously.
- **Registry openness.** `registerObjectHandler` and
  `registerMaterialType` are the only extension points needed for a new
  `Object3D` subclass or material. Built-in handlers (`Object3D`, `Group`,
  `Mesh`) and seven material types register at module load; third-party
  registrations override or augment them.
- **Geometry fidelity.** Typed arrays are stored as plain `number[]`
  (JSON-safe). On deserialise, attributes become `Float32Array`; the
  index is auto-typed (`Uint16` / `Uint32`) by `BufferGeometry.setIndex`.
  `groups` and `userData` round-trip exactly.
- **Material uniform schema.** `MaterialUniformValue` is restricted to
  `number`, `boolean`, `string`, `{ r, g, b }`, or `number[]`. Anything
  else on a registered `uniformFields` entry is dropped silently.
- **Texture reference strategy.** Textures are never inlined. Serialise
  writes `Texture.name` (or `null`); deserialise leaves the field `null`
  unless `ctx.materialContext.loadTexture` is provided, in which case the
  load runs in the background and writes the texture field once resolved.
  The material itself is returned synchronously.
- **Unknown material fallback.** Deserialising an unregistered type
  produces a `BasicMaterial` with `userData.originalType` set + warning.
  Serialising an unregistered type produces a minimal
  `{ type, uuid, uniforms: {} }` envelope + warning.
- **URL references in Mesh.** When `geometry` or `material` is a string
  URL on the JSON side, `ctx.loadGeometry` / `ctx.loadMaterial` is
  invoked. If absent, an empty `BufferGeometry` or `BasicMaterial`
  placeholder is substituted + warning logged.
- **Environment handling.** The scene `environment` (`CubeTexture`) is
  recorded as its `name` URL only. On deserialise the URL is written to
  `scene.userData.environmentURL`; the caller loads + assigns the cube
  map.
- **Metadata stamping.** `SceneSerializer.serialize` always writes
  `version: SCENE_SERIALIZER_VERSION` and a `metadata` block (`generator`,
  `version`, ISO `created`). Override via `SceneSerializerOptions.generator`.
- **Version stability.** `SCENE_SERIALIZER_VERSION` is `'1.0.0'`; no
  migration layer yet. A future bump will require a `migrate(json)`
  helper invoked before `deserialize`.
- **Registry singleton + no I/O.** `getDefaultSerializerRegistry()` is
  lazy + process-level (`resetDefaultSerializerRegistry()` for tests).
  No serializer performs filesystem or network I/O — all external
  resource resolution flows through the optional `context` argument.

---

## References

- `SerializerRegistry.ts` — type-dispatched registry + `Serializer` interface + process singleton.
- `GeometrySerializer.ts` — `BufferGeometry` ↔ `GeometryJSON`, typed-array round-trip, `GEOMETRY_TYPE`.
- `MaterialSerializer.ts` — data-driven material (de)serialisation, seven built-in registrations, async texture loading.
- `SceneSerializer.ts` — top-level `Scene` ↔ `SceneJSON`, fog / background / environment handling, `registerObjectHandler`.
- `types.ts` — JSON schema interfaces.
- Related: `src/engine/Core/` (`Scene`, `Object3D`, `Mesh`, `Group`, `BufferGeometry`, `Material`, `Fog`, `FogExp2`);
  `src/engine/Materials/` (`StandardMaterial`, `MeshPhysicalMaterial`, `MeshBasicMaterial`, `MeshPhongMaterial`, `MeshNormalMaterial`, `ShadowMaterial`);
  `src/engine/SaveSystem/SaveSerializer.ts` (uses `SceneSerializer.serialize` + `World.toJSON`).
