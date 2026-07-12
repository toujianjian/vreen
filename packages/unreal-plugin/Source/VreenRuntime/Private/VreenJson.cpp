// VreenJson.cpp

#include "VreenJson.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace
{
    TSharedRef<FJsonObject> AssetEntryToJson(const FVreenAssetEntry& A)
    {
        auto O = MakeShared<FJsonObject>();
        O->SetStringField(TEXT("id"), A.Id);
        O->SetStringField(TEXT("kind"), A.Kind);
        O->SetStringField(TEXT("path"), A.Path);
        O->SetNumberField(TEXT("size"), (double)A.Size);
        if (!A.Sha256.IsEmpty()) O->SetStringField(TEXT("sha256"), A.Sha256);
        if (!A.OriginalName.IsEmpty()) O->SetStringField(TEXT("originalName"), A.OriginalName);
        return O;
    }

    FVreenAssetEntry AssetEntryFromJson(const TSharedPtr<FJsonObject>& O)
    {
        FVreenAssetEntry A;
        A.Id = O->GetStringField(TEXT("id"));
        A.Kind = O->GetStringField(TEXT("kind"));
        A.Path = O->GetStringField(TEXT("path"));
        A.Size = (int64)O->GetNumberField(TEXT("size"));
        if (O->HasField(TEXT("sha256"))) A.Sha256 = O->GetStringField(TEXT("sha256"));
        if (O->HasField(TEXT("originalName"))) A.OriginalName = O->GetStringField(TEXT("originalName"));
        return A;
    }

    TSharedRef<FJsonObject> WorldToJson(const FVreenWorld& W)
    {
        auto O = MakeShared<FJsonObject>();
        O->SetStringField(TEXT("version"), W.Version);
        O->SetStringField(TEXT("name"), W.Name);
        O->SetNumberField(TEXT("frame"), (double)W.Frame);
        TArray<TSharedPtr<FJsonValue>> Entities;
        for (const FVreenEntity& E : W.Entities)
        {
            auto EObj = MakeShared<FJsonObject>();
            EObj->SetNumberField(TEXT("id"), (double)E.Id);
            EObj->SetStringField(TEXT("name"), E.Name);
            auto NObj = MakeShared<FJsonObject>();
            // simple array encoding
            TArray<TSharedPtr<FJsonValue>> Pos;
            for (float V : E.SceneNode.Position) Pos.Add(MakeShared<FJsonValueNumber>(V));
            TArray<TSharedPtr<FJsonValue>> Rot;
            for (float V : E.SceneNode.Rotation) Rot.Add(MakeShared<FJsonValueNumber>(V));
            TArray<TSharedPtr<FJsonValue>> Scl;
            for (float V : E.SceneNode.Scale) Scl.Add(MakeShared<FJsonValueNumber>(V));
            NObj->SetArrayField(TEXT("position"), Pos);
            NObj->SetArrayField(TEXT("rotation"), Rot);
            NObj->SetArrayField(TEXT("scale"), Scl);
            EObj->SetObjectField(TEXT("sceneNode"), NObj);

            TArray<TSharedPtr<FJsonValue>> Comps;
            for (const FVreenComponent& C : E.Components)
            {
                auto CObj = MakeShared<FJsonObject>();
                CObj->SetStringField(TEXT("type"), C.Type);
                // DataJson: best-effort parse; fallback to object
                TSharedPtr<FJsonObject> DObj = MakeShared<FJsonObject>();
                TSharedRef<TJsonReader<>> R = TJsonReaderFactory<>::Create(C.DataJson);
                if (!FJsonSerializer::Deserialize(R, DObj) || !DObj.IsValid()) DObj = MakeShared<FJsonObject>();
                CObj->SetObjectField(TEXT("data"), DObj);
                Comps.Add(MakeShared<FJsonValueObject>(CObj));
            }
            EObj->SetArrayField(TEXT("components"), Comps);
            Entities.Add(MakeShared<FJsonValueObject>(EObj));
        }
        O->SetArrayField(TEXT("entities"), Entities);
        return O;
    }
}

TArray<uint8> FVreenJson::EncodeManifest(const FVreenManifest& M)
{
    auto O = MakeShared<FJsonObject>();
    O->SetStringField(TEXT("version"), M.Version);
    O->SetStringField(TEXT("exportedAt"), M.ExportedAt);
    O->SetStringField(TEXT("name"), M.Name);
    O->SetStringField(TEXT("assetName"), M.AssetName);
    O->SetStringField(TEXT("generator"), M.Generator);
    O->SetStringField(TEXT("primaryModelId"), M.PrimaryModelId);
    TArray<TSharedPtr<FJsonValue>> Assets;
    for (const FVreenAssetEntry& A : M.Assets)
        Assets.Add(MakeShared<FJsonValueObject>(AssetEntryToJson(A)));
    O->SetArrayField(TEXT("assets"), Assets);
    if (M.World.Entities.Num() > 0)
        O->SetObjectField(TEXT("world"), WorldToJson(M.World));

    FString Out;
    auto W = TJsonWriterFactory<>::Create(&Out);
    FJsonSerializer::Serialize(O.ToSharedRef(), W);
    TArray<uint8> Bytes;
    Bytes.Append((uint8*)TCHAR_TO_UTF8(*Out), Out.Len());
    return Bytes;
}

TArray<uint8> FVreenJson::EncodeScene(const FVreenScene& S)
{
    auto O = MakeShared<FJsonObject>();
    O->SetStringField(TEXT("version"), S.Version);
    auto StrMapToJson = [](const TMap<FString, FString>& M) {
        auto Obj = MakeShared<FJsonObject>();
        for (const auto& kv : M) Obj->SetStringField(kv.Key, kv.Value);
        return Obj;
    };
    O->SetObjectField(TEXT("camera"), StrMapToJson(S.Camera));
    O->SetObjectField(TEXT("animation"), StrMapToJson(S.Animation));
    O->SetObjectField(TEXT("environment"), StrMapToJson(S.Environment));
    O->SetObjectField(TEXT("postFX"), StrMapToJson(S.PostFX));
    // Materials flattened (FString form) — for full nested maps, use Newtonsoft-style stringification upstream.
    O->SetObjectField(TEXT("materials"), StrMapToJson(S.Materials));

    FString Out;
    auto W = TJsonWriterFactory<>::Create(&Out);
    FJsonSerializer::Serialize(O.ToSharedRef(), W);
    TArray<uint8> Bytes;
    Bytes.Append((uint8*)TCHAR_TO_UTF8(*Out), Out.Len());
    return Bytes;
}

FVreenManifest FVreenJson::DecodeManifest(const TArray<uint8>& Bytes)
{
    FVreenManifest M;
    FString Text;
    FFileHelper::BufferToString(Text, Bytes.GetData(), Bytes.Num());
    TSharedPtr<FJsonObject> O;
    auto R = TJsonReaderFactory<>::Create(Text);
    if (!FJsonSerializer::Deserialize(R, O) || !O.IsValid()) return M;
    M.Version = O->GetStringField(TEXT("version"));
    M.ExportedAt = O->GetStringField(TEXT("exportedAt"));
    M.Name = O->GetStringField(TEXT("name"));
    M.AssetName = O->GetStringField(TEXT("assetName"));
    M.Generator = O->GetStringField(TEXT("generator"));
    if (O->HasField(TEXT("primaryModelId"))) M.PrimaryModelId = O->GetStringField(TEXT("primaryModelId"));
    const TArray<TSharedPtr<FJsonValue>>* AssetsArr = nullptr;
    if (O->TryGetArrayField(TEXT("assets"), AssetsArr))
    {
        for (const TSharedPtr<FJsonValue>& V : *AssetsArr)
        {
            M.Assets.Add(AssetEntryFromJson(V->AsObject()));
        }
    }
    return M;
}

FVreenScene FVreenJson::DecodeScene(const TArray<uint8>& Bytes)
{
    FVreenScene S;
    FString Text;
    FFileHelper::BufferToString(Text, Bytes.GetData(), Bytes.Num());
    TSharedPtr<FJsonObject> O;
    auto R = TJsonReaderFactory<>::Create(Text);
    if (!FJsonSerializer::Deserialize(R, O) || !O.IsValid()) return S;
    S.Version = O->GetStringField(TEXT("version"));

    auto ReadMap = [](const TSharedPtr<FJsonObject>* OPtr, TMap<FString, FString>& Out) {
        if (!OPtr || !OPtr->IsValid()) return;
        for (const auto& kv : (*OPtr)->Values)
            Out.Add(kv.Key, kv.Value->TryGetString());
    };
    const TSharedPtr<FJsonObject>* P;
    if (O->HasTypedField<EJson::Object>(TEXT("camera"))) { O->GetObjectField(TEXT("camera")).Values; }
    if (O->TryGetObjectField(TEXT("camera"), P)) ReadMap(P, S.Camera);
    if (O->TryGetObjectField(TEXT("animation"), P)) ReadMap(P, S.Animation);
    if (O->TryGetObjectField(TEXT("environment"), P)) ReadMap(P, S.Environment);
    if (O->TryGetObjectField(TEXT("postFX"), P)) ReadMap(P, S.PostFX);
    if (O->TryGetObjectField(TEXT("materials"), P)) ReadMap(P, S.Materials);
    return S;
}
