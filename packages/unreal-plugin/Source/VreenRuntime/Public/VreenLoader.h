// VreenLoader.h — pack / unpack / validate the .vreen format on UE5.
//
// Public API:
//   FVreenLoader::Pack(input) → FVreenPackResult
//   FVreenLoader::Unpack(bytes) → FVreenUnpacked
//   FVreenLoader::Validate(unpacked) → FVreenValidationReport
//
// Zipping uses the platform-agnostic IPlatformFile path (no zlib dependency).
// For UE 5.x this is FFileHelper / FArchive; for raw byte arrays we
// implement a minimal inflate/deflate in VreenZip.h.

#pragma once

#include "CoreMinimal.h"
#include "VreenModel.h"

USTRUCT()
struct FVreenAssetInput
{
    GENERATED_BODY()

    UPROPERTY() FString Id;
    UPROPERTY() EVreenAssetKind Kind = EVreenAssetKind::Model;
    UPROPERTY() TArray<uint8> Data;
    UPROPERTY() FString OriginalName;
    UPROPERTY() FString Sha256;
};

USTRUCT()
struct FVreenPackInput
{
    GENERATED_BODY()

    UPROPERTY() FString Name;
    UPROPERTY() FString AssetName;
    UPROPERTY() FVreenScene Scene;
    UPROPERTY() TArray<FVreenAssetInput> Assets;
    UPROPERTY() FString PrimaryModelId;
    UPROPERTY() FVreenWorld World;
    UPROPERTY() FString Generator = TEXT("vreen-unreal 0.2.1");
};

USTRUCT()
struct FVreenPackResult
{
    GENERATED_BODY()

    UPROPERTY() TArray<uint8> Bytes;
    UPROPERTY() FVreenManifest Manifest;
    UPROPERTY() TMap<FString, int32> Entries;
};

USTRUCT()
struct FVreenValidationIssue
{
    GENERATED_BODY()

    UPROPERTY() FString Level; // error / warning / info
    UPROPERTY() FString Code;
    UPROPERTY() FString Message;
    UPROPERTY() FString Path;
};

USTRUCT()
struct FVreenValidationReport
{
    GENERATED_BODY()

    UPROPERTY() bool bOk = false;
    UPROPERTY() TArray<FVreenValidationIssue> Issues;
    UPROPERTY() int32 AssetCount = 0;
    UPROPERTY() int64 TotalAssetBytes = 0;
    UPROPERTY() int32 ModelCount = 0;
    UPROPERTY() int32 TextureCount = 0;
    UPROPERTY() int32 HdriCount = 0;
    UPROPERTY() int32 AudioCount = 0;
    UPROPERTY() int32 EntityCount = 0;
    UPROPERTY() int64 DurationMs = 0;
};

class VREENRUNTIME_API FVreenLoader
{
public:
    static FVreenPackResult Pack(const FVreenPackInput& Input);
    static FVreenUnpacked Unpack(const TArray<uint8>& Source);
    static FVreenValidationReport Validate(const FVreenUnpacked& Pkg);

    static FString Sha256Hex(const TArray<uint8>& Data);
    static FString GenerateId();
    static FString UniqueAssetPath(EVreenAssetKind Kind, const FString& OriginalName, const FString& Id);
};
