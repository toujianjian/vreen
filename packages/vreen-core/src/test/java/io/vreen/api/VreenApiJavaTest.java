package io.vreen.api;

import io.vreen.core.ApplyResult;
import io.vreen.core.AssetKind;
import io.vreen.core.PackageDiff;
import io.vreen.core.UnpackedVreen;
import io.vreen.core.ValidationReport;
import io.vreen.core.Vmesh;
import io.vreen.core.VreenManifest;
import io.vreen.core.VreenRegistry;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Proves the {@link VreenApi} facade (and its builders) is directly callable
 * from pure Java: static entry points, builder chaining, and boxed core types.
 */
class VreenApiJavaTest {

    @Test
    void roundTripFromJava() {
        byte[] model = "fake-glb-bytes".getBytes(StandardCharsets.UTF_8);

        // Build a package entirely through the Java-friendly API.
        byte[] pkg = VreenApi.pack(
            VreenApi.newPack()
                .name("java-demo")
                .assetName("robot.glb")
                .generator("vreen-api-java-test")
                .addAsset(
                    VreenApi.newAsset()
                        .kind(AssetKind.MODEL)
                        .originalName("robot.glb")
                        .data(model)
                        .build()));

        assertNotNull(pkg);
        assertTrue(pkg.length > 0);

        // Unpack through the facade.
        UnpackedVreen head = VreenApi.unpack(pkg);
        assertEquals("java-demo", head.getManifest().getName());
        assertEquals("robot.glb", head.getManifest().getAssetName());
        assertTrue(head.getAssets().containsKey(head.getManifest().getPrimaryModelId()));

        // Validate through the facade.
        ValidationReport report = VreenApi.validate(head);
        assertTrue(report.getOk(), "expected a clean report: " + report.getIssues());

        // A valid delta against a second head must apply cleanly.
        byte[] head2 = VreenApi.pack(
            VreenApi.newPack()
                .name("java-demo")
                .assetName("robot.glb")
                .addAsset(
                    VreenApi.newAsset()
                        .kind(AssetKind.MODEL)
                        .id(head.getManifest().getPrimaryModelId())
                        .originalName("robot.glb")
                        .data("changed-glb-bytes".getBytes(StandardCharsets.UTF_8))
                        .build()));

        UnpackedVreen head2Unpacked = VreenApi.unpack(head2);
        PackageDiff diff = VreenApi.diff(head, head2Unpacked);
        assertTrue(diff.getPrimaryModelChanged() || !diff.getAssets().isEmpty());

        // Build a real .vreen-delta from the base / head pair, then apply it.
        byte[] delta = VreenApi.createDelta(head, head2Unpacked, diff);
        ApplyResult applied = VreenApi.applyDelta(head, delta);
        assertNotNull(applied.getHead());
        assertTrue(applied.getAppliedModifies() > 0 || applied.getAppliedAdds() > 0);
    }

    @Test
    void packWithManifestAndSceneFromJava() {
        // A scene built with the SceneBuilder, itself wrapped in a JSON-friendly
        // camera field.
        byte[] model = {1, 2, 3};
        io.vreen.core.Vreen.PackResult result = VreenApi.packWithManifest(
            VreenApi.newPack()
                .name("scene-demo")
                .assetName("plane.vmesh")
                .scene(
                    VreenApi.newScene()
                        .cameraJson("{\"preset\":\"perspective\",\"fov\":55.0}")
                        .material("mat-1", Map.of("baseColor", "#ff0000"))
                        .build())
                .addAsset(VreenApi.newAsset().kind(AssetKind.MODEL).data(model).build()));

        VreenManifest manifest = result.getManifest();
        assertEquals("scene-demo", manifest.getName());

        UnpackedVreen head = VreenApi.unpack(result.getBytes());
        Object cameraFov = head.getScene().getCamera().get("fov");
        assertEquals(55.0, (Double) cameraFov, 0.001);
    }

    @Test
    void vmeshAndHashingFromJava() {
        Vmesh.Document doc = VreenApi.vmeshQuad("plane", 1.0f, "mat-default");
        byte[] json = VreenApi.vmeshToJson(doc);
        Vmesh.Document parsed = VreenApi.vmeshFromJson(json);
        assertEquals(doc, parsed);

        byte[] data = "hello".getBytes(StandardCharsets.UTF_8);
        assertEquals(
            VreenApi.sha256Hex(data),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        assertEquals(64, VreenApi.sha256Hex(data).length());
    }

    @Test
    void registryFromJava() {
        io.vreen.core.VreenRegistry.Index index = VreenApi.loadRegistryJson(
            "{\"version\":\"1.0.0\",\"generatedAt\":\"2026-01-01T00:00:00Z\"," +
            "\"packages\":[" +
            "{\"id\":\"p1\",\"name\":\"pkg1\",\"latest\":\"1.2.0\"," +
            "\"versions\":[{\"version\":\"1.0.0\",\"releasedAt\":\"2026-01-01\"," +
            "\"downloadUrl\":\"{baseUrl}/p1/1.0.0.vreen\",\"size\":1,\"sha256\":\"00\"}]}," +
            "{\"id\":\"p2\",\"name\":\"pkg2\",\"latest\":\"2.0.0\"," +
            "\"versions\":[{\"version\":\"2.0.0\",\"releasedAt\":\"2026-01-01\"," +
            "\"downloadUrl\":\"{baseUrl}/p2/2.0.0.vreen\",\"size\":1,\"sha256\":\"00\"}]}" +
            "]}" );

        VreenRegistry.Package pkg = VreenApi.findPackage(index, "p1");
        assertNotNull(pkg);
        VreenRegistry.Version v = VreenApi.resolveVersion(pkg, "^1.0.0");
        assertNotNull(v);
        assertEquals("1.0.0", v.getVersion());
        assertEquals("/p1/1.0.0.vreen", VreenApi.resolveDownloadUrl(v, ""));

        assertTrue(VreenApi.compareSemver("1.2.0", "1.1.9") > 0);
        assertTrue(VreenApi.filterByTag(index, "x").isEmpty());
    }
}