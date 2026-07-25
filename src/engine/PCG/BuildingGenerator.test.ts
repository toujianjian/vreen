import { describe, it, expect } from 'vitest';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BuildingGenerator } from './BuildingGenerator';

/** 一个空 BufferGeometry,作为 generateWindows/Doors 的 wallMesh 参数占位。 */
const STUB_WALL = new BufferGeometry();

describe('BuildingGenerator', () => {
  describe('generate — 基础参数', () => {
    it('生成 4 层建筑,几何体非空', () => {
      const r = BuildingGenerator.generate({
        width: 8, depth: 6, floors: 4, floorHeight: 3,
      });
      expect(r.geometry.attributes.position).toBeDefined();
      const pos = r.geometry.attributes.position.array;
      expect(pos.length).toBeGreaterThan(0);
      // 4 层 × 4 面墙 × 4 顶点 = 64 顶点 + flat 屋顶 4 顶点 = 68
      expect(pos.length / 3).toBeGreaterThanOrEqual(68);
    });

    it('totalHeight = floors * floorHeight', () => {
      const r = BuildingGenerator.generate({
        width: 8, depth: 6, floors: 5, floorHeight: 3,
      });
      expect(r.totalHeight).toBe(15);
    });

    it('floorYs 长度 = floors', () => {
      const r = BuildingGenerator.generate({
        width: 8, depth: 6, floors: 3, floorHeight: 2.5,
      });
      expect(r.floorYs.length).toBe(3);
      expect(r.floorYs[0]).toBe(0);
      expect(r.floorYs[1]).toBe(2.5);
      expect(r.floorYs[2]).toBe(5);
    });

    it('非正参数抛错', () => {
      expect(() => BuildingGenerator.generate({ width: 0, depth: 6, floors: 4, floorHeight: 3 })).toThrow();
      expect(() => BuildingGenerator.generate({ width: 8, depth: -1, floors: 4, floorHeight: 3 })).toThrow();
      expect(() => BuildingGenerator.generate({ width: 8, depth: 6, floors: 0, floorHeight: 3 })).toThrow();
      expect(() => BuildingGenerator.generate({ width: 8, depth: 6, floors: 4, floorHeight: 0 })).toThrow();
    });
  });

  describe('generateFloor', () => {
    it('单层墙体 4 面 × 4 顶点 = 16 顶点', () => {
      const g = BuildingGenerator.generateFloor(0, { width: 8, depth: 6, floorHeight: 3 });
      const pos = g.attributes.position.array;
      expect(pos.length / 3).toBe(16);
      // 索引 = 4 面墙 × 2 三角形 × 3 = 24
      expect(g.index?.count).toBe(24);
    });

    it('floorIndex 控制 Y 偏移', () => {
      const g0 = BuildingGenerator.generateFloor(0, { width: 8, depth: 6, floorHeight: 3 });
      const g2 = BuildingGenerator.generateFloor(2, { width: 8, depth: 6, floorHeight: 3 });
      const p0 = g0.attributes.position.array;
      const p2 = g2.attributes.position.array;
      // 取第一个顶点的 Y 比较偏移
      expect(p2[1] - p0[1]).toBeCloseTo(6, 5); // 2 * 3 = 6
    });
  });

  describe('generateRoof', () => {
    it('flat 屋顶 = 4 顶点', () => {
      const g = BuildingGenerator.generateRoof('flat', { width: 8, depth: 6, baseY: 0 });
      expect(g.attributes.position.array.length / 3).toBe(4);
    });

    it('peaked 屋顶 = 4 三角形 × 3 顶点 = 12 顶点', () => {
      const g = BuildingGenerator.generateRoof('peaked', { width: 8, depth: 6, baseY: 0 });
      expect(g.attributes.position.array.length / 3).toBe(12);
    });

    it('gabled 屋顶包含斜面与山墙', () => {
      const g = BuildingGenerator.generateRoof('gabled', { width: 8, depth: 6, baseY: 0 });
      // 2 斜面 × 4 + 2 山墙 × 3 = 14 顶点
      expect(g.attributes.position.array.length / 3).toBe(14);
    });
  });

  describe('generateWindows', () => {
    it('窗户数量 = floors × 4 面墙 × windowsPerFloor', () => {
      // 提供伪 rng 避免随机性影响
      const rng = () => 0.5;
      const g = BuildingGenerator.generateWindows(STUB_WALL, {
        width: 8, depth: 6, floors: 3, floorHeight: 3, windowsPerFloor: 2, rng,
      });
      // 3 层 × 4 面 × 2 窗 × 4 顶点 = 96 顶点
      expect(g.attributes.position.array.length / 3).toBe(96);
    });

    it('窗户尺寸不超过墙尺寸', () => {
      const rng = () => 0.5;
      const g = BuildingGenerator.generateWindows(STUB_WALL, {
        width: 4, depth: 4, floors: 1, floorHeight: 3, windowsPerFloor: 1, rng,
      });
      const pos = g.attributes.position.array;
      // 计算每个窗户的宽高(4 顶点构成的矩形)
      // 顶点 0..3,矩形角点
      const ax = pos[0], ay = pos[1], az = pos[2];
      const bx = pos[3], by = pos[4], bz = pos[5];
      const w = Math.hypot(bx - ax, by - ay, bz - az);
      expect(w).toBeLessThan(4); // 不超过墙宽
    });
  });

  describe('generateDoors', () => {
    it('生成一扇门 = 4 顶点', () => {
      const rng = () => 0.5;
      const g = BuildingGenerator.generateDoors(STUB_WALL, {
        width: 8, depth: 6, floorHeight: 3, rng,
      });
      expect(g.attributes.position.array.length / 3).toBe(4);
      expect(g.index?.count).toBe(6);
    });

    it('门高度 ≤ floorHeight * 0.8', () => {
      const rng = () => 0.5;
      const g = BuildingGenerator.generateDoors(STUB_WALL, {
        width: 8, depth: 6, floorHeight: 3, rng,
      });
      const pos = g.attributes.position.array;
      // 顶点 0,1 在 y=0;顶点 2,3 在 y=doorH
      const doorH = pos[7]; // 第二个顶点对(y)
      expect(doorH).toBeLessThanOrEqual(3 * 0.8 + 1e-6);
    });
  });

  describe('屋顶类型传递', () => {
    it('roof=flat 时 result.roof === "flat"', () => {
      const r = BuildingGenerator.generate({
        width: 8, depth: 6, floors: 2, floorHeight: 3, roof: 'flat',
      });
      expect(r.roof).toBe('flat');
    });

    it('roof=gabled 时 result.roof === "gabled"', () => {
      const r = BuildingGenerator.generate({
        width: 8, depth: 6, floors: 2, floorHeight: 3, roof: 'gabled',
      });
      expect(r.roof).toBe('gabled');
    });

    it('默认 style="modern"', () => {
      const r = BuildingGenerator.generate({
        width: 8, depth: 6, floors: 2, floorHeight: 3,
      });
      expect(r.style).toBe('modern');
    });
  });

  describe('包围盒', () => {
    it('建筑几何体计算了 boundingBox', () => {
      const r = BuildingGenerator.generate({
        width: 8, depth: 6, floors: 2, floorHeight: 3,
      });
      expect(r.geometry.boundingBox).not.toBeNull();
      const bb = r.geometry.boundingBox!;
      // 宽度方向 -4..4
      expect(bb.max.x - bb.min.x).toBeCloseTo(8, 5);
      // 深度方向 -3..3
      expect(bb.max.z - bb.min.z).toBeCloseTo(6, 5);
      // 高度方向 0..6 (2*3)
      expect(bb.max.y - bb.min.y).toBeGreaterThanOrEqual(6);
    });
  });
});
