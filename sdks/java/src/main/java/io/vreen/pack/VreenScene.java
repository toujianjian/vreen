package io.vreen.pack;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * {@code scene.json} payload inside a {@code .vreen} package.
 *
 * Mirrors {@code VreenScene} in {@code src/lib/vreenManifest.ts}. The free-form
 * sections (camera / environment / postFX / materials) are exposed as
 * {@link JsonNode} so callers can edit them as raw JSON.
 *
 * <p>Scene is immutable; mutate via {@link Builder} or {@link #toBuilder()}.
 */
public final class VreenScene {

    public final String version;
    public final JsonNode camera;
    public final double animationSpeed;
    public final JsonNode environment;
    public final JsonNode postFX;
    public final JsonNode materials;

    private VreenScene(Builder b) {
        this.version = b.version;
        this.camera = b.camera;
        this.animationSpeed = b.animationSpeed;
        this.environment = b.environment;
        this.postFX = b.postFX;
        this.materials = b.materials;
    }

    public Builder toBuilder() {
        return new Builder()
                .version(version)
                .camera(camera)
                .animationSpeed(animationSpeed)
                .environment(environment)
                .postFX(postFX)
                .materials(materials);
    }

    public static Builder builder() {
        return new Builder().version(VreenFormatVersion.CURRENT).animationSpeed(1.0);
    }

    public static final class Builder {
        private String version = VreenFormatVersion.CURRENT;
        private JsonNode camera;
        private double animationSpeed = 1.0;
        private JsonNode environment;
        private JsonNode postFX;
        private JsonNode materials;

        public Builder version(String v) { this.version = v; return this; }
        public Builder camera(JsonNode v) { this.camera = v; return this; }
        public Builder animationSpeed(double v) { this.animationSpeed = v; return this; }
        public Builder environment(JsonNode v) { this.environment = v; return this; }
        public Builder postFX(JsonNode v) { this.postFX = v; return this; }
        public Builder materials(JsonNode v) { this.materials = v; return this; }

        public VreenScene build() {
            if (!VreenFormatVersion.CURRENT.equals(version)) {
                throw new VreenPackageException(
                        "scene.version must be \"" + VreenFormatVersion.CURRENT + "\" (got " + version + ")");
            }
            if (camera == null) throw new VreenPackageException("scene.camera missing");
            if (environment == null) throw new VreenPackageException("scene.environment missing");
            if (postFX == null) throw new VreenPackageException("scene.postFX missing");
            if (materials == null) throw new VreenPackageException("scene.materials missing");
            return new VreenScene(this);
        }
    }
}
