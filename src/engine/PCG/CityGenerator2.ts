// CityGenerator2 — 增强版程序化城市生成器(实例化 API)。
//
// 与 `CityGenerator` 互补:本类提供面向「风格 / 区域 / 道路网 / 地标 / 路灯」
// 的可配置实例化 API,产出结构化城市数据(区域划分 + 道路网 + 建筑布局 +
// 地标 + 路灯 + 公园),不绑定 BufferGeometry / Material / Scene,由调用方
// 按需实例化几何体(可委托 BuildingGenerator / BuildingGenerator2)。
//
// 设计目标:
//   - 实例化 API:setCitySize/setBlockSize/... 链式配置,generate() 一次性产出
//   - 种子化 PRNG(mulberry32):同种子产出确定性城市,便于复现/存档
//   - 4 种城市风格(modern/medieval/cyberpunk/classical)影响色板与建筑特征
//   - 5 种区域类型(residential/commercial/industrial/park/downtown)按噪声
//     划分,downtown 偏中心、industrial 偏外围、park 散布
//   - 道路网 = 网格 + 有机变形(节点抖动 + 偶发对角连接)
//   - 地标按区域类型分布:downtown → tower,plaza → plaza/park 等
//   - 路灯沿 main/street 道路两侧均匀放置
//
// 与 `CityGenerator` 区别:
//   - `CityGenerator` 全静态方法,产出 BufferGeometry(合并道路网格)
//   - `CityGenerator2` 实例化链式配置,产出纯结构化数据(无几何体)
//
// 用法:
//   const gen = new CityGenerator2();
//   gen.setCitySize(200).setBlockSize(30).setStyle('cyberpunk').setSeed(42);
//   const city = gen.generate();
//   // city.buildings / roads / zones / landmarks / streetLights / parks

import type { RGBColor } from '../Lights/Light';
import { NoiseGenerator } from './NoiseGenerator';

// ── 类型 ──────────────────────────────────────────────────

/** 三维向量(纯数据,避免引入 Vector3 依赖)。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 轴对齐边界框。 */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** 城市风格。 */
export type CityStyle = 'modern' | 'medieval' | 'cyberpunk' | 'classical';

/** 区域类型。 */
export type ZoneType = 'residential' | 'commercial' | 'industrial' | 'park' | 'downtown';

/** 道路类型。 */
export type RoadType = 'highway' | 'main' | 'street' | 'alley';

/** 地标类型。 */
export type LandmarkType = 'tower' | 'monument' | 'plaza' | 'park';

/** 路灯风格。 */
export type StreetLightType = 'modern' | 'classic' | 'cyberpunk';

/** 区域。 */
export interface CityZone {
  /** 区域类型。 */
  type: ZoneType;
  /** 边界(世界空间)。 */
  bounds: Bounds;
  /** 建筑密度(0-1)。 */
  density: number;
  /** 该区域建筑最大高度(米)。 */
  maxHeight: number;
}

/** 建筑。 */
export interface CityBuilding {
  /** 建筑底部中心(世界空间,Y=0)。 */
  position: Vec3;
  /** 建筑尺寸(宽 × 高 × 深,米)。 */
  size: Vec3;
  /** 建筑总高(米)。 */
  height: number;
  /** 楼层数。 */
  floors: number;
  /** 建筑风格(继承城市风格)。 */
  style: CityStyle;
  /** 所属区域类型。 */
  zone: ZoneType;
  /** 是否有屋顶可达(顶层露台 / 楼顶平台)。 */
  hasRoofAccess: boolean;
}

/** 道路。 */
export interface CityRoad {
  /** 起点(世界空间,Y=0)。 */
  start: Vec3;
  /** 终点(世界空间,Y=0)。 */
  end: Vec3;
  /** 道路宽度(米)。 */
  width: number;
  /** 道路类型。 */
  type: RoadType;
  /** 车道数。 */
  lanes: number;
}

/** 地标。 */
export interface CityLandmark {
  /** 中心位置(世界空间,Y=0)。 */
  position: Vec3;
  /** 地标类型。 */
  type: LandmarkType;
  /** 尺寸(米)。 */
  size: Vec3;
}

/** 路灯。 */
export interface StreetLight {
  /** 灯柱底部位置(世界空间,Y=0)。 */
  position: Vec3;
  /** 路灯风格。 */
  type: StreetLightType;
  /** 光强(0-1,渲染时映射到具体流明)。 */
  intensity: number;
  /** 灯光颜色。 */
  color: RGBColor;
}

/** 公园(植被元数据,不含几何体)。 */
export interface CityPark2 {
  /** 中心位置。 */
  position: Vec3;
  /** 尺寸(米)。 */
  size: Vec3;
  /** 树木数量。 */
  treeCount: number;
  /** 是否有水池。 */
  hasPond: boolean;
}

/** 城市统计。 */
export interface CityStats2 {
  /** 城市大小(米)。 */
  citySize: number;
  /** 街区大小(米)。 */
  blockSize: number;
  /** 道路宽度(米)。 */
  roadWidth: number;
  /** 建筑密度(0-1)。 */
  buildingDensity: number;
  /** 建筑数。 */
  buildingCount: number;
  /** 道路数。 */
  roadCount: number;
  /** 区域数。 */
  zoneCount: number;
  /** 地标数。 */
  landmarkCount: number;
  /** 路灯数。 */
  streetLightCount: number;
  /** 公园数。 */
  parkCount: number;
  /** 城市风格。 */
  style: CityStyle;
}

/** generate() 完整结果。 */
export interface CityData2 {
  zones: CityZone[];
  buildings: CityBuilding[];
  roads: CityRoad[];
  landmarks: CityLandmark[];
  streetLights: StreetLight[];
  parks: CityPark2[];
  bounds: Bounds;
  stats: CityStats2;
}

// ── 风格色板 ──────────────────────────────────────────────

interface StylePalette {
  /** 路灯颜色。 */
  lightColor: RGBColor;
  /** 路灯强度。 */
  lightIntensity: number;
  /** 默认建筑最大楼层。 */
  maxFloors: number;
  /** 区域最大高度系数(乘以 blockSize)。 */
  heightFactor: number;
  /** 路灯类型。 */
  lightType: StreetLightType;
}

const STYLE_PALETTES: Record<CityStyle, StylePalette> = {
  modern: {
    lightColor: { r: 1.0, g: 0.95, b: 0.85 },
    lightIntensity: 0.8,
    maxFloors: 20,
    heightFactor: 1.0,
    lightType: 'modern',
  },
  medieval: {
    lightColor: { r: 1.0, g: 0.7, b: 0.4 },
    lightIntensity: 0.6,
    maxFloors: 6,
    heightFactor: 0.4,
    lightType: 'classic',
  },
  cyberpunk: {
    lightColor: { r: 0.2, g: 1.0, b: 0.9 },
    lightIntensity: 1.0,
    maxFloors: 40,
    heightFactor: 1.6,
    lightType: 'cyberpunk',
  },
  classical: {
    lightColor: { r: 1.0, g: 0.85, b: 0.6 },
    lightIntensity: 0.7,
    maxFloors: 10,
    heightFactor: 0.7,
    lightType: 'classic',
  },
};

// ── PRNG ──────────────────────────────────────────────────

/** mulberry32 — 与其他 PCG 模块同实现的种子化 PRNG。 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 线性插值。 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 区间 [min,max) 整数。 */
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min));
}

// ── 主类 ──────────────────────────────────────────────────

/**
 * 增强版程序化城市生成器(实例化 API)。
 *
 * 用法:
 *   const gen = new CityGenerator2();
 *   gen.setCitySize(200).setBlockSize(30).setStyle('cyberpunk').setSeed(42);
 *   const city = gen.generate();
 */
export class CityGenerator2 {
  /** 城市大小(米,正方形边长)。 */
  citySize: number = 200;
  /** 街区大小(米)。 */
  blockSize: number = 30;
  /** 道路宽度(米)。 */
  roadWidth: number = 6;
  /** 建筑密度(0-1)。 */
  buildingDensity: number = 0.7;
  /** 随机种子。 */
  seed: number = 0;
  /** 城市风格。 */
  style: CityStyle = 'modern';

  // 生成结果缓存(generate 后填充)
  private _zones: CityZone[] = [];
  private _buildings: CityBuilding[] = [];
  private _roads: CityRoad[] = [];
  private _landmarks: CityLandmark[] = [];
  private _streetLights: StreetLight[] = [];
  private _parks: CityPark2[] = [];
  private _bounds: Bounds = {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  };

  /** 设置城市大小(米)。 */
  setCitySize(size: number): this {
    this.citySize = Math.max(50, size);
    return this;
  }

  /** 设置街区大小(米)。 */
  setBlockSize(size: number): this {
    this.blockSize = Math.max(8, size);
    return this;
  }

  /** 设置道路宽度(米)。 */
  setRoadWidth(width: number): this {
    this.roadWidth = Math.max(2, width);
    return this;
  }

  /** 设置建筑密度(0-1)。 */
  setBuildingDensity(density: number): this {
    this.buildingDensity = Math.max(0, Math.min(1, density));
    return this;
  }

  /** 设置城市风格。 */
  setStyle(style: CityStyle): this {
    this.style = style;
    return this;
  }

  /** 设置随机种子。 */
  setSeed(seed: number): this {
    this.seed = seed >>> 0;
    return this;
  }

  /** 获取城市边界(以原点为中心,边长 = citySize)。 */
  getCityBounds(): Bounds {
    const half = this.citySize / 2;
    return {
      min: { x: -half, y: 0, z: -half },
      max: { x: half, y: 0, z: half },
    };
  }

  // ── 生成入口 ────────────────────────────────────────────

  /**
   * 生成完整城市(区域 + 道路网 + 建筑 + 地标 + 路灯 + 公园)。
   * 返回所有结构化数据。
   */
  generate(): CityData2 {
    if (this.citySize <= 0 || this.blockSize <= 0 || this.roadWidth <= 0) {
      throw new Error('CityGenerator2: citySize/blockSize/roadWidth 必须为正数');
    }
    if (this.buildingDensity < 0 || this.buildingDensity > 1) {
      throw new Error('CityGenerator2: buildingDensity 必须在 [0, 1]');
    }
    if (this.blockSize >= this.citySize) {
      throw new Error('CityGenerator2: blockSize 必须小于 citySize');
    }

    this._bounds = this.getCityBounds();
    this.generateZones();
    this.generateRoadNetwork();
    this.generateBuildings();
    this.generateLandmarks();
    this.generateParks();
    this.generateStreetLights();

    return {
      zones: this._zones,
      buildings: this._buildings,
      roads: this._roads,
      landmarks: this._landmarks,
      streetLights: this._streetLights,
      parks: this._parks,
      bounds: this._bounds,
      stats: this.getStats(),
    };
  }

  // ── 区域划分 ────────────────────────────────────────────

  /**
   * 生成区域划分。
   * 策略:把城市切成 grid(blockSize × blockSize 单元),每个单元按其到城市
   * 中心的距离 + 噪声决定区域类型:
   *   - 距中心 < 25% → downtown(高密度,高建筑)
   *   - 距中心 25-60% → commercial
   *   - 距中心 60-85% → residential
   *   - 距中心 > 85% → industrial
   *   - 噪声值 > 0.75 的单元 → park(打断常规分布)
   */
  generateZones(): CityZone[] {
    const rng = mulberry32(this.seed);
    const noise = new NoiseGenerator(this.seed);
    const half = this.citySize / 2;
    const cellPitch = this.blockSize + this.roadWidth;
    const gridCount = Math.max(1, Math.floor(this.citySize / cellPitch));
    // 重新计算实际覆盖(避免边角缺口)
    const actualSpan = gridCount * cellPitch;
    const offset = -actualSpan / 2 + this.roadWidth / 2;

    const zones: CityZone[] = [];
    const palette = STYLE_PALETTES[this.style];
    const maxDist = half * Math.SQRT2;

    for (let r = 0; r < gridCount; r++) {
      for (let c = 0; c < gridCount; c++) {
        const cx = offset + c * cellPitch + this.blockSize / 2;
        const cz = offset + r * cellPitch + this.blockSize / 2;
        const dist = Math.hypot(cx, cz);
        const distRatio = dist / maxDist;

        // 噪声用于打断规则分布(产生不规则公园 / 散布)
        const n = (noise.fbm2D(c * 0.4, r * 0.4, 4, 0.5, 2) + 1) * 0.5;

        let type: ZoneType;
        if (n > 0.78) {
          type = 'park';
        } else if (distRatio < 0.25) {
          type = 'downtown';
        } else if (distRatio < 0.6) {
          type = 'commercial';
        } else if (distRatio < 0.85) {
          type = 'residential';
        } else {
          type = 'industrial';
        }

        const bounds: Bounds = {
          min: { x: cx - this.blockSize / 2, y: 0, z: cz - this.blockSize / 2 },
          max: { x: cx + this.blockSize / 2, y: 0, z: cz + this.blockSize / 2 },
        };
        const density = zoneDensity(type, this.buildingDensity);
        const maxHeight = zoneMaxHeight(type, this.blockSize, palette.heightFactor, rng);

        zones.push({ type, bounds, density, maxHeight });
      }
    }
    this._zones = zones;
    return zones;
  }

  // ── 道路网 ──────────────────────────────────────────────

  /**
   * 生成道路网(网格 + 有机变形)。
   * 策略:沿街区边界画网格道路,节点位置加小幅抖动(有机感),
   * 偶发对角连接(模拟捷径 / 弯道)。道路类型按距中心距离分级:
   *   - 中心环 → main(主干道,4 车道)
   *   - 外环 → street(2 车道)
   *   - 边缘环 → highway(快速路,6 车道,仅外围)
   *   - 内部窄连接 → alley(1 车道)
   */
  generateRoadNetwork(): CityRoad[] {
    const rng = mulberry32(this.seed ^ 0x9e3779b9);
    const cellPitch = this.blockSize + this.roadWidth;
    const gridCount = Math.max(1, Math.floor(this.citySize / cellPitch));
    const actualSpan = gridCount * cellPitch;
    const half = actualSpan / 2;
    const roads: CityRoad[] = [];

    // 节点位置(含抖动):gridCount+1 × gridCount+1
    const nodeJitter = this.roadWidth * 0.15;
    const nodes: Vec3[][] = [];
    for (let r = 0; r <= gridCount; r++) {
      const row: Vec3[] = [];
      for (let c = 0; c <= gridCount; c++) {
        const bx = -half + c * cellPitch;
        const bz = -half + r * cellPitch;
        // 边界节点不抖动(保持矩形外框)
        const onBoundary = r === 0 || r === gridCount || c === 0 || c === gridCount;
        const jx = onBoundary ? 0 : (rng() - 0.5) * nodeJitter;
        const jz = onBoundary ? 0 : (rng() - 0.5) * nodeJitter;
        row.push({ x: bx + jx, y: 0, z: bz + jz });
      }
      nodes.push(row);
    }

    // 道路类型按距中心距离分级
    const classifyRoad = (nodeA: Vec3, nodeB: Vec3): RoadType => {
      const midX = (nodeA.x + nodeB.x) / 2;
      const midZ = (nodeA.z + nodeB.z) / 2;
      const dist = Math.hypot(midX, midZ);
      const distRatio = dist / half;
      if (distRatio > 0.85) return 'highway';
      if (distRatio > 0.5) return 'street';
      return 'main';
    };

    const roadLanes = (type: RoadType): number => {
      switch (type) {
        case 'highway': return 6;
        case 'main': return 4;
        case 'street': return 2;
        case 'alley': return 1;
      }
    };

    const roadWidthFor = (type: RoadType): number => {
      switch (type) {
        case 'highway': return this.roadWidth * 1.6;
        case 'main': return this.roadWidth;
        case 'street': return this.roadWidth * 0.7;
        case 'alley': return this.roadWidth * 0.4;
      }
    };

    // 横向道路:r 行,c..c+1
    for (let r = 0; r <= gridCount; r++) {
      for (let c = 0; c < gridCount; c++) {
        const a = nodes[r][c];
        const b = nodes[r][c + 1];
        const type = classifyRoad(a, b);
        roads.push({
          start: a,
          end: b,
          width: roadWidthFor(type),
          type,
          lanes: roadLanes(type),
        });
      }
    }
    // 纵向道路:c 列,r..r+1
    for (let c = 0; c <= gridCount; c++) {
      for (let r = 0; r < gridCount; r++) {
        const a = nodes[r][c];
        const b = nodes[r + 1][c];
        const type = classifyRoad(a, b);
        roads.push({
          start: a,
          end: b,
          width: roadWidthFor(type),
          type,
          lanes: roadLanes(type),
        });
      }
    }

    // 偶发对角连接(模拟捷径):内部相邻 4 节点中随机选 5-10% 加对角
    const diagonalChance = 0.08;
    for (let r = 0; r < gridCount; r++) {
      for (let c = 0; c < gridCount; c++) {
        if (rng() < diagonalChance) {
          const a = nodes[r][c];
          const b = nodes[r + 1][c + 1];
          roads.push({
            start: a,
            end: b,
            width: roadWidthFor('alley'),
            type: 'alley',
            lanes: 1,
          });
        } else if (rng() < diagonalChance) {
          const a = nodes[r][c + 1];
          const b = nodes[r + 1][c];
          roads.push({
            start: a,
            end: b,
            width: roadWidthFor('alley'),
            type: 'alley',
            lanes: 1,
          });
        }
      }
    }

    this._roads = roads;
    return roads;
  }

  // ── 建筑生成 ────────────────────────────────────────────

  /**
   * 生成建筑(按区域类型)。
   * 每个非 park 区域按 density 决定是否放置建筑;建筑尺寸 / 楼层受区域类型影响。
   */
  generateBuildings(): CityBuilding[] {
    const rng = mulberry32(this.seed ^ 0x12345678);
    const palette = STYLE_PALETTES[this.style];
    const buildings: CityBuilding[] = [];

    for (const zone of this._zones) {
      if (zone.type === 'park') continue;
      // 每个 zone 内放置 1-N 栋建筑(取决于 density 与 zone 大小)
      const zoneW = zone.bounds.max.x - zone.bounds.min.x;
      const zoneD = zone.bounds.max.z - zone.bounds.min.z;
      // 估算可放置建筑数(每栋约 8m × 8m 占地)
      const slotSize = 8;
      const slotsX = Math.max(1, Math.floor(zoneW / slotSize));
      const slotsZ = Math.max(1, Math.floor(zoneD / slotSize));
      const totalSlots = slotsX * slotsZ;
      const targetCount = Math.floor(totalSlots * zone.density * this.buildingDensity);

      for (let i = 0; i < targetCount; i++) {
        const slotIdx = randInt(rng, 0, totalSlots);
        const sx = slotIdx % slotsX;
        const sz = Math.floor(slotIdx / slotsX);
        const px = zone.bounds.min.x + (sx + 0.5) * slotSize;
        const pz = zone.bounds.min.z + (sz + 0.5) * slotSize;

        // 建筑尺寸:在 slotSize 范围内随机
        const width = lerp(slotSize * 0.6, slotSize * 0.95, rng());
        const depth = lerp(slotSize * 0.6, slotSize * 0.95, rng());

        // 楼层:受区域类型与风格影响
        const floors = buildingFloors(zone.type, palette.maxFloors, rng);
        const floorHeight = 3;
        const height = floors * floorHeight;

        // 屋顶可达:高层 / downtown 更可能有
        const hasRoofAccess =
          zone.type === 'downtown'
            ? rng() < 0.6
            : rng() < 0.2;

        buildings.push({
          position: { x: px, y: 0, z: pz },
          size: { x: width, y: height, z: depth },
          height,
          floors,
          style: this.style,
          zone: zone.type,
          hasRoofAccess,
        });
      }
    }
    this._buildings = buildings;
    return buildings;
  }

  // ── 地标 ────────────────────────────────────────────────

  /**
   * 生成地标。
   * 策略:
   *   - downtown 中心 → 1 个 tower(高耸地标)
   *   - 每个 park 区域 → plaza 或 park 装饰
   *   - commercial 区偶发 monument
   */
  generateLandmarks(): CityLandmark[] {
    const rng = mulberry32(this.seed ^ 0xdeadbeef);
    const landmarks: CityLandmark[] = [];
    const palette = STYLE_PALETTES[this.style];

    let downtownCount = 0;
    for (const zone of this._zones) {
      const cx = (zone.bounds.min.x + zone.bounds.max.x) / 2;
      const cz = (zone.bounds.min.z + zone.bounds.max.z) / 2;
      if (zone.type === 'downtown') {
        // 第一个 downtown 区域放 tower
        if (downtownCount === 0) {
          const towerHeight = palette.maxFloors * 3 * 1.5;
          landmarks.push({
            position: { x: cx, y: 0, z: cz },
            type: 'tower',
            size: { x: 8, y: towerHeight, z: 8 },
          });
        }
        downtownCount++;
      } else if (zone.type === 'park') {
        // park 区域中心放 plaza 或 park 装饰
        const isPlaza = rng() < 0.5;
        landmarks.push({
          position: { x: cx, y: 0, z: cz },
          type: isPlaza ? 'plaza' : 'park',
          size: { x: this.blockSize * 0.6, y: 0.5, z: this.blockSize * 0.6 },
        });
      } else if (zone.type === 'commercial' && rng() < 0.15) {
        // commercial 区偶发 monument
        landmarks.push({
          position: { x: cx, y: 0, z: cz },
          type: 'monument',
          size: { x: 3, y: 6, z: 3 },
        });
      }
    }

    this._landmarks = landmarks;
    return landmarks;
  }

  // ── 路灯 ────────────────────────────────────────────────

  /**
   * 生成路灯。
   * 沿 main / street 道路两侧按间距放置(避开 highway 与 alley)。
   * 路灯类型与颜色由城市风格决定。
   */
  generateStreetLights(): StreetLight[] {
    const rng = mulberry32(this.seed ^ 0xfeedface);
    const palette = STYLE_PALETTES[this.style];
    const lights: StreetLight[] = [];
    const spacing = 15; // 路灯间距(米)
    const sideOffset = this.roadWidth * 0.6; // 距道路中心线偏移

    for (const road of this._roads) {
      if (road.type === 'highway' || road.type === 'alley') continue;
      const dx = road.end.x - road.start.x;
      const dz = road.end.z - road.start.z;
      const len = Math.hypot(dx, dz);
      if (len < spacing) continue;
      // 单位垂直向量(垂直于道路方向)
      const nx = -dz / len;
      const nz = dx / len;
      const count = Math.floor(len / spacing);
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const px = lerp(road.start.x, road.end.x, t);
        const pz = lerp(road.start.z, road.end.z, t);
        // 两侧各放一个
        lights.push({
          position: { x: px + nx * sideOffset, y: 0, z: pz + nz * sideOffset },
          type: palette.lightType,
          intensity: palette.lightIntensity * (0.85 + rng() * 0.3),
          color: { ...palette.lightColor },
        });
        lights.push({
          position: { x: px - nx * sideOffset, y: 0, z: pz - nz * sideOffset },
          type: palette.lightType,
          intensity: palette.lightIntensity * (0.85 + rng() * 0.3),
          color: { ...palette.lightColor },
        });
      }
    }
    this._streetLights = lights;
    return lights;
  }

  // ── 公园 ────────────────────────────────────────────────

  /**
   * 生成公园(植被元数据)。
   * 在每个 park 区域内放置若干树 + 偶发水池。
   */
  generateParks(): CityPark2[] {
    const rng = mulberry32(this.seed ^ 0xcafebabe);
    const parks: CityPark2[] = [];
    for (const zone of this._zones) {
      if (zone.type !== 'park') continue;
      const cx = (zone.bounds.min.x + zone.bounds.max.x) / 2;
      const cz = (zone.bounds.min.z + zone.bounds.max.z) / 2;
      const w = zone.bounds.max.x - zone.bounds.min.x;
      const d = zone.bounds.max.z - zone.bounds.min.z;
      const treeCount = randInt(rng, 4, 10);
      const hasPond = rng() < 0.4;
      parks.push({
        position: { x: cx, y: 0, z: cz },
        size: { x: w, y: 0, z: d },
        treeCount,
        hasPond,
      });
    }
    this._parks = parks;
    return parks;
  }

  // ── Getter ─────────────────────────────────────────────

  /** 获取建筑列表(需先 generate)。 */
  getBuildings(): CityBuilding[] {
    return this._buildings;
  }

  /** 获取道路列表(需先 generate)。 */
  getRoads(): CityRoad[] {
    return this._roads;
  }

  /** 获取区域列表(需先 generate)。 */
  getZones(): CityZone[] {
    return this._zones;
  }

  /** 获取地标列表(需先 generate)。 */
  getLandmarks(): CityLandmark[] {
    return this._landmarks;
  }

  /** 获取路灯列表(需先 generate)。 */
  getStreetLights(): StreetLight[] {
    return this._streetLights;
  }

  /** 获取统计(基于已 generate 的结果,或当前配置的元数据)。 */
  getStats(): CityStats2 {
    return {
      citySize: this.citySize,
      blockSize: this.blockSize,
      roadWidth: this.roadWidth,
      buildingDensity: this.buildingDensity,
      buildingCount: this._buildings.length,
      roadCount: this._roads.length,
      zoneCount: this._zones.length,
      landmarkCount: this._landmarks.length,
      streetLightCount: this._streetLights.length,
      parkCount: this._parks.length,
      style: this.style,
    };
  }

  /** 导出城市数据(JSON 可序列化)。 */
  exportCityData(): CityData2 {
    // 若未 generate,自动调用
    if (this._zones.length === 0 && this._buildings.length === 0) {
      return this.generate();
    }
    return {
      zones: this._zones,
      buildings: this._buildings,
      roads: this._roads,
      landmarks: this._landmarks,
      streetLights: this._streetLights,
      parks: this._parks,
      bounds: this._bounds,
      stats: this.getStats(),
    };
  }
}

// ── 区域属性辅助 ──────────────────────────────────────────

/** 区域建筑密度(基于全局 buildingDensity 调整)。 */
function zoneDensity(type: ZoneType, base: number): number {
  switch (type) {
    case 'downtown': return Math.min(1, base * 1.2);
    case 'commercial': return base;
    case 'residential': return base * 0.7;
    case 'industrial': return base * 0.5;
    case 'park': return 0;
  }
}

/** 区域建筑最大高度(米)。 */
function zoneMaxHeight(
  type: ZoneType,
  blockSize: number,
  heightFactor: number,
  rng: () => number,
): number {
  const base = blockSize * heightFactor;
  switch (type) {
    case 'downtown': return Math.round(base * (3 + rng() * 2)); // 3-5x
    case 'commercial': return Math.round(base * (1.5 + rng()));
    case 'residential': return Math.round(base * (0.6 + rng() * 0.4));
    case 'industrial': return Math.round(base * (0.4 + rng() * 0.3));
    case 'park': return 0;
  }
}

/** 区域建筑楼层数。 */
function buildingFloors(
  type: ZoneType,
  maxFloors: number,
  rng: () => number,
): number {
  switch (type) {
    case 'downtown': return Math.max(5, Math.floor(maxFloors * (0.6 + rng() * 0.4)));
    case 'commercial': return Math.max(3, Math.floor(maxFloors * (0.3 + rng() * 0.3)));
    case 'residential': return Math.max(1, Math.floor(2 + rng() * 4));
    case 'industrial': return Math.max(1, Math.floor(1 + rng() * 3));
    case 'park': return 0;
  }
}
