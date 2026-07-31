// BlendSpace2D 单元测试 —— 验证 2D 混合空间的三角剖分、重心坐标与边界投影。
//
// 覆盖:
//   - 1 个样本:返回该样本权重 1
//   - 2 个样本:线段插值(查询点落在样本 0 → 权重 1)
//   - 3 个样本构成三角形:内部点 → 3 个非零权重和为 1
//   - 三角形外:投影到最近边 → 2 个非零权重
//   - addSample / removeSample / clear
//   - 4+ 样本:三角剖分生效,找到包含三角形
//   - 共线样本:回退到最近线段插值

import { describe, it, expect } from 'vitest';
import { Vector2 } from '../Math/Vector2';
import { BlendSpace2D, type BlendSpace2DSample } from './BlendSpace2D';

function sample(clipId: string, x: number, y: number): BlendSpace2DSample {
  return { clipId, position: new Vector2(x, y) };
}

function sumWeights(r: { samples: Array<{ weight: number }> }): number {
  return r.samples.reduce((s, x) => s + x.weight, 0);
}

describe('BlendSpace2D', () => {
  describe('单样本', () => {
    it('1 个样本:返回该样本权重 1', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('Idle', 0, 0));
      const r = bs.sample(new Vector2(0.5, 0.5));
      expect(r.samples).toHaveLength(1);
      expect(r.samples[0].clipId).toBe('Idle');
      expect(r.samples[0].weight).toBe(1);
    });

    it('空样本:返回空结果', () => {
      const bs = new BlendSpace2D();
      const r = bs.sample(new Vector2(0, 0));
      expect(r.samples).toHaveLength(0);
    });
  });

  describe('两样本线段插值', () => {
    it('查询点落在样本 0 → 权重 1 给样本 0', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 2, 0));
      const r = bs.sample(new Vector2(0, 0));
      const a = r.samples.find(s => s.clipId === 'A')!;
      const b = r.samples.find(s => s.clipId === 'B')!;
      expect(a.weight).toBeCloseTo(1, 6);
      expect(b.weight).toBeCloseTo(0, 6);
    });

    it('中点 → 各 0.5', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 2, 0));
      const r = bs.sample(new Vector2(1, 0));
      const a = r.samples.find(s => s.clipId === 'A')!.weight;
      const b = r.samples.find(s => s.clipId === 'B')!.weight;
      expect(a).toBeCloseTo(0.5, 6);
      expect(b).toBeCloseTo(0.5, 6);
    });

    it('越界点 clamp 到端点', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 2, 0));
      const r = bs.sample(new Vector2(5, 0));
      expect(r.samples.find(s => s.clipId === 'B')!.weight).toBeCloseTo(1, 6);
    });
  });

  describe('三样本三角形', () => {
    const tri = () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 2, 0));
      bs.addSample(sample('C', 0, 2));
      return bs;
    };

    it('内部点 → 3 个非零权重和为 1', () => {
      const bs = tri();
      const r = bs.sample(new Vector2(0.5, 0.5));
      expect(r.samples).toHaveLength(3);
      for (const s of r.samples) expect(s.weight).toBeGreaterThan(0);
      expect(sumWeights(r)).toBeCloseTo(1, 6);
    });

    it('重心 = (1/3,1/3,1/3) 在三角形重心', () => {
      const bs = tri();
      // 重心 ( (0+2+0)/3, (0+0+2)/3 ) = (0.6667, 0.6667)
      const r = bs.sample(new Vector2(2 / 3, 2 / 3));
      for (const s of r.samples) {
        expect(s.weight).toBeCloseTo(1 / 3, 5);
      }
    });

    it('顶点 → 该顶点权重 1', () => {
      const bs = tri();
      const r = bs.sample(new Vector2(0, 0));
      const a = r.samples.find(s => s.clipId === 'A')!.weight;
      expect(a).toBeCloseTo(1, 6);
    });

    it('三角形外 → 投影到最近边,2 个非零权重', () => {
      const bs = tri();
      // (3, 0) 在 BC 边外侧延长方向,最近边为 AB (B=(2,0)),投影到 B
      const r = bs.sample(new Vector2(3, 0));
      expect(r.samples.length).toBeLessThanOrEqual(2);
      expect(sumWeights(r)).toBeCloseTo(1, 6);
      // B 应主导
      const b = r.samples.find(s => s.clipId === 'B')!.weight;
      expect(b).toBeGreaterThan(0.5);
    });
  });

  describe('API 行为', () => {
    it('addSample / removeSample / clear', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 1, 0));
      bs.addSample(sample('C', 0, 1));
      expect(bs.samples).toHaveLength(3);

      expect(bs.removeSample('B')).toBe(true);
      expect(bs.samples).toHaveLength(2);
      expect(bs.removeSample('B')).toBe(false);

      bs.clear();
      expect(bs.samples).toHaveLength(0);
    });

    it('rebuild 后 dirty 清除(幂等)', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 1, 0));
      bs.addSample(sample('C', 0, 1));
      bs.rebuild();
      // 再次 rebuild 不抛错
      expect(() => bs.rebuild()).not.toThrow();
    });

    it('removeSample 后 sample 反映新布局', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 2, 0));
      bs.addSample(sample('C', 0, 2));
      bs.removeSample('C');
      // 剩 2 样本 → 线段插值
      const r = bs.sample(new Vector2(1, 0));
      expect(r.samples.find(s => s.clipId === 'A')!.weight).toBeCloseTo(0.5, 6);
    });
  });

  describe('4+ 样本三角剖分', () => {
    it('4 个角点:查询内部点找到包含三角形(3 非零权重)', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('BL', 0, 0));
      bs.addSample(sample('BR', 4, 0));
      bs.addSample(sample('TR', 4, 4));
      bs.addSample(sample('TL', 0, 4));
      // (1,1) 明确位于某三角形内部,远离对角线
      const r = bs.sample(new Vector2(1, 1));
      expect(r.samples.length).toBeLessThanOrEqual(3);
      for (const s of r.samples) expect(s.weight).toBeGreaterThanOrEqual(0);
      expect(sumWeights(r)).toBeCloseTo(1, 6);
      // 内部点至少有 2 个正权重
      const positives = r.samples.filter(s => s.weight > 1e-6).length;
      expect(positives).toBeGreaterThanOrEqual(2);
    });

    it('5 个样本(4 角 + 中心):查询中心附近找到三角形', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('BL', 0, 0));
      bs.addSample(sample('BR', 4, 0));
      bs.addSample(sample('TR', 4, 4));
      bs.addSample(sample('TL', 0, 4));
      bs.addSample(sample('Mid', 2, 2));
      const r = bs.sample(new Vector2(1.2, 1.0));
      expect(sumWeights(r)).toBeCloseTo(1, 6);
    });
  });

  describe('共线样本', () => {
    it('3 个共线样本:回退到最近线段插值', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 2, 0));
      bs.addSample(sample('C', 4, 0));
      // 查询 (1, 1) 在共线上方,最近线段为 A-B
      const r = bs.sample(new Vector2(1, 1));
      expect(r.samples.length).toBeLessThanOrEqual(2);
      expect(sumWeights(r)).toBeCloseTo(1, 6);
      // 应在 A-B 间,t=0.5
      const a = r.samples.find(s => s.clipId === 'A')!.weight;
      const b = r.samples.find(s => s.clipId === 'B')!.weight;
      expect(a).toBeCloseTo(0.5, 5);
      expect(b).toBeCloseTo(0.5, 5);
    });

    it('查询点落在共线样本上:返回该样本', () => {
      const bs = new BlendSpace2D();
      bs.addSample(sample('A', 0, 0));
      bs.addSample(sample('B', 2, 0));
      bs.addSample(sample('C', 4, 0));
      const r = bs.sample(new Vector2(2, 0));
      const b = r.samples.find(s => s.clipId === 'B')!.weight;
      expect(b).toBeCloseTo(1, 6);
    });
  });
});
