// SnapSystem 单元测试。
// 覆盖:snapPosition/snapRotation/snapScale/开关/setters/toggles。

import { describe, it, expect } from 'vitest';
import { SnapSystem } from './SnapSystem';
import { Vector3 } from '../Math/Vector3';

describe('SnapSystem', () => {
  it('constructs with sensible defaults', () => {
    const s = new SnapSystem();
    expect(s.gridSnap).toBe(false);
    expect(s.gridSize).toBe(0.25);
    expect(s.angleSnap).toBe(false);
    expect(s.angleStep).toBeCloseTo(Math.PI / 12, 6);
    expect(s.scaleSnap).toBe(false);
    expect(s.scaleStep).toBe(0.25);
  });

  it('snapPosition returns clone when gridSnap disabled', () => {
    const s = new SnapSystem();
    const pos = new Vector3(1.1, 2.2, 3.3);
    const snapped = s.snapPosition(pos);
    // 不启用吸附:返回原值
    expect(snapped.equals(pos)).toBe(true);
    // 返回新实例,不修改原值
    expect(snapped).not.toBe(pos);
  });

  it('snapPosition rounds to gridSize multiples', () => {
    const s = new SnapSystem();
    s.gridSnap = true;
    s.gridSize = 0.5;
    const pos = new Vector3(1.1, 2.3, -0.7);
    const snapped = s.snapPosition(pos);
    // 1.1 / 0.5 = 2.2 → round=2 → 1.0
    // 2.3 / 0.5 = 4.6 → round=5 → 2.5
    // -0.7 / 0.5 = -1.4 → round=-1 → -0.5
    expect(snapped.x).toBeCloseTo(1.0, 6);
    expect(snapped.y).toBeCloseTo(2.5, 6);
    expect(snapped.z).toBeCloseTo(-0.5, 6);
  });

  it('snapPosition does not mutate input', () => {
    const s = new SnapSystem();
    s.gridSnap = true;
    s.gridSize = 1;
    const pos = new Vector3(1.5, 2.5, 3.5);
    s.snapPosition(pos);
    expect(pos.x).toBe(1.5);
    expect(pos.y).toBe(2.5);
    expect(pos.z).toBe(3.5);
  });

  it('snapPosition handles negative values correctly (round, not floor)', () => {
    const s = new SnapSystem();
    s.gridSnap = true;
    s.gridSize = 1;
    // -1.5 在 JS Math.round 中四舍五入到 -1(实际上是 -1,因为 Math.round(-1.5) = -1)
    // 但更典型的场景:-1.4 → -1,-1.6 → -2
    const pos = new Vector3(-1.4, -1.6, 0.4);
    const snapped = s.snapPosition(pos);
    expect(snapped.x).toBe(-1);
    expect(snapped.y).toBe(-2);
    expect(snapped.z).toBe(0);
  });

  it('snapRotation returns clone when angleSnap disabled', () => {
    const s = new SnapSystem();
    const rot = new Vector3(0.1, 0.2, 0.3);
    const snapped = s.snapRotation(rot);
    expect(snapped.equals(rot)).toBe(true);
    expect(snapped).not.toBe(rot);
  });

  it('snapRotation rounds to angleStep multiples', () => {
    const s = new SnapSystem();
    s.angleSnap = true;
    s.angleStep = Math.PI / 2; // 90°
    const rot = new Vector3(0.4, 1.6, 3.2);
    const snapped = s.snapRotation(rot);
    // 0.4 / (π/2) ≈ 0.255 → round=0 → 0
    // 1.6 / (π/2) ≈ 1.019 → round=1 → π/2
    // 3.2 / (π/2) ≈ 2.037 → round=2 → π
    expect(snapped.x).toBeCloseTo(0, 6);
    expect(snapped.y).toBeCloseTo(Math.PI / 2, 6);
    expect(snapped.z).toBeCloseTo(Math.PI, 6);
  });

  it('snapScale returns clone when scaleSnap disabled', () => {
    const s = new SnapSystem();
    const scl = new Vector3(1.1, 2.2, 3.3);
    const snapped = s.snapScale(scl);
    expect(snapped.equals(scl)).toBe(true);
    expect(snapped).not.toBe(scl);
  });

  it('snapScale rounds to scaleStep multiples', () => {
    const s = new SnapSystem();
    s.scaleSnap = true;
    s.scaleStep = 0.5;
    const scl = new Vector3(0.3, 1.2, 2.7);
    const snapped = s.snapScale(scl);
    // 0.3 / 0.5 = 0.6 → round=1 → 0.5
    // 1.2 / 0.5 = 2.4 → round=2 → 1.0
    // 2.7 / 0.5 = 5.4 → round=5 → 2.5
    expect(snapped.x).toBeCloseTo(0.5, 6);
    expect(snapped.y).toBeCloseTo(1.0, 6);
    expect(snapped.z).toBeCloseTo(2.5, 6);
  });

  it('setGridSize updates gridSize', () => {
    const s = new SnapSystem();
    s.setGridSize(2);
    expect(s.gridSize).toBe(2);
  });

  it('setGridSize ignores non-positive values', () => {
    const s = new SnapSystem();
    const original = s.gridSize;
    s.setGridSize(0);
    expect(s.gridSize).toBe(original);
    s.setGridSize(-1);
    expect(s.gridSize).toBe(original);
  });

  it('setAngleStep updates angleStep', () => {
    const s = new SnapSystem();
    s.setAngleStep(Math.PI / 4);
    expect(s.angleStep).toBeCloseTo(Math.PI / 4, 6);
  });

  it('setAngleStep ignores non-positive values', () => {
    const s = new SnapSystem();
    const original = s.angleStep;
    s.setAngleStep(0);
    expect(s.angleStep).toBe(original);
    s.setAngleStep(-1);
    expect(s.angleStep).toBe(original);
  });

  it('setScaleStep updates scaleStep', () => {
    const s = new SnapSystem();
    s.setScaleStep(0.5);
    expect(s.scaleStep).toBe(0.5);
  });

  it('setScaleStep ignores non-positive values', () => {
    const s = new SnapSystem();
    const original = s.scaleStep;
    s.setScaleStep(0);
    expect(s.scaleStep).toBe(original);
  });

  it('toggleGridSnap flips state and returns new state', () => {
    const s = new SnapSystem();
    expect(s.gridSnap).toBe(false);
    expect(s.toggleGridSnap()).toBe(true);
    expect(s.gridSnap).toBe(true);
    expect(s.toggleGridSnap()).toBe(false);
    expect(s.gridSnap).toBe(false);
  });

  it('toggleAngleSnap flips state', () => {
    const s = new SnapSystem();
    expect(s.angleSnap).toBe(false);
    s.toggleAngleSnap();
    expect(s.angleSnap).toBe(true);
  });

  it('toggleScaleSnap flips state', () => {
    const s = new SnapSystem();
    expect(s.scaleSnap).toBe(false);
    s.toggleScaleSnap();
    expect(s.scaleSnap).toBe(true);
  });

  it('three snap systems are independent (no shared state)', () => {
    const s1 = new SnapSystem();
    const s2 = new SnapSystem();
    s1.gridSnap = true;
    s1.gridSize = 1;
    s2.gridSnap = false;
    const pos = new Vector3(1.5, 1.5, 1.5);
    expect(s1.snapPosition(pos).x).toBe(2);
    expect(s2.snapPosition(pos).x).toBe(1.5);
  });
});
