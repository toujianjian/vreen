// ClientPrediction / RewindableObject / InputHistory / NetworkTime 单元测试。
//
// 测试策略:
//   - NetworkTime: 注入式 server update 验证 sync / lerp / snap / reset。
//   - RewindableObject: 构造预填 + record + getAtFrame + rollback + 环形缓冲淘汰 + cloneFn。
//   - InputHistory: record + replayFrom + getAt + ack + clear + 淘汰 + 硬上限。
//   - ClientPrediction: 用简单积分器 (state={x}, input={dx}, step: x += dx*dt, dt=1)
//     验证预测步进 / 服务器纠偏回放 / 窗口外 snap / maxReplaySteps 截断。

import { describe, it, expect } from 'vitest';
import { NetworkTime } from './NetworkTime';
import { RewindableObject } from './RewindableObject';
import { InputHistory } from './InputHistory';
import { ClientPrediction } from './ClientPrediction';

// ── ClientPrediction 辅助: 简单积分器 ────────────────────────────
interface S { x: number; }
interface I { dx: number; }

function makePredictor(opts: { maxFrames?: number; maxReplaySteps?: number; fixedDt?: number } = {}) {
  const time = new NetworkTime();
  const step = (s: S, i: I, dt: number): void => { s.x += i.dx * dt; };
  const predictor = new ClientPrediction<S, I>({
    time,
    initialState: { x: 0 },
    step,
    cloneState: (s) => ({ x: s.x }),
    cloneInput: (i) => ({ dx: i.dx }),
    fixedDt: opts.fixedDt ?? 1,
    maxFrames: opts.maxFrames,
    maxReplaySteps: opts.maxReplaySteps,
  });
  return { predictor, step };
}

// ════════════════════════════════════════════════════════════════
// NetworkTime
// ════════════════════════════════════════════════════════════════
describe('NetworkTime', () => {
  it('tick(0.016) increments frame by 1 and localMs by ~16', () => {
    const t = new NetworkTime();
    t.tick(0.016);
    expect(t.getFrame()).toBe(1);
    expect(t.getLocalMs()).toBeCloseTo(16, 1);
    expect(t.getServerMs()).toBeCloseTo(16, 1);
  });

  it('applyServerUpdate first call sets synced=true and snaps time', () => {
    const t = new NetworkTime();
    t.applyServerUpdate(100, 5000, 50);
    expect(t.isSynced()).toBe(true);
    expect(t.getFrame()).toBe(100);
    expect(t.getServerMs()).toBe(5000);
    expect(t.rttMs).toBe(50);
  });

  it('applyServerUpdate second call with small drift lerps (drift reduces)', () => {
    const t = new NetworkTime();
    t.applyServerUpdate(100, 5000, 50);   // synced: serverMs=5000, frame=100
    t.applyServerUpdate(101, 5010, 50);   // drift=10 → lerp 0.1 → serverMs=5001
    expect(t.getServerMs()).toBeCloseTo(5001, 0);
    // drift reduced: was 10, now 5010-5001=9
    expect(Math.abs(5010 - t.getServerMs())).toBeLessThan(10);
    // frame NOT updated on small drift
    expect(t.getFrame()).toBe(100);
  });

  it('applyServerUpdate with >250ms drift snaps', () => {
    const t = new NetworkTime();
    t.applyServerUpdate(100, 5000, 50);
    t.applyServerUpdate(200, 6000, 50);   // drift=1000 > 250 → snap
    expect(t.getServerMs()).toBe(6000);
    expect(t.getFrame()).toBe(200);
  });

  it('reset clears everything', () => {
    const t = new NetworkTime();
    t.tick(0.016);
    t.applyServerUpdate(100, 5000, 50);
    t.reset();
    expect(t.getFrame()).toBe(0);
    expect(t.getLocalMs()).toBe(0);
    expect(t.getServerMs()).toBe(0);
    expect(t.rttMs).toBe(0);
    expect(t.isSynced()).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// RewindableObject
// ════════════════════════════════════════════════════════════════
describe('RewindableObject', () => {
  it('constructor pre-fills buffer with initial value at frame 0', () => {
    const r = new RewindableObject<number>(42);
    expect(r.size()).toBe(1);
    expect(r.getAtFrame(0)?.value).toBe(42);
    expect(r.current).toBe(42);
  });

  it('record(frame) adds entries; size() grows', () => {
    const r = new RewindableObject<number>(0);
    r.current = 1; r.record(1);
    r.current = 2; r.record(2);
    r.current = 3; r.record(3);
    expect(r.size()).toBe(4); // initial + 3
  });

  it('getAtFrame(targetFrame) returns the largest frame <= target', () => {
    const r = new RewindableObject<number>(0);
    r.current = 10; r.record(1);
    r.current = 20; r.record(2);
    r.current = 30; r.record(3);
    expect(r.getAtFrame(2)?.frame).toBe(2);
    expect(r.getAtFrame(2)?.value).toBe(20);
    expect(r.getAtFrame(5)?.frame).toBe(3); // largest <= 5
    expect(r.getAtFrame(3)?.value).toBe(30);
  });

  it('getAtFrame returns null for frames older than buffer', () => {
    const r = new RewindableObject<number>(0);
    r.current = 1; r.record(1);
    r.current = 2; r.record(2);
    expect(r.getAtFrame(-1)).toBeNull();
  });

  it('rollback(targetFrame) sets current to the buffered value', () => {
    const r = new RewindableObject<number>(0);
    r.current = 5; r.record(1);
    r.current = 99;
    expect(r.rollback(1)).toBe(true);
    expect(r.current).toBe(5);
  });

  it('rollback returns false for missing frames', () => {
    const r = new RewindableObject<number>(0);
    r.current = 1; r.record(1);
    expect(r.rollback(-1)).toBe(false); // no entry with frame <= -1
  });

  it('oldestFrame / latestFrame correct', () => {
    const r = new RewindableObject<number>(0); // buffer: [0]
    r.current = 1; r.record(1);
    r.current = 2; r.record(2);
    r.current = 3; r.record(3);
    // buffer: [0,1,2,3], no wrap (maxFrames=64)
    expect(r.oldestFrame()).toBe(0);
    expect(r.latestFrame()).toBe(3);
  });

  it('reset(value, frame) clears and re-initializes', () => {
    const r = new RewindableObject<number>(0);
    r.current = 1; r.record(1);
    r.current = 2; r.record(2);
    r.reset(77, 10);
    expect(r.size()).toBe(1);
    expect(r.current).toBe(77);
    expect(r.getAtFrame(10)?.value).toBe(77);
  });

  it('custom cloneFn is invoked', () => {
    let cloneCount = 0;
    const r = new RewindableObject<{ x: number }>(
      { x: 0 },
      64,
      (v) => { cloneCount++; return { x: v.x }; },
    );
    // constructor: cloneFn called twice (current + buffer entry)
    expect(cloneCount).toBeGreaterThanOrEqual(2);
    r.current.x = 5;
    r.record(1); // cloneFn called once
    expect(cloneCount).toBeGreaterThanOrEqual(3);
  });

  it('ring buffer evicts old entries when exceeding maxFrames', () => {
    const r = new RewindableObject<number>(0, 4); // maxFrames=4
    for (let i = 1; i <= 5; i++) { // maxFrames+1 records
      r.current = i;
      r.record(i);
    }
    expect(r.size()).toBeLessThanOrEqual(4);
  });
});

// ════════════════════════════════════════════════════════════════
// InputHistory
// ════════════════════════════════════════════════════════════════
describe('InputHistory', () => {
  it('record adds entries', () => {
    const h = new InputHistory<number>();
    h.record(1, 100);
    h.record(2, 200);
    expect(h.size()).toBe(2);
  });

  it('replayFrom(frame) returns entries with frame > start', () => {
    const h = new InputHistory<number>();
    h.record(1, 100);
    h.record(2, 200);
    h.record(3, 300);
    const replay = h.replayFrom(1);
    expect(replay.length).toBe(2);
    expect(replay[0].frame).toBe(2);
    expect(replay[1].frame).toBe(3);
  });

  it('getAt(frame) returns input or null', () => {
    const h = new InputHistory<number>();
    h.record(1, 100);
    h.record(2, 200);
    expect(h.getAt(1)).toBe(100);
    expect(h.getAt(2)).toBe(200);
    expect(h.getAt(99)).toBeNull();
  });

  it('ack(frame) drops entries with frame <= ackFrame', () => {
    const h = new InputHistory<number>();
    h.record(1, 100);
    h.record(2, 200);
    h.record(3, 300);
    h.ack(2); // drop frames 1 and 2
    expect(h.size()).toBe(1);
    expect(h.getAt(1)).toBeNull();
    expect(h.getAt(3)).toBe(300);
  });

  it('clear empties', () => {
    const h = new InputHistory<number>();
    h.record(1, 100);
    h.record(2, 200);
    h.clear();
    expect(h.size()).toBe(0);
  });

  it('evicts entries older than (latestFrame - maxFrames)', () => {
    const h = new InputHistory<number>(10); // maxFrames=10
    for (let i = 1; i <= 15; i++) h.record(i, i * 10);
    // latestFrame=15, cutoff=5 → frame 4 (< 5) evicted
    expect(h.getAt(4)).toBeNull();
    expect(h.getAt(15)).toBe(150);
  });

  it('respects hard cap on size', () => {
    const h = new InputHistory<number>(10);
    for (let i = 1; i <= 25; i++) h.record(i, i * 10);
    expect(h.size()).toBeLessThanOrEqual(10);
  });
});

// ════════════════════════════════════════════════════════════════
// ClientPrediction
// ════════════════════════════════════════════════════════════════
describe('ClientPrediction', () => {
  it('recordPredictedStep advances and records', () => {
    const { predictor, step } = makePredictor();
    step(predictor.getCurrent(), { dx: 1 }, 1); // x: 0 → 1
    predictor.recordPredictedStep(1, { dx: 1 });
    expect(predictor.getCurrent().x).toBe(1);
    expect(predictor.inputs.size()).toBe(1);
    expect(predictor.state.size()).toBe(2); // initial + frame 1
  });

  it('getCurrent returns predicted state', () => {
    const { predictor, step } = makePredictor();
    step(predictor.getCurrent(), { dx: 5 }, 1);
    predictor.recordPredictedStep(1, { dx: 5 });
    expect(predictor.getCurrent().x).toBe(5);
  });

  it('applyCorrection with a past frame rewinds, replaces, and replays inputs', () => {
    const { predictor, step } = makePredictor();
    // frames 1,2,3 with dx=1 each (dt=1): x 0→1→2→3
    step(predictor.getCurrent(), { dx: 1 }, 1); predictor.recordPredictedStep(1, { dx: 1 });
    step(predictor.getCurrent(), { dx: 1 }, 1); predictor.recordPredictedStep(2, { dx: 1 });
    step(predictor.getCurrent(), { dx: 1 }, 1); predictor.recordPredictedStep(3, { dx: 1 });
    expect(predictor.getCurrent().x).toBe(3);
    // correction at frame 1 with serverState {x:10}
    const replayed = predictor.applyCorrection(1, { x: 10 });
    // replay inputs at frames 2,3 (dx=1 each): 10 + 1 + 1 = 12
    expect(replayed).toBe(2);
    expect(predictor.getCurrent().x).toBe(12);
  });

  it('applyCorrection outside the rewind window snaps and returns 0', () => {
    const { predictor, step } = makePredictor({ maxFrames: 4 });
    // record enough to evict frame 1 from the state ring buffer
    for (let i = 1; i <= 5; i++) {
      step(predictor.getCurrent(), { dx: 1 }, 1);
      predictor.recordPredictedStep(i, { dx: 1 });
    }
    const replayed = predictor.applyCorrection(1, { x: 99 });
    expect(replayed).toBe(0);
    expect(predictor.getCurrent().x).toBe(99);
  });

  it('applyCorrection with no pending inputs returns 0 and sets serverState', () => {
    const { predictor } = makePredictor();
    const replayed = predictor.applyCorrection(0, { x: 42 });
    expect(replayed).toBe(0);
    expect(predictor.getCurrent().x).toBe(42);
  });

  it('ackInputs drops acknowledged inputs', () => {
    const { predictor, step } = makePredictor();
    step(predictor.getCurrent(), { dx: 1 }, 1); predictor.recordPredictedStep(1, { dx: 1 });
    step(predictor.getCurrent(), { dx: 1 }, 1); predictor.recordPredictedStep(2, { dx: 1 });
    step(predictor.getCurrent(), { dx: 1 }, 1); predictor.recordPredictedStep(3, { dx: 1 });
    predictor.ackInputs(2); // drop frames <= 2
    expect(predictor.inputs.size()).toBe(1);
  });

  it('reset clears state and inputs', () => {
    const { predictor, step } = makePredictor();
    step(predictor.getCurrent(), { dx: 1 }, 1); predictor.recordPredictedStep(1, { dx: 1 });
    step(predictor.getCurrent(), { dx: 1 }, 1); predictor.recordPredictedStep(2, { dx: 1 });
    predictor.reset({ x: 0 }, 0);
    expect(predictor.getCurrent().x).toBe(0);
    expect(predictor.inputs.size()).toBe(0);
    expect(predictor.state.size()).toBe(1);
  });

  it('maxReplaySteps truncates replay', () => {
    const { predictor, step } = makePredictor({ maxReplaySteps: 2 });
    // record 5 inputs at frames 1..5
    for (let i = 1; i <= 5; i++) {
      step(predictor.getCurrent(), { dx: 1 }, 1);
      predictor.recordPredictedStep(i, { dx: 1 });
    }
    // correction at frame 0 (pre-filled): 5 pending inputs, maxReplaySteps=2
    const replayed = predictor.applyCorrection(0, { x: 0 });
    expect(replayed).toBe(2);
    // 2 replays of dx=1, dt=1 → x = 0 + 1 + 1 = 2
    expect(predictor.getCurrent().x).toBe(2);
  });
});
