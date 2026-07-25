import { describe, it, expect } from 'vitest';
import {
  DungeonGenerator,
  TILE_EMPTY,
  TILE_WALL,
  TILE_ROOM,
  TILE_CORRIDOR,
  TILE_DOOR,
} from './DungeonGenerator';

describe('DungeonGenerator', () => {
  describe('generate — 基础参数', () => {
    it('生成 64×64 地牢,grid 长度匹配', () => {
      const d = DungeonGenerator.generate({
        width: 64, height: 64, roomCount: 10, seed: 42,
      });
      expect(d.grid.length).toBe(64 * 64);
      expect(d.width).toBe(64);
      expect(d.height).toBe(64);
    });

    it('非正参数抛错', () => {
      expect(() => DungeonGenerator.generate({ width: 0, height: 64, roomCount: 5 })).toThrow();
      expect(() => DungeonGenerator.generate({ width: 64, height: 0, roomCount: 5 })).toThrow();
      expect(() => DungeonGenerator.generate({ width: 64, height: 64, roomCount: 0 })).toThrow();
    });

    it('minRoomSize > maxRoomSize 抛错', () => {
      expect(() => DungeonGenerator.generate({
        width: 64, height: 64, roomCount: 5,
        minRoomSize: 8, maxRoomSize: 4,
      })).toThrow();
    });

    it('同种子确定性', () => {
      const a = DungeonGenerator.generate({ width: 48, height: 48, roomCount: 8, seed: 99 });
      const b = DungeonGenerator.generate({ width: 48, height: 48, roomCount: 8, seed: 99 });
      expect(a.rooms.length).toBe(b.rooms.length);
      for (let i = 0; i < a.rooms.length; i++) {
        expect(a.rooms[i]).toEqual(b.rooms[i]);
      }
      // 网格逐字节相等
      for (let i = 0; i < a.grid.length; i++) {
        expect(a.grid[i]).toBe(b.grid[i]);
      }
    });

    it('不同种子产生不同地牢', () => {
      const a = DungeonGenerator.generate({ width: 48, height: 48, roomCount: 8, seed: 1 });
      const b = DungeonGenerator.generate({ width: 48, height: 48, roomCount: 8, seed: 2 });
      let diff = 0;
      for (let i = 0; i < a.grid.length; i++) {
        if (a.grid[i] !== b.grid[i]) diff++;
      }
      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('generateRooms', () => {
    it('生成的房间不重叠', () => {
      const rng = (() => {
        let s = 42 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const rooms = DungeonGenerator.generateRooms({
        count: 10, width: 64, height: 64,
        minRoomSize: 4, maxRoomSize: 8, rng,
      });
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i], b = rooms[j];
          const overlap = !(
            a.x + a.width + 1 <= b.x ||
            b.x + b.width + 1 <= a.x ||
            a.y + a.height + 1 <= b.y ||
            b.y + b.height + 1 <= a.y
          );
          expect(overlap).toBe(false);
        }
      }
    });

    it('房间不超出网格边界', () => {
      const rng = (() => {
        let s = 7 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const rooms = DungeonGenerator.generateRooms({
        count: 15, width: 50, height: 50,
        minRoomSize: 4, maxRoomSize: 8, rng,
      });
      for (const r of rooms) {
        expect(r.x).toBeGreaterThanOrEqual(1);
        expect(r.y).toBeGreaterThanOrEqual(1);
        expect(r.x + r.width).toBeLessThan(50 - 1);
        expect(r.y + r.height).toBeLessThan(50 - 1);
      }
    });

    it('每个房间中心 = (x + w/2, y + h/2)', () => {
      const rng = (() => {
        let s = 11 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const rooms = DungeonGenerator.generateRooms({
        count: 5, width: 50, height: 50,
        minRoomSize: 4, maxRoomSize: 8, rng,
      });
      for (const r of rooms) {
        expect(r.cx).toBe(r.x + (r.width >> 1));
        expect(r.cy).toBe(r.y + (r.height >> 1));
      }
    });
  });

  describe('generateCorridors', () => {
    it('房间数 ≥ 2 时,走廊数 ≥ 房间数 - 1(最小生成树)', () => {
      const rng = (() => {
        let s = 42 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const rooms = DungeonGenerator.generateRooms({
        count: 8, width: 64, height: 64,
        minRoomSize: 4, maxRoomSize: 8, rng,
      });
      const corridors = DungeonGenerator.generateCorridors({
        rooms, rng, extraPathRatio: 0,
      });
      expect(corridors.length).toBeGreaterThanOrEqual(rooms.length - 1);
    });

    it('每条走廊的 path 至少含起终点', () => {
      const rng = (() => {
        let s = 5 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const rooms = DungeonGenerator.generateRooms({
        count: 5, width: 50, height: 50,
        minRoomSize: 4, maxRoomSize: 8, rng,
      });
      const corridors = DungeonGenerator.generateCorridors({
        rooms, rng, extraPathRatio: 0,
      });
      for (const c of corridors) {
        expect(c.path.length).toBeGreaterThanOrEqual(2);
        expect(c.path[0].x).toBe(rooms[c.from].cx);
        expect(c.path[0].y).toBe(rooms[c.from].cy);
        const end = c.path[c.path.length - 1];
        expect(end.x).toBe(rooms[c.to].cx);
        expect(end.y).toBe(rooms[c.to].cy);
      }
    });

    it('extraPathRatio=0 时走廊数 = rooms - 1(纯最小生成树)', () => {
      const rng = (() => {
        let s = 21 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const rooms = DungeonGenerator.generateRooms({
        count: 6, width: 64, height: 64,
        minRoomSize: 4, maxRoomSize: 8, rng,
      });
      const corridors = DungeonGenerator.generateCorridors({
        rooms, rng, extraPathRatio: 0,
      });
      expect(corridors.length).toBe(rooms.length - 1);
    });
  });

  describe('connectRooms', () => {
    it('语义同 generateCorridors (extraPathRatio=0)', () => {
      const rng = (() => {
        let s = 17 >>> 0;
        return () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const rooms = DungeonGenerator.generateRooms({
        count: 4, width: 50, height: 50,
        minRoomSize: 4, maxRoomSize: 8, rng,
      });
      const corridors = DungeonGenerator.connectRooms(rooms, rng);
      expect(corridors.length).toBe(rooms.length - 1);
    });
  });

  describe('placeDoors', () => {
    it('每条走廊至少放置 1 个门(若起终点不重合)', () => {
      const rooms: any[] = [
        { x: 0, y: 0, width: 5, height: 5, cx: 2, cy: 2 },
        { x: 10, y: 10, width: 5, height: 5, cx: 12, cy: 12 },
      ];
      const corridors = [{
        from: 0, to: 1,
        path: [{ x: 2, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 12 }],
      }];
      const doors = DungeonGenerator.placeDoors({ rooms, corridors });
      expect(doors.length).toBeGreaterThanOrEqual(1);
      // 门应在房间 0 或房间 1 的中心位置
      for (const d of doors) {
        const inRoom0 = d.x === 2 && d.y === 2;
        const inRoom1 = d.x === 12 && d.y === 12;
        expect(inRoom0 || inRoom1).toBe(true);
      }
    });

    it('同位置门去重', () => {
      const rooms: any[] = [
        { x: 0, y: 0, width: 5, height: 5, cx: 2, cy: 2 },
      ];
      const corridors = [
        { from: 0, to: 0, path: [{ x: 2, y: 2 }, { x: 2, y: 2 }] },
        { from: 0, to: 0, path: [{ x: 2, y: 2 }, { x: 2, y: 2 }] },
      ];
      const doors = DungeonGenerator.placeDoors({ rooms, corridors });
      expect(doors.length).toBe(1);
    });
  });

  describe('getGrid', () => {
    it('从 result 提取 grid', () => {
      const d = DungeonGenerator.generate({ width: 32, height: 32, roomCount: 4, seed: 1 });
      const g = DungeonGenerator.getGrid(d);
      expect(g).toBe(d.grid);
    });
  });

  describe('网格内容', () => {
    it('生成的网格包含房间地板(TILE_ROOM)', () => {
      const d = DungeonGenerator.generate({ width: 48, height: 48, roomCount: 8, seed: 42 });
      let roomCount = 0;
      for (let i = 0; i < d.grid.length; i++) {
        if (d.grid[i] === TILE_ROOM) roomCount++;
      }
      expect(roomCount).toBeGreaterThan(0);
    });

    it('生成的网格包含走廊地板(TILE_CORRIDOR)', () => {
      const d = DungeonGenerator.generate({ width: 48, height: 48, roomCount: 8, seed: 42 });
      let corCount = 0;
      for (let i = 0; i < d.grid.length; i++) {
        if (d.grid[i] === TILE_CORRIDOR) corCount++;
      }
      expect(corCount).toBeGreaterThan(0);
    });

    it('生成的网格包含墙(TILE_WALL)', () => {
      const d = DungeonGenerator.generate({ width: 48, height: 48, roomCount: 8, seed: 42 });
      let wallCount = 0;
      for (let i = 0; i < d.grid.length; i++) {
        if (d.grid[i] === TILE_WALL) wallCount++;
      }
      expect(wallCount).toBeGreaterThan(0);
    });

    it('网格内只有合法 tile 值', () => {
      const d = DungeonGenerator.generate({ width: 32, height: 32, roomCount: 4, seed: 7 });
      const legal = new Set([TILE_EMPTY, TILE_WALL, TILE_ROOM, TILE_CORRIDOR, TILE_DOOR]);
      for (let i = 0; i < d.grid.length; i++) {
        expect(legal.has(d.grid[i])).toBe(true);
      }
    });
  });
});
