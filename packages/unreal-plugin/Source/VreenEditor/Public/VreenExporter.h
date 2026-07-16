// VreenExporter.h — UE5 Editor-side exporter.
//
// Mirrors VreenExporter.cs in the Unity package. Walks the active editor
// world, gathers assets (StaticMeshes → vmesh JSON, Textures → PNG, materials
// → PBR params), and writes a .vreen package via FVreenLoader::Pack.
//
// Usage (Blueprint / Python / C++):
//   FVreenExporter::ExportActiveLevel(
//       TEXT("/Game/Exports/MyLevel"),
//       FVreenExporter::FOptions{});
//
// Output path: <OutPath>.vreen (OutPath should NOT include the extension).

#pragma once

#include "CoreMinimal.h"
#include "VreenModel.h"
#include "VreenExporter.generated.h"

USTRUCT()
struct FVreenExporterOptions
{
    GENERATED_BODY()

    UPROPERTY() FString Name = TEXT("Unreal Level");
    UPROPERTY() FString AssetName;
    UPROPERTY() bool bIncludeWorld = true;
    UPROPERTY() bool bEmbedPbrMaterials = true;
    UPROPERTY() bool bOverwriteExisting = true;
};

USTRUCT()
struct FVreenExportReport
{
    GENERATED_BODY()

    UPROPERTY() bool bOk = false;
    UPROPERTY() FString OutputPath;
    UPROPERTY() FString Error;
    UPROPERTY() int32 MeshCount = 0;
    UPROPERTY() int32 MaterialCount = 0;
    UPROPERTY() int32 TextureCount = 0;
    UPROPERTY() int32 AudioCount = 0;
    UPROPERTY() int32 EntityCount = 0;
    UPROPERTY() int64 TotalBytes = 0;
};

class VREENEDITOR_API FVreenExporter
{
public:
    /** Walks the current editor world and writes <OutPath>.vreen. */
    static FVreenExportReport ExportActiveLevel(const FString& OutPath, const FVreenExporterOptions& Options);

    /** Resolve a default output path next to the .umap file. */
    static FString SuggestOutputPath();

    /** Walk a specific UWorld* (used for tests + headless commandlets). */
    static FVreenExportReport ExportWorld(UWorld* World, const FString& OutPath, const FVreenExporterOptions& Options);

private:
    static FString BuildVmeshForStaticMesh(UStaticMesh* Mesh, const FString& Name, const TArray<FString>& MaterialRefs);
    static void CaptureMaterialFromSlot(class UMaterialInterface* Mat, const FString& Id,
                                        TArray<FVreenAssetInput>& OutAssets,
                                        TMap<class UTexture2D*, FString>& TextureToId,
                                        int32& OutMaterialCount, int32& OutTextureCount);
    static bool EncodeTextureToPng(class UTexture2D* Tex, TArray<uint8>& OutPng);
    static FVreenScene CaptureSceneState(UWorld* World, const TMap<class UMaterialInterface*, FString>& MaterialToId);
    static FVreenWorld CaptureWorld(UWorld* World);
    static FString JsonEscape(const FString& In);
};
