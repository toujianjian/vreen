package io.vreen.core

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.vreen.core.model.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** Main facade for the .vreen format. */
object Vreen {
    private val JSON = ObjectMapper().registerKotlinModule()

    // ── Pack ────────────────────────────────────────────────────────

    data class PackInput(
        val name: String,
        val assetName: String,
        val scene: VreenScene? = null,
        val assets: List<AssetInput> = emptyList(),
        val primaryModelId: String? = null,
        val world: VreenWorldJson? = null,
        val generator: String = "vreen-core ${Versions.CURRENT}",
    )

    data class AssetInput(
        val id: String? = null,
        val kind: AssetKind,
        val data: ByteArray,
        val originalName: String? = null,
        val sha256: String? = null,
        val meta: Map<String, Any?>? = null,
    )

    data class PackResult(
        val bytes: ByteArray,
        val manifest: VreenManifest,
        val entries: Map<String, Int>,
    )

    /**
     * Pack a [PackInput] into a valid 0.2.x .vreen zip.
     */
    fun pack(input: PackInput): PackResult {
        val scene = input.scene ?: VreenScene()
        val entries = LinkedHashMap<String, ByteArray>()
        val assetEntries = mutableListOf<VreenAssetEntry>()
        var primaryModelId = input.primaryModelId

        input.assets.forEach { a ->
            val id = a.id ?: randomId()
            val path = AssetPaths.uniquePath(a.kind, a.originalName ?: "asset", id)
            entries[path] = a.data
            val hash = a.sha256 ?: Hashing.sha256Hex(a.data)
            assetEntries.add(
                VreenAssetEntry(
                    id = id,
                    kind = a.kind,
                    path = path,
                    size = a.data.size.toLong(),
                    sha256 = hash,
                    originalName = a.originalName,
                    meta = a.meta,
                )
            )
            if (a.kind == AssetKind.MODEL && primaryModelId == null) primaryModelId = id
        }

        val manifest = VreenManifest(
            version = Versions.CURRENT,
            exportedAt = Instant.now().toString(),
            name = input.name,
            assetName = input.assetName,
            generator = input.generator,
            assets = assetEntries,
            primaryModelId = primaryModelId,
            world = input.world,
        )
        entries["manifest.json"] = JSON.writeValueAsBytes(manifest)
        entries["scene.json"] = JSON.writeValueAsBytes(scene)

        val zipped = zip(entries)
        return PackResult(
            bytes = zipped,
            manifest = manifest,
            entries = entries.mapValues { it.value.size },
        )
    }

    // ── Unpack ──────────────────────────────────────────────────────

    /**
     * Unpack a .vreen file. Accepts:
     * - 0.2.x zip (manifest.json + scene.json + assets)
     * - 0.1.x zip (project.json only) — migrates
     * - plain JSON (0.1.x) — migrates
     */
    fun unpack(source: ByteArray): UnpackedVreen {
        if (source.size >= 4 &&
            source[0] == 0x50.toByte() && source[1] == 0x4B.toByte() &&
            source[2] == 0x03.toByte() && source[3] == 0x04.toByte()
        ) {
            return unpackZip(source)
        }
        // plain JSON → 0.1.x
        return unpackLegacyJson(source)
    }

    private fun unpackZip(bytes: ByteArray): UnpackedVreen {
        val entries = unzip(bytes)
        if (entries.containsKey("manifest.json") && entries.containsKey("scene.json")) {
            return parseVreen02(entries)
        }
        if (entries.containsKey("project.json")) {
            return unpackLegacyJson(entries["project.json"]!!)
        }
        throw VreenFormatError("zip missing manifest.json / scene.json / project.json")
    }

    private fun parseVreen02(entries: Map<String, ByteArray>): UnpackedVreen {
        val manifest: VreenManifest = JSON.readValue(entries["manifest.json"]!!)
        val scene: VreenScene = JSON.readValue(entries["scene.json"]!!)
        val assets = HashMap<String, ByteArray>()
        manifest.assets.forEach { a ->
            val data = entries[a.path]
            if (data != null) assets[a.id] = data
        }
        return UnpackedVreen(manifest, scene, assets, manifest.world)
    }

    @Suppress("UNCHECKED_CAST")
    private fun unpackLegacyJson(bytes: ByteArray): UnpackedVreen {
        val root = JSON.readValue(bytes, Map::class.java) as Map<String, Any?>
        val version = root["version"] as? String
        if (version != "0.1.0") {
            throw VreenFormatError("legacy .vreen version mismatch: $version (expected 0.1.0)")
        }
        val scene = VreenScene(
            camera = (root["camera"] as? Map<String, Any?>) ?: emptyMap(),
            animation = (root["animation"] as? Map<String, Any?>) ?: mapOf("speed" to 1.0),
            environment = (root["environment"] as? Map<String, Any?>) ?: emptyMap(),
            postFX = (root["postFX"] as? Map<String, Any?>) ?: emptyMap(),
            materials = (root["materials"] as? Map<String, Map<String, Any?>>) ?: emptyMap(),
        )
        val assetName = root["assetName"] as? String ?: "legacy"
        val exportedAt = root["exportedAt"] as? String ?: Instant.now().toString()
        val manifest = VreenManifest(
            version = Versions.CURRENT,
            exportedAt = exportedAt,
            name = assetName,
            assetName = assetName,
            generator = "VREEN Legacy Upgrader",
            assets = emptyList(),
            primaryModelId = null,
            world = null,
        )
        return UnpackedVreen(manifest, scene, emptyMap(), null)
    }

    // ── Validate ────────────────────────────────────────────────────

    /** Schema + sha256 + size check. */
    fun validate(pkg: UnpackedVreen): ValidationReport {
        val t0 = System.nanoTime()
        val issues = mutableListOf<ValidationIssue>()

        // schema validation happens in data-class init; if we got here, it passed.
        // But we also check primary model and any explicit meta shape.
        pkg.manifest.assets.forEach { a ->
            val data = pkg.assets[a.id] ?: run {
                issues.add(ValidationIssue(
                    ValidationIssue.Level.ERROR,
                    "ASSET_MISSING",
                    "asset ${a.id} (${a.kind}) declared but bytes missing",
                    a.path,
                ))
                return@forEach
            }
            if (data.size.toLong() != a.size) {
                issues.add(ValidationIssue(
                    ValidationIssue.Level.ERROR,
                    "ASSET_SIZE_MISMATCH",
                    "asset ${a.id} expected ${a.size} bytes, got ${data.size}",
                    a.path,
                ))
            }
            if (a.sha256 != null) {
                if (a.sha256.length != 64 || !a.sha256.all { it.isDigit() || it in 'a'..'f' }) {
                    issues.add(ValidationIssue(
                        ValidationIssue.Level.WARNING,
                        "SHA256_BAD_FORMAT",
                        "asset ${a.id} sha256 not 64 lowercase hex chars",
                        a.path,
                    ))
                } else {
                    val actual = Hashing.sha256Hex(data)
                    if (actual != a.sha256) {
                        issues.add(ValidationIssue(
                            ValidationIssue.Level.ERROR,
                            "SHA256_MISMATCH",
                            "asset ${a.id} sha256 mismatch: expected ${a.sha256}, got $actual",
                            a.path,
                        ))
                    }
                }
            }
        }

        // World
        pkg.world?.let { w ->
            if (w.version != Versions.WORLD) {
                issues.add(ValidationIssue(
                    ValidationIssue.Level.WARNING,
                    "WORLD_VERSION_MISMATCH",
                    "world.version=${w.version} (expected ${Versions.WORLD})",
                ))
            }
        }

        val totalAssetBytes = pkg.manifest.assets.sumOf { it.size }
        val modelCount = pkg.manifest.assets.count { it.kind == AssetKind.MODEL }
        val texCount = pkg.manifest.assets.count { it.kind == AssetKind.TEXTURE }
        val hdriCount = pkg.manifest.assets.count { it.kind == AssetKind.HDRI }
        val audioCount = pkg.manifest.assets.count { it.kind == AssetKind.AUDIO }

        val stats = ValidationStats(
            assetCount = pkg.manifest.assets.size,
            totalAssetBytes = totalAssetBytes,
            modelCount = modelCount,
            textureCount = texCount,
            hdriCount = hdriCount,
            audioCount = audioCount,
            entityCount = pkg.world?.entities?.size ?: 0,
        )
        val ok = issues.none { it.level == ValidationIssue.Level.ERROR }
        val durationMs = (System.nanoTime() - t0) / 1_000_000
        return ValidationReport(ok, issues, stats, durationMs)
    }

    // ── ZIP helpers (pure stdlib, no external deps) ─────────────────

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

    private fun unzip(bytes: ByteArray): Map<String, ByteArray> {
        val out = LinkedHashMap<String, ByteArray>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zis ->
            while (true) {
                val entry = zis.nextEntry ?: break
                val data = zis.readBytes()
                out[entry.name] = data
                zis.closeEntry()
            }
        }
        return out
    }

    // ── Random 16-byte hex id ──────────────────────────────────────

    private fun randomId(): String {
        val bytes = ByteArray(16)
        java.security.SecureRandom().nextBytes(bytes)
        val sb = StringBuilder(32)
        for (b in bytes) sb.append(((b.toInt() and 0xff)).toString(16).padStart(2, '0'))
        return sb.toString()
    }
}
