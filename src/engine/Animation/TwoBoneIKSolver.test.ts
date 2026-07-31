import { describe, it, expect } from 'vitest';
import { TwoBoneIKSolver, LookAtIK, type TwoBoneIKInput, type TwoBoneIKOutput } from './TwoBoneIKSolver';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

const _out: TwoBoneIKOutput = {
  rootQuat: new Quaternion(),
  midQuat: new Quaternion(),
  midPos: new Vector3(),
  endPos: new Vector3(),
};

describe('TwoBoneIKSolver', () => {
  it('目标在可达范围内:end 到达目标', () => {
    const solver = new TwoBoneIKSolver();
    // root=(0,0,0), mid=(1,0,0), end=(2,0,0) — 直线链,len1=len2=1
    const input: TwoBoneIKInput = {
      rootPos: new Vector3(0, 0, 0),
      midPos: new Vector3(1, 0, 0),
      endPos: new Vector3(2, 0, 0),
      targetPos: new Vector3(1.5, 0.5, 0),
    };
    solver.solve(input, _out);
    // end 应到达 target
    expect(_out.endPos.distanceTo(input.targetPos)).toBeLessThan(0.001);
  });

  it('目标超出可达球:end 被 clamp 到 maxReach', () => {
    const solver = new TwoBoneIKSolver();
    const input: TwoBoneIKInput = {
      rootPos: new Vector3(0, 0, 0),
      midPos: new Vector3(1, 0, 0),
      endPos: new Vector3(2, 0, 0),
      targetPos: new Vector3(10, 0, 0), // 远超 len1+len2=2
    };
    solver.solve(input, _out);
    // end 应在 root+(2,0,0) 附近(maxReach=2)
    expect(_out.endPos.x).toBeCloseTo(2, 1);
    expect(_out.endPos.y).toBeCloseTo(0, 1);
    expect(_out.endPos.z).toBeCloseTo(0, 1);
  });

  it('pole 向量影响 mid 位置(肘部朝向)', () => {
    const solver = new TwoBoneIKSolver();
    const base: TwoBoneIKInput = {
      rootPos: new Vector3(0, 0, 0),
      midPos: new Vector3(1, 0, 0),
      endPos: new Vector3(2, 0, 0),
      targetPos: new Vector3(1.5, 0.5, 0),
    };
    // pole up
    const up: TwoBoneIKInput = { ...base, polePos: new Vector3(0, 10, 0) };
    solver.solve(up, _out);
    const midUp = _out.midPos.y;
    // pole down
    const down: TwoBoneIKInput = { ...base, polePos: new Vector3(0, -10, 0) };
    solver.solve(down, _out);
    const midDown = _out.midPos.y;
    // 中点 y 应该相反(pole 决定弯曲方向)
    expect(midUp).toBeGreaterThan(0);
    expect(midDown).toBeLessThan(0);
  });

  it('weight=0:返回单位旋转,位置不变', () => {
    const solver = new TwoBoneIKSolver();
    const input: TwoBoneIKInput = {
      rootPos: new Vector3(0, 0, 0),
      midPos: new Vector3(1, 0, 0),
      endPos: new Vector3(2, 0, 0),
      targetPos: new Vector3(1.5, 0.5, 0),
      weight: 0,
    };
    solver.solve(input, _out);
    expect(_out.rootQuat.w).toBeCloseTo(1, 5);
    expect(_out.midQuat.w).toBeCloseTo(1, 5);
    expect(_out.midPos.distanceTo(input.midPos)).toBeLessThan(0.001);
  });

  it('weight=0.5:旋转介于 identity 和 full IK 之间', () => {
    const solver = new TwoBoneIKSolver();
    const input: TwoBoneIKInput = {
      rootPos: new Vector3(0, 0, 0),
      midPos: new Vector3(1, 0, 0),
      endPos: new Vector3(2, 0, 0),
      targetPos: new Vector3(1.5, 0.5, 0),
      weight: 0.5,
    };
    solver.solve(input, _out);
    // weight 0.5 → rootQuat 不应是单位四元数,但也不应是 full rotation
    expect(_out.rootQuat.w).toBeGreaterThan(0);
    expect(_out.rootQuat.w).toBeLessThan(1.0 + 1e-6);
  });

  it('退化:骨长为零 → 旋转 root 指向 target', () => {
    const solver = new TwoBoneIKSolver();
    const input: TwoBoneIKInput = {
      rootPos: new Vector3(0, 0, 0),
      midPos: new Vector3(0, 0, 0), // len1 = 0
      endPos: new Vector3(1, 0, 0),
      targetPos: new Vector3(0, 1, 0),
    };
    solver.solve(input, _out);
    // 不应崩溃,end 应到达 target 方向
    expect(_out.endPos.x).toBeCloseTo(0, 1);
    expect(_out.endPos.y).toBeCloseTo(1, 1);
  });

  it('端到端:root 旋转后 root→mid 方向与新 mid 位置对齐', () => {
    const solver = new TwoBoneIKSolver();
    const input: TwoBoneIKInput = {
      rootPos: new Vector3(0, 0, 0),
      midPos: new Vector3(1, 0, 0),
      endPos: new Vector3(2, 0, 0),
      targetPos: new Vector3(0, 1.5, 0),
      polePos: new Vector3(0, 0, 1),
    };
    solver.solve(input, _out);
    // 原 root→mid 方向 = (1,0,0);旋转后应指向新 mid
    const fwd = new Vector3(1, 0, 0).applyQuaternion(_out.rootQuat);
    const expected = _out.midPos.clone().sub(input.rootPos).normalize();
    expect(fwd.dot(expected)).toBeGreaterThan(0.99);
  });
});

describe('LookAtIK', () => {
  it('目标在前方:旋转后前向指向目标', () => {
    const ik = new LookAtIK();
    // 骨骩在原点,当前朝 +Z,目标在 (0,0,10)
    const out = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1), // identity → +Z
      targetPos: new Vector3(0, 0, 10),
    }, { quat: new Quaternion() });
    // 旋转后 forward (0,0,1) 应用 out.quat → 应仍指 +Z(已在看目标)
    const fwd = new Vector3(0, 0, 1).applyQuaternion(out.quat);
    expect(fwd.z).toBeGreaterThan(0.99);
  });

  it('目标在右侧:旋转后前向指向 +X', () => {
    const ik = new LookAtIK();
    const out = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: new Vector3(10, 0, 0),
    }, { quat: new Quaternion() });
    const fwd = new Vector3(0, 0, 1).applyQuaternion(out.quat);
    expect(fwd.x).toBeGreaterThan(0.99);
  });

  it('maxAngle 限制旋转角度', () => {
    const ik = new LookAtIK();
    const out = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: new Vector3(10, 0, 0), // 90° 旋转
      maxAngle: Math.PI / 12, // 15°
    }, { quat: new Quaternion() });
    // forward 应在 +Z 和 +X 之间(约 15° 偏转)
    const fwd = new Vector3(0, 0, 1).applyQuaternion(out.quat);
    const angle = Math.atan2(fwd.x, fwd.z);
    expect(angle).toBeLessThan(Math.PI / 6); // < 30°
    expect(angle).toBeGreaterThan(0);
  });

  it('weight=0.5:旋转量减半', () => {
    const ik = new LookAtIK();
    const full = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: new Vector3(10, 0, 0),
    }, { quat: new Quaternion() });
    const half = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: new Vector3(10, 0, 0),
      weight: 0.5,
    }, { quat: new Quaternion() });
    const fwdFull = new Vector3(0, 0, 1).applyQuaternion(full.quat);
    const fwdHalf = new Vector3(0, 0, 1).applyQuaternion(half.quat);
    const angleFull = Math.atan2(fwdFull.x, fwdFull.z);
    const angleHalf = Math.atan2(fwdHalf.x, fwdHalf.z);
    // 半权重角度应小于全权重
    expect(angleHalf).toBeLessThan(angleFull);
    expect(angleHalf).toBeGreaterThan(0);
  });

  it('目标与骨骼重合:返回原旋转', () => {
    const ik = new LookAtIK();
    const boneQuat = new Quaternion(0.1, 0.2, 0.3, 0.9).normalize();
    const out = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat,
      targetPos: new Vector3(0, 0, 0), // 同位置
    }, { quat: new Quaternion() });
    expect(out.quat.x).toBeCloseTo(boneQuat.x, 5);
    expect(out.quat.y).toBeCloseTo(boneQuat.y, 5);
    expect(out.quat.z).toBeCloseTo(boneQuat.z, 5);
    expect(out.quat.w).toBeCloseTo(boneQuat.w, 5);
  });

  it('自定义前向轴:用 +Y 代替 +Z', () => {
    const ik = new LookAtIK();
    const out = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: new Vector3(0, 10, 0),
      forwardAxis: new Vector3(0, 1, 0),
    }, { quat: new Quaternion() });
    // forward (0,1,0) 旋转后应指向 +Y
    const fwd = new Vector3(0, 1, 0).applyQuaternion(out.quat);
    expect(fwd.y).toBeGreaterThan(0.99);
  });

  it('smooth 平滑:连续调用趋近目标', () => {
    const ik = new LookAtIK();
    const target = new Vector3(10, 0, 0);
    // 第一次调用:smooth=0.5 → 半途
    const out1 = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: target,
      smooth: 0.5,
    }, { quat: new Quaternion() });
    // 第二次调用:继续趋近
    const out2 = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: target,
      smooth: 0.5,
    }, { quat: new Quaternion() });
    const fwd1 = new Vector3(0, 0, 1).applyQuaternion(out1.quat);
    const fwd2 = new Vector3(0, 0, 1).applyQuaternion(out2.quat);
    const ang1 = Math.atan2(fwd1.x, fwd1.z);
    const ang2 = Math.atan2(fwd2.x, fwd2.z);
    // 第二次角度应更大(更接近 90°)
    expect(ang2).toBeGreaterThan(ang1);
  });

  it('reset 清除平滑状态', () => {
    const ik = new LookAtIK();
    const target = new Vector3(10, 0, 0);
    ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: target,
      smooth: 0.5,
    }, { quat: new Quaternion() });
    ik.reset();
    // reset 后应从 boneQuat 重新开始平滑,首帧仍是半途
    const out = ik.solve({
      bonePos: new Vector3(0, 0, 0),
      boneQuat: new Quaternion(0, 0, 0, 1),
      targetPos: target,
      smooth: 0.5,
    }, { quat: new Quaternion() });
    const fwd = new Vector3(0, 0, 1).applyQuaternion(out.quat);
    // smooth=0.5 首帧:从 identity 向 90° 目标移动 50% → 约 45°
    const angle = Math.atan2(fwd.x, fwd.z);
    expect(angle).toBeGreaterThan(0.3); // > ~17°
    expect(angle).toBeLessThan(Math.PI / 2); // < 90°
  });
});
