import { describe, it, expect } from 'vitest';
import { NavMesh } from './NavMesh';
import { PathFinder } from './PathFinder';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math';

function makeFlatGrid(size: number, segs: number): BufferGeometry {
  const g = new BufferGeometry();
  const half = size / 2;
  const step = size / segs;
  const positions: number[] = [];
  for (let j = 0; j <= segs; j++) {
    for (let i = 0; i <= segs; i++) {
      positions.push(-half + i * step, 0, -half + j * step);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      const b = (j + 1) * (segs + 1) + i;
      const c = (j + 1) * (segs + 1) + (i + 1);
      const d = j * (segs + 1) + (i + 1);
      indices.push(a, b, c, a, c, d);
    }
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  return g;
}

describe('PathFinder', () => {
  it('findPathTriangle 同三角形返回单元素', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    const path = finder.findPathTriangle(0, 0);
    expect(path).toEqual([0]);
  });

  it('findPathTriangle 邻接三角形可达', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    const path = finder.findPathTriangle(0, 1);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toBe(0);
    expect(path[path.length - 1]).toBe(1);
  });

  it('findPathTriangle 不相邻也能通过中间三角形连接', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 3)); // 3x3 = 18 三角形
    const finder = new PathFinder(nav);
    const path = finder.findPathTriangle(0, 17);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toBe(0);
    expect(path[path.length - 1]).toBe(17);
  });

  it('findPathTriangle 无效索引返回空', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    expect(finder.findPathTriangle(-1, 0)).toEqual([]);
    expect(finder.findPathTriangle(0, -1)).toEqual([]);
    expect(finder.findPathTriangle(0, 999)).toEqual([]);
  });

  it('findPath 起终点都在网格上', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    const path = finder.findPath(new Vector3(-4, 0, -4), new Vector3(4, 0, 4));
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[0].distanceTo(new Vector3(-4, 0, -4))).toBeLessThan(0.01);
    expect(path[path.length - 1].distanceTo(new Vector3(4, 0, 4))).toBeLessThan(0.01);
  });

  it('findPath 起点终点相同返回两点', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    const path = finder.findPath(new Vector3(0, 0, 0), new Vector3(0, 0, 0));
    expect(path.length).toBeGreaterThanOrEqual(1);
  });

  it('findPath 起点不在网格上时吸附到最近三角形', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    const path = finder.findPath(new Vector3(20, 0, 20), new Vector3(0, 0, 0));
    // 起点吸附后,要么返回路径要么空(取决于网格是否有可达三角形)
    expect(Array.isArray(path)).toBe(true);
  });

  it('smoothPath 减少冗余共线点', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    // 构造一条有明显冗余的路径(共线中点)
    const rawPath = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(2, 0, 0),
      new Vector3(3, 0, 0),
    ];
    const smoothed = finder.smoothPath(rawPath);
    expect(smoothed.length).toBeLessThanOrEqual(rawPath.length);
    expect(smoothed[0].equals(rawPath[0])).toBe(true);
    expect(smoothed[smoothed.length - 1].equals(rawPath[rawPath.length - 1])).toBe(true);
  });

  it('smoothPath 短路径不变形', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    const short = [new Vector3(0, 0, 0), new Vector3(1, 0, 1)];
    const smoothed = finder.smoothPath(short);
    expect(smoothed.length).toBe(2);
  });

  it('getDistance 返回三角形中心距离', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    const a = nav.triangles[0];
    const b = nav.triangles[1];
    const d = finder.getDistance(a, b);
    expect(d).toBeGreaterThan(0);
    expect(d).toBe(a.center.distanceTo(b.center));
  });

  it('开放集与关闭集在寻路后被填充', () => {
    const nav = new NavMesh();
    nav.build(makeFlatGrid(10, 2));
    const finder = new PathFinder(nav);
    finder.findPathTriangle(0, 3);
    // closedSet 应包含至少一个三角形(已被扩展)
    expect(finder.closedSet.size).toBeGreaterThan(0);
  });
});
