// VreenLoader.cs — pack / unpack / validate for .vreen in Unity.
// No external dependencies: uses System.IO.Compression + JsonUtility + a small
// home-grown JSON parser fallback (so we don't need Newtonsoft).

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Vreen
{
    public static class VreenLoader
    {
        // ── Pack ──────────────────────────────────────────────────────

        public class PackInput
        {
            public string name;
            public string assetName;
            public VreenScene scene;
            public List<AssetInput> assets = new();
            public string primaryModelId; // optional
            public VreenWorldJson world;
            public string generator = "vreen-unity " + Versions.Current;
        }

        public class AssetInput
        {
            public string id; // auto-generated if null
            public AssetKind kind;
            public byte[] data;
            public string originalName;
            public string sha256; // optional, computed if null
            public Dictionary<string, object> meta;
        }

        public class PackResult
        {
            public byte[] bytes;
            public VreenManifest manifest;
            public Dictionary<string, int> entries;
        }

        public static PackResult Pack(PackInput input)
        {
            var scene = input.scene ?? new VreenScene();
            var entries = new Dictionary<string, byte[]>();
            var assetEntries = new List<VreenAssetEntry>();
            string primaryModelId = input.primaryModelId;

            foreach (var a in input.assets)
            {
                string id = a.id ?? GenerateId();
                string path = UniqueAssetPath(a.kind, a.originalName ?? "asset", id);
                entries[path] = a.data;
                string hash = a.sha256 ?? Sha256Hex(a.data);
                assetEntries.Add(new VreenAssetEntry
                {
                    id = id,
                    kind = a.kind.ToString().ToLowerInvariant(),
                    path = path,
                    size = a.data.Length,
                    sha256 = hash,
                    originalName = a.originalName,
                    meta = a.meta,
                });
                if (a.kind == AssetKind.Model && string.IsNullOrEmpty(primaryModelId)) primaryModelId = id;
            }

            var manifest = new VreenManifest
            {
                version = Versions.Current,
                exportedAt = DateTime.UtcNow.ToString("o"),
                name = input.name,
                assetName = input.assetName,
                generator = input.generator,
                assets = assetEntries.ToArray(),
                primaryModelId = primaryModelId,
                world = input.world,
            };

            entries["manifest.json"] = JsonEncode(ManifestToJson(manifest));
            entries["scene.json"] = JsonEncode(SceneToJson(scene));

            byte[] zipped = ZipEntries(entries);
            var result = new PackResult
            {
                bytes = zipped,
                manifest = manifest,
                entries = entries.ToDictionary(kv => kv.Key, kv => kv.Value.Length),
            };
            return result;
        }

        // ── Unpack ────────────────────────────────────────────────────

        public static UnpackedVreen Unpack(byte[] source)
        {
            if (source.Length >= 4 && source[0] == 0x50 && source[1] == 0x4B && source[2] == 0x03 && source[3] == 0x04)
                return UnpackZip(source);

            return UnpackLegacyJson(source);
        }

        static UnpackedVreen UnpackZip(byte[] bytes)
        {
            var entries = UnzipAll(bytes);
            if (entries.ContainsKey("manifest.json") && entries.ContainsKey("scene.json"))
                return ParseVreen02(entries);
            if (entries.ContainsKey("project.json"))
                return UnpackLegacyJson(entries["project.json"]);
            throw new VreenFormatError("zip missing manifest.json / scene.json / project.json");
        }

        static UnpackedVreen ParseVreen02(Dictionary<string, byte[]> entries)
        {
            var manifest = JsonDecodeManifest(Encoding.UTF8.GetString(entries["manifest.json"]));
            var scene = JsonDecodeScene(Encoding.UTF8.GetString(entries["scene.json"]));
            var assets = new Dictionary<string, byte[]>();
            foreach (var a in manifest.assets)
            {
                if (entries.TryGetValue(a.path, out var data))
                    assets[a.id] = data;
            }
            return new UnpackedVreen { manifest = manifest, scene = scene, assets = assets, world = manifest.world };
        }

        static UnpackedVreen UnpackLegacyJson(byte[] bytes)
        {
            string text = Encoding.UTF8.GetString(bytes);
            // Strip BOM if present
            if (text.Length > 0 && text[0] == '\uFEFF') text = text.Substring(1);
            var root = MiniJson.Parse(text) as Dictionary<string, object>;
            if (root == null) throw new VreenFormatError("legacy .vreen root is not an object");
            string version = root.TryGetValue("version", out var v) ? v as string : null;
            if (version != Versions.Legacy) throw new VreenFormatError($"legacy version mismatch: {version}");

            string assetName = root.TryGetValue("assetName", out var an) ? an as string : "legacy";
            string exportedAt = root.TryGetValue("exportedAt", out var ea) ? ea as string : DateTime.UtcNow.ToString("o");

            var scene = new VreenScene
            {
                camera = (root.TryGetValue("camera", out var c) ? c : new Dictionary<string, object>()) as Dictionary<string, object> ?? new(),
                animation = (root.TryGetValue("animation", out var a2) ? a2 : new Dictionary<string, object>()) as Dictionary<string, object> ?? new(),
                environment = (root.TryGetValue("environment", out var e) ? e : new Dictionary<string, object>()) as Dictionary<string, object> ?? new(),
                postFX = (root.TryGetValue("postFX", out var p) ? p : new Dictionary<string, object>()) as Dictionary<string, object> ?? new(),
                materials = new Dictionary<string, Dictionary<string, object>>(),
            };

            var manifest = new VreenManifest
            {
                version = Versions.Current,
                exportedAt = exportedAt,
                name = assetName,
                assetName = assetName,
                generator = "VREEN Legacy Upgrader",
                assets = Array.Empty<VreenAssetEntry>(),
                primaryModelId = null,
                world = null,
            };
            return new UnpackedVreen { manifest = manifest, scene = scene, assets = new(), world = null };
        }

        // ── Validate ──────────────────────────────────────────────────

        public class ValidationIssue
        {
            public string level; // error / warning / info
            public string code;
            public string message;
            public string path;
        }

        public class ValidationReport
        {
            public bool ok;
            public List<ValidationIssue> issues = new();
            public int assetCount;
            public long totalAssetBytes;
            public int modelCount, textureCount, hdriCount, audioCount;
            public int entityCount;
            public long durationMs;
        }

        public static ValidationReport Validate(UnpackedVreen pkg)
        {
            var t0 = DateTime.UtcNow;
            var issues = new List<ValidationIssue>();

            foreach (var a in pkg.manifest.assets)
            {
                if (!pkg.assets.TryGetValue(a.id, out var data))
                {
                    issues.Add(new ValidationIssue { level = "error", code = "ASSET_MISSING", message = $"asset {a.id} ({a.kind}) bytes missing", path = a.path });
                    continue;
                }
                if (data.Length != a.size)
                    issues.Add(new ValidationIssue { level = "error", code = "ASSET_SIZE_MISMATCH", message = $"asset {a.id} expected {a.size} bytes, got {data.Length}", path = a.path });
                if (!string.IsNullOrEmpty(a.sha256))
                {
                    if (a.sha256.Length != 64)
                        issues.Add(new ValidationIssue { level = "warning", code = "SHA256_BAD_FORMAT", message = $"asset {a.id} sha256 not 64 hex chars", path = a.path });
                    else
                    {
                        var actual = Sha256Hex(data);
                        if (actual != a.sha256)
                            issues.Add(new ValidationIssue { level = "error", code = "SHA256_MISMATCH", message = $"asset {a.id} sha256 mismatch", path = a.path });
                    }
                }
            }

            var r = new ValidationReport
            {
                ok = !issues.Any(i => i.level == "error"),
                issues = issues,
                assetCount = pkg.manifest.assets.Length,
                modelCount = pkg.manifest.assets.Count(a => a.GetKind() == AssetKind.Model),
                textureCount = pkg.manifest.assets.Count(a => a.GetKind() == AssetKind.Texture),
                hdriCount = pkg.manifest.assets.Count(a => a.GetKind() == AssetKind.Hdri),
                audioCount = pkg.manifest.assets.Count(a => a.GetKind() == AssetKind.Audio),
                entityCount = pkg.world?.entities?.Length ?? 0,
                totalAssetBytes = pkg.manifest.assets.Sum(a => a.size),
                durationMs = (long)(DateTime.UtcNow - t0).TotalMilliseconds,
            };
            return r;
        }

        // ── Hash helpers ──────────────────────────────────────────────

        public static string Sha256Hex(byte[] data)
        {
            using var sha = SHA256.Create();
            byte[] hash = sha.ComputeHash(data);
            var sb = new StringBuilder(64);
            foreach (var b in hash) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        static string GenerateId()
        {
            var bytes = new byte[16];
            using var rng = RandomNumberGenerator.Create();
            rng.GetBytes(bytes);
            var sb = new StringBuilder(32);
            foreach (var b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        static string UniqueAssetPath(AssetKind kind, string originalName, string id)
        {
            string safe = string.IsNullOrWhiteSpace(originalName) ? "asset" :
                new string(originalName.Where(c => char.IsLetterOrDigit(c) || c == '.' || c == '_' || c == '-').ToArray());
            int dot = safe.LastIndexOf('.');
            string baseName, ext;
            if (dot > 0 && dot < safe.Length - 1)
            {
                baseName = safe.Substring(0, dot);
                ext = safe.Substring(dot);
            }
            else { baseName = safe; ext = ""; }
            string tagged = $"{baseName.Substring(0, Math.Min(40, baseName.Length))}-{id}{ext}";
            return kind switch
            {
                AssetKind.Model => $"assets/{tagged}",
                AssetKind.Texture => $"assets/textures/{tagged}",
                AssetKind.Hdri => $"assets/hdri/{tagged}",
                AssetKind.Audio => $"assets/audio/{tagged}",
                _ => $"assets/{tagged}",
            };
        }

        // ── Zip helpers ───────────────────────────────────────────────

        static byte[] ZipEntries(Dictionary<string, byte[]> entries)
        {
            using var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
            {
                foreach (var kv in entries)
                {
                    var e = zip.CreateEntry(kv.Key);
                    using var s = e.Open();
                    s.Write(kv.Value, 0, kv.Value.Length);
                }
            }
            return ms.ToArray();
        }

        static Dictionary<string, byte[]> UnzipAll(byte[] bytes)
        {
            var result = new Dictionary<string, byte[]>();
            using var ms = new MemoryStream(bytes);
            using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
            foreach (var e in zip.Entries)
            {
                using var s = e.Open();
                using var ms2 = new MemoryStream();
                s.CopyTo(ms2);
                result[e.FullName] = ms2.ToArray();
            }
            return result;
        }

        // ── JSON encode/decode shims ──────────────────────────────────
        // Real implementation should use Unity's JsonUtility + manual toDictionary;
        // for brevity we use a tiny built-in JSON serializer (encode) and parse
        // via UnityEngine.JsonUtility for top-level types. For full nested
        // dictionaries, the consumer should use Newtonsoft.Json (com.unity.nuget).
        // See VreenJson.cs for the full helpers.

        public static byte[] JsonEncode(object o) => Encoding.UTF8.GetBytes(VreenJson.Stringify(o));
        public static VreenManifest JsonDecodeManifest(string s) => VreenJson.ParseManifest(s);
        public static VreenScene JsonDecodeScene(string s) => VreenJson.ParseScene(s);

        // Bridges used by Pack()
        public static object ManifestToJson(VreenManifest m) => VreenJson.ManifestToDict(m);
        public static object SceneToJson(VreenScene s) => VreenJson.SceneToDict(s);
    }
}
