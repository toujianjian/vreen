# VREEN Unreal Plugin

C++17 .vreen package reader/writer/validator for Unreal Engine 5.x.

## Install

1. Copy `packages/unreal-plugin/` into your project's `Plugins/` directory.
2. In your `.uproject` file, add:
   ```json
   "Plugins": [
     { "Name": "VreenRuntime", "Enabled": true }
   ]
   ```
3. Regenerate project files (right-click `.uproject` → *Generate Visual Studio project files*).
4. Build.

## Usage

```cpp
#include "VreenLoader.h"

// Pack a scene
FVreenPackInput Input;
Input.Name = TEXT("MyScene");
Input.AssetName = TEXT("robot.glb");
Input.Assets.Add({ FString(), EVreenAssetKind::Model, GlbBytes, TEXT("robot.glb") });
FVreenPackResult Packed = FVreenLoader::Pack(Input);

// Save to disk
FFileHelper::SaveArrayToFile(Packed.Bytes, *FPaths::ProjectDir() / TEXT("out.vreen"));

// Load and validate
TArray<uint8> Bytes;
FFileHelper::LoadFileToArray(Bytes, *FPaths::ProjectDir() / TEXT("scene.vreen"));
FVreenUnpacked Unpacked = FVreenLoader::Unpack(Bytes);
FVreenValidationReport Report = FVreenLoader::Validate(Unpacked);
UE_LOG(LogTemp, Log, TEXT("VREEN: ok=%d, models=%d, issues=%d"),
    Report.bOk, Report.ModelCount, Report.Issues.Num());

// Hand bytes to your GLTF/GLB loader (e.g. GLTFRuntime, RuntimeMeshLoader, or
// import via the editor's Interchange framework)
const FVreenAssetEntry* Primary = Unpacked.Manifest.Assets.FindByPredicate(
    [&](const FVreenAssetEntry& A) { return A.Id == Unpacked.Manifest.PrimaryModelId; });
if (Primary && Unpacked.Assets.Contains(Primary->Id))
{
    const TArray<uint8>& Glb = Unpacked.Assets[Primary->Id];
    // GlbLoader->LoadFromBytes(Glb);
}
```

## API

| Class | Purpose |
|---|---|
| `FVreenLoader` | `Pack` / `Unpack` / `Validate` / `Sha256Hex` |
| `FVreenModel` | Data structs (USTRUCT) |
| `FVreenZip` | Minimal ZIP writer/reader (stored mode) |
| `FVreenJson` | JSON encode/decode (UE5 `FJsonObjectConverter` based) |

## Known Limitations

- ZIP output uses **stored** (no compression) for simplicity. Switch to
  DEFLATE if archive size matters; see comments in `VreenZip.cpp`.
- Scene `materials` map is encoded as flat string-string pairs. For full
  nested map fidelity, swap in a richer encoder.

## License

MIT
