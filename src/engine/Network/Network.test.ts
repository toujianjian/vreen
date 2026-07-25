// NetworkSync / Snapshot / NetworkLerp / MockTransport 单元测试。
//
// 测试策略：
//   - MockTransport.pair() 建立双向本地通道，覆盖 NetworkSync 服务器 → 客户端流转。
//   - Snapshot 走 serialize ↔ deserialize 与 compress ↔ decompress 往返。
//   - NetworkLerp 用确定数值验证 lerp / slerp / predict / reconcile 边界。
//   - NetworkSync 插值用注入式时钟（now）+ 手工构造 Snapshot 控制时间戳，避免依赖真实 wall clock。

import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import {
  MockTransport,
  Snapshot,
  type SnapshotEntity,
  NetworkLerp,
  NetworkSync,
  createNetworkEntity,
} from './index';

// ── 辅助：构造 SnapshotEntity ──────────────────────────────────
function makeEntity(
  id: string,
  pos: [number, number, number],
  rot: [number, number, number, number] = [0, 0, 0, 1],
  vel: [number, number, number] = [0, 0, 0],
  ownerId: string = 'server',
): SnapshotEntity {
  return {
    id,
    ownerId,
    position: new Vector3(pos[0], pos[1], pos[2]),
    rotation: new Quaternion(rot[0], rot[1], rot[2], rot[3]),
    velocity: new Vector3(vel[0], vel[1], vel[2]),
  };
}

// ════════════════════════════════════════════════════════════════
// MockTransport
// ════════════════════════════════════════════════════════════════
describe('MockTransport', () => {
  it('connect triggers onConnect and sets connected state', async () => {
    const t = new MockTransport('a');
    const onConn = vi.fn();
    t.onConnect(onConn);
    expect(t.isConnected()).toBe(false);
    await t.connect();
    expect(t.isConnected()).toBe(true);
    expect(onConn).toHaveBeenCalledTimes(1);
  });

  it('disconnect triggers onDisconnect once', async () => {
    const t = new MockTransport('b');
    const onDisc = vi.fn();
    t.onDisconnect(onDisc);
    await t.connect();
    t.disconnect();
    expect(t.isConnected()).toBe(false);
    expect(onDisc).toHaveBeenCalledTimes(1);
    // 幂等：再次 disconnect 不触发
    t.disconnect();
    expect(onDisc).toHaveBeenCalledTimes(1);
  });

  it('paired transports deliver send → onMessage', async () => {
    const a = new MockTransport('a');
    const b = new MockTransport('b');
    MockTransport.pair(a, b);
    await a.connect();
    await b.connect();
    const recv = vi.fn();
    b.onMessage(recv);
    const buf = new ArrayBuffer(8);
    a.send(buf);
    expect(recv).toHaveBeenCalledTimes(1);
    expect(recv.mock.calls[0][0]).toBe(buf);
    a.send('hello');
    expect(recv).toHaveBeenCalledWith('hello');
  });

  it('send when not connected is ignored', () => {
    const a = new MockTransport('a');
    const b = new MockTransport('b');
    MockTransport.pair(a, b);
    const recv = vi.fn();
    b.onMessage(recv);
    a.send('x');
    expect(recv).not.toHaveBeenCalled();
  });

  it('send without pair is dropped', async () => {
    const a = new MockTransport('a');
    await a.connect();
    // 不应抛错
    a.send('orphan');
  });
});

// ════════════════════════════════════════════════════════════════
// Snapshot
// ════════════════════════════════════════════════════════════════
describe('Snapshot', () => {
  it('empty snapshot round-trips', () => {
    const snap = new Snapshot({ entities: [], timestamp: 12345, sequence: 7 });
    const buf = snap.serialize();
    expect(buf.byteLength).toBeGreaterThanOrEqual(4 + 1 + 4 + 8 + 4);
    const out = Snapshot.deserialize(buf);
    expect(out.sequence).toBe(7);
    expect(out.timestamp).toBe(12345);
    expect(out.entities).toEqual([]);
  });

  it('serialize → deserialize preserves all fields', () => {
    const snap = new Snapshot({
      entities: [
        makeEntity('p1', [1.5, -2.25, 3.75], [0, 0.7071, 0, 0.7071], [10, 0, -5], 'srv'),
        makeEntity('p2', [0, 0, 0], [0, 0, 0, 1], [0, 0, 0], 'srv'),
      ],
      timestamp: 999.5,
      sequence: 42,
    });
    const out = Snapshot.deserialize(snap.serialize());
    expect(out.sequence).toBe(42);
    expect(out.timestamp).toBe(999.5);
    expect(out.entities.length).toBe(2);
    const e0 = out.entities[0];
    expect(e0.id).toBe('p1');
    expect(e0.ownerId).toBe('srv');
    expect(e0.position.x).toBeCloseTo(1.5, 5);
    expect(e0.position.y).toBeCloseTo(-2.25, 5);
    expect(e0.position.z).toBeCloseTo(3.75, 5);
    expect(e0.rotation.x).toBeCloseTo(0, 5);
    expect(e0.rotation.y).toBeCloseTo(0.7071, 4);
    expect(e0.rotation.z).toBeCloseTo(0, 5);
    expect(e0.rotation.w).toBeCloseTo(0.7071, 4);
    expect(e0.velocity.x).toBeCloseTo(10, 5);
    expect(e0.velocity.z).toBeCloseTo(-5, 5);
    expect(out.entities[1].id).toBe('p2');
  });

  it('compress → decompress round-trips', () => {
    const snap = new Snapshot({
      entities: [
        makeEntity('a', [1, 2, 3], [0.1, 0.2, 0.3, 0.4], [4, 5, 6]),
        makeEntity('b', [-1, -2, -3], [0, 0, 0, 1], [0, 0, 0]),
      ],
      timestamp: 100,
      sequence: 1,
    });
    const compressed = snap.compress();
    expect(compressed instanceof Uint8Array).toBe(true);
    expect(compressed.byteLength).toBeGreaterThan(0);
    const out = Snapshot.decompress(compressed);
    expect(out.entities.length).toBe(2);
    expect(out.entities[0].id).toBe('a');
    expect(out.entities[0].position.x).toBeCloseTo(1, 5);
    expect(out.entities[1].id).toBe('b');
    expect(out.sequence).toBe(1);
    expect(out.timestamp).toBe(100);
  });

  it('compress produces smaller-or-equal output for repeated entities', () => {
    // 大量重复 id 的快照压缩后应更小
    const entities: SnapshotEntity[] = [];
    for (let i = 0; i < 50; i++) {
      entities.push(makeEntity('sameId', [0, 0, 0], [0, 0, 0, 1], [0, 0, 0]));
    }
    const snap = new Snapshot({ entities, timestamp: 0, sequence: 0 });
    const raw = snap.serialize();
    const compressed = snap.compress();
    expect(compressed.byteLength).toBeLessThan(raw.byteLength);
  });

  it('deserialize rejects bad magic', () => {
    const buf = new ArrayBuffer(21);
    const dv = new DataView(buf);
    dv.setUint32(0, 0xdeadbeef, true);
    expect(() => Snapshot.deserialize(buf)).toThrow(/magic/);
  });

  it('deserialize rejects unsupported version', () => {
    const buf = new ArrayBuffer(21);
    const dv = new DataView(buf);
    dv.setUint32(0, 0x56534e50, true);
    dv.setUint8(4, 99);
    expect(() => Snapshot.deserialize(buf)).toThrow(/version/);
  });

  it('deserialize rejects too-small buffer', () => {
    const buf = new ArrayBuffer(4);
    expect(() => Snapshot.deserialize(buf)).toThrow(/too small/);
  });

  it('serialize throws on id exceeding 255 bytes', () => {
    const longId = 'x'.repeat(300);
    const snap = new Snapshot({
      entities: [makeEntity(longId, [0, 0, 0])],
    });
    expect(() => snap.serialize()).toThrow(/exceeds/);
  });
});

// ════════════════════════════════════════════════════════════════
// NetworkLerp
// ════════════════════════════════════════════════════════════════
describe('NetworkLerp', () => {
  it('lerpPosition returns from at t=0 and to at t=1', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(10, 20, 30);
    const r0 = NetworkLerp.lerpPosition(a, b, 0);
    expect(r0.x).toBe(0);
    expect(r0.y).toBe(0);
    expect(r0.z).toBe(0);
    const r1 = NetworkLerp.lerpPosition(a, b, 1);
    expect(r1.x).toBe(10);
    expect(r1.y).toBe(20);
    expect(r1.z).toBe(30);
  });

  it('lerpPosition at t=0.5 is midpoint', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(10, 20, 30);
    const r = NetworkLerp.lerpPosition(a, b, 0.5);
    expect(r.x).toBeCloseTo(5, 5);
    expect(r.y).toBeCloseTo(10, 5);
    expect(r.z).toBeCloseTo(15, 5);
  });

  it('lerpPosition clamps t outside [0,1]', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(10, 0, 0);
    const below = NetworkLerp.lerpPosition(a, b, -1);
    expect(below.x).toBe(0);
    const above = NetworkLerp.lerpPosition(a, b, 2);
    expect(above.x).toBe(10);
  });

  it('lerpPosition does not mutate inputs', () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    NetworkLerp.lerpPosition(a, b, 0.5);
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
    expect(a.z).toBe(3);
    expect(b.x).toBe(4);
    expect(b.y).toBe(5);
    expect(b.z).toBe(6);
  });

  it('lerpRotation returns identity at t=0', () => {
    const a = new Quaternion(0, 0, 0, 1);
    const b = new Quaternion(0, 0, 0.7071, 0.7071);
    const r = NetworkLerp.lerpRotation(a, b, 0);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(0, 5);
    expect(r.w).toBeCloseTo(1, 5);
  });

  it('lerpRotation returns target at t=1', () => {
    const a = new Quaternion(0, 0, 0, 1);
    const b = new Quaternion(0, 0, 0.7071, 0.7071);
    const r = NetworkLerp.lerpRotation(a, b, 1);
    expect(r.z).toBeCloseTo(0.7071, 4);
    expect(r.w).toBeCloseTo(0.7071, 4);
  });

  it('lerpRotation takes shortest arc (negates when dot < 0)', () => {
    // a 与 b 表示同一旋转但 b 分量取反（dot<0），slerp 应走短弧返回接近 a。
    const a = new Quaternion(0, 0, 0, 1);
    const b = new Quaternion(0, 0, 0, -1); // 等价于 a（双重覆盖）
    const r = NetworkLerp.lerpRotation(a, b, 0.5);
    // 短弧：结果应接近 identity，而非绕远到 -1
    expect(Math.abs(r.w)).toBeCloseTo(1, 4);
  });

  it('lerpRotation does not mutate inputs', () => {
    const a = new Quaternion(0, 0, 0, 1);
    const b = new Quaternion(0, 0, 0.7071, 0.7071);
    NetworkLerp.lerpRotation(a, b, 0.5);
    expect(a.w).toBe(1);
    expect(b.z).toBeCloseTo(0.7071, 4);
  });

  it('predict extrapolates position by velocity * dt', () => {
    const pos = new Vector3(1, 0, 0);
    const vel = new Vector3(2, 0, -3);
    // maxSeconds=1.0 避免默认 0.2 clamp 干扰基础外推验证
    const r = NetworkLerp.predict(pos, vel, 0.5, 1.0);
    expect(r.x).toBeCloseTo(2, 5);
    expect(r.z).toBeCloseTo(-1.5, 5);
  });

  it('predict clamps dt to maxSeconds', () => {
    const pos = new Vector3(0, 0, 0);
    const vel = new Vector3(10, 0, 0);
    const r = NetworkLerp.predict(pos, vel, 5, 0.2);
    expect(r.x).toBeCloseTo(2, 5); // 10 * 0.2
  });

  it('predict clamps negative dt to 0', () => {
    const pos = new Vector3(5, 5, 5);
    const vel = new Vector3(10, 0, 0);
    const r = NetworkLerp.lerpPosition(pos, pos, 0); // sanity
    void r;
    const p = NetworkLerp.predict(pos, vel, -1);
    expect(p.x).toBe(5);
  });

  it('reconcile at blendFactor=0 keeps client', () => {
    const server = { position: new Vector3(100, 0, 0), rotation: new Quaternion(0, 0, 0.7071, 0.7071) };
    const client = { position: new Vector3(0, 0, 0), rotation: new Quaternion(0, 0, 0, 1) };
    const r = NetworkLerp.reconcile(server, client, 0);
    expect(r.position.x).toBeCloseTo(0, 5);
    expect(r.rotation.w).toBeCloseTo(1, 5);
  });

  it('reconcile at blendFactor=1 takes server', () => {
    const server = { position: new Vector3(100, 0, 0), rotation: new Quaternion(0, 0, 0.7071, 0.7071) };
    const client = { position: new Vector3(0, 0, 0), rotation: new Quaternion(0, 0, 0, 1) };
    const r = NetworkLerp.reconcile(server, client, 1);
    expect(r.position.x).toBeCloseTo(100, 5);
    expect(r.rotation.z).toBeCloseTo(0.7071, 4);
  });

  it('reconcile at blendFactor=0.5 blends both', () => {
    const server = { position: new Vector3(10, 0, 0), rotation: new Quaternion(0, 0, 0, 1) };
    const client = { position: new Vector3(0, 0, 0), rotation: new Quaternion(0, 0, 0, 1) };
    const r = NetworkLerp.reconcile(server, client, 0.5);
    expect(r.position.x).toBeCloseTo(5, 5);
  });

  it('reconcile does not mutate inputs', () => {
    const server = { position: new Vector3(10, 0, 0), rotation: new Quaternion(0, 0, 0, 1) };
    const client = { position: new Vector3(0, 0, 0), rotation: new Quaternion(0, 0, 0, 1) };
    NetworkLerp.reconcile(server, client, 0.5);
    expect(server.position.x).toBe(10);
    expect(client.position.x).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// NetworkSync
// ════════════════════════════════════════════════════════════════
describe('NetworkSync', () => {
  it('start/stop toggles running state and stores transport', async () => {
    const t = new MockTransport('s');
    const sync = new NetworkSync();
    await t.connect();
    sync.start(t, true);
    expect(sync.transport).toBe(t);
    expect(sync.isServer).toBe(true);
    sync.stop();
    expect(sync.transport).toBeNull();
  });

  it('registerEntity / unregisterEntity manage entities map', () => {
    const sync = new NetworkSync();
    const e = createNetworkEntity('e1', 'owner1', new Vector3(1, 2, 3));
    sync.registerEntity('e1', e);
    expect(sync.entities.has('e1')).toBe(true);
    expect(sync.entities.get('e1')?.position.x).toBe(1);
    sync.unregisterEntity('e1');
    expect(sync.entities.has('e1')).toBe(false);
  });

  it('unregisterEntity on unknown id is a no-op', () => {
    const sync = new NetworkSync();
    expect(() => sync.unregisterEntity('missing')).not.toThrow();
  });

  it('createNetworkEntity initializes interpolated fields as copies', () => {
    const pos = new Vector3(1, 2, 3);
    const rot = new Quaternion(0, 0, 0, 1);
    const e = createNetworkEntity('id', 'owner', pos, rot);
    expect(e.interpolatedPosition).not.toBe(pos);
    expect(e.interpolatedPosition.x).toBe(1);
    expect(e.interpolatedRotation).not.toBe(rot);
    expect(e.interpolatedRotation.w).toBe(1);
    expect(e.lastUpdate).toBe(0);
  });

  it('server sendSnapshot delivers to paired client via transport', async () => {
    const serverT = new MockTransport('server');
    const clientT = new MockTransport('client');
    MockTransport.pair(serverT, clientT);
    await serverT.connect();
    await clientT.connect();

    const server = new NetworkSync({ syncRate: 10 });
    const client = new NetworkSync();

    const se = createNetworkEntity('hero', 'srv', new Vector3(5, 0, 0));
    const ce = createNetworkEntity('hero', 'srv', new Vector3(0, 0, 0));
    server.registerEntity('hero', se);
    client.registerEntity('hero', ce);

    server.start(serverT, true);
    client.start(clientT, false);

    server.sendSnapshot();

    // 客户端应已收到并更新权威 position
    expect(ce.position.x).toBeCloseTo(5, 5);
    expect(ce.lastUpdate).toBeGreaterThan(0);
    server.stop();
    client.stop();
  });

  it('sendSnapshot when not connected is a no-op', async () => {
    const serverT = new MockTransport('s');
    const clientT = new MockTransport('c');
    MockTransport.pair(serverT, clientT);
    // serverT 未 connect
    const server = new NetworkSync();
    const e = createNetworkEntity('e', 'o', new Vector3(1, 1, 1));
    server.registerEntity('e', e);
    server.start(serverT, true);
    // 不应抛错
    server.sendSnapshot();
    server.stop();
  });

  it('update at syncRate triggers sendSnapshot on server', async () => {
    const serverT = new MockTransport('s');
    const clientT = new MockTransport('c');
    MockTransport.pair(serverT, clientT);
    await serverT.connect();
    await clientT.connect();

    let receivedCount = 0;
    clientT.onMessage(() => { receivedCount++; });

    const server = new NetworkSync({ syncRate: 10 }); // 10 Hz → 每 0.1s 一次
    server.registerEntity('e', createNetworkEntity('e', 'o', new Vector3(0, 0, 0)));
    server.start(serverT, true);

    // 推进 0.35s 应触发 3 次（0.1, 0.2, 0.3）
    server.update(0.35);
    expect(receivedCount).toBe(3);
    server.stop();
  });

  it('update does nothing when stopped', () => {
    const sync = new NetworkSync({ syncRate: 10 });
    // 不 start，update 应静默
    expect(() => sync.update(0.5)).not.toThrow();
  });

  it('client update with interpolation copies authoritative state when no buffer yet', async () => {
    const clientT = new MockTransport('c');
    await clientT.connect();
    const client = new NetworkSync({ interpolation: true, interpolationDelay: 0 });
    const e = createNetworkEntity('e', 'o', new Vector3(0, 0, 0));
    client.registerEntity('e', e);
    client.start(clientT, false);

    client.update(0.016);
    // 无快照：interpolated 应等于 position（初始 0）
    expect(e.interpolatedPosition.x).toBe(0);
    client.stop();
  });

  it('receiveSnapshot updates authoritative state and interpolation buffer', () => {
    const client = new NetworkSync();
    const e = createNetworkEntity('hero', 'srv', new Vector3(0, 0, 0));
    client.registerEntity('hero', e);

    const snap1 = new Snapshot({
      entities: [makeEntity('hero', [10, 0, 0])],
      timestamp: 1000,
      sequence: 0,
    });
    // 注入 receiveSnapshot（绕过 transport）
    client.receiveSnapshot(snap1.serialize());

    expect(e.position.x).toBeCloseTo(10, 5);
    expect(e.lastUpdate).toBe(1000);

    const snap2 = new Snapshot({
      entities: [makeEntity('hero', [20, 0, 0])],
      timestamp: 1100,
      sequence: 1,
    });
    client.receiveSnapshot(snap2.serialize());
    expect(e.position.x).toBeCloseTo(20, 5);
  });

  it('interpolate produces midpoint at t=0.5 with controlled clock', () => {
    // 用注入时钟控制 renderTime
    let clock = 1150; // renderTime = 1150 - 50 = 1100 → 但需让插值落在 prev=1000, next=1100
    const client = new NetworkSync({
      interpolation: true,
      interpolationDelay: 50,
      now: () => clock,
    });
    const e = createNetworkEntity('hero', 'srv', new Vector3(0, 0, 0));
    client.registerEntity('hero', e);

    // snap1 @ t=1000, pos=(0,0,0)
    client.receiveSnapshot(new Snapshot({
      entities: [makeEntity('hero', [0, 0, 0])],
      timestamp: 1000,
      sequence: 0,
    }).serialize());
    // snap2 @ t=1100, pos=(10,0,0)
    client.receiveSnapshot(new Snapshot({
      entities: [makeEntity('hero', [10, 0, 0])],
      timestamp: 1100,
      sequence: 1,
    }).serialize());

    // clock=1150 → renderTime=1100 → t=(1100-1000)/100=1 → 等于 next
    client.interpolate(0.016);
    expect(e.interpolatedPosition.x).toBeCloseTo(10, 5);

    // clock=1050 → renderTime=1000 → t=0 → 等于 prev
    clock = 1050;
    client.interpolate(0.016);
    expect(e.interpolatedPosition.x).toBeCloseTo(0, 5);

    // clock=1100 → renderTime=1050 → t=0.5 → 中点
    clock = 1100;
    client.interpolate(0.016);
    expect(e.interpolatedPosition.x).toBeCloseTo(5, 5);
  });

  it('interpolate clamps when renderTime is outside [prev, next]', () => {
    let clock = 0;
    const client = new NetworkSync({
      interpolation: true,
      interpolationDelay: 0,
      now: () => clock,
    });
    const e = createNetworkEntity('hero', 'srv', new Vector3(0, 0, 0));
    client.registerEntity('hero', e);
    client.receiveSnapshot(new Snapshot({
      entities: [makeEntity('hero', [0, 0, 0])],
      timestamp: 1000, sequence: 0,
    }).serialize());
    client.receiveSnapshot(new Snapshot({
      entities: [makeEntity('hero', [10, 0, 0])],
      timestamp: 1100, sequence: 1,
    }).serialize());

    // renderTime 远早于 prev → clamp 到 prev
    clock = 500;
    client.interpolate(0.016);
    expect(e.interpolatedPosition.x).toBeCloseTo(0, 5);

    // renderTime 远晚于 next → clamp 到 next
    clock = 5000;
    client.interpolate(0.016);
    expect(e.interpolatedPosition.x).toBeCloseTo(10, 5);
  });

  it('interpolate with only one snapshot aligns to authoritative', () => {
    let clock = 1000;
    const client = new NetworkSync({
      interpolation: true,
      interpolationDelay: 0,
      now: () => clock,
    });
    const e = createNetworkEntity('hero', 'srv', new Vector3(0, 0, 0));
    client.registerEntity('hero', e);
    // 只收一个包 → buffer.next = null → 对齐 position
    client.receiveSnapshot(new Snapshot({
      entities: [makeEntity('hero', [7, 8, 9])],
      timestamp: 1000, sequence: 0,
    }).serialize());
    client.interpolate(0.016);
    expect(e.interpolatedPosition.x).toBeCloseTo(7, 5);
    expect(e.interpolatedPosition.y).toBeCloseTo(8, 5);
    expect(e.interpolatedPosition.z).toBeCloseTo(9, 5);
  });

  it('receiveSnapshot ignores unknown entity ids', () => {
    const client = new NetworkSync();
    const snap = new Snapshot({
      entities: [makeEntity('ghost', [1, 2, 3])],
      timestamp: 100, sequence: 0,
    });
    expect(() => client.receiveSnapshot(snap.serialize())).not.toThrow();
    expect(client.entities.size).toBe(0);
  });

  it('receiveSnapshot drops malformed data with warn (no throw)', () => {
    const client = new NetworkSync();
    const e = createNetworkEntity('hero', 'srv', new Vector3(1, 1, 1));
    client.registerEntity('hero', e);
    const bad = new ArrayBuffer(4); // 太短
    expect(() => client.receiveSnapshot(bad)).not.toThrow();
    // 已有状态不受影响
    expect(e.position.x).toBe(1);
  });

  it('server ignores incoming data (authoritative model)', async () => {
    const serverT = new MockTransport('s');
    const clientT = new MockTransport('c');
    MockTransport.pair(serverT, clientT);
    await serverT.connect();
    await clientT.connect();

    const server = new NetworkSync();
    const e = createNetworkEntity('hero', 'srv', new Vector3(5, 0, 0));
    server.registerEntity('hero', e);
    server.start(serverT, true);

    // 客户端发垃圾给服务器 → 服务器应忽略
    clientT.send(new ArrayBuffer(4));
    expect(e.position.x).toBe(5); // 未变
    server.stop();
  });

  it('full server→client flow with interpolation delay', async () => {
    const serverT = new MockTransport('s');
    const clientT = new MockTransport('c');
    MockTransport.pair(serverT, clientT);
    await serverT.connect();
    await clientT.connect();

    let clock = 1000;
    const server = new NetworkSync({ syncRate: 20, now: () => clock });
    const client = new NetworkSync({ interpolation: true, interpolationDelay: 50, now: () => clock });

    const se = createNetworkEntity('hero', 'srv', new Vector3(0, 0, 0));
    const ce = createNetworkEntity('hero', 'srv', new Vector3(0, 0, 0));
    server.registerEntity('hero', se);
    client.registerEntity('hero', ce);

    server.start(serverT, true);
    client.start(clientT, false);

    // t=1000: 服务器位置 0
    server.sendSnapshot();
    // t=1100: 服务器位置 10
    clock = 1100;
    se.position.set(10, 0, 0);
    server.sendSnapshot();

    // 客户端权威 position 已更新到 10
    expect(ce.position.x).toBeCloseTo(10, 5);

    // renderTime = 1100 - 50 = 1050 → t = (1050-1000)/100 = 0.5 → 中点 5
    client.interpolate(0.016);
    expect(ce.interpolatedPosition.x).toBeCloseTo(5, 5);

    server.stop();
    client.stop();
  });
});
