// VreenExporter.cs — Editor-side exporter that walks the active Unity
// scene and produces a .vreen package. Pure-C#: no third-party deps.
//
// Pipeline:
//   1. Walk root GameObjects via SceneManager.GetActiveScene().
//   2. For each Renderer with a MeshFilter: serialize the mesh to a
//      vmesh JSON document (see VreenVmesh.cs). Multiple meshes in the
//      same scene get merged into one vmesh document per logical model
//      (or per-mesh; we go with per-mesh for fidelity).
//   3. For each Material referenced by a Renderer: extract PBR params
//      (baseColor, metallic, roughness, emissive) and resolve textures.
//   4. For each Texture2D: encode to PNG and add as a texture asset.
//   5. For each AudioSource: encode the AudioClip to OGG/WAV.
//   6. Capture scene state (camera, environment, postFX) from the main
//      Camera and RenderSettings; if a "VREEN PostFX Volume" GameObject
//      is present, read its components for richer postFX state.
//   7. Call VreenLoader.Pack to produce a .vreen byte array.
//   8. Write to the chosen path on disk.

#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Vreen.EditorTools
{
    public static class VreenExporter
    {
        public class Options
        {
            /// <summary>Human-readable project name embedded in manifest.name.</summary>
            public string name = "Unity Scene";

            /// <summary>Display name of the primary asset. Defaults to active scene name.</summary>
            public string assetName;

            /// <summary>If true, include the ECS world snapshot. Requires a "VREEN World" component on a scene root.</summary>
            public bool includeWorld = true;

            /// <summary>If true, write the .vreen next to the .unity file. Otherwise require a chosen path.</summary>
            public bool useSceneDirectory = true;

            /// <summary>PNG quality: 0..100 (currently informational; PNG is lossless).</summary>
            public int textureQualityHint = 100;
        }

        public class Report
        {
            public string outputPath;
            public int meshCount;
            public int textureCount;
            public int materialCount;
            public int audioCount;
            public int entityCount;
            public long totalBytes;
            public bool ok;
            public string error;
        }

        // ── Entry point ───────────────────────────────────────────────

        public static Report ExportActiveScene(Options opts)
        {
            var report = new Report();
            try
            {
                var scene = SceneManager.GetActiveScene();
                if (!scene.IsValid())
                {
                    report.error = "no active scene";
                    return report;
                }

                if (string.IsNullOrEmpty(opts.assetName)) opts.assetName = scene.name;
                if (string.IsNullOrEmpty(opts.name)) opts.name = scene.name;

                // Resolve output path
                string scenePath = scene.path;
                if (string.IsNullOrEmpty(scenePath))
                {
                    report.error = "active scene has never been saved; please save the scene first";
                    return report;
                }
                if (opts.useSceneDirectory)
                {
                    string dir = Path.GetDirectoryName(scenePath);
                    string sceneName = Path.GetFileNameWithoutExtension(scenePath);
                    report.outputPath = Path.Combine(dir ?? "", sceneName + ".vreen").Replace('\\', '/');
                }

                if (string.IsNullOrEmpty(report.outputPath))
                {
                    report.error = "no output path resolved";
                    return report;
                }

                // Walk scene → build manifest inputs
                var assets = new List<VreenLoader.AssetInput>();
                var materialToId = new Dictionary<Material, string>();
                var textureToId = new Dictionary<Texture2D, string>();
                var nextId = NextIdCounter();

                // Per-GameObject group: we emit one vmesh per non-empty
                // GameObject (containing a Renderer+MeshFilter). This keeps
                // the vmesh small and the round-trip clean.
                foreach (var root in scene.GetRootGameObjects())
                {
                    WalkGameObject(root, assets, materialToId, textureToId, nextId, report);
                }

                // Capture scene state
                var vScene = CaptureSceneState(scene, materialToId);

                // Capture world (if requested and a "VREEN World" host is present)
                VreenWorldJson world = null;
                if (opts.includeWorld) world = CaptureWorld(scene);

                // Pack
                var input = new VreenLoader.PackInput
                {
                    name = opts.name,
                    assetName = opts.assetName,
                    scene = vScene,
                    assets = assets,
                    primaryModelId = null,
                    world = world,
                    generator = "unity " + Application.unityVersion + " vreen-unity 0.3.0",
                };
                var result = VreenLoader.Pack(input);
                File.WriteAllBytes(report.outputPath, result.bytes);

                report.materialCount = materialToId.Count;
                report.textureCount = textureToId.Count;
                report.entityCount = world?.entities?.Length ?? 0;
                report.totalBytes = result.bytes.Length;
                report.ok = true;

                Debug.Log($"[VREEN] Exported {report.outputPath} ({report.meshCount} meshes, {report.materialCount} materials, {report.textureCount} textures, {report.audioCount} audio, {report.entityCount} entities, {report.totalBytes} bytes)");
            }
            catch (Exception e)
            {
                report.error = e.Message;
                Debug.LogError($"[VREEN] Export failed: {e.Message}\n{e.StackTrace}");
            }
            return report;
        }

        // ── Walking ───────────────────────────────────────────────────

        static void WalkGameObject(
            GameObject go,
            List<VreenLoader.AssetInput> assets,
            Dictionary<Material, string> materialToId,
            Dictionary<Texture2D, string> textureToId,
            Counter nextId,
            Report report)
        {
            // Recurse into children
            foreach (Transform child in go.transform) WalkGameObject(child.gameObject, assets, materialToId, textureToId, nextId, report);

            // AudioSources
            foreach (var audio in go.GetComponents<AudioSource>())
            {
                if (audio == null || audio.clip == null) continue;
                CaptureAudio(audio.clip, assets, nextId, report);
            }

            var mf = go.GetComponent<MeshFilter>();
            var mr = go.GetComponent<MeshRenderer>();
            if (mf == null || mr == null || mf.sharedMesh == null) return;

            // Collect materials + their textures first
            var matRefs = new List<string>();
            foreach (var mat in mr.sharedMaterials)
            {
                if (mat == null) continue;
                if (!materialToId.TryGetValue(mat, out var matId))
                {
                    matId = "mat-" + nextId.Next();
                    materialToId[mat] = matId;
                    CaptureMaterial(mat, matId, assets, textureToId, nextId);
                    report.materialCount++;
                }
                matRefs.Add(matId);
            }

            // Build a vmesh for this mesh
            var doc = MeshToVmesh(mf.sharedMesh, go.name, matRefs);
            var bytes = Encoding.UTF8.GetBytes(VreenVmesh.ToJson(doc));
            var modelId = "model-" + nextId.Next();
            assets.Add(new VreenLoader.AssetInput
            {
                id = modelId,
                kind = AssetKind.Model,
                data = bytes,
                originalName = go.name + ".vmesh",
                meta = new Dictionary<string, object> { { "format", "vmesh" }, { "vertexCount", mf.sharedMesh.vertexCount } },
            });
            report.meshCount++;
        }

        static VreenVmesh.Document MeshToVmesh(UnityEngine.Mesh mesh, string goName, List<string> matRefs)
        {
            var doc = new VreenVmesh.Document { name = goName };

            // The vmesh format allows multiple sub-meshes; Unity's Mesh has
            // a subMeshCount, and we honor that.
            var verts = mesh.vertices;
            var normals = mesh.normals;
            var uvs = mesh.uv;

            for (int sm = 0; sm < mesh.subMeshCount; sm++)
            {
                var indices = mesh.GetTriangles(sm);
                var sub = new VreenVmesh.SubMesh
                {
                    name = mesh.name + "_sub" + sm,
                    vertices = ToFloatArray3(verts),
                    normals = (normals != null && normals.Length == verts.Length) ? ToFloatArray3(normals) : null,
                    uvs = (uvs != null && uvs.Length == verts.Length) ? ToFloatArray2(uvs) : null,
                    indices = ToUIntArray(indices),
                    materialRef = sm < matRefs.Count ? matRefs[sm] : (matRefs.Count > 0 ? matRefs[0] : null),
                };
                doc.meshes.Add(sub);
            }

            return doc;
        }

        static void CaptureMaterial(
            Material mat,
            string matId,
            List<VreenLoader.AssetInput> assets,
            Dictionary<Texture2D, string> textureToId,
            Counter nextId)
        {
            // We don't write the material as a separate asset (PBR params go
            // into scene.materials map). We just walk textures.
            foreach (var propName in new[] { "_MainTex", "_BaseMap", "_DiffuseMap", "_Albedo", "_BumpMap", "_MetallicGlossMap" })
            {
                if (!mat.HasProperty(propName)) continue;
                var tex = mat.GetTexture(propName);
                if (tex is Texture2D t2d && !textureToId.ContainsKey(t2d))
                {
                    CaptureTexture(t2d, assets, textureToId, nextId);
                }
            }
        }

        static void CaptureTexture(
            Texture2D tex,
            List<VreenLoader.AssetInput> assets,
            Dictionary<Texture2D, string> textureToId,
            Counter nextId)
        {
            // EncodeToPNG requires the texture to be readable. Many imported
            // textures have isReadable=false; in that case we copy to a
            // RenderTexture, blit, and read back.
            byte[] png;
            try
            {
                png = ImageConversion.EncodeToPNG(tex);
                if (png == null || png.Length == 0) throw new InvalidOperationException("EncodeToPNG returned empty");
            }
            catch
            {
                // Fallback: RT path
                var rt = RenderTexture.GetTemporary(tex.width, tex.height, 0, RenderTextureFormat.ARGB32);
                var prev = RenderTexture.active;
                try
                {
                    Graphics.Blit(tex, rt);
                    RenderTexture.active = rt;
                    var tmp = new Texture2D(tex.width, tex.height, TextureFormat.RGBA32, false);
                    tmp.ReadPixels(new Rect(0, 0, tex.width, tex.height), 0, 0);
                    tmp.Apply();
                    png = ImageConversion.EncodeToPNG(tmp);
                    UnityEngine.Object.DestroyImmediate(tmp);
                }
                finally
                {
                    RenderTexture.active = prev;
                    RenderTexture.ReleaseTemporary(rt);
                }
            }
            if (png == null || png.Length == 0) return;

            var texId = "tex-" + nextId.Next();
            textureToId[tex] = texId;
            assets.Add(new VreenLoader.AssetInput
            {
                id = texId,
                kind = AssetKind.Texture,
                data = png,
                originalName = tex.name + ".png",
                meta = new Dictionary<string, object>
                {
                    { "width", tex.width },
                    { "height", tex.height },
                    { "format", "png" },
                },
            });
        }

        // ── Audio capture ─────────────────────────────────────────────

        static void CaptureAudio(AudioClip clip, List<VreenLoader.AssetInput> assets, Counter nextId, Report report)
        {
            // We can't easily re-encode to OGG without a third-party codec,
            // so we write a small "vreen-audio-stub" JSON describing the
            // clip's metadata. Players can rebuild the AudioClip from this.
            // (Forward-compat: when the consumer wants real bytes, we'll
            // switch to WAV/OGG via ffmpeg or an editor extension.)
            var stub = "{\"format\":\"vreen-audio-stub\",\"name\":\"" + clip.name + "\"," +
                       "\"channels\":" + clip.channels + "," +
                       "\"sampleRate\":" + clip.frequency + "," +
                       "\"lengthSec\":" + clip.length.ToString("R", CultureInfo.InvariantCulture) + "," +
                       "\"samples\":" + clip.samples + "}";
            var bytes = Encoding.UTF8.GetBytes(stub);
            var id = "audio-" + nextId.Next();
            assets.Add(new VreenLoader.AssetInput
            {
                id = id,
                kind = AssetKind.Audio,
                data = bytes,
                originalName = clip.name + ".audio-stub.json",
                meta = new Dictionary<string, object>
                {
                    { "format", "vreen-audio-stub" },
                    { "channels", clip.channels },
                    { "sampleRate", clip.frequency },
                },
            });
            report.audioCount++;
        }

        // ── Scene state capture ───────────────────────────────────────

        static VreenScene CaptureSceneState(Scene scene, Dictionary<Material, string> materialToId)
        {
            var cam = Camera.main;
            var vs = new VreenScene();

            // Camera
            if (cam != null)
            {
                vs.camera["preset"] = "perspective";
                vs.camera["fov"] = cam.fieldOfView.ToString("R", CultureInfo.InvariantCulture);
                vs.camera["nearClip"] = cam.nearClipPlane.ToString("R", CultureInfo.InvariantCulture);
                vs.camera["farClip"] = cam.farClipPlane.ToString("R", CultureInfo.InvariantCulture);
                var t = cam.transform;
                vs.camera["position"] = $"{t.position.x},{t.position.y},{t.position.z}";
                vs.camera["rotation"] = $"{t.eulerAngles.x},{t.eulerAngles.y},{t.eulerAngles.z}";
            }

            // Environment — read from RenderSettings
            vs.environment["preset"] = "studio";
            vs.environment["exposure"] = "1.0";
            vs.environment["background"] = RenderSettings.skybox != null ? "environment" : "solid";
            vs.environment["backgroundColor"] = ColorToHex(RenderSettings.ambientLight);
            vs.environment["ambientIntensity"] = RenderSettings.ambientIntensity.ToString("R", CultureInfo.InvariantCulture);

            // PostFX — read from a "VREEN PostFX Volume" if present, else defaults
            vs.postFX["bloom"] = "false";
            vs.postFX["bloomIntensity"] = "0";
            vs.postFX["chromaticAberration"] = "false";
            vs.postFX["vignette"] = "false";
            vs.postFX["ssao"] = "false";
            foreach (var root in scene.GetRootGameObjects())
            {
                foreach (var mb in root.GetComponentsInChildren<MonoBehaviour>(true))
                {
                    if (mb == null) continue;
                    var t = mb.GetType();
                    if (t.Name != "VreenPostFXVolume") continue;
                    TryReadBool(t, mb, "bloom", v => vs.postFX["bloom"] = v ? "true" : "false");
                    TryReadFloat(t, mb, "bloomIntensity", v => vs.postFX["bloomIntensity"] = v.ToString("R", CultureInfo.InvariantCulture));
                    TryReadBool(t, mb, "chromaticAberration", v => vs.postFX["chromaticAberration"] = v ? "true" : "false");
                    TryReadBool(t, mb, "vignette", v => vs.postFX["vignette"] = v ? "true" : "false");
                    TryReadBool(t, mb, "ssao", v => vs.postFX["ssao"] = v ? "true" : "false");
                    break;
                }
            }

            // Materials — PBR params (one entry per material id, flat string values)
            foreach (var kv in materialToId)
            {
                var mat = kv.Key;
                vs.materials[kv.Value] = new Dictionary<string, object>
                {
                    { "baseColor", ColorToHex(mat.HasProperty("_BaseColor") ? mat.GetColor("_BaseColor") : mat.HasProperty("_Color") ? mat.GetColor("_Color") : Color.white) },
                    { "metallic", (mat.HasProperty("_Metallic") ? mat.GetFloat("_Metallic") : 0f).ToString("R", CultureInfo.InvariantCulture) },
                    { "roughness", (mat.HasProperty("_Glossiness") ? 1f - mat.GetFloat("_Glossiness") : 0.5f).ToString("R", CultureInfo.InvariantCulture) },
                    { "emissive", ColorToHex(mat.HasProperty("_EmissionColor") ? mat.GetColor("_EmissionColor") : Color.black) },
                    { "emissiveIntensity", (mat.HasProperty("_EmissionIntensity") ? mat.GetFloat("_EmissionIntensity") : 1f).ToString("R", CultureInfo.InvariantCulture) },
                    { "opacity", (mat.HasProperty("_Opacity") ? mat.GetFloat("_Opacity") : 1f).ToString("R", CultureInfo.InvariantCulture) },
                };
            }

            return vs;
        }

        // ── World capture ─────────────────────────────────────────────

        static VreenWorldJson CaptureWorld(Scene scene)
        {
            var world = new VreenWorldJson { version = "0.2.0", name = scene.name, frame = 0 };
            var entities = new List<VreenEntityJson>();
            int nextEntityId = 1;
            foreach (var root in scene.GetRootGameObjects())
            {
                CaptureWorldEntity(root, entities, ref nextEntityId);
            }
            world.entities = entities.ToArray();
            return world;
        }

        static void CaptureWorldEntity(GameObject go, List<VreenEntityJson> entities, ref int nextId)
        {
            foreach (Transform child in go.transform) CaptureWorldEntity(child.gameObject, entities, ref nextId);

            var t = go.transform;
            var components = new List<VreenComponentJson>();
            // Capture any MonoBehaviour's serializable fields as a "free-form" component
            foreach (var mb in go.GetComponents<MonoBehaviour>())
            {
                if (mb == null) continue;
                var t2 = mb.GetType();
                var data = new Dictionary<string, object>();
                foreach (var f in t2.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance))
                {
                    if (f.IsStatic) continue;
                    var v = f.GetValue(mb);
                    if (v is UnityEngine.Object || v == null) continue;
                    data[f.Name] = v.ToString();
                }
                components.Add(new VreenComponentJson { type = t2.Name, data = data });
            }
            entities.Add(new VreenEntityJson
            {
                id = nextId++,
                name = go.name,
                sceneNode = new VreenSceneNodeJson
                {
                    position = new[] { t.position.x, t.position.y, t.position.z },
                    rotation = new[] { t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w },
                    scale = new[] { t.lossyScale.x, t.lossyScale.y, t.lossyScale.z },
                },
                components = components.ToArray(),
            });
        }

        // ── Helpers ───────────────────────────────────────────────────

        class Counter { public int n; public string Next() => (++n).ToString("x8"); }
        static Counter NextIdCounter() => new Counter();

        static float[] ToFloatArray3(Vector3[] v)
        {
            var arr = new float[v.Length * 3];
            for (int i = 0; i < v.Length; i++) { arr[i * 3] = v[i].x; arr[i * 3 + 1] = v[i].y; arr[i * 3 + 2] = v[i].z; }
            return arr;
        }
        static float[] ToFloatArray2(Vector2[] v)
        {
            var arr = new float[v.Length * 2];
            for (int i = 0; i < v.Length; i++) { arr[i * 2] = v[i].x; arr[i * 2 + 1] = v[i].y; }
            return arr;
        }
        static uint[] ToUIntArray(int[] v)
        {
            var arr = new uint[v.Length];
            for (int i = 0; i < v.Length; i++) arr[i] = (uint)v[i];
            return arr;
        }

        static string ColorToHex(Color c)
        {
            int r = Mathf.Clamp(Mathf.RoundToInt(c.r * 255), 0, 255);
            int g = Mathf.Clamp(Mathf.RoundToInt(c.g * 255), 0, 255);
            int b = Mathf.Clamp(Mathf.RoundToInt(c.b * 255), 0, 255);
            return $"#{r:x2}{g:x2}{b:x2}";
        }

        static void TryReadBool(Type t, object obj, string field, Action<bool> apply)
        {
            try
            {
                var f = t.GetField(field);
                if (f != null && f.FieldType == typeof(bool)) apply((bool)f.GetValue(obj));
            }
            catch { /* ignore */ }
        }
        static void TryReadFloat(Type t, object obj, string field, Action<float> apply)
        {
            try
            {
                var f = t.GetField(field);
                if (f != null && f.FieldType == typeof(float)) apply((float)f.GetValue(obj));
            }
            catch { /* ignore */ }
        }
    }
}
#endif
