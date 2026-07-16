package io.vreen.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class VreenDeltaTest {
    private fun pack(name: String, assets: List<Vreen.AssetInput>): Vreen.PackResult =
        Vreen.pack(Vreen.PackInput(name = name, assetName = name, assets = assets))

    @Test
    fun `delta roundtrip preserves all add modify remove states`() {
        val base = pack("v1", listOf(
            Vreen.AssetInput(id = "model-a", kind = AssetKind.MODEL, data = "model-a".toByteArray(), originalName = "a.glb"),
            Vreen.AssetInput(id = "tex-keep", kind = AssetKind.TEXTURE, data = "tex-keep".toByteArray(), originalName = "t-keep.png"),
            Vreen.AssetInput(id = "tex-rm", kind = AssetKind.TEXTURE, data = "tex-rm".toByteArray(), originalName = "t-rm.png"),
        ))
        val head = pack("v2", listOf(
            Vreen.AssetInput(id = "model-a", kind = AssetKind.MODEL, data = "model-a".toByteArray(), originalName = "a.glb"),
            Vreen.AssetInput(id = "tex-keep", kind = AssetKind.TEXTURE, data = "tex-keep".toByteArray(), originalName = "t-keep.png"),
            Vreen.AssetInput(id = "tex-rm", kind = AssetKind.TEXTURE, data = "tex-mod".toByteArray(), originalName = "t-mod.png"),
            Vreen.AssetInput(id = "tex-new", kind = AssetKind.TEXTURE, data = "tex-new".toByteArray(), originalName = "t-new.png"),
        ))
        val baseU = Vreen.unpack(base.bytes)
        val headU = Vreen.unpack(head.bytes)

        val diff = VreenDiff.diff(baseU, headU)
        val added = diff.assets.count { it.status == AssetDiff.Status.ADDED }
        val modified = diff.assets.count { it.status == AssetDiff.Status.MODIFIED }
        val removed = diff.assets.count { it.status == AssetDiff.Status.REMOVED }
        assertEquals(1, added, "should detect 1 added (t-new)")
        assertEquals(1, modified, "should detect 1 modified (t-rm → t-mod)")
        assertEquals(0, removed, "head should not remove anything")
        // unchanged model + t-keep
        assertEquals(2, diff.assets.count { it.status == AssetDiff.Status.UNCHANGED })

        val delta = VreenDelta.create(baseU, headU, diff)
        assertTrue(delta.bytes.isNotEmpty())
        // delta should not contain unchanged asset bytes
        assertFalse(delta.entries.keys.any { it.endsWith("tex-keep.png") || it.endsWith("a.glb") })

        // apply → repack
        val applied = VreenDelta.applyThenPack(baseU, delta.bytes)
        val finalU = Vreen.unpack(applied.bytes)
        assertEquals(headU.manifest.assets.size, finalU.manifest.assets.size)
        for (a in headU.manifest.assets) {
            val headData = headU.assets[a.id]
            val finalData = finalU.assets[a.id]
            assertNotNull(finalData, "head asset ${a.id} missing in applied")
            assertArrayEquals(headData, finalData, "applied asset ${a.id} bytes differ from head")
        }
    }

    @Test
    fun `delta with removal correctly omits removed assets on apply`() {
        val base = pack("v1", listOf(
            Vreen.AssetInput(id = "model-a", kind = AssetKind.MODEL, data = "model-a".toByteArray(), originalName = "a.glb"),
            Vreen.AssetInput(id = "tex-rm", kind = AssetKind.TEXTURE, data = "tex-rm".toByteArray(), originalName = "t-rm.png"),
        ))
        val head = pack("v2", listOf(
            Vreen.AssetInput(id = "model-a", kind = AssetKind.MODEL, data = "model-a".toByteArray(), originalName = "a.glb"),
        ))
        val baseU = Vreen.unpack(base.bytes)
        val headU = Vreen.unpack(head.bytes)
        val diff = VreenDiff.diff(baseU, headU)
        assertEquals(1, diff.assets.count { it.status == AssetDiff.Status.REMOVED })

        val delta = VreenDelta.create(baseU, headU, diff)
        val applied = VreenDelta.applyThenPack(baseU, delta.bytes)
        val finalU = Vreen.unpack(applied.bytes)
        assertEquals(1, finalU.manifest.assets.size, "only the model should remain after remove")
        assertEquals(AssetKind.MODEL, finalU.manifest.assets[0].kind)
    }

    @Test
    fun `delta bytes are smaller than full head when most assets unchanged`() {
        val largeKeep = ByteArray(64 * 1024) { 0x42 }
        val smallChange = ByteArray(64) { 0x11 }
        val base = pack("v1", listOf(
            Vreen.AssetInput(id = "k", kind = AssetKind.MODEL, data = largeKeep, originalName = "k.glb"),
            Vreen.AssetInput(id = "t", kind = AssetKind.TEXTURE, data = smallChange, originalName = "t.png"),
        ))
        val head = pack("v2", listOf(
            Vreen.AssetInput(id = "k", kind = AssetKind.MODEL, data = largeKeep, originalName = "k.glb"),
            Vreen.AssetInput(id = "t", kind = AssetKind.TEXTURE, data = ByteArray(80) { 0x22 }, originalName = "t.png"),
        ))
        val diff = VreenDiff.diff(Vreen.unpack(base.bytes), Vreen.unpack(head.bytes))
        val delta = VreenDelta.create(Vreen.unpack(base.bytes), Vreen.unpack(head.bytes), diff)
        // savings ratio should be > 0 (some assets unchanged)
        assertTrue(delta.savingsRatio > 0.0, "savingsRatio should be > 0, got ${delta.savingsRatio}")
    }

    @Test
    fun `delta entry list contains scene manifest and only changed assets`() {
        val base = pack("v1", listOf(
            Vreen.AssetInput(id = "m", kind = AssetKind.MODEL, data = "m".toByteArray(), originalName = "m.glb"),
        ))
        val head = pack("v2", listOf(
            Vreen.AssetInput(id = "m", kind = AssetKind.MODEL, data = "m".toByteArray(), originalName = "m.glb"),
            Vreen.AssetInput(id = "t", kind = AssetKind.TEXTURE, data = "t-new".toByteArray(), originalName = "t.png"),
        ))
        val baseU = Vreen.unpack(base.bytes)
        val headU = Vreen.unpack(head.bytes)
        val diff = VreenDiff.diff(baseU, headU)
        val delta = VreenDelta.create(baseU, headU, diff)
        assertTrue(delta.entries.containsKey("delta.json"))
        assertTrue(delta.entries.containsKey("scene.json"))
        assertTrue(delta.entries.containsKey("manifest.json"))
        // only the new asset should be inside
        assertEquals(1, delta.entries.keys.count { it.startsWith("assets/") })
    }
}
