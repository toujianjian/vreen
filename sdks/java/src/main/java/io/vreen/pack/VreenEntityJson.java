package io.vreen.pack;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Single entity in an embedded {@link VreenWorldJson}.
 *
 * Mirrors {@code VreenEntityJson} in {@code src/lib/vreenManifest.ts}. The
 * scene-node transform is exposed as plain fields, components as a JSON
 * object map ({@code componentName → data}).
 */
public final class VreenEntityJson {

    public final int id;
    public final String name;
    public final int version;
    public final int index;
    public final float[] position;   // length 3
    public final float[] rotation;   // length 4 (quaternion x,y,z,w)
    public final float[] scale;      // length 3
    public final Map<String, JsonNode> components;

    public VreenEntityJson(int id, String name, int version, int index,
                           float[] position, float[] rotation, float[] scale,
                           Map<String, JsonNode> components) {
        this.id = id;
        this.name = name;
        this.version = version;
        this.index = index;
        this.position = position == null ? new float[3] : position.clone();
        this.rotation = rotation == null ? new float[]{0, 0, 0, 1} : rotation.clone();
        this.scale = scale == null ? new float[]{1, 1, 1} : scale.clone();
        this.components = components == null
                ? Collections.emptyMap()
                : Collections.unmodifiableMap(new LinkedHashMap<>(components));
    }

    public JsonNode component(String name) {
        return components.get(name);
    }
}
