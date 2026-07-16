package io.vreen.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class VmeshTest {
    @Test
    fun `quad document builds and round-trips through JSON`() {
        val doc = Vmesh.quad("plane", size = 2f, materialId = "mat-plane")
        assertEquals(1, doc.meshes.size)
        val m = doc.meshes[0]
        assertEquals(4, m.vertexCount)
        assertEquals(2, m.triangleCount)
        assertEquals(12, m.vertices.size) // 4 verts * 3 floats
        assertEquals(8, m.uvs.size)        // 4 verts * 2 floats
        assertEquals(6, m.indices.size)    // 2 tris * 3
        assertTrue(materialsOf(doc).containsKey("mat-plane"))

        val bytes = Vmesh.toJsonBytes(doc)
        assertEquals(0x7B, bytes[0].toInt() and 0xFF, "should start with '{'")
        val back = Vmesh.fromJsonBytes(bytes)
        assertEquals(doc.meshes.size, back.meshes.size)
        assertEquals(doc.meshes[0].vertices.size, back.meshes[0].vertices.size)
        assertArrayEquals(doc.meshes[0].indices, back.meshes[0].indices)
    }

    @Test
    fun `triangle helper creates a 1-triangle document`() {
        val doc = Vmesh.triangle(
            name = "tri",
            a = floatArrayOf(0f, 0f, 0f),
            b = floatArrayOf(1f, 0f, 0f),
            c = floatArrayOf(0f, 1f, 0f),
        )
        assertEquals(1, doc.meshes.size)
        assertEquals(1, doc.meshes[0].triangleCount)
        assertEquals(3, doc.meshes[0].vertexCount)
    }

    @Test
    fun `subMesh validates vertex normal uv length constraints`() {
        val bad = assertThrows<IllegalArgumentException> {
            Vmesh.SubMesh(
                name = "bad",
                vertices = floatArrayOf(0f, 0f, 0f, 1f, 1f), // length 5, not div by 3
                indices = intArrayOf(0, 1, 2),
            )
        }
        assertTrue(bad.message!!.contains("divisible by 3"))
    }

    @Test
    fun `subMesh rejects indices that reference missing vertices`() {
        val bad = assertThrows<IllegalArgumentException> {
            Vmesh.SubMesh(
                name = "bad",
                vertices = floatArrayOf(0f, 0f, 0f, 1f, 1f, 0f),
                indices = intArrayOf(0, 1, 9), // 9 out of range
            )
        }
        assertTrue(bad.message!!.contains("references vertex 9"))
    }

    @Test
    fun `material rejects metallic roughness out of range`() {
        val bad = assertThrows<IllegalArgumentException> {
            Vmesh.Material(metallic = 1.5f)
        }
        assertTrue(bad.message!!.contains("metallic"))
    }

    @Test
    fun `fromJsonString rejects bad materialRef`() {
        // Build a raw JSON that has a mesh referencing a non-existent material.
        val raw = """
            {
              "version": "1.0.0",
              "name": "plane",
              "meshes": [
                { "name": "plane",
                  "vertices": [0,0,0, 1,0,0, 1,1,0],
                  "normals":  [0,0,1, 0,0,1, 0,0,1],
                  "uvs":      [0,0, 1,0, 1,1],
                  "indices":  [0,1,2],
                  "materialRef": "mat-missing"
                }
              ],
              "materials": {
                "mat-plane": {
                  "baseColor": "#ffffff",
                  "metallic": 0.0,
                  "roughness": 0.5,
                  "emissive": "#000000",
                  "emissiveIntensity": 0.0,
                  "doubleSided": false
                }
              }
            }
        """.trimIndent()
        val bad = assertThrows<IllegalArgumentException> { Vmesh.fromJsonString(raw) }
        assertTrue(bad.message!!.contains("mat-missing"))
    }

    @Test
    fun `fromJsonBytes rejects non-json payload`() {
        val bad = assertThrows<VreenFormatError> {
            Vmesh.fromJsonBytes(byteArrayOf(0x00, 0x01, 0x02))
        }
        assertTrue(bad.message!!.contains("'{'"))
    }

    @Test
    fun `vmesh asset can be embedded into a pack with meta format vmesh`() {
        val doc = Vmesh.quad("plane", materialId = "mat-plane")
        val bytes = Vmesh.toJsonBytes(doc)
        val pack = Vreen.pack(Vreen.PackInput(
            name = "vmesh-demo",
            assetName = "plane.vmesh",
            assets = listOf(Vreen.AssetInput(
                kind = AssetKind.MODEL,
                data = bytes,
                originalName = "plane.vmesh",
                meta = Vmesh.assetMeta(),
            )),
        ))
        val unpacked = Vreen.unpack(pack.bytes)
        val entry = unpacked.manifest.assets.first { it.kind == AssetKind.MODEL }
        assertEquals("vmesh", entry.meta?.get("format"))
        val back = Vmesh.fromJsonBytes(unpacked.assets[entry.id]!!)
        assertEquals("plane", back.name)
    }

    private fun materialsOf(doc: Vmesh.Document): Map<String, Vmesh.Material> = doc.materials
}
