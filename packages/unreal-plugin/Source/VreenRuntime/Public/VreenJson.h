// VreenJson.h — JSON encode/decode for the VREEN manifest/scene schema.
// Backed by UE5's FJsonObjectConverter + FJsonSerializer (no extra dep).
//
// Free-form fields (e.g. scene.camera as a TMap<String, Any?>) are encoded
// as raw JSON strings. For full nested map fidelity, use UE's TJsonReader.

#pragma once

#include "CoreMinimal.h"
#include "VreenModel.h"

class VREENRUNTIME_API FVreenJson
{
public:
    static TArray<uint8> EncodeManifest(const FVreenManifest& M);
    static TArray<uint8> EncodeScene(const FVreenScene& S);
    static FVreenManifest DecodeManifest(const TArray<uint8>& Bytes);
    static FVreenScene DecodeScene(const TArray<uint8>& Bytes);
};
