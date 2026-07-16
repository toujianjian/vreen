package io.vreen.core

import io.vreen.core.model.*

/**
 * Path mapping for assets based on kind + original filename.
 * Mirrors defaultAssetPath() in src/lib/vreenPack.ts.
 */
object AssetPaths {
    @Suppress("UNUSED_PARAMETER")
    fun defaultPath(kind: AssetKind, originalName: String, id: String): String {
        val safeName = sanitizeFilename(originalName)
        return when (kind) {
            AssetKind.MODEL -> "$kind/$safeName"
            AssetKind.TEXTURE -> "${kind.path}/$safeName"
            AssetKind.HDRI -> "${kind.path}/$safeName"
            AssetKind.AUDIO -> "${kind.path}/$safeName"
        }.also {
            // ensure unique by id when needed
            if (it.count { c -> c == '/' } < if (kind == AssetKind.MODEL) 1 else 2) {
                // ensure id is included to avoid collisions
            }
        }
    }

    /** Insert id before extension to guarantee uniqueness while keeping extension. */
    fun uniquePath(kind: AssetKind, originalName: String, id: String): String {
        val safe = sanitizeFilename(originalName)
        val dot = safe.lastIndexOf('.')
        return if (dot > 0 && dot < safe.length - 1) {
            val base = safe.substring(0, dot)
            val ext = safe.substring(dot)
            val tagged = "${base.take(40)}-$id$ext"
            if (kind == AssetKind.MODEL) "$kind/$tagged" else "${kind.path}/$tagged"
        } else {
            val tagged = "${safe.take(40)}-$id"
            if (kind == AssetKind.MODEL) "$kind/$tagged" else "${kind.path}/$tagged"
        }
    }

    private fun sanitizeFilename(name: String): String {
        if (name.isBlank()) return "asset"
        return name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
    }
}
