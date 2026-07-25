// Snapshot — 网络快照序列化 / 反序列化。
//
// 设计原则：
//   - 二进制紧凑格式，减少带宽（相比 JSON 节省 50%+）。
//   - 序列化往返：serialize() → ArrayBuffer → deserialize() → Snapshot。
//   - compress()/decompress() 走 fflate（项目已依赖），可选开启。
//   - 字段对齐 NetworkEntity 的网络可见部分：id / ownerId / position / rotation / velocity。
//
// 二进制布局（小端）：
//   [4]  magic       0x56534e50 ('VSNP')
//   [1]  version     1
//   [4]  sequence    uint32
//   [8]  timestamp   float64 (ms, 调用方决定时基)
//   [4]  entityCount uint32
//   重复 entityCount 次:
//     [1]  idLen     uint8 (id UTF-8 字节数, ≤255)
//     [n]  id        UTF-8
//     [1]  ownerLen  uint8
//     [n]  owner     UTF-8
//     [12] position  3 × float32
//     [16] rotation  4 × float32 (x,y,z,w)
//     [12] velocity  3 × float32
//
// 不变量：
//   - id / ownerId 长度 ≤ 255 字节（uint8 前缀）；超长抛错。
//   - deserialize 校验 magic 与 version，不匹配抛错。

import { deflateSync, inflateSync } from 'fflate';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

const SNAPSHOT_MAGIC = 0x56534e50; // 'VSNP'
const SNAPSHOT_VERSION = 1;
/** id / ownerId UTF-8 字节上限。 */
const MAX_STR_LEN = 255;

/** 快照中的单个实体网络表示。 */
export interface SnapshotEntity {
  id: string;
  ownerId: string;
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
}

export interface SnapshotOptions {
  entities?: SnapshotEntity[];
  timestamp?: number;
  sequence?: number;
}

export class Snapshot {
  entities: SnapshotEntity[];
  timestamp: number;
  sequence: number;

  constructor(opts: SnapshotOptions = {}) {
    this.entities = opts.entities ?? [];
    this.timestamp = opts.timestamp ?? 0;
    this.sequence = opts.sequence ?? 0;
  }

  /** 序列化为二进制 ArrayBuffer。 */
  serialize(): ArrayBuffer {
    // 计算总长度
    let totalBytes = 4 + 1 + 4 + 8 + 4; // magic + ver + seq + ts + count
    const idBytesArr: Uint8Array[] = [];
    const ownerBytesArr: Uint8Array[] = [];
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      const idBytes = encodeUtf8(e.id);
      const ownerBytes = encodeUtf8(e.ownerId);
      if (idBytes.length > MAX_STR_LEN) {
        throw new Error(`Snapshot.serialize: id "${e.id}" exceeds ${MAX_STR_LEN} bytes`);
      }
      if (ownerBytes.length > MAX_STR_LEN) {
        throw new Error(`Snapshot.serialize: ownerId "${e.ownerId}" exceeds ${MAX_STR_LEN} bytes`);
      }
      idBytesArr.push(idBytes);
      ownerBytesArr.push(ownerBytes);
      totalBytes += 1 + idBytes.length + 1 + ownerBytes.length + 12 + 16 + 12;
    }

    const buf = new ArrayBuffer(totalBytes);
    const dv = new DataView(buf);
    let offset = 0;
    dv.setUint32(offset, SNAPSHOT_MAGIC, true); offset += 4;
    dv.setUint8(offset, SNAPSHOT_VERSION); offset += 1;
    dv.setUint32(offset, this.sequence, true); offset += 4;
    dv.setFloat64(offset, this.timestamp, true); offset += 8;
    dv.setUint32(offset, this.entities.length, true); offset += 4;

    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      const idBytes = idBytesArr[i];
      const ownerBytes = ownerBytesArr[i];
      dv.setUint8(offset, idBytes.length); offset += 1;
      new Uint8Array(buf, offset, idBytes.length).set(idBytes); offset += idBytes.length;
      dv.setUint8(offset, ownerBytes.length); offset += 1;
      new Uint8Array(buf, offset, ownerBytes.length).set(ownerBytes); offset += ownerBytes.length;
      dv.setFloat32(offset, e.position.x, true); offset += 4;
      dv.setFloat32(offset, e.position.y, true); offset += 4;
      dv.setFloat32(offset, e.position.z, true); offset += 4;
      dv.setFloat32(offset, e.rotation.x, true); offset += 4;
      dv.setFloat32(offset, e.rotation.y, true); offset += 4;
      dv.setFloat32(offset, e.rotation.z, true); offset += 4;
      dv.setFloat32(offset, e.rotation.w, true); offset += 4;
      dv.setFloat32(offset, e.velocity.x, true); offset += 4;
      dv.setFloat32(offset, e.velocity.y, true); offset += 4;
      dv.setFloat32(offset, e.velocity.z, true); offset += 4;
    }
    return buf;
  }

  /** 反序列化二进制 ArrayBuffer 为 Snapshot。 */
  static deserialize(buffer: ArrayBuffer): Snapshot {
    const dv = new DataView(buffer);
    let offset = 0;
    if (buffer.byteLength < 4 + 1 + 4 + 8 + 4) {
      throw new Error(`Snapshot.deserialize: buffer too small (${buffer.byteLength} bytes)`);
    }
    const magic = dv.getUint32(offset, true); offset += 4;
    if (magic !== SNAPSHOT_MAGIC) {
      throw new Error(`Snapshot.deserialize: bad magic 0x${magic.toString(16)} (expected 0x${SNAPSHOT_MAGIC.toString(16)})`);
    }
    const version = dv.getUint8(offset); offset += 1;
    if (version !== SNAPSHOT_VERSION) {
      throw new Error(`Snapshot.deserialize: unsupported version ${version} (expected ${SNAPSHOT_VERSION})`);
    }
    const sequence = dv.getUint32(offset, true); offset += 4;
    const timestamp = dv.getFloat64(offset, true); offset += 8;
    const count = dv.getUint32(offset, true); offset += 4;

    const entities: SnapshotEntity[] = [];
    for (let i = 0; i < count; i++) {
      const idLen = dv.getUint8(offset); offset += 1;
      const id = decodeUtf8(new Uint8Array(buffer, offset, idLen)); offset += idLen;
      const ownerLen = dv.getUint8(offset); offset += 1;
      const ownerId = decodeUtf8(new Uint8Array(buffer, offset, ownerLen)); offset += ownerLen;
      const px = dv.getFloat32(offset, true); offset += 4;
      const py = dv.getFloat32(offset, true); offset += 4;
      const pz = dv.getFloat32(offset, true); offset += 4;
      const rx = dv.getFloat32(offset, true); offset += 4;
      const ry = dv.getFloat32(offset, true); offset += 4;
      const rz = dv.getFloat32(offset, true); offset += 4;
      const rw = dv.getFloat32(offset, true); offset += 4;
      const vx = dv.getFloat32(offset, true); offset += 4;
      const vy = dv.getFloat32(offset, true); offset += 4;
      const vz = dv.getFloat32(offset, true); offset += 4;
      entities.push({
        id,
        ownerId,
        position: new Vector3(px, py, pz),
        rotation: new Quaternion(rx, ry, rz, rw),
        velocity: new Vector3(vx, vy, vz),
      });
    }
    return new Snapshot({ entities, timestamp, sequence });
  }

  /** 压缩为 Uint8Array（deflate）。 */
  compress(): Uint8Array {
    const raw = new Uint8Array(this.serialize());
    return deflateSync(raw);
  }

  /** 解压 Uint8Array 为 Snapshot（inflate + deserialize）。 */
  static decompress(data: Uint8Array): Snapshot {
    const raw = inflateSync(data);
    // raw 可能是更大 buffer 的视图，slice 出独立 ArrayBuffer 保证下标对齐。
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    return Snapshot.deserialize(buf);
  }
}

// ── UTF-8 编解码 ───────────────────────────────────────────────
// 优先用全局 TextEncoder/TextDecoder（浏览器 / Node 均内置），兜底手写实现。
function encodeUtf8(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s);
  }
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6));
      bytes.push(0x80 | (c & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12));
      bytes.push(0x80 | ((c >> 6) & 0x3f));
      bytes.push(0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    if (b < 0x80) {
      s += String.fromCharCode(b);
    } else if (b < 0xe0) {
      const b2 = bytes[i++];
      s += String.fromCharCode(((b & 0x1f) << 6) | (b2 & 0x3f));
    } else {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      s += String.fromCharCode(((b & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
    }
  }
  return s;
}
