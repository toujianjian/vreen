package io.vreen.api

import com.fasterxml.jackson.databind.ObjectMapper
import io.vreen.core.AssetKind
import io.vreen.core.Vreen
import io.vreen.core.VreenScene
import io.vreen.core.VreenWorldJson

/**
 * Fluent builder for the pack input — the Java-friendly way to produce a
 * `.vreen` package without facing Kotlin named/default arguments.
 *
 * ```java
 * byte[] pkg = VreenApi.pack(VreenApi.newPack()
 *         .name("demo")
 *         .assetName("robot.glb")
 *         .addAsset(VreenApi.newAsset()
 *                 .kind(AssetKind.MODEL)
 *                 .originalName("robot.glb")
 *                 .data(glbBytes)));
 * ```
 */
class PackInputBuilder {
    private var name: String = "vreen-package"
    private var assetName: String = "asset"
    private var scene: VreenScene? = null
    private var primaryModelId: String? = null
    private var world: VreenWorldJson? = null
    private var generator: String? = null
    private val assets: MutableList<Vreen.AssetInput> = ArrayList()

    /** Display/package name (must be non-blank). */
    fun name(v: String): PackInputBuilder {
        name = v
        return this
    }

    /** Filename of the primary 3D asset. */
    fun assetName(v: String): PackInputBuilder {
        assetName = v
        return this
    }

    /** Optional pre-built scene; `null` uses the format defaults. */
    fun scene(v: VreenScene?): PackInputBuilder {
        scene = v
        return this
    }

    /** Explicit primary model id (defaults to the first MODEL asset). */
    fun primaryModelId(v: String?): PackInputBuilder {
        primaryModelId = v
        return this
    }

    /** Optional embedded ECS world. */
    fun world(v: VreenWorldJson?): PackInputBuilder {
        world = v
        return this
    }

    /** Producer string, e.g. `"my-tool 1.0"`. */
    fun generator(v: String): PackInputBuilder {
        generator = v
        return this
    }

    /** Append one asset. */
    fun addAsset(a: Vreen.AssetInput): PackInputBuilder {
        assets.add(a)
        return this
    }

    /** Append several assets. */
    fun addAssets(all: Collection<Vreen.AssetInput>): PackInputBuilder {
        assets.addAll(all)
        return this
    }

    /** Build the immutable core input object. */
    fun build(): Vreen.PackInput = Vreen.PackInput(
        name = name,
        assetName = assetName,
        scene = scene,
        assets = assets,
        primaryModelId = primaryModelId,
        world = world,
        generator = generator ?: "vreen-core",
    )
}

/**
 * Fluent builder for a single raw asset to embed in a package.
 */
class AssetInputBuilder {
    private var id: String? = null
    private var kind: AssetKind = AssetKind.MODEL
    private var data: ByteArray? = null
    private var originalName: String? = null
    private var sha256: String? = null
    private var meta: Map<String, Any?>? = null

    /** Asset id; when null one is generated. */
    fun id(v: String?): AssetInputBuilder {
        id = v
        return this
    }

    fun kind(v: AssetKind): AssetInputBuilder {
        kind = v
        return this
    }

    /** Raw asset bytes. */
    fun data(v: ByteArray): AssetInputBuilder {
        data = v
        return this
    }

    fun originalName(v: String?): AssetInputBuilder {
        originalName = v
        return this
    }

    fun sha256(v: String?): AssetInputBuilder {
        sha256 = v
        return this
    }

    fun meta(v: Map<String, Any?>?): AssetInputBuilder {
        meta = v
        return this
    }

    /** Build the immutable core asset input. */
    fun build(): Vreen.AssetInput {
        val bytes = data
            ?: throw IllegalStateException("asset data is required (call .data(...))")
        return Vreen.AssetInput(
            id = id,
            kind = kind,
            data = bytes,
            originalName = originalName,
            sha256 = sha256,
            meta = meta,
        )
    }
}

/**
 * Fluent builder for [VreenScene], so Java callers don't face the core's
 * positional `data class` constructor. JSON strings are parsed with the
 * bundled Jackson mapper; raw maps are passed through as-is.
 */
class SceneBuilder {
    private val JSON = ObjectMapper()
    private var camera: Map<String, Any?> = emptyMap()
    private var animation: Map<String, Any?> = mapOf("speed" to 1.0)
    private var environment: Map<String, Any?> = mapOf(
        "preset" to "midnight",
        "exposure" to 1.0,
        "background" to "solid",
        "backgroundColor" to "#000000",
    )
    private var postFX: Map<String, Any?> = mapOf(
        "bloom" to false, "bloomIntensity" to 0.0,
        "chromaticAberration" to false, "vignette" to false, "ssao" to false,
    )
    private val materials: MutableMap<String, Map<String, Any?>> = LinkedHashMap()

    @Suppress("UNCHECKED_CAST")
    fun camera(v: Map<String, Any?>): SceneBuilder {
        camera = v
        return this
    }

    @Suppress("UNCHECKED_CAST")
    fun cameraJson(json: String): SceneBuilder {
        camera = JSON.readValue(json, Map::class.java) as Map<String, Any?>
        return this
    }

    @Suppress("UNCHECKED_CAST")
    fun animation(v: Map<String, Any?>): SceneBuilder {
        animation = v
        return this
    }

    @Suppress("UNCHECKED_CAST")
    fun environment(v: Map<String, Any?>): SceneBuilder {
        environment = v
        return this
    }

    @Suppress("UNCHECKED_CAST")
    fun postFX(v: Map<String, Any?>): SceneBuilder {
        postFX = v
        return this
    }

    /** Add (or replace) a PBR material for the given asset id. */
    fun material(assetId: String, params: Map<String, Any?>): SceneBuilder {
        materials[assetId] = params
        return this
    }

    /** Add a material from a raw JSON object string. */
    @Suppress("UNCHECKED_CAST")
    fun materialJson(assetId: String, json: String): SceneBuilder {
        materials[assetId] = JSON.readValue(json, Map::class.java) as Map<String, Any?>
        return this
    }

    /** Build the immutable core scene. */
    fun build(): VreenScene = VreenScene(
        camera = camera,
        animation = animation,
        environment = environment,
        postFX = postFX,
        materials = materials,
    )
}