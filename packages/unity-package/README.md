# VREEN Unity Package

Pure-C# .vreen package reader/writer/validator for Unity 2021.3+ (also runs on .NET 6+).

## Install

Add the package via UPM (manifest.json in `Packages/manifest.json`):

```json
{
  "dependencies": {
    "io.vreen.unity": "file:../path/to/vreen/packages/unity-package"
  }
}
```

Or via git URL:

```json
{
  "dependencies": {
    "io.vreen.unity": "https://github.com/vreen/vreen.git?path=packages/unity-package#0.2.1"
  }
}
```

## Usage

### Editor — open a package

`VREEN → Open Package…` menu item. Pick a `.vreen` file to see manifest, assets, and validation report.

### Editor — export the active scene

`VREEN → Export Active Scene to .vreen…` menu item. The exporter walks the active scene's root GameObjects, captures meshes (as `vmesh` JSON per §14.2 of the format spec), textures (PNG via `ImageConversion.EncodeToPNG`), PBR materials, audio, and the ECS world, and writes a `.vreen` next to the `.unity` file (or to a user-chosen path). Use `VREEN → Open Export Window` for fine-grained options.

The exporter API is also callable from build pipelines / batch scripts:

```csharp
using Vreen.EditorTools;

var report = VreenExporter.ExportActiveScene(new VreenExporter.Options
{
    name = "MyScene",
    assetName = "robot",
    includeWorld = true,
    useSceneDirectory = false, // require explicit path via SaveFilePanel
});
if (!report.ok) Debug.LogError(report.error);
```

### Runtime — load and instantiate the primary model

```csharp
using Vreen;
using UnityEngine;

public class VreenLoaderDemo : MonoBehaviour
{
    public TextAsset vreenFile; // or any byte[] source

    void Start()
    {
        var bytes = vreenFile.bytes;
        var pkg = VreenLoader.Unpack(bytes);
        var report = VreenLoader.Validate(pkg);
        if (!report.ok) { Debug.LogError("invalid .vreen"); return; }

        var primary = System.Array.Find(pkg.manifest.assets, a => a.id == pkg.manifest.primaryModelId);
        if (primary == null) return;
        var data = pkg.assets[primary.id];
        // hand the GLB bytes to your favorite GLB loader (e.g. GLTFast, UnityGLTF)
        // GLBLoader.LoadFromBytes(data, (go) => go.transform.SetParent(transform));
    }
}
```

### Runtime — pack a scene

```csharp
var scene = new VreenScene(); // defaults to studio / midnight
var manifest = VreenLoader.Pack(new VreenLoader.PackInput
{
    name = "MyScene",
    assetName = "robot.glb",
    scene = scene,
    assets = new System.Collections.Generic.List<VreenLoader.AssetInput>
    {
        new() { kind = AssetKind.Model, data = glbBytes, originalName = "robot.glb" },
        new() { kind = AssetKind.Texture, data = texBytes, originalName = "diffuse.png" },
    },
});
System.IO.File.WriteAllBytes("out.vreen", manifest.bytes);
```

## API summary

| Class | Purpose |
|---|---|
| `VreenLoader` | `Pack`, `Unpack`, `Validate`, `Sha256Hex` |
| `VreenModel` | Data classes (`VreenManifest`, `VreenScene`, `VreenWorldJson`, `VreenAssetEntry`, etc.) |
| `VreenJson` | JSON encode/decode helpers (Newtonsoft-free) |
| `VreenVmesh` | VREEN mesh (vmesh) JSON encoder for the §14.2 model format |
| `VreenEditorWindow` | Unity Editor inspector window (open + validate .vreen) |
| `VreenExporter` | Editor-only scene walker that produces a .vreen |
| `VreenExporterWindow` | Editor window with export options and a "Export" button |

## Dependencies

**None** for runtime. Editor requires `UnityEditor` (built into the Editor).

## License

MIT
