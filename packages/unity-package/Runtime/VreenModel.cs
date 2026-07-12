// VreenModel.cs — pure C# data model mirroring io.vreen.core.model (Kotlin).
// Used by Unity / .NET runtimes. No external dependencies.

using System;
using System.Collections.Generic;

namespace Vreen
{
    public static class Versions
    {
        public const string Current = "0.2.1";
        public const string Legacy = "0.1.0";
        public const string World = "0.2.0";
    }

    public enum AssetKind
    {
        Model,
        Texture,
        Hdri,
        Audio,
    }

    [Serializable]
    public class VreenAssetEntry
    {
        public string id;
        public string kind;       // AssetKind string
        public string path;
        public long size;
        public string sha256;
        public string originalName;
        public Dictionary<string, object> meta;

        public AssetKind GetKind() => (AssetKind)Enum.Parse(typeof(AssetKind), kind, true);
    }

    [Serializable]
    public class VreenManifest
    {
        public string version = Versions.Current;
        public string exportedAt;
        public string name;
        public string assetName;
        public string generator;
        public VreenAssetEntry[] assets = Array.Empty<VreenAssetEntry>();
        public string primaryModelId; // null → empty
        public VreenWorldJson world;
    }

    [Serializable]
    public class VreenWorldJson
    {
        public string version = Versions.World;
        public string name;
        public long frame;
        public VreenEntityJson[] entities = Array.Empty<VreenEntityJson>();
    }

    [Serializable]
    public class VreenEntityJson
    {
        public long id;
        public string name;
        public VreenSceneNodeJson sceneNode;
        public VreenComponentJson[] components = Array.Empty<VreenComponentJson>();
    }

    [Serializable]
    public class VreenSceneNodeJson
    {
        public float[] position; // [x,y,z]
        public float[] rotation; // quaternion [x,y,z,w]
        public float[] scale;
    }

    [Serializable]
    public class VreenComponentJson
    {
        public string type;
        public Dictionary<string, object> data;
    }

    [Serializable]
    public class VreenScene
    {
        public string version = Versions.Current;
        public Dictionary<string, object> camera = new();
        public Dictionary<string, object> animation = new() { { "speed", 1.0 } };
        public Dictionary<string, object> environment = new()
        {
            { "preset", "midnight" }, { "exposure", 1.0 },
            { "background", "solid" }, { "backgroundColor", "#000000" },
        };
        public Dictionary<string, object> postFX = new()
        {
            { "bloom", false }, { "bloomIntensity", 0.0 },
            { "chromaticAberration", false }, { "vignette", false }, { "ssao", false },
        };
        public Dictionary<string, Dictionary<string, object>> materials = new();
    }

    public class UnpackedVreen
    {
        public VreenManifest manifest;
        public VreenScene scene;
        public Dictionary<string, byte[]> assets; // id → bytes
        public VreenWorldJson world;
    }

    public class VreenFormatError : Exception
    {
        public VreenFormatError(string message) : base(message) { }
        public VreenFormatError(string message, Exception inner) : base(message, inner) { }
    }
}
