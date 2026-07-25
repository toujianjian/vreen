// ReflectionProbeManager 单元测试。
//
// 覆盖:
//   1. 构造默认值与 maxProbes 选项
//   2. addProbe / removeProbe
//   3. addProbe 重复添加返回 false
//   4. addProbe 超出 maxProbes 抛错
//   5. getProbeAt 空列表返回 null
//   6. getProbeAt contains 命中
//   7. getProbeAt 多探针 contains 时按 priority 选
//   8. getProbeAt 无 contains 时退回最近
//   9. getInfluence 空列表 0
//   10. getInfluence contains 时 1
//   11. getInfluence 越界时线性衰减
//   12. getInfluence 远距离时 0
//   13. update 调用所有 probe 的 capture
//   14. dispose 清空 probes 列表

import { describe, it, expect, vi } from 'vitest';
import { ReflectionProbeManager } from './ReflectionProbeManager';
import { ReflectionProbe } from './ReflectionProbe';
import { Scene } from '../Core/Scene';
import { Vector3 } from '../Math/Vector3';

// ── 构造 ────────────────────────────────────────────────────────────

describe('ReflectionProbeManager construction', () => {
  it('defaults: maxProbes=8, probes empty', () => {
    const m = new ReflectionProbeManager();
    expect(m.maxProbes).toBe(8);
    expect(m.probes).toHaveLength(0);
  });

  it('accepts maxProbes option', () => {
    const m = new ReflectionProbeManager({ maxProbes: 4 });
    expect(m.maxProbes).toBe(4);
  });
});

// ── addProbe / removeProbe ──────────────────────────────────────────

describe('ReflectionProbeManager addProbe / removeProbe', () => {
  it('addProbe adds to list and returns true', () => {
    const m = new ReflectionProbeManager();
    const p = new ReflectionProbe();
    expect(m.addProbe(p)).toBe(true);
    expect(m.probes).toHaveLength(1);
    expect(m.probes[0]).toBe(p);
  });

  it('addProbe same instance twice returns false (no duplicate)', () => {
    const m = new ReflectionProbeManager();
    const p = new ReflectionProbe();
    m.addProbe(p);
    expect(m.addProbe(p)).toBe(false);
    expect(m.probes).toHaveLength(1);
  });

  it('addProbe throws when maxProbes exceeded', () => {
    const m = new ReflectionProbeManager({ maxProbes: 2 });
    m.addProbe(new ReflectionProbe());
    m.addProbe(new ReflectionProbe());
    expect(() => m.addProbe(new ReflectionProbe())).toThrow(/maxProbes/);
  });

  it('removeProbe removes and returns true', () => {
    const m = new ReflectionProbeManager();
    const p = new ReflectionProbe();
    m.addProbe(p);
    expect(m.removeProbe(p)).toBe(true);
    expect(m.probes).toHaveLength(0);
  });

  it('removeProbe unknown probe returns false', () => {
    const m = new ReflectionProbeManager();
    expect(m.removeProbe(new ReflectionProbe())).toBe(false);
  });
});

// ── getProbeAt ──────────────────────────────────────────────────────

describe('ReflectionProbeManager.getProbeAt', () => {
  it('returns null for empty manager', () => {
    const m = new ReflectionProbeManager();
    expect(m.getProbeAt(new Vector3(0, 0, 0))).toBeNull();
  });

  it('returns the only probe when point is inside its box', () => {
    const m = new ReflectionProbeManager();
    const p = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
    });
    m.addProbe(p);
    expect(m.getProbeAt(new Vector3(0, 0, 0))).toBe(p);
    expect(m.getProbeAt(new Vector3(5, 5, 5))).toBe(p);
  });

  it('returns higher-priority probe when multiple contains the point', () => {
    const m = new ReflectionProbeManager();
    const low = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
      priority: 1,
    });
    const high = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
      priority: 5,
    });
    m.addProbe(low);
    m.addProbe(high);
    expect(m.getProbeAt(new Vector3(0, 0, 0))).toBe(high);
  });

  it('falls back to nearest probe when no contains hits', () => {
    const m = new ReflectionProbeManager();
    const far = new ReflectionProbe({
      position: new Vector3(100, 0, 0),
      boxSize: new Vector3(1, 1, 1),
    });
    const near = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(1, 1, 1),
    });
    m.addProbe(far);
    m.addProbe(near);
    // 点 (0, 0, 0) 不在任何探针内,但更接近 near
    expect(m.getProbeAt(new Vector3(0, 0, 0))).toBe(near);
  });
});

// ── getInfluence ────────────────────────────────────────────────────

describe('ReflectionProbeManager.getInfluence', () => {
  it('returns 0 for empty manager', () => {
    const m = new ReflectionProbeManager();
    expect(m.getInfluence(new Vector3(0, 0, 0))).toBe(0);
  });

  it('returns 1 when point is inside probe box', () => {
    const m = new ReflectionProbeManager();
    const p = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
    });
    m.addProbe(p);
    expect(m.getInfluence(new Vector3(0, 0, 0))).toBe(1);
    expect(m.getInfluence(new Vector3(9, 9, 9))).toBe(1);
  });

  it('returns 0 when point is far outside (>= 2x boxSize)', () => {
    const m = new ReflectionProbeManager();
    const p = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
    });
    m.addProbe(p);
    // 距离 box 中心 = 25,boxSize = 10,归一化距离 = 25/10 = 2.5(>2 → 0)
    expect(m.getInfluence(new Vector3(25, 0, 0))).toBe(0);
  });

  it('returns linearly decaying weight between 1x and 2x boxSize', () => {
    const m = new ReflectionProbeManager();
    const p = new ReflectionProbe({
      position: new Vector3(0, 0, 0),
      boxSize: new Vector3(10, 10, 10),
    });
    m.addProbe(p);
    // 归一化距离 = 15/10 = 1.5 → 1 - (1.5 - 1) = 0.5
    expect(m.getInfluence(new Vector3(15, 0, 0))).toBeCloseTo(0.5);
    // 归一化距离 = 12/10 = 1.2 → 1 - 0.2 = 0.8
    expect(m.getInfluence(new Vector3(12, 0, 0))).toBeCloseTo(0.8);
  });
});

// ── update ──────────────────────────────────────────────────────────

describe('ReflectionProbeManager.update', () => {
  it('calls capture() on each probe', () => {
    const gl = {} as WebGL2RenderingContext;
    const renderer = {
      canvas: { width: 256, height: 256 },
      render: () => {},
      resize: () => {},
      dispose: () => {},
      stats: { drawCalls: 0, triangles: 0, shadowPasses: 0, programs: 0, drawCallBreakdown: {} },
    } as never;
    const scene = new Scene();
    const m = new ReflectionProbeManager();
    const p1 = new ReflectionProbe({ resolution: 16 });
    const p2 = new ReflectionProbe({ resolution: 16 });
    const spy1 = vi.spyOn(p1, 'capture');
    const spy2 = vi.spyOn(p2, 'capture');
    m.addProbe(p1);
    m.addProbe(p2);
    m.update(gl, renderer, scene);
    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);
    expect(spy1).toHaveBeenCalledWith(gl, renderer, scene);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('ReflectionProbeManager.dispose', () => {
  it('calls dispose() on each probe and clears list', () => {
    const gl = {} as WebGL2RenderingContext;
    const m = new ReflectionProbeManager();
    const p1 = new ReflectionProbe();
    const p2 = new ReflectionProbe();
    const spy1 = vi.spyOn(p1, 'dispose');
    const spy2 = vi.spyOn(p2, 'dispose');
    m.addProbe(p1);
    m.addProbe(p2);
    m.dispose(gl);
    expect(spy1).toHaveBeenCalledWith(gl);
    expect(spy2).toHaveBeenCalledWith(gl);
    expect(m.probes).toHaveLength(0);
  });
});
