package io.vreen.examples;

import io.vreen.pack.VreenAssetEntry;
import io.vreen.pack.VreenManifest;
import io.vreen.pack.VreenPackage;
import io.vreen.pack.VreenScene;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Standalone round-trip example — no test framework needed.
 *
 * Usage:
 * <pre>
 *   java -cp &lt;jackson jars&gt;:&lt;compiled classes&gt; \
 *        io.vreen.examples.RoundTripExample &lt;output.vreen&gt;
 * </pre>
 *
 * Writes a synthetic .vreen to the given path, then reads it back and prints
 * a human-readable summary so you can eyeball the package contents.
 */
public final class RoundTripExample {

    public static void main(String[] args) throws Exception {
        Path out = args.length > 0 ? Paths.get(args[0]) : Paths.get("demo.vreen");

        ObjectMapper m = new ObjectMapper();
        ObjectNode camera = m.createObjectNode()
                .put("preset", "iso")
                .put("fov", 45.0);
        ObjectNode environment = m.createObjectNode().put("ambient", 0.18);
        ObjectNode postFX = m.createObjectNode().put("bloom", true);
        ObjectNode materials = m.createObjectNode();
        VreenScene scene = VreenScene.builder()
                .camera(camera)
                .environment(environment)
                .postFX(postFX)
                .materials(materials)
                .build();

        byte[] model = "synthetic glb content".getBytes();
        VreenAssetEntry asset = VreenAssetEntry.builder()
                .id("model-1")
                .kind(VreenAssetEntry.AssetKind.MODEL)
                .path("assets/avatar.glb")
                .size(model.length)
                .sha256(VreenPackage.sha256Hex(model))
                .build();
        VreenManifest manifest = VreenManifest.builder()
                .name("demo")
                .assetName("avatar")
                .addAsset(asset)
                .primaryModelId("model-1")
                .build();
        Map<String, byte[]> assets = new LinkedHashMap<>();
        assets.put("model-1", model);

        // Write
        VreenPackage.write(out, manifest, scene, assets);
        System.out.println("Wrote " + out.toAbsolutePath() + " (" +
                java.nio.file.Files.size(out) + " bytes)");

        // Read back
        VreenPackage.ReadResult r = VreenPackage.read(out);
        System.out.println("Read back manifest:");
        System.out.println("  name        = " + r.manifest.name);
        System.out.println("  assetName   = " + r.manifest.assetName);
        System.out.println("  generator   = " + r.manifest.generator);
        System.out.println("  exportedAt  = " + r.manifest.exportedAt);
        System.out.println("  primary     = " + r.manifest.primaryModelId);
        System.out.println("  assets      = " + r.manifest.assets.size());
        for (VreenAssetEntry a : r.manifest.assets) {
            System.out.println("    - " + a.id + " (" + a.kind + ", " + a.size + " bytes, " + a.path + ")");
        }
        System.out.println("  scene.camera.preset = " + r.scene.camera.get("preset").asText());
        System.out.println("  scene.animationSpeed = " + r.scene.animationSpeed);
        System.out.println("  scene.postFX.bloom = " + r.scene.postFX.get("bloom").asBoolean());
        System.out.println("Round-trip OK.");
    }

    private RoundTripExample() {
    }
}
