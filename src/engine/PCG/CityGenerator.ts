// CityGenerator — 程序化城市生成器(网格化街区)。
//
// 把 gridSize × gridSize 个街区铺成网格,每个街区按 buildingDensity
// 决定放置建筑 / 公园 / 空地。道路沿街区边界布局。
//
// 输出:道路几何体(合并网格)+ 建筑实例元数据(中心位置、尺寸、楼层)
// + 公园位置元数据。建筑几何体由调用方按需通过 BuildingGenerator
// 二次生成,本类只产出布局信息(避免一次性生成海量几何体)。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { NoiseGenerator } from './NoiseGenerator';

/** 城市生成选项。 */
export interface CityOptions {
  /** 网格边数(gridSize × gridSize 街区)。 */
  gridSize: number;
  /** 单个街区边长(米)。 */
  blockSize: number;
  /** 道路宽度(米)。 */
  roadWidth: number;
  /** 建筑密度(0-1,越大建筑越多)。 */
  buildingDensity: number;
  /** 随机种子。 */
  seed?: number;
  /** 建筑最大楼层数。 */
  maxFloors?: number;
}

/** 单栋建筑布局信息。 */
export interface CityBuilding {
  /** 中心 X。 */
  x: number;
  /** 中心 Z。 */
  z: number;
  /** 宽度。 */
  width: number;
  /** 深度。 */
  depth: number;
  /** 楼层数。 */
  floors: number;
  /** 单层高度。 */
  floorHeight: number;
  /** Y 旋转(弧度)。 */
  rotationY: number;
}

/** 单个公园布局信息。 */
export interface CityPark {
  /** 中心 X。 */
  x: number;
  /** 中心 Z。 */
  z: number;
  /** 宽度。 */
  width: number;
  /** 深度。 */
  depth: number;
  /** 树木数量。 */
  treeCount: number;
}

/** 城市生成结果。 */
export interface CityResult {
  /** 道路几何体(合并)。 */
  roads: BufferGeometry;
  /** 建筑布局列表(不含几何体)。 */
  buildings: CityBuilding[];
  /** 公园布局列表。 */
  parks: CityPark[];
  /** 统计信息。 */
  stats: CityStats;
}

/** 城市统计。 */
export interface CityStats {
  gridSize: number;
  blockSize: number;
  roadWidth: number;
  totalArea: number;
  buildingCount: number;
  parkCount: number;
  emptyLotCount: number;
  roadArea: number;
}

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

/**
 * 程序化城市生成器(全部静态方法)。
 *
 * 用法:
 *   const city = CityGenerator.generate({ gridSize: 8, blockSize: 30, roadWidth: 6, buildingDensity: 0.7 });
 *   scene.add(new Mesh(city.roads, roadMaterial));
 *   for (const b of city.buildings) { /* 用 BuildingGenerator 生成几何体 *\/ }
 */
export class CityGenerator {
  /**
   * 生成完整城市(道路 + 建筑布局 + 公园布局)。
   */
  static generate(options: CityOptions): CityResult {
    const {
      gridSize,
      blockSize,
      roadWidth,
      buildingDensity,
      seed = 0,
      maxFloors = 10,
    } = options;

    if (gridSize <= 0 || blockSize <= 0 || roadWidth <= 0) {
      throw new Error(`CityGenerator: gridSize/blockSize/roadWidth 必须为正数`);
    }
    if (buildingDensity < 0 || buildingDensity > 1) {
      throw new Error(`CityGenerator: buildingDensity 必须在 [0, 1]`);
    }

    const rng = mulberry32(seed);
    const noise = new NoiseGenerator(seed);

    const roads = this.generateRoads(gridSize, blockSize, roadWidth);
    const { buildings, parks, emptyCount } = this.generateBuildings({
      gridSize,
      blockSize,
      roadWidth,
      buildingDensity,
      maxFloors,
      rng,
      noise,
    });
    const parkList = this.generateParks({
      gridSize,
      blockSize,
      roadWidth,
      buildings,
      parks,
      rng,
    });

    const totalArea = gridSize * gridSize * blockSize * blockSize;
    const roadArea = (gridSize + 1) * gridSize * blockSize * roadWidth;
    const stats: CityStats = {
      gridSize,
      blockSize,
      roadWidth,
      totalArea,
      buildingCount: buildings.length,
      parkCount: parkList.length,
      emptyLotCount: emptyCount,
      roadArea,
    };

    return { roads, buildings, parks: parkList, stats };
  }

  /**
   * 生成道路网格(沿街区边界的水平/垂直路面)。
   * 道路为薄 BoxGeometry 合并而成,Y=0。
   */
  static generateRoads(gridSize: number, blockSize: number, roadWidth: number): BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const cellPitch = blockSize + roadWidth;
    const totalSpan = gridSize * cellPitch + roadWidth;
    const halfTotal = totalSpan / 2;
    const halfRoad = roadWidth / 2;

    function addRoadSegment(
      cx: number, cz: number, w: number, d: number,
    ): void {
      const base = positions.length / 3;
      const hw = w / 2, hd = d / 2;
      positions.push(
        cx - hw, 0, cz - hd,
        cx + hw, 0, cz - hd,
        cx + hw, 0, cz + hd,
        cx - hw, 0, cz + hd,
      );
      for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    // 横向道路(gridSize + 1 条)
    for (let r = 0; r <= gridSize; r++) {
      const z = -halfTotal + r * cellPitch + halfRoad;
      addRoadSegment(0, z, totalSpan, roadWidth);
    }
    // 纵向道路(gridSize + 1 条)
    for (let c = 0; c <= gridSize; c++) {
      const x = -halfTotal + c * cellPitch + halfRoad;
      addRoadSegment(x, 0, roadWidth, totalSpan);
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    return geo;
  }

  /**
   * 为每个街区按密度决定放置建筑或留空。
   */
  static generateBuildings(opts: {
    gridSize: number;
    blockSize: number;
    roadWidth: number;
    buildingDensity: number;
    maxFloors: number;
    rng: () => number;
    noise: NoiseGenerator;
  }): { buildings: CityBuilding[]; parks: CityPark[]; emptyCount: number } {
    const { gridSize, blockSize, roadWidth, buildingDensity, maxFloors, rng, noise } = opts;
    const cellPitch = blockSize + roadWidth;
    const totalSpan = gridSize * cellPitch + roadWidth;
    const halfTotal = totalSpan / 2;
    const buildings: CityBuilding[] = [];
    const parks: CityPark[] = [];
    let emptyCount = 0;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const blockCenterX = -halfTotal + roadWidth + c * cellPitch + blockSize / 2;
        const blockCenterZ = -halfTotal + roadWidth + r * cellPitch + blockSize / 2;
        // 用噪声 + 密度阈值决定该街区是否建筑
        const n = (noise.fbm2D(c * 0.3, r * 0.3, 4, 0.5, 2) + 1) * 0.5; // [0,1]
        if (n < buildingDensity) {
          // 建筑:在该街区内随机尺寸(留出周边 1m 间距)
          const margin = 1;
          const widthRatio = 0.6 + rng() * 0.35;
          const depthRatio = 0.6 + rng() * 0.35;
          const width = (blockSize - margin * 2) * widthRatio;
          const depth = (blockSize - margin * 2) * depthRatio;
          // 楼层由噪声决定,2..maxFloors
          const floors = Math.max(1, Math.min(maxFloors, Math.floor(2 + (n / Math.max(buildingDensity, 1e-6)) * maxFloors)));
          const rotationY = rng() < 0.5 ? 0 : Math.PI / 2;
          buildings.push({
            x: blockCenterX,
            z: blockCenterZ,
            width,
            depth,
            floors,
            floorHeight: 3,
            rotationY,
          });
        } else if (rng() < 0.3) {
          // 部分空地变为公园
          parks.push({
            x: blockCenterX,
            z: blockCenterZ,
            width: blockSize - 2,
            depth: blockSize - 2,
            treeCount: Math.floor(3 + rng() * 5),
          });
        } else {
          emptyCount++;
        }
      }
    }
    return { buildings, parks, emptyCount };
  }

  /**
   * 生成公园布局(基于上一步生成的 parks 元数据,补充树木数量)。
   * 本方法主要是 API 完整性:已由 generateBuildings 内联产生,
   * 这里仅做去重/规范化。
   */
  static generateParks(opts: {
    gridSize: number;
    blockSize: number;
    roadWidth: number;
    buildings: CityBuilding[];
    parks: CityPark[];
    rng: () => number;
  }): CityPark[] {
    void opts; // 元数据已在 generateBuildings 中生成
    return opts.parks;
  }

  /**
   * 返回城市统计(基于已生成结果)。
   */
  static getStats(result: CityResult): CityStats {
    return result.stats;
  }
}
