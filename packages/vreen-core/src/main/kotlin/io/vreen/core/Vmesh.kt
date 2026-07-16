package io.vreen.core

import com.fasterxml.jackson.annotation.JsonIgnore
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule

/**
 * `vmesh` — VREEN's JSON mesh container (see `vreen-format-spec.md` §14.2).
 *
 * Used as an alternative to GLB when an exporter cannot produce a binary
 * glTF asset (headless build servers, UE Editor without a third-party GLTF
 * plugin, etc.). Readers detect a vmesh by:
 *  - `manifest.assets[].kind == "model"`
 *  - `manifest.assets[].meta.format == "vmesh"`
 *  - asset bytes start with `{` (valid JSON)
 *
 * The shape of the JSON document is engine-agnostic; this file provides
 * POJOs, a builder, and a minimal validation pass.
 */
object Vmesh {
    private val JSON = ObjectMapper().registerKotlinModule()

    const val VERSION = "1.0.0"
    const val FORMAT_TAG = "vmesh"
    const val META_KEY_FORMAT = "format"

    // ── Document shape ─────────────────────────────────────────────────

    data class Document(
        val version: String = VERSION,
        val name: String,
        val meshes: List<SubMesh>,
        val materials: Map<String, Material> = emptyMap(),
    )

    data class SubMesh(
        val name: String,
        val vertices: FloatArray, // length divisible by 3
        val normals: FloatArray = FloatArray(0), // length divisible by 3
        val uvs: FloatArray = FloatArray(0),     // length divisible by 2
        val indices: IntArray,                   // length divisible by 3, triangle list
        val materialRef: String? = null,
    ) {
        init {
            require(name.isNotBlank()) { "subMesh.name must not be blank" }
            require(vertices.size % 3 == 0) {
                "subMesh.vertices length must be divisible by 3 (got ${vertices.size})"
            }
            require(normals.size % 3 == 0) {
                "subMesh.normals length must be divisible by 3 (got ${normals.size})"
            }
            require(uvs.size % 2 == 0) {
                "subMesh.uvs length must be divisible by 2 (got ${uvs.size})"
            }
            require(indices.size % 3 == 0) {
                "subMesh.indices must be a triangle list (got ${indices.size})"
            }
            val maxIdx = indices.maxOrNull() ?: -1
            val maxAllowed = vertices.size / 3 - 1
            require(maxIdx <= maxAllowed) {
                "subMesh.indices references vertex $maxIdx but only ${maxAllowed + 1} vertices exist"
            }
            // materialRef must point to a known material (validation deferred to Document)
        }

        @get:JsonIgnore
        val vertexCount: Int get() = vertices.size / 3
        @get:JsonIgnore
        val triangleCount: Int get() = indices.size / 3

        // Override equals/hashCode for FloatArray / IntArray
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is SubMesh) return false
            return name == other.name &&
                vertices.contentEquals(other.vertices) &&
                normals.contentEquals(other.normals) &&
                uvs.contentEquals(other.uvs) &&
                indices.contentEquals(other.indices) &&
                materialRef == other.materialRef
        }
        override fun hashCode(): Int {
            var r = name.hashCode()
            r = 31 * r + vertices.contentHashCode()
            r = 31 * r + normals.contentHashCode()
            r = 31 * r + uvs.contentHashCode()
            r = 31 * r + indices.contentHashCode()
            r = 31 * r + (materialRef?.hashCode() ?: 0)
            return r
        }
    }

    data class Material(
        val baseColor: String = "#ffffff",
        val metallic: Float = 0f,
        val roughness: Float = 0.5f,
        val emissive: String = "#000000",
        val emissiveIntensity: Float = 0f,
        val doubleSided: Boolean = false,
        val baseColorTexture: String? = null,
        val normalTexture: String? = null,
        val metallicRoughnessTexture: String? = null,
    ) {
        init {
            require(metallic in 0f..1f) { "metallic must be in [0,1] (got $metallic)" }
            require(roughness in 0f..1f) { "roughness must be in [0,1] (got $roughness)" }
            require(emissiveIntensity >= 0f) { "emissiveIntensity must be >= 0" }
        }
    }

    // ── Serialization ──────────────────────────────────────────────────

    fun toJsonBytes(doc: Document): ByteArray = JSON.writeValueAsBytes(doc)

    fun toJsonString(doc: Document): String = JSON.writeValueAsString(doc)

    fun fromJsonBytes(bytes: ByteArray): Document {
        val text = if (bytes.isNotEmpty() && bytes[0] == 0x7B.toByte()) {
            String(bytes, Charsets.UTF_8)
        } else {
            throw VreenFormatError("vmesh: bytes do not start with '{' — not a vmesh document")
        }
        return fromJsonString(text)
    }

    fun fromJsonString(text: String): Document {
        val doc = JSON.readValue<Document>(text)
        require(doc.version == VERSION) {
            "vmesh: unsupported version '${doc.version}' (expected $VERSION)"
        }
        // Cross-check materialRef
        for (m in doc.meshes) {
            val ref = m.materialRef ?: continue
            require(doc.materials.containsKey(ref)) {
                "vmesh: subMesh '${m.name}' references unknown material '$ref'"
            }
        }
        return doc
    }

    /** Build a single-triangle document (handy for tests). */
    fun triangle(
        name: String,
        a: FloatArray, b: FloatArray, c: FloatArray,
        material: Material = Material(),
        materialId: String = "mat-default",
    ): Document {
        require(a.size == 3 && b.size == 3 && c.size == 3) {
            "triangle vertices must be 3-component (got ${a.size}, ${b.size}, ${c.size})"
        }
        val flat = a + b + c
        // simple flat normal in +Z
        val normal = floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 1f)
        val uvs = floatArrayOf(0f, 0f, 1f, 0f, 0.5f, 1f)
        val indices = intArrayOf(0, 1, 2)
        val sub = SubMesh(
            name = name,
            vertices = flat,
            normals = normal,
            uvs = uvs,
            indices = indices,
            materialRef = materialId,
        )
        return Document(
            name = name,
            meshes = listOf(sub),
            materials = mapOf(materialId to material),
        )
    }

    /** Build a single-quad plane (4 verts, 2 triangles) — useful for tests. */
    fun quad(name: String = "quad", size: Float = 1f, materialId: String = "mat-default"): Document {
        val h = size * 0.5f
        val verts = floatArrayOf(
            -h, -h, 0f,
             h, -h, 0f,
             h,  h, 0f,
            -h,  h, 0f,
        )
        val normal = floatArrayOf(
            0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 1f,
        )
        val uvs = floatArrayOf(0f, 0f, 1f, 0f, 1f, 1f, 0f, 1f)
        val indices = intArrayOf(0, 1, 2, 0, 2, 3)
        return Document(
            name = name,
            meshes = listOf(SubMesh(name, verts, normal, uvs, indices, materialId)),
            materials = mapOf(materialId to Material()),
        )
    }

    /**
     * Build the `meta` field for a [io.vreen.core.model.VreenAssetEntry]
     * so a reader can detect the vmesh payload.
     */
    fun assetMeta(): Map<String, Any?> = mapOf(META_KEY_FORMAT to FORMAT_TAG)
}
