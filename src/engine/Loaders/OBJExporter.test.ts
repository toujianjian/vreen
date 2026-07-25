import { describe, it, expect } from 'vitest';
import { OBJExporter, exportOBJ } from './OBJExporter';
import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';

/** 构造简单索引化三角形 mesh(带 normal/uv)。 */
function makeMesh(name?: string): Mesh {
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
  const mat = new StandardMaterial();
  mat.userData['__mtlName'] = 'TriMat';
  const mesh = new Mesh(geom, mat);
  if (name) mesh.name = name;
  return mesh;
}

describe('OBJExporter.parse', () => {
  it('输出 v/vt/vn/f 行,face 格式 v/vt/vn', () => {
    const mesh = makeMesh('Tri');
    const text = new OBJExporter().parse(mesh);

    const lines = text.split('\n');
    const vLines = lines.filter((l) => l.startsWith('v '));
    const vtLines = lines.filter((l) => l.startsWith('vt '));
    const vnLines = lines.filter((l) => l.startsWith('vn '));
    const fLines = lines.filter((l) => l.startsWith('f '));

    expect(vLines).toHaveLength(3);
    expect(vtLines).toHaveLength(3);
    expect(vnLines).toHaveLength(3);
    expect(fLines).toHaveLength(1);

    // face 行:3 个 v/vt/vn 三元组
    const f = fLines[0];
    expect(f).toMatch(/^f 1\/1\/1 2\/2\/2 3\/3\/3$/);
  });

  it('缺少 uv 时降级为 v//vn', () => {
    const mesh = makeMesh();
    mesh.geometry.deleteAttribute('uv');
    const text = new OBJExporter().parse(mesh);
    const fLines = text.split('\n').filter((l) => l.startsWith('f '));
    expect(fLines).toHaveLength(1);
    expect(fLines[0]).toMatch(/^f 1\/\/1 2\/\/2 3\/\/3$/);
    expect(text).not.toContain('vt ');
  });

  it('缺少 normal 时降级为 v/vt', () => {
    const mesh = makeMesh();
    mesh.geometry.deleteAttribute('normal');
    const text = new OBJExporter().parse(mesh);
    const fLines = text.split('\n').filter((l) => l.startsWith('f '));
    expect(fLines).toHaveLength(1);
    expect(fLines[0]).toMatch(/^f 1\/1 2\/2 3\/3$/);
    expect(text).not.toContain('vn ');
  });

  it('缺少 uv 和 normal 时降级为 v', () => {
    const mesh = makeMesh();
    mesh.geometry.deleteAttribute('uv');
    mesh.geometry.deleteAttribute('normal');
    const text = new OBJExporter().parse(mesh);
    const fLines = text.split('\n').filter((l) => l.startsWith('f '));
    expect(fLines).toHaveLength(1);
    expect(fLines[0]).toMatch(/^f 1 2 3$/);
  });

  it('非索引化 geometry 也能正确导出', () => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
    ]), 3));
    // 不设 index — 输出 f 1 2 3
    const mesh = new Mesh(geom, new StandardMaterial());
    const text = new OBJExporter().parse(mesh);
    const fLines = text.split('\n').filter((l) => l.startsWith('f '));
    expect(fLines).toHaveLength(1);
    expect(fLines[0]).toBe('f 1 2 3');
  });

  it('多个 mesh 共享索引空间(v/vt/vn 全局递增)', () => {
    const grp = new Group();
    grp.add(makeMesh('A'));
    grp.add(makeMesh('B'));
    const text = new OBJExporter().parse(grp);

    const lines = text.split('\n');
    const oLines = lines.filter((l) => l.startsWith('o '));
    expect(oLines).toHaveLength(2);

    // 第二个 mesh 的 face 索引从 4 开始
    const fLines = lines.filter((l) => l.startsWith('f '));
    expect(fLines).toHaveLength(2);
    expect(fLines[0]).toBe('f 1/1/1 2/2/2 3/3/3');
    expect(fLines[1]).toBe('f 4/4/4 5/5/5 6/6/6');
  });

  it('usemtl 引用材质 mtl 名', () => {
    const mesh = makeMesh();
    const text = new OBJExporter().parse(mesh);
    expect(text).toContain('usemtl TriMat');
  });

  it('exportOBJ 函数与 new OBJExporter().parse 结果一致', () => {
    const mesh = makeMesh();
    const a = exportOBJ(mesh);
    const b = new OBJExporter().parse(mesh);
    expect(a).toBe(b);
  });

  it('visible=false 的 mesh 被跳过', () => {
    const grp = new Group();
    const a = makeMesh('A');
    const b = makeMesh('B');
    b.visible = false;
    grp.add(a);
    grp.add(b);
    const text = new OBJExporter().parse(grp);
    const oLines = text.split('\n').filter((l) => l.startsWith('o '));
    expect(oLines).toHaveLength(1);
    expect(text).toContain('o A');
  });
});
