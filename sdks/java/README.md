# vreen-pack (Java SDK)

Java 17+ read / write SDK for the **`.vreen`** package format. Mirror of the
TypeScript `src/lib/vreenPack.ts` in the [vreen web app](../..).

## Why

`.vreen` is the container the vreen web app exports projects into. Java tooling
(asset pipelines, build plugins, server-side validation, headless ECS replay)
needs the same read / write guarantees so it can:

- inspect a `.vreen` produced by the browser without round-tripping through JS,
- emit a `.vreen` from a build script (e.g. packed into a Minecraft mod resource),
- diff two packages byte-for-byte or field-for-field.

The schema is the source of truth — this SDK is a strict twin. When the TS
side changes (`src/lib/vreenManifest.ts`), this SDK must be updated to match.

## Layout

```
.vreen = zip
  manifest.json         — VreenManifest (version, assets[], primaryModelId, world?)
  scene.json            — VreenScene (camera, animation, env, postFX, materials)
  state.json            — OPTIONAL, 0.1.x legacy alias for the old project.json
  assets/...            — main model + textures + hdri + audio
```

Current version: **`0.2.1`**. Legacy `0.1.x` packages are read transparently
and promoted to the new shape on the way out.

## Maven coordinates

```xml
<dependency>
    <groupId>io.vreen</groupId>
    <artifactId>vreen-pack</artifactId>
    <version>0.1.0</version>
</dependency>
```

(Not yet published to Maven Central — `mvn deploy` from a local repo until the
first release cut.)

## Gradle

```gradle
implementation("io.vreen:vreen-pack:0.1.0")
```

## API

### Read

```java
VreenPackage.ReadResult r = VreenPackage.read(Path.of("avatar.vreen"));
VreenManifest manifest = r.manifest;
VreenScene    scene    = r.scene;
byte[]        glb      = r.assets.get(manifest.primaryModelId);
```

`ReadResult.legacy == true` means the package was a 0.1.x shape that was lifted
into the new format.

### Write

```java
VreenAssetEntry model = VreenAssetEntry.builder()
        .id("model-1")
        .kind(VreenAssetEntry.AssetKind.MODEL)
        .path("assets/avatar.glb")
        .size(glbBytes.length)
        .sha256(VreenPackage.sha256Hex(glbBytes))
        .build();
VreenManifest manifest = VreenManifest.builder()
        .name("avatar-pack")
        .assetName("avatar")
        .addAsset(model)
        .primaryModelId("model-1")
        .build();
VreenScene scene = VreenScene.builder()
        .camera(/* ObjectNode */)
        .environment(/* ObjectNode */)
        .postFX(/* ObjectNode */)
        .materials(/* ObjectNode */)
        .build();
Map<String, byte[]> assets = Map.of("model-1", glbBytes);
VreenPackage.write(Path.of("avatar.vreen"), manifest, scene, assets);
```

Free-form sections (camera, environment, postFX, materials, components) are
exposed as `com.fasterxml.jackson.databind.JsonNode` so Java callers can edit
them as raw JSON without forcing a strict POJO mapping.

### Helpers

- `VreenPackage.sha256Hex(byte[])` — lowercase hex sha256 of an asset.
- `VreenAssetEntry.AssetKind` constants: `MODEL`, `TEXTURE`, `HDRI`, `AUDIO`.
- `VreenFormatVersion.CURRENT` / `WORLD` / `LEGACY` — version constants.

## Build

```sh
# Gradle
gradle build           # compile + test + jar
gradle test            # just tests

# Maven
mvn package            # compile + test + jar
mvn test               # just tests
```

Java toolchain 17 (Gradle) or `maven.compiler.source = 17` (Maven).

## Test

`VreenPackageRoundTripTest` covers:
1. round-trip a populated package (manifest + scene + one model),
2. round-trip an empty package (no assets),
3. error path: write a manifest that references a missing asset.

## Examples

`io.vreen.examples.RoundTripExample` is a standalone `main()` that writes a
synthetic `.vreen` and reads it back. Run with:

```sh
java -cp '<jackson-jars>:<classes>' io.vreen.examples.RoundTripExample demo.vreen
```

## Schema parity

| TS (`src/lib/vreenManifest.ts`) | Java (`io.vreen.pack.*`)                |
| ------------------------------- | --------------------------------------- |
| `VREEN_FORMAT_VERSION`          | `VreenFormatVersion.CURRENT`            |
| `VREEN_FORMAT_VERSION_LEGACY`   | `VreenFormatVersion.LEGACY`             |
| `VREEN_ASSET_DIRS`              | `VreenAssetEntry.dirFor(kind)`          |
| `VreenAssetEntry`               | `VreenAssetEntry` + `Builder`           |
| `VreenScene`                    | `VreenScene` + `Builder`                |
| `VreenWorldJson`                | `VreenWorldJson`                        |
| `VreenEntityJson`               | `VreenEntityJson`                       |
| `VreenManifest`                 | `VreenManifest` + `Builder`             |
| `VreenFormatError`              | `VreenPackageException`                 |
| `packVreenPackage` / `unpackVreenPackage` | `VreenPackage.write` / `VreenPackage.read` |
