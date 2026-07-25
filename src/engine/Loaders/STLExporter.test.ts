import { describe, it, expect } from 'vitest';
import { STLExporter } from './STLExporter';
import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';

/** 构造简单索引化三角形 mesh(带 normal)。 */
function makeMesh(): Mesh {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  0, 1, 0,
  ]), 3));
  geom.setAttribute('normal', new BufferAttribute(new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]), 3));
  geom.setIndex([0, 1, 2]);
  return new Mesh(geom, new StandardMaterial());
}

describe('STLExporter.parse (ASCII)', () => {
  it('输出 solid/facet normal/vertex/endfacet/endsolid 行', () => {
    const text = new STLExporter().parse(makeMesh()) as string;
    expect(text.startsWith('solid VREEN')).toBe(true);
    expect(text.trim().endsWith('endsolid VREEN')).toBe(true);

    const lines = text.split('\n');
    expect(lines.filter((l: string) => l.trim().startsWith('facet normal '))).toHaveLength(1);
    expect(lines.filter((l: string) => l.trim().startsWith('vertex '))).toHaveLength(3);
    expect(lines.filter((l: string) => l.trim() === 'outer loop')).toHaveLength(1);
    expect(lines.filter((l: string) => l.trim() === 'endloop')).toHaveLength(1);
    expect(lines.filter((l: string) => l.trim() === 'endfacet')).toHaveLength(1);
  });

  it('facet normal 来自顶点法线平均(0 0 1)', () => {
    const text = new STLExporter().parse(makeMesh()) as string;
    const line = text.split('\n').find((l: string) => l.trim().startsWith('facet normal '))!.trim();
    // 法线三个顶点都是 (0,0,1),平均后仍为 (0,0,1)
    expect(line).toMatch(/^facet normal 0\.000000 0\.000000 1\.000000$/);
  });

  it('多三角形 mesh 输出多 facet', () => {
    // 构造 2 个三角形(2 面),非索引化
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
      1, 0, 0,  1, 1, 0,  0, 1, 0,
    ]), 3));
    geom.setAttribute('normal', new BufferAttribute(new Float32Array([
      0, 0, 1,  0, 0, 1,  0, 0, 1,
      0, 0, 1,  0, 0, 1,  0, 0, 1,
    ]), 3));
    const mesh = new Mesh(geom, new StandardMaterial());
    const text = new STLExporter().parse(mesh) as string;
    expect(text.split('\n').filter((l: string) => l.trim().startsWith('facet normal '))).toHaveLength(2);
  });

  it('Group 内多 mesh 都被导出', () => {
    const grp = new Group();
    grp.add(makeMesh());
    grp.add(makeMesh());
    const text = new STLExporter().parse(grp) as string;
    expect(text.split('\n').filter((l: string) => l.trim().startsWith('facet normal '))).toHaveLength(2);
  });
});

describe('STLExporter.parse (binary)', () => {
  it('二进制头 80B + uint32 面数 + N*50B 总长', () => {
    const buf = new STLExporter().parse(makeMesh(), { binary: true }) as Uint8Array;
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.byteLength).toBe(84 + 1 * 50);

    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint32(80, true)).toBe(1); // 1 个面
  });

  it('二进制法线/顶点与 ASCII 一致', () => {
    const mesh = makeMesh();
    const ascii = new STLExporter().parse(mesh) as string;
    const bin = new STLExporter().parse(mesh, { binary: true }) as Uint8Array;
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

    // 解析 ASCII 的法线
    const asciiNormal = ascii
      .split('\n')
      .find((l: string) => l.trim().startsWith('facet normal '))!
      .trim()
      .replace('facet normal ', '')
      .split(' ')
      .map(Number);
    // 二进制 normal 在 off=84
    const binNormal = [
      dv.getFloat32(84, true),
      dv.getFloat32(88, true),
      dv.getFloat32(92, true),
    ];
    expect(binNormal[0]).toBeCloseTo(asciiNormal[0], 5);
    expect(binNormal[1]).toBeCloseTo(asciiNormal[1], 5);
    expect(binNormal[2]).toBeCloseTo(asciiNormal[2], 5);

    // 顶点 v0 在 off=84+12=96
    expect(dv.getFloat32(96, true)).toBeCloseTo(0, 5);
    expect(dv.getFloat32(100, true)).toBeCloseTo(0, 5);
    expect(dv.getFloat32(104, true)).toBeCloseTo(0, 5);
  });

  it('多面二进制:面数与总长匹配', () => {
    const grp = new Group();
    grp.add(makeMesh());
    grp.add(makeMesh());
    const buf = new STLExporter().parse(grp, { binary: true }) as Uint8Array;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const nFaces = dv.getUint32(80, true);
    expect(nFaces).toBe(2);
    expect(buf.byteLength).toBe(84 + 2 * 50);
  });
});
