package io.vreen.pack;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Embedded ECS world inside a {@code .vreen} package.
 *
 * Mirrors {@code VreenWorldJson} in {@code src/lib/vreenManifest.ts}. The world
 * is a flat list of entities with POJO components; the Java side does not
 * interpret the components, it just preserves them as a JSON object map so a
 * headless ECS (or tool) can replay / transform them.
 *
 * <p>World is mutable so callers can add or remove entities; field references
 * are stable but entity list changes as needed.
 */
public final class VreenWorldJson {

    public final String version;
    public final String name;
    public final long frame;
    public final List<VreenEntityJson> entities;

    public VreenWorldJson() {
        this(VreenFormatVersion.WORLD, "World", 0, new ArrayList<>());
    }

    public VreenWorldJson(String name, long frame, List<VreenEntityJson> entities) {
        this(VreenFormatVersion.WORLD, name, frame, new ArrayList<>(entities));
    }

    public VreenWorldJson(String version, String name, long frame, List<VreenEntityJson> entities) {
        if (!VreenFormatVersion.WORLD.equals(version)) {
            throw new VreenPackageException(
                    "world.version must be \"" + VreenFormatVersion.WORLD + "\" (got " + version + ")");
        }
        this.version = version;
        this.name = name;
        this.frame = frame;
        this.entities = Collections.unmodifiableList(new ArrayList<>(entities));
    }

    public int entityCount() {
        return entities.size();
    }

    public VreenEntityJson entityById(int id) {
        for (VreenEntityJson e : entities) {
            if (e.id == id) return e;
        }
        return null;
    }
}
