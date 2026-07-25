// BuildingGenerator — 程序化建筑生成器。
//
// 由 width × depth × floors × floorHeight 参数化生成分层建筑,
// 每层由四面墙构成,屋顶可选 flat / peaked / gabled。
// 门/窗以独立 BufferGeometry 返回,由调用方附加材质后挂到场景。
//
// 几何约定:
//   * 建筑基底中心在原点,Y 轴向上
//   * 墙厚度为 0(平面面片),由材质/双面渲染处理
//   * 屋顶 flat = 顶面平面,peaked = 四面坡屋顶,gabled = 双坡屋顶
//   * 窗户/门为独立 PlaneGeometry,UV 已就绪
//
// 设计取向:产出 BufferGeometry + 元数据,不绑定 Material / Scene,
// 与 NoiseGenerator 同样保持"纯几何"职责。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 屋顶类型。 */
export type RoofType = 'flat' | 'peaked' | 'gabled';

/** 建筑风格(影响窗墙比/装饰,本实现仅作为元数据保留)。 */
export type BuildingStyle = 'modern' | 'classic' | 'industrial';

/** 建筑生成选项。 */
export interface BuildingOptions {
  /** 建筑宽度(X 方向)。 */
  width: number;
  /** 建筑深度(Z 方向)。 */
  depth: number;
  /** 楼层数。 */
  floors: number;
  /** 单层高度。 */
  floorHeight: number;
  /** 屋顶类型。 */
  roof?: RoofType;
  /** 建筑风格。 */
  style?: BuildingStyle;
  /** 每层每面墙的窗户列数(默认 3)。 */
  windowsPerFloor?: number;
  /** 种子(影响门/窗位置抖动)。 */
  seed?: number;
}

/** 建筑生成结果。 */
export interface BuildingResult {
  /** 主体(墙体+屋顶合并)几何体。 */
  geometry: BufferGeometry;
  /** 单独的窗户几何体(平面片集合)。 */
  windows: BufferGeometry;
  /** 单独的门几何体(底部一层入口)。 */
  doors: BufferGeometry;
  /** 元数据:每层底面 Y。 */
  floorYs: number[];
  /** 元数据:建筑总高。 */
  totalHeight: number;
  /** 元数据:屋顶类型。 */
  roof: RoofType;
  /** 元数据:风格。 */
  style: BuildingStyle;
}

/** 简易种子化 PRNG(mulberry32,与 NoiseGenerator 同实现)。 */
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
 * 程序化建筑生成器(全部静态方法)。
 *
 * 用法:
 *   const result = BuildingGenerator.generate({ width: 8, depth: 6, floors: 4, floorHeight: 3 });
 *   scene.add(new Mesh(result.geometry, material));
 */
export class BuildingGenerator {
  /**
   * 生成完整建筑(墙体 + 屋顶 + 窗户 + 门)。
   */
  static generate(options: BuildingOptions): BuildingResult {
    const {
      width,
      depth,
      floors,
      floorHeight,
      roof = 'flat',
      style = 'modern',
      windowsPerFloor = 3,
      seed = 0,
    } = options;

    if (width <= 0 || depth <= 0 || floors <= 0 || floorHeight <= 0) {
      throw new Error(`BuildingGenerator: width/depth/floors/floorHeight 必须为正数`);
    }

    const rng = mulberry32(seed);
    const floorYs: number[] = [];
    const wallParts: BufferGeometry[] = [];
    for (let f = 0; f < floors; f++) {
      floorYs.push(f * floorHeight);
      wallParts.push(this.generateFloor(f, { width, depth, floorHeight }));
    }
    const totalHeight = floors * floorHeight;
    const roofGeo = this.generateRoof(roof, { width, depth, baseY: totalHeight });
    wallParts.push(roofGeo);

    const geometry = this._mergeGeometries(wallParts);
    const windows = this.generateWindows(geometry, {
      width, depth, floors, floorHeight, windowsPerFloor, rng,
    });
    const doors = this.generateDoors(geometry, { width, depth, floorHeight, rng });

    return {
      geometry,
      windows,
      doors,
      floorYs,
      totalHeight,
      roof,
      style,
    };
  }

  /**
   * 生成单层墙体(四面墙围成空心矩形)。
   * @param floorIndex 楼层索引(0 = 底层)
   */
  static generateFloor(
    floorIndex: number,
    opts: { width: number; depth: number; floorHeight: number },
  ): BufferGeometry {
    const { width, depth, floorHeight } = opts;
    const baseY = floorIndex * floorHeight;
    const halfW = width / 2;
    const halfD = depth / 2;

    // 四面墙顶点:每面墙 4 个顶点(矩形),法线朝外
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // 每面墙:三角形 (a,b,c) + (a,c,d),逆时针(从外看)
    function addWall(
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      dx: number, dy: number, dz: number,
      nx: number, ny: number, nz: number,
    ): void {
      const base = positions.length / 3;
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      for (let i = 0; i < 4; i++) normals.push(nx, ny, nz);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    // +X 面
    addWall(
      halfW, baseY, -halfD,
      halfW, baseY, halfD,
      halfW, baseY + floorHeight, halfD,
      halfW, baseY + floorHeight, -halfD,
      1, 0, 0,
    );
    // -X 面
    addWall(
      -halfW, baseY, halfD,
      -halfW, baseY, -halfD,
      -halfW, baseY + floorHeight, -halfD,
      -halfW, baseY + floorHeight, halfD,
      -1, 0, 0,
    );
    // +Z 面
    addWall(
      -halfW, baseY, halfD,
      halfW, baseY, halfD,
      halfW, baseY + floorHeight, halfD,
      -halfW, baseY + floorHeight, halfD,
      0, 0, 1,
    );
    // -Z 面
    addWall(
      halfW, baseY, -halfD,
      -halfW, baseY, -halfD,
      -halfW, baseY + floorHeight, -halfD,
      halfW, baseY + floorHeight, -halfD,
      0, 0, -1,
    );

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    return geo;
  }

  /**
   * 生成屋顶。
   * @param type  flat | peaked | gabled
   */
  static generateRoof(
    type: RoofType,
    opts: { width: number; depth: number; baseY: number },
  ): BufferGeometry {
    const { width, depth, baseY } = opts;
    const halfW = width / 2;
    const halfD = depth / 2;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    function addFace(
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      dx: number, dy: number, dz: number,
      nx: number, ny: number, nz: number,
    ): void {
      const base = positions.length / 3;
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      for (let i = 0; i < 4; i++) normals.push(nx, ny, nz);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    if (type === 'flat') {
      // 顶面平面(法线 +Y)
      addFace(
        -halfW, baseY, -halfD,
        halfW, baseY, -halfD,
        halfW, baseY, halfD,
        -halfW, baseY, halfD,
        0, 1, 0,
      );
    } else if (type === 'peaked') {
      // 四面坡屋顶:四三角形交汇于顶点
      const peakY = baseY + Math.min(width, depth) * 0.4;
      const peakX = 0, peakZ = 0;
      // 四三角形(每面 3 顶点)
      function addTri(
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        nx: number, ny: number, nz: number,
      ): void {
        const base = positions.length / 3;
        positions.push(ax, ay, az, bx, by, bz, peakX, peakY, peakZ);
        for (let i = 0; i < 3; i++) normals.push(nx, ny, nz);
        uvs.push(0, 0, 1, 0, 0.5, 1);
        indices.push(base, base + 1, base + 2);
      }
      addTri(-halfW, baseY, -halfD, halfW, baseY, -halfD, 0, 1, -1);
      addTri(halfW, baseY, -halfD, halfW, baseY, halfD, 1, 1, 0);
      addTri(halfW, baseY, halfD, -halfW, baseY, halfD, 0, 1, 1);
      addTri(-halfW, baseY, halfD, -halfW, baseY, -halfD, -1, 1, 0);
    } else {
      // gabled:双坡屋顶(沿 X 轴脊)
      const ridgeY = baseY + Math.min(width, depth) * 0.5;
      // 两个斜面(法线带 Y 分量)
      addFace(
        -halfW, baseY, -halfD,
        halfW, baseY, -halfD,
        halfW, ridgeY, 0,
        -halfW, ridgeY, 0,
        0, 1, -1,
      );
      addFace(
        halfW, baseY, halfD,
        -halfW, baseY, halfD,
        -halfW, ridgeY, 0,
        halfW, ridgeY, 0,
        0, 1, 1,
      );
      // 两侧山墙(三角形)
      function addGable(
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        nx: number,
      ): void {
        const base = positions.length / 3;
        positions.push(ax, ay, az, bx, by, bz, 0, ridgeY, 0);
        for (let i = 0; i < 3; i++) normals.push(nx, 0, 0);
        uvs.push(0, 0, 1, 0, 0.5, 1);
        indices.push(base, base + 1, base + 2);
      }
      addGable(halfW, baseY, -halfD, halfW, baseY, halfD, 1);
      addGable(-halfW, baseY, halfD, -halfW, baseY, -halfD, -1);
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
   * 在墙上生成窗户(每层每面墙 windowsPerFloor 个矩形平面)。
   * @param wallMesh 墙体几何体(目前仅用于推断窗户范围;实际位置由 opts 决定)
   */
  static generateWindows(
    wallMesh: BufferGeometry,
    opts: {
      width: number;
      depth: number;
      floors: number;
      floorHeight: number;
      windowsPerFloor: number;
      rng: () => number;
    },
  ): BufferGeometry {
    const { width, depth, floors, floorHeight, windowsPerFloor, rng } = opts;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    function addWindow(
      cx: number, cy: number, cz: number,
      w: number, h: number,
      nx: number, ny: number, nz: number,
    ): void {
      const base = positions.length / 3;
      // 在墙平面内构造矩形,法线方向作为平面外方向
      // 简化:沿墙的法线方向 +0.001 偏移,避免 z-fighting
      const offset = 0.001;
      const ox = nx * offset, oy = ny * offset, oz = nz * offset;
      // 选择平面内两个轴
      let ux = 0, uy = 0, uz = 0;
      let vx = 0, vy = 0, vz = 0;
      if (Math.abs(ny) < 0.5) {
        // 墙是竖直面,平面内两轴为 Y 和切线
        ux = 0; uy = 1; uz = 0;
        vx = nz; vy = 0; vz = -nx;
      } else {
        // 顶面/底面
        ux = 1; uy = 0; uz = 0;
        vx = 0; vy = 0; vz = 1;
      }
      const hw = w / 2, hh = h / 2;
      const ax = cx - ux * hw - vx * hh + ox;
      const ay = cy - uy * hw - vy * hh + oy;
      const az = cz - uz * hw - vz * hh + oz;
      const bx = cx + ux * hw - vx * hh + ox;
      const by = cy + uy * hw - vy * hh + oy;
      const bz = cz + uz * hw - vz * hh + oz;
      const cxp = cx + ux * hw + vx * hh + ox;
      const cyp = cy + uy * hw + vy * hh + oy;
      const czp = cz + uz * hw + vz * hh + oz;
      const dx = cx - ux * hw + vx * hh + ox;
      const dy = cy - uy * hw + vy * hh + oy;
      const dz = cz - uz * hw + vz * hh + oz;
      positions.push(ax, ay, az, bx, by, bz, cxp, cyp, czp, dx, dy, dz);
      for (let i = 0; i < 4; i++) normals.push(nx, ny, nz);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const winW = Math.min(width, depth) / (windowsPerFloor + 1) * 0.7;
    const winH = floorHeight * 0.5;
    const halfW = width / 2;
    const halfD = depth / 2;

    for (let f = 0; f < floors; f++) {
      const y = f * floorHeight + floorHeight * 0.5;
      for (let i = 0; i < windowsPerFloor; i++) {
        const t = (i + 1) / (windowsPerFloor + 1);
        // +X 面
        addWindow(halfW, y, -halfD + t * depth, winW, winH, 1, 0, 0);
        // -X 面
        addWindow(-halfW, y, halfD - t * depth, winW, winH, -1, 0, 0);
        // +Z 面
        addWindow(-halfW + t * width, y, halfD, winW, winH, 0, 0, 1);
        // -Z 面
        addWindow(halfW - t * width, y, -halfD, winW, winH, 0, 0, -1);
      }
    }

    // 引用 rng 避免未使用警告(未来可在此加入随机抖动)
    void rng;

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    // wallMesh 仅用于 API 一致性,引用一下避免 TS 未使用错误
    void wallMesh;
    return geo;
  }

  /**
   * 在底层 -Z 面中心生成一扇门。
   */
  static generateDoors(
    wallMesh: BufferGeometry,
    opts: {
      width: number;
      depth: number;
      floorHeight: number;
      rng: () => number;
    },
  ): BufferGeometry {
    const { width, depth, floorHeight } = opts;
    const doorW = Math.min(width * 0.2, 1.5);
    const doorH = Math.min(floorHeight * 0.8, 2.2);
    const halfD = depth / 2;
    const cx = 0;
    const cz = -halfD;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const base = 0;
    positions.push(
      cx - doorW / 2, 0, cz,
      cx + doorW / 2, 0, cz,
      cx + doorW / 2, doorH, cz,
      cx - doorW / 2, doorH, cz,
    );
    for (let i = 0; i < 4; i++) normals.push(0, 0, -1);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    void wallMesh;
    void opts.rng;
    return geo;
  }

  // ── 内部:合并多个 BufferGeometry ──────────────────────────────────

  private static _mergeGeometries(geos: BufferGeometry[]): BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;
    for (const g of geos) {
      const pos = g.attributes.position?.array;
      if (!pos) continue;
      for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
      const nrm = g.attributes.normal?.array;
      if (nrm) for (let i = 0; i < nrm.length; i++) normals.push(nrm[i]);
      const uv = g.attributes.uv?.array;
      if (uv) for (let i = 0; i < uv.length; i++) uvs.push(uv[i]);
      const idx = g.index?.array as unknown as ArrayLike<number> | undefined;
      if (idx) {
        for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset);
      } else {
        // 无索引:按顶点数顺序生成索引
        const vc = pos.length / 3;
        for (let i = 0; i < vc; i += 3) {
          indices.push(i, i + 1, i + 2);
        }
      }
      vertexOffset += pos.length / 3;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    if (normals.length > 0) geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    if (uvs.length > 0) geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    return geo;
  }
}
