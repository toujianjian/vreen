// VreenVmesh.cs — VREEN mesh (vmesh) JSON serializer.
//
// Implements the format described in §14.2 of docs/format/vreen-format-spec.md.
// Used by VreenExporter when GLB encoding isn't available (or not desired).
// Pure-C#: no Unity Editor APIs here, so this file can ship in the runtime
// assembly too (useful for tools that want to read vmesh in builds).

using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Vreen
{
    public static class VreenVmesh
    {
        public const string Version = "1.0.0";

        // ── Material record (subset of scene.materials) ──────────────
        public class Material
        {
            public string baseColor = "#ffffff";
            public float metallic = 0f;
            public float roughness = 0.5f;
            public string emissive = "#000000";
            public float emissiveIntensity = 0f;
            public float opacity = 1f;
            public bool doubleSided = false;
            public string baseColorTextureRef; // optional, id of separate texture asset
        }

        // ── Sub-mesh record ───────────────────────────────────────────
        public class SubMesh
        {
            public string name;
            public float[] vertices; // length % 3 == 0
            public float[] normals;  // length % 3 == 0, may be null
            public float[] uvs;      // length % 2 == 0, may be null
            public uint[] indices;   // length % 3 == 0
            public string materialRef;
        }

        public class Document
        {
            public string version = Version;
            public string name;
            public List<SubMesh> meshes = new();
            public Dictionary<string, Material> materials = new();
        }

        // ── Emit ──────────────────────────────────────────────────────
        public static string ToJson(Document d)
        {
            var sb = new StringBuilder(1024);
            sb.Append('{');
            WriteField(sb, "version", d.version, false);
            WriteField(sb, "name", d.name, true);
            WriteArrayField(sb, "meshes", d.meshes, true);
            WriteDictField(sb, "materials", d.materials, true);
            sb.Append('}');
            return sb.ToString();
        }

        // ── Tiny JSON writer helpers (stringifies primitives + arrays) ─
        static void WriteField(StringBuilder sb, string key, string s, bool leadingComma)
        {
            if (leadingComma) sb.Append(',');
            sb.Append('"').Append(key).Append("\":");
            if (s == null) sb.Append("null");
            else WriteString(sb, s);
        }

        static void WriteArrayField(StringBuilder sb, string key, List<SubMesh> meshes, bool leadingComma)
        {
            if (leadingComma) sb.Append(',');
            sb.Append('"').Append(key).Append("\":[");
            for (int i = 0; i < meshes.Count; i++)
            {
                if (i > 0) sb.Append(',');
                WriteSubMesh(sb, meshes[i]);
            }
            sb.Append(']');
        }

        static void WriteDictField(StringBuilder sb, string key, Dictionary<string, Material> dict, bool leadingComma)
        {
            if (leadingComma) sb.Append(',');
            sb.Append('"').Append(key).Append("\":{");
            bool first = true;
            foreach (var kv in dict)
            {
                if (!first) sb.Append(',');
                first = false;
                WriteString(sb, kv.Key);
                sb.Append(':');
                WriteMaterial(sb, kv.Value);
            }
            sb.Append('}');
        }

        static void WriteSubMesh(StringBuilder sb, SubMesh m)
        {
            sb.Append('{');
            WriteField(sb, "name", m.name ?? "", false);
            WriteFloatArrayField(sb, "vertices", m.vertices, true);
            WriteFloatArrayField(sb, "normals", m.normals, true);
            WriteFloatArrayField(sb, "uvs", m.uvs, true);
            WriteUIntArrayField(sb, "indices", m.indices, true);
            WriteField(sb, "materialRef", m.materialRef, true);
            sb.Append('}');
        }

        static void WriteMaterial(StringBuilder sb, Material m)
        {
            sb.Append('{');
            WriteField(sb, "baseColor", m.baseColor, false);
            sb.Append(',"metallic":').Append(F(m.metallic));
            sb.Append(',"roughness":').Append(F(m.roughness));
            WriteField(sb, "emissive", m.emissive, true);
            sb.Append(',"emissiveIntensity":').Append(F(m.emissiveIntensity));
            sb.Append(',"opacity":').Append(F(m.opacity));
            sb.Append(',"doubleSided":').Append(m.doubleSided ? "true" : "false");
            if (m.baseColorTextureRef != null) WriteField(sb, "baseColorTextureRef", m.baseColorTextureRef, true);
            sb.Append('}');
        }

        static void WriteFloatArrayField(StringBuilder sb, string key, float[] arr, bool leadingComma)
        {
            if (leadingComma) sb.Append(',');
            sb.Append('"').Append(key).Append("\":");
            if (arr == null) { sb.Append("null"); return; }
            sb.Append('[');
            for (int i = 0; i < arr.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(F(arr[i]));
            }
            sb.Append(']');
        }

        static void WriteUIntArrayField(StringBuilder sb, string key, uint[] arr, bool leadingComma)
        {
            if (leadingComma) sb.Append(',');
            sb.Append('"').Append(key).Append("\":");
            if (arr == null) { sb.Append("null"); return; }
            sb.Append('[');
            for (int i = 0; i < arr.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(arr[i].ToString(CultureInfo.InvariantCulture));
            }
            sb.Append(']');
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        static string F(float v) => v.ToString("R", CultureInfo.InvariantCulture);
    }
}
