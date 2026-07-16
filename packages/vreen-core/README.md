# vreen-core

Language-neutral core for the `.vreen` package format (Java / Kotlin).

Used by build-time tools (Maven / Gradle plugins, CI scripts) that need to
read, write, validate, diff, and apply `.vreen` packages without pulling in
the TypeScript / Web stack.

See the authoritative spec: [`docs/format/vreen-format-spec.md`](../../docs/format/vreen-format-spec.md).

---

## Install (Gradle / Maven)

```kotlin
// build.gradle.kts
implementation("io.vreen:vreen-core:0.2.1")
```

```xml
<!-- pom.xml -->
<dependency>
  <groupId>io.vreen</groupId>
  <artifactId>vreen-core</artifactId>
  <version>0.2.1</version>
</dependency>
```

Requires **JDK 17+** and the **kotlin-stdlib** at runtime (transitively
included).

---

## Build

```bash
# from packages/vreen-core
mvn test       # compile + run 28 unit tests
mvn package    # build jar into target/
```

Or use the bundled wrapper:

```bash
./mvnw test
```

The wrapper auto-downloads Maven 3.9.16 on first run.

---

## API at a glance

| Object / function | What it does |
|---|---|
| `Vreen.pack(input)` | Pack a `PackInput` into a `.vreen` ZIP |
| `Vreen.unpack(bytes)` | Unpack a `.vreen` (0.1.x or 0.2.x) into typed POJOs |
| `Vreen.validate(unpacked)` | Schema + sha256 + size validation, returns a `ValidationReport` |
| `VreenDiff.diff(base, head)` | List asset / scene / world differences |
| `VreenDelta.create(base, head, diff)` | Build a `.vreen-delta` ZIP |
| `VreenDelta.applyThenPack(base, deltaBytes)` | Apply a delta and re-pack as a full `.vreen` |
| `VreenRegistry.loadRegistry(url)` | Fetch / parse a registry index |
| `VreenRegistry.resolveVersion(pkg, range)` | Semver range resolution (`^`, `~`, `>=`, exact) |
| `Vmesh.quad(name, size)` | Build a procedural `vmesh` document (1 quad, 2 tris) |
| `Vmesh.toJsonBytes(doc)` / `fromJsonBytes(bytes)` | Serialize / parse vmesh JSON |
| `Hashing.sha256Hex(bytes)` | SHA-256 (hex, lowercase) |
| `Hashing.hmacSha256Hex(key, data)` | HMAC-SHA256 (for future manifest signing) |
| `AssetPaths.uniquePath(kind, name, id)` | Build a collision-free asset path |

### Pack example

```kotlin
val pack = Vreen.pack(Vreen.PackInput(
    name = "demo",
    assetName = "robot.glb",
    scene = VreenScene(),
    assets = listOf(
        Vreen.AssetInput(
            id = "model-robot",
            kind = AssetKind.MODEL,
            data = Files.readAllBytes(Path.of("robot.glb")),
            originalName = "robot.glb",
        ),
    ),
))
Files.write(Path.of("demo.vreen"), pack.bytes)
```

### Validate

```kotlin
val pkg = Vreen.unpack(pack.bytes)
val report = Vreen.validate(pkg)
if (!report.ok) {
    report.issues.forEach { issue ->
        println("[${issue.level}] ${issue.code} ${issue.message}")
    }
}
```

### Diff + delta

```kotlin
val base = Vreen.unpack(baseBytes)
val head = Vreen.unpack(headBytes)
val diff = VreenDiff.diff(base, head)
println("savings: ${(diff.savingsRatio * 100).toFixed(1)}%")
val delta = VreenDelta.create(base, head, diff)
Files.write(Path.of("head.vreen-delta"), delta.bytes)
```

### Registry

```kotlin
val reg = VreenRegistry.loadRegistry("https://registry.vreen.dev/index.json")
val pkg = VreenRegistry.findPackage(reg, "robot.glb")
    ?: error("not found")
val v = VreenRegistry.resolveVersion(pkg, "^1.0.0")
    ?: error("no version matches")
val url = VreenRegistry.resolveDownloadUrl(v, reg.baseUrl)
```

### vmesh (alternative to GLB)

```kotlin
val doc = Vmesh.quad("plane", size = 1.0f, materialId = "mat-default")
val bytes = Vmesh.toJsonBytes(doc)
val pack = Vreen.pack(Vreen.PackInput(
    name = "vmesh-demo",
    assetName = "plane.vmesh",
    assets = listOf(Vreen.AssetInput(
        kind = AssetKind.MODEL,
        data = bytes,
        originalName = "plane.vmesh",
        meta = Vmesh.assetMeta(),  // -> { "format": "vmesh" }
    )),
))
```

---

## Compatibility matrix

| Format version | Pack | Unpack | Diff | Delta | Registry |
|---|---|---|---|---|---|
| 0.1.x (legacy JSON / zip) | — | ✅ migrates to 0.2.x | n/a | n/a | n/a |
| 0.2.0 | ✅ | ✅ | ✅ | ✅ | n/a |
| 0.2.1 (current) | ✅ | ✅ | ✅ | ✅ | ✅ |

Deltas produced by the TypeScript SDK (`src/lib/vreenDiff.ts`) are byte-compatible
with this implementation.

---

## License

Apache-2.0
