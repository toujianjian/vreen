// StateSync 单元测试。
//
// 测试策略:
//   - 注入式时钟 (now) 控制插值时间戳, 避免依赖真实 wall clock。
//   - createSnapshot/applySnapshot 走服务器→客户端流转。
//   - packSnapshot/unpackSnapshot 验证紧凑往返 + Delta (只含 dirty, 打包后清 dirty)。
//   - interpolate 用手工构造两个快照 + 控制 renderTime 验证中点/clamp/外推。
//   - extrapolate 用确定 velocity 验证位置推进 + maxExtrapolation clamp。

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import {
  StateSync,
  createSyncEntity,
  type SyncEntity,
  type StateSnapshot,
} from './StateSync';

// ── 辅助: 构造 SyncEntity ───────────────────────────────────────
function makeEntity(
  id: number,
  pos: [number, number, number],
  rot: [number, number, number, number] = [0, 0, 0, 1],
  vel: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): SyncEntity {
  return {
    id,
    position: new Vector3(pos[0], pos[1], pos[2]),
    rotation: new Quaternion(rot[0], rot[1], rot[2], rot[3]),
    scale: new Vector3(scale[0], scale[1], scale[2]),
    velocity: new Vector3(vel[0], vel[1], vel[2]),
    dirty: true,
    lastUpdate: 0,
    properties: new Map(),
  };
}

// ════════════════════════════════════════════════════════════════
// 实体注册 / 查询
// ════════════════════════════════════════════════════════════════
describe('StateSync entity registration', () => {
  it('server registers into localEntities', () => {
    const s = new StateSync({ isServer: true });
    const e = makeEntity(1, [1, 2, 3]);
    s.registerEntity(1, e);
    expect(s.localEntities.size).toBe(1);
    expect(s.remoteEntities.size).toBe(0);
    expect(s.getEntity(1)).toBe(e);
  });

  it('client registers into remoteEntities', () => {
    const s = new StateSync({ isServer: false });
    const e = makeEntity(2, [0, 0, 0]);
    s.registerEntity(2, e);
    expect(s.remoteEntities.size).toBe(1);
    expect(s.localEntities.size).toBe(0);
    expect(s.getEntity(2)).toBe(e);
  });

  it('unregisterEntity removes from both maps', () => {
    const s = new StateSync({ isServer: true });
    s.registerEntity(1, makeEntity(1, [0, 0, 0]));
    s.unregisterEntity(1);
    expect(s.localEntities.has(1)).toBe(false);
    expect(s.getEntity(1)).toBeUndefined();
  });

  it('unregisterEntity on unknown id is a no-op', () => {
    const s = new StateSync();
    expect(() => s.unregisterEntity(999)).not.toThrow();
  });

  it('getEntities returns array of entities', () => {
    const s = new StateSync({ isServer: true });
    s.registerEntity(1, makeEntity(1, [0, 0, 0]));
    s.registerEntity(2, makeEntity(2, [1, 1, 1]));
    const arr = s.getEntities();
    expect(arr.length).toBe(2);
    expect(s.getEntityCount()).toBe(2);
  });

  it('getEntityCount returns 0 for empty', () => {
    const s = new StateSync();
    expect(s.getEntityCount()).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// createSnapshot / applySnapshot
// ════════════════════════════════════════════════════════════════
describe('StateSync snapshot create/apply', () => {
  it('createSnapshot clones local entities TRS', () => {
    const s = new StateSync({ isServer: true, now: () => 1000 });
    const e = makeEntity(1, [5, 0, 0]);
    s.registerEntity(1, e);
    const snap = s.createSnapshot();
    expect(snap.timestamp).toBe(1000);
    expect(snap.entities.length).toBe(1);
    expect(snap.entities[0].position.x).toBe(5);
    // 快照应克隆, 不共享引用
    expect(snap.entities[0].position).not.toBe(e.position);
    // 修改原实体不影响快照
    e.position.set(99, 0, 0);
    expect(snap.entities[0].position.x).toBe(5);
  });

  it('applySnapshot creates remote entity on first sight', () => {
    const client = new StateSync({ isServer: false });
    const snap: StateSnapshot = {
      timestamp: 1000,
      entities: [makeEntity(7, [1, 2, 3])],
    };
    client.applySnapshot(snap);
    const e = client.getEntity(7);
    expect(e).toBeDefined();
    expect(e!.position.x).toBe(1);
    expect(e!.lastUpdate).toBe(1000);
  });

  it('applySnapshot updates existing remote entity', () => {
    const client = new StateSync({ isServer: false });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0])] });
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [10, 0, 0])] });
    const e = client.getEntity(1);
    expect(e!.position.x).toBe(10);
    expect(e!.lastUpdate).toBe(1100);
  });

  it('applySnapshot pushes into snapshots buffer', () => {
    const client = new StateSync();
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0])] });
    expect(client.snapshots.length).toBe(1);
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [1, 0, 0])] });
    expect(client.snapshots.length).toBe(2);
  });

  it('applySnapshot discards out-of-order snapshots', () => {
    const client = new StateSync();
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [0, 0, 0])] });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [1, 0, 0])] });
    // 1000 < 1100, 丢弃
    expect(client.snapshots.length).toBe(1);
    expect(client.snapshots[0].timestamp).toBe(1100);
  });

  it('snapshots buffer caps at maxSnapshots', () => {
    const client = new StateSync({ maxSnapshots: 3 });
    for (let i = 0; i < 5; i++) {
      client.applySnapshot({ timestamp: 1000 + i * 100, entities: [makeEntity(1, [i, 0, 0])] });
    }
    expect(client.snapshots.length).toBe(3);
    // 最旧的被丢弃, 保留最新 3 个
    expect(client.snapshots[0].timestamp).toBe(1200);
    expect(client.snapshots[2].timestamp).toBe(1400);
  });

  it('applySnapshot merges properties', () => {
    const client = new StateSync();
    const e = makeEntity(1, [0, 0, 0]);
    e.properties.set('hp', 100);
    client.applySnapshot({ timestamp: 1000, entities: [e] });
    const updated = client.getEntity(1)!;
    expect(updated.properties.get('hp')).toBe(100);
    // 更新 properties
    const e2 = makeEntity(1, [0, 0, 0]);
    e2.properties.set('hp', 50);
    e2.properties.set('mp', 30);
    client.applySnapshot({ timestamp: 1100, entities: [e2] });
    expect(updated.properties.get('hp')).toBe(50);
    expect(updated.properties.get('mp')).toBe(30);
  });
});

// ════════════════════════════════════════════════════════════════
// packSnapshot / unpackSnapshot (Delta 压缩)
// ════════════════════════════════════════════════════════════════
describe('StateSync pack/unpack snapshot', () => {
  it('packSnapshot only includes dirty entities (Delta)', () => {
    const s = new StateSync({ isServer: true, now: () => 1000 });
    const e1 = makeEntity(1, [1, 0, 0]); e1.dirty = true;
    const e2 = makeEntity(2, [0, 0, 0]); e2.dirty = false;
    s.registerEntity(1, e1);
    s.registerEntity(2, e2);
    const snap = s.createSnapshot();
    const packed = s.packSnapshot(snap);
    expect(packed.t).toBe(1000);
    expect(packed.n).toBe(1); // 只含 dirty 的 e1
    expect(packed.d.length).toBe(14); // 14 元素/实体
  });

  it('packSnapshot clears dirty flag after packing', () => {
    const s = new StateSync({ isServer: true });
    const e = makeEntity(1, [0, 0, 0]); e.dirty = true;
    s.registerEntity(1, e);
    const snap = s.createSnapshot();
    s.packSnapshot(snap);
    expect(e.dirty).toBe(false);
    // 第二次打包应为空 (无 dirty)
    const packed2 = s.packSnapshot(s.createSnapshot());
    expect(packed2.n).toBe(0);
    expect(packed2.d.length).toBe(0);
  });

  it('unpackSnapshot is inverse of packSnapshot', () => {
    const s = new StateSync({ isServer: true, now: () => 500 });
    const e = makeEntity(42, [1.5, -2.25, 3.75], [0, 0, 0.7071, 0.7071], [10, 0, -5], [2, 2, 2]);
    e.dirty = true;
    s.registerEntity(42, e);
    const snap = s.createSnapshot();
    const packed = s.packSnapshot(snap);
    const unpacked = s.unpackSnapshot(packed);
    expect(unpacked.timestamp).toBe(500);
    expect(unpacked.entities.length).toBe(1);
    const u = unpacked.entities[0];
    expect(u.id).toBe(42);
    expect(u.position.x).toBeCloseTo(1.5, 5);
    expect(u.position.y).toBeCloseTo(-2.25, 5);
    expect(u.position.z).toBeCloseTo(3.75, 5);
    expect(u.rotation.z).toBeCloseTo(0.7071, 4);
    expect(u.rotation.w).toBeCloseTo(0.7071, 4);
    expect(u.velocity.x).toBeCloseTo(10, 5);
    expect(u.velocity.z).toBeCloseTo(-5, 5);
    expect(u.scale.x).toBeCloseTo(2, 5);
  });

  it('full server→client flow with pack/unpack', () => {
    // 服务器打包 → 客户端解包 → applySnapshot → 插值
    const server = new StateSync({ isServer: true, now: () => 1000 });
    const client = new StateSync({ isServer: false, interpolationDelay: 0, now: () => 1000 });
    const se = makeEntity(1, [0, 0, 0]); se.dirty = true;
    server.registerEntity(1, se);

    // t=1000: pos=0
    const snap1 = server.createSnapshot();
    const packed1 = server.packSnapshot(snap1);
    client.applySnapshot(client.unpackSnapshot(packed1));

    // t=1100: pos=10
    se.position.set(10, 0, 0); se.dirty = true;
    const snap2 = server.createSnapshot(1100);
    const packed2 = server.packSnapshot(snap2);
    client.applySnapshot(client.unpackSnapshot(packed2));

    expect(client.getEntity(1)!.position.x).toBe(10);
  });
});

// ════════════════════════════════════════════════════════════════
// interpolate
// ════════════════════════════════════════════════════════════════
describe('StateSync interpolate', () => {
  it('produces midpoint at t=0.5 with controlled clock', () => {
    let clock = 1000;
    const client = new StateSync({
      isServer: false,
      interpolationDelay: 50,
      now: () => clock,
    });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0])] });
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [10, 0, 0])] });

    // clock=1100 → renderTime=1050 → t=(1050-1000)/100=0.5 → 5
    clock = 1100;
    client.interpolate(clock);
    expect(client.getEntity(1)!.position.x).toBeCloseTo(5, 5);
  });

  it('aligns to prev at t=0', () => {
    let clock = 1000;
    const client = new StateSync({
      isServer: false,
      interpolationDelay: 0,
      now: () => clock,
    });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0])] });
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [10, 0, 0])] });
    clock = 1000;
    client.interpolate(clock);
    expect(client.getEntity(1)!.position.x).toBeCloseTo(0, 5);
  });

  it('aligns to next at t=1', () => {
    let clock = 1000;
    const client = new StateSync({
      isServer: false,
      interpolationDelay: 0,
      now: () => clock,
    });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0])] });
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [10, 0, 0])] });
    clock = 1100;
    client.interpolate(clock);
    expect(client.getEntity(1)!.position.x).toBeCloseTo(10, 5);
  });

  it('clamps to earliest when renderTime before first snapshot', () => {
    let clock = 500;
    const client = new StateSync({
      isServer: false,
      interpolationDelay: 0,
      now: () => clock,
    });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0])] });
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [10, 0, 0])] });
    clock = 500; // renderTime=500 < 1000
    client.interpolate(clock);
    expect(client.getEntity(1)!.position.x).toBeCloseTo(0, 5);
  });

  it('extrapolates when renderTime after latest snapshot', () => {
    let clock = 1000;
    const client = new StateSync({
      isServer: false,
      interpolationDelay: 0,
      maxExtrapolation: 1.0,
      now: () => clock,
    });
    // 实体带速度, 外推应沿 velocity 推进
    client.applySnapshot({
      timestamp: 1000,
      entities: [makeEntity(1, [0, 0, 0], [0, 0, 0, 1], [1, 0, 0])],
    });
    // renderTime = 1500 → dt = (1500-1000)/1000 = 0.5s → pos.x += 1*0.5 = 0.5
    clock = 1500;
    client.interpolate(clock);
    expect(client.getEntity(1)!.position.x).toBeCloseTo(0.5, 5);
  });

  it('single snapshot aligns to that snapshot', () => {
    const client = new StateSync({ isServer: false, interpolationDelay: 0 });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [7, 8, 9])] });
    client.interpolate(1000);
    const e = client.getEntity(1)!;
    expect(e.position.x).toBeCloseTo(7, 5);
    expect(e.position.y).toBeCloseTo(8, 5);
    expect(e.position.z).toBeCloseTo(9, 5);
  });

  it('interpolates rotation via slerp', () => {
    let clock = 1000;
    const client = new StateSync({
      isServer: false,
      interpolationDelay: 0,
      now: () => clock,
    });
    // prev: identity, next: 90° around Y
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0], [0, 0, 0, 1])] });
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [0, 0, 0], [0, 0.7071, 0, 0.7071])] });
    clock = 1050; // t=0.5
    client.interpolate(clock);
    // slerp 中点: w ≈ 0.9239, y ≈ 0.3827 (45° around Y)
    const r = client.getEntity(1)!.rotation;
    expect(r.w).toBeCloseTo(0.9239, 3);
    expect(r.y).toBeCloseTo(0.3827, 3);
  });

  it('interpolates scale', () => {
    let clock = 1000;
    const client = new StateSync({
      isServer: false,
      interpolationDelay: 0,
      now: () => clock,
    });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0], undefined, undefined, [1, 1, 1])] });
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [0, 0, 0], undefined, undefined, [3, 3, 3])] });
    clock = 1050;
    client.interpolate(clock);
    const e = client.getEntity(1)!;
    expect(e.scale.x).toBeCloseTo(2, 5);
  });
});

// ════════════════════════════════════════════════════════════════
// extrapolate
// ════════════════════════════════════════════════════════════════
describe('StateSync extrapolate', () => {
  it('advances position by velocity * dt', () => {
    const s = new StateSync({ maxExtrapolation: 1.0 });
    const e = makeEntity(1, [0, 0, 0], undefined, [2, 0, -3]);
    s.extrapolate(e, 0.5);
    expect(e.position.x).toBeCloseTo(1, 5);
    expect(e.position.z).toBeCloseTo(-1.5, 5);
  });

  it('clamps dt to maxExtrapolation', () => {
    const s = new StateSync({ maxExtrapolation: 0.2 });
    const e = makeEntity(1, [0, 0, 0], undefined, [10, 0, 0]);
    s.extrapolate(e, 5); // 应 clamp 到 0.2
    expect(e.position.x).toBeCloseTo(2, 5);
  });

  it('clamps negative dt to 0', () => {
    const s = new StateSync();
    const e = makeEntity(1, [5, 5, 5], undefined, [10, 0, 0]);
    s.extrapolate(e, -1);
    expect(e.position.x).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════
// update / setInterpolationDelay / getStats
// ════════════════════════════════════════════════════════════════
describe('StateSync update / config / stats', () => {
  it('update on client triggers interpolate', () => {
    let clock = 1100;
    const client = new StateSync({
      isServer: false,
      interpolationDelay: 50,
      now: () => clock,
    });
    client.applySnapshot({ timestamp: 1000, entities: [makeEntity(1, [0, 0, 0])] });
    client.applySnapshot({ timestamp: 1100, entities: [makeEntity(1, [10, 0, 0])] });
    // renderTime = 1100 - 50 = 1050 → t=0.5 → 5
    client.update(0.016);
    expect(client.getEntity(1)!.position.x).toBeCloseTo(5, 5);
  });

  it('update on server is a no-op', () => {
    const server = new StateSync({ isServer: true });
    server.registerEntity(1, makeEntity(1, [0, 0, 0]));
    expect(() => server.update(0.016)).not.toThrow();
  });

  it('setInterpolationDelay updates delay', () => {
    const s = new StateSync({ interpolationDelay: 100 });
    expect(s.interpolationDelay).toBe(100);
    s.setInterpolationDelay(200);
    expect(s.interpolationDelay).toBe(200);
    // 负值 clamp 到 0
    s.setInterpolationDelay(-50);
    expect(s.interpolationDelay).toBe(0);
  });

  it('getStats returns correct counts', () => {
    const s = new StateSync({ isServer: true, maxSnapshots: 10, interpolationDelay: 50 });
    s.registerEntity(1, makeEntity(1, [0, 0, 0]));
    s.registerEntity(2, makeEntity(2, [1, 1, 1]));
    const stats = s.getStats();
    expect(stats.localCount).toBe(2);
    expect(stats.remoteCount).toBe(0);
    expect(stats.snapshotCount).toBe(0);
    expect(stats.maxSnapshots).toBe(10);
    expect(stats.interpolationDelay).toBe(50);
    expect(stats.isServer).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// createSyncEntity 工厂
// ════════════════════════════════════════════════════════════════
describe('createSyncEntity factory', () => {
  it('creates entity with cloned TRS and defaults', () => {
    const pos = new Vector3(1, 2, 3);
    const e = createSyncEntity(5, pos);
    expect(e.id).toBe(5);
    expect(e.position).not.toBe(pos); // 克隆
    expect(e.position.x).toBe(1);
    expect(e.scale.x).toBe(1); // 默认 (1,1,1)
    expect(e.dirty).toBe(true);
    expect(e.properties).toBeInstanceOf(Map);
    expect(e.lastUpdate).toBe(0);
  });

  it('accepts custom rotation, scale, velocity', () => {
    const rot = new Quaternion(0, 0, 0.7071, 0.7071);
    const scale = new Vector3(2, 2, 2);
    const vel = new Vector3(1, 0, 0);
    const e = createSyncEntity(1, new Vector3(), rot, scale, vel);
    expect(e.rotation.z).toBeCloseTo(0.7071, 4);
    expect(e.scale.x).toBe(2);
    expect(e.velocity.x).toBe(1);
    // 不共享引用
    expect(e.rotation).not.toBe(rot);
    expect(e.scale).not.toBe(scale);
  });
});
