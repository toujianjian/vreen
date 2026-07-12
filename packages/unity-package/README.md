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
| `VreenEditorWindow` | Unity Editor inspector window |

## Dependencies

**None** for runtime. Editor requires `UnityEditor` (built into the Editor).

## License

MIT
