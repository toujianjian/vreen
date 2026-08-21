package io.vreen.api

import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.fasterxml.jackson.module.kotlin.readValue
import io.vreen.core.AssetKind
import io.vreen.core.AssetPaths
import io.vreen.core.ApplyResult
import io.vreen.core.Hashing
import io.vreen.core.PackageDiff
import io.vreen.core.UnpackedVreen
import io.vreen.core.Vmesh
import io.vreen.core.Vreen
import io.vreen.core.VreenDelta
import io.vreen.core.VreenDiff
import io.vreen.core.VreenRegistry
import io.vreen.core.ValidationReport

/**
 * Java-friendly facade over the `.vreen` core.
 *
 * The core `io.vreen.core` package is written in idiomatic Kotlin (`object`
 * facades + positional `data class` inputs + named/default arguments), which
 * is awkward to call from Java. This class exposes exactly the same features
 * through **static methods** and **builder objects**, so Java callers write:
 *
 * ```java
 * byte[] pkg = VreenApi.pack(
 *     VreenApi.newPack()
 *         .name("demo")
 *         .assetName("robot.glb")
 *         .addAsset(
 *             VreenApi.newAsset()
 *                 .kind(AssetKind.MODEL)
 *                 .originalName("robot.glb")
 *                 .data(glbBytes)));
 * UnpackedVreen head = VreenApi.unpack(pkg);
 * ValidationReport report = VreenApi.validate(head);
 * PackageDiff diff  = VreenApi.diff(base, head);
 * ```
 *
 * All methods are pure delegations to the core; no behaviour is added here.
 * Business objects (`UnpackedVreen`, `ValidationReport`, `PackageDiff`,
 * `VreenRegistry.*`, `Vmesh.*`) are re-used directly so there is a single
 * source of truth.
 */
object VreenApi {

    private val JSON = com.fasterxml.jackson.databind.ObjectMapper().registerKotlinModule()

    // ───────────────────────── builders ─────────────────────────────

    /** Start an empty [PackInputBuilder] (the normal way to build a pack). */
    @JvmStatic
    fun newPack(): PackInputBuilder = PackInputBuilder()

    /** Start an empty [AssetInputBuilder]. */
    @JvmStatic
    fun newAsset(): AssetInputBuilder = AssetInputBuilder()

    /** Start an empty [SceneBuilder]. */
    @JvmStatic
    fun newScene(): SceneBuilder = SceneBuilder()

    // ───────────────────────── pack / unpack ────────────────────────

    /** Pack the built input into a valid 0.2.x `.vreen` ZIP. */
    @JvmStatic
    fun pack(builder: PackInputBuilder): ByteArray =
        Vreen.pack(builder.build()).bytes

    /** Pack and also expose the manifest / size map for tooling. */
    @JvmStatic
    fun packWithManifest(builder: PackInputBuilder): Vreen.PackResult =
        Vreen.pack(builder.build())

    /**
     * Unpack a `.vreen`. Accepts 0.1.x and 0.2.x ZIPs as well as plain
     * JSON; legacy inputs are migrated on the fly.
     */
    @JvmStatic
    fun unpack(bytes: ByteArray): UnpackedVreen = Vreen.unpack(bytes)

    // ───────────────────────── validation ───────────────────────────

    /** Schema + size + sha256 validation. */
    @JvmStatic
    fun validate(pkg: UnpackedVreen): ValidationReport = Vreen.validate(pkg)

    // ───────────────────────── diff / delta ─────────────────────────

    /** Compute the structured asset/scene/world diff between two packages. */
    @JvmStatic
    fun diff(base: UnpackedVreen, head: UnpackedVreen): PackageDiff =
        VreenDiff.diff(base, head)

    /** Build a `.vreen-delta` ZIP from a base / head pair and their diff. */
    @JvmStatic
    fun createDelta(base: UnpackedVreen, head: UnpackedVreen, diff: PackageDiff): ByteArray =
        VreenDelta.create(base, head, diff).bytes

    /** Apply a `.vreen-delta` to a known base. */
    @JvmStatic
    fun applyDelta(base: UnpackedVreen, deltaBytes: ByteArray): ApplyResult =
        VreenDiff.apply(base, deltaBytes)

    /** Convenience: apply a delta and re-pack the head into a full `.vreen`. */
    @JvmStatic
    fun applyThenPack(base: UnpackedVreen, deltaBytes: ByteArray): ByteArray =
        VreenDelta.applyThenPack(base, deltaBytes).bytes

    // ───────────────────────── hashing ──────────────────────────────

    /** Lowercase hex SHA-256 of the given bytes. */
    @JvmStatic
    fun sha256Hex(data: ByteArray): String = Hashing.sha256Hex(data)

    /** Hex SHA-256 of a streaming input (useful for large assets). */
    @JvmStatic
    fun sha256HexStreamed(stream: java.io.InputStream): String =
        Hashing.sha256HexStreamed(stream)

    /** HMAC-SHA256 (hex) — for authenticated manifest signing. */
    @JvmStatic
    fun hmacSha256Hex(key: ByteArray, data: ByteArray): String =
        Hashing.hmacSha256Hex(key, data)

    // ───────────────────────── asset paths ──────────────────────────

    /** Build a collision-free asset path from kind + name + id. */
    @JvmStatic
    fun uniqueAssetPath(kind: AssetKind, originalName: String, id: String): String =
        AssetPaths.uniquePath(kind, originalName, id)

    // ───────────────────────── vmesh ────────────────────────────────

    /** Build a single-quad [Vmesh.Document] (the quickest vmesh). */
    @JvmStatic
    fun vmeshQuad(name: String, size: Float, materialId: String): Vmesh.Document =
        Vmesh.quad(name, size, materialId)

    /** Build a single-triangle [Vmesh.Document]. */
    @JvmStatic
    fun vmeshTriangle(
        name: String,
        a: FloatArray, b: FloatArray, c: FloatArray,
        materialId: String,
    ): Vmesh.Document = Vmesh.triangle(name, a, b, c, Vmesh.Material(), materialId)

    /** Serialize a vmesh document to UTF-8 JSON bytes. */
    @JvmStatic
    fun vmeshToJson(doc: Vmesh.Document): ByteArray = Vmesh.toJsonBytes(doc)

    /** Parse vmesh JSON bytes back into a [Vmesh.Document]. */
    @JvmStatic
    fun vmeshFromJson(bytes: ByteArray): Vmesh.Document = Vmesh.fromJsonBytes(bytes)

    /** The `meta` map that marks an asset as a vmesh payload. */
    @JvmStatic
    fun vmeshAssetMeta(): Map<String, Any?> = Vmesh.assetMeta()

    // ───────────────────────── registry ─────────────────────────────

    /**
     * Load a registry index from a URL string (contains `://`) or a local
     * file path.
     */
    @JvmStatic
    fun loadRegistry(source: String): VreenRegistry.Index =
        VreenRegistry.loadRegistry(source)

    @JvmStatic
    fun loadRegistry(index: VreenRegistry.Index): VreenRegistry.Index = index

    /** Parse a registry index from a raw JSON string. */
    @JvmStatic
    fun loadRegistryJson(json: String): VreenRegistry.Index =
        JSON.readValue<io.vreen.core.VreenRegistry.Index>(json)

    @JvmStatic
    fun findPackage(index: VreenRegistry.Index, id: String): VreenRegistry.Package? =
        VreenRegistry.findPackage(index, id)

    @JvmStatic
    fun listPackageIds(index: VreenRegistry.Index): List<String> =
        VreenRegistry.listPackageIds(index)

    @JvmStatic
    fun filterByTag(index: VreenRegistry.Index, tag: String): List<VreenRegistry.Package> =
        VreenRegistry.filterByTag(index, tag)

    /** Semver comparison: negative/zero/positive. */
    @JvmStatic
    fun compareSemver(a: String, b: String): Int = VreenRegistry.compareSemver(a, b)

    @JvmStatic
    fun resolveVersion(pkg: VreenRegistry.Package, range: String): VreenRegistry.Version? =
        if (range.isEmpty()) VreenRegistry.resolveVersion(pkg)
        else VreenRegistry.resolveVersion(pkg, range)

    @JvmStatic
    fun resolveDownloadUrl(version: VreenRegistry.Version, baseUrl: String?): String =
        VreenRegistry.resolveDownloadUrl(version, baseUrl)

    @JvmStatic
    fun resolveDeltaUrl(version: VreenRegistry.Version, baseUrl: String?): String? =
        VreenRegistry.resolveDeltaUrl(version, baseUrl)

    @JvmStatic
    fun formatRegistry(index: VreenRegistry.Index): String =
        VreenRegistry.formatRegistry(index)
}