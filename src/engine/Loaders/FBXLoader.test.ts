// FBXLoader 测试 — Phase 4.2
//
// 验证:
//   • sniffFbxBinary:magic 嗅探
//   • canLoad:URL string / File / Uint8Array / ArrayBuffer
//   • parseFbxBinary:header + version 解析
//   • node 树递归解析 (Properties70 P 属性查找)
//   • Model/Geometry/Material/Connections 端到端
//   • ASCII FBX 拒绝
//   • Mesh 顶点展开 (triangle + quad)
import { describe, it, expect } from 'vitest';
import {
  FBXLoader,
  sniffFbxBinary,
  parseFbxBinary,
} from './FBXLoader';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';

// ── FBX 二进制文件构造器 ──────────────────────────────────────

const FBX_MAGIC = 'Kaydara FBX Binary  \x00\x1A\x00';

class FbxWriter {
  private chunks: Uint8Array[] = [];
  private size = 0;

  writeBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.size += bytes.length;
  }
  writeU8(v: number): void {
    const b = new Uint8Array(1);
    b[0] = v & 0xff;
    this.writeBytes(b);
  }
  writeU32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.writeBytes(b);
  }
  writeU64(v: number): void {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, v >>> 0, true);
    dv.setUint32(4, Math.floor(v / 0x100000000) >>> 0, true);
    this.writeBytes(b);
  }
  writeI16(v: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, v, true);
    this.writeBytes(b);
  }
  writeI32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    this.writeBytes(b);
  }
  writeF64(v: number): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    this.writeBytes(b);
  }
  writeString(s: string): void {
    this.writeBytes(new TextEncoder().encode(s));
  }
  getSize(): number { return this.size; }
  toBytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

// 写单个 property(返回 bytes,不含长度前缀)
function propI(v: number): Uint8Array { const w = new FbxWriter(); w.writeString('I'); w.writeI32(v); return w.toBytes(); }
function propD(v: number): Uint8Array { const w = new FbxWriter(); w.writeString('D'); w.writeF64(v); return w.toBytes(); }
function propS(s: string): Uint8Array {
  const w = new FbxWriter();
  w.writeString('S');
  const bytes = new TextEncoder().encode(s);
  w.writeU32(bytes.length);
  w.writeBytes(bytes);
  return w.toBytes();
}
function propDArray(arr: number[]): Uint8Array {
  const w = new FbxWriter();
  w.writeString('d');
  w.writeU32(arr.length);
  w.writeU32(0); // encoding = uncompressed
  w.writeU32(arr.length * 8); // compLength
  for (const v of arr) w.writeF64(v);
  return w.toBytes();
}
function propIArray(arr: number[]): Uint8Array {
  const w = new FbxWriter();
  w.writeString('i');
  w.writeU32(arr.length);
  w.writeU32(0); // encoding = uncompressed
  w.writeU32(arr.length * 4); // compLength
  for (const v of arr) w.writeI32(v);
  return w.toBytes();
}

interface FbxNodeSpec {
  name: string;
  properties?: Uint8Array[];
  children?: FbxNodeSpec[];
}

/** 递归构造 FBX node,返回其完整字节(含 endOffset 等 header)。
 *  注意:FBX 规范要求 endOffset 是从文件起始算的**绝对**偏移,
 *  所以需要传入 baseOffset = 该 node 在文件中的起始字节位置。 */
function buildNode(spec: FbxNodeSpec, useU64: boolean, baseOffset: number): Uint8Array {
  const headerSize = useU64 ? 25 : 13; // 8×3+1 vs 4×3+1
  const nameBytes = new TextEncoder().encode(spec.name);

  // 计算 properties 总长度
  const propBytes = spec.properties ?? [];
  let propListLen = 0;
  for (const p of propBytes) propListLen += p.length;

  // null terminator
  const nullTerm = useU64 ? new Uint8Array(8) : new Uint8Array(4);

  // 子节点起始绝对偏移 = baseOffset + headerSize + nameLen + propListLen
  const childrenStart = baseOffset + headerSize + nameBytes.length + propListLen;

  // 递归构造 children,传入每个 child 的绝对起始偏移
  const childBytes: Uint8Array[] = [];
  let childCursor = childrenStart;
  for (const c of spec.children ?? []) {
    const cb = buildNode(c, useU64, childCursor);
    childBytes.push(cb);
    childCursor += cb.length;
  }

  // node 总长度 = header + name + props + children + nullTerm
  const totalSize = headerSize + nameBytes.length + propListLen
    + (childCursor - childrenStart) + nullTerm.length;
  const endOffset = baseOffset + totalSize; // 绝对偏移

  const w = new FbxWriter();
  if (useU64) {
    w.writeU64(endOffset);
    w.writeU64(propBytes.length);
    w.writeU64(propListLen);
  } else {
    w.writeU32(endOffset);
    w.writeU32(propBytes.length);
    w.writeU32(propListLen);
  }
  w.writeU8(nameBytes.length);
  w.writeBytes(nameBytes);
  for (const p of propBytes) w.writeBytes(p);
  for (const c of childBytes) w.writeBytes(c);
  w.writeBytes(nullTerm);

  const out = w.toBytes();
  if (out.length !== totalSize) {
    throw new Error(`FbxBuilder size mismatch: expected ${totalSize}, got ${out.length}`);
  }
  return out;
}

/** 构造一个最小 FBX 二进制文件。 */
function buildFbx(opts: {
  version?: number;
  objects?: FbxNodeSpec[];
  connections?: { type: 'OO' | 'OP'; from: number; to: number; prop?: string }[];
  globalSettings?: FbxNodeSpec;
}): Uint8Array {
  const version = opts.version ?? 7400;
  const useU64 = version >= 7500;

  // 顶层 root 节点列表
  const rootChildren: FbxNodeSpec[] = [];

  // FBXHeaderExtension
  rootChildren.push({
    name: 'FBXHeaderExtension',
    children: [
      { name: 'FBXHeaderVersion', properties: [propI(1003)] },
      { name: 'FBXVersion', properties: [propI(version)] },
      { name: 'Creator', properties: [propS('Test')] },
    ],
  });

  // GlobalSettings
  if (opts.globalSettings) {
    rootChildren.push(opts.globalSettings);
  } else {
    rootChildren.push({
      name: 'GlobalSettings',
      children: [
        { name: 'Version', properties: [propI(1000)] },
        {
          name: 'Properties70',
          children: [
            { name: 'P', properties: [propS('UnitScaleFactor'), propS('double'), propS('Number'), propS(''), propD(1.0)] },
          ],
        },
      ],
    });
  }

  // Objects
  rootChildren.push({
    name: 'Objects',
    children: opts.objects ?? [],
  });

  // Connections
  const connChildren: FbxNodeSpec[] = [];
  for (const c of opts.connections ?? []) {
    const props: Uint8Array[] = [propS(c.type), propI(c.from), propI(c.to)];
    if (c.type === 'OP' && c.prop) props.push(propS(c.prop));
    connChildren.push({ name: 'C', properties: props });
  }
  rootChildren.push({ name: 'Connections', children: connChildren });

  // 构造完整文件
  const w = new FbxWriter();
  // magic (23 bytes)
  w.writeString(FBX_MAGIC);
  // version uint32 at offset 23
  w.writeU32(version);
  // top-level nodes — 用 w.getSize() 作为每个 node 的绝对起始偏移
  for (const child of rootChildren) {
    w.writeBytes(buildNode(child, useU64, w.getSize()));
  }
  // 顶层 null terminator
  if (useU64) w.writeBytes(new Uint8Array(8));
  else w.writeBytes(new Uint8Array(4));

  return w.toBytes();
}

// ── 工具 ──────────────────────────────────────────────────────

/** Properties70 P 属性辅助。 */
function prop70(name: string, type: string, subtype: string, flags: string, values: number[]): FbxNodeSpec {
  const props: Uint8Array[] = [
    propS(name), propS(type), propS(subtype), propS(flags),
    ...values.map((v) => propD(v)),
  ];
  return { name: 'P', properties: props };
}

// ── sniffFbxBinary ────────────────────────────────────────────

describe('FBXLoader — sniffFbxBinary', () => {
  it('合法 magic 返回 true', () => {
    expect(sniffFbxBinary(buildFbx({}))).toBe(true);
  });

  it('短于 23 字节返回 false', () => {
    expect(sniffFbxBinary(new Uint8Array(10))).toBe(false);
  });

  it('magic 错误返回 false', () => {
    const bytes = buildFbx({});
    bytes[0] = 0; // 破坏 magic
    expect(sniffFbxBinary(bytes)).toBe(false);
  });
});

// ── canLoad ───────────────────────────────────────────────────

describe('FBXLoader — canLoad', () => {
  const loader = new FBXLoader();

  it('URL 以 .fbx 结尾', () => {
    expect(loader.canLoad('http://example.com/m.fbx')).toBe(true);
    expect(loader.canLoad('m.FBX')).toBe(true);
  });

  it('URL 不以 .fbx 结尾', () => {
    expect(loader.canLoad('m.glb')).toBe(false);
    expect(loader.canLoad('m.obj')).toBe(false);
  });

  it('hint mime = model/fbx', () => {
    expect(loader.canLoad('any-url', { mime: 'model/fbx' })).toBe(true);
  });

  it('Uint8Array 用 magic 嗅探', () => {
    expect(loader.canLoad(buildFbx({}))).toBe(true);
    expect(loader.canLoad(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

// ── parseFbxBinary (header) ───────────────────────────────────

describe('FBXLoader — parseFbxBinary header', () => {
  it('解析 FBX 7400 版本', () => {
    const result = parseFbxBinary(buildFbx({ version: 7400 }));
    expect(result.version).toBe(7400);
  });

  it('解析 FBX 7500 版本(用 uint64 header)', () => {
    const result = parseFbxBinary(buildFbx({ version: 7500 }));
    expect(result.version).toBe(7500);
  });

  it('返回 Group 根节点', () => {
    const result = parseFbxBinary(buildFbx({}));
    expect(result.root).toBeInstanceOf(Group);
    expect(result.root.name).toBe('FBX_ROOT');
  });

  it('空 FBX(无 Objects)正常返回', () => {
    const result = parseFbxBinary(buildFbx({}));
    expect(result.root.children).toHaveLength(0);
    expect(result.materials).toHaveLength(0);
  });
});

// ── parseFbxBinary (Model + Geometry + Material) ─────────────

describe('FBXLoader — parseFbxBinary full scene', () => {
  it('解析单个 Model + 三角形 Geometry + Material', () => {
    const objects: FbxNodeSpec[] = [
      // Model (id=1)
      {
        name: 'Model',
        properties: [propI(1), propS('Model::TestModel'), propS('Mesh')],
        children: [
          {
            name: 'Properties70',
            children: [
              prop70('Lcl Translation', 'Lcl Translation', '', 'A', [1, 2, 3]),
              prop70('Lcl Rotation', 'Lcl Rotation', '', 'A', [10, 20, 30]),
              prop70('Lcl Scaling', 'Lcl Scaling', '', 'A', [1, 1, 1]),
            ],
          },
        ],
      },
      // Geometry (id=2) — 三角形 (0,0,0) (1,0,0) (0,1,0)
      {
        name: 'Geometry',
        properties: [propI(2), propS('Geometry::TestTri'), propS('Mesh')],
        children: [
          { name: 'Vertices', properties: [propDArray([0, 0, 0, 1, 0, 0, 0, 1, 0])] },
          // PolygonVertexIndex: triangle [0, 1, -2-1=-3],但 FBX 用 ~v 表示 last vertex
          // 即最后一个顶点 index 取负后 -1。这里 polygon 是 (0, 1, 2),last 是 2 → -3 = ~2
          // 所以 array = [0, 1, -3]
          { name: 'PolygonVertexIndex', properties: [propIArray([0, 1, -3])] },
        ],
      },
      // Material (id=3)
      {
        name: 'Material',
        properties: [propI(3), propS('Material::TestMat'), propS('')],
        children: [
          {
            name: 'Properties70',
            children: [
              prop70('DiffuseColor', 'Color', '', 'A', [0.8, 0.4, 0.2]),
              prop70('Shininess', 'Number', '', 'A', [20]),
              prop70('Opacity', 'Number', '', 'A', [0.9]),
            ],
          },
        ],
      },
    ];

    const connections = [
      { type: 'OO' as const, from: 2, to: 1 }, // Geometry → Model
      { type: 'OO' as const, from: 1, to: 0 }, // Model → root
      { type: 'OP' as const, from: 3, to: 2, prop: 'Materials' }, // Material → Geometry
    ];

    const result = parseFbxBinary(buildFbx({ objects, connections }));

    expect(result.root.children).toHaveLength(1);
    const model = result.root.children[0];
    expect(model.name).toBe('TestModel');
    // 位置 cm→m:1/100 = 0.01
    expect(model.position.x).toBeCloseTo(0.01, 4);
    expect(model.position.y).toBeCloseTo(0.02, 4);
    expect(model.position.z).toBeCloseTo(0.03, 4);

    // Model 下挂一个 Mesh
    expect(model.children).toHaveLength(1);
    const mesh = model.children[0];
    expect(mesh).toBeInstanceOf(Mesh);
    const geom = (mesh as Mesh).geometry;
    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('position')!.count).toBe(3); // 3 vertices
    expect(geom.index).not.toBeNull();
    expect(geom.index!.count).toBe(3); // 1 triangle = 3 indices

    // Material
    expect(result.materials).toHaveLength(1);
    const mat = result.materials[0];
    expect(mat.userData['name']).toBe('TestMat');
    expect(mat.baseColor.r).toBeCloseTo(0.8, 2);
    expect(mat.baseColor.g).toBeCloseTo(0.4, 2);
    expect(mat.baseColor.b).toBeCloseTo(0.2, 2);
    expect(mat.opacity).toBeCloseTo(0.9, 2);
  });

  it('解析 quad geometry(展开为 2 个三角形)', () => {
    const objects: FbxNodeSpec[] = [
      {
        name: 'Model',
        properties: [propI(10), propS('Model::Quad'), propS('Mesh')],
        children: [],
      },
      {
        name: 'Geometry',
        properties: [propI(20), propS('Geometry::QuadGeom'), propS('Mesh')],
        children: [
          // quad: (0,0) (1,0) (1,1) (0,1) — 4 vertices
          { name: 'Vertices', properties: [propDArray([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])] },
          // polygon: indices 0, 1, 2, 3, last = 3 → -4 = ~3
          { name: 'PolygonVertexIndex', properties: [propIArray([0, 1, 2, -4])] },
        ],
      },
    ];
    const connections = [
      { type: 'OO' as const, from: 20, to: 10 },
      { type: 'OO' as const, from: 10, to: 0 },
    ];
    const result = parseFbxBinary(buildFbx({ objects, connections }));
    const model = result.root.children[0];
    const mesh = model.children[0] as Mesh;
    expect(mesh.geometry.index!.count).toBe(6); // quad = 2 triangles = 6 indices
    expect(mesh.geometry.getAttribute('position')!.count).toBe(4);
  });

  it('跳过不支持的节点类型(Texture/AnimationStack)', () => {
    const objects: FbxNodeSpec[] = [
      {
        name: 'Texture',
        properties: [propI(100), propS('Texture::Foo'), propS('')],
        children: [],
      },
      {
        name: 'AnimationStack',
        properties: [propI(101), propS('AnimStack::Bar'), propS('')],
        children: [],
      },
    ];
    const result = parseFbxBinary(buildFbx({ objects }));
    expect(result.skipped['Texture']).toBe(1);
    expect(result.skipped['AnimationStack']).toBe(1);
  });

  it('支持 7500+ 版本的 uint64 node header', () => {
    const objects: FbxNodeSpec[] = [
      {
        name: 'Model',
        properties: [propI(1), propS('Model::V7500'), propS('Mesh')],
        children: [],
      },
    ];
    const connections = [{ type: 'OO' as const, from: 1, to: 0 }];
    const result = parseFbxBinary(buildFbx({ version: 7500, objects, connections }));
    expect(result.version).toBe(7500);
    expect(result.root.children).toHaveLength(1);
    expect(result.root.children[0].name).toBe('V7500');
  });
});

// ── ASCII FBX 拒绝 ───────────────────────────────────────────

describe('FBXLoader — ASCII 拒绝', () => {
  const loader = new FBXLoader();

  it('ASCII FBX 抛清晰错误', async () => {
    const asciiBytes = new TextEncoder().encode('; FBX 7.4.0 project file\nFBXHeaderExtension: {\n}\n');
    await expect(loader.load(asciiBytes)).rejects.toThrow(/ASCII.*not supported/i);
  });

  it('非 FBX magic 字节抛错', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]); // PNG magic
    await expect(loader.load(bytes)).rejects.toThrow(/not a binary FBX/i);
  });
});
