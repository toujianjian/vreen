// BuildingGenerator2 单元测试:链式配置 / 各部件生成 / 颜色 / 种子确定性 / 统计。

import { describe, it, expect } from 'vitest';
import { BuildingGenerator2, type RoofType2, type BuildingStyle2 } from './BuildingGenerator2';

describe('BuildingGenerator2', () => {
  describe('默认配置', () => {
    it('默认属性值', () => {
      const g = new BuildingGenerator2();
      expect(g.style).toBe('modern');
      expect(g.floors).toBe(5);
      expect(g.floorHeight).toBe(3);
      expect(g.width).toBe(8);
      expect(g.depth).toBe(6);
      expect(g.windowDensity).toBe(0.5);
      expect(g.windowSize).toEqual({ w: 1, h: 1.5 });
      expect(g.roofType).toBe('flat');
      expect(g.hasEntrance).toBe(true);
      expect(g.hasBalcony).toBe(false);
      expect(g.hasAirConditioning).toBe(false);
      expect(g.hasAntenna).toBe(false);
      expect(g.seed).toBe(0);
    });

    it('默认色板非零', () => {
      const g = new BuildingGenerator2();
      expect(g.facadeColor.r).toBeGreaterThan(0);
      expect(g.roofColor.r).toBeGreaterThanOrEqual(0);
      expect(g.windowColor.b).toBeGreaterThan(0);
    });
  });

  describe('链式 setter', () => {
    it('setStyle 更新风格与色板', () => {
      const g = new BuildingGenerator2().setStyle('sci-fi');
      expect(g.style).toBe('sci-fi');
      // sci-fi 立面色偏暗
      expect(g.facadeColor.r).toBeLessThan(0.5);
    });

    it('setFloors 钳制到 >=1', () => {
      const g = new BuildingGenerator2().setFloors(0);
      expect(g.floors).toBe(1);
    });

    it('setFloorHeight 钳制', () => {
      const g = new BuildingGenerator2().setFloorHeight(0);
      expect(g.floorHeight).toBeGreaterThan(0);
    });

    it('setDimensions 钳制', () => {
      const g = new BuildingGenerator2().setDimensions(-1, 0);
      expect(g.width).toBeGreaterThan(0);
      expect(g.depth).toBeGreaterThan(0);
    });

    it('setWindowConfig 钳制密度 0-1', () => {
      const g = new BuildingGenerator2().setWindowConfig(2, { w: 0.1, h: 0.1 });
      expect(g.windowDensity).toBe(1);
    });

    it('setRoof', () => {
      const g = new BuildingGenerator2().setRoof('dome', 5);
      expect(g.roofType).toBe('dome');
      expect(g.roofHeight).toBe(5);
    });

    it('setFeatures', () => {
      const g = new BuildingGenerator2().setFeatures(true, false, true, true);
      expect(g.hasBalcony).toBe(true);
      expect(g.hasEntrance).toBe(false);
      expect(g.hasAirConditioning).toBe(true);
      expect(g.hasAntenna).toBe(true);
    });

    it('setColors', () => {
      const g = new BuildingGenerator2().setColors(
        { r: 1, g: 0, b: 0 },
        { r: 0, g: 1, b: 0 },
        { r: 0, g: 0, b: 1 },
        { r: 1, g: 1, b: 0 },
      );
      expect(g.facadeColor).toEqual({ r: 1, g: 0, b: 0 });
      expect(g.roofColor).toEqual({ r: 0, g: 1, b: 0 });
      expect(g.windowColor).toEqual({ r: 0, g: 0, b: 1 });
      expect(g.accentColor).toEqual({ r: 1, g: 1, b: 0 });
    });

    it('setSeed', () => {
      const g = new BuildingGenerator2().setSeed(42);
      expect(g.seed).toBe(42);
    });

    it('链式调用返回 this', () => {
      const g = new BuildingGenerator2();
      expect(g.setStyle('asian')).toBe(g);
      expect(g.setFloors(3)).toBe(g);
    });
  });

  describe('getBuildingHeight / getFloorCount', () => {
    it('flat 屋顶总高 = floors * floorHeight + 0.05', () => {
      const g = new BuildingGenerator2().setFloors(10).setFloorHeight(3).setRoof('flat', 0);
      expect(g.getBuildingHeight()).toBeCloseTo(30.05, 5);
    });

    it('dome 屋顶总高 = floors * floorHeight + roofHeight', () => {
      const g = new BuildingGenerator2().setFloors(4).setFloorHeight(3).setRoof('dome', 6);
      expect(g.getBuildingHeight()).toBe(18);
    });

    it('getFloorCount', () => {
      const g = new BuildingGenerator2().setFloors(7);
      expect(g.getFloorCount()).toBe(7);
    });

    it('pitched 屋顶高度 = min(width, depth) * 0.4', () => {
      const g = new BuildingGenerator2().setDimensions(10, 8).setRoof('pitched', 0);
      // floors=5, floorHeight=3 → body=15; pitched = min(10,8)*0.4 = 3.2
      expect(g.getBuildingHeight()).toBeCloseTo(18.2, 5);
    });
  });

  describe('generate — 基础输出', () => {
    it('生成非空几何数据', () => {
      const g = new BuildingGenerator2();
      const r = g.generate();
      expect(r.positions.length).toBeGreaterThan(0);
      expect(r.indices.length).toBeGreaterThan(0);
      expect(r.uvs.length).toBeGreaterThan(0);
      expect(r.normals.length).toBeGreaterThan(0);
      expect(r.colors.length).toBeGreaterThan(0);
    });

    it('positions 长度是 3 的倍数', () => {
      const r = new BuildingGenerator2().generate();
      expect(r.positions.length % 3).toBe(0);
    });

    it('indices 长度是 3 的倍数(三角形)', () => {
      const r = new BuildingGenerator2().generate();
      expect(r.indices.length % 3).toBe(0);
    });

    it('normals 长度 == positions 长度', () => {
      const r = new BuildingGenerator2().generate();
      expect(r.normals.length).toBe(r.positions.length);
    });

    it('colors 长度 == positions 长度(每顶点 RGB)', () => {
      const r = new BuildingGenerator2().generate();
      expect(r.colors.length).toBe(r.positions.length);
    });

    it('uvs 长度 == positions 长度 * 2/3(每顶点 UV)', () => {
      const r = new BuildingGenerator2().generate();
      expect(r.uvs.length).toBe((r.positions.length * 2) / 3);
    });

    it('所有索引在顶点范围内', () => {
      const r = new BuildingGenerator2().generate();
      const vCount = r.positions.length / 3;
      for (let i = 0; i < r.indices.length; i++) {
        expect(r.indices[i]).toBeGreaterThanOrEqual(0);
        expect(r.indices[i]).toBeLessThan(vCount);
      }
    });

    it('totalHeight 与 getBuildingHeight 一致', () => {
      const g = new BuildingGenerator2();
      const r = g.generate();
      expect(r.totalHeight).toBeCloseTo(g.getBuildingHeight(), 5);
    });

    it('floorCount 与配置一致', () => {
      const g = new BuildingGenerator2().setFloors(8);
      expect(g.generate().floorCount).toBe(8);
    });

    it('parts 包含 8 个部件(foundation/floors/windows/roof/details/interior + 可选)', () => {
      const r = new BuildingGenerator2().generate();
      // 默认 hasEntrance=true, hasBalcony=false → 8 部件
      // foundation, floors, windows, roof, entrance(默认), details, interior = 7
      // 但 generate 总是 push 8 次(balconies 仅在 hasBalcony 时 push,entrance 仅在 hasEntrance 时 push)
      // 默认: foundation + floors + windows + roof + entrance + details + interior = 7
      expect(r.parts.length).toBe(7);
      const names = r.parts.map((p) => p.name);
      expect(names).toContain('foundation');
      expect(names).toContain('floors');
      expect(names).toContain('windows');
      expect(names).toContain('roof');
      expect(names).toContain('entrance');
      expect(names).toContain('details');
      expect(names).toContain('interior');
    });

    it('stats 顶点数 == positions/3', () => {
      const r = new BuildingGenerator2().generate();
      expect(r.stats.vertexCount).toBe(r.positions.length / 3);
    });

    it('stats 三角形数 == indices/3', () => {
      const r = new BuildingGenerator2().generate();
      expect(r.stats.triangleCount).toBe(r.indices.length / 3);
    });

    it('非正参数抛错(setter 钳制后通过直接置零触发 guard)', () => {
      const g = new BuildingGenerator2();
      // setter 会钳制到正数,这里直接置零以测试 generate 内部 guard
      (g as unknown as { width: number }).width = 0;
      expect(() => g.generate()).toThrow();
    });
  });

  describe('各部件生成', () => {
    it('generateFoundation 产出 1 个 box(24 顶点)', () => {
      const g = new BuildingGenerator2();
      const p = g.generateFoundation();
      // 6 面 × 4 顶点 = 24
      expect(p.positions.length / 3).toBe(24);
      expect(p.indices.length).toBe(36); // 6 面 × 2 三角形 × 3
    });

    it('generateFloors 顶点数 = floors × 24', () => {
      const g = new BuildingGenerator2().setFloors(4);
      const p = g.generateFloors();
      expect(p.positions.length / 3).toBe(4 * 24);
    });

    it('generateWindows 密度 0 仍至少 1 窗/面', () => {
      const g = new BuildingGenerator2().setFloors(1).setWindowConfig(0, { w: 1, h: 1 });
      const rng = () => 0.5;
      const p = g.generateWindows(rng);
      // 1 floor × 4 faces × 1 perFace × 4 verts = 16
      expect(p.positions.length / 3).toBe(16);
    });

    it('generateWindows 高密度产生更多窗户', () => {
      const g1 = new BuildingGenerator2().setFloors(1).setWindowConfig(0.2, { w: 1, h: 1 });
      const g2 = new BuildingGenerator2().setFloors(1).setWindowConfig(1.0, { w: 1, h: 1 });
      const rng = () => 0.5;
      const p1 = g1.generateWindows(rng);
      const p2 = g2.generateWindows(rng);
      expect(p2.positions.length).toBeGreaterThanOrEqual(p1.positions.length);
    });

    it('generateRoof flat = 1 box(24 顶点)', () => {
      const g = new BuildingGenerator2().setRoof('flat', 0);
      const p = g.generateRoof();
      expect(p.positions.length / 3).toBe(24);
    });

    it('generateRoof pitched = 4 三角形(12 顶点)', () => {
      const g = new BuildingGenerator2().setRoof('pitched', 0);
      const p = g.generateRoof();
      expect(p.positions.length / 3).toBe(12);
    });

    it('generateRoof dome 产出非空网格', () => {
      const g = new BuildingGenerator2().setRoof('dome', 4);
      const p = g.generateRoof();
      expect(p.positions.length).toBeGreaterThan(0);
      // rings(6) × segs(12) × 4 顶点 = 288
      expect(p.positions.length / 3).toBe(6 * 12 * 4);
    });

    it('generateRoof spire 产出非空锥', () => {
      const g = new BuildingGenerator2().setRoof('spire', 5);
      const p = g.generateRoof();
      expect(p.positions.length).toBeGreaterThan(0);
      // 12 底面顶点 + 1 尖顶 = 13
      expect(p.positions.length / 3).toBe(13);
    });

    it('generateBalconies 直接调用总是产出阳台(低层原语,不看 hasBalcony)', () => {
      const g = new BuildingGenerator2().setFloors(5).setFeatures(false, true, false, false);
      const rng = () => 0.5;
      const p = g.generateBalconies(rng);
      // generateBalconies 是低层原语,不看 hasBalcony 标志(由 generate() 控制是否包含)
      expect(p.positions.length).toBeGreaterThan(0);
    });

    it('hasBalcony=false 时 generate() 不包含 balconies 部件', () => {
      const g = new BuildingGenerator2().setFeatures(false, true, false, false);
      const r = g.generate();
      const names = r.parts.map((p) => p.name);
      expect(names).not.toContain('balconies');
    });

    it('generateBalconies 开启后产出顶点', () => {
      const g = new BuildingGenerator2().setFloors(5).setFeatures(true, true, false, false);
      const rng = () => 0.5;
      const p = g.generateBalconies(rng);
      expect(p.positions.length).toBeGreaterThan(0);
    });

    it('generateEntrance 产出非空', () => {
      const g = new BuildingGenerator2();
      const p = g.generateEntrance();
      expect(p.positions.length).toBeGreaterThan(0);
    });

    it('generateDetails 无装饰返回空', () => {
      const g = new BuildingGenerator2().setFeatures(false, true, false, false);
      const rng = () => 0.5;
      const p = g.generateDetails(rng);
      expect(p.positions.length).toBe(0);
    });

    it('generateDetails 空调+天线产出顶点', () => {
      const g = new BuildingGenerator2().setFeatures(false, true, true, true);
      const rng = () => 0.5;
      const p = g.generateDetails(rng);
      expect(p.positions.length).toBeGreaterThan(0);
    });

    it('generateInterior 楼板数 = floors + 1', () => {
      const g = new BuildingGenerator2().setFloors(3);
      const p = g.generateInterior();
      // (floors+1) × 24 顶点
      expect(p.positions.length / 3).toBe(4 * 24);
    });
  });

  describe('颜色', () => {
    it('colors 在 0-1 范围内', () => {
      const r = new BuildingGenerator2().generate();
      for (let i = 0; i < r.colors.length; i++) {
        expect(r.colors[i]).toBeGreaterThanOrEqual(0);
        expect(r.colors[i]).toBeLessThanOrEqual(1);
      }
    });

    it('setColors 后 facade 色出现在输出中', () => {
      const g = new BuildingGenerator2().setColors(
        { r: 0.9, g: 0.1, b: 0.1 },
        { r: 0.1, g: 0.9, b: 0.1 },
        { r: 0.1, g: 0.1, b: 0.9 },
        { r: 0.5, g: 0.5, b: 0.5 },
      );
      const r = g.generate();
      // 找一个 facade 色的顶点(floors 部件)
      let foundFacade = false;
      for (let i = 0; i < r.colors.length; i += 3) {
        if (Math.abs(r.colors[i] - 0.9) < 0.01 && Math.abs(r.colors[i + 1] - 0.1) < 0.01) {
          foundFacade = true;
          break;
        }
      }
      expect(foundFacade).toBe(true);
    });
  });

  describe('种子确定性', () => {
    it('同种子产出相同几何', () => {
      const g1 = new BuildingGenerator2().setSeed(123).setFloors(6);
      const g2 = new BuildingGenerator2().setSeed(123).setFloors(6);
      const r1 = g1.generate();
      const r2 = g2.generate();
      expect(r1.positions).toEqual(r2.positions);
      expect(r1.indices).toEqual(r2.indices);
    });

    it('不同种子可能产出不同窗户位置', () => {
      const g1 = new BuildingGenerator2().setSeed(1).setFloors(2);
      const g2 = new BuildingGenerator2().setSeed(999).setFloors(2);
      const r1 = g1.generate();
      const r2 = g2.generate();
      // 顶点数相同(密度相同),但位置可能因 jitter 不同
      expect(r1.positions.length).toBe(r2.positions.length);
      // 大概率不同(理论上 jitter 不同,但都是确定性的)
      // 这里只验证不抛错 + 长度一致
    });
  });

  describe('所有屋顶类型可生成', () => {
    const roofs: RoofType2[] = ['flat', 'pitched', 'dome', 'spire'];
    for (const roof of roofs) {
      it(`roof=${roof} 生成成功`, () => {
        const g = new BuildingGenerator2().setRoof(roof, 4);
        const r = g.generate();
        expect(r.positions.length).toBeGreaterThan(0);
      });
    }
  });

  describe('所有风格可生成', () => {
    const styles: BuildingStyle2[] = ['modern', 'classical', 'industrial', 'sci-fi', 'asian'];
    for (const s of styles) {
      it(`style=${s} 生成成功`, () => {
        const g = new BuildingGenerator2().setStyle(s);
        const r = g.generate();
        expect(r.positions.length).toBeGreaterThan(0);
      });
    }
  });

  describe('全特征建筑', () => {
    it('阳台+入口+空调+天线全部开启', () => {
      const g = new BuildingGenerator2()
        .setFloors(10)
        .setDimensions(12, 10)
        .setRoof('dome', 5)
        .setFeatures(true, true, true, true)
        .setSeed(42);
      const r = g.generate();
      expect(r.positions.length).toBeGreaterThan(0);
      expect(r.stats.hasEntrance).toBe(true);
      expect(r.stats.hasAirConditioning).toBe(true);
      expect(r.stats.hasAntenna).toBe(true);
      expect(r.stats.balconyCount).toBeGreaterThan(0);
      // parts 包含 balconies
      const names = r.parts.map((p) => p.name);
      expect(names).toContain('balconies');
      expect(names).toContain('entrance');
    });
  });

  describe('getStats(无 generate)', () => {
    it('返回配置态统计', () => {
      const g = new BuildingGenerator2().setFeatures(true, false, true, true);
      const s = g.getStats();
      expect(s.hasEntrance).toBe(false);
      expect(s.hasAirConditioning).toBe(true);
      expect(s.hasAntenna).toBe(true);
      expect(s.partCount).toBe(8);
    });
  });
});
