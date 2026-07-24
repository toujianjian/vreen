import { describe, it, expect } from 'vitest';
import { ParticleData } from './ParticleData';
import { TrailModule } from './TrailModule';

describe('TrailModule', () => {
  it('constructs with default values', () => {
    const t = new TrailModule();
    expect(t.length).toBe(8);
    expect(t.width).toBe(0.1);
    expect(t.colorMode).toBe('fade');
    expect(t.trailCount).toBe(0);
  });

  it('accepts custom config', () => {
    const t = new TrailModule(5, 0.3, 'constant');
    expect(t.length).toBe(5);
    expect(t.width).toBe(0.3);
    expect(t.colorMode).toBe('constant');
  });

  it('records position history for alive particles', () => {
    const t = new TrailModule(3);
    const p = new ParticleData();
    p.alive = true;

    p.position.set(0, 0, 0);
    t.update([p], 0.1);

    p.position.set(1, 0, 0);
    t.update([p], 0.1);

    p.position.set(2, 0, 0);
    t.update([p], 0.1);

    const data = t.getTrailData();
    expect(data.trailCount).toBe(1);
    expect(data.counts[0]).toBe(3);
    // 第一个点应该是 (0,0,0)
    expect(data.positions[0]).toBe(0);
    expect(data.positions[1]).toBe(0);
    expect(data.positions[2]).toBe(0);
    // 最后一个点应该是 (2,0,0)
    expect(data.positions[6]).toBe(2);
  });

  it('caps history at length', () => {
    const t = new TrailModule(2);
    const p = new ParticleData();
    p.alive = true;

    p.position.set(0, 0, 0);
    t.update([p], 0.1);
    p.position.set(1, 0, 0);
    t.update([p], 0.1);
    p.position.set(2, 0, 0);
    t.update([p], 0.1);
    p.position.set(3, 0, 0);
    t.update([p], 0.1);

    const data = t.getTrailData();
    expect(data.counts[0]).toBe(2); // capped at length=2
    // 应该只保留最近 2 个点: (2,0,0) 和 (3,0,0)
    expect(data.positions[0]).toBe(2);
    expect(data.positions[3]).toBe(3);
  });

  it('cleans up history for dead particles', () => {
    const t = new TrailModule(5);
    const p = new ParticleData();
    p.alive = true;

    p.position.set(0, 0, 0);
    t.update([p], 0.1);
    p.position.set(1, 0, 0);
    t.update([p], 0.1);

    expect(t.trailCount).toBe(1);

    p.alive = false;
    t.update([p], 0.1);

    expect(t.trailCount).toBe(0);
  });

  it('cleans up entries for particles no longer in the list', () => {
    const t = new TrailModule(5);
    const p = new ParticleData();
    p.alive = true;

    p.position.set(0, 0, 0);
    t.update([p], 0.1);

    expect(t.trailCount).toBe(1);

    // 空列表更新应清理已不存在的粒子
    t.update([], 0.1);
    expect(t.trailCount).toBe(0);
  });

  it('fade color mode attenuates alpha along trail', () => {
    const t = new TrailModule(3, 0.1, 'fade');
    const p = new ParticleData();
    p.alive = true;
    p.color.setRGB(1, 1, 1);

    p.position.set(0, 0, 0);
    t.update([p], 0.1);
    p.position.set(1, 0, 0);
    t.update([p], 0.1);
    p.position.set(2, 0, 0);
    t.update([p], 0.1);

    const data = t.getTrailData();
    // 第一个点 (i=0): fade=0/(3-1)=0
    expect(data.colors[0]).toBe(0);
    // 最后一个点 (i=2): fade=2/2=1
    expect(data.colors[6]).toBe(1);
  });

  it('constant color mode keeps same color along trail', () => {
    const t = new TrailModule(3, 0.1, 'constant');
    const p = new ParticleData();
    p.alive = true;
    p.color.setRGB(0.5, 0.5, 0.5);

    p.position.set(0, 0, 0);
    t.update([p], 0.1);
    p.position.set(1, 0, 0);
    t.update([p], 0.1);
    p.position.set(2, 0, 0);
    t.update([p], 0.1);

    const data = t.getTrailData();
    expect(data.colors[0]).toBe(0.5);
    expect(data.colors[3]).toBe(0.5);
    expect(data.colors[6]).toBe(0.5);
  });

  it('skips trails with fewer than 2 points in getTrailData', () => {
    const t = new TrailModule(5);
    const p = new ParticleData();
    p.alive = true;
    // 仅一次更新,只有 1 个点
    t.update([p], 0.1);
    const data = t.getTrailData();
    expect(data.trailCount).toBe(0); // 跳过
  });

  it('handles multiple particles independently', () => {
    const t = new TrailModule(3);
    const p1 = new ParticleData();
    const p2 = new ParticleData();
    p1.alive = true;
    p2.alive = true;

    p1.position.set(0, 0, 0);
    p2.position.set(10, 0, 0);
    t.update([p1, p2], 0.1);

    p1.position.set(1, 0, 0);
    p2.position.set(11, 0, 0);
    t.update([p1, p2], 0.1);

    const data = t.getTrailData();
    expect(data.trailCount).toBe(2);
    expect(data.counts[0]).toBe(2);
    expect(data.counts[1]).toBe(2);
  });

  it('reset clears all histories', () => {
    const t = new TrailModule(5);
    const p = new ParticleData();
    p.alive = true;
    p.position.set(0, 0, 0);
    t.update([p], 0.1);
    expect(t.trailCount).toBe(1);

    t.reset();
    expect(t.trailCount).toBe(0);
  });
});
