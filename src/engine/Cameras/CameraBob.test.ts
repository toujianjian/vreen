import { describe, it, expect } from 'vitest';
import { CameraBob, CameraBobPresets } from './CameraBob';
import type { CameraBobOffset } from './CameraBob';
import { Vector3 } from '../Math';

describe('CameraBob', () => {
  // ── 构造与默认值 ──────────────────────────────────────────────────

  it('默认构造:所有参数有合理默认值', () => {
    const bob = new CameraBob();
    expect(bob.bobFrequency).toBe(0.5);
    expect(bob.bobAmount).toBe(0.05);
    expect(bob.swayAmount).toBe(0.03);
    expect(bob.footstepAmount).toBe(0.02);
    expect(bob.rotationAmount).toBe(0.01);
    expect(bob.maxSpeed).toBe(5);
    expect(bob.crouchScale).toBe(0.4);
    expect(bob.phase).toBe(0);
  });

  // ── 静止状态 ──────────────────────────────────────────────────────

  it('速度为 0 时偏移为零', () => {
    const bob = new CameraBob();
    bob.update(0.016, 0, false);
    const offset = bob.getOffset();
    expect(offset.translation.x).toBe(0);
    expect(offset.translation.y).toBe(0);
    expect(offset.translation.z).toBe(0);
    expect(offset.rotation.x).toBe(0);
    expect(offset.rotation.y).toBe(0);
    expect(offset.rotation.z).toBe(0);
    expect(offset.speedFactor).toBe(0);
    expect(offset.isFootstep).toBe(false);
  });

  it('速度为 0 时 phase 不推进', () => {
    const bob = new CameraBob();
    bob.update(1, 0, false);
    expect(bob.phase).toBe(0);
  });

  // ── 移动状态 ──────────────────────────────────────────────────────

  it('有速度时产生非零偏移', () => {
    const bob = new CameraBob();
    // 多帧推进让 smoothedSpeedFactor 收敛
    for (let i = 0; i < 60; i++) bob.update(0.016, 5, false);
    const offset = bob.getOffset();
    expect(offset.speedFactor).toBeCloseTo(1, 1);
    // 偏移应有非零分量(bob 或 sway)
    const mag =
      Math.abs(offset.translation.x) +
      Math.abs(offset.translation.y) +
      Math.abs(offset.translation.z);
    expect(mag).toBeGreaterThan(0.001);
  });

  it('速度因子钳制到 [0, 1](超速不放大)', () => {
    const bob = new CameraBob();
    bob.maxSpeed = 5;
    for (let i = 0; i < 60; i++) bob.update(0.016, 100, false);
    const offset = bob.getOffset();
    expect(offset.speedFactor).toBeLessThanOrEqual(1.0);
  });

  it('偏移幅度受 bobAmount / swayAmount 限制', () => {
    const bob = new CameraBob();
    bob.bobAmount = 0.1;
    bob.swayAmount = 0.06;
    bob.footstepAmount = 0;
    for (let i = 0; i < 200; i++) bob.update(0.016, 5, false);
    const offset = bob.getOffset();
    // |bobY| <= bobAmount * 1 = 0.1
    expect(Math.abs(offset.translation.y)).toBeLessThanOrEqual(0.1 + 1e-6);
    // |swayX| <= swayAmount * 1 = 0.06
    expect(Math.abs(offset.translation.x)).toBeLessThanOrEqual(0.06 + 1e-6);
  });

  // ── 相位推进 ──────────────────────────────────────────────────────

  it('相位推进与速度成正比', () => {
    const bob1 = new CameraBob();
    const bob2 = new CameraBob();
    bob1.update(1, 5, false);
    bob2.update(1, 10, false);
    // 速度 10 的相位应为速度 5 的 2 倍
    expect(bob2.phase).toBeCloseTo(bob1.phase * 2, 3);
  });

  it('相位推进与 dt 成正比', () => {
    const bob1 = new CameraBob();
    const bob2 = new CameraBob();
    bob1.update(1, 5, false);
    bob2.update(0.5, 5, false);
    bob2.update(0.5, 5, false);
    expect(bob2.phase).toBeCloseTo(bob1.phase, 3);
  });

  // ── bobY / swayX 频率比 ──────────────────────────────────────────

  it('swayX 频率为 bobY 的一半(两步一个 sway 周期)', () => {
    const bob = new CameraBob();
    bob.bobAmount = 1;
    bob.swayAmount = 1;
    bob.footstepAmount = 0;
    bob.rotationAmount = 0;
    bob.maxSpeed = 1;

    // 推进到 phase = 2π(一个完整 bob 周期)
    // phase = dt * speed * freq * 2π = 1 * 1 * 0.5 * 2π = π per second
    // 需要 2 秒到达 phase = 2π
    for (let i = 0; i < 200; i++) bob.update(0.01, 1, false);
    // phase ≈ 2π,bobY = sin(2π) = 0,swayX = cos(π) = -1
    const offset = bob.getOffset();
    expect(offset.translation.y).toBeCloseTo(0, 1); // bobY ≈ 0
    expect(offset.translation.x).toBeCloseTo(-1, 1); // swayX ≈ -1 (半周期完成)
  });

  it('bobY 在一个周期内回到起点', () => {
    const bob = new CameraBob();
    bob.bobAmount = 0.1;
    bob.swayAmount = 0;
    bob.footstepAmount = 0;
    bob.rotationAmount = 0;
    bob.maxSpeed = 1;
    // 推进一个完整周期(phase = 2π)
    for (let i = 0; i < 200; i++) bob.update(0.01, 1, false);
    const offset = bob.getOffset();
    expect(offset.translation.y).toBeCloseTo(0, 1); // sin(2π) = 0
  });

  // ── 着地冲击 ──────────────────────────────────────────────────────

  it('着地冲击(footstep)在 sin 峰值附近最大', () => {
    const bob = new CameraBob();
    bob.bobAmount = 0;
    bob.swayAmount = 0;
    bob.footstepAmount = 0.1;
    bob.rotationAmount = 0;
    bob.maxSpeed = 1;

    // 推进到 phase = π/2(sin = 1,着地冲击最大)
    // phase = dt * speed * freq * 2π,需要 phase = π/2
    // dt * 1 * 0.5 * 2π = π/2 → dt = 0.5 秒
    for (let i = 0; i < 100; i++) bob.update(0.005, 1, false);
    const offset = bob.getOffset();
    // 着地冲击 = sin^6(π/2) * 0.1 * 1 = 1 * 0.1 = 0.1
    // translation.y = bobY - footstep = 0 - 0.1 = -0.1
    expect(offset.translation.y).toBeCloseTo(-0.1, 2);
    expect(offset.isFootstep).toBe(true);
  });

  it('着地冲击在 sin 谷值时为零', () => {
    const bob = new CameraBob();
    bob.bobAmount = 0;
    bob.swayAmount = 0;
    bob.footstepAmount = 0.1;
    bob.rotationAmount = 0;
    bob.maxSpeed = 1;

    // 推进到 phase = 3π/2(sin = -1,footstep = max(0, -1)^6 = 0)
    // 需要 phase = 3π/2 → dt = 1.5 秒
    for (let i = 0; i < 300; i++) bob.update(0.005, 1, false);
    const offset = bob.getOffset();
    expect(offset.translation.y).toBeCloseTo(0, 2);
    expect(offset.isFootstep).toBe(false);
  });

  // ── 潜行模式 ──────────────────────────────────────────────────────

  it('潜行模式降低偏移幅度', () => {
    const bob1 = new CameraBob();
    const bob2 = new CameraBob();
    bob1.bobAmount = 0.1;
    bob2.bobAmount = 0.1;
    // 都推进到相同 phase
    for (let i = 0; i < 100; i++) {
      bob1.update(0.005, 5, false);
      bob2.update(0.005, 5, true);
    }
    const off1 = bob1.getOffset();
    const off2 = bob2.getOffset();
    // 潜行时 speedFactor 应更低(crouchScale = 0.4)
    expect(off2.speedFactor).toBeLessThan(off1.speedFactor);
    // speedFactor 应为非潜行的 0.4 倍
    expect(off2.speedFactor).toBeCloseTo(off1.speedFactor * 0.4, 1);
  });

  // ── 平滑 ──────────────────────────────────────────────────────────

  it('速度因子平滑:首帧不瞬切到目标值', () => {
    const bob = new CameraBob();
    bob.maxSpeed = 5;
    bob.update(0.016, 5, false);
    const offset = bob.getOffset();
    // 首帧 smoothedSpeedFactor 应远小于 1(指数平滑)
    expect(offset.speedFactor).toBeLessThan(0.5);
    expect(offset.speedFactor).toBeGreaterThan(0);
  });

  it('速度因子多帧后收敛到目标值', () => {
    const bob = new CameraBob();
    bob.maxSpeed = 5;
    for (let i = 0; i < 200; i++) bob.update(0.016, 5, false);
    const offset = bob.getOffset();
    expect(offset.speedFactor).toBeCloseTo(1, 1);
  });

  it('速度因子在速度归零后逐渐衰减', () => {
    const bob = new CameraBob();
    bob.maxSpeed = 5;
    // 先达到满速
    for (let i = 0; i < 200; i++) bob.update(0.016, 5, false);
    // 停止
    bob.update(0.016, 0, false);
    const offset = bob.getOffset();
    // 应仍 > 0(平滑衰减,非瞬切)
    expect(offset.speedFactor).toBeGreaterThan(0);
    expect(offset.speedFactor).toBeLessThan(1);
  });

  // ── getOffset out 参数 ───────────────────────────────────────────

  it('getOffset 支持 out 参数复用', () => {
    const bob = new CameraBob();
    for (let i = 0; i < 60; i++) bob.update(0.016, 5, false);
    const out: CameraBobOffset = {
      translation: new Vector3(),
      rotation: new Vector3(),
      speedFactor: 0,
      isFootstep: false,
    };
    const result = bob.getOffset(out);
    expect(result).toBe(out);
    expect(out.speedFactor).toBeGreaterThan(0);
    expect(Number.isFinite(out.translation.x)).toBe(true);
  });

  // ── reset ────────────────────────────────────────────────────────

  it('reset 清零 phase 与 smoothedSpeedFactor', () => {
    const bob = new CameraBob();
    for (let i = 0; i < 100; i++) bob.update(0.016, 5, false);
    expect(bob.phase).not.toBe(0);
    bob.reset();
    expect(bob.phase).toBe(0);
    const offset = bob.getOffset();
    expect(offset.speedFactor).toBe(0);
  });

  // ── dt = 0 ───────────────────────────────────────────────────────

  it('dt=0 时不推进 phase 也不改变 speedFactor', () => {
    const bob = new CameraBob();
    bob.update(0.016, 5, false);
    const sfBefore = bob.getOffset().speedFactor;
    const phaseBefore = bob.phase;
    bob.update(0, 5, false);
    expect(bob.phase).toBe(phaseBefore);
    expect(bob.getOffset().speedFactor).toBeCloseTo(sfBefore, 6);
  });

  // ── 序列化 ───────────────────────────────────────────────────────

  it('export/import JSON 往返保持配置', () => {
    const bob = new CameraBob();
    bob.bobFrequency = 0.7;
    bob.bobAmount = 0.08;
    bob.swayAmount = 0.05;
    bob.footstepAmount = 0.04;
    bob.rotationAmount = 0.02;
    bob.maxSpeed = 8;
    bob.crouchScale = 0.5;
    bob.update(1.5, 5, false); // 推进 phase
    const json = bob.exportJSON();

    const bob2 = new CameraBob();
    bob2.importJSON(json);
    expect(bob2.bobFrequency).toBe(0.7);
    expect(bob2.bobAmount).toBe(0.08);
    expect(bob2.swayAmount).toBe(0.05);
    expect(bob2.footstepAmount).toBe(0.04);
    expect(bob2.rotationAmount).toBe(0.02);
    expect(bob2.maxSpeed).toBe(8);
    expect(bob2.crouchScale).toBe(0.5);
    expect(bob2.phase).toBeCloseTo(bob.phase, 5);
  });

  // ── 预设 ─────────────────────────────────────────────────────────

  it('fpsWalk 预设:中等频率,小幅度', () => {
    const bob = CameraBobPresets.fpsWalk();
    expect(bob.bobFrequency).toBeGreaterThanOrEqual(0.3);
    expect(bob.bobFrequency).toBeLessThanOrEqual(0.7);
    expect(bob.bobAmount).toBeGreaterThan(0.02);
    expect(bob.bobAmount).toBeLessThan(0.1);
  });

  it('fpsRun 预设:比 walk 更高频更大幅度', () => {
    const walk = CameraBobPresets.fpsWalk();
    const run = CameraBobPresets.fpsRun();
    expect(run.bobFrequency).toBeGreaterThanOrEqual(walk.bobFrequency);
    expect(run.bobAmount).toBeGreaterThanOrEqual(walk.bobAmount);
    expect(run.maxSpeed).toBeGreaterThan(walk.maxSpeed);
  });

  it('fpsCrouch 预设:比 walk 更小幅度', () => {
    const walk = CameraBobPresets.fpsWalk();
    const crouch = CameraBobPresets.fpsCrouch();
    expect(crouch.bobAmount).toBeLessThan(walk.bobAmount);
    expect(crouch.footstepAmount).toBeLessThan(walk.footstepAmount);
  });

  it('tpsWalk 预设:比 fpsWalk 更小幅度', () => {
    const fps = CameraBobPresets.fpsWalk();
    const tps = CameraBobPresets.tpsWalk();
    expect(tps.bobAmount).toBeLessThanOrEqual(fps.bobAmount);
  });

  it('spectator 预设:极小幅度,无着地冲击', () => {
    const bob = CameraBobPresets.spectator();
    expect(bob.bobAmount).toBeLessThan(0.02);
    expect(bob.footstepAmount).toBe(0);
  });

  it('所有预设产生的实例可用(不抛错)', () => {
    const presets = [
      CameraBobPresets.fpsWalk(),
      CameraBobPresets.fpsRun(),
      CameraBobPresets.fpsCrouch(),
      CameraBobPresets.tpsWalk(),
      CameraBobPresets.spectator(),
    ];
    for (const bob of presets) {
      bob.update(0.016, 5, false);
      const offset = bob.getOffset();
      expect(Number.isFinite(offset.translation.x)).toBe(true);
      expect(Number.isFinite(offset.translation.y)).toBe(true);
      expect(Number.isFinite(offset.speedFactor)).toBe(true);
    }
  });

  // ── 边界情况 ─────────────────────────────────────────────────────

  it('maxSpeed=0 时不崩溃,speedFactor=0', () => {
    const bob = new CameraBob();
    bob.maxSpeed = 0;
    expect(() => {
      for (let i = 0; i < 10; i++) bob.update(0.016, 5, false);
    }).not.toThrow();
    const offset = bob.getOffset();
    expect(offset.speedFactor).toBe(0);
  });

  it('负速度被视为 0(不产生偏移)', () => {
    const bob = new CameraBob();
    bob.update(0.016, -5, false);
    const offset = bob.getOffset();
    // speed < 0 → rawFactor < 0 → smoothedSpeedFactor 趋向 0
    // 但首帧平滑后可能略 > 0(从 0 开始向负值靠近,被钳制)
    // 验证偏移极小
    expect(offset.speedFactor).toBeLessThanOrEqual(0.001);
  });

  // ── 偏移方向验证 ─────────────────────────────────────────────────

  it('着地冲击使 translation.y 为负(向下)', () => {
    const bob = new CameraBob();
    bob.bobAmount = 0;
    bob.swayAmount = 0;
    bob.footstepAmount = 0.1;
    bob.rotationAmount = 0;
    bob.maxSpeed = 1;
    // 推进到 phase = π/2(着地冲击最大)
    for (let i = 0; i < 100; i++) bob.update(0.005, 1, false);
    const offset = bob.getOffset();
    // translation.y = bobY - footstep = 0 - 0.1 = -0.1
    expect(offset.translation.y).toBeLessThan(0);
  });

  it('roll 旋转与 sway 同相位(半频)', () => {
    const bob = new CameraBob();
    bob.bobAmount = 0;
    bob.swayAmount = 0;
    bob.footstepAmount = 0;
    bob.rotationAmount = 0.1;
    bob.maxSpeed = 1;
    // 推进到 phase = 0(初始):cos(0) = 1,roll = 1 * 0.1 * sf
    // 但 phase 从 0 开始,需要先让 speedFactor 收敛
    for (let i = 0; i < 200; i++) bob.update(0.005, 1, false);
    // phase = 200 * 0.005 * 1 * 0.5 * 2π = π
    // roll = cos(π * 0.5) * 0.1 * 1 = cos(π/2) * 0.1 = 0
    // 验证 roll 与 cos(phase * 0.5) 同相
    const expectedRoll = Math.cos(bob.phase * 0.5) * 0.1 * 1;
    const offset = bob.getOffset();
    expect(offset.rotation.z).toBeCloseTo(expectedRoll, 3);
  });
});
