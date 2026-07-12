package io.vreen.pack;

/**
 * VREEN package format version constants.
 *
 * Matches {@code src/lib/vreenManifest.ts} in the vreen web app. The web app
 * is the source of truth for the schema; this Java SDK is a read/write twin
 * for build-time tools (Maven / Gradle plugin, asset pipeline, server-side
 * validation, headless ECS replay, etc.).
 *
 * Schema versions:
 * <ul>
 *   <li>{@code 0.1.x} — legacy: single {@code project.json}, no manifest.</li>
 *   <li>{@code 0.2.x} — current: manifest + scene + state + assets/ layout.</li>
 * </ul>
 */
public final class VreenFormatVersion {

    /** Current manifest / scene / state version. */
    public static final String CURRENT = "0.2.1";

    /** Embedded ECS world JSON version. */
    public static final String WORLD = "0.2.0";

    /** Legacy 0.1.x project.json version. */
    public static final String LEGACY = "0.1.0";

    private VreenFormatVersion() {
        // no instances
    }
}
