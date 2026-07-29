import { describe, it, expect } from 'vitest';
import { SpatialGrid } from './SpatialGrid';

describe('SpatialGrid', () => {
  it('默认构造 cellSize=2', () => {
    const g = new SpatialGrid();
    expect(g.cellSize).toBe(2);
    expect(g.grid.size).toBe(0);
  });

  it('自定义 cellSize', () => {
    const g = new SpatialGrid(5);
    expect(g.cellSize).toBe(5);
  });

  it('cellSize 不允许 <= 0', () => {
    const g = new SpatialGrid(0);
    expect(g.cellSize).toBeGreaterThan(0);
    const g2 = new SpatialGrid(-1);
    expect(g2.cellSize).toBeGreaterThan(0);
  });

  it('getCellKey 计算格子键', () => {
    const g = new SpatialGrid(2);
    expect(g.getCellKey(0, 0)).toBe('0,0');
    expect(g.getCellKey(1, 1)).toBe('0,0'); // (1,1) 仍在 (0,0) 格
    expect(g.getCellKey(2, 2)).toBe('1,1');
    expect(g.getCellKey(-1, -1)).toBe('-1,-1'); // 负坐标 floor
    expect(g.getCellKey(-2, -2)).toBe('-1,-1');
    expect(g.getCellKey(-3, -3)).toBe('-2,-2');
  });

  it('insert 把索引加入对应格子', () => {
    const g = new SpatialGrid(2);
    g.insert(0, { x: 1, z: 1 });
    g.insert(1, { x: 3, z: 3 });
    expect(g.grid.size).toBe(2); // 两个不同格子
    expect(g.grid.get('0,0')).toEqual([0]);
    expect(g.grid.get('1,1')).toEqual([1]);
  });

  it('insert 同格子累积索引', () => {
    const g = new SpatialGrid(4);
    g.insert(0, { x: 1, z: 1 });
    g.insert(1, { x: 2, z: 2 });
    expect(g.grid.size).toBe(1);
    expect(g.grid.get('0,0')).toEqual([0, 1]);
  });

  it('insert 防重复(同索引同格子不重复插入)', () => {
    const g = new SpatialGrid(4);
    g.insert(0, { x: 1, z: 1 });
    g.insert(0, { x: 1, z: 1 });
    expect(g.grid.get('0,0')).toEqual([0]);
  });

  it('remove 移除索引', () => {
    const g = new SpatialGrid(2);
    g.insert(0, { x: 1, z: 1 });
    expect(g.remove(0, { x: 1, z: 1 })).toBe(true);
    expect(g.grid.size).toBe(0); // 空格子被清理
  });

  it('remove 不存在的索引返回 false', () => {
    const g = new SpatialGrid(2);
    g.insert(0, { x: 1, z: 1 });
    expect(g.remove(5, { x: 1, z: 1 })).toBe(false);
  });

  it('remove 不存在的格子返回 false', () => {
    const g = new SpatialGrid(2);
    expect(g.remove(0, { x: 100, z: 100 })).toBe(false);
  });

  it('query 返回半径覆盖格子内的所有候选', () => {
    const g = new SpatialGrid(2);
    // (0,0) 格,索引 0
    g.insert(0, { x: 0.5, z: 0.5 });
    // (2,2) 格,索引 1
    g.insert(1, { x: 2.5, z: 2.5 });
    // (10,10) 格,索引 2(远)
    g.insert(2, { x: 10, z: 10 });
    // 查询 (1,1) 半径 3 → 覆盖 (0,0) 与 (2,2) 格
    const result = g.query({ x: 1, z: 1 }, 3);
    expect(result).toContain(0);
    expect(result).toContain(1);
    expect(result).not.toContain(2);
  });

  it('queryRadius 精确距离过滤', () => {
    const g = new SpatialGrid(2);
    const positions = [
      { x: 0, z: 0 },  // 0: 距 (1,1) = sqrt(2) ≈ 1.41
      { x: 5, z: 5 },  // 1: 距 (1,1) = sqrt(32) ≈ 5.66
      { x: 2, z: 1 },  // 2: 距 (1,1) = 1
    ];
    positions.forEach((p, i) => g.insert(i, p));
    // 查询 (1,1) 半径 2:应返回 0 与 2(距 1.41 与 1),不含 1(5.66)
    const result = g.queryRadius({ x: 1, z: 1 }, 2, positions);
    expect(result).toContain(0);
    expect(result).toContain(2);
    expect(result).not.toContain(1);
  });

  it('queryRadius 边界(距离恰好等于半径)', () => {
    const g = new SpatialGrid(2);
    const positions = [{ x: 3, z: 0 }]; // 距 (0,0) = 3
    g.insert(0, positions[0]);
    const result = g.queryRadius({ x: 0, z: 0 }, 3, positions);
    expect(result).toContain(0); // 距离 <= 半径
  });

  it('queryRadius 空网格返回空数组', () => {
    const g = new SpatialGrid(2);
    expect(g.queryRadius({ x: 0, z: 0 }, 5, [])).toEqual([]);
  });

  it('clear 清空所有格子', () => {
    const g = new SpatialGrid(2);
    g.insert(0, { x: 1, z: 1 });
    g.insert(1, { x: 3, z: 3 });
    g.clear();
    expect(g.grid.size).toBe(0);
    expect(g.getItemCount()).toBe(0);
  });

  it('getCellCount 返回格子数', () => {
    const g = new SpatialGrid(2);
    g.insert(0, { x: 0, z: 0 });
    g.insert(1, { x: 2, z: 2 });
    g.insert(2, { x: 4, z: 4 });
    expect(g.getCellCount()).toBe(3);
  });

  it('getItemCount 返回索引总数', () => {
    const g = new SpatialGrid(2);
    g.insert(0, { x: 0, z: 0 });
    g.insert(1, { x: 0.5, z: 0.5 }); // 同格
    g.insert(2, { x: 4, z: 4 });
    expect(g.getItemCount()).toBe(3);
    expect(g.getCellCount()).toBe(2);
  });

  it('负坐标正确划分格子', () => {
    const g = new SpatialGrid(2);
    g.insert(0, { x: -1, z: -1 });
    g.insert(1, { x: -3, z: -3 });
    expect(g.grid.size).toBe(2);
    expect(g.grid.has('-1,-1')).toBe(true);
    expect(g.grid.has('-2,-2')).toBe(true);
  });

  it('跨多格子大半径查询', () => {
    const g = new SpatialGrid(1);
    for (let i = 0; i < 10; i++) {
      g.insert(i, { x: i, z: i });
    }
    const result = g.query({ x: 5, z: 5 }, 2);
    // 应返回 (3..7) 范围内的索引
    expect(result.length).toBeGreaterThanOrEqual(5);
  });
});
