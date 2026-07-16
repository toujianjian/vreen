package io.vreen.core

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.net.URI
import java.net.URL

/**
 * .vreen registry client.
 *
 * Mirrors `src/lib/vreenRegistry.ts` (TypeScript SDK). Provides:
 *  - [loadRegistry] — fetch (or parse) a registry index from a URL/path/object
 *  - [findPackage], [listPackageIds], [filterByTag] — index lookups
 *  - [compareSemver], [resolveVersion] — semver range matching
 *  - [resolveDownloadUrl], [resolveDeltaUrl] — `{baseUrl}` substitution
 *  - [formatRegistry] — human-readable summary
 */
object VreenRegistry {
    private val JSON = ObjectMapper().registerKotlinModule()

    // ── Domain types ───────────────────────────────────────────────────

    data class Version(
        val version: String,
        val releasedAt: String,
        val downloadUrl: String,
        val deltaUrl: String? = null,
        val size: Long,
        val sha256: String,
        val formatVersion: String? = null,
        val engineVersions: List<String>? = null,
        val dependencies: Map<String, String>? = null,
        val yanked: Boolean = false,
        val yankReason: String? = null,
    )

    data class Package(
        val id: String,
        val name: String,
        val description: String? = null,
        val tags: List<String>? = null,
        val author: String? = null,
        val license: String? = null,
        val homepage: String? = null,
        val icon: String? = null,
        val latest: String,
        val versions: List<Version>,
    )

    data class Index(
        val version: String = "1.0.0",
        val generatedAt: String,
        val baseUrl: String? = null,
        val packages: List<Package>,
    )

    // ── Loading ────────────────────────────────────────────────────────

    /**
     * Load a registry index. Accepts:
     *  - a [URL] or [String] (URL/path) — fetched
     *  - a local file path (looks for "://" to detect URLs)
     *  - an already-parsed [Index]
     */
    fun loadRegistry(source: Any): Index {
        if (source is Index) return source
        if (source is String || source is URL) {
            val s = source.toString()
            // Anything with a scheme is fetched; otherwise treated as file path
            return if (s.contains("://")) {
                val text = URI(s).toURL().readText(Charsets.UTF_8)
                JSON.readValue(text)
            } else {
                val text = java.io.File(s).readText(Charsets.UTF_8)
                JSON.readValue(text)
            }
        }
        // Map / Object — try Jackson fallback
        @Suppress("UNCHECKED_CAST")
        val asMap = source as? Map<String, Any?>
            ?: throw VreenFormatError("loadRegistry: unsupported source type ${source::class}")
        return JSON.readValue(JSON.writeValueAsBytes(asMap))
    }

    // ── Lookup ─────────────────────────────────────────────────────────

    fun findPackage(index: Index, id: String): Package? =
        index.packages.firstOrNull { it.id == id }

    fun listPackageIds(index: Index): List<String> =
        index.packages.map { it.id }

    fun filterByTag(index: Index, tag: String): List<Package> =
        index.packages.filter { p -> p.tags?.contains(tag) == true }

    // ── Semver ─────────────────────────────────────────────────────────

    /**
     * Returns negative if [a] < [b], positive if [a] > [b], zero if equal.
     * Pre-release tags sort before the same version without a pre-release.
     */
    fun compareSemver(a: String, b: String): Int {
        val (a1, a2, a3, aPre) = parseSemver(a)
        val (b1, b2, b3, bPre) = parseSemver(b)
        if (a1 != b1) return a1 - b1
        if (a2 != b2) return a2 - b2
        if (a3 != b3) return a3 - b3
        if (aPre.isNotEmpty() && bPre.isEmpty()) return -1
        if (aPre.isEmpty() && bPre.isNotEmpty()) return 1
        if (aPre.isNotEmpty() && bPre.isNotEmpty()) return aPre.compareTo(bPre)
        return 0
    }

    private data class SemverParts(val major: Int, val minor: Int, val patch: Int, val pre: String)

    private fun parseSemver(s: String): SemverParts {
        val stripped = s.replace(Regex("^[^0-9]*"), "")
        val parts = stripped.split(Regex("[.-]"))
        val major = parts.getOrNull(0)?.toIntOrNull() ?: 0
        val minor = parts.getOrNull(1)?.toIntOrNull() ?: 0
        val patch = parts.getOrNull(2)?.toIntOrNull() ?: 0
        val pre = parts.getOrNull(3) ?: ""
        return SemverParts(major, minor, patch, pre)
    }

    private fun matchesRange(version: String, range: String): Boolean {
        val r = range.trim()
        if (r == "latest" || r == "*") return true
        if (r.startsWith("^")) {
            val (maj, min) = r.drop(1).split(".").map { it.toIntOrNull() ?: 0 }
            val parts = parseSemver(version)
            return parts.major == maj && parts.minor >= min
        }
        if (r.startsWith("~")) {
            val (maj, min) = r.drop(1).split(".").map { it.toIntOrNull() ?: 0 }
            val parts = parseSemver(version)
            return parts.major == maj && parts.minor == min
        }
        if (r.startsWith(">=")) return compareSemver(version, r.drop(2)) >= 0
        if (r.startsWith(">")) return compareSemver(version, r.drop(1)) > 0
        if (r.startsWith("<=")) return compareSemver(version, r.drop(2)) <= 0
        if (r.startsWith("<")) return compareSemver(version, r.drop(1)) < 0
        return version == r
    }

    /**
     * Find the highest non-yanked version matching [range].
     * @return null if no version matches.
     */
    fun resolveVersion(pkg: Package, range: String = "latest"): Version? {
        val sorted = pkg.versions.sortedWith(compareByDescending { compareSemver(it.version, "0.0.0") })
        for (v in sorted) {
            if (v.yanked) continue
            if (matchesRange(v.version, range)) return v
        }
        return null
    }

    // ── URL helpers ────────────────────────────────────────────────────

    private fun substituteBase(url: String, baseUrl: String?): String {
        if (!url.contains("{baseUrl}")) return url
        return url.replace("{baseUrl}", baseUrl ?: "")
    }

    fun resolveDownloadUrl(v: Version, baseUrl: String? = null): String =
        substituteBase(v.downloadUrl, baseUrl)

    fun resolveDeltaUrl(v: Version, baseUrl: String? = null): String? {
        val u = v.deltaUrl ?: return null
        return substituteBase(u, baseUrl)
    }

    // ── CLI-friendly summary ───────────────────────────────────────────

    fun formatRegistry(index: Index): String {
        val lines = mutableListOf<String>()
        lines += "Vreen registry v${index.version} (${index.generatedAt})"
        lines += "base: ${index.baseUrl ?: "(none)"}"
        lines += "packages: ${index.packages.size}"
        for (p in index.packages) {
            val tagList = p.tags
            val tags = if (!tagList.isNullOrEmpty()) " [${tagList.joinToString(", ")}]" else ""
            lines += "  • ${p.id} v${p.latest} — ${p.name}${tags}"
            val verList = p.versions.joinToString(", ") { v ->
                v.version + if (v.yanked) "(yanked)" else ""
            }
            lines += "    versions: $verList"
        }
        return lines.joinToString("\n")
    }
}
