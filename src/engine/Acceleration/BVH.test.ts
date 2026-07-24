import { describe, it, expect } from 'vitest';
import { BVH } from './BVH';
import { BVHNode } from './BVHNode';
import { BVHBuildStrategy } from './BVHBuilder';
import { Ray } from '../Math/Ray';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Frustum } from '../Math/Frustum';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { SphereGeometry } from '../Geometries/SphereGeometry';

/** 构造一个手动设置 6 平面的视锥体。
 *  planes 顺序: [left, right, bottom, top, near, far],每项 [nx,ny,nz,constant]。
 *  平面方程: normal·point + constant >= 0 表示点在平面内侧。 */
function makeFrustum(planes: Array<[number, number, number, number]>): Frustum {
  const f = new Frustum();
  for (let i = 0; i < 6; i++) {
    const [nx, ny, nz, c] = planes[i];
    f.planes[i].normal.set(nx, ny, nz);
    f.planes[i].constant = c;
  }
  return f;
}

/** 包含 [-1000, 1000]³ 立方体的视锥体(必包含所有测试几何体)。 */
function hugeFrustum(): Frustum {
  return makeFrustum([
    [1, 0, 0, 1000],   // x >= -1000
    [-1, 0, 0, 1000],  // x <= 1000
    [0, 1, 0, 1000],   // y >= -1000
    [0, -1, 0, 1000],  // y <= 1000
    [0, 0, 1, 1000],   // z >= -1000
    [0, 0, -1, 1000],  // z <= 1000
  ]);
}

/** 全部位于 x >= 5000 区域的视锥体(必排除原点附近的几何体)。 */
function farFrustum(): Frustum {
  return makeFrustum([
    [1, 0, 0, -5000],  // x >= 5000 → 排除 x ∈ [-1, 1] 的几何体
    [-1, 0, 0, 1000],
    [0, 1, 0, 1000],
    [0, -1, 0, 1000],
    [0, 0, 1, 1000],
    [0, 0, -1, 1000],
  ]);
}

/** 仅包含 x >= 0 半空间的视锥体(用于部分裁剪测试)。 */
function halfXFrustum(): Frustum {
  return makeFrustum([
    [1, 0, 0, 0],      // x >= 0
    [-1, 0, 0, 1000],
    [0, 1, 0, 1000],
    [0, -1, 0, 1000],
    [0, 0, 1, 1000],
    [0, 0, -1, 1000],
  ]);
}

/** 构造单三角形几何体(非索引):顶点 (0,0,0),(1,0,0),(0,1,0)。 */
function singleTriangleGeometry(): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]), 3));
  return geo;
}

describe('BVH', () => {
  describe('默认状态', () => {
    it('未构建时 root 为 null', () => {
      const bvh = new BVH();
      expect(bvh.root).toBeNull();
    });

    it('未构建时 getStats 返回零值', () => {
      const bvh = new BVH();
      const stats = bvh.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.leafCount).toBe(0);
      expect(stats.totalTriangles).toBe(0);
    });

    it('未构建时 getBounds 返回空盒', () => {
      const bvh = new BVH();
      const bounds = bvh.getBounds();
      expect(bounds.isEmpty()).toBe(true);
    });

    it('未构建时 raycast 返回空数组', () => {
      const bvh = new BVH();
      const ray = new Ray(new Vector3(0, 0, -1), new Vector3(0, 0, 1));
      expect(bvh.raycast(ray)).toEqual([]);
    });
  });

  describe('build - 单三角形', () => {
    const geo = singleTriangleGeometry();
    const bvh = new BVH().build(geo, { maxLeafSize: 4 });

    it('root 不为空且为叶子', () => {
      expect(bvh.root).not.toBeNull();
      expect(bvh.root!.isLeaf()).toBe(true);
    });

    it('叶子持有 1 个三角形索引', () => {
      expect(bvh.root!.triangles).toEqual([0]);
    });

    it('根节点 depth 为 0', () => {
      expect(bvh.root!.depth).toBe(0);
    });

    it('bounds 覆盖三角形 (0,0,0)-(1,1,0)', () => {
      const bounds = bvh.getBounds();
      expect(bounds.min.x).toBe(0);
      expect(bounds.min.y).toBe(0);
      expect(bounds.min.z).toBe(0);
      expect(bounds.max.x).toBe(1);
      expect(bounds.max.y).toBe(1);
      expect(bounds.max.z).toBe(0);
    });

    it('getStats 正确', () => {
      const stats = bvh.getStats();
      expect(stats.totalNodes).toBe(1);
      expect(stats.leafCount).toBe(1);
      expect(stats.interiorCount).toBe(0);
      expect(stats.maxDepth).toBe(0);
      expect(stats.totalTriangles).toBe(1);
      expect(stats.maxLeafSize).toBe(1);
    });
  });

  describe('build - BoxGeometry', () => {
    const geo = new BoxGeometry(2, 2, 2); // 12 个三角形
    const bvh = new BVH().build(geo, { maxLeafSize: 4 });

    it('root 不为空', () => {
      expect(bvh.root).not.toBeNull();
    });

    it('总三角形数为 12', () => {
      expect(bvh.triangleCount).toBe(12);
    });

    it('getStats.totalTriangles === 12', () => {
      const stats = bvh.getStats();
      expect(stats.totalTriangles).toBe(12);
    });

    it('叶子数 > 1 (12 个三角形 > maxLeafSize=4 应分裂)', () => {
      const stats = bvh.getStats();
      expect(stats.leafCount).toBeGreaterThan(1);
    });

    it('所有叶子三角形数 <= maxLeafSize', () => {
      const stats = bvh.getStats();
      expect(stats.maxLeafSize).toBeLessThanOrEqual(4);
    });

    it('totalNodes === leafCount + interiorCount', () => {
      const stats = bvh.getStats();
      expect(stats.totalNodes).toBe(stats.leafCount + stats.interiorCount);
    });

    it('maxDepth >= 1 (发生了分裂)', () => {
      const stats = bvh.getStats();
      expect(stats.maxDepth).toBeGreaterThanOrEqual(1);
    });

    it('getBounds 覆盖 (-1,-1,-1)-(1,1,1)', () => {
      const bounds = bvh.getBounds();
      expect(bounds.min.x).toBeCloseTo(-1, 6);
      expect(bounds.min.y).toBeCloseTo(-1, 6);
      expect(bounds.min.z).toBeCloseTo(-1, 6);
      expect(bounds.max.x).toBeCloseTo(1, 6);
      expect(bounds.max.y).toBeCloseTo(1, 6);
      expect(bounds.max.z).toBeCloseTo(1, 6);
    });
  });

  describe('build - SphereGeometry', () => {
    it('16x8 球体构建成功', () => {
      const geo = new SphereGeometry(1, 16, 8);
      const bvh = new BVH().build(geo, { maxLeafSize: 8 });
      expect(bvh.root).not.toBeNull();
      const stats = bvh.getStats();
      expect(stats.totalTriangles).toBeGreaterThan(0);
      expect(stats.totalNodes).toBeGreaterThan(0);
    });
  });

  describe('build - 空几何体', () => {
    it('无 position 属性时 root 为 null', () => {
      const geo = new BufferGeometry();
      const bvh = new BVH().build(geo);
      expect(bvh.root).toBeNull();
      expect(bvh.triangleCount).toBe(0);
    });
  });

  describe('raycast - 单三角形', () => {
    const geo = singleTriangleGeometry();
    const bvh = new BVH().build(geo, { maxLeafSize: 4 });

    it('射线穿过三角形内部时命中', () => {
      const ray = new Ray(new Vector3(0.25, 0.25, -1), new Vector3(0, 0, 1));
      const hits = bvh.raycast(ray);
      expect(hits.length).toBe(1);
      expect(hits[0].triangleIndex).toBe(0);
      expect(hits[0].distance).toBeCloseTo(1, 6);
      expect(hits[0].point.x).toBeCloseTo(0.25, 6);
      expect(hits[0].point.y).toBeCloseTo(0.25, 6);
      expect(hits[0].point.z).toBeCloseTo(0, 6);
    });

    it('射线在三角形外未命中', () => {
      const ray = new Ray(new Vector3(5, 5, -1), new Vector3(0, 0, 1));
      const hits = bvh.raycast(ray);
      expect(hits.length).toBe(0);
    });

    it('射线方向相反未命中', () => {
      const ray = new Ray(new Vector3(0.25, 0.25, 1), new Vector3(0, 0, 1));
      const hits = bvh.raycast(ray);
      expect(hits.length).toBe(0);
    });
  });

  describe('raycast - BoxGeometry', () => {
    const geo = new BoxGeometry(2, 2, 2);
    const bvh = new BVH().build(geo, { maxLeafSize: 4 });

    it('沿 X 轴射线命中 -X 面与 +X 面', () => {
      // 偏移 (0.2, 0.1) 避免落在三角形共享边上
      const ray = new Ray(new Vector3(-5, 0.2, 0.1), new Vector3(1, 0, 0));
      const hits = bvh.raycast(ray);
      expect(hits.length).toBe(2);
      // 第一命中:-X 面 (x=-1),距离 4
      expect(hits[0].distance).toBeCloseTo(4, 6);
      expect(hits[0].point.x).toBeCloseTo(-1, 6);
      // 第二命中:+X 面 (x=1),距离 6
      expect(hits[1].distance).toBeCloseTo(6, 6);
      expect(hits[1].point.x).toBeCloseTo(1, 6);
    });

    it('未穿过的射线无命中', () => {
      const ray = new Ray(new Vector3(-5, 5, 0.1), new Vector3(1, 0, 0));
      const hits = bvh.raycast(ray);
      expect(hits.length).toBe(0);
    });
  });

  describe('raycastFirst', () => {
    it('返回最近命中', () => {
      const geo = new BoxGeometry(2, 2, 2);
      const bvh = new BVH().build(geo, { maxLeafSize: 4 });
      const ray = new Ray(new Vector3(-5, 0.2, 0.1), new Vector3(1, 0, 0));
      const hit = bvh.raycastFirst(ray);
      expect(hit).not.toBeNull();
      expect(hit!.distance).toBeCloseTo(4, 6);
      expect(hit!.point.x).toBeCloseTo(-1, 6);
    });

    it('无相交返回 null', () => {
      const geo = new BoxGeometry(2, 2, 2);
      const bvh = new BVH().build(geo, { maxLeafSize: 4 });
      const ray = new Ray(new Vector3(-5, 5, 0.1), new Vector3(1, 0, 0));
      expect(bvh.raycastFirst(ray)).toBeNull();
    });

    it('与 raycast 最近命中一致', () => {
      const geo = new SphereGeometry(1, 16, 8);
      const bvh = new BVH().build(geo, { maxLeafSize: 4 });
      const ray = new Ray(new Vector3(0, 0, -5), new Vector3(0, 0, 1));
      const all = bvh.raycast(ray);
      const first = bvh.raycastFirst(ray);
      expect(first).not.toBeNull();
      expect(all.length).toBeGreaterThan(0);
      expect(first!.distance).toBeCloseTo(all[0].distance, 6);
    });
  });

  describe('intersectsFrustum', () => {
    const geo = new BoxGeometry(2, 2, 2);
    const bvh = new BVH().build(geo, { maxLeafSize: 1 }); // 叶子=单三角形,精确裁剪

    it('包含全部的视锥体返回全部三角形', () => {
      const visible = bvh.intersectsFrustum(hugeFrustum());
      expect(visible.length).toBe(12);
    });

    it('远离几何体的视锥体返回 0 个三角形', () => {
      const visible = bvh.intersectsFrustum(farFrustum());
      expect(visible.length).toBe(0);
    });

    it('x >= 0 半空间视锥体排除 -X 面 2 个三角形', () => {
      const visible = bvh.intersectsFrustum(halfXFrustum());
      // -X 面所有顶点 x=-1,AABB x=-1..-1,被 x>=0 平面剔除
      // 其余面顶点跨 x=-1..1,p-vertex x=1 通过平面测试
      expect(visible.length).toBe(10);
    });
  });

  describe('traverse', () => {
    it('深度优先遍历所有节点', () => {
      const geo = new BoxGeometry(2, 2, 2);
      const bvh = new BVH().build(geo, { maxLeafSize: 4 });
      const stats = bvh.getStats();
      let count = 0;
      bvh.traverse((node, depth) => {
        expect(node).toBeInstanceOf(BVHNode);
        expect(node.depth).toBe(depth);
        count++;
      });
      expect(count).toBe(stats.totalNodes);
    });

    it('空树遍历不调用回调', () => {
      const bvh = new BVH();
      let count = 0;
      bvh.traverse(() => { count++; });
      expect(count).toBe(0);
    });
  });

  describe('getBounds', () => {
    it('返回根节点 bounds 的副本', () => {
      const geo = new BoxGeometry(2, 2, 2);
      const bvh = new BVH().build(geo);
      const bounds = bvh.getBounds();
      expect(bounds.min.x).toBeCloseTo(-1, 6);
      expect(bounds.max.x).toBeCloseTo(1, 6);
    });

    it('写入传入的 target 对象', () => {
      const geo = new BoxGeometry(2, 2, 2);
      const bvh = new BVH().build(geo);
      const target = new Box3();
      const ret = bvh.getBounds(target);
      expect(ret).toBe(target);
      expect(target.min.x).toBeCloseTo(-1, 6);
    });
  });

  describe('getStats', () => {
    it('单三角形:1 节点 1 叶子 0 深度', () => {
      const geo = singleTriangleGeometry();
      const bvh = new BVH().build(geo, { maxLeafSize: 4 });
      const stats = bvh.getStats();
      expect(stats.totalNodes).toBe(1);
      expect(stats.leafCount).toBe(1);
      expect(stats.interiorCount).toBe(0);
      expect(stats.maxDepth).toBe(0);
      expect(stats.avgDepth).toBe(0);
      expect(stats.totalTriangles).toBe(1);
      expect(stats.maxLeafSize).toBe(1);
    });

    it('叶子三角形总和等于几何体三角形数', () => {
      const geo = new BoxGeometry(2, 2, 2);
      const bvh = new BVH().build(geo, { maxLeafSize: 3 });
      const stats = bvh.getStats();
      expect(stats.totalTriangles).toBe(12);
    });

    it('avgDepth 介于 0 与 maxDepth 之间', () => {
      const geo = new SphereGeometry(1, 16, 8);
      const bvh = new BVH().build(geo, { maxLeafSize: 2 });
      const stats = bvh.getStats();
      expect(stats.avgDepth).toBeGreaterThanOrEqual(0);
      expect(stats.avgDepth).toBeLessThanOrEqual(stats.maxDepth);
    });
  });

  describe('构建策略', () => {
    const strategies: Array<[string, BVHBuildStrategy]> = [
      ['MIDDLE', BVHBuildStrategy.MIDDLE],
      ['MEDIAN_AXIS', BVHBuildStrategy.MEDIAN_AXIS],
      ['SAH', BVHBuildStrategy.SAH],
    ];

    for (const [name, strategy] of strategies) {
      it(`${name}: 构建有效且三角形完整`, () => {
        const geo = new BoxGeometry(2, 2, 2);
        const bvh = new BVH().build(geo, { maxLeafSize: 4, strategy });
        expect(bvh.root).not.toBeNull();
        const stats = bvh.getStats();
        expect(stats.totalTriangles).toBe(12);
        expect(stats.totalNodes).toBe(stats.leafCount + stats.interiorCount);
        expect(stats.maxLeafSize).toBeLessThanOrEqual(4);
      });

      it(`${name}: 射线检测正确`, () => {
        const geo = new BoxGeometry(2, 2, 2);
        const bvh = new BVH().build(geo, { maxLeafSize: 4, strategy });
        const ray = new Ray(new Vector3(-5, 0.2, 0.1), new Vector3(1, 0, 0));
        const hit = bvh.raycastFirst(ray);
        expect(hit).not.toBeNull();
        expect(hit!.distance).toBeCloseTo(4, 6);
      });
    }

    it('SAH 对球体构建有效', () => {
      const geo = new SphereGeometry(1, 24, 12);
      const bvh = new BVH().build(geo, {
        maxLeafSize: 4,
        strategy: BVHBuildStrategy.SAH,
        sahBinCount: 8,
      });
      const stats = bvh.getStats();
      expect(stats.totalTriangles).toBeGreaterThan(0);
      expect(stats.maxLeafSize).toBeLessThanOrEqual(4);
    });
  });
});
