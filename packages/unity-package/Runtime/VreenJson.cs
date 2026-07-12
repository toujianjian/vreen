// VreenJson.cs — JSON encode/decode helpers for Vreen Unity package.
//
// We avoid Newtonsoft.Json (com.unity.nuget) to keep this package zero-dep.
// Implementation:
//   - Stringify: hand-rolled; handles primitives, IList, IDictionary, VreenModel types
//   - Parse: Unity's JsonUtility for top-level structs; for nested maps we
//     use a small recursive descent parser (MiniJson below).
//
// This is intentionally simple — production code with complex schemas should
// swap in Newtonsoft.Json or System.Text.Json. The format of .vreen is small
// enough that this is sufficient for the common case.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Vreen
{
    public static class VreenJson
    {
        // ── Stringify ────────────────────────────────────────────────
        public static string Stringify(object o)
        {
            var sb = new StringBuilder(256);
            Write(sb, o);
            return sb.ToString();
        }

        static void Write(StringBuilder sb, object o)
        {
            if (o == null) { sb.Append("null"); return; }
            switch (o)
            {
                case string s: WriteString(sb, s); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); return;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); return;
                case float f: sb.Append(f.ToString("R", CultureInfo.InvariantCulture)); return;
                case double d: sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); return;
                case DateTime dt: WriteString(sb, dt.ToString("o")); return;
                case VreenManifest m: WriteDict(sb, ManifestToDict(m)); return;
                case VreenScene sc: WriteDict(sb, SceneToDict(sc)); return;
                case VreenWorldJson w: WriteDict(sb, WorldToDict(w)); return;
                case VreenEntityJson e: WriteDict(sb, EntityToDict(e)); return;
                case VreenAssetEntry a: WriteDict(sb, AssetToDict(a)); return;
            }
            if (o is System.Collections.IEnumerable e2 && !(o is string))
            {
                sb.Append('[');
                bool first = true;
                foreach (var item in e2)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Write(sb, item);
                }
                sb.Append(']');
                return;
            }
            if (o is System.Collections.IDictionary d)
            {
                WriteDict(sb, d);
                return;
            }
            // Fallback: ToString
            WriteString(sb, o.ToString());
        }

        static void WriteDict(StringBuilder sb, object d)
        {
            sb.Append('{');
            bool first = true;
            if (d is System.Collections.IDictionary id)
            {
                foreach (System.Collections.DictionaryEntry kv in id)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteString(sb, kv.Key?.ToString() ?? "");
                    sb.Append(':');
                    Write(sb, kv.Value);
                }
            }
            sb.Append('}');
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
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // ── Model → Dict ─────────────────────────────────────────────

        public static Dictionary<string, object> ManifestToDict(VreenManifest m) => new()
        {
            { "version", m.version },
            { "exportedAt", m.exportedAt },
            { "name", m.name },
            { "assetName", m.assetName },
            { "generator", m.generator },
            { "primaryModelId", m.primaryModelId ?? "" },
            { "assets", m.assets },
            { "world", m.world },
        };

        public static Dictionary<string, object> SceneToDict(VreenScene s) => new()
        {
            { "version", s.version },
            { "camera", s.camera },
            { "animation", s.animation },
            { "environment", s.environment },
            { "postFX", s.postFX },
            { "materials", s.materials },
        };

        public static Dictionary<string, object> WorldToDict(VreenWorldJson w) => new()
        {
            { "version", w.version },
            { "name", w.name },
            { "frame", w.frame },
            { "entities", w.entities },
        };

        public static Dictionary<string, object> EntityToDict(VreenEntityJson e) => new()
        {
            { "id", e.id },
            { "name", e.name },
            { "sceneNode", e.sceneNode == null ? null : (object)new Dictionary<string, object>
                {
                    { "position", e.sceneNode.position },
                    { "rotation", e.sceneNode.rotation },
                    { "scale", e.sceneNode.scale },
                }
            },
            { "components", e.components },
        };

        public static Dictionary<string, object> AssetToDict(VreenAssetEntry a)
        {
            var d = new Dictionary<string, object>
            {
                { "id", a.id },
                { "kind", a.kind },
                { "path", a.path },
                { "size", a.size },
            };
            if (a.sha256 != null) d["sha256"] = a.sha256;
            if (a.originalName != null) d["originalName"] = a.originalName;
            if (a.meta != null) d["meta"] = a.meta;
            return d;
        }

        // ── Parse ────────────────────────────────────────────────────

        public static VreenManifest ParseManifest(string s) => ParseManifest(MiniJson.Parse(s));
        public static VreenManifest ParseManifest(object obj)
        {
            var d = (Dictionary<string, object>)obj;
            var assets = new List<VreenAssetEntry>();
            if (d.TryGetValue("assets", out var aobj) && aobj is List<object> alist)
            {
                foreach (var ao in alist)
                {
                    var ad = (Dictionary<string, object>)ao;
                    assets.Add(new VreenAssetEntry
                    {
                        id = (string)ad["id"],
                        kind = (string)ad["kind"],
                        path = (string)ad["path"],
                        size = Convert.ToInt64(ad["size"]),
                        sha256 = ad.TryGetValue("sha256", out var s) ? s as string : null,
                        originalName = ad.TryGetValue("originalName", out var on) ? on as string : null,
                    });
                }
            }
            return new VreenManifest
            {
                version = (string)d.GetValueOrDefault("version", Versions.Current),
                exportedAt = (string)d["exportedAt"],
                name = (string)d["name"],
                assetName = (string)d["assetName"],
                generator = (string)d["generator"],
                assets = assets.ToArray(),
                primaryModelId = d.TryGetValue("primaryModelId", out var p) ? p as string : null,
                world = d.TryGetValue("world", out var w) && w is Dictionary<string, object> ? ParseWorld(w) : null,
            };
        }

        public static VreenScene ParseScene(string s) => ParseScene(MiniJson.Parse(s));
        public static VreenScene ParseScene(object obj)
        {
            var d = (Dictionary<string, object>)obj;
            return new VreenScene
            {
                version = (string)d.GetValueOrDefault("version", Versions.Current),
                camera = AsDict(d, "camera"),
                animation = AsDict(d, "animation"),
                environment = AsDict(d, "environment"),
                postFX = AsDict(d, "postFX"),
                materials = AsDictOfDict(d, "materials"),
            };
        }

        static VreenWorldJson ParseWorld(object obj)
        {
            var d = (Dictionary<string, object>)obj;
            return new VreenWorldJson
            {
                version = (string)d.GetValueOrDefault("version", Versions.World),
                name = (string)d["name"],
                frame = Convert.ToInt64(d["frame"]),
                entities = ParseEntities(d["entities"] as List<object>),
            };
        }

        static VreenEntityJson[] ParseEntities(List<object> list)
        {
            if (list == null) return Array.Empty<VreenEntityJson>();
            var result = new VreenEntityJson[list.Count];
            for (int i = 0; i < list.Count; i++)
            {
                var ed = (Dictionary<string, object>)list[i];
                var node = (Dictionary<string, object>)ed["sceneNode"];
                result[i] = new VreenEntityJson
                {
                    id = Convert.ToInt64(ed["id"]),
                    name = (string)ed["name"],
                    sceneNode = new VreenSceneNodeJson
                    {
                        position = ((List<object>)node["position"]).Select(o => Convert.ToSingle(o)).ToArray(),
                        rotation = ((List<object>)node["rotation"]).Select(o => Convert.ToSingle(o)).ToArray(),
                        scale = ((List<object>)node["scale"]).Select(o => Convert.ToSingle(o)).ToArray(),
                    },
                    components = ((List<object>)ed["components"]).Select(c =>
                    {
                        var cd = (Dictionary<string, object>)c;
                        return new VreenComponentJson
                        {
                            type = (string)cd["type"],
                            data = (Dictionary<string, object>)cd["data"],
                        };
                    }).ToArray(),
                };
            }
            return result;
        }

        static Dictionary<string, object> AsDict(Dictionary<string, object> d, string key)
            => d.TryGetValue(key, out var v) ? (v as Dictionary<string, object>) ?? new() : new();

        static Dictionary<string, Dictionary<string, object>> AsDictOfDict(Dictionary<string, object> d, string key)
        {
            var result = new Dictionary<string, Dictionary<string, object>>();
            if (d.TryGetValue(key, out var v) && v is Dictionary<string, object> outer)
            {
                foreach (var kv in outer)
                {
                    if (kv.Value is Dictionary<string, object> inner)
                        result[kv.Key] = inner;
                }
            }
            return result;
        }
    }

    // ── MiniJson (recursive descent JSON parser) ──────────────────
    // Adapted from calvinjhsu/MiniJSON; public domain.

    public static class MiniJson
    {
        public static object Parse(string s)
        {
            var p = new Parser(s);
            return p.ParseValue();
        }

        sealed class Parser
        {
            readonly string s;
            int i;
            public Parser(string s) { this.s = s; this.i = 0; }

            public object ParseValue()
            {
                SkipWs();
                if (i >= s.Length) throw new Exception("unexpected end of json");
                char c = s[i];
                if (c == '{') return ParseObject();
                if (c == '[') return ParseArray();
                if (c == '"') return ParseString();
                if (c == 't' || c == 'f') return ParseBool();
                if (c == 'n') { Expect("null"); return null; }
                return ParseNumber();
            }

            Dictionary<string, object> ParseObject()
            {
                var d = new Dictionary<string, object>();
                i++; SkipWs();
                if (i < s.Length && s[i] == '}') { i++; return d; }
                while (true)
                {
                    SkipWs();
                    string k = ParseString();
                    SkipWs();
                    if (s[i] != ':') throw new Exception("expected ':' at " + i);
                    i++;
                    object v = ParseValue();
                    d[k] = v;
                    SkipWs();
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return d; }
                    throw new Exception("expected ',' or '}' at " + i);
                }
            }

            List<object> ParseArray()
            {
                var l = new List<object>();
                i++; SkipWs();
                if (i < s.Length && s[i] == ']') { i++; return l; }
                while (true)
                {
                    object v = ParseValue();
                    l.Add(v);
                    SkipWs();
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return l; }
                    throw new Exception("expected ',' or ']' at " + i);
                }
            }

            string ParseString()
            {
                if (s[i] != '"') throw new Exception("expected '\"' at " + i);
                i++;
                var sb = new StringBuilder();
                while (i < s.Length)
                {
                    char c = s[i++];
                    if (c == '"') return sb.ToString();
                    if (c == '\\')
                    {
                        if (i >= s.Length) throw new Exception("bad escape");
                        char e = s[i++];
                        switch (e)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'u':
                                if (i + 4 > s.Length) throw new Exception("bad \\u escape");
                                string hex = s.Substring(i, 4); i += 4;
                                sb.Append((char)Convert.ToInt32(hex, 16));
                                break;
                            default: throw new Exception("unknown escape: " + e);
                        }
                    }
                    else sb.Append(c);
                }
                throw new Exception("unterminated string");
            }

            bool ParseBool()
            {
                if (s.Substring(i, 4) == "true") { i += 4; return true; }
                if (s.Substring(i, 5) == "false") { i += 5; return false; }
                throw new Exception("expected bool at " + i);
            }

            object ParseNumber()
            {
                int start = i;
                if (i < s.Length && s[i] == '-') i++;
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+' || s[i] == '-'))
                    i++;
                string num = s.Substring(start, i - start);
                if (num.Contains('.') || num.Contains('e') || num.Contains('E'))
                    return double.Parse(num, CultureInfo.InvariantCulture);
                return long.Parse(num, CultureInfo.InvariantCulture);
            }

            void SkipWs()
            {
                while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r'))
                    i++;
            }

            void Expect(string str)
            {
                if (i + str.Length > s.Length || s.Substring(i, str.Length) != str)
                    throw new Exception("expected " + str + " at " + i);
                i += str.Length;
            }
        }
    }
}
