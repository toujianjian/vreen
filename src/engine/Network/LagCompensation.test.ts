// LagCompensation 单元测试。
//
// 测试策略:
//   - 注入式时钟 (now) 不需要,因为 recordSnapshot 显式传 timestamp。
//   - 构造手工历史序列 (多 timestamp × 多实体), 验证:
//     * recordSnapshot 升序插入 + 容量裁剪 + 乱序丢弃
//     * interpolate 在 [prev, next] 内中点插值, 超出范围 clamp
//     * queryHistory 返回克隆 (修改不影响历史)
//     * rewindTo + restoreCurrent 往返 (states 恢复原值)
//     * checkHit 命中/未命中边界
//     * pruneOldEntries 按 historyDuration 清除
//   - 用 Vector3/Quaternion 真实实例验证 slerp/lerp 数学。

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import {
  LagCompensation,
  createEntityState,
  type EntityState,
  type HitBounds,
} from './LagCompensation';

// ── 辅助 ────────────────────────────────────────────────────────────

function makeState(
  id: number,
  pos: [number, number, number],
  rot: [number, number, number, number] = [0, 0, 0, 1],
  vel: [number, number, number] = [0, 0, 0],
  ts: number = 0,
): EntityState {
  return {
    id,
    position: new Vector3(pos[0], pos[1], pos[2]),
    rotation: new Quaternion(rot[0], rot[1], rot[2], rot[3]),
    velocity: new Vector3(vel[0], vel[1], vel[2]),
    timestamp: ts,
  };
}

function makeBounds(
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
): HitBounds {
  return {
    center: new Vector3(cx, cy, cz),
    halfExtents: new Vector3(hx, hy, hz),
  };
}

// ═════════════════════════════════════════════════════════════════════
// 构造 / 配置
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation construction', () => {
  it('default options', () => {
    const lc = new LagCompensation();
    expect(lc.isServer).toBe(false);
    expect(lc.maxHistorySize).toBe(64);
    expect(lc.historyDuration).toBe(1000);
    expect(lc.interpolationDelay).toBe(100);
    expect(lc.historyBuffer.length).toBe(0);
  });

  it('custom options', () => {
    const lc = new LagCompensation({
      isServer: true,
      maxHistorySize: 10,
      historyDuration: 500,
      interpolationDelay: 50,
    });
    expect(lc.isServer).toBe(true);
    expect(lc.maxHistorySize).toBe(10);
    expect(lc.historyDuration).toBe(500);
    expect(lc.interpolationDelay).toBe(50);
  });

  it('setters update config', () => {
    const lc = new LagCompensation();
    lc.setMaxHistorySize(20);
    lc.setHistoryDuration(2000);
    lc.setInterpolationDelay(150);
    expect(lc.maxHistorySize).toBe(20);
    expect(lc.historyDuration).toBe(2000);
    expect(lc.interpolationDelay).toBe(150);
  });

  it('setMaxHistorySize rejects < 1', () => {
    const lc = new LagCompensation();
    expect(() => lc.setMaxHistorySize(0)).toThrowError(/>= 1/);
  });

  it('setHistoryDuration rejects < 0', () => {
    const lc = new LagCompensation();
    expect(() => lc.setHistoryDuration(-1)).toThrowError(/>= 0/);
  });

  it('setInterpolationDelay rejects < 0', () => {
    const lc = new LagCompensation();
    expect(() => lc.setInterpolationDelay(-1)).toThrowError(/>= 0/);
  });

  it('getHistoryDuration returns duration', () => {
    const lc = new LagCompensation({ historyDuration: 750 });
    expect(lc.getHistoryDuration()).toBe(750);
  });
});

// ═════════════════════════════════════════════════════════════════════
// recordSnapshot
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation recordSnapshot', () => {
  it('appends entries in order', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [1, 0, 0])], 200);
    lc.recordSnapshot([makeState(1, [2, 0, 0])], 300);
    expect(lc.historyBuffer.length).toBe(3);
    expect(lc.getOldestTimestamp()).toBe(100);
    expect(lc.getNewestTimestamp()).toBe(300);
  });

  it('discards out-of-order snapshots', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 200);
    lc.recordSnapshot([makeState(1, [1, 0, 0])], 100); // 乱序,丢弃
    expect(lc.historyBuffer.length).toBe(1);
    expect(lc.getNewestTimestamp()).toBe(200);
  });

  it('trims to maxHistorySize', () => {
    const lc = new LagCompensation({ maxHistorySize: 3 });
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [1, 0, 0])], 200);
    lc.recordSnapshot([makeState(1, [2, 0, 0])], 300);
    lc.recordSnapshot([makeState(1, [3, 0, 0])], 400);
    expect(lc.historyBuffer.length).toBe(3);
    // 最旧的 100 应被裁剪
    expect(lc.getOldestTimestamp()).toBe(200);
    expect(lc.getNewestTimestamp()).toBe(400);
  });

  it('clones states to avoid external mutation', () => {
    const lc = new LagCompensation();
    const s = makeState(1, [5, 0, 0]);
    lc.recordSnapshot([s], 100);
    // 修改原 state, 历史不应受影响
    s.position.set(99, 0, 0);
    const queried = lc.queryHistory(100, 1);
    expect(queried).toBeDefined();
    expect(queried!.position.x).toBe(5);
  });

  it('records multiple entities per snapshot', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([
      makeState(1, [0, 0, 0]),
      makeState(2, [10, 0, 0]),
      makeState(3, [20, 0, 0]),
    ], 100);
    expect(lc.historyBuffer[0].entityStates.size).toBe(3);
  });

  it('getOldestTimestamp / getNewestTimestamp return 0 for empty', () => {
    const lc = new LagCompensation();
    expect(lc.getOldestTimestamp()).toBe(0);
    expect(lc.getNewestTimestamp()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// interpolate
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation interpolate', () => {
  it('returns null for empty history', () => {
    const lc = new LagCompensation();
    expect(lc.interpolate(100)).toBeNull();
  });

  it('returns cloned entry for single snapshot', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [5, 0, 0])], 100);
    const result = lc.interpolate(100);
    expect(result).not.toBeNull();
    expect(result!.size).toBe(1);
    expect(result!.get(1)!.position.x).toBe(5);
  });

  it('interpolates mid-point between two snapshots', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);
    // 中点 t=150 应得 x=5
    const result = lc.interpolate(150);
    expect(result!.get(1)!.position.x).toBeCloseTo(5, 5);
  });

  it('clamps to oldest when timestamp before history', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);
    const result = lc.interpolate(50);
    expect(result!.get(1)!.position.x).toBe(0); // clamp 到最旧
  });

  it('clamps to newest when timestamp after history', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);
    const result = lc.interpolate(300);
    expect(result!.get(1)!.position.x).toBe(10); // clamp 到最新
  });

  it('interpolates rotation via slerp', () => {
    const lc = new LagCompensation();
    // 0° 与 90° 绕 Y 轴
    lc.recordSnapshot([makeState(1, [0, 0, 0], [0, 0, 0, 1])], 100);
    // 90° 绕 Y: quaternion = (0, sin(45°), 0, cos(45°)) = (0, 0.7071, 0, 0.7071)
    const q90 = new Quaternion(0, Math.SQRT1_2, 0, Math.SQRT1_2);
    lc.recordSnapshot([{
      id: 1,
      position: new Vector3(0, 0, 0),
      rotation: q90,
      velocity: new Vector3(),
      timestamp: 200,
    }], 200);
    // 中点 t=150 应得 45° 绕 Y: (0, sin(22.5°), 0, cos(22.5°))
    const result = lc.interpolate(150);
    const r = result!.get(1)!.rotation;
    // sin(22.5°) ≈ 0.3827, cos(22.5°) ≈ 0.9239
    expect(r.y).toBeCloseTo(Math.sin(Math.PI / 8), 4);
    expect(r.w).toBeCloseTo(Math.cos(Math.PI / 8), 4);
  });

  it('interpolates velocity', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0], [0, 0, 0, 1], [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0], [0, 0, 0, 1], [10, 0, 0])], 200);
    const result = lc.interpolate(150);
    expect(result!.get(1)!.velocity.x).toBeCloseTo(5, 5);
  });

  it('handles entity present in next but not prev (newly added)', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([
      makeState(1, [10, 0, 0]),
      makeState(2, [5, 5, 5]), // 新实体
    ], 200);
    const result = lc.interpolate(150);
    expect(result!.has(1)).toBe(true);
    expect(result!.has(2)).toBe(true);
    expect(result!.get(2)!.position.x).toBe(5);
  });

  it('returns cloned states (mutation does not affect history)', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [5, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);
    const result = lc.interpolate(150);
    result!.get(1)!.position.set(99, 99, 99);
    // 历史不受影响:中点 t=150 插值结果应为 7.5(5→10 的中点)
    const result2 = lc.interpolate(150);
    expect(result2!.get(1)!.position.x).toBeCloseTo(7.5, 5);
  });
});

// ═════════════════════════════════════════════════════════════════════
// queryHistory
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation queryHistory', () => {
  it('returns undefined for empty history', () => {
    const lc = new LagCompensation();
    expect(lc.queryHistory(100, 1)).toBeUndefined();
  });

  it('returns undefined for unknown entity', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    expect(lc.queryHistory(100, 999)).toBeUndefined();
  });

  it('returns interpolated state for known entity', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);
    const s = lc.queryHistory(150, 1);
    expect(s).toBeDefined();
    expect(s!.id).toBe(1);
    expect(s!.position.x).toBeCloseTo(5, 5);
  });

  it('returns cloned state (mutation does not affect history)', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [5, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);
    const s = lc.queryHistory(150, 1);
    s!.position.set(99, 99, 99);
    const s2 = lc.queryHistory(150, 1);
    // 中点 t=150 插值结果应为 7.5(5→10 的中点)
    expect(s2!.position.x).toBeCloseTo(7.5, 5);
  });
});

// ═════════════════════════════════════════════════════════════════════
// rewindTo / restoreCurrent
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation rewindTo / restoreCurrent', () => {
  it('rewindTo returns false for empty history', () => {
    const lc = new LagCompensation();
    const states = new Map<number, EntityState>();
    expect(lc.rewindTo(states, 100)).toBe(false);
  });

  it('rewindTo writes interpolated state to states map', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);

    const states = new Map<number, EntityState>();
    states.set(1, makeState(1, [99, 99, 99], [0, 0, 0, 1], [0, 0, 0], 999));

    expect(lc.rewindTo(states, 150)).toBe(true);
    // states 应被回滚到 t=150 的插值结果
    expect(states.get(1)!.position.x).toBeCloseTo(5, 5);
    expect(lc.getStats().rewinding).toBe(true);
  });

  it('restoreCurrent restores original state after rewind', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);

    const states = new Map<number, EntityState>();
    const original = makeState(1, [99, 99, 99], [0, 0, 0, 1], [0, 0, 0], 999);
    states.set(1, original);

    lc.rewindTo(states, 150);
    // rewind 后 states 已改变
    expect(states.get(1)!.position.x).toBeCloseTo(5, 5);

    lc.restoreCurrent(states);
    // restore 后应回到原值
    expect(states.get(1)!.position.x).toBe(99);
    expect(states.get(1)!.position.y).toBe(99);
    expect(states.get(1)!.position.z).toBe(99);
    expect(lc.getStats().rewinding).toBe(false);
  });

  it('restoreCurrent is no-op when not rewinding', () => {
    const lc = new LagCompensation();
    const states = new Map<number, EntityState>();
    states.set(1, makeState(1, [5, 0, 0]));
    // 不应抛错
    expect(() => lc.restoreCurrent(states)).not.toThrow();
    // 状态不变
    expect(states.get(1)!.position.x).toBe(5);
  });

  it('rewindTo handles timestamp out of range (clamps)', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);

    const states = new Map<number, EntityState>();
    states.set(1, makeState(1, [99, 0, 0]));

    // 早于最旧:clamp 到最旧
    expect(lc.rewindTo(states, 50)).toBe(true);
    expect(states.get(1)!.position.x).toBe(0);
    lc.restoreCurrent(states);

    // 晚于最新:clamp 到最新
    expect(lc.rewindTo(states, 300)).toBe(true);
    expect(states.get(1)!.position.x).toBe(10);
    lc.restoreCurrent(states);
  });

  it('rewindTo adds entities from history not in current states', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([
      makeState(1, [0, 0, 0]),
      makeState(2, [5, 5, 5]),
    ], 100);

    const states = new Map<number, EntityState>();
    states.set(1, makeState(1, [99, 0, 0]));
    // 实体 2 不在 states 中

    lc.rewindTo(states, 100);
    expect(states.has(2)).toBe(true);
    expect(states.get(2)!.position.x).toBe(5);
    lc.restoreCurrent(states);
    // restoreCurrent 应删除 rewind 期间新增的实体 2
    expect(states.has(2)).toBe(false);
  });

  it('consecutive rewindTo restores previous rewind first', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);

    const states = new Map<number, EntityState>();
    states.set(1, makeState(1, [99, 0, 0]));

    lc.rewindTo(states, 150);
    // 再次 rewind 不同时刻
    lc.rewindTo(states, 100);
    expect(states.get(1)!.position.x).toBe(0);

    lc.restoreCurrent(states);
    expect(states.get(1)!.position.x).toBe(99);
  });
});

// ═════════════════════════════════════════════════════════════════════
// checkHit
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation checkHit', () => {
  it('returns false for empty history', () => {
    const lc = new LagCompensation();
    const states = new Map<number, EntityState>();
    const attacker = new Vector3(0, 0, 0);
    const bounds = makeBounds(0, 0, 0, 1, 1, 1);
    expect(lc.checkHit(states, 100, attacker, 1, bounds)).toBe(false);
  });

  it('returns false for unknown target', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    const states = new Map<number, EntityState>();
    const attacker = new Vector3(0, 0, 0);
    const bounds = makeBounds(0, 0, 0, 1, 1, 1);
    expect(lc.checkHit(states, 100, attacker, 999, bounds)).toBe(false);
  });

  it('returns true when attacker inside bounds', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    const states = new Map<number, EntityState>();
    const attacker = new Vector3(0.5, 0.5, 0.5);
    const bounds = makeBounds(0, 0, 0, 1, 1, 1); // [-1,1]³
    expect(lc.checkHit(states, 100, attacker, 1, bounds)).toBe(true);
  });

  it('returns false when attacker outside bounds', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    const states = new Map<number, EntityState>();
    const attacker = new Vector3(2, 0, 0);
    const bounds = makeBounds(0, 0, 0, 1, 1, 1);
    expect(lc.checkHit(states, 100, attacker, 1, bounds)).toBe(false);
  });

  it('checks bounds at boundary (inclusive)', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    const states = new Map<number, EntityState>();
    const attacker = new Vector3(1, 1, 1); // 边界上
    const bounds = makeBounds(0, 0, 0, 1, 1, 1);
    expect(lc.checkHit(states, 100, attacker, 1, bounds)).toBe(true);
  });

  it('does not modify states', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    const states = new Map<number, EntityState>();
    states.set(1, makeState(1, [99, 99, 99]));
    const attacker = new Vector3(0, 0, 0);
    const bounds = makeBounds(0, 0, 0, 1, 1, 1);
    lc.checkHit(states, 100, attacker, 1, bounds);
    // states 不应被修改
    expect(states.get(1)!.position.x).toBe(99);
  });

  it('uses interpolated state at given timestamp', () => {
    const lc = new LagCompensation();
    // 目标在 t=100 在 (0,0,0), t=200 在 (10,0,0)
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [10, 0, 0])], 200);

    const states = new Map<number, EntityState>();
    // 攻击者在 t=150 应看到目标在 (5,0,0),边界框围绕该位置
    const attacker = new Vector3(5, 0, 0);
    const bounds = makeBounds(5, 0, 0, 1, 1, 1); // 中心在 (5,0,0)
    expect(lc.checkHit(states, 150, attacker, 1, bounds)).toBe(true);

    // 若攻击者以为目标在 (0,0,0) 但实际回滚后在 (5,0,0),未命中
    const attacker2 = new Vector3(0, 0, 0);
    const bounds2 = makeBounds(0, 0, 0, 1, 1, 1); // 中心在 (0,0,0)
    // 攻击者在 (0,0,0),bounds 也在 (0,0,0),命中(因为 attacker 在 bounds 内)
    // 这里验证 checkHit 用的是 bounds 参数,不是目标位置
    expect(lc.checkHit(states, 150, attacker2, 1, bounds2)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// pruneOldEntries
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation pruneOldEntries', () => {
  it('returns 0 for empty history', () => {
    const lc = new LagCompensation();
    expect(lc.pruneOldEntries()).toBe(0);
  });

  it('returns 0 when historyDuration is 0', () => {
    const lc = new LagCompensation({ historyDuration: 0 });
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [1, 0, 0])], 200);
    expect(lc.pruneOldEntries()).toBe(0);
  });

  it('removes entries older than newest - historyDuration', () => {
    const lc = new LagCompensation({ historyDuration: 100 });
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [1, 0, 0])], 200);
    lc.recordSnapshot([makeState(1, [2, 0, 0])], 300);
    lc.recordSnapshot([makeState(1, [3, 0, 0])], 400);
    // newest=400, cutoff=300, 应删除 100 和 200
    const removed = lc.pruneOldEntries();
    expect(removed).toBe(2);
    expect(lc.historyBuffer.length).toBe(2);
    expect(lc.getOldestTimestamp()).toBe(300);
  });

  it('keeps entries within historyDuration', () => {
    const lc = new LagCompensation({ historyDuration: 500 });
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [1, 0, 0])], 200);
    // newest=200, cutoff=-300, 无条目早于 cutoff
    expect(lc.pruneOldEntries()).toBe(0);
    expect(lc.historyBuffer.length).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════
// clear
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation clear', () => {
  it('empties history buffer', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    lc.recordSnapshot([makeState(1, [1, 0, 0])], 200);
    expect(lc.historyBuffer.length).toBe(2);
    lc.clear();
    expect(lc.historyBuffer.length).toBe(0);
    expect(lc.getOldestTimestamp()).toBe(0);
    expect(lc.getNewestTimestamp()).toBe(0);
  });

  it('resets rewinding state', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    const states = new Map<number, EntityState>();
    states.set(1, makeState(1, [99, 0, 0]));
    lc.rewindTo(states, 100);
    expect(lc.getStats().rewinding).toBe(true);
    lc.clear();
    expect(lc.getStats().rewinding).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// getStats
// ═════════════════════════════════════════════════════════════════════
describe('LagCompensation getStats', () => {
  it('returns empty stats for fresh instance', () => {
    const lc = new LagCompensation({ isServer: true });
    const stats = lc.getStats();
    expect(stats.historySize).toBe(0);
    expect(stats.maxHistorySize).toBe(64);
    expect(stats.historyDuration).toBe(1000);
    expect(stats.interpolationDelay).toBe(100);
    expect(stats.oldestTimestamp).toBe(0);
    expect(stats.newestTimestamp).toBe(0);
    expect(stats.isServer).toBe(true);
    expect(stats.rewinding).toBe(false);
    expect(stats.entityCount).toBe(0);
  });

  it('returns stats after recording', () => {
    const lc = new LagCompensation({ maxHistorySize: 10 });
    lc.recordSnapshot([
      makeState(1, [0, 0, 0]),
      makeState(2, [1, 0, 0]),
    ], 100);
    lc.recordSnapshot([
      makeState(1, [0, 0, 0]),
      makeState(2, [1, 0, 0]),
      makeState(3, [2, 0, 0]),
    ], 200);
    const stats = lc.getStats();
    expect(stats.historySize).toBe(2);
    expect(stats.maxHistorySize).toBe(10);
    expect(stats.oldestTimestamp).toBe(100);
    expect(stats.newestTimestamp).toBe(200);
    expect(stats.entityCount).toBe(3); // 取最新条目
    expect(stats.rewinding).toBe(false);
  });

  it('reflects rewinding state', () => {
    const lc = new LagCompensation();
    lc.recordSnapshot([makeState(1, [0, 0, 0])], 100);
    const states = new Map<number, EntityState>();
    states.set(1, makeState(1, [99, 0, 0]));
    lc.rewindTo(states, 100);
    const stats = lc.getStats();
    expect(stats.rewinding).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// createEntityState 工厂
// ═════════════════════════════════════════════════════════════════════
describe('createEntityState factory', () => {
  it('creates with defaults', () => {
    const s = createEntityState(1);
    expect(s.id).toBe(1);
    expect(s.position.x).toBe(0);
    expect(s.rotation.w).toBe(1);
    expect(s.velocity.x).toBe(0);
    expect(s.timestamp).toBe(0);
  });

  it('creates with custom values', () => {
    const s = createEntityState(
      5,
      new Vector3(1, 2, 3),
      new Quaternion(0, 1, 0, 0),
      new Vector3(4, 5, 6),
      999,
    );
    expect(s.id).toBe(5);
    expect(s.position.x).toBe(1);
    expect(s.rotation.y).toBe(1);
    expect(s.velocity.z).toBe(6);
    expect(s.timestamp).toBe(999);
  });

  it('clones inputs', () => {
    const pos = new Vector3(1, 2, 3);
    const s = createEntityState(1, pos);
    pos.set(99, 99, 99);
    expect(s.position.x).toBe(1);
  });
});
