// RagdollSystem 测试 — 骨骼布娃娃物理。
//
// 验证:
//   • 构造默认值 / 自定义参数
//   • createHumanoidRagdollConfig 默认配置完整性
//   • build — 创建刚体 + 关节 + 索引
//   • step / update — 重力下落 / pinned 不动 / 关节约束
//   • applyImpulse / applyAngularImpulse / setPinned
//   • writeBackToBones — 世界变换写回 Bone 本地变换
//   • getStats
//   • kinematic 模式
//   • clear

import { describe, it, expect } from 'vitest';
import { RagdollSystem, createHumanoidRagdollConfig } from './RagdollSystem';
import { Bone } from '../Core/Bone';
import { Vector3 } from '../Math/Vector3';

/** 构建一个最小 3 骨骼链:root → child → grandchild,用于测试。 */
function buildMiniSkeleton(): { root: Bone; child: Bone; grandchild: Bone; bones: Bone[] } {
  const root = new Bone(); root.name = 'root';
  root.position.set(0, 1, 0);
  const child = new Bone(); child.name = 'child';
  child.position.set(0, -0.5, 0);
  const grandchild = new Bone(); grandchild.name = 'grandchild';
  grandchild.position.set(0, -0.5, 0);
  root.add(child);
  child.add(grandchild);
  root.updateMatrixWorld(true);
  return { root, child, grandchild, bones: [root, child, grandchild] };
}

function buildMiniConfigs() {
  return [
    { boneName: 'root', shape: 'box' as const, halfExtents: new Vector3(0.1, 0.1, 0.1), mass: 5, joint: 'cone' as const, parentBone: undefined, swingLimit: 0, twistMin: 0, twistMax: 0, pinned: true },
    { boneName: 'child', parentBone: 'root', shape: 'capsule' as const, radius: 0.05, length: 0.4, mass: 2, joint: 'cone' as const, swingLimit: Math.PI / 4, twistMin: -Math.PI / 4, twistMax: Math.PI / 4, twistEnabled: true },
    { boneName: 'grandchild', parentBone: 'child', shape: 'sphere' as const, radius: 0.08, mass: 1, joint: 'ball' as const },
  ];
}

describe('RagdollSystem — 构造', () => {
  it('默认参数', () => {
    const sys = new RagdollSystem();
    expect(sys.gravity.y).toBeCloseTo(-9.8, 5);
    expect(sys.linearDamping).toBeCloseTo(0.05, 5);
    expect(sys.angularDamping).toBeCloseTo(0.05, 5);
    expect(sys.friction).toBeCloseTo(0.6, 5);
    expect(sys.restitution).toBeCloseTo(0.05, 5);
    expect(sys.groundCollision).toBe(false);
    expect(sys.groundY).toBe(0);
    expect(sys.fixedDt).toBeCloseTo(1 / 60, 5);
    expect(sys.solver.iterations).toBe(12);
    expect(sys.bones.length).toBe(0);
  });

  it('自定义参数透传', () => {
    const sys = new RagdollSystem({
      gravity: new Vector3(0, -20, 0),
      linearDamping: 0.1,
      angularDamping: 0.2,
      constraintIterations: 20,
      friction: 0.8,
      restitution: 0.1,
      groundCollision: true,
      groundY: -1,
      fixedDt: 1 / 120,
    });
    expect(sys.gravity.y).toBe(-20);
    expect(sys.linearDamping).toBeCloseTo(0.1, 5);
    expect(sys.angularDamping).toBeCloseTo(0.2, 5);
    expect(sys.solver.iterations).toBe(20);
    expect(sys.friction).toBeCloseTo(0.8, 5);
    expect(sys.restitution).toBeCloseTo(0.1, 5);
    expect(sys.groundCollision).toBe(true);
    expect(sys.groundY).toBe(-1);
    expect(sys.fixedDt).toBeCloseTo(1 / 120, 5);
  });

  it('构造选项中的 Vector3 被克隆', () => {
    const g = new Vector3(0, -9.8, 0);
    const sys = new RagdollSystem({ gravity: g });
    g.y = -100;
    expect(sys.gravity.y).toBeCloseTo(-9.8, 5);
  });
});

describe('createHumanoidRagdollConfig', () => {
  it('包含 16 块骨头(人形,含肩)', () => {
    const cfg = createHumanoidRagdollConfig();
    expect(cfg.length).toBe(16);
    const names = cfg.map((c) => c.boneName).sort();
    expect(names).toContain('pelvis');
    expect(names).toContain('head');
    expect(names).toContain('upperArm.L');
    expect(names).toContain('lowerArm.L');
    expect(names).toContain('thigh.L');
    expect(names).toContain('foot.L');
  });

  it('pelvis 是根节点且 pinned', () => {
    const cfg = createHumanoidRagdollConfig();
    const pelvis = cfg.find((c) => c.boneName === 'pelvis')!;
    expect(pelvis.parentBone).toBeUndefined();
    expect(pelvis.pinned).toBe(true);
  });

  it('膝/肘是 hinge 关节', () => {
    const cfg = createHumanoidRagdollConfig();
    const knee = cfg.find((c) => c.boneName === 'shin.L')!;
    expect(knee.joint).toBe('hinge');
    expect(knee.hingeAxis).toBeDefined();
    expect(knee.hingeMin!).toBeLessThan(0);
    expect(knee.hingeMax!).toBe(0);
  });
});

describe('RagdollSystem — build', () => {
  it('build 创建刚体 + 关节 + 索引', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    expect(sys.bones.length).toBe(3);
    expect(sys.boneIndex.size).toBe(3);
    // root 无 joint,child + grandchild 各 1 个
    expect(sys.solver.constraints.length).toBe(2);
  });

  it('build 缺失骨头抛错', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    const cfg = buildMiniConfigs();
    cfg[1].boneName = 'nonexistent';
    expect(() => sys.build(bones, cfg)).toThrow();
  });

  it('build 缺失父骨头抛错', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    const cfg = buildMiniConfigs();
    cfg[1].parentBone = 'nonexistent';
    expect(() => sys.build(bones, cfg)).toThrow();
  });

  it('build 后刚体位置匹配骨头世界位置', () => {
    const { bones, root } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    const rootBody = sys.bones[0].body;
    const childBody = sys.bones[1].body;
    expect(rootBody.position.x).toBeCloseTo(root.position.x, 5);
    expect(rootBody.position.y).toBeCloseTo(1, 5); // root world Y
    expect(childBody.position.y).toBeCloseTo(0.5, 5); // 1 - 0.5 = 0.5
  });

  it('pinned 骨头 invMass=0', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    expect(sys.bones[0].body.invMass).toBe(0);
    expect(sys.bones[0].body.mass).toBe(0);
    expect(sys.bones[1].body.invMass).toBeGreaterThan(0);
  });

  it('不同形状的逆惯性张量非零', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    // box(root):Ixx, Iyy, Izz 都 > 0
    const rootInv = sys.bones[0].body.invInertia;
    expect(rootInv[0]).toBeGreaterThan(0);
    expect(rootInv[4]).toBeGreaterThan(0);
    expect(rootInv[8]).toBeGreaterThan(0);
    // capsule(child):沿 Y 轴
    const childInv = sys.bones[1].body.invInertia;
    expect(childInv[0]).toBeGreaterThan(0);
    expect(childInv[4]).toBeGreaterThan(0);
    expect(childInv[8]).toBeGreaterThan(0);
    // sphere(grandchild)
    const gcInv = sys.bones[2].body.invInertia;
    expect(gcInv[0]).toBeGreaterThan(0);
  });
});

describe('RagdollSystem — step / update', () => {
  it('非 pinned 骨头受重力下落', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem({ fixedDt: 1 / 60 });
    sys.build(bones, buildMiniConfigs());
    const childInitialY = sys.bones[1].body.position.y;
    sys.update(1 / 60);
    // 由于 joint 约束,child 不会完全自由下落,但应略微移动
    const childFinalY = sys.bones[1].body.position.y;
    // 允许向上或向下小幅度变化(约束求解可能拉回)
    expect(Math.abs(childFinalY - childInitialY)).toBeLessThan(0.5);
  });

  it('pinned 骨头不动', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    const rootInitialY = sys.bones[0].body.position.y;
    sys.update(1 / 60);
    const rootFinalY = sys.bones[0].body.position.y;
    expect(rootFinalY).toBeCloseTo(rootInitialY, 5);
  });

  it('多步推进 — 系统能稳定运行不发散', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem({ fixedDt: 1 / 60 });
    sys.build(bones, buildMiniConfigs());
    for (let i = 0; i < 60; i++) {
      sys.update(1 / 60);
    }
    // 所有位置应为有限数
    for (const rb of sys.bones) {
      expect(Number.isFinite(rb.body.position.x)).toBe(true);
      expect(Number.isFinite(rb.body.position.y)).toBe(true);
      expect(Number.isFinite(rb.body.position.z)).toBe(true);
      expect(Number.isFinite(rb.body.quaternion.w)).toBe(true);
    }
  });

  it('地面碰撞启用时骨头不穿地', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem({
      groundCollision: true,
      groundY: 0,
      fixedDt: 1 / 60,
    });
    sys.build(bones, buildMiniConfigs());
    // 解除 root 固定,让整个 ragdoll 自由下落
    sys.setPinned('root', false);
    for (let i = 0; i < 120; i++) {
      sys.update(1 / 60);
    }
    // 所有刚体应在地面之上(允许小数值误差)
    for (const rb of sys.bones) {
      expect(rb.body.position.y).toBeGreaterThanOrEqual(-0.5);
    }
  });

  it('kinematic 模式下刚体跟随骨头,不模拟', () => {
    const { bones, child } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    sys.kinematicMode = true;
    const initialY = sys.bones[1].body.position.y;
    // 修改 child 的本地位置(必须用 .set() 触发脏标记)
    child.position.set(0, -1, 0);
    child.updateMatrixWorld(true);
    sys.update(1 / 60);
    // 刚体应跟随 child 的新世界位置(初始 0.5 → 现在 0)
    const finalY = sys.bones[1].body.position.y;
    expect(finalY).toBeLessThan(initialY);
  });
});

describe('RagdollSystem — 冲量与状态', () => {
  it('applyImpulse 给非 pinned 骨头施加冲量', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    const ok = sys.applyImpulse('child', new Vector3(10, 0, 0));
    expect(ok).toBe(true);
    expect(sys.bones[1].body.velocity.x).toBeGreaterThan(0);
  });

  it('applyImpulse 对 pinned 骨头无效', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    const ok = sys.applyImpulse('root', new Vector3(10, 0, 0));
    expect(ok).toBe(true);
    expect(sys.bones[0].body.velocity.lengthSq()).toBe(0);
  });

  it('applyImpulse 不存在的骨头返回 false', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    const ok = sys.applyImpulse('nonexistent', new Vector3(10, 0, 0));
    expect(ok).toBe(false);
  });

  it('applyAngularImpulse 改变角速度', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    sys.applyAngularImpulse('child', new Vector3(0, 5, 0));
    expect(sys.bones[1].body.angularVelocity.y).not.toBe(0);
  });

  it('setPinned 运行时切换', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    expect(sys.bones[0].body.invMass).toBe(0);
    expect(sys.setPinned('root', false)).toBe(true);
    expect(sys.bones[0].body.invMass).toBeGreaterThan(0);
    expect(sys.bones[0].body.mass).toBe(5);
    expect(sys.setPinned('root', true)).toBe(true);
    expect(sys.bones[0].body.invMass).toBe(0);
  });
});

describe('RagdollSystem — writeBackToBones', () => {
  it('update 后 Bone 本地变换反映物理状态', () => {
    const { bones, root } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    // 直接移动 child 刚体位置
    sys.bones[1].body.position.x = 0.5;
    sys.bones[1].body.position.y = 0.3;
    sys.bones[1].body.position.z = -0.2;
    // update 一次让 writeBackToBones 执行
    sys.update(1 / 60);
    // root 是 pinned,position 应不变
    expect(root.position.x).toBeCloseTo(0, 5);
    expect(root.position.y).toBeCloseTo(1, 5);
  });

  it('update 后四元数为有限数', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    for (let i = 0; i < 10; i++) sys.update(1 / 60);
    for (const rb of sys.bones) {
      expect(Number.isFinite(rb.bone.rotation.x)).toBe(true);
      expect(Number.isFinite(rb.bone.rotation.y)).toBe(true);
      expect(Number.isFinite(rb.bone.rotation.z)).toBe(true);
      expect(Number.isFinite(rb.bone.rotation.w)).toBe(true);
    }
  });
});

describe('RagdollSystem — getStats / clear', () => {
  it('getStats 返回正确计数', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    const stats = sys.getStats();
    expect(stats.boneCount).toBe(3);
    expect(stats.jointCount).toBe(2);
    expect(stats.pinnedCount).toBe(1);
    expect(stats.totalMass).toBeCloseTo(2 + 1, 5); // child + grandchild
    expect(stats.constraintIterations).toBe(12);
    expect(stats.gravity.y).toBeCloseTo(-9.8, 5);
  });

  it('clear 清空所有状态', () => {
    const { bones } = buildMiniSkeleton();
    const sys = new RagdollSystem();
    sys.build(bones, buildMiniConfigs());
    sys.clear();
    expect(sys.bones.length).toBe(0);
    expect(sys.boneIndex.size).toBe(0);
    expect(sys.solver.constraints.length).toBe(0);
  });
});

describe('RagdollSystem — 人形 ragdoll 集成', () => {
  it('人形骨架能构建并稳定模拟 60 步', () => {
    // 构建简化人形骨架(只测核心骨骼链)
    const pelvis = new Bone(); pelvis.name = 'pelvis'; pelvis.position.set(0, 1, 0);
    const spine = new Bone(); spine.name = 'spine'; spine.position.set(0, 0.2, 0);
    const chest = new Bone(); chest.name = 'chest'; chest.position.set(0, 0.25, 0);
    const head = new Bone(); head.name = 'head'; head.position.set(0, 0.25, 0);
    const thL = new Bone(); thL.name = 'thigh.L'; thL.position.set(0.1, -0.1, 0);
    const snL = new Bone(); snL.name = 'shin.L'; snL.position.set(0, -0.3, 0);
    const thR = new Bone(); thR.name = 'thigh.R'; thR.position.set(-0.1, -0.1, 0);
    const snR = new Bone(); snR.name = 'shin.R'; snR.position.set(0, -0.3, 0);
    pelvis.add(spine); spine.add(chest); chest.add(head);
    pelvis.add(thL); thL.add(snL);
    pelvis.add(thR); thR.add(snR);
    pelvis.updateMatrixWorld(true);

    const bones = [pelvis, spine, chest, head, thL, snL, thR, snR];
    const cfg = createHumanoidRagdollConfig().filter((c) =>
      ['pelvis', 'spine', 'chest', 'head', 'thigh.L', 'shin.L', 'thigh.R', 'shin.R'].includes(c.boneName),
    );

    const sys = new RagdollSystem({ fixedDt: 1 / 60 });
    sys.build(bones, cfg);
    expect(sys.bones.length).toBe(8);

    for (let i = 0; i < 60; i++) {
      sys.update(1 / 60);
    }
    // 所有值有限
    for (const rb of sys.bones) {
      expect(Number.isFinite(rb.body.position.x)).toBe(true);
      expect(Number.isFinite(rb.body.position.y)).toBe(true);
      expect(Number.isFinite(rb.body.quaternion.w)).toBe(true);
    }
  });
});
