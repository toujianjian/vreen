// VreenLoader.cpp

#include "VreenLoader.h"
#include "VreenZip.h"
#include "VreenJson.h"
#include "Misc/SecureHash.h"
#include "Misc/DateTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/PlatformFileManager.h"

EVreenAssetKind FVreenAssetEntry::GetKind() const
{
    if (Kind.Equals(TEXT("Model"), ESearchCase::IgnoreCase)) return EVreenAssetKind::Model;
    if (Kind.Equals(TEXT("Texture"), ESearchCase::IgnoreCase)) return EVreenAssetKind::Texture;
    if (Kind.Equals(TEXT("Hdri"), ESearchCase::IgnoreCase)) return EVreenAssetKind::Hdri;
    if (Kind.Equals(TEXT("Audio"), ESearchCase::IgnoreCase)) return EVreenAssetKind::Audio;
    return EVreenAssetKind::Model;
}

FString FVreenLoader::GenerateId()
{
    TArray<uint8> Bytes;
    Bytes.SetNumZeroed(16);
    for (int i = 0; i < 16; ++i) Bytes[i] = FMath::Rand() & 0xFF;
    FString Out;
    for (uint8 B : Bytes) Out += FString::Printf(TEXT("%02x"), B);
    return Out;
}

FString FVreenLoader::Sha256Hex(const TArray<uint8>& Data)
{
    FSHA256Signature Sig;
    FSHA256::HashBuffer(Data.GetData(), Data.Num(), Sig.Signature);
    FString Out;
    for (int i = 0; i < 32; ++i) Out += FString::Printf(TEXT("%02x"), Sig.Signature[i]);
    return Out;
}

FString FVreenLoader::UniqueAssetPath(EVreenAssetKind Kind, const FString& OriginalName, const FString& Id)
{
    FString Safe = OriginalName.IsEmpty() ? TEXT("asset") : OriginalName;
    FString BaseName, Ext;
    int32 DotIdx;
    if (Safe.FindLastChar('.', DotIdx) && DotIdx < Safe.Len() - 1)
    {
        BaseName = Safe.Left(DotIdx);
        Ext = Safe.Mid(DotIdx);
    }
    else
    {
        BaseName = Safe;
    }
    if (BaseName.Len() > 40) BaseName = BaseName.Left(40);
    FString Tagged = BaseName + TEXT("-") + Id + Ext;

    switch (Kind)
    {
        case EVreenAssetKind::Model:  return FString::Printf(TEXT("assets/%s"), *Tagged);
        case EVreenAssetKind::Texture: return FString::Printf(TEXT("assets/textures/%s"), *Tagged);
        case EVreenAssetKind::Hdri:    return FString::Printf(TEXT("assets/hdri/%s"), *Tagged);
        case EVreenAssetKind::Audio:   return FString::Printf(TEXT("assets/audio/%s"), *Tagged);
    }
    return TEXT("assets/") + Tagged;
}

FVreenPackResult FVreenLoader::Pack(const FVreenPackInput& Input)
{
    FVreenPackResult Out;
    TMap<FString, TArray<uint8>> Entries;
    TArray<FVreenAssetEntry> AssetEntries;
    FString PrimaryModelId = Input.PrimaryModelId;

    for (const FVreenAssetInput& A : Input.Assets)
    {
        FString Id = A.Id.IsEmpty() ? GenerateId() : A.Id;
        FString Path = UniqueAssetPath(A.Kind, A.OriginalName, Id);
        Entries.Add(Path, A.Data);
        FString Hash = A.Sha256.IsEmpty() ? Sha256Hex(A.Data) : A.Sha256;

        FVreenAssetEntry E;
        E.Id = Id;
        E.Kind = StaticEnum<EVreenAssetKind>()->GetNameStringByValue((int64)A.Kind);
        E.Path = Path;
        E.Size = A.Data.Num();
        E.Sha256 = Hash;
        E.OriginalName = A.OriginalName;
        AssetEntries.Add(E);

        if (A.Kind == EVreenAssetKind::Model && PrimaryModelId.IsEmpty()) PrimaryModelId = Id;
    }

    FVreenManifest M;
    M.Version = TEXT("0.2.1");
    M.ExportedAt = FDateTime::UtcNow().ToIso8601();
    M.Name = Input.Name;
    M.AssetName = Input.AssetName;
    M.Generator = Input.Generator;
    M.Assets = AssetEntries;
    M.PrimaryModelId = PrimaryModelId;
    M.World = Input.World;

    Entries.Add(TEXT("manifest.json"), FVreenJson::EncodeManifest(M));
    Entries.Add(TEXT("scene.json"), FVreenJson::EncodeScene(Input.Scene));

    Out.Bytes = FVreenZip::Zip(Entries);
    Out.Manifest = M;
    for (const auto& kv : Entries) Out.Entries.Add(kv.Key, kv.Value.Num());
    return Out;
}

FVreenUnpacked FVreenLoader::Unpack(const TArray<uint8>& Source)
{
    if (Source.Num() >= 4 &&
        Source[0] == 0x50 && Source[1] == 0x4B && Source[2] == 0x03 && Source[3] == 0x04)
    {
        return UnpackZip(Source);
    }
    return UnpackLegacyJson(Source);
}

FVreenUnpacked FVreenLoader::UnpackZip(const TArray<uint8>& Bytes)
{
    TMap<FString, TArray<uint8>> Entries = FVreenZip::Unzip(Bytes);
    if (Entries.Contains(TEXT("manifest.json")) && Entries.Contains(TEXT("scene.json")))
    {
        FVreenUnpacked R;
        R.Manifest = FVreenJson::DecodeManifest(Entries[TEXT("manifest.json")]);
        R.Scene = FVreenJson::DecodeScene(Entries[TEXT("scene.json")]);
        for (const FVreenAssetEntry& A : R.Manifest.Assets)
        {
            if (const TArray<uint8>* Data = Entries.Find(A.Path))
                R.Assets.Add(A.Id, *Data);
        }
        R.World = R.Manifest.World;
        return R;
    }
    if (Entries.Contains(TEXT("project.json")))
    {
        return UnpackLegacyJson(Entries[TEXT("project.json")]);
    }
    // error
    UE_LOG(LogTemp, Error, TEXT("VREEN: zip missing manifest.json / scene.json / project.json"));
    return FVreenUnpacked();
}

FVreenUnpacked FVreenLoader::UnpackLegacyJson(const TArray<uint8>& Bytes)
{
    FString Text;
    FFileHelper::BufferToString(Text, Bytes.GetData(), Bytes.Num());
    if (Text.Len() > 0 && Text[0] == 0xFEFF) Text = Text.RightChop(1);

    // Quick version check
    if (!Text.Contains(TEXT("\"0.1.0\"")))
    {
        UE_LOG(LogTemp, Error, TEXT("VREEN: legacy .vreen version mismatch (expected 0.1.0)"));
        return FVreenUnpacked();
    }

    FVreenUnpacked R;
    R.Manifest.Version = TEXT("0.2.1");
    R.Manifest.AssetName = TEXT("legacy");
    R.Manifest.Name = TEXT("legacy");
    R.Manifest.Generator = TEXT("VREEN Legacy Upgrader");
    // Scene content remains in raw form; populate Camera/Animation from JSON parse.
    R.Scene = FVreenJson::DecodeScene(*Text);
    return R;
}

FVreenValidationReport FVreenLoader::Validate(const FVreenUnpacked& Pkg)
{
    const double T0 = FPlatformTime::Seconds();
    FVreenValidationReport R;

    for (const FVreenAssetEntry& A : Pkg.Manifest.Assets)
    {
        const TArray<uint8>* Data = Pkg.Assets.Find(A.Id);
        if (!Data)
        {
            FVreenValidationIssue I;
            I.Level = TEXT("error");
            I.Code = TEXT("ASSET_MISSING");
            I.Message = FString::Printf(TEXT("asset %s bytes missing"), *A.Id);
            I.Path = A.Path;
            R.Issues.Add(I);
            continue;
        }
        if ((int64)Data->Num() != A.Size)
        {
            FVreenValidationIssue I;
            I.Level = TEXT("error");
            I.Code = TEXT("ASSET_SIZE_MISMATCH");
            I.Message = FString::Printf(TEXT("asset %s expected %lld bytes, got %d"), *A.Id, A.Size, Data->Num());
            I.Path = A.Path;
            R.Issues.Add(I);
        }
        if (!A.Sha256.IsEmpty())
        {
            if (A.Sha256.Len() != 64)
            {
                FVreenValidationIssue I;
                I.Level = TEXT("warning");
                I.Code = TEXT("SHA256_BAD_FORMAT");
                I.Message = FString::Printf(TEXT("asset %s sha256 not 64 chars"), *A.Id);
                I.Path = A.Path;
                R.Issues.Add(I);
            }
            else
            {
                FString Actual = Sha256Hex(*Data);
                if (Actual != A.Sha256)
                {
                    FVreenValidationIssue I;
                    I.Level = TEXT("error");
                    I.Code = TEXT("SHA256_MISMATCH");
                    I.Message = FString::Printf(TEXT("asset %s sha256 mismatch (expected %s, got %s)"), *A.Id, *A.Sha256, *Actual);
                    I.Path = A.Path;
                    R.Issues.Add(I);
                }
            }
        }
    }

    R.AssetCount = Pkg.Manifest.Assets.Num();
    R.ModelCount = Pkg.Manifest.Assets.FilterByPredicate([](const FVreenAssetEntry& A) { return A.GetKind() == EVreenAssetKind::Model; }).Num();
    R.TextureCount = Pkg.Manifest.Assets.FilterByPredicate([](const FVreenAssetEntry& A) { return A.GetKind() == EVreenAssetKind::Texture; }).Num();
    R.HdriCount = Pkg.Manifest.Assets.FilterByPredicate([](const FVreenAssetEntry& A) { return A.GetKind() == EVreenAssetKind::Hdri; }).Num();
    R.AudioCount = Pkg.Manifest.Assets.FilterByPredicate([](const FVreenAssetEntry& A) { return A.GetKind() == EVreenAssetKind::Audio; }).Num();
    R.EntityCount = Pkg.World.Entities.Num();
    R.TotalAssetBytes = 0;
    for (const FVreenAssetEntry& A : Pkg.Manifest.Assets) R.TotalAssetBytes += A.Size;

    R.bOk = !R.Issues.ContainsByPredicate([](const FVreenValidationIssue& I) { return I.Level == TEXT("error"); });
    R.DurationMs = (int64)((FPlatformTime::Seconds() - T0) * 1000);
    return R;
}
