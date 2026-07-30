// RopePhysics 测试 — Verlet 链绳索物理。
//
// 验证:
//   • 构造默认值 / 自定义选项
//   • create — 节点数 / segmentLength / 节点分布
//   • pinStart / pinEnd / startPin / endPin
//   • pinSegment / unpinSegment / pinSegment 带固定位置
//   • setter 链式(setGravity / setWind / setDamping / setStiffness / setIterations / setThickness / setMaxBendAngle)
//   • verletIntegrate — 重力下落 / pinned 不动 / 加速度清零
//   • solveDistanceConstraints — 保持 segmentLength
//   • solveBendConstraints — c 自由 / a 自由 / a&c 都固定 三个分支
//   • applyWind
//   • collideWithSphere
//   • update — 起点固定重力下垂
//   • getSegments / getSegmentCount / getLength / getPoints / getTangent / getStats

import { describe, it, expect } from 'vitest';
import { RopePhysics } from './RopePhysics';
import { Vector3 } from '../Math/Vector3';

describe('RopePhysics — 构造', () => {
  it('默认参数:9.8 重力 / 0 风力 / 0.01 阻尼 / 1.0 刚度 / 4 迭代 / 0.05 粗细 / π 弯曲', () => {
    const rope = new RopePhysics();
    expect(rope.gravity.y).toBeCloseTo(-9.8, 5);
    expect(rope.wind.lengthSq()).toBe(0);
    expect(rope.damping).toBeCloseTo(0.01, 5);
    expect(rope.stiffness).toBeCloseTo(1.0, 5);
    expect(rope.iterations).toBe(4);
    expect(rope.thickness).toBeCloseTo(0.05, 5);
    expect(rope.maxBendAngle).toBeCloseTo(Math.PI, 5);
    expect(rope.segmentCount).toBe(0);
  });

  it('自定义参数透传', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(0, -5, 0),
      wind: new Vector3(1, 0, 0),
      damping: 0.05,
      stiffness: 0.8,
      iterations: 10,
      thickness: 0.2,
      maxBendAngle: Math.PI / 4,
    });
    expect(rope.gravity.y).toBe(-5);
    expect(rope.wind.x).toBe(1);
    expect(rope.damping).toBeCloseTo(0.05, 5);
    expect(rope.stiffness).toBeCloseTo(0.8, 5);
    expect(rope.iterations).toBe(10);
    expect(rope.thickness).toBeCloseTo(0.2, 5);
    expect(rope.maxBendAngle).toBeCloseTo(Math.PI / 4, 5);
  });

  it('构造选项中的 Vector3 被克隆', () => {
    const g = new Vector3(0, -9.8, 0);
    const rope = new RopePhysics({ gravity: g });
    g.y = -100;
    expect(rope.gravity.y).toBeCloseTo(-9.8, 5);
  });
});

describe('RopePhysics — create', () => {
  it('创建 segmentCount 个节点,均匀分布', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 6);
    expect(rope.segmentCount).toBe(6);
    expect(rope.segments.length).toBe(6);
    expect(rope.segmentLength).toBeCloseTo(2, 5); // 10 / (6-1)
    // 节点位置:0, 2, 4, 6, 8, 10
    expect(rope.segments[0].position.x).toBeCloseTo(0, 5);
    expect(rope.segments[3].position.x).toBeCloseTo(6, 5);
    expect(rope.segments[5].position.x).toBeCloseTo(10, 5);
  });

  it('3D 端点正确插值', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(0, 0, 10), 3);
    expect(rope.segments[1].position.z).toBeCloseTo(5, 5);
  });

  it('segmentLength = distance / (segmentCount - 1)', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(0, -10, 0), 5);
    expect(rope.segmentLength).toBeCloseTo(2.5, 5);
  });

  it('拒绝 segmentCount < 2', () => {
    const rope = new RopePhysics();
    expect(() => rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 1)).toThrowError(/segmentCount/);
  });

  it('重新 create 清空 pinned 状态', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.pinStart(true);
    expect(rope.startPin).toBe(true);
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    expect(rope.startPin).toBe(false);
  });
});

describe('RopePhysics — pinStart / pinEnd', () => {
  it('pinStart(true) 固定起点,startPin 反映状态', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    expect(rope.startPin).toBe(false);
    rope.pinStart(true);
    expect(rope.startPin).toBe(true);
    expect(rope.isPinned(0)).toBe(true);
  });

  it('pinEnd(true) 固定终点,endPin 反映状态', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    expect(rope.endPin).toBe(false);
    rope.pinEnd(true);
    expect(rope.endPin).toBe(true);
    expect(rope.isPinned(2)).toBe(true);
  });

  it('pinStart(false) 解除固定', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.pinStart(true);
    rope.pinStart(false);
    expect(rope.startPin).toBe(false);
    expect(rope.isPinned(0)).toBe(false);
  });

  it('pinEnd(false) 解除固定', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.pinEnd(true);
    rope.pinEnd(false);
    expect(rope.endPin).toBe(false);
  });
});

describe('RopePhysics — pinSegment / unpinSegment', () => {
  it('pinSegment 固定指定段', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 5);
    rope.pinSegment(2);
    expect(rope.isPinned(2)).toBe(true);
  });

  it('pinSegment 带固定位置,把段拉到该位置', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    rope.pinSegment(1, new Vector3(5, 5, 0));
    expect(rope.segments[1].position.x).toBeCloseTo(5, 5);
    expect(rope.segments[1].position.y).toBeCloseTo(5, 5);
  });

  it('unpinSegment 解除固定', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 5);
    rope.pinSegment(2);
    rope.unpinSegment(2);
    expect(rope.isPinned(2)).toBe(false);
  });

  it('pinSegment 越界抛错', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    expect(() => rope.pinSegment(99)).toThrowError(/out of range/);
  });

  it('unpinSegment 越界抛错', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    expect(() => rope.unpinSegment(99)).toThrowError(/out of range/);
  });

  it('pinSegment(0) 影响 startPin', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.pinSegment(0);
    expect(rope.startPin).toBe(true);
  });
});

describe('RopePhysics — setter 链式', () => {
  it('setGravity / setWind / setDamping / setStiffness / setIterations / setThickness / setMaxBendAngle', () => {
    const rope = new RopePhysics();
    rope
      .setGravity(new Vector3(0, -5, 0))
      .setWind(new Vector3(2, 0, 0))
      .setDamping(0.2)
      .setStiffness(0.7)
      .setIterations(8)
      .setThickness(0.3)
      .setMaxBendAngle(Math.PI / 6);
    expect(rope.gravity.y).toBe(-5);
    expect(rope.wind.x).toBe(2);
    expect(rope.damping).toBeCloseTo(0.2, 5);
    expect(rope.stiffness).toBeCloseTo(0.7, 5);
    expect(rope.iterations).toBe(8);
    expect(rope.thickness).toBeCloseTo(0.3, 5);
    expect(rope.maxBendAngle).toBeCloseTo(Math.PI / 6, 5);
  });

  it('setWind 复制值(不共享引用)', () => {
    const rope = new RopePhysics();
    const w = new Vector3(1, 2, 3);
    rope.setWind(w);
    w.x = 999;
    expect(rope.wind.x).toBe(1);
  });
});

describe('RopePhysics — verletIntegrate', () => {
  it('重力让非固定段下落', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(0, -9.8, 0),
      damping: 0,
      iterations: 1,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    for (const s of rope.segments) s.acceleration.add(rope.gravity);
    const y0 = rope.segments[1].position.y;
    rope.verletIntegrate(1 / 60);
    expect(rope.segments[1].position.y).toBeLessThan(y0);
  });

  it('pinned 段位置不变', () => {
    const rope = new RopePhysics({ gravity: new Vector3(0, -9.8, 0) });
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.pinStart(true);
    const p0 = rope.segments[0].position.clone();
    for (const s of rope.segments) s.acceleration.add(rope.gravity);
    rope.verletIntegrate(1 / 60);
    expect(rope.segments[0].position.x).toBeCloseTo(p0.x);
    expect(rope.segments[0].position.y).toBeCloseTo(p0.y);
    expect(rope.segments[0].position.z).toBeCloseTo(p0.z);
  });

  it('积分后加速度清零', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.segments[0].acceleration.set(1, 0, 0);
    rope.verletIntegrate(1 / 60);
    expect(rope.segments[0].acceleration.lengthSq()).toBe(0);
  });
});

describe('RopePhysics — solveDistanceConstraints', () => {
  it('保持相邻节点间距 = segmentLength', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(),
      damping: 0,
      iterations: 32,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 5);
    // 两端 pin,扰动中间段(应被约束拉回直线)
    rope.pinStart(true);
    rope.pinEnd(true);
    // 小幅扰动,PBD 在两端固定下需足够迭代收敛
    rope.segments[2].position.y += 1;
    rope.solveDistanceConstraints();
    // 各相邻段距离应接近 segmentLength
    const rest = rope.segmentLength;
    for (let i = 0; i < rope.segmentCount - 1; i++) {
      const d = rope.segments[i].position.distanceTo(rope.segments[i + 1].position);
      expect(d).toBeCloseTo(rest, 1);
    }
  });

  it('拉伸单段,约束拉回静止长度(两端 pin 各承担一半)', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(),
      damping: 0,
      iterations: 32,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    // 只 pin 起点,把终点拉远
    rope.pinStart(true);
    const rest = rope.segmentLength;
    rope.segments[2].position.x += 20;
    rope.solveDistanceConstraints();
    // segment 0-1 和 1-2 距离应接近 rest
    expect(rope.segments[0].position.distanceTo(rope.segments[1].position)).toBeCloseTo(rest, 1);
    expect(rope.segments[1].position.distanceTo(rope.segments[2].position)).toBeCloseTo(rest, 1);
  });
});

describe('RopePhysics — solveBendConstraints', () => {
  // 计算三点的转向角(0 = 直,π = 折回)
  function turnAngle(a: Vector3, b: Vector3, c: Vector3): number {
    const d1 = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const d2 = new Vector3(c.x - b.x, c.y - b.y, c.z - b.z);
    const l1 = d1.length();
    const l2 = d2.length();
    if (l1 < 1e-9 || l2 < 1e-9) return 0;
    let cosT = d1.dot(d2) / (l1 * l2);
    if (cosT > 1) cosT = 1;
    else if (cosT < -1) cosT = -1;
    return Math.acos(cosT);
  }

  it('c 自由:超出 maxBendAngle 时旋转 c 收紧弯折', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(),
      damping: 0,
      iterations: 1,
      maxBendAngle: 0.1,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    // a=(0,0,0) b=(5,0,0) c=(10,0,0),把 c 折到 (5,5,0) 形成 90° 弯
    rope.pinSegment(0); // a 固定
    rope.segments[2].position.set(5, 5, 0);
    const before = turnAngle(
      rope.segments[0].position,
      rope.segments[1].position,
      rope.segments[2].position,
    );
    expect(before).toBeGreaterThan(0.1);
    rope.solveBendConstraints();
    const after = turnAngle(
      rope.segments[0].position,
      rope.segments[1].position,
      rope.segments[2].position,
    );
    expect(after).toBeLessThanOrEqual(0.1 + 1e-3);
  });

  it('a 自由:c 固定时旋转 a 收紧弯折', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(),
      damping: 0,
      iterations: 1,
      maxBendAngle: 0.1,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    // c 固定,把 a 折到 (5,5,0)
    rope.pinSegment(2); // c 固定
    rope.segments[0].position.set(5, 5, 0);
    const before = turnAngle(
      rope.segments[0].position,
      rope.segments[1].position,
      rope.segments[2].position,
    );
    expect(before).toBeGreaterThan(0.1);
    rope.solveBendConstraints();
    const after = turnAngle(
      rope.segments[0].position,
      rope.segments[1].position,
      rope.segments[2].position,
    );
    expect(after).toBeLessThanOrEqual(0.1 + 1e-3);
  });

  it('a & c 都固定:把 b 投影到 a-c 直线', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(),
      damping: 0,
      iterations: 1,
      maxBendAngle: 0.1,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    rope.pinSegment(0);
    rope.pinSegment(2);
    // b 原本在 (5,0,0),抬到 (5,5,0)
    rope.segments[1].position.set(5, 5, 0);
    rope.solveBendConstraints();
    // b 应被投影到 a-c 直线(y ≈ 0)
    expect(rope.segments[1].position.y).toBeCloseTo(0, 2);
  });

  it('maxBendAngle = π 时不做任何修正', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(),
      damping: 0,
      iterations: 4,
      maxBendAngle: Math.PI,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    rope.segments[1].position.set(5, 5, 0);
    const before = rope.segments[1].position.clone();
    rope.solveBendConstraints();
    expect(rope.segments[1].position.equals(before)).toBe(true);
  });

  it('直线绳(turn=0)不触发弯折修正', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(),
      damping: 0,
      iterations: 4,
      maxBendAngle: 0.1,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    const before = rope.segments.map((s) => s.position.clone());
    rope.solveBendConstraints();
    for (let i = 0; i < rope.segmentCount; i++) {
      expect(rope.segments[i].position.equals(before[i])).toBe(true);
    }
  });
});

describe('RopePhysics — applyWind', () => {
  it('风力累加到非固定段 acceleration', () => {
    const rope = new RopePhysics({ wind: new Vector3(5, 0, 0) });
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.applyWind(1 / 60);
    expect(rope.segments[0].acceleration.x).toBeCloseTo(5, 5);
  });

  it('风力跳过 pinned 段', () => {
    const rope = new RopePhysics({ wind: new Vector3(5, 0, 0) });
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.pinStart(true);
    rope.applyWind(1 / 60);
    expect(rope.segments[0].acceleration.x).toBe(0);
    expect(rope.segments[1].acceleration.x).toBeCloseTo(5, 5);
  });

  it('wind 为零时不修改 acceleration', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.applyWind(1 / 60);
    expect(rope.segments[0].acceleration.lengthSq()).toBe(0);
  });
});

describe('RopePhysics — collideWithSphere', () => {
  it('把陷入球内的段推到球面外(含 thickness)', () => {
    const rope = new RopePhysics({ gravity: new Vector3(), thickness: 0.1 });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    rope.segments[1].position.set(0, 0, 0); // 放到球心
    rope.collideWithSphere(new Vector3(0, 0, 0), 0.5);
    const d = rope.segments[1].position.distanceTo(new Vector3(0, 0, 0));
    // 有效半径 = 0.5 + 0.1 = 0.6
    expect(d).toBeGreaterThanOrEqual(0.6 - 1e-6);
  });

  it('跳过 pinned 段', () => {
    const rope = new RopePhysics({ gravity: new Vector3() });
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.pinSegment(1);
    rope.segments[1].position.set(0, 0, 0);
    const before = rope.segments[1].position.clone();
    rope.collideWithSphere(new Vector3(0, 0, 0), 1);
    expect(rope.segments[1].position.equals(before)).toBe(true);
  });

  it('球外段不动', () => {
    const rope = new RopePhysics({ gravity: new Vector3() });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    const before = rope.segments[1].position.clone();
    rope.collideWithSphere(new Vector3(0, 0, 0), 0.5);
    expect(rope.segments[1].position.equals(before)).toBe(true);
  });
});

describe('RopePhysics — update', () => {
  it('起点固定,重力让自由端下垂', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(0, -9.8, 0),
      damping: 0.01,
      iterations: 8,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 8);
    rope.pinStart(true);
    const endIdx = rope.segmentCount - 1;
    const y0 = rope.segments[endIdx].position.y;
    for (let i = 0; i < 60; i++) rope.update(1 / 60);
    expect(rope.segments[endIdx].position.y).toBeLessThan(y0);
  });

  it('update 后加速度清零', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    rope.update(1 / 60);
    expect(rope.segments[0].acceleration.lengthSq()).toBe(0);
  });

  it('固定位置的 pinned 段每帧被拉回目标位置', () => {
    const rope = new RopePhysics({
      gravity: new Vector3(0, -9.8, 0),
      damping: 0.01,
      iterations: 4,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 5);
    const target = new Vector3(2, 3, 0);
    rope.pinSegment(1, target);
    // 把该段位置扰动
    rope.segments[1].position.set(99, 99, 99);
    rope.update(1 / 60);
    expect(rope.segments[1].position.x).toBeCloseTo(2, 5);
    expect(rope.segments[1].position.y).toBeCloseTo(3, 5);
  });

  it('dt 超过上限被钳制(不抛错)', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    expect(() => rope.update(10)).not.toThrow();
  });
});

describe('RopePhysics — getters', () => {
  it('getSegments 返回内部数组', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    expect(rope.getSegments()).toBe(rope.segments);
  });

  it('getSegmentCount 返回节点数', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 7);
    expect(rope.getSegmentCount()).toBe(7);
  });

  it('getLength = (segmentCount - 1) * segmentLength', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 6);
    expect(rope.getLength()).toBeCloseTo(10, 5);
  });

  it('getPoints 返回节点位置(共享引用)', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    const pts = rope.getPoints();
    expect(pts.length).toBe(3);
    expect(pts[0]).toBe(rope.segments[0].position);
  });

  it('getTangent 返回归一化切线', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    const t = rope.getTangent(0);
    expect(t.x).toBeCloseTo(1, 5);
    expect(t.y).toBeCloseTo(0, 5);
    expect(t.z).toBeCloseTo(0, 5);
    expect(t.length()).toBeCloseTo(1, 5);
  });

  it('getTangent 末节点返回上一段方向', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 3);
    const last = rope.segmentCount - 1;
    const t = rope.getTangent(last);
    expect(t.x).toBeCloseTo(1, 5);
  });

  it('getTangent 越界抛错', () => {
    const rope = new RopePhysics();
    rope.create(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 3);
    expect(() => rope.getTangent(99)).toThrowError(/out of range/);
    expect(() => rope.getTangent(-1)).toThrowError(/out of range/);
  });

  it('getStats 返回正确统计', () => {
    const rope = new RopePhysics({
      iterations: 6,
      thickness: 0.2,
      maxBendAngle: Math.PI / 4,
    });
    rope.create(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 6);
    rope.pinStart(true);
    rope.pinSegment(3);
    const stats = rope.getStats();
    expect(stats.segmentCount).toBe(6);
    expect(stats.segmentLength).toBeCloseTo(2, 5);
    expect(stats.length).toBeCloseTo(10, 5);
    expect(stats.pinnedCount).toBe(2);
    expect(stats.iterations).toBe(6);
    expect(stats.thickness).toBeCloseTo(0.2, 5);
    expect(stats.maxBendAngle).toBeCloseTo(Math.PI / 4, 5);
  });
});
