package io.vreen.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class VreenPackTest {
    @Test
    fun `pack and unpack roundtrip preserves assets`() {
        val modelBytes = "fake GLB content".toByteArray()
        val texBytes = ByteArray(1024) { (it % 256).toByte() }
        val pack = Vreen.pack(Vreen.PackInput(
            name = "test",
            assetName = "robot.glb",
            scene = VreenScene(),
            assets = listOf(
                Vreen.AssetInput(kind = AssetKind.MODEL, data = modelBytes, originalName = "robot.glb"),
                Vreen.AssetInput(kind = AssetKind.TEXTURE, data = texBytes, originalName = "diffuse.png"),
            ),
        ))
        assertTrue(pack.bytes.size > 0, "zip should not be empty")
        assertEquals(2, pack.manifest.assets.size)
        assertEquals(AssetKind.MODEL, pack.manifest.primaryModelId?.let { id ->
            pack.manifest.assets.first { it.id == id }.kind
        })

        val unpacked = Vreen.unpack(pack.bytes)
        assertEquals(2, unpacked.manifest.assets.size)
        assertEquals(2, unpacked.assets.size, "all declared assets should have bytes")
        val modelEntry = unpacked.manifest.assets.first { it.kind == AssetKind.MODEL }
        val modelData = unpacked.assets[modelEntry.id]
        assertNotNull(modelData)
        assertEquals(modelBytes.size, modelData!!.size, "model byte count should match")
        assertArrayEquals(modelBytes, modelData)
    }

    @Test
    fun `validate passes for a fresh pack`() {
        val pack = Vreen.pack(Vreen.PackInput(
            name = "test",
            assetName = "x.glb",
            assets = listOf(Vreen.AssetInput(
                kind = AssetKind.MODEL, data = "abc".toByteArray(), originalName = "x.glb",
            )),
        ))
        val unpacked = Vreen.unpack(pack.bytes)
        val report = Vreen.validate(unpacked)
        assertTrue(report.ok, "freshly packed should validate: ${report.issues}")
        assertEquals(1, report.stats.modelCount)
    }

    @Test
    fun `validate detects sha256 mismatch`() {
        val pack = Vreen.pack(Vreen.PackInput(
            name = "test",
            assetName = "x.glb",
            assets = listOf(Vreen.AssetInput(
                kind = AssetKind.MODEL, data = "abc".toByteArray(), originalName = "x.glb",
            )),
        ))
        val unpacked = Vreen.unpack(pack.bytes)
        // corrupt the manifest's sha256
        val corrupted = unpacked.copy(
            manifest = unpacked.manifest.copy(
                assets = unpacked.manifest.assets.map { it.copy(sha256 = "0".repeat(64)) }
            )
        )
        val report = Vreen.validate(corrupted)
        assertFalse(report.ok)
        assertTrue(report.issues.any { it.code == "SHA256_MISMATCH" })
    }

    @Test
    fun `0_1_x plain json migrates to 0_2_x`() {
        val legacy = """
            {
              "version": "0.1.0",
              "assetName": "legacy.glb",
              "exportedAt": "2026-01-01T00:00:00.000Z",
              "camera": { "preset": "perspective" },
              "animation": { "speed": 1 },
              "environment": { "preset": "midnight" },
              "postFX": { "bloom": false },
              "materials": {}
            }
        """.trimIndent().toByteArray()
        val unpacked = Vreen.unpack(legacy)
        assertEquals(Versions.CURRENT, unpacked.manifest.version)
        assertEquals("legacy.glb", unpacked.manifest.assetName)
        assertEquals("perspective", unpacked.scene.camera["preset"])
    }

    @Test
    fun `diff produces added_modified_unchanged`() {
        val base = Vreen.pack(Vreen.PackInput(
            name = "v1", assetName = "x",
            assets = listOf(
                Vreen.AssetInput(id = "model-a", kind = AssetKind.MODEL, data = "a".toByteArray(), originalName = "m"),
                Vreen.AssetInput(id = "tex-t1", kind = AssetKind.TEXTURE, data = "t1".toByteArray(), originalName = "t1"),
            ),
        ))
        val head = Vreen.pack(Vreen.PackInput(
            name = "v2", assetName = "x",
            assets = listOf(
                Vreen.AssetInput(id = "model-a", kind = AssetKind.MODEL, data = "a".toByteArray(), originalName = "m"),
                Vreen.AssetInput(id = "tex-t1", kind = AssetKind.TEXTURE, data = "t1".toByteArray(), originalName = "t1"),
                Vreen.AssetInput(id = "tex-t2", kind = AssetKind.TEXTURE, data = "t2-new".toByteArray(), originalName = "t2"),
            ),
        ))
        val diff = VreenDiff.diff(Vreen.unpack(base.bytes), Vreen.unpack(head.bytes))
        assertEquals(1, diff.assets.count { it.status == AssetDiff.Status.ADDED })
        assertEquals(2, diff.assets.count { it.status == AssetDiff.Status.UNCHANGED })
    }
}
