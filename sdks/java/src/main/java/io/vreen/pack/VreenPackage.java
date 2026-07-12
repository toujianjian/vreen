package io.vreen.pack;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Read / write {@code .vreen} packages.
 *
 * A {@code .vreen} file is a ZIP archive with this layout:
 * <pre>
 *   manifest.json        — top-level index (VreenManifest)
 *   scene.json           — camera / animation / environment / postFX / materials
 *   state.json           — OPTIONAL, 0.1.x legacy alias for project.json
 *   assets/              — main model + textures + hdri + audio
 * </pre>
 *
 * Use {@link #read(Path)} to load a package, or {@link #write(Path, VreenManifest, VreenScene, Map)}
 * to write one. The top-level result is a {@link ReadResult} holding the
 * manifest, scene, raw asset bytes (id → bytes), and the original ZIP entry
 * paths.
 *
 * <p>This SDK targets Java 17+ (records, switch expressions, text blocks).
 * JSON via Jackson 2.16+, ZIP via {@code java.util.zip} (no extra deps).
 *
 * <p>Mirrors {@code src/lib/vreenPack.ts} in the vreen web app.
 */
public final class VreenPackage {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);

    public static final String MANIFEST_PATH = "manifest.json";
    public static final String SCENE_PATH = "scene.json";
    public static final String STATE_LEGACY_PATH = "state.json";
    public static final String ASSETS_DIR = "assets/";

    private VreenPackage() {
        // no instances
    }

    // ── Read ────────────────────────────────────────────────────────

    /**
     * Result of {@link VreenPackage#read(Path)} or {@link #read(InputStream)}.
     * Asset bytes are kept in memory; large packages (HDRI, big GLBs) will
     * pin a lot of heap. For very large packages use streaming readers.
     */
    public static final class ReadResult {
        public final VreenManifest manifest;
        public final VreenScene scene;
        /** asset id → raw bytes. */
        public final Map<String, byte[]> assets;
        /** asset id → ZIP entry path (for debugging). */
        public final Map<String, String> assetPaths;
        /** was the package a 0.1.x legacy shape? */
        public final boolean legacy;

        public ReadResult(VreenManifest manifest, VreenScene scene,
                          Map<String, byte[]> assets, Map<String, String> assetPaths,
                          boolean legacy) {
            this.manifest = manifest;
            this.scene = scene;
            this.assets = Collections.unmodifiableMap(assets);
            this.assetPaths = Collections.unmodifiableMap(assetPaths);
            this.legacy = legacy;
        }
    }

    /** Read a .vreen package from disk. */
    public static ReadResult read(Path file) throws IOException {
        try (InputStream in = Files.newInputStream(file)) {
            return read(in);
        }
    }

    /** Read a .vreen package from an arbitrary input stream. */
    public static ReadResult read(InputStream in) throws IOException {
        // Stage 1: load the whole ZIP into memory (we need random access by
        // path for manifest.json / scene.json / assets).
        Map<String, byte[]> entries = new HashMap<>();
        try (ZipInputStream zin = new ZipInputStream(in)) {
            ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                zin.transferTo(buf);
                entries.put(e.getName(), buf.toByteArray());
            }
        }

        byte[] manifestBytes = entries.get(MANIFEST_PATH);
        if (manifestBytes == null) {
            // 0.1.x legacy: state.json is the old project.json, no manifest
            byte[] stateBytes = entries.get(STATE_LEGACY_PATH);
            if (stateBytes == null) {
                throw new VreenPackageException(
                        "package missing both manifest.json and state.json — not a valid .vreen");
            }
            return readLegacy(stateBytes, entries);
        }

        // 0.2.x: parse manifest + scene
        VreenManifest manifest;
        try {
            manifest = parseManifest(manifestBytes);
        } catch (JsonProcessingException ex) {
            throw new VreenPackageException("manifest.json is not valid JSON", ex);
        }
        validateManifest(manifest);

        byte[] sceneBytes = entries.get(SCENE_PATH);
        if (sceneBytes == null) {
            throw new VreenPackageException("package missing scene.json (required for 0.2.x)");
        }
        VreenScene scene;
        try {
            scene = parseScene(sceneBytes);
        } catch (JsonProcessingException ex) {
            throw new VreenPackageException("scene.json is not valid JSON", ex);
        }

        // Collect asset bytes by id
        Map<String, byte[]> assets = new LinkedHashMap<>();
        Map<String, String> paths = new LinkedHashMap<>();
        for (VreenAssetEntry a : manifest.assets) {
            byte[] data = entries.get(a.path);
            if (data == null) {
                throw new VreenPackageException(
                        "manifest references asset \"" + a.id + "\" at path \"" + a.path
                                + "\" but no such entry in the zip");
            }
            assets.put(a.id, data);
            paths.put(a.id, a.path);
        }

        return new ReadResult(manifest, scene, assets, paths, false);
    }

    // ── Write ───────────────────────────────────────────────────────

    /**
     * Write a .vreen package to disk.
     *
     * @param file      target path
     * @param manifest  manifest; its {@code assets} list is the source of truth
     *                  for which files go into the zip
     * @param scene     scene.json payload
     * @param assets    asset id → bytes; every id in {@code manifest.assets}
     *                  must have a corresponding entry here
     */
    public static void write(Path file, VreenManifest manifest, VreenScene scene,
                             Map<String, byte[]> assets) throws IOException {
        // Ensure every manifest asset has bytes
        for (VreenAssetEntry a : manifest.assets) {
            if (!assets.containsKey(a.id)) {
                throw new VreenPackageException(
                        "missing bytes for asset \"" + a.id + "\" (kind=" + a.kind
                                + ", path=" + a.path + ")");
            }
        }
        // Make sure parent dir exists
        Path parent = file.toAbsolutePath().getParent();
        if (parent != null) Files.createDirectories(parent);

        byte[] manifestJson = MAPPER.writeValueAsBytes(manifestToNode(manifest));
        byte[] sceneJson = MAPPER.writeValueAsBytes(sceneToNode(scene));

        try (OutputStream out = Files.newOutputStream(file);
             ZipOutputStream zout = new ZipOutputStream(out)) {
            writeEntry(zout, MANIFEST_PATH, manifestJson);
            writeEntry(zout, SCENE_PATH, sceneJson);
            for (VreenAssetEntry a : manifest.assets) {
                writeEntry(zout, a.path, assets.get(a.id));
            }
        }
    }

    private static void writeEntry(ZipOutputStream zout, String name, byte[] data) throws IOException {
        ZipEntry e = new ZipEntry(name);
        e.setSize(data.length);
        // CRC not strictly required for STORED; DEFLATED picks up compression by default
        zout.putNextEntry(e);
        zout.write(data);
        zout.closeEntry();
    }

    // ── Utilities ───────────────────────────────────────────────────

    /** Compute sha256 of a byte array and return as lowercase hex. */
    public static String sha256Hex(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(data);
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new VreenPackageException("SHA-256 not available", e);
        }
    }

    // ── JSON: manifest ↔ tree ───────────────────────────────────────

    private static VreenManifest parseManifest(byte[] bytes) throws IOException {
        ObjectNode root = (ObjectNode) MAPPER.readTree(bytes);
        String version = textOrThrow(root, "version");
        String exportedAt = textOrThrow(root, "exportedAt");
        String name = textOrThrow(root, "name");
        String assetName = textOrThrow(root, "assetName");
        String generator = textOrNull(root, "generator", "vreen-java-sdk");
        String primaryModelId = root.has("primaryModelId") && !root.get("primaryModelId").isNull()
                ? root.get("primaryModelId").asText() : null;

        VreenManifest.Builder b = VreenManifest.builder()
                .exportedAt(exportedAt)
                .name(name)
                .assetName(assetName)
                .primaryModelId(primaryModelId)
                .generator(generator);

        for (JsonNode an : root.get("assets")) {
            ObjectNode ao = (ObjectNode) an;
            VreenAssetEntry.Builder ab = VreenAssetEntry.builder()
                    .id(textOrThrow(ao, "id"))
                    .kind(textOrThrow(ao, "kind"))
                    .path(textOrThrow(ao, "path"))
                    .size(ao.get("size").asLong());
            if (ao.has("originalName") && !ao.get("originalName").isNull()) {
                ab.originalName(ao.get("originalName").asText());
            }
            if (ao.has("sha256") && !ao.get("sha256").isNull()) {
                ab.sha256(ao.get("sha256").asText());
            }
            if (ao.has("meta") && !ao.get("meta").isNull()) {
                ab.meta(ao.get("meta"));
            }
            b.addAsset(ab.build());
        }

        if (root.has("world") && !root.get("world").isNull()) {
            b.world(parseWorld(root.get("world")));
        }

        return b.build();
    }

    private static ObjectNode manifestToNode(VreenManifest m) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("version", m.version);
        root.put("exportedAt", m.exportedAt);
        root.put("name", m.name);
        root.put("assetName", m.assetName);
        root.put("generator", m.generator);
        if (m.primaryModelId == null) {
            root.putNull("primaryModelId");
        } else {
            root.put("primaryModelId", m.primaryModelId);
        }
        var arr = root.putArray("assets");
        for (VreenAssetEntry a : m.assets) {
            ObjectNode an = arr.addObject();
            an.put("id", a.id);
            an.put("kind", a.kind);
            an.put("path", a.path);
            an.put("size", a.size);
            if (a.originalName != null) an.put("originalName", a.originalName);
            if (a.sha256 != null) an.put("sha256", a.sha256);
            if (a.meta != null) an.set("meta", a.meta);
        }
        if (m.world != null) {
            root.set("world", worldToNode(m.world));
        }
        return root;
    }

    private static VreenScene parseScene(byte[] bytes) throws IOException {
        ObjectNode root = (ObjectNode) MAPPER.readTree(bytes);
        return VreenScene.builder()
                .version(textOrThrow(root, "version"))
                .camera(root.get("camera"))
                .animationSpeed(root.get("animation").get("speed").asDouble())
                .environment(root.get("environment"))
                .postFX(root.get("postFX"))
                .materials(root.get("materials"))
                .build();
    }

    private static ObjectNode sceneToNode(VreenScene s) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("version", s.version);
        root.set("camera", s.camera);
        ObjectNode anim = root.putObject("animation");
        anim.put("speed", s.animationSpeed);
        root.set("environment", s.environment);
        root.set("postFX", s.postFX);
        root.set("materials", s.materials);
        return root;
    }

    private static VreenWorldJson parseWorld(JsonNode w) {
        String version = textOrThrow((ObjectNode) w, "version");
        String name = w.get("name").asText("World");
        long frame = w.get("frame").asLong(0);
        List<VreenEntityJson> entities = new ArrayList<>();
        for (JsonNode en : w.get("entities")) {
            ObjectNode eo = (ObjectNode) en;
            int id = eo.get("id").asInt();
            String eName = eo.get("name").asText("");
            int ver = eo.has("version") ? eo.get("version").asInt() : 0;
            int idx = eo.has("index") ? eo.get("index").asInt() : 0;
            ObjectNode sn = (ObjectNode) eo.get("sceneNode");
            float[] pos = nodeToFloat3(sn.get("position"));
            float[] rot = nodeToFloat4(sn.get("rotation"));
            float[] scl = nodeToFloat3(sn.get("scale"));
            Map<String, JsonNode> comps = new LinkedHashMap<>();
            JsonNode compsNode = eo.get("components");
            if (compsNode != null && compsNode.isObject()) {
                compsNode.fields().forEachRemaining(entry -> comps.put(entry.getKey(), entry.getValue()));
            }
            entities.add(new VreenEntityJson(id, eName, ver, idx, pos, rot, scl, comps));
        }
        return new VreenWorldJson(version, name, frame, entities);
    }

    private static JsonNode worldToNode(VreenWorldJson w) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("version", w.version);
        root.put("name", w.name);
        root.put("frame", w.frame);
        var arr = root.putArray("entities");
        for (VreenEntityJson e : w.entities) {
            ObjectNode en = arr.addObject();
            en.put("id", e.id);
            en.put("name", e.name);
            en.put("version", e.version);
            en.put("index", e.index);
            ObjectNode sn = en.putObject("sceneNode");
            sn.putArray("position").add(e.position[0]).add(e.position[1]).add(e.position[2]);
            sn.putArray("rotation").add(e.rotation[0]).add(e.rotation[1]).add(e.rotation[2]).add(e.rotation[3]);
            sn.putArray("scale").add(e.scale[0]).add(e.scale[1]).add(e.scale[2]);
            ObjectNode comps = en.putObject("components");
            e.components.forEach(comps::set);
        }
        return root;
    }

    // ── Legacy 0.1.x ───────────────────────────────────────────────

    private static ReadResult readLegacy(byte[] stateBytes, Map<String, byte[]> entries) throws IOException {
        ObjectNode state = (ObjectNode) MAPPER.readTree(stateBytes);
        // Old project.json is one big object with camera/materials/etc.
        // Lift into a 0.2.x manifest + scene.
        String assetName = state.has("assetName") ? state.get("assetName").asText("legacy") : "legacy";
        String name = "legacy-import";
        String generator = "vreen-java-sdk-legacy-import";

        // 0.1.x had a single model.<filename> — we sniff for any file under
        // the ZIP root that looks like a 3D model.
        VreenAssetEntry model = null;
        for (Map.Entry<String, byte[]> e : entries.entrySet()) {
            String p = e.getKey();
            if (p.equals(STATE_LEGACY_PATH) || p.endsWith("/")) continue;
            String lower = p.toLowerCase();
            if (lower.endsWith(".glb") || lower.endsWith(".gltf") || lower.endsWith(".obj")
                    || lower.endsWith(".fbx") || lower.endsWith(".stl")) {
                model = VreenAssetEntry.builder()
                        .id("legacy-model-0")
                        .kind(VreenAssetEntry.AssetKind.MODEL)
                        .path(p)
                        .size(e.getValue().length)
                        .originalName(p)
                        .build();
                break;
            }
        }

        VreenManifest.Builder mb = VreenManifest.builder()
                .exportedAt(java.time.Instant.now().toString())
                .name(name)
                .assetName(assetName)
                .generator(generator);
        Map<String, byte[]> assets = new LinkedHashMap<>();
        Map<String, String> paths = new LinkedHashMap<>();
        if (model != null) {
            mb.addAsset(model).primaryModelId(model.id);
            assets.put(model.id, entries.get(model.path));
            paths.put(model.id, model.path);
        }

        VreenScene scene = VreenScene.builder()
                .camera(state.get("camera"))
                .animationSpeed(state.has("animation") ? state.get("animation").get("speed").asDouble(1.0) : 1.0)
                .environment(state.get("environment"))
                .postFX(state.get("postFX"))
                .materials(state.get("materials"))
                .build();

        return new ReadResult(mb.build(), scene, assets, paths, true);
    }

    // ── Validation ──────────────────────────────────────────────────

    private static void validateManifest(VreenManifest m) {
        if (!VreenFormatVersion.CURRENT.equals(m.version)) {
            throw new VreenPackageException(
                    "manifest.version must be \"" + VreenFormatVersion.CURRENT + "\" (got " + m.version + ")");
        }
        if (m.primaryModelId != null) {
            boolean ok = m.assets.stream().anyMatch(a -> a.id.equals(m.primaryModelId));
            if (!ok) {
                throw new VreenPackageException(
                        "primaryModelId \"" + m.primaryModelId + "\" not in assets[]");
            }
        }
    }

    // ── JsonNode helpers ────────────────────────────────────────────

    private static String textOrThrow(ObjectNode n, String field) {
        if (!n.has(field) || n.get(field).isNull()) {
            throw new VreenPackageException("required field missing or null: " + field);
        }
        return n.get(field).asText();
    }

    private static String textOrNull(ObjectNode n, String field, String def) {
        if (!n.has(field) || n.get(field).isNull()) return def;
        return n.get(field).asText();
    }

    private static float[] nodeToFloat3(JsonNode n) {
        if (n == null || !n.isArray() || n.size() != 3) return new float[3];
        return new float[]{
                (float) n.get(0).asDouble(),
                (float) n.get(1).asDouble(),
                (float) n.get(2).asDouble()
        };
    }

    private static float[] nodeToFloat4(JsonNode n) {
        if (n == null || !n.isArray() || n.size() != 4) return new float[]{0, 0, 0, 1};
        return new float[]{
                (float) n.get(0).asDouble(),
                (float) n.get(1).asDouble(),
                (float) n.get(2).asDouble(),
                (float) n.get(3).asDouble()
        };
    }
}
