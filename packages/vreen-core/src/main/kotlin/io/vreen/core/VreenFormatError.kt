package io.vreen.core

/** Single validation issue with level and location. */
data class ValidationIssue(
    val level: Level,
    val code: String,
    val message: String,
    val path: String? = null,
) {
    enum class Level { ERROR, WARNING, INFO }
}

/** Summary of a validation run. */
data class ValidationReport(
    val ok: Boolean,
    val issues: List<ValidationIssue>,
    val stats: ValidationStats,
    val durationMs: Long,
)

data class ValidationStats(
    val assetCount: Int,
    val totalAssetBytes: Long,
    val modelCount: Int,
    val textureCount: Int,
    val hdriCount: Int,
    val audioCount: Int,
    val entityCount: Int,
)

/** Base exception. */
open class VreenFormatError(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
