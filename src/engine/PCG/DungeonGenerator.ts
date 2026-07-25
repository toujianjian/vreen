// DungeonGenerator — 程序化地牢生成器(房间 + 走廊 + 连接 + 门)。
//
// 算法:
//   1. 在 width × height 网格上随机放置 count 个矩形房间(不重叠)
//   2. 用三角形剖分 / 最近邻构造房间连通图,取最小生成树保证全连通
//   3. 在最小生成树上额外加几条边形成环路,丰富路径
//   4. 每条边用 L 型走廊(水平段 + 垂直段)连通房间中心
//   5. 在房间与走廊衔接处放置门
//
// 输出:二维 tile 网格(0 = 空,1 = 墙,2 = 房间地板,3 = 走廊地板,4 = 门),
// 调用方按网格构建 3D 几何体(本类只产出拓扑,不直接构建 BufferGeometry,
// 便于上层灵活选择渲染方式:Tilemap / Voxel / Mesh)。

/** 单个房间。 */
export interface DungeonRoom {
  /** 左上角 X(网格坐标)。 */
  x: number;
  /** 左上角 Y(网格坐标)。 */
  y: number;
  /** 宽度。 */
  width: number;
  /** 高度。 */
  height: number;
  /** 中心 X。 */
  cx: number;
  /** 中心 Y。 */
  cy: number;
}

/** 走廊(由两段构成:L 型)。 */
export interface DungeonCorridor {
  /** 起点房间索引。 */
  from: number;
  /** 终点房间索引。 */
  to: number;
  /** 走廊路径(网格坐标序列,含起点终点)。 */
  path: Array<{ x: number; y: number }>;
}

/** 门的位置。 */
export interface DungeonDoor {
  x: number;
  y: number;
  /** 关联房间索引(-1 表示走廊间门)。 */
  roomId: number;
}

/** 地牢生成选项。 */
export interface DungeonOptions {
  /** 网格宽度。 */
  width: number;
  /** 网格高度。 */
  height: number;
  /** 房间数量。 */
  roomCount: number;
  /** 房间最小尺寸。 */
  minRoomSize?: number;
  /** 房间最大尺寸。 */
  maxRoomSize?: number;
  /** 随机种子。 */
  seed?: number;
  /** 额外环路比例(0-1,在最小生成树上额外加边的比例)。 */
  extraPathRatio?: number;
}

/** 地牢生成结果。 */
export interface DungeonResult {
  /** 二维网格:0=空,1=墙,2=房间地板,3=走廊地板,4=门。 */
  grid: Uint8Array;
  /** 房间列表。 */
  rooms: DungeonRoom[];
  /** 走廊列表。 */
  corridors: DungeonCorridor[];
  /** 门列表。 */
  doors: DungeonDoor[];
  /** 网格尺寸。 */
  width: number;
  height: number;
}

/** 网格单元类型。 */
export const TILE_EMPTY = 0;
export const TILE_WALL = 1;
export const TILE_ROOM = 2;
export const TILE_CORRIDOR = 3;
export const TILE_DOOR = 4;

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

/** 矩形相交判定(含 1 格缓冲)。 */
function roomsOverlap(a: DungeonRoom, b: DungeonRoom, pad: number = 1): boolean {
  return !(
    a.x + a.width + pad <= b.x ||
    b.x + b.width + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  );
}

/**
 * 程序化地牢生成器(全部静态方法)。
 *
 * 用法:
 *   const d = DungeonGenerator.generate({ width: 64, height: 64, roomCount: 12, seed: 42 });
 *   // d.grid 为 Uint8Array(width * height)
 */
export class DungeonGenerator {
  /**
   * 生成完整地牢。
   */
  static generate(options: DungeonOptions): DungeonResult {
    const {
      width,
      height,
      roomCount,
      minRoomSize = 4,
      maxRoomSize = 10,
      seed = 0,
      extraPathRatio = 0.15,
    } = options;

    if (width <= 0 || height <= 0 || roomCount <= 0) {
      throw new Error(`DungeonGenerator: width/height/roomCount 必须为正数`);
    }
    if (minRoomSize > maxRoomSize) {
      throw new Error(`DungeonGenerator: minRoomSize 不能大于 maxRoomSize`);
    }

    const rng = mulberry32(seed);
    const rooms = this.generateRooms({ count: roomCount, width, height, minRoomSize, maxRoomSize, rng });
    const corridors = this.generateCorridors({ rooms, rng, extraPathRatio });
    const doors = this.placeDoors({ rooms, corridors });

    // 构建网格:全 0 → 写入房间地板 → 写入走廊地板 → 写入门 → 周围加墙
    const grid = new Uint8Array(width * height);
    for (const room of rooms) {
      for (let y = room.y; y < room.y + room.height; y++) {
        for (let x = room.x; x < room.x + room.width; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            grid[y * width + x] = TILE_ROOM;
          }
        }
      }
    }
    for (const cor of corridors) {
      for (const p of cor.path) {
        if (p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
          // 不覆盖房间地板
          if (grid[p.y * width + p.x] === TILE_EMPTY) {
            grid[p.y * width + p.x] = TILE_CORRIDOR;
          }
        }
      }
    }
    for (const door of doors) {
      if (door.x >= 0 && door.x < width && door.y >= 0 && door.y < height) {
        grid[door.y * width + door.x] = TILE_DOOR;
      }
    }
    // 在所有非空格子周围加墙
    const finalGrid = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cur = grid[y * width + x];
        if (cur !== TILE_EMPTY) {
          finalGrid[y * width + x] = cur;
        } else {
          // 检查 8 邻居是否有非空,若有则标记为墙
          let nearFloor = false;
          for (let dy = -1; dy <= 1 && !nearFloor; dy++) {
            for (let dx = -1; dx <= 1 && !nearFloor; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const n = grid[ny * width + nx];
                if (n === TILE_ROOM || n === TILE_CORRIDOR || n === TILE_DOOR) {
                  nearFloor = true;
                }
              }
            }
          }
          if (nearFloor) finalGrid[y * width + x] = TILE_WALL;
        }
      }
    }

    return { grid: finalGrid, rooms, corridors, doors, width, height };
  }

  /**
   * 生成不重叠的房间。
   * @param count 期望房间数(实际可能少于,若空间不足)
   */
  static generateRooms(opts: {
    count: number;
    width: number;
    height: number;
    minRoomSize: number;
    maxRoomSize: number;
    rng: () => number;
  }): DungeonRoom[] {
    const { count, width, height, minRoomSize, maxRoomSize, rng } = opts;
    const rooms: DungeonRoom[] = [];
    const maxAttempts = count * 20;
    let attempts = 0;
    while (rooms.length < count && attempts < maxAttempts) {
      attempts++;
      const w = minRoomSize + Math.floor(rng() * (maxRoomSize - minRoomSize + 1));
      const h = minRoomSize + Math.floor(rng() * (maxRoomSize - minRoomSize + 1));
      const x = 1 + Math.floor(rng() * (width - w - 2));
      const y = 1 + Math.floor(rng() * (height - h - 2));
      if (x < 1 || y < 1 || x + w >= width - 1 || y + h >= height - 1) continue;
      const room: DungeonRoom = { x, y, width: w, height: h, cx: x + (w >> 1), cy: y + (h >> 1) };
      let overlap = false;
      for (const r of rooms) {
        if (roomsOverlap(r, room, 1)) { overlap = true; break; }
      }
      if (!overlap) rooms.push(room);
    }
    return rooms;
  }

  /**
   * 生成走廊:基于最小生成树(Prim)+ 额外环路。
   */
  static generateCorridors(opts: {
    rooms: DungeonRoom[];
    rng: () => number;
    extraPathRatio: number;
  }): DungeonCorridor[] {
    const { rooms, rng, extraPathRatio } = opts;
    if (rooms.length < 2) return [];

    // Prim 最小生成树,以欧氏距离为权重
    const n = rooms.length;
    const inTree = new Array(n).fill(false);
    const parent = new Array(n).fill(-1);
    const dist = new Array(n).fill(Infinity);
    dist[0] = 0;
    for (let i = 0; i < n; i++) {
      // 选未加入中 dist 最小的
      let u = -1, best = Infinity;
      for (let v = 0; v < n; v++) {
        if (!inTree[v] && dist[v] < best) { best = dist[v]; u = v; }
      }
      if (u === -1) break;
      inTree[u] = true;
      for (let v = 0; v < n; v++) {
        if (!inTree[v]) {
          const d = Math.hypot(rooms[u].cx - rooms[v].cx, rooms[u].cy - rooms[v].cy);
          if (d < dist[v]) { dist[v] = d; parent[v] = u; }
        }
      }
    }
    // 构造走廊(L 型路径)
    const corridors: DungeonCorridor[] = [];
    for (let v = 1; v < n; v++) {
      if (parent[v] >= 0) {
        corridors.push(this._buildCorridor(parent[v], v, rooms));
      }
    }
    // 额外环路:在非树边里按比例补加
    const extraCount = Math.floor(n * extraPathRatio);
    for (let i = 0; i < extraCount * 4; i++) {
      if (corridors.length >= n - 1 + extraCount) break;
      const a = Math.floor(rng() * n);
      const b = Math.floor(rng() * n);
      if (a === b) continue;
      // 跳过已存在的
      const exists = corridors.some(c =>
        (c.from === a && c.to === b) || (c.from === b && c.to === a));
      if (exists) continue;
      corridors.push(this._buildCorridor(a, b, rooms));
    }
    return corridors;
  }

  /**
   * 连接房间(Prim 最小生成树)。语义同 generateCorridors 中的步骤,
   * 单独抽出便于上层在已有 rooms 的前提下重算。
   */
  static connectRooms(rooms: DungeonRoom[], rng: () => number): DungeonCorridor[] {
    return this.generateCorridors({ rooms, rng, extraPathRatio: 0 });
  }

  /**
   * 在房间与走廊衔接处放置门。
   * 简化策略:对每条走廊,在其路径起点和终点(落在房间内的位置)放门。
   */
  static placeDoors(opts: {
    rooms: DungeonRoom[];
    corridors: DungeonCorridor[];
  }): DungeonDoor[] {
    const doors: DungeonDoor[] = [];
    const seen = new Set<string>();
    for (const cor of opts.corridors) {
      if (cor.path.length === 0) continue;
      const start = cor.path[0];
      const end = cor.path[cor.path.length - 1];
      const fromRoom = opts.rooms[cor.from];
      const toRoom = opts.rooms[cor.to];
      if (fromRoom) {
        const key = `${start.x},${start.y}`;
        if (!seen.has(key)) {
          seen.add(key);
          doors.push({ x: start.x, y: start.y, roomId: cor.from });
        }
      }
      if (toRoom) {
        const key = `${end.x},${end.y}`;
        if (!seen.has(key)) {
          seen.add(key);
          doors.push({ x: end.x, y: end.y, roomId: cor.to });
        }
      }
    }
    return doors;
  }

  /**
   * 获取网格(从 generate 结果中提取,提供 API 完整性)。
   */
  static getGrid(result: DungeonResult): Uint8Array {
    return result.grid;
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /** 构造 L 型走廊路径(水平段 + 垂直段,顺序由 from 房间中心决定)。 */
  private static _buildCorridor(
    from: number, to: number, rooms: DungeonRoom[],
  ): DungeonCorridor {
    const a = rooms[from];
    const b = rooms[to];
    const path: Array<{ x: number; y: number }> = [];
    // 先水平后垂直
    const horizontal = a.cx !== b.cx;
    const vertical = a.cy !== b.cy;
    if (horizontal) {
      const step = b.cx > a.cx ? 1 : -1;
      for (let x = a.cx; x !== b.cx; x += step) {
        path.push({ x, y: a.cy });
      }
    }
    path.push({ x: b.cx, y: a.cy });
    if (vertical) {
      const step = b.cy > a.cy ? 1 : -1;
      for (let y = a.cy; y !== b.cy; y += step) {
        path.push({ x: b.cx, y });
      }
    }
    path.push({ x: b.cx, y: b.cy });
    return { from, to, path };
  }
}
