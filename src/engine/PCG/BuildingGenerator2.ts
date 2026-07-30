// BuildingGenerator2 — 增强版程序化建筑生成器。
//
// 与 `BuildingGenerator` 互补:本类提供面向「风格/楼层/窗户/屋顶/装饰/内部」
// 的可配置实例化 API,支持 5 种建筑风格、4 种屋顶、阳台/入口/空调/天线等装饰,
// 以及简化的内部楼板结构。产出顶点/索引/UV/法线/颜色(每顶点颜色)合并数据,
// 不绑定 BufferGeometry / Material / Scene,由调用方自行包装。
//
// 设计目标:
//   - 实例化 API:setStyle/setFloors/... 链式配置,generate() 一次性产出
//   - 每顶点颜色:facade/roof/window/accent 四色调色板,免材质即可区分部件
//   - 种子化 PRNG(mulberry32):同种子产出确定性建筑,便于复现/存档
//   - 风格影响装饰密度与色板默认值,但几何参数仍由显式属性驱动
//
// 用法:
//   const gen = new BuildingGenerator2();
//   gen.setStyle('sci-fi').setFloors(20).setDimensions(12, 10).setRoof('spire', 8);
//   const result = gen.generate();
//   // result.positions / indices / uvs / normals / colors -> BufferGeometry

/** 建筑风格。 */
export type BuildingStyle2 = 'modern' | 'classical' | 'industrial' | 'sci-fi' | 'asian';

/** 屋顶类型。 */
export type RoofType2 = 'flat' | 'pitched' | 'dome' | 'spire';

/**
 * RGB 颜色(各分量 0-1)。复用 Lights 模块的 RGBColor 类型,避免重复定义;
 * 仅内部使用,不重新导出(防止与 Lights barrel 在 engine `export *` 时产生歧义)。
 */
import type { RGBColor } from '../Lights/Light';

/** 窗户尺寸。 */
export interface WindowSize {
  w: number;
  h: number;
}

/** 单个部件的几何数据(中间形态,generate() 合并后丢弃)。 */
interface PartData {
  name: string;
  positions: number[];
  indices: number[];
  uvs: number[];
  normals: number[];
  colors: number[];
}

/** 部件元数据(generate 结果中保留,便于调用方分组渲染)。 */
export interface BuildingPartInfo {
  /** 部件名(foundation/floors/windows/roof/balconies/entrance/details/interior)。 */
  name: string;
  /** 顶点数。 */
  vertexCount: number;
  /** 索引数(= 三角形数 × 3)。 */
  indexCount: number;
}

/** generate() 返回的完整建筑数据。 */
export interface BuildingGenerator2Result {
  /** 顶点位置(XYZ × N)。 */
  positions: Float32Array;
  /** 索引(三角形)。 */
  indices: Uint32Array;
  /** UV 坐标(UV × N)。 */
  uvs: Float32Array;
  /** 法线(XYZ × N)。 */
  normals: Float32Array;
  /** 顶点颜色(RGB × N,0-1)。 */
  colors: Float32Array;
  /** 部件元数据列表。 */
  parts: BuildingPartInfo[];
  /** 建筑总高(含屋顶)。 */
  totalHeight: number;
  /** 楼层数。 */
  floorCount: number;
  /** 统计信息。 */
  stats: BuildingStats;
}

/** 建筑统计。 */
export interface BuildingStats {
  /** 总顶点数。 */
  vertexCount: number;
  /** 总三角形数。 */
  triangleCount: number;
  /** 总部件数。 */
  partCount: number;
  /** 窗户总数。 */
  windowCount: number;
  /** 阳台总数。 */
  balconyCount: number;
  /** 是否有入口。 */
  hasEntrance: boolean;
  /** 是否有空调。 */
  hasAirConditioning: boolean;
  /** 是否有天线。 */
  hasAntenna: boolean;
}

/** 种子化 PRNG(mulberry32,与 BuildingGenerator 同实现)。 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 风格默认色板。 */
const STYLE_PALETTES: Record<BuildingStyle2, { facade: RGBColor; roof: RGBColor; window: RGBColor; accent: RGBColor }> = {
  modern: { facade: { r: 0.85, g: 0.85, b: 0.88 }, roof: { r: 0.3, g: 0.3, b: 0.32 }, window: { r: 0.2, g: 0.4, b: 0.6 }, accent: { r: 0.15, g: 0.15, b: 0.18 } },
  classical: { facade: { r: 0.92, g: 0.88, b: 0.75 }, roof: { r: 0.45, g: 0.2, b: 0.15 }, window: { r: 0.3, g: 0.35, b: 0.4 }, accent: { r: 0.6, g: 0.5, b: 0.3 } },
  industrial: { facade: { r: 0.55, g: 0.55, b: 0.58 }, roof: { r: 0.25, g: 0.25, b: 0.27 }, window: { r: 0.4, g: 0.45, b: 0.5 }, accent: { r: 0.7, g: 0.4, b: 0.2 } },
  'sci-fi': { facade: { r: 0.2, g: 0.25, b: 0.35 }, roof: { r: 0.1, g: 0.15, b: 0.25 }, window: { r: 0.2, g: 0.8, b: 1.0 }, accent: { r: 0.3, g: 1.0, b: 0.8 } },
  asian: { facade: { r: 0.85, g: 0.75, b: 0.65 }, roof: { r: 0.5, g: 0.15, b: 0.12 }, window: { r: 0.6, g: 0.4, b: 0.25 }, accent: { r: 0.8, g: 0.6, b: 0.2 } },
};

/**
 * 增强版程序化建筑生成器(实例化 API)。
 *
 * 与 `BuildingGenerator` 区别:
 *   - `BuildingGenerator` 全静态方法,产出 BufferGeometry
 *   - `BuildingGenerator2` 实例化链式配置,产出带顶点颜色的合并数据 + 部件元数据
 */
export class BuildingGenerator2 {
  /** 建筑风格。 */
  style: BuildingStyle2 = 'modern';
  /** 楼层数。 */
  floors: number = 5;
  /** 单层高度。 */
  floorHeight: number = 3;
  /** 建筑宽度(X 方向)。 */
  width: number = 8;
  /** 建筑深度(Z 方向)。 */
  depth: number = 6;
  /** 窗户密度(0-1,控制每面每层窗户数)。 */
  windowDensity: number = 0.5;
  /** 单个窗户尺寸。 */
  windowSize: WindowSize = { w: 1, h: 1.5 };
  /** 屋顶类型。 */
  roofType: RoofType2 = 'flat';
  /** 屋顶高度(dome/spire 用)。 */
  roofHeight: number = 2;
  /** 是否有阳台。 */
  hasBalcony: boolean = false;
  /** 是否有入口。 */
  hasEntrance: boolean = true;
  /** 是否有空调。 */
  hasAirConditioning: boolean = false;
  /** 是否有天线。 */
  hasAntenna: boolean = false;
  /** 立面颜色。 */
  facadeColor: RGBColor = { ...STYLE_PALETTES.modern.facade };
  /** 屋顶颜色。 */
  roofColor: RGBColor = { ...STYLE_PALETTES.modern.roof };
  /** 窗户颜色。 */
  windowColor: RGBColor = { ...STYLE_PALETTES.modern.window };
  /** 装饰强调色。 */
  accentColor: RGBColor = { ...STYLE_PALETTES.modern.accent };
  /** 随机种子。 */
  seed: number = 0;

  /** 设置建筑风格(同时更新默认色板)。 */
  setStyle(style: BuildingStyle2): this {
    this.style = style;
    const p = STYLE_PALETTES[style];
    this.facadeColor = { ...p.facade };
    this.roofColor = { ...p.roof };
    this.windowColor = { ...p.window };
    this.accentColor = { ...p.accent };
    return this;
  }

  /** 设置楼层数。 */
  setFloors(floors: number): this {
    this.floors = Math.max(1, Math.floor(floors));
    return this;
  }

  /** 设置单层高度。 */
  setFloorHeight(height: number): this {
    this.floorHeight = Math.max(0.1, height);
    return this;
  }

  /** 设置建筑尺寸(宽 × 深)。 */
  setDimensions(width: number, depth: number): this {
    this.width = Math.max(0.1, width);
    this.depth = Math.max(0.1, depth);
    return this;
  }

  /** 设置窗户配置(密度 0-1 + 单窗尺寸)。 */
  setWindowConfig(density: number, size: WindowSize): this {
    this.windowDensity = Math.max(0, Math.min(1, density));
    this.windowSize = { w: Math.max(0.05, size.w), h: Math.max(0.05, size.h) };
    return this;
  }

  /** 设置屋顶(类型 + 高度)。 */
  setRoof(type: RoofType2, height: number): this {
    this.roofType = type;
    this.roofHeight = Math.max(0, height);
    return this;
  }

  /** 设置特征开关(阳台/入口/空调/天线)。 */
  setFeatures(balcony: boolean, entrance: boolean, ac: boolean, antenna: boolean): this {
    this.hasBalcony = balcony;
    this.hasEntrance = entrance;
    this.hasAirConditioning = ac;
    this.hasAntenna = antenna;
    return this;
  }

  /** 设置四色调色板。 */
  setColors(facade: RGBColor, roof: RGBColor, window: RGBColor, accent: RGBColor): this {
    this.facadeColor = { ...facade };
    this.roofColor = { ...roof };
    this.windowColor = { ...window };
    this.accentColor = { ...accent };
    return this;
  }

  /** 设置随机种子。 */
  setSeed(seed: number): this {
    this.seed = seed >>> 0;
    return this;
  }

  /** 获取建筑总高(楼层数 × 层高 + 屋顶高度)。 */
  getBuildingHeight(): number {
    const body = this.floors * this.floorHeight;
    const roof = this.computeRoofHeight();
    return body + roof;
  }

  /** 获取楼层数。 */
  getFloorCount(): number {
    return this.floors;
  }

  /** 计算实际屋顶高度(flat=0.05 薄顶,其余用 roofHeight)。 */
  private computeRoofHeight(): number {
    switch (this.roofType) {
      case 'flat': return 0.05;
      case 'pitched': return Math.min(this.width, this.depth) * 0.4;
      case 'dome': return this.roofHeight;
      case 'spire': return this.roofHeight;
      default: return 0;
    }
  }

  /**
   * 生成完整建筑(地基 + 楼层 + 窗户 + 屋顶 + 阳台 + 入口 + 装饰 + 内部)。
   * 返回合并的顶点/索引/UV/法线/颜色数组 + 部件元数据。
   */
  generate(): BuildingGenerator2Result {
    if (this.width <= 0 || this.depth <= 0 || this.floors <= 0 || this.floorHeight <= 0) {
      throw new Error('BuildingGenerator2: width/depth/floors/floorHeight 必须为正数');
    }

    const rng = mulberry32(this.seed);
    const parts: PartData[] = [];

    parts.push(this.generateFoundation());
    parts.push(this.generateFloors());
    parts.push(this.generateWindows(rng));
    parts.push(this.generateRoof());
    if (this.hasBalcony) parts.push(this.generateBalconies(rng));
    if (this.hasEntrance) parts.push(this.generateEntrance());
    parts.push(this.generateDetails(rng));
    parts.push(this.generateInterior());

    // 合并所有部件
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const partInfos: BuildingPartInfo[] = [];
    let vertexOffset = 0;
    let windowCount = 0;
    let balconyCount = 0;

    for (const part of parts) {
      for (let i = 0; i < part.positions.length; i++) positions.push(part.positions[i]);
      for (let i = 0; i < part.normals.length; i++) normals.push(part.normals[i]);
      for (let i = 0; i < part.uvs.length; i++) uvs.push(part.uvs[i]);
      for (let i = 0; i < part.colors.length; i++) colors.push(part.colors[i]);
      for (let i = 0; i < part.indices.length; i++) indices.push(part.indices[i] + vertexOffset);
      vertexOffset += part.positions.length / 3;

      partInfos.push({
        name: part.name,
        vertexCount: part.positions.length / 3,
        indexCount: part.indices.length,
      });

      if (part.name === 'windows') {
        windowCount = part.positions.length / 3 / 4; // 每窗 4 顶点
      } else if (part.name === 'balconies') {
        balconyCount = part.positions.length / 3 / 24; // 每阳台 6 面 × 4 顶点
      }
    }

    const stats: BuildingStats = {
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      partCount: parts.length,
      windowCount,
      balconyCount,
      hasEntrance: this.hasEntrance,
      hasAirConditioning: this.hasAirConditioning,
      hasAntenna: this.hasAntenna,
    };

    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      uvs: new Float32Array(uvs),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      parts: partInfos,
      totalHeight: this.getBuildingHeight(),
      floorCount: this.floors,
      stats,
    };
  }

  /** 生成地基(略大于建筑底面的薄板)。 */
  generateFoundation(): PartData {
    const part = newPart('foundation');
    const margin = 0.3;
    const halfW = this.width / 2 + margin;
    const halfD = this.depth / 2 + margin;
    const y0 = -0.5;
    const y1 = 0;
    addBox(part, -halfW, y0, -halfD, halfW, y1, halfD, this.facadeColor);
    return part;
  }

  /** 生成楼层主体(每层四面墙,空心矩形)。 */
  generateFloors(): PartData {
    const part = newPart('floors');
    const halfW = this.width / 2;
    const halfD = this.depth / 2;
    for (let f = 0; f < this.floors; f++) {
      const y0 = f * this.floorHeight;
      const y1 = (f + 1) * this.floorHeight;
      addBox(part, -halfW, y0, -halfD, halfW, y1, halfD, this.facadeColor);
    }
    return part;
  }

  /** 生成窗户(每层每面墙,数量由 windowDensity 决定)。 */
  generateWindows(rng: () => number): PartData {
    const part = newPart('windows');
    const halfW = this.width / 2;
    const halfD = this.depth / 2;
    // 每面每层窗户数:密度 0 → 1 个,密度 1 → max(8, width/1.5)
    const maxPerFace = Math.max(2, Math.floor(Math.min(this.width, this.depth) / 1.5));
    const perFace = Math.max(1, Math.round(this.windowDensity * maxPerFace));
    const winW = this.windowSize.w;
    const winH = this.windowSize.h;
    const offset = 0.01; // 向外偏移避免 z-fighting

    for (let f = 0; f < this.floors; f++) {
      const y = f * this.floorHeight + this.floorHeight / 2;
      // 四面墙:每面布置 perFace 个窗户,均匀分布
      // +X / -X 面:沿 Z 轴分布
      for (let i = 0; i < perFace; i++) {
        const t = perFace === 1 ? 0.5 : (i + 0.5) / perFace;
        const z = -halfD + t * this.depth;
        const jitter = (rng() - 0.5) * 0.05;
        addQuad(part, halfW + offset, y, z + jitter, winW, winH, 1, 0, 0, this.windowColor);
        addQuad(part, -halfW - offset, y, z - jitter, winW, winH, -1, 0, 0, this.windowColor);
      }
      // +Z / -Z 面:沿 X 轴分布
      for (let i = 0; i < perFace; i++) {
        const t = perFace === 1 ? 0.5 : (i + 0.5) / perFace;
        const x = -halfW + t * this.width;
        const jitter = (rng() - 0.5) * 0.05;
        addQuad(part, x + jitter, y, halfD + offset, winW, winH, 0, 0, 1, this.windowColor);
        addQuad(part, x - jitter, y, -halfD - offset, winW, winH, 0, 0, -1, this.windowColor);
      }
    }
    return part;
  }

  /** 生成屋顶(flat/pitched/dome/spire)。 */
  generateRoof(): PartData {
    const part = newPart('roof');
    const halfW = this.width / 2;
    const halfD = this.depth / 2;
    const baseY = this.floors * this.floorHeight;

    if (this.roofType === 'flat') {
      // 薄顶板
      addBox(part, -halfW, baseY, -halfD, halfW, baseY + 0.05, halfD, this.roofColor);
    } else if (this.roofType === 'pitched') {
      // 四面坡屋顶(4 三角形交于顶点)
      const peakY = baseY + this.computeRoofHeight();
      addTriangleFan(part, halfW, halfD, baseY, peakY, this.roofColor);
    } else if (this.roofType === 'dome') {
      // 半球穹顶(经纬度近似)
      addDome(part, halfW, halfD, baseY, this.computeRoofHeight(), this.roofColor);
    } else {
      // spire:细高锥
      const h = this.computeRoofHeight();
      const r = Math.min(this.width, this.depth) * 0.3;
      addCone(part, 0, baseY, 0, r, h, this.roofColor);
    }
    return part;
  }

  /** 生成阳台(每 2 层一个,挑出于 +X 面)。 */
  generateBalconies(rng: () => number): PartData {
    const part = newPart('balconies');
    const halfW = this.width / 2;
    const halfD = this.depth / 2;
    const balDepth = 0.6;
    const balLen = Math.min(this.width * 0.4, 2);
    const balThickness = 0.1;

    for (let f = 1; f < this.floors; f += 2) {
      const y = f * this.floorHeight;
      const cx = (rng() - 0.5) * (this.width - balLen) * 0.5;
      // 阳台底板
      addBox(
        part,
        halfW, y,
        cx - balLen / 2,
        halfW + balDepth, y + balThickness,
        cx + balLen / 2,
        this.accentColor,
      );
      // 阳台前栏(薄板)
      addBox(
        part,
        halfW + balDepth - balThickness, y + balThickness,
        cx - balLen / 2,
        halfW + balDepth, y + balThickness + 0.8,
        cx + balLen / 2,
        this.accentColor,
      );
    }
    void halfD;
    return part;
  }

  /** 生成入口(底层 -Z 面中心门洞 + 门楣)。 */
  generateEntrance(): PartData {
    const part = newPart('entrance');
    const halfD = this.depth / 2;
    const doorW = Math.min(this.width * 0.2, 1.5);
    const doorH = Math.min(this.floorHeight * 0.8, 2.2);
    const offset = 0.02;

    // 门(玻璃色)
    addQuad(part, 0, doorH / 2, -halfD - offset, doorW, doorH, 0, 0, -1, this.windowColor);
    // 门框(强调色,四条窄板简化为两个立柱)
    const frameT = 0.08;
    addBox(part, -doorW / 2 - frameT, doorH / 2, -halfD - offset, -doorW / 2, doorH + 0.1, -halfD - offset + 0.05, this.accentColor);
    addBox(part, doorW / 2, doorH / 2, -halfD - offset, doorW / 2 + frameT, doorH + 0.1, -halfD - offset + 0.05, this.accentColor);
    // 门楣(横板)
    addBox(part, -doorW / 2 - frameT, doorH + 0.1, -halfD - offset, doorW / 2 + frameT, doorH + 0.25, -halfD - offset + 0.1, this.accentColor);
    return part;
  }

  /** 生成装饰(空调外机 / 天线)。 */
  generateDetails(rng: () => number): PartData {
    const part = newPart('details');
    const baseY = this.floors * this.floorHeight;
    const halfW = this.width / 2;
    const halfD = this.depth / 2;

    if (this.hasAirConditioning) {
      // 屋顶 2-3 个空调外机(小方盒)
      const count = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        const x = (rng() - 0.5) * (this.width - 1);
        const z = (rng() - 0.5) * (this.depth - 1);
        addBox(part, x - 0.3, baseY + 0.05, z - 0.3, x + 0.3, baseY + 0.6, z + 0.3, this.accentColor);
      }
    }

    if (this.hasAntenna) {
      // 屋顶天线:细高杆 + 顶部小盒
      const poleH = 3;
      const poleR = 0.05;
      const ax = 0;
      const az = 0;
      addBox(part, ax - poleR, baseY, az - poleR, ax + poleR, baseY + poleH, az + poleR, this.accentColor);
      addBox(part, ax - 0.15, baseY + poleH, az - 0.15, ax + 0.15, baseY + poleH + 0.3, az + 0.15, this.accentColor);
    }

    void halfW; void halfD;
    return part;
  }

  /** 生成内部结构(简化:每层一块楼板,略小于建筑 footprint)。 */
  generateInterior(): PartData {
    const part = newPart('interior');
    const inset = 0.2;
    const halfW = this.width / 2 - inset;
    const halfD = this.depth / 2 - inset;
    const slabThickness = 0.08;
    // 内部楼板色 = 立面色 × 0.7(变暗)
    const slabColor: RGBColor = {
      r: this.facadeColor.r * 0.7,
      g: this.facadeColor.g * 0.7,
      b: this.facadeColor.b * 0.7,
    };
    for (let f = 0; f <= this.floors; f++) {
      const y = f * this.floorHeight - slabThickness / 2;
      addBox(part, -halfW, y - slabThickness / 2, -halfD, halfW, y + slabThickness / 2, halfD, slabColor);
    }
    return part;
  }

  /** 获取统计(不触发 generate)。 */
  getStats(): BuildingStats {
    return {
      vertexCount: 0,
      triangleCount: 0,
      partCount: 8, // foundation + floors + windows + roof + (balcony?) + (entrance?) + details + interior
      windowCount: 0,
      balconyCount: 0,
      hasEntrance: this.hasEntrance,
      hasAirConditioning: this.hasAirConditioning,
      hasAntenna: this.hasAntenna,
    };
  }
}

// ── 内部辅助:部件构造 ────────────────────────────────────────────────

function newPart(name: string): PartData {
  return { name, positions: [], indices: [], uvs: [], normals: [], colors: [] };
}

/**
 * 添加一个轴对齐盒(min..max 角点)的 6 面,每面 4 顶点。
 * 法线朝外,UV 在每面上 [0..1]²。
 */
function addBox(
  part: PartData,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  color: RGBColor,
): void {
  const { r: cr, g: cg, b: cb } = color;
  // 8 角点
  const verts: [number, number, number][] = [
    [minX, minY, minZ], // 0
    [maxX, minY, minZ], // 1
    [maxX, maxY, minZ], // 2
    [minX, maxY, minZ], // 3
    [minX, minY, maxZ], // 4
    [maxX, minY, maxZ], // 5
    [maxX, maxY, maxZ], // 6
    [minX, maxY, maxZ], // 7
  ];

  // 6 面,每面 4 顶点(逆时针外法线)
  // 面定义:[v0,v1,v2,v3, nx,ny,nz]
  const faces: [number, number, number, number, number, number, number][] = [
    // -Z 面
    [0, 1, 2, 3, 0, 0, -1],
    // +Z 面
    [5, 4, 7, 6, 0, 0, 1],
    // -X 面
    [4, 0, 3, 7, -1, 0, 0],
    // +X 面
    [1, 5, 6, 2, 1, 0, 0],
    // -Y 面
    [4, 5, 1, 0, 0, -1, 0],
    // +Y 面
    [3, 2, 6, 7, 0, 1, 0],
  ];

  for (const [a, b, c, d, nx, ny, nz] of faces) {
    const base = part.positions.length / 3;
    for (const idx of [a, b, c, d]) {
      part.positions.push(verts[idx][0], verts[idx][1], verts[idx][2]);
      part.normals.push(nx, ny, nz);
      part.colors.push(cr, cg, cb);
    }
    part.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    part.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/**
 * 添加一个四边形(中心 + 法线 + 宽高),用于窗户/门等平面贴片。
 */
function addQuad(
  part: PartData,
  cx: number, cy: number, cz: number,
  w: number, h: number,
  nx: number, ny: number, nz: number,
  color: RGBColor,
): void {
  const { r: cr, g: cg, b: cb } = color;
  // 平面内两轴:up=(0,1,0)(若法线非 Y),right=normal×up
  let ux = 0, uy = 0, uz = 0;
  let vx = 0, vy = 0, vz = 0;
  if (Math.abs(ny) < 0.5) {
    // 竖直面:up=Y,right=normal×Y→(nz,0,-nx)
    ux = 0; uy = 1; uz = 0;
    vx = nz; vy = 0; vz = -nx;
  } else {
    // 水平面:up=Z 或 -Z
    ux = 1; uy = 0; uz = 0;
    vx = 0; vy = 0; vz = ny > 0 ? 1 : -1;
  }
  const hw = w / 2;
  const hh = h / 2;
  const base = part.positions.length / 3;
  // 4 角点:cx-ux*hw-vx*hh 等
  part.positions.push(
    cx - ux * hw - vx * hh, cy - uy * hw - vy * hh, cz - uz * hw - vz * hh,
    cx + ux * hw - vx * hh, cy + uy * hw - vy * hh, cz + uz * hw - vz * hh,
    cx + ux * hw + vx * hh, cy + uy * hw + vy * hh, cz + uz * hw + vz * hh,
    cx - ux * hw + vx * hh, cy - uy * hw + vy * hh, cz - uz * hw + vz * hh,
  );
  for (let i = 0; i < 4; i++) {
    part.normals.push(nx, ny, nz);
    part.colors.push(cr, cg, cb);
  }
  part.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  part.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * 添加四面坡屋顶(4 三角形交于顶点)。
 */
function addTriangleFan(
  part: PartData,
  halfW: number, halfD: number,
  baseY: number, peakY: number,
  color: RGBColor,
): void {
  const { r: cr, g: cg, b: cb } = color;
  const peakX = 0, peakZ = 0;
  // 4 底边角点
  const corners: [number, number][] = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    // 法线(简化:朝外 + 上)
    const nx = (ax + bx) / 2;
    const nz = (az + bz) / 2;
    const nlen = Math.hypot(nx, nz, peakY - baseY) || 1;
    const fnx = nx / nlen, fny = (peakY - baseY) / nlen, fnz = nz / nlen;
    const base = part.positions.length / 3;
    part.positions.push(ax, baseY, az, bx, baseY, bz, peakX, peakY, peakZ);
    for (let k = 0; k < 3; k++) {
      part.normals.push(fnx, fny, fnz);
      part.colors.push(cr, cg, cb);
    }
    part.uvs.push(0, 0, 1, 0, 0.5, 1);
    part.indices.push(base, base + 1, base + 2);
  }
}

/**
 * 添加半球穹顶(经纬度近似)。
 */
function addDome(
  part: PartData,
  halfW: number, halfD: number,
  baseY: number, height: number,
  color: RGBColor,
): void {
  const { r: cr, g: cg, b: cb } = color;
  const rx = halfW;
  const rz = halfD;
  const ry = height;
  const segs = 12; // 经度分段
  const rings = 6;  // 纬度分段(上半球)
  // 生成网格顶点
  const grid: [number, number, number][][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI / 2; // 0(赤道) .. π/2(顶)
    const ring: [number, number, number][] = [];
    for (let j = 0; j <= segs; j++) {
      const theta = (j / segs) * Math.PI * 2;
      const x = rx * Math.cos(phi) * Math.cos(theta);
      const z = rz * Math.cos(phi) * Math.sin(theta);
      const y = ry * Math.sin(phi);
      ring.push([x, baseY + y, z]);
    }
    grid.push(ring);
  }
  // 生成四边形面
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = grid[i][j];
      const b = grid[i][j + 1];
      const c = grid[i + 1][j + 1];
      const d = grid[i + 1][j];
      // 法线(从中心向外,简化)
      const nx = (a[0] + b[0] + c[0] + d[0]) / 4 / (rx || 1);
      const ny = (a[1] + b[1] + c[1] + d[1]) / 4 - baseY;
      const nz = (a[2] + b[2] + c[2] + d[2]) / 4 / (rz || 1);
      const nlen = Math.hypot(nx, ny, nz) || 1;
      const base = part.positions.length / 3;
      for (const v of [a, b, c, d]) {
        part.positions.push(v[0], v[1], v[2]);
        part.normals.push(nx / nlen, ny / nlen, nz / nlen);
        part.colors.push(cr, cg, cb);
      }
      part.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      part.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

/**
 * 添加圆锥(底面圆 + 侧三角)。
 */
function addCone(
  part: PartData,
  cx: number, cy: number, cz: number,
  radius: number, height: number,
  color: RGBColor,
): void {
  const { r: cr, g: cg, b: cb } = color;
  const segs = 12;
  const tipY = cy + height;
  // 底面(法线 -Y)
  const baseIdx = part.positions.length / 3;
  for (let i = 0; i < segs; i++) {
    const theta = (i / segs) * Math.PI * 2;
    part.positions.push(cx + Math.cos(theta) * radius, cy, cz + Math.sin(theta) * radius);
    part.normals.push(0, -1, 0);
    part.colors.push(cr, cg, cb);
  }
  for (let i = 1; i < segs - 1; i++) {
    part.indices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
  }
  // 侧面(三角形:底边两顶点 + 尖顶)
  const tipIdx = part.positions.length / 3;
  part.positions.push(cx, tipY, cz);
  part.normals.push(0, 1, 0); // 简化法线
  part.colors.push(cr, cg, cb);
  for (let i = 0; i < segs; i++) {
    const i0 = baseIdx + i;
    const i1 = baseIdx + (i + 1) % segs;
    part.indices.push(i0, i1, tipIdx);
  }
}
