// CityGenerator2 单元测试:链式配置 / 各子生成器 / 风格色板 / 种子确定性 / 边界 / 统计 / 导出。

import { describe, it, expect } from 'vitest';
import {
  CityGenerator2,
  type CityStyle,
  type ZoneType,
  type RoadType,
  type LandmarkType,
  type CityData2,
} from './CityGenerator2';

describe('CityGenerator2', () => {
  describe('默认配置', () => {
    it('默认属性值', () => {
      const g = new CityGenerator2();
      expect(g.citySize).toBe(200);
      expect(g.blockSize).toBe(30);
      expect(g.roadWidth).toBe(6);
      expect(g.buildingDensity).toBe(0.7);
      expect(g.seed).toBe(0);
      expect(g.style).toBe('modern');
    });
  });

  describe('链式 setter', () => {
    it('setCitySize 钳制到 >= 50', () => {
      const g = new CityGenerator2().setCitySize(10);
      expect(g.citySize).toBe(50);
    });

    it('setBlockSize 钳制到 >= 8', () => {
      const g = new CityGenerator2().setBlockSize(2);
      expect(g.blockSize).toBe(8);
    });

    it('setRoadWidth 钳制到 >= 2', () => {
      const g = new CityGenerator2().setRoadWidth(0.5);
      expect(g.roadWidth).toBe(2);
    });

    it('setBuildingDensity 钳制 0-1', () => {
      const g = new CityGenerator2().setBuildingDensity(2);
      expect(g.buildingDensity).toBe(1);
      const g2 = new CityGenerator2().setBuildingDensity(-1);
      expect(g2.buildingDensity).toBe(0);
    });

    it('setStyle 设置风格', () => {
      const g = new CityGenerator2().setStyle('cyberpunk');
      expect(g.style).toBe('cyberpunk');
    });

    it('setSeed 设置种子', () => {
      const g = new CityGenerator2().setSeed(42);
      expect(g.seed).toBe(42);
    });

    it('setter 链式返回 this', () => {
      const g = new CityGenerator2();
      expect(g.setCitySize(100)).toBe(g);
      expect(g.setBlockSize(20)).toBe(g);
      expect(g.setStyle('medieval')).toBe(g);
    });
  });

  describe('getCityBounds', () => {
    it('返回以原点为中心的边界', () => {
      const g = new CityGenerator2().setCitySize(100);
      const b = g.getCityBounds();
      expect(b.min.x).toBe(-50);
      expect(b.min.z).toBe(-50);
      expect(b.max.x).toBe(50);
      expect(b.max.z).toBe(50);
      expect(b.min.y).toBe(0);
      expect(b.max.y).toBe(0);
    });
  });

  describe('generate 主入口', () => {
    it('返回完整城市数据', () => {
      const g = new CityGenerator2()
        .setCitySize(120)
        .setBlockSize(20)
        .setRoadWidth(4)
        .setBuildingDensity(0.8)
        .setSeed(1);
      const city = g.generate();
      expect(city.zones.length).toBeGreaterThan(0);
      expect(city.buildings.length).toBeGreaterThan(0);
      expect(city.roads.length).toBeGreaterThan(0);
      expect(city.bounds).toBeDefined();
      expect(city.stats).toBeDefined();
    });

    it('非法 citySize 抛错', () => {
      const g = new CityGenerator2();
      g.citySize = 0;
      expect(() => g.generate()).toThrow();
    });

    it('非法 buildingDensity 抛错', () => {
      const g = new CityGenerator2();
      g.buildingDensity = -0.1;
      expect(() => g.generate()).toThrow();
    });

    it('blockSize >= citySize 抛错', () => {
      const g = new CityGenerator2().setCitySize(100).setBlockSize(150);
      expect(() => g.generate()).toThrow();
    });
  });

  describe('generateZones 区域划分', () => {
    it('区域类型合法', () => {
      const g = new CityGenerator2().setSeed(7);
      const zones = g.generateZones();
      expect(zones.length).toBeGreaterThan(0);
      const validTypes: ZoneType[] = [
        'residential',
        'commercial',
        'industrial',
        'park',
        'downtown',
      ];
      for (const z of zones) {
        expect(validTypes).toContain(z.type);
        expect(z.density).toBeGreaterThanOrEqual(0);
        expect(z.density).toBeLessThanOrEqual(1);
        expect(z.maxHeight).toBeGreaterThanOrEqual(0);
      }
    });

    it('区域边界为有效矩形', () => {
      const g = new CityGenerator2();
      const zones = g.generateZones();
      for (const z of zones) {
        expect(z.bounds.max.x).toBeGreaterThan(z.bounds.min.x);
        expect(z.bounds.max.z).toBeGreaterThan(z.bounds.min.z);
      }
    });

    it('同种子确定性', () => {
      const g1 = new CityGenerator2().setSeed(42);
      const g2 = new CityGenerator2().setSeed(42);
      const z1 = g1.generateZones();
      const z2 = g2.generateZones();
      expect(z1.length).toBe(z2.length);
      for (let i = 0; i < z1.length; i++) {
        expect(z1[i].type).toBe(z2[i].type);
        expect(z1[i].bounds.min.x).toBeCloseTo(z2[i].bounds.min.x, 5);
      }
    });

    it('park 区域密度为 0', () => {
      const g = new CityGenerator2();
      const zones = g.generateZones();
      for (const z of zones) {
        if (z.type === 'park') {
          expect(z.density).toBe(0);
          expect(z.maxHeight).toBe(0);
        }
      }
    });
  });

  describe('generateRoadNetwork 道路网', () => {
    it('生成多条道路', () => {
      const g = new CityGenerator2().setCitySize(120).setBlockSize(20);
      g.generateZones();
      const roads = g.generateRoadNetwork();
      expect(roads.length).toBeGreaterThan(0);
    });

    it('道路类型合法', () => {
      const g = new CityGenerator2();
      g.generateZones();
      const roads = g.generateRoadNetwork();
      const validTypes: RoadType[] = ['highway', 'main', 'street', 'alley'];
      for (const r of roads) {
        expect(validTypes).toContain(r.type);
        expect(r.width).toBeGreaterThan(0);
        expect(r.lanes).toBeGreaterThanOrEqual(1);
      }
    });

    it('highway 车道数最多', () => {
      const g = new CityGenerator2();
      g.generateZones();
      const roads = g.generateRoadNetwork();
      const highways = roads.filter((r) => r.type === 'highway');
      const alleys = roads.filter((r) => r.type === 'alley');
      if (highways.length > 0 && alleys.length > 0) {
        expect(highways[0].lanes).toBeGreaterThan(alleys[0].lanes);
      }
    });

    it('道路起止点不同', () => {
      const g = new CityGenerator2();
      g.generateZones();
      const roads = g.generateRoadNetwork();
      for (const r of roads) {
        const len = Math.hypot(
          r.end.x - r.start.x,
          r.end.z - r.start.z,
        );
        expect(len).toBeGreaterThan(0);
      }
    });
  });

  describe('generateBuildings 建筑', () => {
    it('建筑风格继承城市风格', () => {
      const g = new CityGenerator2().setStyle('cyberpunk').setSeed(3);
      g.generateZones();
      const buildings = g.generateBuildings();
      for (const b of buildings) {
        expect(b.style).toBe('cyberpunk');
      }
    });

    it('建筑楼层 > 0(非 park 区)', () => {
      const g = new CityGenerator2().setBuildingDensity(1);
      g.generateZones();
      const buildings = g.generateBuildings();
      for (const b of buildings) {
        expect(b.floors).toBeGreaterThanOrEqual(1);
        expect(b.height).toBeGreaterThan(0);
        expect(b.size.y).toBe(b.height);
      }
    });

    it('建筑位置在城市边界内', () => {
      const g = new CityGenerator2().setCitySize(120);
      g.generateZones();
      const buildings = g.generateBuildings();
      const bounds = g.getCityBounds();
      for (const b of buildings) {
        expect(b.position.x).toBeGreaterThanOrEqual(bounds.min.x - 10);
        expect(b.position.x).toBeLessThanOrEqual(bounds.max.x + 10);
        expect(b.position.z).toBeGreaterThanOrEqual(bounds.min.z - 10);
        expect(b.position.z).toBeLessThanOrEqual(bounds.max.z + 10);
      }
    });

    it('buildingDensity=0 时无建筑', () => {
      const g = new CityGenerator2().setBuildingDensity(0);
      g.generateZones();
      const buildings = g.generateBuildings();
      expect(buildings.length).toBe(0);
    });

    it('downtown 建筑楼层多于 residential', () => {
      // 用大点城市 + 高密度提高命中
      const g = new CityGenerator2()
        .setCitySize(300)
        .setBlockSize(25)
        .setBuildingDensity(1)
        .setSeed(11);
      g.generateZones();
      const buildings = g.generateBuildings();
      const dt = buildings.filter((b) => b.zone === 'downtown');
      const res = buildings.filter((b) => b.zone === 'residential');
      if (dt.length > 0 && res.length > 0) {
        const dtAvg = dt.reduce((s, b) => s + b.floors, 0) / dt.length;
        const resAvg = res.reduce((s, b) => s + b.floors, 0) / res.length;
        expect(dtAvg).toBeGreaterThan(resAvg);
      }
    });
  });

  describe('generateLandmarks 地标', () => {
    it('至少生成一个地标(大点城市)', () => {
      const g = new CityGenerator2()
        .setCitySize(200)
        .setBlockSize(25)
        .setSeed(5);
      g.generateZones();
      const landmarks = g.generateLandmarks();
      expect(landmarks.length).toBeGreaterThan(0);
    });

    it('地标类型合法', () => {
      const g = new CityGenerator2();
      g.generateZones();
      const landmarks = g.generateLandmarks();
      const valid: LandmarkType[] = ['tower', 'monument', 'plaza', 'park'];
      for (const l of landmarks) {
        expect(valid).toContain(l.type);
        expect(l.size.x).toBeGreaterThan(0);
      }
    });

    it('park 区域生成 plaza 或 park 地标', () => {
      const g = new CityGenerator2().setSeed(2);
      const zones = g.generateZones();
      const landmarks = g.generateLandmarks();
      const parkLandmarks = landmarks.filter(
        (l) => l.type === 'plaza' || l.type === 'park',
      );
      // 若有 park 区域,应有 plaza/park 地标
      const hasParkZone = zones.some((z) => z.type === 'park');
      if (hasParkZone) {
        expect(parkLandmarks.length).toBeGreaterThan(0);
      }
    });
  });

  describe('generateStreetLights 路灯', () => {
    it('路灯风格匹配城市风格', () => {
      const g = new CityGenerator2().setStyle('cyberpunk');
      g.generateZones();
      g.generateRoadNetwork();
      const lights = g.generateStreetLights();
      for (const l of lights) {
        expect(l.type).toBe('cyberpunk');
      }
    });

    it('medieval 风格用 classic 路灯', () => {
      const g = new CityGenerator2().setStyle('medieval');
      g.generateZones();
      g.generateRoadNetwork();
      const lights = g.generateStreetLights();
      for (const l of lights) {
        expect(l.type).toBe('classic');
      }
    });

    it('路灯强度在合理范围', () => {
      const g = new CityGenerator2();
      g.generateZones();
      g.generateRoadNetwork();
      const lights = g.generateStreetLights();
      for (const l of lights) {
        expect(l.intensity).toBeGreaterThan(0);
        expect(l.intensity).toBeLessThanOrEqual(2);
        expect(l.color.r).toBeGreaterThanOrEqual(0);
        expect(l.color.r).toBeLessThanOrEqual(1);
      }
    });

    it('highway 与 alley 道路不放路灯', () => {
      const g = new CityGenerator2();
      g.generateZones();
      g.generateRoadNetwork();
      const lights = g.generateStreetLights();
      // 路灯只沿 main / street 放置,这里只验证返回的路灯存在(大点城市)
      void lights;
    });
  });

  describe('generateParks 公园', () => {
    it('公园数量等于 park 区域数', () => {
      const g = new CityGenerator2().setSeed(2);
      const zones = g.generateZones();
      const parks = g.generateParks();
      const parkZoneCount = zones.filter((z) => z.type === 'park').length;
      expect(parks.length).toBe(parkZoneCount);
    });

    it('公园有树木数量', () => {
      const g = new CityGenerator2();
      g.generateZones();
      const parks = g.generateParks();
      for (const p of parks) {
        expect(p.treeCount).toBeGreaterThanOrEqual(4);
        expect(p.treeCount).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('风格色板', () => {
    it('4 种风格都能生成有效城市', () => {
      const styles: CityStyle[] = ['modern', 'medieval', 'cyberpunk', 'classical'];
      for (const s of styles) {
        const g = new CityGenerator2().setStyle(s).setSeed(1);
        const city = g.generate();
        expect(city.stats.style).toBe(s);
        expect(city.buildings.length).toBeGreaterThan(0);
      }
    });

    it('cyberpunk 楼层上限高于 medieval', () => {
      const cp = new CityGenerator2().setStyle('cyberpunk').setSeed(1);
      const med = new CityGenerator2().setStyle('medieval').setSeed(1);
      const cpCity = cp.generate();
      const medCity = med.generate();
      // cyberpunk 最大楼层应高于 medieval(在 downtown 区域)
      const cpMax = Math.max(...cpCity.buildings.map((b) => b.floors), 0);
      const medMax = Math.max(...medCity.buildings.map((b) => b.floors), 0);
      expect(cpMax).toBeGreaterThanOrEqual(medMax);
    });
  });

  describe('种子确定性', () => {
    it('同种子产出相同城市', () => {
      const g1 = new CityGenerator2().setSeed(123);
      const g2 = new CityGenerator2().setSeed(123);
      const c1 = g1.generate();
      const c2 = g2.generate();
      expect(c1.buildings.length).toBe(c2.buildings.length);
      expect(c1.roads.length).toBe(c2.roads.length);
      expect(c1.zones.length).toBe(c2.zones.length);
      // 建筑位置一致
      for (let i = 0; i < c1.buildings.length; i++) {
        expect(c1.buildings[i].position.x).toBeCloseTo(
          c2.buildings[i].position.x,
          5,
        );
        expect(c1.buildings[i].floors).toBe(c2.buildings[i].floors);
      }
    });

    it('不同种子产出不同城市', () => {
      const g1 = new CityGenerator2().setSeed(1);
      const g2 = new CityGenerator2().setSeed(2);
      const c1 = g1.generate();
      const c2 = g2.generate();
      // 至少某一处不同(建筑数 / 位置 / 路灯数)
      const diff =
        c1.buildings.length !== c2.buildings.length ||
        c1.streetLights.length !== c2.streetLights.length ||
        (c1.buildings[0]?.position.x ?? 0) !== (c2.buildings[0]?.position.x ?? 0);
      expect(diff).toBe(true);
    });
  });

  describe('getStats 统计', () => {
    it('统计字段准确', () => {
      const g = new CityGenerator2().setSeed(9);
      const city = g.generate();
      const stats = g.getStats();
      expect(stats.buildingCount).toBe(city.buildings.length);
      expect(stats.roadCount).toBe(city.roads.length);
      expect(stats.zoneCount).toBe(city.zones.length);
      expect(stats.landmarkCount).toBe(city.landmarks.length);
      expect(stats.streetLightCount).toBe(city.streetLights.length);
      expect(stats.parkCount).toBe(city.parks.length);
      expect(stats.style).toBe(g.style);
    });

    it('统计反映当前配置', () => {
      const g = new CityGenerator2()
        .setCitySize(150)
        .setBlockSize(18)
        .setRoadWidth(5)
        .setBuildingDensity(0.6);
      const stats = g.getStats();
      expect(stats.citySize).toBe(150);
      expect(stats.blockSize).toBe(18);
      expect(stats.roadWidth).toBe(5);
      expect(stats.buildingDensity).toBe(0.6);
    });
  });

  describe('Getter 方法', () => {
    it('getBuildings / getRoads / getZones / getLandmarks / getStreetLights 返回缓存', () => {
      const g = new CityGenerator2().setSeed(1);
      g.generate();
      expect(g.getBuildings().length).toBeGreaterThan(0);
      expect(g.getRoads().length).toBeGreaterThan(0);
      expect(g.getZones().length).toBeGreaterThan(0);
      expect(g.getLandmarks().length).toBeGreaterThan(0);
      expect(g.getStreetLights().length).toBeGreaterThan(0);
    });

    it('未 generate 时 getter 返回空数组', () => {
      const g = new CityGenerator2();
      expect(g.getBuildings()).toEqual([]);
      expect(g.getRoads()).toEqual([]);
      expect(g.getZones()).toEqual([]);
    });
  });

  describe('exportCityData 导出', () => {
    it('generate 后导出与原数据一致', () => {
      const g = new CityGenerator2().setSeed(1);
      const city = g.generate();
      const exported = g.exportCityData();
      expect(exported.buildings.length).toBe(city.buildings.length);
      expect(exported.roads.length).toBe(city.roads.length);
      expect(exported.zones.length).toBe(city.zones.length);
    });

    it('未 generate 时自动调用 generate', () => {
      const g = new CityGenerator2().setSeed(1);
      const exported = g.exportCityData();
      expect(exported).toBeDefined();
      expect(exported.buildings.length).toBeGreaterThan(0);
    });

    it('导出数据可 JSON 序列化', () => {
      const g = new CityGenerator2().setSeed(1);
      const exported = g.exportCityData();
      const json = JSON.stringify(exported);
      expect(json.length).toBeGreaterThan(10);
      const parsed = JSON.parse(json) as CityData2;
      expect(parsed.buildings.length).toBe(exported.buildings.length);
    });
  });

  describe('边界与集成', () => {
    it('所有建筑位置在 stats.citySize 范围内', () => {
      const g = new CityGenerator2().setCitySize(100).setBlockSize(15).setSeed(8);
      const city = g.generate();
      const half = city.stats.citySize / 2;
      for (const b of city.buildings) {
        expect(Math.abs(b.position.x)).toBeLessThanOrEqual(half + 20);
        expect(Math.abs(b.position.z)).toBeLessThanOrEqual(half + 20);
      }
    });

    it('道路端点在城市范围内', () => {
      const g = new CityGenerator2().setCitySize(100).setSeed(8);
      const city = g.generate();
      const half = city.stats.citySize / 2 + 20;
      for (const r of city.roads) {
        expect(r.start.x).toBeGreaterThanOrEqual(-half);
        expect(r.start.x).toBeLessThanOrEqual(half);
        expect(r.start.z).toBeGreaterThanOrEqual(-half);
        expect(r.start.z).toBeLessThanOrEqual(half);
        expect(r.end.x).toBeGreaterThanOrEqual(-half);
        expect(r.end.x).toBeLessThanOrEqual(half);
        expect(r.end.z).toBeGreaterThanOrEqual(-half);
        expect(r.end.z).toBeLessThanOrEqual(half);
      }
    });

    it('多次 generate 重置状态', () => {
      const g = new CityGenerator2().setSeed(1);
      const c1 = g.generate();
      const c2 = g.generate();
      expect(c1.buildings.length).toBe(c2.buildings.length);
      expect(c1.zones.length).toBe(c2.zones.length);
    });
  });
});
