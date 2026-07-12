# VREEN Format Specification

**Version: 0.2.1** — Authoritative reference for the `.vreen` package format and its `.vreen-delta` extension.

This document is the **single source of truth** for any implementation. All SDKs (TypeScript, Java, C#, C++, Python) MUST conform to the schemas and algorithms described here.

---

## 1. Overview

A `.vreen` file is a **ZIP container** (RFC 1951 DEFLATE, with standard ZIP local file headers — i.e. compatible with `unzip`) containing a complete 3D project state:

- One **manifest** (machine-readable inventory + metadata)
- One **scene** (camera, animation, environment, post-processing, materials)
- An optional embedded **ECS world** (deterministic game state)
- Zero or more **assets** (models, textures, HDRI, audio)

A `.vreen-delta` is a similar ZIP containing only the **changes** from a base `.vreen`, plus enough metadata to reconstruct the head.

The format is **forward-compatible**: implementations MUST ignore unknown fields. Old versions are auto-migrated by current readers.

---

## 2. Layout (`.vreen`)

```
<name>.vreen
├── manifest.json             required — see §4
├── scene.json                required — see §5
├── project.json              optional — legacy 0.1.x state (mirror of scene.json)
├── world.json                optional — embedded ECS world
└── assets/
    ├── model.glb             primary 3D model (or any extension)
    ├── model.fbx             additional model
    ├── textures/             image textures
    │   ├── <id>.png
    │   └── <id>.jpg
    ├── hdri/                 environment maps
    │   └── <id>.hdr
    └── audio/                sound files (reserved)
        └── <id>.ogg
```

**Rules:**

- UTF-8 throughout. No BOM.
- Path separator is `/`.
- `manifest.json` and `scene.json` are required for 0.2.x. Missing → `VreenFormatError`.
- 0.1.x containers (single `project.json` or plain JSON) are auto-migrated to 0.2.x structures by readers.

---

## 3. Format Versioning

- Current: **`0.2.1`**
- Legacy: `0.1.0`

When unpacking, the reader MUST:

1. Sniff the first 4 bytes:
   - `50 4B 03 04` (`PK\x03\x04`) → ZIP
   - `{` or `[` → plain JSON
2. ZIP path:
   - Has `manifest.json` + `scene.json` → 0.2.x — parse directly
   - Has only `project.json` → 0.1.x — migrate
3. Plain JSON path → 0.1.x — migrate

**Migration rules (0.1.x → 0.2.x):**

- 0.1.x `project.json` fields (`camera`, `animation`, `materials`, `environment`, `postFX`) are copied verbatim into a 0.2.x `scene.json`.
- A synthetic minimal `manifest.json` is created:
  ```json
  {
    "version": "0.2.1",
    "exportedAt": "<0.1.x.exportedAt>",
    "name": "<0.1.x.assetName>",
    "assetName": "<0.1.x.assetName>",
    "assets": [],
    "primaryModelId": null,
    "generator": "VREEN Legacy Upgrader"
  }
  ```

---

## 4. `manifest.json` Schema

```json
{
  "$schema": "https://vreen.dev/schemas/manifest-0.2.json",
  "version": "0.2.1",
  "exportedAt": "2026-07-11T08:30:00.000Z",
  "name": "My Project",
  "assetName": "robot.glb",
  "generator": "VREEN Engine 0.2.1",
  "primaryModelId": "ab12cd34...",
  "assets": [
    {
      "id": "ab12cd34...",
      "kind": "model",
      "path": "assets/model.glb",
      "size": 1048576,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "originalName": "robot.glb",
      "meta": { "format": "glb", "version": 2 }
    }
  ],
  "world": { /* optional — see §7 */ }
}
```

### Field constraints

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | string | yes | Must equal `"0.2.1"` |
| `exportedAt` | string (ISO 8601) | yes | UTC |
| `name` | string | yes | 1..120 chars |
| `assetName` | string | yes | Display name of the primary 3D asset |
| `generator` | string | yes | "VREEN Engine 0.2.1" or other producer string |
| `primaryModelId` | string \| null | yes | Must reference an asset with `kind: "model"` if non-null |
| `assets` | array | yes | May be empty |
| `world` | object | no | ECS state, see §7 |

### `assets[]` constraints

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | 16-32 hex chars (UUIDv4-style) |
| `kind` | enum | yes | One of `model`, `texture`, `hdri`, `audio` |
| `path` | string | yes | POSIX path, no leading `/`, no `..` |
| `size` | int | yes | Bytes; must equal the actual ZIP entry size |
| `sha256` | string | no | 64 hex chars; if present, MUST match actual content hash |
| `originalName` | string | no | User's filename at upload time |
| `meta` | object | no | Free-form, implementation-specific |

---

## 5. `scene.json` Schema

```json
{
  "$schema": "https://vreen.dev/schemas/scene-0.2.json",
  "version": "0.2.1",
  "camera": {
    "preset": "perspective",
    "distance": 4.0,
    "targetHeight": 0.0,
    "yaw": 0.0,
    "fov": 50.0
  },
  "animation": {
    "speed": 1.0,
    "playing": true,
    "currentTime": 0.0
  },
  "environment": {
    "preset": "midnight",
    "exposure": 1.0,
    "background": "solid",
    "backgroundColor": "#03050b"
  },
  "postFX": {
    "bloom": false,
    "bloomIntensity": 0.6,
    "chromaticAberration": false,
    "vignette": false,
    "ssao": false
  },
  "materials": {
    "<assetId>": {
      "baseColor": "#ffffff",
      "metallic": 0.0,
      "roughness": 0.5,
      "emissive": "#000000",
      "emissiveIntensity": 0.0,
      "normalScale": 1.0,
      "opacity": 1.0,
      "wireframe": false
    }
  }
}
```

### Validation

- `camera.preset` ∈ `perspective` | `top` | `side` | `front` | `isometric` | `cinematic`
- `camera.fov` ∈ (0, 180)
- `environment.background` ∈ `solid` | `environment` | `transparent`
- `materials.<id>` keys MUST match `manifest.assets[].id` where `kind = model|texture`
- Unknown fields are ignored (forward compat).

---

## 6. `world.json` Schema (embedded ECS state)

The world is a **deterministic** representation of the ECS, suitable for replay or cross-engine simulation.

```json
{
  "version": "0.2.0",
  "name": "level1",
  "frame": 0,
  "entities": [
    {
      "id": 1,
      "name": "Player",
      "sceneNode": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0, 1],
        "scale": [1, 1, 1]
      },
      "components": [
        { "type": "Transform", "data": { "position": [0,0,0], "rotation": [0,0,0,1], "scale": [1,1,1] } },
        { "type": "Velocity", "data": { "linear": [0,0,0], "angular": [0,0,0] } },
        { "type": "PlayerInput", "data": { "forward": 0, "turn": 0 } }
      ]
    }
  ]
}
```

**Rules:**

- `id` is a stable integer (assigned at creation, never reused within a session).
- `name` is unique within the world.
- `sceneNode` mirrors the visual transform (XZ-plane game convention: +Y up).
- `components[].type` is a registered component class name. Implementations are free to map it to engine-native types.
- Order of entities and components is **significant** (insertion order).
- Unknown component types MUST be preserved (round-trip safe) but may be ignored by engines that lack the component.

---

## 7. `.vreen-delta` (Incremental Package)

A `.vreen-delta` is a ZIP that, when **applied** to a known base `.vreen`, produces a new head `.vreen`. It is the foundation for VREEN's update mechanism (download only what changed).

### Layout

```
<name>.vreen-delta
├── manifest.json             head manifest (VREEN 0.2.1) with a "delta" annotation
├── scene.json                head scene (full)
├── world.json                head world if present (full)
├── delta.json                structured change set
└── assets/<path>             only add / modify entries from head
```

### `manifest.json` (delta form)

Same as the head manifest, plus:

```json
{
  ...head fields...,
  "delta": {
    "baseExportedAt": "2026-07-10T00:00:00.000Z",
    "deltaBytes": 4096,
    "fullBytes": 1048576,
    "savingsRatio": 0.996,
    "changedAssetIds": ["id1", "id2"],
    "removedAssetIds": []
  }
}
```

### `delta.json` (structured diff)

```json
{
  "version": "0.2.1",
  "type": "delta",
  "baseExportedAt": "...",
  "headExportedAt": "...",
  "baseAssetName": "robot.glb",
  "headAssetName": "robot.glb",
  "basePrimaryModelId": "ab12...",
  "headPrimaryModelId": "cd34...",
  "sceneChanged": false,
  "worldChanged": true,
  "primaryModelChanged": false,
  "assets": [
    { "id": "ab12...", "kind": "model", "path": "assets/model.glb",
      "status": "unchanged",
      "baseSha256": "e3b0...", "headSha256": "e3b0...", "baseSize": 1048576, "headSize": 1048576,
      "originalName": "robot.glb" },
    { "id": "cd34...", "kind": "texture", "path": "assets/textures/cd34.png",
      "status": "added", "headSha256": "f2c1...", "headSize": 65536, "originalName": "diffuse.png" }
  ]
}
```

### Apply algorithm

Given base `M_b` and delta `D`:

1. Read `D.manifest.assets` and `D.assets[]` (the structured diff).
2. For each base asset `a` with `id`:
   - If `a.id` is in `D.removedAssetIds` → omit from head.
   - Else if `a.id` in `D.assets[]` with `status: "unchanged"` → copy base bytes.
   - Else if `a.id` in `D.assets[]` with `status: "modified"` → use delta's `assets/<path>` entry.
3. For each delta asset `a` with `status: "added"` → add delta's `assets/<path>` entry to head.
4. Replace base's `scene.json` and `world.json` with delta's copies.
5. Result: a complete head state.

**Determinism:** the apply algorithm MUST produce identical bytes for the reconstructed head (modulo ZIP timestamps) regardless of implementation.

---

## 8. Asset Deduplication

Multiple assets with identical content SHOULD share the same `sha256`. Implementations MAY keep a content-addressed cache to avoid re-reading identical bytes.

**Path policy:** identical `kind + sha256` MAY share a `path` if the original filenames match. Otherwise each gets a unique path under `assets/<kind>/<id>.<ext>`.

---

## 9. Backward Compatibility Guarantees

- Readers MUST accept 0.1.x inputs and migrate on the fly.
- Writers SHOULD produce 0.2.x output.
- 0.2.0 readers MUST accept 0.2.1 (added `meta` in `assets[]` is forward-compat).
- Future 0.3.x will introduce optional new top-level fields; 0.2.x readers MUST ignore them.

---

## 10. Security Considerations

- **Path traversal:** implementations MUST reject any asset `path` that contains `..`, absolute paths, or backslashes.
- **Zip bomb:** implementations SHOULD cap total uncompressed size (default 4 GB) and entry count (default 10,000).
- **Hash verification:** when `sha256` is present, implementations MUST verify it on read and reject mismatches.
- **No executable content:** `.vreen` files do not contain code. The format is data-only.

---

## 11. Reference Implementations

- **TypeScript:** `src/lib/vreenPack.ts`, `src/lib/vreenValidate.ts`, `src/lib/vreenDiff.ts`
- **Java (Kotlin):** `packages/vreen-core/src/main/kotlin/io/vreen/core/`
- **C# (Unity):** `packages/unity-package/Runtime/VreenLoader.cs`
- **C++ (Unreal):** `packages/unreal-plugin/Source/VreenRuntime/Public/`

CLI tool (Node): `scripts/vreen-cli.mjs`

```
npm run vreen -- validate <file.vreen>
npm run vreen -- pack    <input.json> <out.vreen>
npm run vreen -- diff    <base.vreen> <head.vreen>
npm run vreen -- delta   <base.vreen> <head.vreen> <out.vreen-delta>
npm run vreen -- apply   <base.vreen> <delta.vreen-delta> <out.vreen>
npm run vreen -- sha256  <file>
```

---

## 12. Examples

A minimal valid `.vreen` (ZIP containing 2 JSON files + 1 model):

```bash
# 1. Create workdir
mkdir work && cd work
mkdir -p assets

# 2. Write manifest
cat > manifest.json <<EOF
{ "version": "0.2.1", "exportedAt": "2026-07-11T00:00:00.000Z",
  "name": "demo", "assetName": "demo.glb",
  "generator": "manual",
  "primaryModelId": "ab12", "assets": [
    { "id": "ab12", "kind": "model", "path": "assets/demo.glb", "size": 0 }
  ] }
EOF

# 3. Write scene
cat > scene.json <<EOF
{ "version": "0.2.1", "camera": {}, "animation": {"speed":1},
  "environment": {"preset":"studio","exposure":1,"background":"solid","backgroundColor":"#000000"},
  "postFX": {"bloom":false,"bloomIntensity":0,"chromaticAberration":false,"vignette":false,"ssao":false},
  "materials": {} }
EOF

# 4. Place model
cp /path/to/demo.glb assets/

# 5. Zip
zip -r ../demo.vreen manifest.json scene.json assets/demo.glb
```

Validate:
```bash
npm run vreen -- validate demo.vreen
# vreen validate — OK (...)
```

---

## 13. Future Work

- **v0.3.0:** Compressed JSON (`gzip` on JSON), per-asset encryption (AES-GCM with package key), `baker` for offline lightmap/atlas baking.
- **v0.4.0:** Streaming format — header + chunked payload for large worlds (>1 GB).

See [ROADMAP.md](./ROADMAP.md) for details.
