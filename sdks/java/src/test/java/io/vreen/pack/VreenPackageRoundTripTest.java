package io.vreen.pack;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Round-trip test: build a {@code .vreen} package in memory, write it to a
 * temp file, read it back, verify all fields survive.
 *
 * Mirrors the web app's golden-path usage in {@code ViewerToolbar.exportProject}.
 */
class VreenPackageRoundTripTest {

    @Test
    void roundTrip(@TempDir Path tmp) throws IOException {
        // 1) Construct scene JSON inline (camera / env / postFX / materials).
        ObjectMapper m = new ObjectMapper();
        ObjectNode camera = m.createObjectNode()
                .put("preset", "iso")
                .put("fov", 45.0)
                .put("azimuth", 35.0)
                .put("elevation", 20.0)
                .put("distance", 4.0);
        ObjectNode environment = m.createObjectNode().put("ambient", 0.18).put("background", "#05070d");
        ObjectNode postFX = m.createObjectNode()
                .put("bloom", true)
                .put("bloomStrength", 0.6)
                .put("vignette", true);
        ObjectNode materials = m.createObjectNode();
        materials.putObject("default").put("metalness", 0.85).put("roughness", 0.35);
        VreenScene scene = VreenScene.builder()
                .camera(camera)
                .animationSpeed(1.0)
                .environment(environment)
                .postFX(postFX)
                .materials(materials)
                .build();

        // 2) Fake model bytes (would be the real .glb in production).
        byte[] modelBytes = "FAKE GLB BINARY".getBytes();

        // 3) Build manifest + asset map.
        VreenAssetEntry model = VreenAssetEntry.builder()
                .id("model-1")
                .kind(VreenAssetEntry.AssetKind.MODEL)
                .path("assets/avatar_a1b2c3.glb")
                .size(modelBytes.length)
                .originalName("avatar.glb")
                .sha256(VreenPackage.sha256Hex(modelBytes))
                .build();
        VreenManifest manifest = VreenManifest.builder()
                .name("test-project")
                .assetName("avatar")
                .addAsset(model)
                .primaryModelId("model-1")
                .build();
        Map<String, byte[]> assets = new LinkedHashMap<>();
        assets.put("model-1", modelBytes);

        // 4) Write to disk.
        Path file = tmp.resolve("test.vreen");
        VreenPackage.write(file, manifest, scene, assets);
        assertTrue(Files.exists(file), "package file should exist");
        assertTrue(Files.size(file) > 0, "package file should not be empty");

        // 5) Read it back.
        VreenPackage.ReadResult r = VreenPackage.read(file);
        assertFalse(r.legacy, "0.2.x manifest should not be legacy");
        assertEquals("test-project", r.manifest.name);
        assertEquals("avatar", r.manifest.assetName);
        assertEquals("model-1", r.manifest.primaryModelId);
        assertEquals(1, r.manifest.assets.size());
        assertEquals("model-1", r.manifest.assets.get(0).id);
        assertEquals(VreenAssetEntry.AssetKind.MODEL, r.manifest.assets.get(0).kind);
        assertEquals(modelBytes.length, r.manifest.assets.get(0).size);
        assertEquals(VreenPackage.sha256Hex(modelBytes), r.manifest.assets.get(0).sha256);

        // Scene round-trip
        assertEquals(VreenFormatVersion.CURRENT, r.scene.version);
        assertEquals(1.0, r.scene.animationSpeed, 1e-9);
        assertEquals("iso", r.scene.camera.get("preset").asText());
        assertEquals(45.0, r.scene.camera.get("fov").asDouble(), 1e-9);
        assertTrue(r.scene.postFX.get("bloom").asBoolean());
        assertEquals("default", r.scene.materials.fieldNames().next());

        // Asset bytes round-trip
        assertArrayEquals(modelBytes, r.assets.get("model-1"));
        assertEquals("assets/avatar_a1b2c3.glb", r.assetPaths.get("model-1"));
    }

    @Test
    void emptyPackage(@TempDir Path tmp) throws IOException {
        // No assets at all — just manifest + scene.
        ObjectMapper m = new ObjectMapper();
        VreenScene scene = VreenScene.builder()
                .camera(m.createObjectNode())
                .environment(m.createObjectNode())
                .postFX(m.createObjectNode())
                .materials(m.createObjectNode())
                .build();
        VreenManifest manifest = VreenManifest.builder()
                .name("empty")
                .assetName("nothing")
                .build();
        Path file = tmp.resolve("empty.vreen");
        VreenPackage.write(file, manifest, scene, new LinkedHashMap<>());
        VreenPackage.ReadResult r = VreenPackage.read(file);
        assertEquals("empty", r.manifest.name);
        assertEquals(0, r.manifest.assets.size());
    }

    @Test
    void missingAssetBytesThrows(@TempDir Path tmp) throws IOException {
        ObjectMapper m = new ObjectMapper();
        VreenScene scene = VreenScene.builder()
                .camera(m.createObjectNode())
                .environment(m.createObjectNode())
                .postFX(m.createObjectNode())
                .materials(m.createObjectNode())
                .build();
        VreenAssetEntry model = VreenAssetEntry.builder()
                .id("model-x")
                .kind(VreenAssetEntry.AssetKind.MODEL)
                .path("assets/x.glb")
                .size(10)
                .build();
        VreenManifest manifest = VreenManifest.builder()
                .name("bad")
                .assetName("bad")
                .addAsset(model)
                .primaryModelId("model-x")
                .build();
        Path file = tmp.resolve("bad.vreen");
        assertThrows(VreenPackageException.class,
                () -> VreenPackage.write(file, manifest, scene, new LinkedHashMap<>()));
    }
}
