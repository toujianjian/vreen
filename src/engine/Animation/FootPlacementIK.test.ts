import { describe, it, expect } from 'vitest';
import {
  FootPlacementIK,
  FootPlacementIKPresets,
  type IKRaycastFn,
} from './FootPlacementIK';
import { Vector3 } from '../Math/Vector3';

// ── 测试辅助 ─────────────────────────────────────────────────────

/** 创建一个在 y=0 平面命中的射线函数。 */
function flatGroundRaycast(): IKRaycastFn {
  return (origin, dir, maxDist) => {
    // 只处理向下的射线
    if (dir.y >= 0) return null;
    // y=0 平面:origin.y + t * dir.y = 0 → t = -origin.y / dir.y
    const t = -origin.y / dir.y;
    if (t < 0 || t > maxDist) return null;
    return {
      point: new Vector3(origin.x, 0, origin.z),
      normal: new Vector3(0, 1, 0),
      distance: t,
    };
  };
}

/** 创建一个在 y=height 斜面命中的射线函数(法线倾斜)。 */
function slopeRaycast(height: number, normal: Vector3): IKRaycastFn {
  return (origin, _dir, maxDist) => {
    const t = Math.max(0, (height - origin.y) / -1); // 简化:向下射线
    if (t > maxDist) return null;
    return {
      point: new Vector3(origin.x, height, origin.z),
      normal: normal.clone(),
      distance: t,
    };
  };
}

/** 创建一个永远 miss 的射线函数。 */
function missRaycast(): IKRaycastFn {
  return () => null;
}

// ──────────────────────────────────────────────────────────────────

describe('FootPlacementIK', () => {
  // ── 构造与默认值 ────────────────────────────────────────────────

  it('默认构造:raycast=null, weight=1, blendSpeed=8', () => {
    const ik = new FootPlacementIK();
    expect(ik.raycast).toBeNull();
    expect(ik.weight).toBe(1);
    expect(ik.blendSpeed).toBe(8);
  });

  it('默认脚部配置:footOffset=0.02, normalAlign=0.5, maxStepHeight=0.3', () => {
    const ik = new FootPlacementIK();
    expect(ik.leftFoot.footOffset).toBe(0.02);
    expect(ik.leftFoot.normalAlign).toBe(0.5);
    expect(ik.leftFoot.maxStepHeight).toBe(0.3);
    expect(ik.rightFoot.footOffset).toBe(0.02);
    expect(ik.rightFoot.normalAlign).toBe(0.5);
    expect(ik.rightFoot.maxStepHeight).toBe(0.3);
  });

  it('默认状态:grounded=false, blendWeight=0', () => {
    const ik = new FootPlacementIK();
    expect(ik.leftState.grounded).toBe(false);
    expect(ik.leftState.blendWeight).toBe(0);
    expect(ik.rightState.grounded).toBe(false);
    expect(ik.rightState.blendWeight).toBe(0);
  });

  // ── 无射线函数 ──────────────────────────────────────────────────

  it('raycast=null 时 update 不产生 IK 效果', () => {
    const ik = new FootPlacementIK();
    ik.update(0.016, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
    expect(ik.leftState.grounded).toBe(false);
    expect(ik.leftState.blendWeight).toBe(0);
  });

  it('raycast=null 时 solveLeft 返回单位旋转', () => {
    const ik = new FootPlacementIK();
    ik.update(0.016, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
    const result = ik.solveLeft(
      new Vector3(0, 1, 0),
      new Vector3(0, 0.5, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 0.5, 0.1),
    );
    expect(result.rootQuat.w).toBe(1); // 单位四元数
    expect(result.midQuat.w).toBe(1);
    expect(result.footQuat.w).toBe(1);
  });

  // ── 射线命中 ────────────────────────────────────────────────────

  it('射线命中平地时 grounded=true', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    // 脚在 y=0.05(接近地面)
    ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    expect(ik.leftState.grounded).toBe(true);
    expect(ik.rightState.grounded).toBe(true);
  });

  it('目标位置 = 命中点 + footOffset', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    ik.leftFoot.footOffset = 0.03;
    ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    // 命中 y=0,目标 y = 0 + 0.03 = 0.03
    expect(ik.leftState.targetPos.y).toBeCloseTo(0.03, 4);
  });

  it('射线 miss 时 grounded=false', () => {
    const ik = new FootPlacementIK();
    ik.raycast = missRaycast();
    ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    expect(ik.leftState.grounded).toBe(false);
  });

  // ── maxStepHeight ──────────────────────────────────────────────

  it('台阶高度超过 maxStepHeight 时不调整', () => {
    const ik = new FootPlacementIK();
    // 地面在 y=0.5(脚在 y=0.05,差 0.45 > maxStepHeight 0.3)
    ik.raycast = slopeRaycast(0.5, new Vector3(0, 1, 0));
    ik.leftFoot.maxStepHeight = 0.3;
    ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    expect(ik.leftState.grounded).toBe(false);
  });

  it('台阶高度在 maxStepHeight 内时调整', () => {
    const ik = new FootPlacementIK();
    // 地面在 y=0.1(脚在 y=0.05,差 0.05 < maxStepHeight 0.3)
    ik.raycast = slopeRaycast(0.1, new Vector3(0, 1, 0));
    ik.leftFoot.maxStepHeight = 0.3;
    ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    expect(ik.leftState.grounded).toBe(true);
  });

  // ── 混合平滑 ───────────────────────────────────────────────────

  it('blendWeight 首帧不瞬切到 1', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    expect(ik.leftState.blendWeight).toBeGreaterThan(0);
    expect(ik.leftState.blendWeight).toBeLessThan(1);
  });

  it('blendWeight 多帧后收敛到 1', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    expect(ik.leftState.blendWeight).toBeCloseTo(1, 1);
  });

  it('grounded 变 false 时 blendWeight 衰减到 0', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    // 先达到满混合
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    expect(ik.leftState.blendWeight).toBeCloseTo(1, 1);
    // 切换到 miss
    ik.raycast = missRaycast();
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    expect(ik.leftState.blendWeight).toBeCloseTo(0, 1);
  });

  it('weight=0 时 blendWeight 始终为 0', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    ik.weight = 0;
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    expect(ik.leftState.blendWeight).toBe(0);
  });

  // ── dt=0 ───────────────────────────────────────────────────────

  it('dt=0 时不推进混合', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    ik.update(0, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    expect(ik.leftState.blendWeight).toBe(0);
  });

  // ── solveLeft / solveRight ─────────────────────────────────────

  it('solveLeft 返回 IK 输出 + footQuat', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    // 收敛混合
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    // 使用弯曲的膝盖 (knee.x=0.15) 使腿长 > hip-target 距离,避免可达球钳制。
    // 直腿 (knee.x=0) 时 len1+len2 = |hip-foot| = 0.95 < d=0.98,目标被钳制。
    // 弯曲后 len1≈0.522, len2≈0.474, sum≈0.996 > 0.98,目标可达。
    const result = ik.solveLeft(
      new Vector3(0, 1, 0),      // hip
      new Vector3(0.15, 0.5, 0), // knee (弯曲)
      new Vector3(0, 0.05, 0),   // foot
      new Vector3(0.15, 0.5, 0.1), // pole (靠近 knee)
    );
    expect(result.rootQuat).toBeDefined();
    expect(result.midQuat).toBeDefined();
    expect(result.midPos).toBeDefined();
    expect(result.endPos).toBeDefined();
    expect(result.footQuat).toBeDefined();
    // endPos 应接近目标位置(y ≈ footOffset = 0.02)
    expect(result.endPos.y).toBeCloseTo(0.02, 1);
  });

  it('solveRight 与 solveLeft 独立', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    const leftResult = ik.solveLeft(
      new Vector3(0, 1, 0),
      new Vector3(0, 0.5, 0),
      new Vector3(0, 0.05, 0),
      new Vector3(0, 0.5, 0.1),
    );
    const rightResult = ik.solveRight(
      new Vector3(0.5, 1, 0),
      new Vector3(0.5, 0.5, 0),
      new Vector3(0.5, 0.05, 0),
      new Vector3(0.5, 0.5, 0.1),
    );
    // 两个结果的位置应不同(不同的 hip/foot 位置)
    expect(leftResult.endPos.x).toBeCloseTo(0, 1);
    expect(rightResult.endPos.x).toBeCloseTo(0.5, 1);
  });

  it('低 blendWeight 时返回单位旋转', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    // 使用极小 dt 使 blendWeight < 0.001,触发 solveFoot 的 early-out。
    // dt=0.016 时 blendWeight ≈ 0.12 (alpha = 1 - exp(-8*0.016) ≈ 0.12),
    // 不触发 early-out。dt=0.0001 时 alpha ≈ 0.0008 < 0.001。
    ik.update(0.0001, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    expect(ik.leftState.blendWeight).toBeLessThan(0.001);
    const result = ik.solveLeft(
      new Vector3(0, 1, 0),
      new Vector3(0, 0.5, 0),
      new Vector3(0, 0.05, 0),
      new Vector3(0, 0.5, 0.1),
    );
    // 应返回单位四元数 (early-out 路径)
    expect(result.rootQuat.w).toBe(1);
    expect(result.footQuat.w).toBe(1);
  });

  // ── 法线对齐 ───────────────────────────────────────────────────

  it('斜面法线时 footQuat 非单位(有旋转)', () => {
    const ik = new FootPlacementIK();
    // 30° 斜面法线
    const slopeNormal = new Vector3(0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6));
    ik.raycast = slopeRaycast(0.05, slopeNormal);
    ik.leftFoot.normalAlign = 1; // 完全对齐
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    const result = ik.solveLeft(
      new Vector3(0, 1, 0),
      new Vector3(0, 0.5, 0),
      new Vector3(0, 0.05, 0),
      new Vector3(0, 0.5, 0.1),
    );
    // 法线对齐应产生非单位旋转
    const angle = 2 * Math.acos(Math.min(1, Math.abs(result.footQuat.w)));
    expect(angle).toBeGreaterThan(0.01);
  });

  it('normalAlign=0 时 footQuat 为单位(不对齐法线)', () => {
    const ik = new FootPlacementIK();
    const slopeNormal = new Vector3(0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6));
    ik.raycast = slopeRaycast(0.05, slopeNormal);
    ik.leftFoot.normalAlign = 0; // 不对齐
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    const result = ik.solveLeft(
      new Vector3(0, 1, 0),
      new Vector3(0, 0.5, 0),
      new Vector3(0, 0.05, 0),
      new Vector3(0, 0.5, 0.1),
    );
    expect(result.footQuat.w).toBeCloseTo(1, 4);
  });

  // ── computeTarget ──────────────────────────────────────────────

  it('computeTarget 返回命中点 + footOffset', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    ik.leftFoot.footOffset = 0.05;
    const result = ik.computeTarget(new Vector3(0, 0.1, 0), ik.leftFoot);
    expect(result.grounded).toBe(true);
    expect(result.targetPos.y).toBeCloseTo(0.05, 4); // 0 + 0.05
  });

  it('computeTarget 射线 miss 时返回原始位置', () => {
    const ik = new FootPlacementIK();
    ik.raycast = missRaycast();
    const footPos = new Vector3(0, 0.1, 0);
    const result = ik.computeTarget(footPos, ik.leftFoot);
    expect(result.grounded).toBe(false);
    expect(result.targetPos).toEqual(footPos);
  });

  // ── reset ──────────────────────────────────────────────────────

  it('reset 清零混合权重和状态', () => {
    const ik = new FootPlacementIK();
    ik.raycast = flatGroundRaycast();
    for (let i = 0; i < 200; i++) {
      ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
    }
    expect(ik.leftState.blendWeight).toBeCloseTo(1, 1);
    ik.reset();
    expect(ik.leftState.blendWeight).toBe(0);
    expect(ik.leftState.grounded).toBe(false);
    expect(ik.rightState.blendWeight).toBe(0);
  });

  // ── 序列化 ──────────────────────────────────────────────────────

  it('export/import JSON 往返保持配置', () => {
    const ik = new FootPlacementIK();
    ik.blendSpeed = 12;
    ik.weight = 0.8;
    ik.leftFoot.footOffset = 0.05;
    ik.leftFoot.normalAlign = 0.7;
    ik.rightFoot.maxStepHeight = 0.4;
    const json = ik.exportJSON();

    const ik2 = new FootPlacementIK();
    ik2.importJSON(json);
    expect(ik2.blendSpeed).toBe(12);
    expect(ik2.weight).toBe(0.8);
    expect(ik2.leftFoot.footOffset).toBe(0.05);
    expect(ik2.leftFoot.normalAlign).toBe(0.7);
    expect(ik2.rightFoot.maxStepHeight).toBe(0.4);
  });

  // ── 预设 ─────────────────────────────────────────────────────────

  it('humanoid 预设:标准配置', () => {
    const ik = FootPlacementIKPresets.humanoid();
    expect(ik.weight).toBe(1);
    expect(ik.blendSpeed).toBe(8);
    expect(ik.leftFoot.footOffset).toBe(0.02);
    expect(ik.leftFoot.normalAlign).toBe(0.5);
  });

  it('stealth 预设:低脚离地,强法线对齐', () => {
    const ik = FootPlacementIKPresets.stealth();
    expect(ik.leftFoot.footOffset).toBeLessThan(0.02);
    expect(ik.leftFoot.normalAlign).toBeGreaterThan(0.5);
    expect(ik.blendSpeed).toBeGreaterThan(8);
  });

  it('running 预设:高脚离地,弱法线对齐,快混合', () => {
    const ik = FootPlacementIKPresets.running();
    expect(ik.leftFoot.footOffset).toBeGreaterThan(0.02);
    expect(ik.leftFoot.normalAlign).toBeLessThan(0.5);
    expect(ik.blendSpeed).toBeGreaterThan(8);
  });

  it('disabled 预设:weight=0', () => {
    const ik = FootPlacementIKPresets.disabled();
    expect(ik.weight).toBe(0);
  });

  it('所有预设产生的实例可用(不抛错)', () => {
    const presets = [
      FootPlacementIKPresets.humanoid(),
      FootPlacementIKPresets.stealth(),
      FootPlacementIKPresets.running(),
      FootPlacementIKPresets.disabled(),
    ];
    for (const ik of presets) {
      ik.raycast = flatGroundRaycast();
      expect(() => {
        ik.update(0.016, new Vector3(0, 0.05, 0), new Vector3(0.5, 0.05, 0));
      }).not.toThrow();
    }
  });
});
