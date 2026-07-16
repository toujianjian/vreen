package io.vreen.core

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.vreen.core.model.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Delta creation for .vreen packages.
 *
 * A `.vreen-delta` is a ZIP containing only the changes from a known base
 * to a known head, plus enough metadata (delta.json + head manifest + head
 * scene + head world) to reconstruct the head when applied.
 *
 * Mirrors `createVreenDelta()` in `src/lib/vreenDiff.ts`.
 */
object VreenDelta {
    private val JSON = ObjectMapper().registerKotlinModule()

    data class Result(
        val bytes: ByteArray,
        val entries: Map<String, Int>,
        val deltaBytes: Long,
        val savingsRatio: Double,
    )

    /**
     * Build a .vreen-delta from a base / head pair and the [PackageDiff]
     * produced by [VreenDiff.diff].
     */
    fun create(base: UnpackedVreen, head: UnpackedVreen, diff: PackageDiff): Result {
        val entries = LinkedHashMap<String, ByteArray>()

        // 1) delta.json — structured change set (matches TypeScript shape verbatim)
        val deltaDoc = LinkedHashMap<String, Any?>()
        deltaDoc["version"] = Versions.CURRENT
        deltaDoc["type"] = "delta"
        deltaDoc["baseExportedAt"] = base.manifest.exportedAt
        deltaDoc["headExportedAt"] = head.manifest.exportedAt
        deltaDoc["baseAssetName"] = base.manifest.assetName
        deltaDoc["headAssetName"] = head.manifest.assetName
        deltaDoc["basePrimaryModelId"] = base.manifest.primaryModelId
        deltaDoc["headPrimaryModelId"] = head.manifest.primaryModelId
        deltaDoc["sceneChanged"] = diff.sceneChanged
        deltaDoc["worldChanged"] = diff.worldChanged
        deltaDoc["primaryModelChanged"] = diff.primaryModelChanged
        deltaDoc["assets"] = diff.assets.map { ad ->
            LinkedHashMap<String, Any?>().apply {
                put("id", ad.id)
                put("kind", ad.kind.name.lowercase())
                put("path", ad.path)
                put("status", ad.status.name.lowercase())
                ad.baseSha256?.let { put("baseSha256", it) }
                ad.headSha256?.let { put("headSha256", it) }
                ad.baseSize?.let { put("baseSize", it) }
                ad.headSize?.let { put("headSize", it) }
                ad.originalName?.let { put("originalName", it) }
            }
        }
        entries["delta.json"] = JSON.writeValueAsBytes(deltaDoc)

        // 2) head scene + head manifest with delta annotation
        entries["scene.json"] = JSON.writeValueAsBytes(head.scene)

        val changedIds = diff.assets
            .filter { it.status == AssetDiff.Status.ADDED || it.status == AssetDiff.Status.MODIFIED }
            .map { it.id }
        val removedIds = diff.assets
            .filter { it.status == AssetDiff.Status.REMOVED }
            .map { it.id }

        val deltaAnnotation = LinkedHashMap<String, Any?>()
        deltaAnnotation["baseExportedAt"] = base.manifest.exportedAt
        deltaAnnotation["deltaBytes"] = diff.deltaBytes
        deltaAnnotation["fullBytes"] = diff.fullBytes
        deltaAnnotation["savingsRatio"] = diff.savingsRatio
        deltaAnnotation["changedAssetIds"] = changedIds
        deltaAnnotation["removedAssetIds"] = removedIds

        // The delta manifest is the head manifest + type=delta + delta metadata
        val deltaManifest = LinkedHashMap<String, Any?>()
        deltaManifest["version"] = head.manifest.version
        deltaManifest["exportedAt"] = head.manifest.exportedAt
        deltaManifest["name"] = head.manifest.name
        deltaManifest["assetName"] = head.manifest.assetName
        deltaManifest["generator"] = head.manifest.generator
        deltaManifest["primaryModelId"] = head.manifest.primaryModelId
        deltaManifest["assets"] = head.manifest.assets
        deltaManifest["type"] = "delta"
        deltaManifest["delta"] = deltaAnnotation
        entries["manifest.json"] = JSON.writeValueAsBytes(deltaManifest)

        // 3) head world.json if present
        head.world?.let { entries["world.json"] = JSON.writeValueAsBytes(it) }

        // 4) add/modify asset bytes
        for (ad in diff.assets) {
            if (ad.status != AssetDiff.Status.ADDED && ad.status != AssetDiff.Status.MODIFIED) continue
            val data = head.assets[ad.id]
            if (data == null) continue
            entries[ad.path] = data
        }

        val zipped = zip(entries)
        val sizeMap = entries.mapValues { it.value.size }
        return Result(
            bytes = zipped,
            entries = sizeMap,
            deltaBytes = diff.deltaBytes,
            savingsRatio = diff.savingsRatio,
        )
    }

    /**
     * Convenience: apply a delta zip to a base and re-pack into a full .vreen.
     * Mirrors `applyDeltaThenPack()` in `src/lib/vreenDiff.ts`.
     */
    fun applyThenPack(
        base: UnpackedVreen,
        deltaBytes: ByteArray,
        generator: String = "vreen-core ${Versions.CURRENT}",
    ): Vreen.PackResult {
        val applied = VreenDiff.apply(base, deltaBytes)
        val head = applied.head
        val assets = head.manifest.assets.mapNotNull { a ->
            val data = head.assets[a.id] ?: return@mapNotNull null
            Vreen.AssetInput(
                id = a.id,
                kind = a.kind,
                data = data,
                originalName = a.originalName,
                sha256 = a.sha256,
                meta = a.meta,
            )
        }
        return Vreen.pack(
            Vreen.PackInput(
                name = head.manifest.name,
                assetName = head.manifest.assetName,
                scene = head.scene,
                assets = assets,
                primaryModelId = head.manifest.primaryModelId,
                world = head.world,
                generator = generator,
            )
        )
    }

    // ── ZIP helpers (kept local; mirror Vreen.kt) ─────────────────────

    private fun zip(entries: Map<String, ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zos ->
            entries.forEach { (name, data) ->
                zos.putNextEntry(ZipEntry(name))
                zos.write(data)
                zos.closeEntry()
            }
        }
        return out.toByteArray()
    }
}
