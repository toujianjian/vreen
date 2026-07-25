import { describe, it, expect } from 'vitest';
import { TreeGenerator } from './TreeGenerator';

describe('TreeGenerator', () => {
  describe('generate — 基础参数', () => {
    it('生成 3 层树,几何体非空', () => {
      const t = TreeGenerator.generate(42, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 3, leafSize: 0.6,
      });
      expect(t.geometry.attributes.position).toBeDefined();
      const pos = t.geometry.attributes.position.array;
      expect(pos.length).toBeGreaterThan(0);
    });

    it('branches 包含主干(level 0)', () => {
      const t = TreeGenerator.generate(42, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 2, leafSize: 0.6,
      });
      expect(t.branches.length).toBeGreaterThan(0);
      expect(t.branches[0].level).toBe(0);
      expect(t.branches[0].startY).toBe(0);
      expect(t.branches[0].endY).toBeCloseTo(4, 5);
    });

    it('非正参数抛错', () => {
      expect(() => TreeGenerator.generate(0, {
        trunkHeight: 0, trunkRadius: 0.3, branchLevels: 3, leafSize: 0.6,
      })).toThrow();
      expect(() => TreeGenerator.generate(0, {
        trunkHeight: 4, trunkRadius: 0, branchLevels: 3, leafSize: 0.6,
      })).toThrow();
      expect(() => TreeGenerator.generate(0, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 0, leafSize: 0.6,
      })).toThrow();
    });

    it('同种子确定性', () => {
      const a = TreeGenerator.generate(42, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 3, leafSize: 0.6,
      });
      const b = TreeGenerator.generate(42, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 3, leafSize: 0.6,
      });
      expect(a.branches.length).toBe(b.branches.length);
      for (let i = 0; i < a.branches.length; i++) {
        expect(a.branches[i]).toEqual(b.branches[i]);
      }
      // 几何体顶点相等
      const pa = a.geometry.attributes.position.array;
      const pb = b.geometry.attributes.position.array;
      expect(pa.length).toBe(pb.length);
      for (let i = 0; i < pa.length; i++) {
        expect(pa[i]).toBeCloseTo(pb[i], 7);
      }
    });

    it('不同种子产生不同分支', () => {
      const a = TreeGenerator.generate(1, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 3, leafSize: 0.6,
      });
      const b = TreeGenerator.generate(2, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 3, leafSize: 0.6,
      });
      let diff = 0;
      const max = Math.min(a.branches.length, b.branches.length);
      for (let i = 0; i < max; i++) {
        const ba = a.branches[i], bb = b.branches[i];
        if (Math.abs(ba.endX - bb.endX) > 1e-6 ||
            Math.abs(ba.endY - bb.endY) > 1e-6 ||
            Math.abs(ba.endZ - bb.endZ) > 1e-6) {
          diff++;
        }
      }
      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('generateBranches', () => {
    it('branchLevels=3 时,最大 level = 3', () => {
      const rng = (() => {
        let s = 42 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const trunk = {
        startX: 0, startY: 0, startZ: 0,
        endX: 0, endY: 4, endZ: 0,
        startRadius: 0.3, endRadius: 0.2, level: 0,
      };
      const out: any[] = [];
      TreeGenerator.generateBranches(0, trunk, {
        branchLevels: 3, branchCount: 3,
        branchLengthDecay: 0.7, branchRadiusDecay: 0.65,
        rng, out,
      });
      const maxLevel = out.reduce((m, b) => Math.max(m, b.level), 0);
      expect(maxLevel).toBe(3);
    });

    it('branchCount=2 时,每父分支产生 2 子分支', () => {
      const rng = (() => {
        let s = 7 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const trunk = {
        startX: 0, startY: 0, startZ: 0,
        endX: 0, endY: 4, endZ: 0,
        startRadius: 0.3, endRadius: 0.2, level: 0,
      };
      const out: any[] = [];
      TreeGenerator.generateBranches(0, trunk, {
        branchLevels: 1, branchCount: 2,
        branchLengthDecay: 0.7, branchRadiusDecay: 0.65,
        rng, out,
      });
      // level 1 的分支数 = 2
      const level1 = out.filter(b => b.level === 1);
      expect(level1.length).toBe(2);
    });

    it('子分支起点 = 父分支终点', () => {
      const rng = (() => {
        let s = 9 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const trunk = {
        startX: 0, startY: 0, startZ: 0,
        endX: 0, endY: 4, endZ: 0,
        startRadius: 0.3, endRadius: 0.2, level: 0,
      };
      const out: any[] = [];
      TreeGenerator.generateBranches(0, trunk, {
        branchLevels: 1, branchCount: 3,
        branchLengthDecay: 0.7, branchRadiusDecay: 0.65,
        rng, out,
      });
      for (const b of out) {
        expect(b.startX).toBeCloseTo(0, 5);
        expect(b.startY).toBeCloseTo(4, 5);
        expect(b.startZ).toBeCloseTo(0, 5);
      }
    });
  });

  describe('generateLeaves', () => {
    it('叶子的数量 = 末端分支数 × leafCount', () => {
      const rng = (() => {
        let s = 42 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const branches = [
        { startX: 0, startY: 0, startZ: 0, endX: 1, endY: 5, endZ: 0, startRadius: 0.1, endRadius: 0.05, level: 2 },
        { startX: 0, startY: 0, startZ: 0, endX: -1, endY: 5, endZ: 0, startRadius: 0.1, endRadius: 0.05, level: 2 },
      ];
      const g = TreeGenerator.generateLeaves(branches, { leafSize: 0.5, leafCount: 3, rng });
      // 2 末端 × 3 叶 × 4 顶点 = 24
      expect(g.attributes.position.array.length / 3).toBe(24);
    });

    it('叶子法线全部为 (0,0,1)', () => {
      const rng = (() => {
        let s = 1 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const branches = [
        { startX: 0, startY: 0, startZ: 0, endX: 1, endY: 5, endZ: 0, startRadius: 0.1, endRadius: 0.05, level: 1 },
      ];
      const g = TreeGenerator.generateLeaves(branches, { leafSize: 0.5, leafCount: 1, rng });
      const n = g.attributes.normal.array;
      for (let i = 0; i < n.length; i += 3) {
        expect(n[i]).toBe(0);
        expect(n[i + 1]).toBe(0);
        expect(n[i + 2]).toBe(1);
      }
    });
  });

  describe('几何体完整性', () => {
    it('合并几何体含 position/normal/uv', () => {
      const t = TreeGenerator.generate(42, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 2, leafSize: 0.6,
      });
      expect(t.geometry.attributes.position).toBeDefined();
      expect(t.geometry.attributes.normal).toBeDefined();
      expect(t.geometry.attributes.uv).toBeDefined();
    });

    it('包围盒已计算', () => {
      const t = TreeGenerator.generate(42, {
        trunkHeight: 4, trunkRadius: 0.3, branchLevels: 2, leafSize: 0.6,
      });
      expect(t.geometry.boundingBox).not.toBeNull();
      const bb = t.geometry.boundingBox!;
      // 主干高度 4,分支可能向上延伸,所以 max.y ≥ 4
      expect(bb.max.y).toBeGreaterThanOrEqual(4);
      // min.y ≤ 0(主干从 y=0 开始)
      expect(bb.min.y).toBeLessThanOrEqual(0);
    });
  });
});
