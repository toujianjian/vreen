// VreenModel.h — Plain C++ data model mirroring io.vreen.core.model (Kotlin).
// UE 5.x. Uses Unreal's TSharedPtr + TArray for collections.
// Compatible with the JSON utilities in VreenJson.h.

#pragma once

#include "CoreMinimal.h"
#include "VreenModel.generated.h"

UENUM()
enum class EVreenAssetKind : uint8
{
    Model,
    Texture,
    Hdri,
    Audio,
};

USTRUCT()
struct FVreenAssetEntry
{
    GENERATED_BODY()

    UPROPERTY() FString Id;
    UPROPERTY() FString Kind;        // matches EVreenAssetKind string
    UPROPERTY() FString Path;
    UPROPERTY() int64 Size = 0;
    UPROPERTY() FString Sha256;
    UPROPERTY() FString OriginalName;

    EVreenAssetKind GetKind() const;
};

USTRUCT()
struct FVreenSceneNode
{
    GENERATED_BODY()

    UPROPERTY() TArray<float> Position = { 0, 0, 0 };
    UPROPERTY() TArray<float> Rotation = { 0, 0, 0, 1 }; // quat [x,y,z,w]
    UPROPERTY() TArray<float> Scale = { 1, 1, 1 };
};

USTRUCT()
struct FVreenComponent
{
    GENERATED_BODY()

    UPROPERTY() FString Type;
    /** Free-form JSON object as raw string. UE doesn't allow generic TMap<String,object> as UPROPERTY. */
    UPROPERTY() FString DataJson;
};

USTRUCT()
struct FVreenEntity
{
    GENERATED_BODY()

    UPROPERTY() int64 Id = 0;
    UPROPERTY() FString Name;
    UPROPERTY() FVreenSceneNode SceneNode;
    UPROPERTY() TArray<FVreenComponent> Components;
};

USTRUCT()
struct FVreenWorld
{
    GENERATED_BODY()

    UPROPERTY() FString Version = TEXT("0.2.0");
    UPROPERTY() FString Name;
    UPROPERTY() int64 Frame = 0;
    UPROPERTY() TArray<FVreenEntity> Entities;
};

USTRUCT()
struct FVreenManifest
{
    GENERATED_BODY()

    UPROPERTY() FString Version = TEXT("0.2.1");
    UPROPERTY() FString ExportedAt;
    UPROPERTY() FString Name;
    UPROPERTY() FString AssetName;
    UPROPERTY() FString Generator;
    UPROPERTY() TArray<FVreenAssetEntry> Assets;
    UPROPERTY() FString PrimaryModelId;
    UPROPERTY() FVreenWorld World;
};

/** Scene sub-record (scene.json). */
USTRUCT()
struct FVreenScene
{
    GENERATED_BODY()

    UPROPERTY() FString Version = TEXT("0.2.1");
    UPROPERTY() TMap<FString, FString> Camera;
    UPROPERTY() TMap<FString, FString> Animation;
    UPROPERTY() TMap<FString, FString> Environment;
    UPROPERTY() TMap<FString, FString> PostFX;
    UPROPERTY() TMap<FString, FString> Materials;
};

USTRUCT()
struct FVreenUnpacked
{
    GENERATED_BODY()

    UPROPERTY() FVreenManifest Manifest;
    UPROPERTY() FVreenScene Scene;
    UPROPERTY() TMap<FString, TArray<uint8>> Assets; // id → bytes
    UPROPERTY() FVreenWorld World;
};
