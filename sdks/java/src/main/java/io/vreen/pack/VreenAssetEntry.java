package io.vreen.pack;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Single asset entry inside a {@link VreenManifest}.
 *
 * Mirrors {@code VreenAssetEntry} in {@code src/lib/vreenManifest.ts}. Fields
 * whose TS type is {@code Record<string, unknown>} are exposed here as
 * {@link JsonNode} so callers can inspect them without forcing a strict
 * POJO mapping (most build-time tools only care about id / kind / size).
 *
 * <p>Instances are immutable. To create one, use the canonical constructor
 * or {@link Builder}.
 */
public final class VreenAssetEntry {

    /** Stable asset id (uuid-style). */
    public final String id;
    /** Asset kind — see {@link AssetKind}. */
    public final String kind;
    /** In-package relative path (e.g. {@code assets/model_abc.glb}). */
    public final String path;
    /** File size in bytes. */
    public final long size;
    /** Original file name as uploaded by the user. */
    public final String originalName;
    /** Optional sha256 (hex) of the asset bytes. */
    public final String sha256;
    /** Optional free-form metadata (image dimensions, etc.). */
    public final JsonNode meta;

    private VreenAssetEntry(Builder b) {
        this.id = b.id;
        this.kind = b.kind;
        this.path = b.path;
        this.size = b.size;
        this.originalName = b.originalName;
        this.sha256 = b.sha256;
        this.meta = b.meta;
    }

    public Builder toBuilder() {
        return new Builder()
                .id(id)
                .kind(kind)
                .path(path)
                .size(size)
                .originalName(originalName)
                .sha256(sha256)
                .meta(meta);
    }

    public static Builder builder() {
        return new Builder();
    }

    /** Asset kind values. */
    public static final class AssetKind {
        public static final String MODEL = "model";
        public static final String TEXTURE = "texture";
        public static final String HDRI = "hdri";
        public static final String AUDIO = "audio";

        private AssetKind() {
            // no instances
        }
    }

    /** In-package directory per kind. Matches {@code VREEN_ASSET_DIRS} in TS. */
    public static String dirFor(String kind) {
        return switch (kind) {
            case AssetKind.MODEL -> "assets";
            case AssetKind.TEXTURE -> "assets/textures";
            case AssetKind.HDRI -> "assets/hdri";
            case AssetKind.AUDIO -> "assets/audio";
            default -> throw new VreenPackageException("unknown asset kind: " + kind);
        };
    }

    public static final class Builder {
        private String id;
        private String kind;
        private String path;
        private long size;
        private String originalName;
        private String sha256;
        private JsonNode meta;

        public Builder id(String v) { this.id = v; return this; }
        public Builder kind(String v) { this.kind = v; return this; }
        public Builder path(String v) { this.path = v; return this; }
        public Builder size(long v) { this.size = v; return this; }
        public Builder originalName(String v) { this.originalName = v; return this; }
        public Builder sha256(String v) { this.sha256 = v; return this; }
        public Builder meta(JsonNode v) { this.meta = v; return this; }

        public VreenAssetEntry build() {
            if (id == null || id.isEmpty()) throw new VreenPackageException("asset.id missing");
            if (kind == null || kind.isEmpty()) throw new VreenPackageException("asset.kind missing");
            if (path == null || path.isEmpty()) throw new VreenPackageException("asset.path missing");
            return new VreenAssetEntry(this);
        }
    }
}
