import { describe, it, expect } from 'vitest';
import { PerlinShake, PerlinShakePresets } from './PerlinShake';
import type { ShakeOffset } from './PerlinShake';
import { Vector3 } from '../Math';

describe('PerlinShake', () => {
  // ── 构造与 trauma ────────────────────────────────────────────────────

  it('默认构造 trauma = 0,isActive = false', () => {
    const s = new PerlinShake();
    expect(s.trauma).toBe(0);
    expect(s.isActive()).toBe(false);
    expect(s.getAmount()).toBe(0);
  });

  it('构造可接受 seed', () => {
    const s = new PerlinShake(123);
    expect(s.seed).toBe(123);
  });

  it('addTrauma 累加 trauma(截断到 1)', () => {
    const s = new PerlinShake();
    s.addTrauma(0.5);
    expect(s.trauma).toBe(0.5);
    s.addTrauma(0.4);
    expect(s.trauma).toBeCloseTo(0.9, 5);
    s.addTrauma(0.5);
    expect(s.trauma).toBe(1);
  });

  it('addTrauma 负值会减少 trauma(下限 0)', () => {
    const s = new PerlinShake();
    s.setTrauma(0.5);
    s.addTrauma(-0.3);
    expect(s.trauma).toBeCloseTo(0.2, 5);
    s.addTrauma(-1);
    expect(s.trauma).toBe(0);
  });

  it('setTrauma 截断到 [0, 1]', () => {
    const s = new PerlinShake();
    s.setTrauma(2);
    expect(s.trauma).toBe(1);
    s.setTrauma(-1);
    expect(s.trauma).toBe(0);
  });

  it('reset 清零 trauma 与 time', () => {
    const s = new PerlinShake();
    s.setTrauma(0.8);
    s.update(1);
    s.reset();
    expect(s.trauma).toBe(0);
    expect(s.isActive()).toBe(false);
  });

  // ── update / 衰减 ────────────────────────────────────────────────────

  it('update 按 decay 线性衰减 trauma', () => {
    const s = new PerlinShake();
    s.decay = 1.0; // 每秒衰减 1
    s.setTrauma(0.8);
    s.update(0.3);
    expect(s.trauma).toBeCloseTo(0.5, 5);
  });

  it('update 衰减到 0 不会变负', () => {
    const s = new PerlinShake();
    s.decay = 1.0;
    s.setTrauma(0.3);
    s.update(1);
    expect(s.trauma).toBe(0);
  });

  it('trauma=0 时 update 不会做无谓工作', () => {
    const s = new PerlinShake();
    s.setTrauma(0);
    s.update(1);
    expect(s.trauma).toBe(0);
    expect(s.isActive()).toBe(false);
  });

  // ── getAmount (trauma²) ──────────────────────────────────────────────

  it('getAmount 返回 trauma²(非线性映射)', () => {
    const s = new PerlinShake();
    s.setTrauma(0.5);
    expect(s.getAmount()).toBeCloseTo(0.25, 5);
    s.setTrauma(1.0);
    expect(s.getAmount()).toBeCloseTo(1.0, 5);
    s.setTrauma(0.0);
    expect(s.getAmount()).toBe(0);
  });

  it('trauma² 衰减:低 trauma 时 amount 远小于 trauma', () => {
    // 这是「余震很轻」的关键性质:trauma=0.3 → amount=0.09
    const s = new PerlinShake();
    s.setTrauma(0.3);
    expect(s.getAmount()).toBeLessThan(0.1);
  });

  // ── getOffset ────────────────────────────────────────────────────────

  it('trauma=0 时 getOffset 返回零偏移', () => {
    const s = new PerlinShake();
    s.setTrauma(0);
    const offset = s.getOffset();
    expect(offset.translation.x).toBe(0);
    expect(offset.translation.y).toBe(0);
    expect(offset.translation.z).toBe(0);
    expect(offset.rotation.x).toBe(0);
    expect(offset.rotation.y).toBe(0);
    expect(offset.rotation.z).toBe(0);
    expect(offset.amount).toBe(0);
  });

  it('trauma=1 时偏移受 maxOffset / maxAngle 限制', () => {
    const s = new PerlinShake(42);
    s.maxOffset = 0.5;
    s.maxAngle = 0.1;
    s.setTrauma(1);
    s.update(0.001); // 推进一点时间让噪声采样有变化
    const offset = s.getOffset();
    expect(Math.abs(offset.translation.x)).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(Math.abs(offset.translation.y)).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(Math.abs(offset.translation.z)).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(Math.abs(offset.rotation.x)).toBeLessThanOrEqual(0.1 + 1e-6);
    expect(Math.abs(offset.rotation.y)).toBeLessThanOrEqual(0.1 + 1e-6);
    expect(Math.abs(offset.rotation.z)).toBeLessThanOrEqual(0.1 + 1e-6);
  });

  it('相同 seed + 相同 time 给出相同偏移(确定性)', () => {
    const s1 = new PerlinShake(42);
    const s2 = new PerlinShake(42);
    s1.setTrauma(1);
    s2.setTrauma(1);
    s1.update(0.5);
    s2.update(0.5);
    const o1 = s1.getOffset();
    const o2 = s2.getOffset();
    expect(o1.translation.x).toBeCloseTo(o2.translation.x, 6);
    expect(o1.translation.y).toBeCloseTo(o2.translation.y, 6);
    expect(o1.translation.z).toBeCloseTo(o2.translation.z, 6);
    expect(o1.rotation.x).toBeCloseTo(o2.rotation.x, 6);
    expect(o1.rotation.y).toBeCloseTo(o2.rotation.y, 6);
    expect(o1.rotation.z).toBeCloseTo(o2.rotation.z, 6);
  });

  it('不同 seed 给出不同偏移', () => {
    const s1 = new PerlinShake(42);
    const s2 = new PerlinShake(1000);
    s1.setTrauma(1);
    s2.setTrauma(1);
    s1.update(0.5);
    s2.update(0.5);
    const o1 = s1.getOffset();
    const o2 = s2.getOffset();
    // 三轴至少有一轴差异显著(避免恰好相同)
    const diff =
      Math.abs(o1.translation.x - o2.translation.x) +
      Math.abs(o1.translation.y - o2.translation.y) +
      Math.abs(o1.translation.z - o2.translation.z);
    expect(diff).toBeGreaterThan(1e-3);
  });

  it('getOffset 支持 out 参数复用', () => {
    const s = new PerlinShake(42);
    s.setTrauma(1);
    s.update(0.1);
    // update 后 trauma 衰减,重新设为 1 以隔离测试 out 参数行为
    s.setTrauma(1);
    const out: ShakeOffset = {
      translation: new Vector3(),
      rotation: new Vector3(),
      amount: 0,
    };
    const result = s.getOffset(out);
    expect(result).toBe(out);
    expect(out.amount).toBeCloseTo(1, 5);
    // out.translation 应被填充为非零(trauma=1 + Perlin 噪声)
    expect(Number.isFinite(out.translation.x)).toBe(true);
  });

  it('偏移随时间变化(非恒定)', () => {
    const s = new PerlinShake(42);
    s.setTrauma(1);
    s.update(0.1);
    const o1 = s.getOffset();
    s.update(0.5);
    const o2 = s.getOffset();
    // 时间推进后偏移应变化
    const diff =
      Math.abs(o1.translation.x - o2.translation.x) +
      Math.abs(o1.translation.y - o2.translation.y);
    expect(diff).toBeGreaterThan(1e-4);
  });

  it('trauma 衰减时偏移幅度递减', () => {
    const s = new PerlinShake(42);
    s.decay = 1.0;
    s.maxOffset = 1.0;
    s.setTrauma(1);
    s.update(0.001); // 几乎不衰减
    const o1 = s.getOffset();
    s.update(0.9); // 大幅衰减
    const o2 = s.getOffset();
    // trauma 衰减后,虽然噪声本身波动,但「最大可能幅度」递减
    // 这里验证 amount 单调递减(trauma² 模型)
    expect(o2.amount).toBeLessThan(o1.amount);
    // 同时验证偏移向量的模长上限递减:maxOffset * amount
    const mag1 = Math.hypot(o1.translation.x, o1.translation.y, o1.translation.z);
    const mag2 = Math.hypot(o2.translation.x, o2.translation.y, o2.translation.z);
    expect(mag2).toBeLessThanOrEqual(s.maxOffset * o2.amount + 1e-6);
    expect(mag1).toBeLessThanOrEqual(s.maxOffset * o1.amount + 1e-6);
  });

  // ── 序列化 ───────────────────────────────────────────────────────────

  it('export/import JSON 往返保持配置', () => {
    const s = new PerlinShake(42);
    s.maxOffset = 0.3;
    s.maxAngle = 0.07;
    s.frequency = 2.5;
    s.decay = 1.8;
    s.octaves = 4;
    s.persistence = 0.6;
    s.lacunarity = 2.5;
    s.setTrauma(0.6);
    const json = s.exportJSON();

    const s2 = new PerlinShake();
    s2.importJSON(json);
    expect(s2.maxOffset).toBe(0.3);
    expect(s2.maxAngle).toBe(0.07);
    expect(s2.frequency).toBe(2.5);
    expect(s2.decay).toBe(1.8);
    expect(s2.octaves).toBe(4);
    expect(s2.persistence).toBe(0.6);
    expect(s2.lacunarity).toBe(2.5);
    expect(s2.seed).toBe(42);
    expect(s2.trauma).toBeCloseTo(0.6, 5);
  });

  // ── 预设 ─────────────────────────────────────────────────────────────

  it('handheld 预设:小幅、慢衰减', () => {
    const s = PerlinShakePresets.handheld();
    expect(s.maxOffset).toBeLessThan(0.1);
    expect(s.decay).toBeLessThan(1.0);
    expect(s.octaves).toBe(2);
    expect(s.trauma).toBe(1.0); // 持续生效
  });

  it('recoil 预设:小角度、高频、快衰减', () => {
    const s = PerlinShakePresets.recoil();
    expect(s.maxOffset).toBeLessThan(0.05);
    expect(s.frequency).toBeGreaterThan(5);
    expect(s.decay).toBeGreaterThan(2);
  });

  it('explosion 预设:大幅、中频、多倍频', () => {
    const s = PerlinShakePresets.explosion();
    expect(s.maxOffset).toBeGreaterThan(0.2);
    expect(s.maxAngle).toBeGreaterThan(0.05);
    expect(s.octaves).toBeGreaterThanOrEqual(3);
  });

  it('impact 预设:中幅、中频', () => {
    const s = PerlinShakePresets.impact();
    expect(s.maxOffset).toBeGreaterThan(0.1);
    expect(s.maxAngle).toBeGreaterThan(0.03);
  });

  it('earthquake 预设:低频、慢衰减', () => {
    const s = PerlinShakePresets.earthquake();
    expect(s.frequency).toBeLessThan(1.0);
    expect(s.decay).toBeLessThan(0.5);
  });

  it('所有预设产生的实例可用', () => {
    const presets = [
      PerlinShakePresets.handheld(),
      PerlinShakePresets.recoil(),
      PerlinShakePresets.explosion(),
      PerlinShakePresets.impact(),
      PerlinShakePresets.earthquake(),
    ];
    for (const s of presets) {
      s.update(0.016);
      const offset = s.getOffset();
      // 调用方应得到有限数值
      expect(Number.isFinite(offset.translation.x)).toBe(true);
      expect(Number.isFinite(offset.amount)).toBe(true);
    }
  });
});
