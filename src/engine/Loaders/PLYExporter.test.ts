import { describe, it, expect } from 'vitest';
import { PLYExporter } from './PLYExporter';
import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';

function makeMesh(): Mesh {
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
  return new Mesh(geom, new StandardMaterial());
}

describe('PLYExporter.parse (ASCII)', () => {
  it('header 含 ply/format/element vertex/element face/end_header', () => {
    const text = new PLYExporter().parse(makeMesh()) as string;
    const lines = text.split('\n');
    expect(lines[0]).toBe('ply');
    expect(lines[1]).toBe('format ascii 1.0');
    expect(lines.some((l) => l.startsWith('element vertex '))).toBe(true);
    expect(lines.some((l) => l.startsWith('element face '))).toBe(true);
    expect(lines.some((l) => l === 'end_header')).toBe(true);
  });

  it('header 声明 vertex 3 / face 1', () => {
    const text = new PLYExporter().parse(makeMesh()) as string;
    expect(text).toContain('element vertex 3');
    expect(text).toContain('element face 1');
    expect(text).toContain('property float x');
    expect(text).toContain('property float nx');
    expect(text).toContain('property float s');
  });

  it('end_header 之后 3 行 vertex + 1 行 face(3 i j k)', () => {
    const text = new PLYExporter().parse(makeMesh()) as string;
    const lines = text.split('\n');
    const endIdx = lines.indexOf('end_header');
    expect(endIdx).toBeGreaterThan(-1);
    const body = lines.slice(endIdx + 1).filter((l) => l.length > 0);
    expect(body).toHaveLength(4);
    // 3 vertex 行
    expect(body[0].split(' ')[0]).not.toBe('3');
    expect(body[1].split(' ')[0]).not.toBe('3');
    expect(body[2].split(' ')[0]).not.toBe('3');
    // 1 face 行 — 起始为 "3"
    expect(body[3].startsWith('3 ')).toBe(true);
    expect(body[3]).toBe('3 0 1 2');
  });

  it('vertex 行包含 position + normal + uv 共 8 个数字', () => {
    const text = new PLYExporter().parse(makeMesh()) as string;
    const lines = text.split('\n');
    const endIdx = lines.indexOf('end_header');
    const firstVertex = lines[endIdx + 1];
    const parts = firstVertex.split(' ');
    // position(3) + normal(3) + uv(2) = 8
    expect(parts).toHaveLength(8);
    expect(parseFloat(parts[0])).toBe(0);
    expect(parseFloat(parts[1])).toBe(0);
    expect(parseFloat(parts[2])).toBe(0);
  });

  it('Group 内多 mesh 合并为单一 vertex/face 表', () => {
    const grp = new Group();
    grp.add(makeMesh());
    grp.add(makeMesh());
    const text = new PLYExporter().parse(grp) as string;
    expect(text).toContain('element vertex 6');
    expect(text).toContain('element face 2');
  });
});

describe('PLYExporter.parse (binary)', () => {
  it('header 声明 binary_little_endian 1.0', () => {
    const buf = new PLYExporter().parse(makeMesh(), { binary: true }) as Uint8Array;
    const text = new TextDecoder('utf-8').decode(buf.slice(0, 500));
    expect(text).toContain('format binary_little_endian 1.0');
    expect(text).toContain('end_header');
  });

  it('vertex/face 数据与 ASCII 等价', () => {
    const mesh = makeMesh();
    const bin = new PLYExporter().parse(mesh, { binary: true }) as Uint8Array;

    // 找到 end_header 在二进制中的位置(以 '\nend_header\n' 为准)
    const endMarker = new TextEncoder().encode('\nend_header\n');
    let endIdx = -1;
    for (let i = 0; i < bin.length - endMarker.length; i++) {
      let ok = true;
      for (let j = 0; j < endMarker.length; j++) {
        if (bin[i + j] !== endMarker[j]) { ok = false; break; }
      }
      if (ok) { endIdx = i + endMarker.length; break; }
    }
    expect(endIdx).toBeGreaterThan(-1);

    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    // 第一个顶点(0,0,0) + normal(0,0,1) + uv(0,0)
    const off = endIdx;
    expect(dv.getFloat32(off + 0, true)).toBeCloseTo(0, 5);
    expect(dv.getFloat32(off + 4, true)).toBeCloseTo(0, 5);
    expect(dv.getFloat32(off + 8, true)).toBeCloseTo(0, 5);
    // normal
    expect(dv.getFloat32(off + 12, true)).toBeCloseTo(0, 5);
    expect(dv.getFloat32(off + 16, true)).toBeCloseTo(0, 5);
    expect(dv.getFloat32(off + 20, true)).toBeCloseTo(1, 5);
    // uv
    expect(dv.getFloat32(off + 24, true)).toBeCloseTo(0, 5);
    expect(dv.getFloat32(off + 28, true)).toBeCloseTo(0, 5);

    // face 在 vertex 3 个之后:3 * 32 = 96 字节
    const faceOff = off + 3 * 32;
    expect(dv.getUint8(faceOff)).toBe(3); // count
    expect(dv.getInt32(faceOff + 1, true)).toBe(0);
    expect(dv.getInt32(faceOff + 5, true)).toBe(1);
    expect(dv.getInt32(faceOff + 9, true)).toBe(2);
  });

  it('ASCII 与 binary 解析出的 vertex 数一致', () => {
    const mesh = makeMesh();
    const ascii = new PLYExporter().parse(mesh) as string;
    const asciiVertexLine = ascii.split('\n').find((l) => l.startsWith('element vertex '))!;
    const asciiFaceLine = ascii.split('\n').find((l) => l.startsWith('element face '))!;

    const bin = new PLYExporter().parse(mesh, { binary: true }) as Uint8Array;
    const binText = new TextDecoder('utf-8').decode(bin.slice(0, 500));
    expect(binText).toContain(asciiVertexLine);
    expect(binText).toContain(asciiFaceLine);
  });
});
