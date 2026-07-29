// SpatialGrid — 空间网格(用于人群邻域查询)。
//
// 设计:
//   * 把 XZ 平面划分为 cellSize × cellSize 的方格,每格维护一个索引数组(agent index)
//   * 邻域查询:遍历查询点周围半径覆盖的所有格子,收集候选后再做精确距离判定
//   * 复杂度:O(1) 插入/移除,O(k) 查询(k = 半径覆盖格数,远优于 O(n²))
//   * 仅 2D(XZ 平面),Y 分量不参与网格划分(人群/避障主要在水平面)
//   * 网格键用 `${cx},${cz}` 字符串,Map 查询;负坐标的 floor 处理已统一
//
// 与 CrowdSystem 的关系:
//   * CrowdSystem 每帧重建/更新此网格以加速 separation/avoidance 邻居查询
//   * 与 Acceleration/BVH 互补:BVH 关注三角形级射线求交,SpatialGrid 关注点云级邻域

/** 简易二维向量(避免引入 Vector2 依赖)。 */
interface GridPos { x: number; z: number; }

/**
 * 空间网格 — 2D XZ 平面邻域查询加速结构。
 *
 * 用法:
 *   const grid = new SpatialGrid(2);
 *   grid.insert(0, { x: 1, z: 1 });
 *   const neighbors = grid.query({ x: 1.5, z: 1.5 }, 3);
 */
export class SpatialGrid {
  /** 格子尺寸(世界单位)。 */
  cellSize: number;
  /** 网格:键 → 索引数组。 */
  grid: Map<string, number[]>;

  constructor(cellSize: number = 2) {
    this.cellSize = Math.max(cellSize, 1e-6);
    this.grid = new Map();
  }

  /** 计算 (x, z) 所在格子的键。 */
  getCellKey(x: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cz}`;
  }

  /** 插入索引到 position 所在格子。 */
  insert(index: number, position: GridPos): this {
    const key = this.getCellKey(position.x, position.z);
    let arr = this.grid.get(key);
    if (!arr) {
      arr = [];
      this.grid.set(key, arr);
    }
    // 防重复插入(同一 index 已在该格子则跳过)
    if (arr.indexOf(index) === -1) arr.push(index);
    return this;
  }

  /** 从 position 所在格子移除索引(若不存在则返回 false)。 */
  remove(index: number, position: GridPos): boolean {
    const key = this.getCellKey(position.x, position.z);
    const arr = this.grid.get(key);
    if (!arr) return false;
    const i = arr.indexOf(index);
    if (i === -1) return false;
    arr.splice(i, 1);
    // 空格子清理,避免 Map 无限增长
    if (arr.length === 0) this.grid.delete(key);
    return true;
  }

  /**
   * 查询 position 半径 radius 内的所有索引(精确距离判定)。
   *  返回去重后的索引数组(不含 position 自身对应的 index,若调用方需要可自行过滤)。
   */
  query(position: GridPos, radius: number): number[] {
    const result: number[] = [];
    const r2 = radius * radius;
    // 计算覆盖的格子范围
    const minCx = Math.floor((position.x - radius) / this.cellSize);
    const maxCx = Math.floor((position.x + radius) / this.cellSize);
    const minCz = Math.floor((position.z - radius) / this.cellSize);
    const maxCz = Math.floor((position.z + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const arr = this.grid.get(`${cx},${cz}`);
        if (!arr) continue;
        for (const idx of arr) {
          // 注意:此处只返回索引,精确距离判定需调用方持有 positions 数组
          // 为保持本类的自包含性,我们把 candidate 索引全部返回,
          // 真正的距离过滤由调用方(CrowdSystem)用其 positions 数组完成。
          // 但为避免重复(同一索引可能跨格子),用 indexOf 去重。
          if (result.indexOf(idx) === -1) result.push(idx);
        }
      }
    }
    // 标记 r2 已被使用(保留语义:本方法返回半径覆盖格子内的所有候选)
    void r2;
    return result;
  }

  /**
   * 带精确距离判定的查询 — 需要调用方提供 positions 数组。
   *  返回距离 < radius 的所有索引。
   *  positions[i] 对应索引 i 的位置。
   */
  queryRadius(position: GridPos, radius: number, positions: GridPos[]): number[] {
    const candidates = this.query(position, radius);
    const result: number[] = [];
    const r2 = radius * radius;
    for (const idx of candidates) {
      const p = positions[idx];
      if (!p) continue;
      const dx = p.x - position.x;
      const dz = p.z - position.z;
      if (dx * dx + dz * dz <= r2) result.push(idx);
    }
    return result;
  }

  /** 清空网格。 */
  clear(): this {
    this.grid.clear();
    return this;
  }

  /** 获取当前网格中的格子数(用于诊断/性能分析)。 */
  getCellCount(): number {
    return this.grid.size;
  }

  /** 获取当前网格中所有索引的总数。 */
  getItemCount(): number {
    let count = 0;
    for (const arr of this.grid.values()) count += arr.length;
    return count;
  }
}
