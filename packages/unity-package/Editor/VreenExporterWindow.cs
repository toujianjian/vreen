// VreenExporterWindow.cs — Editor UI for exporting the active scene to .vreen.
//
// Adds a "VREEN → Export Active Scene to .vreen…" menu item and a dock-able
// inspector window with options. The actual scene walk + pack logic lives in
// VreenExporter.cs (kept separate so it can be invoked headlessly from build
// scripts).

#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Vreen.EditorTools
{
    public class VreenExporterWindow : EditorWindow
    {
        [MenuItem("VREEN/Export Active Scene to .vreen…")]
        public static void ExportFromMenu()
        {
            // If window is open, use its options; otherwise prompt.
            var win = GetWindow<VreenExporterWindow>("VREEN Export");
            win.ExportWithDialog();
        }

        [MenuItem("VREEN/Open Export Window")]
        public static void OpenWindow() => GetWindow<VreenExporterWindow>("VREEN Export").Show();

        // ── Options (serialized via EditorPrefs for the session) ─────
        string name = "Unity Scene";
        string assetName = "";
        bool includeWorld = true;
        bool useSceneDirectory = true;
        bool embedPbrMaterials = true;
        int textureQualityHint = 100;

        Vector2 scroll;
        VreenExporter.Report lastReport;

        void OnGUI()
        {
            GUILayout.Label("VREEN Active-Scene Exporter", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Exports the active Unity scene to a .vreen package.\n" +
                "• Models  →  vmesh JSON (§14.2 in the format spec)\n" +
                "• Textures  →  PNG (read via ImageConversion.EncodeToPNG)\n" +
                "• Materials  →  scene.materials (PBR)\n" +
                "• Audio  →  vreen-audio-stub JSON (no OGG encoder available)\n" +
                "• World  →  per-GameObject entity tree with MonoBehaviour fields",
                MessageType.Info);

            scroll = EditorGUILayout.BeginScrollView(scroll);

            EditorGUILayout.Space();
            GUILayout.Label("Project", EditorStyles.boldLabel);
            name = EditorGUILayout.TextField("Name", name);
            assetName = EditorGUILayout.TextField("Asset name", assetName);

            EditorGUILayout.Space();
            GUILayout.Label("Capture", EditorStyles.boldLabel);
            includeWorld = EditorGUILayout.Toggle("Include ECS World", includeWorld);
            embedPbrMaterials = EditorGUILayout.Toggle("Embed PBR materials", embedPbrMaterials);
            textureQualityHint = EditorGUILayout.IntSlider("Texture hint (0-100)", textureQualityHint, 0, 100);
            useSceneDirectory = EditorGUILayout.Toggle("Output next to .unity file", useSceneDirectory);

            EditorGUILayout.Space();
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Export", GUILayout.Height(28)))
                {
                    ExportWithDialog();
                }
                if (GUILayout.Button("Open last output", GUILayout.Height(28), GUILayout.Width(140)))
                {
                    OpenLastOutput();
                }
            }

            if (lastReport != null)
            {
                EditorGUILayout.Space();
                GUILayout.Label("Result", EditorStyles.boldLabel);
                if (lastReport.ok)
                {
                    EditorGUILayout.HelpBox(
                        $"Wrote {lastReport.outputPath}\n" +
                        $"meshes={lastReport.meshCount}, materials={lastReport.materialCount}, " +
                        $"textures={lastReport.textureCount}, audio={lastReport.audioCount}, " +
                        $"entities={lastReport.entityCount}, bytes={lastReport.totalBytes}",
                        MessageType.Info);
                }
                else
                {
                    EditorGUILayout.HelpBox($"Export failed: {lastReport.error}", MessageType.Error);
                }
            }

            EditorGUILayout.EndScrollView();
        }

        // ── Actions ───────────────────────────────────────────────────

        public void ExportWithDialog()
        {
            // Resolve path: if useSceneDirectory is false, ask the user.
            string outPath = null;
            if (!useSceneDirectory)
            {
                var defaultName = string.IsNullOrEmpty(assetName) ? "scene.vreen" : (assetName + ".vreen");
                outPath = EditorUtility.SaveFilePanel("Export .vreen", "", defaultName, "vreen");
                if (string.IsNullOrEmpty(outPath))
                {
                    Debug.Log("[VREEN] Export cancelled");
                    return;
                }
            }

            var opts = new VreenExporter.Options
            {
                name = name,
                assetName = assetName,
                includeWorld = includeWorld,
                useSceneDirectory = useSceneDirectory,
                textureQualityHint = textureQualityHint,
            };

            lastReport = VreenExporter.ExportActiveScene(opts);
            // If user picked a path and the report didn't override, save there.
            if (lastReport.ok && outPath != null && lastReport.outputPath != outPath)
            {
                File.Copy(lastReport.outputPath, outPath, true);
                lastReport.outputPath = outPath;
            }
            Repaint();
        }

        void OpenLastOutput()
        {
            if (lastReport == null || string.IsNullOrEmpty(lastReport.outputPath) || !File.Exists(lastReport.outputPath))
            {
                EditorUtility.DisplayDialog("VREEN", "No export yet or file moved.", "OK");
                return;
            }
            EditorUtility.RevealInFinder(lastReport.outputPath);
        }
    }
}
#endif
