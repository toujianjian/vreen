package io.vreen.pack;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Top-level manifest of a {@code .vreen} package.
 *
 * Mirrors {@code VreenManifest} in {@code src/lib/vreenManifest.ts}. The
 * manifest is the index into the package: it lists every asset, points to the
 * primary model, and optionally embeds an ECS world.
 *
 * <p>Use {@link #builder()} to create a new manifest. {@link #toBuilder()}
 * returns a builder pre-populated with this manifest's data.
 */
public final class VreenManifest {

    public final String version;
    public final String exportedAt;     // ISO 8601 UTC
    public final String name;
    public final String assetName;
    public final List<VreenAssetEntry> assets;
    public final String primaryModelId; // nullable
    public final VreenWorldJson world;  // nullable
    public final String generator;

    private VreenManifest(Builder b) {
        this.version = b.version;
        this.exportedAt = b.exportedAt;
        this.name = b.name;
        this.assetName = b.assetName;
        this.assets = Collections.unmodifiableList(new ArrayList<>(b.assets));
        this.primaryModelId = b.primaryModelId;
        this.world = b.world;
        this.generator = b.generator;
    }

    public Builder toBuilder() {
        return new Builder()
                .version(version)
                .exportedAt(exportedAt)
                .name(name)
                .assetName(assetName)
                .assets(assets)
                .primaryModelId(primaryModelId)
                .world(world)
                .generator(generator);
    }

    public static Builder builder() {
        return new Builder()
                .version(VreenFormatVersion.CURRENT)
                .exportedAt(java.time.Instant.now().toString())
                .generator("vreen-java-sdk");
    }

    public VreenAssetEntry primaryModel() {
        if (primaryModelId == null) return null;
        for (VreenAssetEntry a : assets) {
            if (a.id.equals(primaryModelId)) return a;
        }
        return null;
    }

    public long totalAssetBytes() {
        long n = 0;
        for (VreenAssetEntry a : assets) n += a.size;
        return n;
    }

    public static final class Builder {
        private String version = VreenFormatVersion.CURRENT;
        private String exportedAt = java.time.Instant.now().toString();
        private String name;
        private String assetName;
        private List<VreenAssetEntry> assets = new ArrayList<>();
        private String primaryModelId;
        private VreenWorldJson world;
        private String generator = "vreen-java-sdk";

        public Builder version(String v) { this.version = v; return this; }
        public Builder exportedAt(String v) { this.exportedAt = v; return this; }
        public Builder name(String v) { this.name = v; return this; }
        public Builder assetName(String v) { this.assetName = v; return this; }
        public Builder assets(List<VreenAssetEntry> v) { this.assets = new ArrayList<>(v); return this; }
        public Builder addAsset(VreenAssetEntry v) { this.assets.add(v); return this; }
        public Builder primaryModelId(String v) { this.primaryModelId = v; return this; }
        public Builder world(VreenWorldJson v) { this.world = v; return this; }
        public Builder generator(String v) { this.generator = v; return this; }

        public VreenManifest build() {
            if (!VreenFormatVersion.CURRENT.equals(version)) {
                throw new VreenPackageException(
                        "manifest.version must be \"" + VreenFormatVersion.CURRENT + "\" (got " + version + ")");
            }
            if (name == null || name.isEmpty()) throw new VreenPackageException("manifest.name missing");
            if (assetName == null || assetName.isEmpty()) throw new VreenPackageException("manifest.assetName missing");
            if (primaryModelId != null) {
                boolean ok = false;
                for (VreenAssetEntry a : assets) {
                    if (a.id.equals(primaryModelId)) { ok = true; break; }
                }
                if (!ok) throw new VreenPackageException(
                        "manifest.primaryModelId \"" + primaryModelId + "\" not present in assets[]");
            }
            return new VreenManifest(this);
        }
    }
}
