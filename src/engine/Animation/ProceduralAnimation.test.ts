// ProceduralAnimation 单元测试。
// 覆盖:节点增删/参数/权重/启停、update 时间推进、各类型节点(headTrack/breathing/
// walkCycle/runCycle/idleSway/lookAt/reach/secondaryMotion)、系统开关、统计、清空。

import { describe, it, expect } from 'vitest';
import { ProceduralAnimation } from './ProceduralAnimation';
import { Skeleton } from '../Core/Skeleton';
import { Bone } from '../Core/Bone';
import { Vector3 } from '../Math/Vector3';

/** 构造带命名骨骼的 Skeleton。 */
function makeSkeleton(boneNames: string[]): Skeleton {
  const bones = boneNames.map((n) => {
    const b = new Bone();
    b.name = n;
    return b;
  });
  return new Skeleton(bones, []);
}

describe('ProceduralAnimation', () => {
  // ── 构造 ────────────────────────────────────────────────────────

  it('constructs empty and enabled', () => {
    const pa = new ProceduralAnimation();
    expect(pa.proceduralNodes.size).toBe(0);
    expect(pa.time).toBe(0);
    expect(pa.enabled).toBe(true);
  });

  // ── 节点增删 ────────────────────────────────────────────────────

  it('addNode returns unique id and registers node with defaults', () => {
    const pa = new ProceduralAnimation();
    const id1 = pa.addNode('headTrack', 'head');
    const id2 = pa.addNode('breathing', 'chest');
    expect(id1).not.toBe(id2);
    expect(pa.proceduralNodes.size).toBe(2);
    const n1 = pa.proceduralNodes.get(id1);
    expect(n1).toBeDefined();
    expect(n1!.type).toBe('headTrack');
    expect(n1!.target).toBe('head');
    expect(n1!.weight).toBe(1);
    expect(n1!.enabled).toBe(true);
    // 默认参数已写入
    expect(n1!.params.has('targetX')).toBe(true);
    expect(n1!.params.has('maxAngle')).toBe(true);
  });

  it('addNode assigns distinct ids across nodes', () => {
    const pa = new ProceduralAnimation();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(pa.addNode('idleSway', 'spine'));
    expect(ids.size).toBe(5);
  });

  it('removeNode deletes and returns true/false', () => {
    const pa = new ProceduralAnimation();
    const id = pa.addNode('breathing', 'chest');
    expect(pa.removeNode(id)).toBe(true);
    expect(pa.proceduralNodes.size).toBe(0);
    expect(pa.removeNode('nonexistent')).toBe(false);
  });

  it('getNodes returns array in insertion order', () => {
    const pa = new ProceduralAnimation();
    pa.addNode('breathing', 'chest');
    pa.addNode('idleSway', 'spine');
    const nodes = pa.getNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe('breathing');
    expect(nodes[1].type).toBe('idleSway');
  });

  // ── 参数 ────────────────────────────────────────────────────────

  it('setNodeParam / getNodeParam round-trip', () => {
    const pa = new ProceduralAnimation();
    const id = pa.addNode('walkCycle', 'legL');
    pa.setNodeParam(id, 'frequency', 2.5);
    expect(pa.getNodeParam(id, 'frequency')).toBeCloseTo(2.5, 6);
    // 覆盖已有
    pa.setNodeParam(id, 'frequency', 3);
    expect(pa.getNodeParam(id, 'frequency')).toBe(3);
  });

  it('getNodeParam returns 0 for missing node or param', () => {
    const pa = new ProceduralAnimation();
    const id = pa.addNode('breathing', 'chest');
    expect(pa.getNodeParam(id, 'nonexistent')).toBe(0);
    expect(pa.getNodeParam('fake', 'rate')).toBe(0);
  });

  it('setNodeParam is a no-op for missing node', () => {
    const pa = new ProceduralAnimation();
    pa.setNodeParam('fake', 'x', 1);
    expect(pa.proceduralNodes.size).toBe(0);
  });

  // ── 权重 ────────────────────────────────────────────────────────

  it('setNodeWeight clamps to [0,1]', () => {
    const pa = new ProceduralAnimation();
    const id = pa.addNode('breathing', 'chest');
    pa.setNodeWeight(id, 2);
    expect(pa.proceduralNodes.get(id)!.weight).toBe(1);
    pa.setNodeWeight(id, -1);
    expect(pa.proceduralNodes.get(id)!.weight).toBe(0);
    pa.setNodeWeight(id, 0.5);
    expect(pa.proceduralNodes.get(id)!.weight).toBeCloseTo(0.5, 6);
  });

  it('setNodeWeight is a no-op for missing node', () => {
    const pa = new ProceduralAnimation();
    pa.setNodeWeight('fake', 0.5);
    expect(pa.proceduralNodes.size).toBe(0);
  });

  // ── 启停 ────────────────────────────────────────────────────────

  it('enableNode / disableNode toggle enabled flag', () => {
    const pa = new ProceduralAnimation();
    const id = pa.addNode('breathing', 'chest');
    expect(pa.proceduralNodes.get(id)!.enabled).toBe(true);
    pa.disableNode(id);
    expect(pa.proceduralNodes.get(id)!.enabled).toBe(false);
    pa.enableNode(id);
    expect(pa.proceduralNodes.get(id)!.enabled).toBe(true);
  });

  it('enableNode/disableNode ignore missing node', () => {
    const pa = new ProceduralAnimation();
    pa.disableNode('fake');
    pa.enableNode('fake');
    expect(pa.proceduralNodes.size).toBe(0);
  });

  it('setEnabled toggles system master switch', () => {
    const pa = new ProceduralAnimation();
    expect(pa.enabled).toBe(true);
    pa.setEnabled(false);
    expect(pa.enabled).toBe(false);
  });

  // ── clear ───────────────────────────────────────────────────────

  it('clear removes all nodes and resets time', () => {
    const pa = new ProceduralAnimation();
    pa.addNode('breathing', 'chest');
    pa.addNode('idleSway', 'spine');
    pa.time = 5;
    pa.clear();
    expect(pa.proceduralNodes.size).toBe(0);
    expect(pa.time).toBe(0);
  });

  // ── getStats ────────────────────────────────────────────────────

  it('getStats reports counts and time', () => {
    const pa = new ProceduralAnimation();
    pa.addNode('breathing', 'chest');
    pa.addNode('breathing', 'chest2');
    pa.addNode('idleSway', 'spine');
    pa.disableNode(pa.getNodes()[0].id);
    pa.time = 3.5;
    const stats = pa.getStats();
    expect(stats.nodeCount).toBe(3);
    expect(stats.enabledCount).toBe(2);
    expect(stats.time).toBeCloseTo(3.5, 6);
    expect(stats.typeCounts.breathing).toBe(2);
    expect(stats.typeCounts.idleSway).toBe(1);
  });

  // ── update 基础 ─────────────────────────────────────────────────

  it('update advances time when enabled', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['head']);
    pa.addNode('headTrack', 'head');
    pa.update(0.5, skel);
    expect(pa.time).toBeCloseTo(0.5, 6);
  });

  it('update does not advance time when disabled', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['head']);
    pa.addNode('headTrack', 'head');
    pa.setEnabled(false);
    pa.update(0.5, skel);
    expect(pa.time).toBe(0);
  });

  it('update skips disabled nodes', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['chest']);
    const id = pa.addNode('breathing', 'chest');
    pa.disableNode(id);
    pa.update(1, skel);
    // breathing 未执行:scale.y 保持 1
    expect(skel.bones[0].scale.y).toBe(1);
  });

  it('update skips zero-weight nodes', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['chest']);
    const id = pa.addNode('breathing', 'chest');
    pa.setNodeWeight(id, 0);
    pa.update(1, skel);
    expect(skel.bones[0].scale.y).toBe(1);
  });

  it('update skips unknown bone name', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['head']);
    pa.addNode('breathing', 'nonexistent');
    // 不应抛错
    pa.update(1, skel);
    expect(pa.time).toBeCloseTo(1, 6);
  });

  // ── headTrack ───────────────────────────────────────────────────

  it('updateHeadTrack rotates bone toward target', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['head']);
    const id = pa.addNode('headTrack', 'head');
    pa.setNodeParam(id, 'targetX', 1);
    pa.setNodeParam(id, 'targetY', 0);
    pa.setNodeParam(id, 'targetZ', 0); // 目标在 +X 方向
    pa.update(0, skel);
    const r = skel.bones[0].rotation;
    // 应旋转约 90°(从 +Z 转向 +X),四元数 y 分量 ≈ sin(45°)
    expect(Math.abs(r.y)).toBeGreaterThan(0.5);
  });

  it('updateHeadTrack with weight 0.5 produces half rotation', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['head']);
    const id = pa.addNode('headTrack', 'head');
    pa.setNodeParam(id, 'targetX', 1);
    pa.setNodeParam(id, 'targetZ', 0);
    pa.setNodeWeight(id, 0.5);
    pa.update(0, skel);
    const r = skel.bones[0].rotation;
    // 半权重:|y| 应小于全权重(0.707)但大于 0
    expect(Math.abs(r.y)).toBeGreaterThan(0.1);
    expect(Math.abs(r.y)).toBeLessThan(0.707);
  });

  it('updateHeadTrack no-op when target at bone position', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['head']);
    pa.addNode('headTrack', 'head');
    // 目标默认 (0,0,1),骨骼在原点 → 方向 (0,0,1) = +Z,无需旋转
    pa.update(0, skel);
    const r = skel.bones[0].rotation;
    expect(r.w).toBeCloseTo(1, 6);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });

  it('updateHeadTrack respects maxAngle clamp', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['head']);
    const id = pa.addNode('headTrack', 'head');
    // 目标在正后方,需转 180°,但 maxAngle 限制为 30°
    pa.setNodeParam(id, 'targetX', 0);
    pa.setNodeParam(id, 'targetY', 0);
    pa.setNodeParam(id, 'targetZ', -1);
    pa.setNodeParam(id, 'maxAngle', Math.PI / 6); // 30°
    pa.update(0, skel);
    const axis = new Vector3();
    const angle = skel.bones[0].rotation.toAxisAngle(axis);
    expect(angle).toBeLessThanOrEqual(Math.PI / 6 + 1e-6);
  });

  // ── breathing ───────────────────────────────────────────────────

  it('updateBreathing scales chest at peak (time=1, rate=0.25 → phase=1)', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['chest']);
    const id = pa.addNode('breathing', 'chest');
    pa.setNodeParam(id, 'rate', 0.25);
    pa.setNodeParam(id, 'amplitude', 0.1);
    pa.update(1, skel); // time=1, phase=sin(1*0.25*2π)=sin(π/2)=1
    expect(skel.bones[0].scale.y).toBeCloseTo(1.1, 5);
  });

  it('updateBreathing is set-based (no accumulation across frames)', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['chest']);
    const id = pa.addNode('breathing', 'chest');
    pa.setNodeParam(id, 'rate', 0.25);
    pa.setNodeParam(id, 'amplitude', 0.1);
    pa.update(1, skel); // phase=1 → scale.y=1.1
    pa.update(1, skel); // time=2, phase=sin(2*0.25*2π)=sin(π)=0 → scale.y=1
    expect(skel.bones[0].scale.y).toBeCloseTo(1, 5);
  });

  it('updateBreathing with weight 0.5 halves amplitude', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['chest']);
    const id = pa.addNode('breathing', 'chest');
    pa.setNodeParam(id, 'rate', 0.25);
    pa.setNodeParam(id, 'amplitude', 0.1);
    pa.setNodeWeight(id, 0.5);
    pa.update(1, skel); // phase=1 → scale.y = 1 + 0.1*1*0.5 = 1.05
    expect(skel.bones[0].scale.y).toBeCloseTo(1.05, 5);
  });

  // ── walkCycle ───────────────────────────────────────────────────

  it('updateWalkCycle rotates leg around X axis at given speed', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['legL']);
    const id = pa.addNode('walkCycle', 'legL');
    pa.setNodeParam(id, 'frequency', 1);
    pa.setNodeParam(id, 'amplitude', 0.4);
    pa.setNodeParam(id, 'speed', 1);
    pa.setNodeParam(id, 'phase', Math.PI / 2); // phase 使 sin=1
    pa.update(1, skel); // sin(1*1*1*2π + π/2) = sin(π/2)... 实际 sin(2π+π/2)=1
    // 旋转角 = 1 * 0.4 = 0.4 弧度,绕 X 轴
    const axis = new Vector3();
    const angle = skel.bones[0].rotation.toAxisAngle(axis);
    expect(axis.x).toBeCloseTo(1, 5);
    expect(angle).toBeCloseTo(0.4, 5);
  });

  it('updateWalkCycle responds to speed parameter', () => {
    const pa = new ProceduralAnimation();
    const skelFast = makeSkeleton(['legL']);
    const skelSlow = makeSkeleton(['legL']);
    const id1 = pa.addNode('walkCycle', 'legL');
    pa.setNodeParam(id1, 'frequency', 1);
    pa.setNodeParam(id1, 'amplitude', 0.4);
    pa.setNodeParam(id1, 'phase', 0);
    pa.setNodeParam(id1, 'speed', 2);
    pa.update(0.1, skelFast);

    const pa2 = new ProceduralAnimation();
    const id2 = pa2.addNode('walkCycle', 'legL');
    pa2.setNodeParam(id2, 'frequency', 1);
    pa2.setNodeParam(id2, 'amplitude', 0.4);
    pa2.setNodeParam(id2, 'phase', 0);
    pa2.setNodeParam(id2, 'speed', 1);
    pa2.update(0.1, skelSlow);

    // 不同 speed → 不同旋转角(除非恰好同相)
    const angleFast = skelFast.bones[0].rotation.toAxisAngle(new Vector3());
    const angleSlow = skelSlow.bones[0].rotation.toAxisAngle(new Vector3());
    expect(angleFast).not.toBeCloseTo(angleSlow, 5);
  });

  // ── runCycle ────────────────────────────────────────────────────

  it('updateRunCycle produces larger amplitude than walkCycle by default', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['legL']);
    const id = pa.addNode('runCycle', 'legL');
    pa.setNodeParam(id, 'frequency', 1); // 使 time=1,phase=π/2 时 sin=1
    pa.setNodeParam(id, 'phase', Math.PI / 2); // sin=1 → 角度=amplitude
    pa.setNodeParam(id, 'speed', 1);
    pa.update(1, skel);
    const angle = skel.bones[0].rotation.toAxisAngle(new Vector3());
    // runCycle 默认 amplitude=0.7
    expect(angle).toBeCloseTo(0.7, 5);
  });

  // ── idleSway ────────────────────────────────────────────────────

  it('updateIdleSway rotates spine', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['spine']);
    const id = pa.addNode('idleSway', 'spine');
    pa.setNodeParam(id, 'rate', 0.25); // 使 1 秒时 phaseZ=sin(π/2)=1
    pa.setNodeParam(id, 'amplitude', 0.1);
    pa.update(1, skel);
    const r = skel.bones[0].rotation;
    // 应有非平凡旋转(Z 或 Y 分量非零)
    const isIdentity = r.x === 0 && r.y === 0 && r.z === 0 && r.w === 1;
    expect(isIdentity).toBe(false);
  });

  // ── lookAt ──────────────────────────────────────────────────────

  it('updateLookAt rotates bone toward target (same as headTrack semantics)', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['eye']);
    const id = pa.addNode('lookAt', 'eye');
    pa.setNodeParam(id, 'targetX', 1);
    pa.setNodeParam(id, 'targetY', 0);
    pa.setNodeParam(id, 'targetZ', 0);
    pa.setNodeParam(id, 'maxAngle', Math.PI / 2); // 不钳制 90° 旋转
    pa.update(0, skel);
    expect(Math.abs(skel.bones[0].rotation.y)).toBeGreaterThan(0.5);
  });

  // ── reach ───────────────────────────────────────────────────────

  it('updateReach moves bone position toward target', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['hand']);
    const id = pa.addNode('reach', 'hand');
    pa.setNodeParam(id, 'targetX', 10);
    pa.setNodeParam(id, 'targetY', 0);
    pa.setNodeParam(id, 'targetZ', 0);
    pa.setNodeParam(id, 'stiffness', 1); // 全速趋近
    pa.update(0, skel);
    // stiffness=1, weight=1 → 一次插值 100% 到目标
    expect(skel.bones[0].position.x).toBeCloseTo(10, 5);
  });

  it('updateReach with low stiffness moves partially', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['hand']);
    const id = pa.addNode('reach', 'hand');
    pa.setNodeParam(id, 'targetX', 10);
    pa.setNodeParam(id, 'stiffness', 0.3);
    pa.update(0, skel);
    // 0.3 * 1(weight) = 0.3 → 移动 30%:x = 0 + (10-0)*0.3 = 3
    expect(skel.bones[0].position.x).toBeCloseTo(3, 5);
  });

  // ── secondaryMotion ─────────────────────────────────────────────

  it('updateSecondaryMotion tilts bone opposite to velocity', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['hair']);
    const id = pa.addNode('secondaryMotion', 'hair');
    pa.setNodeParam(id, 'velX', 5); // 向 +X 移动
    pa.setNodeParam(id, 'velY', 0);
    pa.setNodeParam(id, 'velZ', 0);
    pa.setNodeParam(id, 'stiffness', 1);
    pa.setNodeParam(id, 'damping', 0.1);
    pa.update(0, skel);
    const r = skel.bones[0].rotation;
    // 应有非平凡旋转(惯性倾斜)
    const isIdentity = r.x === 0 && r.y === 0 && r.z === 0 && r.w === 1;
    expect(isIdentity).toBe(false);
  });

  it('updateSecondaryMotion no-op for zero velocity', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['hair']);
    pa.addNode('secondaryMotion', 'hair'); // 默认 vel=0
    pa.update(0, skel);
    const r = skel.bones[0].rotation;
    expect(r.w).toBeCloseTo(1, 6);
  });

  // ── 多节点共存 ──────────────────────────────────────────────────

  it('update applies multiple nodes to different bones', () => {
    const pa = new ProceduralAnimation();
    const skel = makeSkeleton(['head', 'chest']);
    const headId = pa.addNode('headTrack', 'head');
    pa.setNodeParam(headId, 'targetX', 1);
    pa.setNodeParam(headId, 'targetZ', 0);
    pa.addNode('breathing', 'chest'); // 用默认参数
    pa.update(0, skel);
    // head 被旋转
    expect(Math.abs(skel.bones[0].rotation.y)).toBeGreaterThan(0.5);
    // chest scale.y 在 time=0 时 phase=sin(0)=0 → scale.y=1
    expect(skel.bones[1].scale.y).toBeCloseTo(1, 5);
  });

  // ── 节点类型完整性 ──────────────────────────────────────────────

  it('all node types can be added and updated without error', () => {
    const types = [
      'headTrack',
      'breathing',
      'walkCycle',
      'runCycle',
      'idleSway',
      'lookAt',
      'reach',
      'secondaryMotion',
    ] as const;
    for (const t of types) {
      const pa = new ProceduralAnimation();
      const skel = makeSkeleton(['b']);
      pa.addNode(t, 'b');
      // 不应抛错
      pa.update(0.1, skel);
    }
  });
});
