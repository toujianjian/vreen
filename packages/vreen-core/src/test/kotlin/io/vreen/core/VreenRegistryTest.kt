package io.vreen.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class VreenRegistryTest {
    private fun fixtureIndex(): VreenRegistry.Index = VreenRegistry.Index(
        version = "1.0.0",
        generatedAt = "2026-07-11T00:00:00.000Z",
        baseUrl = "https://registry.vreen.dev/packages",
        packages = listOf(
            VreenRegistry.Package(
                id = "robot.glb",
                name = "Robot Character",
                tags = listOf("character", "rigged"),
                latest = "1.2.0",
                versions = listOf(
                    VreenRegistry.Version(
                        version = "1.2.0", releasedAt = "2026-07-10T00:00:00.000Z",
                        downloadUrl = "{baseUrl}/robot.glb/1.2.0/robot.glb.vreen",
                        deltaUrl = "{baseUrl}/robot.glb/1.2.0/robot.glb.vreen-delta",
                        size = 1048576, sha256 = "a".repeat(64),
                    ),
                    VreenRegistry.Version(
                        version = "1.1.0", releasedAt = "2026-06-01T00:00:00.000Z",
                        downloadUrl = "{baseUrl}/robot.glb/1.1.0/robot.glb.vreen",
                        size = 987654, sha256 = "b".repeat(64),
                    ),
                    VreenRegistry.Version(
                        version = "1.0.0", releasedAt = "2026-05-01T00:00:00.000Z",
                        downloadUrl = "{baseUrl}/robot.glb/1.0.0/robot.glb.vreen",
                        size = 524288, sha256 = "c".repeat(64), yanked = true,
                        yankReason = "bad texture",
                    ),
                ),
            ),
            VreenRegistry.Package(
                id = "studio-hdri",
                name = "Studio HDRI",
                tags = listOf("hdri"),
                latest = "2.0.0",
                versions = listOf(
                    VreenRegistry.Version(
                        version = "2.0.0", releasedAt = "2026-07-01T00:00:00.000Z",
                        downloadUrl = "{baseUrl}/studio-hdri/2.0.0/studio-hdri.vreen",
                        size = 8388608, sha256 = "d".repeat(64),
                    ),
                ),
            ),
        ),
    )

    @Test
    fun `findPackage returns match by id`() {
        val reg = fixtureIndex()
        val pkg = VreenRegistry.findPackage(reg, "robot.glb")
        assertNotNull(pkg)
        assertEquals("Robot Character", pkg!!.name)
        assertNull(VreenRegistry.findPackage(reg, "missing"))
    }

    @Test
    fun `listPackageIds returns all ids in declaration order`() {
        val ids = VreenRegistry.listPackageIds(fixtureIndex())
        assertEquals(listOf("robot.glb", "studio-hdri"), ids)
    }

    @Test
    fun `filterByTag returns matching packages only`() {
        val hdri = VreenRegistry.filterByTag(fixtureIndex(), "hdri")
        assertEquals(1, hdri.size)
        assertEquals("studio-hdri", hdri[0].id)
    }

    @Test
    fun `compareSemver orders major minor patch correctly`() {
        assertTrue(VreenRegistry.compareSemver("1.2.0", "1.10.0") < 0)
        assertTrue(VreenRegistry.compareSemver("2.0.0", "1.99.99") > 0)
        assertEquals(0, VreenRegistry.compareSemver("1.2.3", "1.2.3"))
        // pre-release sorts before non-pre
        assertTrue(VreenRegistry.compareSemver("1.2.3-rc1", "1.2.3") < 0)
    }

    @Test
    fun `resolveVersion latest skips yanked entries`() {
        val pkg = VreenRegistry.findPackage(fixtureIndex(), "robot.glb")!!
        val v = VreenRegistry.resolveVersion(pkg, "latest")
        assertNotNull(v)
        assertEquals("1.2.0", v!!.version) // 1.0.0 is yanked
    }

    @Test
    fun `resolveVersion caret range picks highest compatible`() {
        val pkg = VreenRegistry.findPackage(fixtureIndex(), "robot.glb")!!
        val v = VreenRegistry.resolveVersion(pkg, "^1.0.0")
        assertNotNull(v)
        assertEquals("1.2.0", v!!.version)
    }

    @Test
    fun `resolveVersion tilde range locks minor`() {
        val pkg = VreenRegistry.findPackage(fixtureIndex(), "robot.glb")!!
        val v = VreenRegistry.resolveVersion(pkg, "~1.1.0")
        assertNotNull(v)
        assertEquals("1.1.0", v!!.version)
    }

    @Test
    fun `resolveDownloadUrl substitutes baseUrl token`() {
        val pkg = VreenRegistry.findPackage(fixtureIndex(), "robot.glb")!!
        val v = VreenRegistry.resolveVersion(pkg, "1.2.0")!!
        val url = VreenRegistry.resolveDownloadUrl(v, pkg.let { fixtureIndex().baseUrl })
        assertEquals("https://registry.vreen.dev/packages/robot.glb/1.2.0/robot.glb.vreen", url)
    }

    @Test
    fun `resolveDeltaUrl returns null when absent`() {
        val pkg = VreenRegistry.findPackage(fixtureIndex(), "studio-hdri")!!
        val v = VreenRegistry.resolveVersion(pkg, "latest")!!
        assertNull(VreenRegistry.resolveDeltaUrl(v, fixtureIndex().baseUrl))
    }

    @Test
    fun `loadRegistry round-trips a Map back into typed Index`() {
        val reg = fixtureIndex()
        val mapper = com.fasterxml.jackson.databind.ObjectMapper()
        val map = mapper.convertValue(reg, Map::class.java) as Map<String, Any?>
        val back = VreenRegistry.loadRegistry(map)
        assertEquals(reg.packages.size, back.packages.size)
        assertEquals(reg.baseUrl, back.baseUrl)
    }

    @Test
    fun `formatRegistry produces readable summary`() {
        val text = VreenRegistry.formatRegistry(fixtureIndex())
        assertTrue(text.contains("Vreen registry v1.0.0"))
        assertTrue(text.contains("• robot.glb v1.2.0"))
        assertTrue(text.contains("1.0.0(yanked)"))
    }
}
