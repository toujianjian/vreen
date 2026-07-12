package io.vreen.core

import io.vreen.core.model.*
import java.time.Instant

/** Structured asset diff entry. */
data class AssetDiff(
    val id: String,
    val kind: AssetKind,
    val path: String,
    val status: Status,
    val baseSha256: String? = null,
    val headSha256: String? = null,
    val baseSize: Long? = null,
    val headSize: Long? = null,
    val originalName: String? = null,
) {
    enum class Status { ADDED, MODIFIED, REMOVED, UNCHANGED }
}

/** Full diff result. */
data class PackageDiff(
    val baseManifestVersion: String,
    val headManifestVersion: String,
    val baseAssetName: String,
    val headAssetName: String,
    val baseExportedAt: String,
    val headExportedAt: String,
    val assets: List<AssetDiff>,
    val sceneChanged: Boolean,
    val worldChanged: Boolean,
    val primaryModelChanged: Boolean,
    val deltaBytes: Long,
    val fullBytes: Long,
) {
    val savingsRatio: Double get() = if (fullBytes > 0) 1.0 - deltaBytes.toDouble() / fullBytes else 0.0
}

/** Delta apply result. */
data class ApplyResult(
    val head: UnpackedVreen,
    val appliedAdds: Int,
    val appliedModifies: Int,
    val appliedRemoves: Int,
)

/** Compute a diff between two unpacked packages. */
object VreenDiff {
    fun diff(base: UnpackedVreen, head: UnpackedVreen): PackageDiff {
        val baseById = base.manifest.assets.associateBy { it.id }
        val headById = head.manifest.assets.associateBy { it.id }
        val diffs = mutableListOf<AssetDiff>()
        var deltaBytes = 0L
        var fullBytes = 0L

        // full size: both sides
        base.manifest.assets.forEach { a -> base.assets[a.id]?.size?.toLong()?.let { fullBytes += it } }
        head.manifest.assets.forEach { a -> head.assets[a.id]?.size?.toLong()?.let { fullBytes += it } }
        // + scene + world json
        fullBytes += sceneSize(base.scene) + sceneSize(head.scene)
        base.world?.let { fullBytes += worldSize(it) }
        head.world?.let { fullBytes += worldSize(it) }

        val allIds = baseById.keys + headById.keys
        for (id in allIds) {
            val b = baseById[id]
            val h = headById[id]
            when {
                b != null && h == null -> {
                    diffs.add(AssetDiff(id, b.kind, b.path, AssetDiff.Status.REMOVED,
                        baseSha256 = b.sha256, baseSize = b.size, originalName = b.originalName))
                }
                b == null && h != null -> {
                    val size = h.size
                    diffs.add(AssetDiff(id, h.kind, h.path, AssetDiff.Status.ADDED,
                        headSha256 = h.sha256, headSize = size, originalName = h.originalName))
                    deltaBytes += size
                }
                b != null && h != null -> {
                    val baseData = base.assets[id]
                    val headData = head.assets[id]
                    val baseHash = b.sha256 ?: baseData?.let { Hashing.sha256Hex(it) }
                    val headHash = h.sha256 ?: headData?.let { Hashing.sha256Hex(it) }
                    if (baseHash != null && baseHash == headHash) {
                        diffs.add(AssetDiff(id, h.kind, h.path, AssetDiff.Status.UNCHANGED,
                            baseSha256 = baseHash, headSha256 = headHash,
                            baseSize = b.size, headSize = h.size, originalName = h.originalName))
                    } else {
                        val size = h.size
                        diffs.add(AssetDiff(id, h.kind, h.path, AssetDiff.Status.MODIFIED,
                            baseSha256 = baseHash, headSha256 = headHash,
                            baseSize = b.size, headSize = size, originalName = h.originalName))
                        deltaBytes += size
                    }
                }
            }
        }

        val sceneChanged = sceneEquals(base.scene, head.scene)
        val worldChanged = worldEquals(base.world, head.world)
        val primaryChanged = base.manifest.primaryModelId != head.manifest.primaryModelId

        return PackageDiff(
            baseManifestVersion = base.manifest.version,
            headManifestVersion = head.manifest.version,
            baseAssetName = base.manifest.assetName,
            headAssetName = head.manifest.assetName,
            baseExportedAt = base.manifest.exportedAt,
            headExportedAt = head.manifest.exportedAt,
            assets = diffs,
            sceneChanged = sceneChanged,
            worldChanged = worldChanged,
            primaryModelChanged = primaryChanged,
            deltaBytes = deltaBytes,
            fullBytes = fullBytes,
        )
    }

    /**
     * Apply a delta zip to a base. Returns a fresh UnpackedVreen.
     * Mirrors applyVreenDelta() in src/lib/vreenDiff.ts.
     */
    fun apply(base: UnpackedVreen, deltaBytes: ByteArray): ApplyResult {
        val entries = unzipAll(deltaBytes)
        val deltaJson = entries["delta.json"]
            ?: throw VreenFormatError("not a valid .vreen-delta: missing delta.json")
        val doc = com.fasterxml.jackson.databind.ObjectMapper().readValue(
            deltaJson,
            DeltaDoc::class.java,
        )
        if (doc.type != "delta") {
            throw VreenFormatError("not a valid .vreen-delta: type=${doc.type}")
        }
        val headManifestJson = entries["manifest.json"]
            ?: throw VreenFormatError("delta missing manifest.json")
        val headSceneJson = entries["scene.json"]
            ?: throw VreenFormatError("delta missing scene.json")
        val headWorldJson = entries["world.json"]

        val mapper = com.fasterxml.jackson.databind.ObjectMapper().registerKotlinModule()
        val headManifest = mapper.readValue(headManifestJson, VreenManifest::class.java)
        val headScene = mapper.readValue(headSceneJson, VreenScene::class.java)
        val headWorld = headWorldJson?.let { mapper.readValue(it, VreenWorldJson::class.java) }

        val diffsById = doc.assets.associateBy { it.id }
        val baseById = base.manifest.assets.associateBy { it.id }

        val newAssets = HashMap<String, ByteArray>()
        val newManifestAssets = mutableListOf<VreenAssetEntry>()
        var adds = 0; var mods = 0; var removes = 0

        for (id in (baseById.keys + diffsById.keys)) {
            val b = baseById[id]
            val d = diffsById[id]
            when {
                b != null && (d == null || d.status == "unchanged") -> {
                    base.assets[id]?.let {
                        newAssets[id] = it
                        newManifestAssets.add(b)
                    }
                }
                b != null && d?.status == "removed" -> { removes++ }
                b != null && d?.status == "modified" -> {
                    val data = entries[d.path] ?: throw VreenFormatError("delta missing modified asset $id")
                    newAssets[id] = data
                    newManifestAssets.add(b.copy(
                        sha256 = d.headSha256,
                        size = d.headSize ?: data.size.toLong(),
                    ))
                    mods++
                }
                b == null && d != null && (d.status == "added" || d.status == "modified") -> {
                    val data = entries[d.path] ?: throw VreenFormatError("delta missing added asset $id")
                    newAssets[id] = data
                    newManifestAssets.add(VreenAssetEntry(
                        id = d.id, kind = AssetKind.fromString(d.kind),
                        path = d.path, size = data.size.toLong(),
                        sha256 = d.headSha256, originalName = d.originalName,
                    ))
                    adds++
                }
            }
        }

        return ApplyResult(
            head = UnpackedVreen(headManifest, headScene, newAssets, headWorld),
            appliedAdds = adds, appliedModifies = mods, appliedRemoves = removes,
        )
    }

    // helpers
    private fun sceneSize(s: VreenScene) = 256L // approx
    private fun worldSize(w: VreenWorldJson) = 256L + w.entities.size * 64L
    private fun sceneEquals(a: VreenScene, b: VreenScene) = a == b
    private fun worldEquals(a: VreenWorldJson?, b: VreenWorldJson?) = a == b

    private fun unzipAll(bytes: ByteArray): Map<String, ByteArray> {
        val out = LinkedHashMap<String, ByteArray>()
        java.util.zip.ZipInputStream(java.io.ByteArrayInputStream(bytes)).use { zis ->
            while (true) {
                val e = zis.nextEntry ?: break
                out[e.name] = zis.readBytes()
                zis.closeEntry()
            }
        }
        return out
    }

    private data class DeltaDoc(
        val version: String,
        val type: String,
        val assets: List<AssetDiffDoc>,
        val headExportedAt: String,
        val headAssetName: String,
        val headPrimaryModelId: String?,
        val sceneChanged: Boolean,
        val worldChanged: Boolean,
        val primaryModelChanged: Boolean,
    )

    private data class AssetDiffDoc(
        val id: String,
        val kind: String,
        val path: String,
        val status: String,
        val baseSha256: String? = null,
        val headSha256: String? = null,
        val baseSize: Long? = null,
        val headSize: Long? = null,
        val originalName: String? = null,
    )
}
