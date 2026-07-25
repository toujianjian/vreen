import { describe, it, expect } from 'vitest';
import { NavMesh } from './NavMesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math';

function makeQuadGeometry(): BufferGeometry {
  // 两个三角形拼成 2x2 方形,XZ 平面,Y=0
  // 顶点:(-1,0,-1) (1,0,-1) (1,0,1) (-1,0,1)
  // 索引顺序使法线朝 +Y(从上方看是逆时针)
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    -1, 0, -1,
    1, 0, -1,
    1, 0, 1,
    -1, 0, 1,
  ]), 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

describe('NavMesh', () => {
  it('build 从 BufferGeometry 构建三角形', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    expect(nav.vertices.length).toBe(4);
    expect(nav.triangles.length).toBe(2);
  });

  it('buildFromHeightmap 生成 2x2 三角形/格', () => {
    const nav = new NavMesh();
    // 3x3 高度图 → 4 格 → 8 三角形
    const heights = new Float32Array(9).fill(0);
    nav.buildFromHeightmap(heights, 3, 3, 1);
    expect(nav.vertices.length).toBe(9);
    expect(nav.triangles.length).toBe(8);
  });

  it('buildFromHeightmap 抛错:网格过小', () => {
    const nav = new NavMesh();
    expect(() => nav.buildFromHeightmap(new Float32Array(4), 2, 2, 1)).not.toThrow();
    expect(() => nav.buildFromHeightmap(new Float32Array(1), 1, 1, 1)).toThrow();
  });

  it('buildFromHeightmap 抛错:数据长度不足', () => {
    const nav = new NavMesh();
    expect(() => nav.buildFromHeightmap(new Float32Array(2), 3, 3, 1)).toThrow();
  });

  it('isWalkable 在网格内返回 true', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    expect(nav.isWalkable(new Vector3(0, 0, 0))).toBe(true);
    expect(nav.isWalkable(new Vector3(0.9, 0, 0.9))).toBe(true);
  });

  it('isWalkable 在网格外返回 false', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    expect(nav.isWalkable(new Vector3(2, 0, 0))).toBe(false);
    expect(nav.isWalkable(new Vector3(-2, 0, 0))).toBe(false);
  });

  it('getClosestPoint 网格外返回最近三角形中心', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    const p = nav.getClosestPoint(new Vector3(5, 0, 0));
    // 应该返回某个三角形中心
    expect(p.x).toBeGreaterThanOrEqual(-1);
    expect(p.x).toBeLessThanOrEqual(1);
  });

  it('getClosestPoint 网格内返回自身', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    const inside = new Vector3(0.5, 0, 0.5);
    const p = nav.getClosestPoint(inside);
    expect(p.equals(inside)).toBe(true);
  });

  it('getTriangles 返回所有三角形', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    const tris = nav.getTriangles();
    expect(tris.length).toBe(2);
    expect(tris[0].neighbors.length).toBeGreaterThan(0);
  });

  it('邻接关系:共享边的三角形互为邻居', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    expect(nav.triangles[0].neighbors).toContain(1);
    expect(nav.triangles[1].neighbors).toContain(0);
  });

  it('serialize / deserialize 往返还原', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    const data = nav.serialize();
    const nav2 = new NavMesh();
    nav2.deserialize(data);
    expect(nav2.vertices.length).toBe(nav.vertices.length);
    expect(nav2.triangles.length).toBe(nav.triangles.length);
    expect(nav2.triangles[0].neighbors).toEqual(nav.triangles[0].neighbors);
  });

  it('edges 列表包含内部共享边', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    // 两个三角形 → 4 条独立边(其中 1 条是共享边,有 leftTri 与 rightTri)
    const sharedEdge = nav.edges.find(e => e.leftTri !== -1 && e.rightTri !== -1);
    expect(sharedEdge).toBeDefined();
  });

  it('clear 清空所有数据', () => {
    const nav = new NavMesh();
    nav.build(makeQuadGeometry());
    nav.clear();
    expect(nav.triangles.length).toBe(0);
    expect(nav.vertices.length).toBe(0);
    expect(nav.edges.length).toBe(0);
  });

  it('退化三角形被跳过', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,
      1, 0, 0,
      2, 0, 0, // 共线 → 退化
    ]), 3));
    g.setIndex([0, 1, 2]);
    const nav = new NavMesh();
    nav.build(g);
    expect(nav.triangles.length).toBe(0);
  });
});
