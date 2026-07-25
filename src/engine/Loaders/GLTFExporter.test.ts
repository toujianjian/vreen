import { describe, it, expect } from 'vitest';
import { GLTFExporter } from './GLTFExporter';
import { Scene } from '../Core/Scene';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';

/**
 * 构造一个简单三角形 mesh:
 *   顶点:(0,0,0) (1,0,0) (0,1,0)
 *   法线:(0,0,1) × 3
 *   UV: (0,0) (1,0) (0,1)
 *   索引:[0,1,2]
 */
function makeTriangleMesh(): Mesh {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  0, 1, 0,
  ]), 3));
  geom.setAttribute('normal', new BufferAttribute(new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]), 3));
  geom.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0,  1, 0,  0, 1,
  ]), 2));
  geom.setIndex([0, 1, 2]);
  geom.computeBoundingBox();
  const mat = new StandardMaterial();
  mat.baseColor = { r: 0.8, g: 0.4, b: 0.2 };
  mat.metallic = 0.3;
  mat.roughness = 0.7;
  mat.emissive = { r: 0.1, g: 0.05, b: 0 };
  const mesh = new Mesh(geom, mat);
  mesh.name = 'TriangleMesh';
  return mesh;
}

describe('GLTFExporter.parse', () => {
  it('导出 asset/scenes/nodes/meshes/materials/buffers 结构', () => {
    const scene = new Scene();
    scene.add(makeTriangleMesh());

    const exp = new GLTFExporter();
    const { json, bin } = exp.parse(scene);

    // asset
    const asset = json['asset'] as { version: string; generator: string };
    expect(asset.version).toBe('2.0');
    expect(asset.generator).toContain('VREEN');

    // scene 0 指向根节点列表
    const scenes = json['scenes'] as Array<{ nodes: number[] }>;
    expect(scenes).toHaveLength(1);
    expect(scenes[0].nodes).toHaveLength(1);
    expect(json['scene']).toBe(0);

    // 1 个 node(根)+ 1 个 node(scene 自身)
    // 我们的实现:Scene 自身也登记为 node 0,其子 mesh 为 node 1
    const nodes = json['nodes'] as Array<Record<string, unknown>>;
    expect(nodes.length).toBe(2);
    // node 0 是 Scene(无 mesh,有 children)
    expect(nodes[0]['children']).toBeDefined();
    // node 1 是 Mesh(有 mesh)
    expect(nodes[1]['mesh']).toBe(0);
    expect(nodes[1]['name']).toBe('TriangleMesh');

    // 1 个 mesh
    const meshes = json['meshes'] as Array<{ primitives: Array<Record<string, unknown>> }>;
    expect(meshes).toHaveLength(1);
    const prim = meshes[0].primitives[0];
    const attrs = prim['attributes'] as Record<string, number>;
    expect(attrs['POSITION']).toBeDefined();
    expect(attrs['NORMAL']).toBeDefined();
    expect(attrs['TEXCOORD_0']).toBeDefined();
    expect(prim['indices']).toBeDefined();
    expect(prim['material']).toBe(0);

    // 1 个 material(StandardMaterial → pbrMetallicRoughness)
    const materials = json['materials'] as Array<Record<string, unknown>>;
    expect(materials).toHaveLength(1);
    const pbr = materials[0]['pbrMetallicRoughness'] as Record<string, number[]>;
    expect(pbr['baseColorFactor']).toEqual([0.8, 0.4, 0.2, 1]);
    expect(pbr['metallicFactor']).toBe(0.3);
    expect(pbr['roughnessFactor']).toBe(0.7);
    expect(pbr['emissiveFactor']).toEqual([0.1, 0.05, 0]);

    // accessors:POSITION + NORMAL + UV + INDEX = 4
    const accessors = json['accessors'] as Array<Record<string, unknown>>;
    expect(accessors.length).toBe(4);

    // bufferViews:同上 4 个
    const bufferViews = json['bufferViews'] as Array<Record<string, unknown>>;
    expect(bufferViews.length).toBe(4);

    // buffers:1 个,byteLength 与 bin 一致
    const buffers = json['buffers'] as Array<{ byteLength: number }>;
    expect(buffers).toHaveLength(1);
    expect(buffers[0].byteLength).toBe(bin.byteLength);
    // BIN 应 ≥ 9 floats * 4 + 3 floats * 4 + 2 floats * 4 + 3 uint16 * 2 = 36+12+8+6 = 62(加 padding 后 ≥ 64)
    expect(bin.byteLength).toBeGreaterThan(60);
  });

  it('accessor 含正确的 min/max(POSITION)', () => {
    const scene = new Scene();
    scene.add(makeTriangleMesh());
    const { json } = new GLTFExporter().parse(scene);
    const accessors = json['accessors'] as Array<Record<string, unknown>>;
    // 第一个 accessor 是 POSITION
    const posAcc = accessors[0];
    expect(posAcc['componentType']).toBe(5126); // FLOAT
    expect(posAcc['type']).toBe('VEC3');
    expect(posAcc['count']).toBe(3);
    expect(posAcc['min']).toEqual([0, 0, 0]);
    expect(posAcc['max']).toEqual([1, 1, 0]);
  });

  it('索引 accessor 用 UNSIGNED_SHORT(顶点 < 65536)', () => {
    const scene = new Scene();
    scene.add(makeTriangleMesh());
    const { json } = new GLTFExporter().parse(scene);
    const accessors = json['accessors'] as Array<Record<string, unknown>>;
    // 最后一个 accessor 是 index
    const idxAcc = accessors[accessors.length - 1];
    expect(idxAcc['componentType']).toBe(5123); // UNSIGNED_SHORT
    expect(idxAcc['type']).toBe('SCALAR');
    expect(idxAcc['count']).toBe(3);
  });

  it('变换 translation/rotation/scale 写入 node', () => {
    const scene = new Scene();
    const mesh = makeTriangleMesh();
    mesh.position.set(10, 20, 30);
    mesh.scale.set(2, 2, 2);
    scene.add(mesh);
    const { json } = new GLTFExporter().parse(scene);
    const nodes = json['nodes'] as Array<Record<string, unknown>>;
    const meshNode = nodes[1];
    expect(meshNode['translation']).toEqual([10, 20, 30]);
    expect(meshNode['scale']).toEqual([2, 2, 2]);
    // rotation 默认 (0,0,0,1) 不写入
    expect(meshNode['rotation']).toBeUndefined();
  });

  it('嵌套 Group/Mesh 的层次结构正确', () => {
    const scene = new Scene();
    const grp = new Group();
    grp.name = 'ParentGroup';
    grp.position.set(1, 0, 0);
    const child = makeTriangleMesh();
    child.name = 'Child';
    grp.add(child);
    scene.add(grp);

    const { json } = new GLTFExporter().parse(scene);
    const nodes = json['nodes'] as Array<Record<string, unknown>>;
    // node 0: Scene
    // node 1: ParentGroup
    // node 2: Child
    expect(nodes[1]['name']).toBe('ParentGroup');
    expect(nodes[1]['children']).toEqual([2]);
    expect(nodes[1]['translation']).toEqual([1, 0, 0]);
    expect(nodes[2]['name']).toBe('Child');
    expect(nodes[2]['mesh']).toBe(0);
  });

  it('onlyVisible=true 跳过 invisible 节点', () => {
    const scene = new Scene();
    const mesh = makeTriangleMesh();
    mesh.visible = false;
    scene.add(mesh);
    // Scene 自身被加入根 nodes,但其下无 mesh 子节点
    const { json } = new GLTFExporter().parse(scene, { onlyVisible: true });
    const nodes = json['nodes'] as Array<Record<string, unknown>>;
    // 只有 Scene 本身;子 mesh 被跳过
    expect(nodes).toHaveLength(1);
    expect(nodes[0]['mesh']).toBeUndefined();
    expect(nodes[0]['children']).toBeUndefined();
  });
});

describe('GLTFExporter.parseGLB', () => {
  it('GLB header magic=glTF, version=2, length 匹配字节数', () => {
    const scene = new Scene();
    scene.add(makeTriangleMesh());
    const glb = new GLTFExporter().parseGLB(scene);

    // 12B header
    expect(glb.byteLength).toBeGreaterThanOrEqual(12);
    const magic = ascii(glb, 0, 4);
    expect(magic).toBe('glTF');
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
  });

  it('JSON chunk 以 "JSON" 标识开头,且可解析为对象', () => {
    const scene = new Scene();
    scene.add(makeTriangleMesh());
    const glb = new GLTFExporter().parseGLB(scene);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    const jsonLen = dv.getUint32(12, true);
    const jsonType = ascii(glb, 16, 4);
    expect(jsonType).toBe('JSON');
    const jsonBytes = glb.slice(20, 20 + jsonLen);
    // 去除 0x20 padding 尾部
    let end = jsonBytes.length;
    while (end > 0 && jsonBytes[end - 1] === 0x20) end--;
    const jsonStr = new TextDecoder('utf-8').decode(jsonBytes.slice(0, end));
    const obj = JSON.parse(jsonStr);
    expect(obj['asset']['version']).toBe('2.0');
    expect(obj['meshes']).toBeDefined();
  });

  it('BIN chunk 以 "BIN\\0" 标识开头,长度 ≥ BIN 数据', () => {
    const scene = new Scene();
    scene.add(makeTriangleMesh());
    const glb = new GLTFExporter().parseGLB(scene);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    const jsonLen = dv.getUint32(12, true);
    const binHeaderOff = 20 + jsonLen;
    const binLen = dv.getUint32(binHeaderOff, true);
    const binType = ascii(glb, binHeaderOff + 4, 4);
    expect(binType).toBe('BIN\0');
    // binLen 应是 4 字节对齐后的长度
    expect(binLen % 4).toBe(0);
    // BIN 区长度 + 8B header + 12B 全局 header + JSON 区 + 8B JSON header = 总长
    const totalExpected = 12 + 8 + jsonLen + 8 + binLen;
    expect(totalExpected).toBe(glb.byteLength);
  });
});

function ascii(bytes: Uint8Array, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]);
  return s;
}
