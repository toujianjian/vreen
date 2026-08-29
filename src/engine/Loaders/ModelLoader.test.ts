import { describe, it, expect } from 'vitest';
import { loadModelBytes } from './ModelLoader';
import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** 1 个三角形面的最小 OBJ。 */
const OBJ_TEXT = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n');

/** 1 个三角形面的最小 ASCII PLY。 */
const PLY_TEXT = [
  'ply',
  'format ascii 1.0',
  'element vertex 3',
  'property float x',
  'property float y',
  'property float z',
  'element face 1',
  'property list uchar int vertex_indices',
  'end_header',
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '3 0 1 2',
  '',
].join('\n');

/** 1 个三角形面的最小二进制 STL (80 字节头 + uint32 面数 + 50 字节面)。 */
function makeBinarySTL(): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50);
  const dv = new DataView(buf);
  dv.setUint32(80, 1, true);
  dv.setFloat32(84 + 0, 0, true);
  dv.setFloat32(84 + 4, 0, true);
  dv.setFloat32(84 + 8, 1, true);
  dv.setFloat32(84 + 12, 0, true);
  dv.setFloat32(84 + 20, 0, true);
  dv.setFloat32(84 + 24, 1, true);
  dv.setFloat32(84 + 40, 1, true);
  dv.setUint16(84 + 48, 0, true);
  return buf;
}

describe('loadModelBytes — engine-side import entry (no three.js)', () => {
  it('obj → Group(OBJ_ROOT) with 1 mesh, no animations', async () => {
    const model = await loadModelBytes(toBytes(OBJ_TEXT), 'obj');
    expect(model.format).toBe('obj');
    expect(model.animations).toHaveLength(0);
    expect(model.root.name).toBe('OBJ_ROOT');
    expect(model.root.children).toHaveLength(1);
    const mesh = model.root.children[0] as Mesh;
    const pos = mesh.geometry.getAttribute('position')!;
    expect(pos.count).toBe(3);
    expect(mesh.geometry.boundingBox).not.toBeNull();
    expect(mesh.material).toBeDefined();
  });

  it('stl → STL_ROOT wrapper mesh with computed normals', async () => {
    const model = await loadModelBytes(makeBinarySTL(), 'stl');
    expect(model.format).toBe('stl');
    expect(model.animations).toHaveLength(0);
    expect(model.root.name).toBe('STL_ROOT');
    const mesh = model.root.children[0] as Mesh;
    expect(mesh.geometry.getAttribute('position')!.count).toBe(3);
    // 引擎 STL 解析不带法线时由本入口补算，否则 renderer 会拿不到法线
    expect(mesh.geometry.getAttribute('normal')).toBeDefined();
    expect(mesh.castShadow).toBe(true);
  });

  it('ply → PLY_ROOT wrapper mesh', async () => {
    const model = await loadModelBytes(toBytes(PLY_TEXT), 'ply');
    expect(model.format).toBe('ply');
    expect(model.animations).toHaveLength(0);
    expect(model.root.name).toBe('PLY_ROOT');
    expect(model.root.children).toHaveLength(1);
    expect((model.root.children[0] as Mesh).geometry.getAttribute('position')!.count).toBe(3);
  });

  it('gltf → clear error (engine reads the single-file GLB container only)', async () => {
    await expect(loadModelBytes(toBytes('{}'), 'gltf')).rejects.toThrow(/single-file \.glb container/);
  });

  it('result is engine Group/Mesh instances (no three.js objects in this path)', async () => {
    // 防止有人把 three.js 加载器塞回这条链路
    const model = await loadModelBytes(toBytes(OBJ_TEXT), 'obj');
    expect(model.root).toBeInstanceOf(Group);
    expect(model.root.children[0]).toBeInstanceOf(Mesh);
  });
});
