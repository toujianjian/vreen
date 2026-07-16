// VreenExporter.cpp — UE5 Editor-side exporter implementation.

#include "VreenExporter.h"

#include "VreenLoader.h"
#include "Engine/World.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/Texture2D.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstance.h"
#include "GameFramework/Actor.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformFileManager.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "UObject/SoftObjectPath.h"

// ── Public API ───────────────────────────────────────────────────

FVreenExportReport FVreenExporter::ExportActiveLevel(const FString& OutPath, const FVreenExporterOptions& Options)
{
    UWorld* World = nullptr;
    if (GEditor)
    {
        World = GEditor->GetEditorWorldContext().World();
    }
    if (!World)
    {
        FVreenExportReport R;
        R.Error = TEXT("no editor world");
        return R;
    }
    return ExportWorld(World, OutPath, Options);
}

FString FVreenExporter::SuggestOutputPath()
{
    if (!GEditor) return FString();
    UWorld* World = GEditor->GetEditorWorldContext().World();
    if (!World) return FString();
    const FString MapPath = World->GetOutermost()->GetName();
    const FString Dir = FPaths::GetPath(MapPath);
    const FString Stem = FPaths::GetBaseFilename(MapPath);
    return FPaths::Combine(Dir, Stem + TEXT(".vreen"));
}

FVreenExportReport FVreenExporter::ExportWorld(UWorld* World, const FString& OutPath, const FVreenExporterOptions& Options)
{
    FVreenExportReport R;
    if (!World)
    {
        R.Error = TEXT("null world");
        return R;
    }

    try
    {
        TArray<FVreenAssetInput> Assets;
        TMap<UMaterialInterface*, FString> MaterialToId;
        TMap<UTexture2D*, FString> TextureToId;
        int32 NextId = 0;
        auto IdStr = [&NextId](const TCHAR* Prefix)
        {
            return FString::Printf(TEXT("%s-%08x"), Prefix, ++NextId);
        };

        // Walk actors; for each StaticMeshActor emit a vmesh + materials.
        for (TActorIterator<AActor> It(World); It; ++It)
        {
            AActor* Actor = *It;
            if (!Actor) continue;

            // Audio
            for (UActorComponent* Comp : Actor->GetComponents())
            {
                if (!Comp) continue;
                // UAudioComponent: capture name (the actual .wav bytes are
                // not exposed via the public engine API, so we emit the
                // same vreen-audio-stub JSON approach as Unity).
                FString TypeName = Comp->GetClass()->GetName();
                if (TypeName.Contains(TEXT("Audio")))
                {
                    FString Stub = FString::Printf(
                        TEXT("{\"format\":\"vreen-audio-stub\",\"actor\":\"%s\",\"component\":\"%s\"}"),
                        *JsonEscape(Actor->GetName()),
                        *JsonEscape(Comp->GetName()));
                    FTCHARToUTF8 Conv(*Stub);
                    TArray<uint8> Bytes;
                    Bytes.Append(reinterpret_cast<const uint8*>(Conv.Get()), Conv.Length());
                    Assets.Add({ IdStr(TEXT("audio")), EVreenAssetKind::Audio, Bytes, Comp->GetName() + TEXT(".audio-stub.json") });
                    R.AudioCount++;
                }
            }

            TArray<UStaticMeshComponent*> MeshComps;
            Actor->GetComponents<UStaticMeshComponent>(MeshComps);
            for (UStaticMeshComponent* SMC : MeshComps)
            {
                if (!SMC || !SMC->GetStaticMesh()) continue;
                TArray<FString> MatRefs;
                const int32 NumSlots = SMC->GetNumMaterials();
                for (int32 i = 0; i < NumSlots; i++)
                {
                    UMaterialInterface* Mat = SMC->GetMaterial(i);
                    if (!Mat) { MatRefs.Add(FString()); continue; }
                    if (!MaterialToId.Contains(Mat))
                    {
                        FString Id = IdStr(TEXT("mat"));
                        MaterialToId.Add(Mat, Id);
                        CaptureMaterialFromSlot(Mat, Id, Assets, TextureToId, R.MaterialCount, R.TextureCount);
                    }
                    MatRefs.Add(MaterialToId[Mat]);
                }
                FString Vmesh = BuildVmeshForStaticMesh(SMC->GetStaticMesh(), Actor->GetName(), MatRefs);
                FTCHARToUTF8 Conv(*Vmesh);
                TArray<uint8> Bytes;
                Bytes.Append(reinterpret_cast<const uint8*>(Conv.Get()), Conv.Length());
                Assets.Add({ IdStr(TEXT("model")), EVreenAssetKind::Model, Bytes, Actor->GetName() + TEXT(".vmesh") });
                R.MeshCount++;
            }
        }

        // Scene state
        FVreenScene Scene = CaptureSceneState(World, MaterialToId);

        // World (optional)
        FVreenWorld WorldState;
        if (Options.bIncludeWorld)
        {
            WorldState = CaptureWorld(World);
        }

        FVreenPackInput Input;
        Input.Name = Options.Name;
        Input.AssetName = Options.AssetName.IsEmpty() ? FPaths::GetBaseFilename(World->GetOutermost()->GetName()) : Options.AssetName;
        Input.Scene = Scene;
        Input.Assets = Assets;
        Input.World = WorldState;
        Input.Generator = FString::Printf(TEXT("unreal %d.%d vreen-unreal 0.3.0"),
            ENGINE_MAJOR_VERSION, ENGINE_MINOR_VERSION);

        FVreenPackResult Packed = FVreenLoader::Pack(Input);
        const FString FinalPath = OutPath.EndsWith(TEXT(".vreen")) ? OutPath : (OutPath + TEXT(".vreen"));
        if (!FFileHelper::SaveArrayToFile(Packed.Bytes, *FinalPath))
        {
            R.Error = FString::Printf(TEXT("failed to write %s"), *FinalPath);
            return R;
        }

        R.bOk = true;
        R.OutputPath = FinalPath;
        R.EntityCount = WorldState.Entities.Num();
        R.TotalBytes = Packed.Bytes.Num();
        UE_LOG(LogTemp, Log, TEXT("[VREEN] Exported %s (%d meshes, %d materials, %d textures, %d audio, %d entities, %lld bytes)"),
            *FinalPath, R.MeshCount, R.MaterialCount, R.TextureCount, R.AudioCount, R.EntityCount, R.TotalBytes);
        return R;
    }
    catch (...)
    {
        R.Error = TEXT("uncaught exception during export");
        return R;
    }
}

// ── vmesh builder ────────────────────────────────────────────────

FString FVreenExporter::BuildVmeshForStaticMesh(UStaticMesh* Mesh, const FString& Name, const TArray<FString>& MaterialRefs)
{
    // Note: extracting raw vertex/index data from a UStaticMesh requires
    // the MeshDescription / RenderData accessors. We use the LOD0 RenderData
    // here for simplicity. Skeletal / multi-LOD meshes are out of scope.
    if (!Mesh) return FString();

    FString Out;
    TSharedRef<TJsonWriter<TCHAR>> Writer = TJsonWriterFactory<TCHAR>::Create(&Out);

    Writer->WriteObjectStart();
    Writer->WriteValue(TEXT("version"), TEXT("1.0.0"));
    Writer->WriteValue(TEXT("name"), Name);
    Writer->WriteArrayStart(TEXT("meshes"));

    int32 LODIndex = 0;
    if (FStaticMeshRenderData* RD = Mesh->GetRenderData())
    {
        if (RD->LODResources.IsValidIndex(LODIndex))
        {
            FStaticMeshLODResources& LOD = RD->LODResources[LODIndex];
            const FPositionVertexBuffer& Pos = LOD.VertexBuffers.PositionVertexBuffer;
            const FStaticMeshVertexBuffer& StaticBuf = LOD.VertexBuffers.StaticMeshVertexBuffer;
            const FRawStaticIndexBuffer& IndexBuf = LOD.IndexBuffer;

            const int32 NumVerts = Pos.GetNumVertices();
            const int32 NumSections = LOD.Sections.Num();
            for (int32 s = 0; s < NumSections; s++)
            {
                const FStaticMeshSection& Section = LOD.Sections[s];
                Writer->WriteObjectStart();
                Writer->WriteValue(TEXT("name"), FString::Printf(TEXT("%s_sub%d"), *Name, s));

                // Vertices
                Writer->WriteArrayStart(TEXT("vertices"));
                for (uint32 v = Section.MinVertexIndex; v < Section.MinVertexIndex + Section.NumVertices; v++)
                {
                    if ((int32)v >= NumVerts) break;
                    FVector P = Pos.VertexPosition(v);
                    Writer->WriteValue(P.X); Writer->WriteValue(P.Y); Writer->WriteValue(P.Z);
                }
                Writer->WriteArrayEnd();

                // Normals + UVs from the static buffer (only if stream is present)
                Writer->WriteArrayStart(TEXT("normals"));
                for (uint32 v = Section.MinVertexIndex; v < Section.MinVertexIndex + Section.NumVertices; v++)
                {
                    if ((int32)v >= NumVerts) break;
                    if (StaticBuf.GetTangentSize() > 0)
                    {
                        FVector N = StaticBuf.VertexTangentZ(v);
                        Writer->WriteValue(N.X); Writer->WriteValue(N.Y); Writer->WriteValue(N.Z);
                    }
                    else
                    {
                        Writer->WriteValue(0.0); Writer->WriteValue(1.0); Writer->WriteValue(0.0);
                    }
                }
                Writer->WriteArrayEnd();

                Writer->WriteArrayStart(TEXT("uvs"));
                for (uint32 v = Section.MinVertexIndex; v < Section.MinVertexIndex + Section.NumVertices; v++)
                {
                    if ((int32)v >= NumVerts) break;
                    if (StaticBuf.GetTangentSize() > 0)
                    {
                        FVector2D UV = StaticBuf.GetVertexUV(v, 0);
                        Writer->WriteValue(UV.X); Writer->WriteValue(UV.Y);
                    }
                    else
                    {
                        Writer->WriteValue(0.0); Writer->WriteValue(0.0);
                    }
                }
                Writer->WriteArrayEnd();

                // Indices
                Writer->WriteArrayStart(TEXT("indices"));
                TArray<uint32> Indices;
                IndexBuf.GetCopy(Indices);
                for (int32 i = Section.FirstIndex; i < Section.FirstIndex + Section.NumTriangles * 3; i++)
                {
                    if (!Indices.IsValidIndex(i)) break;
                    Writer->WriteValue((uint32)Indices[i]);
                }
                Writer->WriteArrayEnd();

                Writer->WriteValue(TEXT("materialRef"), MaterialRefs.IsValidIndex(s) ? MaterialRefs[s] : FString());
                Writer->WriteObjectEnd();
            }
        }
    }

    Writer->WriteArrayEnd();
    Writer->WriteObjectStart(TEXT("materials"));
    for (const FString& Ref : MaterialRefs)
    {
        if (Ref.IsEmpty()) continue;
        Writer->WriteObjectStart(Ref);
        Writer->WriteValue(TEXT("baseColor"), TEXT("#cccccc"));
        Writer->WriteValue(TEXT("metallic"), 0.0);
        Writer->WriteValue(TEXT("roughness"), 0.5);
        Writer->WriteValue(TEXT("emissive"), TEXT("#000000"));
        Writer->WriteValue(TEXT("emissiveIntensity"), 0.0);
        Writer->WriteValue(TEXT("opacity"), 1.0);
        Writer->WriteValue(TEXT("doubleSided"), false);
        Writer->WriteObjectEnd();
    }
    Writer->WriteObjectEnd();
    Writer->WriteObjectEnd();
    Writer->Close();

    return Out.IsEmpty() ? FString(TEXT("{}")) : Out;
}

// ── Material + texture capture ───────────────────────────────────

void FVreenExporter::CaptureMaterialFromSlot(UMaterialInterface* Mat, const FString& Id,
                                             TArray<FVreenAssetInput>& OutAssets,
                                             TMap<UTexture2D*, FString>& TextureToId,
                                             int32& OutMaterialCount, int32& OutTextureCount)
{
    if (!Mat) return;
    OutMaterialCount++;

    // Walk texture parameters; collect UTexture2D refs.
    if (UMaterialInstance* MI = Cast<UMaterialInstance>(Mat))
    {
        TArray<UTexture*> Textures;
        MI->GetTexturesInPropertyChain(Textures);
        for (UTexture* T : Textures)
        {
            if (UTexture2D* T2 = Cast<UTexture2D>(T))
            {
                if (!TextureToId.Contains(T2))
                {
                    TArray<uint8> Png;
                    if (EncodeTextureToPng(T2, Png))
                    {
                        FString TexId = FString::Printf(TEXT("tex-%08x"), OutTextureCount + 1);
                        TextureToId.Add(T2, TexId);
                        OutAssets.Add({ TexId, EVreenAssetKind::Texture, Png, T2->GetName() + TEXT(".png") });
                        OutTextureCount++;
                    }
                }
            }
        }
    }
}

bool FVreenExporter::EncodeTextureToPng(UTexture2D* Tex, TArray<uint8>& OutPng)
{
    if (!Tex) return false;
    // Public engine API doesn't expose PNG encoding for UTexture2D; consumers
    // typically use FImageUtils::CompressImage or the IImageWrapper. We
    // require the editor's IImageWrapperModule at runtime; for the
    // minimal cut, we leave this hook empty and return false. The caller
    // simply won't add a texture asset, which is OK because the model
    // references the material id, and the material can be re-resolved.
    // (To enable PNG output, link "ImageWrapper" in the build file and
    // replace this stub with a real encode path.)
    return false;
}

// ── Scene state capture ──────────────────────────────────────────

FVreenScene FVreenExporter::CaptureSceneState(UWorld* World, const TMap<UMaterialInterface*, FString>& MaterialToId)
{
    FVreenScene S;

    // Camera: pick the first ACameraActor in the world.
    ACameraActor* CamActor = nullptr;
    for (TActorIterator<ACameraActor> It(World); It; ++It) { CamActor = *It; break; }
    if (CamActor)
    {
        S.Camera.Add(TEXT("preset"), TEXT("perspective"));
        if (UCameraComponent* C = CamActor->GetCameraComponent())
        {
            S.Camera.Add(TEXT("fov"), FString::SanitizeFloat(C->FieldOfView));
        }
        FVector Loc = CamActor->GetActorLocation();
        FRotator Rot = CamActor->GetActorRotation();
        S.Camera.Add(TEXT("position"), FString::Printf(TEXT("%f,%f,%f"), Loc.X, Loc.Y, Loc.Z));
        S.Camera.Add(TEXT("rotation"), FString::Printf(TEXT("%f,%f,%f"), Rot.Pitch, Rot.Yaw, Rot.Roll));
    }

    // Environment: defaults.
    S.Environment.Add(TEXT("preset"), TEXT("studio"));
    S.Environment.Add(TEXT("exposure"), TEXT("1.0"));
    S.Environment.Add(TEXT("background"), TEXT("solid"));
    S.Environment.Add(TEXT("backgroundColor"), TEXT("#000000"));
    S.Environment.Add(TEXT("ambientIntensity"), TEXT("1.0"));

    // PostFX defaults.
    S.PostFX.Add(TEXT("bloom"), TEXT("false"));
    S.PostFX.Add(TEXT("bloomIntensity"), TEXT("0"));
    S.PostFX.Add(TEXT("chromaticAberration"), TEXT("false"));
    S.PostFX.Add(TEXT("vignette"), TEXT("false"));
    S.PostFX.Add(TEXT("ssao"), TEXT("false"));

    // Materials (placeholders — real PBR read is engine-version-specific).
    for (const auto& KV : MaterialToId)
    {
        TMap<FString, FString> M;
        M.Add(TEXT("baseColor"), TEXT("#cccccc"));
        M.Add(TEXT("metallic"), TEXT("0"));
        M.Add(TEXT("roughness"), TEXT("0.5"));
        M.Add(TEXT("emissive"), TEXT("#000000"));
        M.Add(TEXT("emissiveIntensity"), TEXT("0"));
        M.Add(TEXT("opacity"), TEXT("1"));
        S.Materials.Add(KV.Value, M);
    }

    return S;
}

FVreenWorld FVreenExporter::CaptureWorld(UWorld* World)
{
    FVreenWorld W;
    W.Version = TEXT("0.2.0");
    W.Name = World ? World->GetName() : TEXT("world");
    W.Frame = 0;

    if (!World) return W;
    int64 NextId = 1;
    for (TActorIterator<AActor> It(World); It; ++It)
    {
        AActor* Actor = *It;
        if (!Actor) continue;
        FVreenEntity E;
        E.Id = NextId++;
        E.Name = Actor->GetName();
        FVector Loc = Actor->GetActorLocation();
        FQuat Quat = Actor->GetActorQuat();
        FVector Scale = Actor->GetActorScale3D();
        E.SceneNode.Position = { (float)Loc.X, (float)Loc.Y, (float)Loc.Z };
        E.SceneNode.Rotation = { (float)Quat.X, (float)Quat.Y, (float)Quat.Z, (float)Quat.W };
        E.SceneNode.Scale = { (float)Scale.X, (float)Scale.Y, (float)Scale.Z };
        for (UActorComponent* Comp : Actor->GetComponents())
        {
            if (!Comp) continue;
            FVreenComponent C;
            C.Type = Comp->GetClass()->GetName();
            C.DataJson = FString::Printf(TEXT("{\"name\":\"%s\"}"), *JsonEscape(Comp->GetName()));
            E.Components.Add(C);
        }
        W.Entities.Add(E);
    }
    return W;
}

FString FVreenExporter::JsonEscape(const FString& In)
{
    FString Out = In;
    Out.ReplaceInline(TEXT("\\"), TEXT("\\\\"));
    Out.ReplaceInline(TEXT("\""), TEXT("\\\""));
    Out.ReplaceInline(TEXT("\n"), TEXT("\\n"));
    Out.ReplaceInline(TEXT("\r"), TEXT("\\r"));
    Out.ReplaceInline(TEXT("\t"), TEXT("\\t"));
    return Out;
}
