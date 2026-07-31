import { describe, it, expect } from 'vitest';
import { ColladaLoader, parseCollada } from './ColladaLoader';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';

/** Count Mesh nodes anywhere under `root` (recursively). */
function countMeshes(root: { children: unknown[] }): number {
  let n = 0;
  function walk(node: { children: unknown[] }): void {
    if (node instanceof Mesh) n++;
    const children = (node as { children: { children: unknown[] }[] }).children;
    if (children) for (const c of children) walk(c as { children: unknown[] });
  }
  walk(root);
  return n;
}

/** Minimal .dae with one box geometry (12 triangles) instanced by a node. */
function boxDAE(): string {
  return `<?xml version="1.0"?>
<COLLADA version="1.4.1">
  <library_geometries>
    <geometry id="box-geom" name="box">
      <mesh>
        <source id="box-pos">
          <float_array id="box-pos-array" count="24">0 0 0 1 0 0 1 1 0 0 1 0 0 0 1 1 0 1 1 1 1 0 1 1</float_array>
          <technique_common>
            <accessor source="#box-pos-array" count="8" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="box-vertices">
          <input semantic="POSITION" source="#box-pos"/>
        </vertices>
        <triangles material="boxmat" count="12">
          <input semantic="VERTEX" source="#box-vertices" offset="0"/>
          <p>0 2 1 0 3 2 4 5 6 4 6 7 0 1 5 0 5 4 1 2 6 1 6 5 3 7 6 3 6 2 0 4 7 0 7 3</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="Box" name="Box" type="NODE">
        <instance_geometry url="#box-geom"/>
      </node>
    </visual_scene>
  </library_visual_scenes>
</COLLADA>`;
}

/** .dae with two geometries, each instanced by its own node. */
function twoGeomDAE(): string {
  return `<?xml version="1.0"?>
<COLLADA version="1.4.1">
  <library_geometries>
    <geometry id="g1">
      <mesh>
        <source id="p1"><float_array id="p1a" count="9">0 0 0 1 0 0 0 1 0</float_array>
          <technique_common><accessor source="#p1a" count="3" stride="3"/></technique_common></source>
        <vertices id="v1"><input semantic="POSITION" source="#p1"/></vertices>
        <triangles count="1"><input semantic="VERTEX" source="#v1" offset="0"/><p>0 1 2</p></triangles>
      </mesh>
    </geometry>
    <geometry id="g2">
      <mesh>
        <source id="p2"><float_array id="p2a" count="9">0 0 0 1 0 0 1 1 0</float_array>
          <technique_common><accessor source="#p2a" count="3" stride="3"/></technique_common></source>
        <vertices id="v2"><input semantic="POSITION" source="#p2"/></vertices>
        <triangles count="1"><input semantic="VERTEX" source="#v2" offset="0"/><p>0 1 2</p></triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="N1" name="N1" type="NODE"><instance_geometry url="#g1"/></node>
      <node id="N2" name="N2" type="NODE"><instance_geometry url="#g2"/></node>
    </visual_scene>
  </library_visual_scenes>
</COLLADA>`;
}

/** .dae with a material (red) bound to a geometry. */
function materialDAE(): string {
  return `<?xml version="1.0"?>
<COLLADA version="1.4.1">
  <library_materials>
    <material id="redmat" name="red">
      <instance_effect url="#redfx"/>
    </material>
  </library_materials>
  <library_effects>
    <effect id="redfx">
      <profile_COMMON>
        <phong>
          <diffuse><color>1 0 0 1</color></diffuse>
        </phong>
      </profile_COMMON>
    </effect>
  </library_effects>
  <library_geometries>
    <geometry id="tri">
      <mesh>
        <source id="tp"><float_array id="tpa" count="9">0 0 0 1 0 0 0 1 0</float_array>
          <technique_common><accessor source="#tpa" count="3" stride="3"/></technique_common></source>
        <vertices id="tv"><input semantic="POSITION" source="#tp"/></vertices>
        <triangles material="redmat" count="1"><input semantic="VERTEX" source="#tv" offset="0"/><p>0 1 2</p></triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="N" name="N" type="NODE">
        <instance_geometry url="#tri">
          <bind_material>
            <technique_common>
              <instance_material symbol="redmat" target="#redmat"/>
            </technique_common>
          </bind_material>
        </instance_geometry>
      </node>
    </visual_scene>
  </library_visual_scenes>
</COLLADA>`;
}

/** .dae with a parent node containing a child node (nested hierarchy). */
function hierarchyDAE(): string {
  return `<?xml version="1.0"?>
<COLLADA version="1.4.1">
  <library_geometries>
    <geometry id="g1">
      <mesh>
        <source id="p1"><float_array id="p1a" count="9">0 0 0 1 0 0 0 1 0</float_array>
          <technique_common><accessor source="#p1a" count="3" stride="3"/></technique_common></source>
        <vertices id="v1"><input semantic="POSITION" source="#p1"/></vertices>
        <triangles count="1"><input semantic="VERTEX" source="#v1" offset="0"/><p>0 1 2</p></triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="Parent" name="Parent" type="NODE">
        <translate>0 1 0</translate>
        <node id="Child" name="Child" type="NODE">
          <translate>2 0 0</translate>
          <instance_geometry url="#g1"/>
        </node>
      </node>
    </visual_scene>
  </library_visual_scenes>
</COLLADA>`;
}

/** .dae with a polylist using quads (vcount=4) that must be triangulated. */
function polylistDAE(): string {
  return `<?xml version="1.0"?>
<COLLADA version="1.4.1">
  <library_geometries>
    <geometry id="quad-geom">
      <mesh>
        <source id="qp"><float_array id="qpa" count="12">0 0 0 1 0 0 1 1 0 0 1 0</float_array>
          <technique_common><accessor source="#qpa" count="4" stride="3"/></technique_common></source>
        <vertices id="qv"><input semantic="POSITION" source="#qp"/></vertices>
        <polylist count="1">
          <input semantic="VERTEX" source="#qv" offset="0"/>
          <vcount>4</vcount>
          <p>0 1 2 3</p>
        </polylist>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="Q" name="Q" type="NODE"><instance_geometry url="#quad-geom"/></node>
    </visual_scene>
  </library_visual_scenes>
</COLLADA>`;
}

describe('ColladaLoader', () => {
  it('parses a minimal .dae with one box geometry → 1 mesh in scene', () => {
    const { scene, geometries } = new ColladaLoader().parse(boxDAE());
    expect(geometries.size).toBe(1);
    expect(geometries.has('box-geom')).toBe(true);
    expect(countMeshes(scene)).toBe(1);
    const geom = geometries.get('box-geom')!;
    // 12 triangles × 3 verts = 36 expanded vertices, 36 indices.
    expect(geom.attributes.position.count).toBe(36);
    expect(geom.index?.count).toBe(36);
  });

  it('parses a .dae with 2 geometries → 2 meshes in scene', () => {
    const { scene, geometries } = new ColladaLoader().parse(twoGeomDAE());
    expect(geometries.size).toBe(2);
    expect(countMeshes(scene)).toBe(2);
  });

  it('parses a .dae with a material → material present in result', () => {
    const { materials, scene } = new ColladaLoader().parse(materialDAE());
    expect(materials.size).toBe(1);
    expect(materials.has('redmat')).toBe(true);
    const mat = materials.get('redmat')!;
    expect(mat.baseColor.r).toBeCloseTo(1, 5);
    expect(mat.baseColor.g).toBeCloseTo(0, 5);
    expect(mat.baseColor.b).toBeCloseTo(0, 5);
    // The mesh should use the bound material (red), not a default grey.
    const meshes = collectMeshes(scene);
    expect(meshes.length).toBe(1);
    expect(meshes[0].material).toBe(mat);
  });

  it('parses a .dae with a node hierarchy → scene has nested groups', () => {
    const { scene } = new ColladaLoader().parse(hierarchyDAE());
    // Parent group at top level.
    expect(scene.children.length).toBe(1);
    const parent = scene.children[0] as Group;
    expect(parent.name).toBe('Parent');
    // Child group nested under parent.
    expect(parent.children.length).toBe(1);
    const child = parent.children[0] as Group;
    expect(child.name).toBe('Child');
    // Mesh is under the child node.
    expect(countMeshes(child)).toBe(1);
    // Transforms applied: parent translated (0,1,0), child (2,0,0).
    expect(parent.position.y).toBeCloseTo(1, 5);
    expect(child.position.x).toBeCloseTo(2, 5);
  });

  it('parses invalid XML → returns empty scene (no meshes)', () => {
    const result = new ColladaLoader().parse('this is not xml at all');
    expect(result.scene.children.length).toBe(0);
    expect(result.geometries.size).toBe(0);
    expect(countMeshes(result.scene)).toBe(0);
  });

  it('parses a .dae with polylist (quads) → triangulated to 2 triangles', () => {
    const { geometries } = new ColladaLoader().parse(polylistDAE());
    const geom = geometries.get('quad-geom')!;
    // 1 quad → 2 triangles = 6 indices.
    expect(geom.index?.count).toBe(6);
    // 4 expanded vertices.
    expect(geom.attributes.position.count).toBe(4);
  });

  it('parseCollada function shorthand works', () => {
    const result = parseCollada(boxDAE());
    expect(result.geometries.size).toBe(1);
    expect(countMeshes(result.scene)).toBe(1);
  });
});

/** Collect all Mesh nodes under `root` into a flat array. */
function collectMeshes(root: { children: unknown[] }): Mesh[] {
  const out: Mesh[] = [];
  function walk(node: { children: unknown[] }): void {
    if (node instanceof Mesh) out.push(node);
    const children = (node as { children: { children: unknown[] }[] }).children;
    if (children) for (const c of children) walk(c as { children: unknown[] });
  }
  walk(root);
  return out;
}
