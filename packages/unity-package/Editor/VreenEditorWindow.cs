// VreenEditorWindow.cs — Unity Editor utility for loading/validating .vreen files.
// Place under: Editor/ subfolder of your Unity project.
// Path in this package: packages/unity-package/Editor/VreenEditorWindow.cs

#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;
using Vreen;

namespace Vreen.EditorTools
{
    public class VreenEditorWindow : EditorWindow
    {
        [MenuItem("VREEN/Open Package…")]
        public static void Open() => GetWindow<VreenEditorWindow>("VREEN").Show();

        string lastPath = "";
        UnpackedVreen pkg;
        VreenLoader.ValidationReport report;

        void OnGUI()
        {
            GUILayout.Label("VREEN Package Inspector", EditorStyles.boldLabel);

            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Load .vreen…", GUILayout.Width(140)))
                {
                    string p = EditorUtility.OpenFilePanel("Open .vreen", "", "vreen");
                    if (!string.IsNullOrEmpty(p))
                    {
                        lastPath = p;
                        LoadAndValidate(p);
                    }
                }
                GUILayout.Label(lastPath);
            }

            if (pkg == null) return;
            var m = pkg.manifest;
            EditorGUILayout.Space();
            GUILayout.Label($"Manifest: {m.name} (v{m.version})", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("Asset name", m.assetName);
            EditorGUILayout.LabelField("Generator", m.generator);
            EditorGUILayout.LabelField("Exported at", m.exportedAt);
            EditorGUILayout.LabelField("Primary model id", m.primaryModelId ?? "—");
            EditorGUILayout.LabelField("Asset count", m.assets.Length.ToString());

            EditorGUILayout.Space();
            GUILayout.Label("Assets", EditorStyles.boldLabel);
            foreach (var a in m.assets)
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    EditorGUILayout.LabelField($"{a.id.Substring(0, 8)}…", GUILayout.Width(80));
                    EditorGUILayout.LabelField(a.kind, GUILayout.Width(60));
                    EditorGUILayout.LabelField(a.path);
                    EditorGUILayout.LabelField($"{a.size / 1024f:F1} KB", GUILayout.Width(80));
                }
            }

            EditorGUILayout.Space();
            GUILayout.Label("Validation", EditorStyles.boldLabel);
            if (report != null)
            {
                EditorGUILayout.LabelField("Status", report.ok ? "OK ✓" : "FAILED ✗");
                EditorGUILayout.LabelField("Issues", report.issues.Count.ToString());
                EditorGUILayout.LabelField("Models / Textures / HDRI / Audio",
                    $"{report.modelCount} / {report.textureCount} / {report.hdriCount} / {report.audioCount}");
                EditorGUILayout.LabelField("Entities", report.entityCount.ToString());
                if (GUILayout.Button("Re-validate"))
                {
                    if (!string.IsNullOrEmpty(lastPath)) LoadAndValidate(lastPath);
                }
            }
        }

        void LoadAndValidate(string path)
        {
            byte[] bytes = File.ReadAllBytes(path);
            try
            {
                pkg = VreenLoader.Unpack(bytes);
                report = VreenLoader.Validate(pkg);
                Debug.Log($"[VREEN] Loaded {path}: {report.modelCount} models, {report.issues.Count} issues");
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[VREEN] Failed to load {path}: {e.Message}");
            }
        }
    }
}
#endif
