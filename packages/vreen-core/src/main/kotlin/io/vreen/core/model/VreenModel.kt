package io.vreen.core

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

/** Format version constants. Mirrors src/lib/vreenManifest.ts. */
object Versions {
    const val CURRENT = "0.2.1"
    const val LEGACY = "0.1.0"
    const val WORLD = "0.2.0"
}

/** Asset categories. */
enum class AssetKind(val path: String) {
    MODEL("assets"),
    TEXTURE("assets/textures"),
    HDRI("assets/hdri"),
    AUDIO("assets/audio");

    companion object {
        fun fromString(s: String): AssetKind = entries.first { it.name.equals(s, true) }
    }
}

/** Single asset descriptor (manifest.assets[]). */
data class VreenAssetEntry(
    val id: String,
    val kind: AssetKind,
    val path: String,
    val size: Long,
    val sha256: String? = null,
    val originalName: String? = null,
    val meta: Map<String, Any?>? = null,
) {
    init {
        require(id.isNotBlank()) { "asset id must not be blank" }
        require(!path.startsWith("/")) { "asset path must not start with /" }
        require(!path.contains("..")) { "asset path must not contain '..'" }
        require(!path.contains('\\')) { "asset path must use forward slashes only" }
        require(size >= 0) { "size must be >= 0" }
        if (sha256 != null) {
            require(sha256.length == 64) { "sha256 must be 64 hex chars" }
            require(sha256.all { it.isDigit() || it in 'a'..'f' }) { "sha256 must be lowercase hex" }
        }
    }
}

/** Top-level manifest. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class VreenManifest(
    val version: String = Versions.CURRENT,
    val exportedAt: String,
    val name: String,
    val assetName: String,
    val generator: String,
    val assets: List<VreenAssetEntry>,
    val primaryModelId: String?,
    val world: VreenWorldJson? = null,
) {
    init {
        require(version == Versions.CURRENT) { "manifest.version must be ${Versions.CURRENT}, got $version" }
        require(name.isNotBlank()) { "name must not be blank" }
        if (primaryModelId != null) {
            val m = assets.firstOrNull { it.id == primaryModelId }
            requireNotNull(m) { "primaryModelId $primaryModelId not in assets" }
            require(m.kind == AssetKind.MODEL) { "primaryModelId must reference a model asset" }
        }
    }
}

/** ECS world (data-only, see §6 of vreen-format-spec.md). */
data class VreenWorldJson(
    val version: String = Versions.WORLD,
    val name: String,
    val frame: Long,
    val entities: List<VreenEntityJson>,
)

data class VreenEntityJson(
    val id: Long,
    val name: String,
    val sceneNode: VreenSceneNodeJson,
    val components: List<VreenComponentJson>,
)

data class VreenSceneNodeJson(
    val position: List<Float>,
    val rotation: List<Float>, // quaternion [x, y, z, w]
    val scale: List<Float>,
)

data class VreenComponentJson(
    val type: String,
    val data: Map<String, Any?>,
)

/** Scene sub-record (scene.json). */
data class VreenScene(
    val version: String = Versions.CURRENT,
    val camera: Map<String, Any?> = emptyMap(),
    val animation: Map<String, Any?> = mapOf("speed" to 1.0),
    val environment: Map<String, Any?> = mapOf(
        "preset" to "midnight",
        "exposure" to 1.0,
        "background" to "solid",
        "backgroundColor" to "#000000",
    ),
    val postFX: Map<String, Any?> = mapOf(
        "bloom" to false, "bloomIntensity" to 0.0,
        "chromaticAberration" to false, "vignette" to false, "ssao" to false,
    ),
    val materials: Map<String, Map<String, Any?>> = emptyMap(),
) {
    init {
        require(version == Versions.CURRENT) { "scene.version must be ${Versions.CURRENT}" }
    }
}

/** Unpacked package result. */
data class UnpackedVreen(
    val manifest: VreenManifest,
    val scene: VreenScene,
    val assets: Map<String, ByteArray>, // id → bytes
    val world: VreenWorldJson?,
)
