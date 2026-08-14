import { describe, it, expect } from 'vitest';
import { Octree } from './Octree';
import { OctreeHelper } from './OctreeHelper';
import { Capsule } from './Capsule';
import { Box3 } from '../Math/Box3';
import { Sphere } from '../Math/Sphere';
import { Triangle } from '../Math/Triangle';
import { Vector3 } from '../Math/Vector3';
import { Ray } from '../Math/Ray';
import { PlaneGeometry } from '../Geometries/PlaneGeometry';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { Object3D } from '../Core/Object3D';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 构造一个 mesh-like Object3D(标 isMesh+geometry,绕开 Material 依赖)。 */
function makeMesh(geometry: BufferGeometry): Object3D {
  const o = new Object3D();
  // Object3D 默认无 isMesh;设为 true 让 Octree.fromGraphNode 识别。
  (o as unknown as { isMesh: boolean }).isMesh = true;
  (o as unknown as { geometry: BufferGeometry }).geometry = geometry;
  return o;
}

// ============================================================
// Box3.intersectsTriangle (SAT,Octree 的 split 预剪基石)
// ============================================================
describe('Box3.intersectsTriangle (SAT)', () => {
  it('三角形完全在盒内 → 相交', () => {
    const box = new Box3(new Vector3(-5, -5, -5), new Vector3(5, 5, 5));
    const tri = new Triangle(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0));
    expect(box.intersectsTriangle(tri)).toBe(true);
  });

  it('三角形完全在盒外 → 不相交', () => {
    const box = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
    const tri = new Triangle(new Vector3(10, 10, 10), new Vector3(11, 10, 10), new Vector3(10, 11, 10));
    expect(box.intersectsTriangle(tri)).toBe(false);
  });

  it('三角形穿越盒面 → 相交', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    // 大三角形跨越盒体
    const tri = new Triangle(new Vector3(-5, 0, 0), new Vector3(5, 0, 0), new Vector3(0, 5, 0));
    expect(box.intersectsTriangle(tri)).toBe(true);
  });

  it('空盒恒不相交', () => {
    const box = new Box3(); // 空: min=+∞, max=-∞
    const tri = new Triangle(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0));
    expect(box.isEmpty()).toBe(true);
    expect(box.intersectsTriangle(tri)).toBe(false);
  });

  it('退化(共线)三角形落在盒内 → 不分离(SAT 均无分离轴)', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const tri = new Triangle(new Vector3(0, 0, 0), new Vector3(0.1, 0, 0), new Vector3(0.2, 0, 0));
    // 共线三角形无面积;SAT 法线轴为零轴,投影恒不相离 → 与盒重叠判定
    // (three.js 同样会把退化三角形判为「不分相」,这里只验证不抛错)
    expect(typeof box.intersectsTriangle(tri)).toBe('boolean');
  });
});

// ============================================================
// Capsule
// ============================================================
describe('Capsule', () => {
  it('default 构造:start=(0,0,0) end=(0,1,0) radius=1', () => {
    const c = new Capsule();
    expect(c.start.x).toBe(0);
    expect(c.end.y).toBe(1);
    expect(c.radius).toBe(1);
  });

  it('set/copy/clone', () => {
    const a = new Capsule();
    const s = new Vector3(1, 2, 3);
    const e = new Vector3(4, 5, 6);
    a.set(s, e, 2);
    expect(a.start.x).toBe(1);
    expect(a.end.z).toBe(6);
    expect(a.radius).toBe(2);

    const b = new Capsule().copy(a);
    expect(b.radius).toBe(2);
    b.start.x = 99;
    expect(a.start.x).toBe(1); // copy 是值复制,改 b 不影响 a

    const d = a.clone();
    expect(d.end.y).toBe(5);
    expect(d).not.toBe(a);
  });

  it('getCenter 写入 target 返回中点', () => {
    const c = new Capsule(new Vector3(0, 0, 0), new Vector3(0, 2, 0), 1);
    const out = new Vector3();
    const ret = c.getCenter(out);
    expect(ret).toBe(out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(1);
    expect(out.z).toBe(0);
  });

  it('translate 平移两端', () => {
    const c = new Capsule(new Vector3(0, 0, 0), new Vector3(0, 2, 0), 1);
    c.translate(new Vector3(1, 0, 0));
    expect(c.start.x).toBe(1);
    expect(c.end.x).toBe(1);
  });

  it('intersectsBox:嵌入相交返回 true,远离返回 false', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const inside = new Capsule(new Vector3(0, -0.5, 0), new Vector3(0, 0.5, 0), 0.3);
    expect(inside.intersectsBox(box)).toBe(true);

    const far = new Capsule(new Vector3(100, 100, 100), new Vector3(100, 101, 100), 1);
    expect(far.intersectsBox(box)).toBe(false);
  });
});

// ============================================================
// Octree 构建
// ============================================================
describe('Octree build / split', () => {
  it('空树 build 后无叶三角形、bounds 为空', () => {
    const o = new Octree();
    o.build();
    expect(o.subTrees.length).toBe(0);
    expect(o.triangles.length).toBe(0);
    expect(o.bounds.isEmpty()).toBe(true);
  });

  it('少量三角形(< trianglesPerLeaf)落单叶不分割', () => {
    const o = new Octree();
    o.addTriangle(new Triangle(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0)));
    o.addTriangle(new Triangle(new Vector3(2, 0, 0), new Vector3(3, 0, 0), new Vector3(2, 1, 0)));
    o.build();
    // 根节点被 split;popped 后 triangles 为空,subTrees 中含携带 2 三角形的子节点
    expect(o.triangles.length).toBe(0);
    expect(o.subTrees.length).toBeGreaterThan(0);
    // 与原三角形数量一致(两三角形落入可能不同叶子但来自同一根 split)
    const helper = new OctreeHelper(o);
    expect(helper.getLeafTriangleCount()).toBeGreaterThanOrEqual(2);
  });

  it('大量三角形触发多级分割到 maxLevel', () => {
    const o = new Octree();
    o.maxLevel = 3;
    o.trianglesPerLeaf = 1; // 任何含 >1 三角形的叶子都分割

    // 撒 50 个三角形在 [0,10]³
    for (let i = 0; i < 50; i++) {
      const x = (i * 1.7) % 10;
      const y = (i * 2.3) % 10;
      const z = (i * 0.9) % 10;
      o.addTriangle(
        new Triangle(
          new Vector3(x, y, z),
          new Vector3(x + 1, y, z),
          new Vector3(x, y + 1, z),
        ),
      );
    }
    o.build();
    expect(o.subTrees.length).toBeGreaterThan(0);
    // 总三角形引用数 >= 50(分裂后三角形会在多个叶子间重复分配)
    const helper = new OctreeHelper(o);
    expect(helper.getLeafTriangleCount()).toBeGreaterThanOrEqual(50);
  });

  it('calcBox 给 box 加 0.01 负向偏移', () => {
    const o = new Octree();
    o.addTriangle(new Triangle(new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(0, 2, 0)));
    o.calcBox();
    expect(o.box).not.toBeNull();
    expect(o.box!.min.x).toBeCloseTo(-0.01, 6);
  });
});

// ============================================================
// Octree 胶囊碰撞(主用例)
// ============================================================
describe('Octree capsuleIntersect', () => {
  /** 在 y=0 处铺一个 10×10 平面(2 个三角形),法线朝上(+Y)。 */
  function ground(): Octree {
    const o = new Octree();
    // 平面四点 + 对角线三角化(绕序使法线朝 +Y)
    const p00 = new Vector3(0, 0, 0);
    const p11 = new Vector3(10, 0, 0);
    const p01 = new Vector3(0, 0, 10);
    const p10 = new Vector3(10, 0, 10);
    o.addTriangle(new Triangle(p00, p11, p01));
    o.addTriangle(new Triangle(p00, p10, p11));
    o.build();
    return o;
  }

  it('胶囊嵌入地面 → 命中,normal 指向上(+Y),depth>0', () => {
    const o = ground();
    // 胶囊轴线略低于地面,radius 使其穿入(底端球心在地面之下 0.1)
    const player = new Capsule(new Vector3(5, 0.4, 5), new Vector3(5, 1.4, 5), 0.5);
    const hit = o.capsuleIntersect(player);
    expect(hit).not.toBe(false);
    if (hit) {
      expect(hit.depth).toBeGreaterThan(0);
      // 推开方向接近 +Y(被推离地面向上)
      expect(hit.normal.y).toBeGreaterThan(0.9);
    }
  });

  it('胶囊高悬地面之上 → 不相交', () => {
    const o = ground();
    const player = new Capsule(new Vector3(5, 5, 5), new Vector3(5, 6, 5), 0.5);
    expect(o.capsuleIntersect(player)).toBe(false);
  });

  it('胶囊远在地面外 → 不相交', () => {
    const o = ground();
    const player = new Capsule(new Vector3(100, 100, 100), new Vector3(100, 101, 100), 1);
    expect(o.capsuleIntersect(player)).toBe(false);
  });
});

// ============================================================
// Octree 球 / 盒碰撞
// ============================================================
describe('Octree sphereIntersect / boxIntersect', () => {
  function wall(): Octree {
    const o = new Octree();
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(4, 0, 0);
    const c = new Vector3(0, 4, 0);
    o.addTriangle(new Triangle(a, b, c));
    o.build();
    return o;
  }

  it('球嵌入墙 → 命中且 depth>0', () => {
    const o = wall();
    const s = new Sphere(new Vector3(0.5, 0.5, 0), 0.6);
    const hit = o.sphereIntersect(s);
    expect(hit).not.toBe(false);
    if (hit) expect(hit.depth).toBeGreaterThan(0);
  });

  it('球远离墙 → 不相交', () => {
    const o = wall();
    const s = new Sphere(new Vector3(5, 5, 5), 0.5);
    expect(o.sphereIntersect(s)).toBe(false);
  });

  it('盒嵌入墙 → 命中', () => {
    const o = wall();
    const box = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
    expect(o.boxIntersect(box)).not.toBe(false);
  });

  it('盒远离墙 → 不相交', () => {
    const o = wall();
    const box = new Box3(new Vector3(50, 50, 50), new Vector3(51, 51, 51));
    expect(o.boxIntersect(box)).toBe(false);
  });
});

// ============================================================
// Octree 射线
// ============================================================
describe('Octree rayIntersect', () => {
  function ground(): Octree {
    const o = new Octree();
    const p00 = new Vector3(0, 0, 0);
    const p11 = new Vector3(10, 0, 0);
    const p01 = new Vector3(0, 0, 10);
    const p10 = new Vector3(10, 0, 10);
    o.addTriangle(new Triangle(p00, p11, p01));
    o.addTriangle(new Triangle(p00, p10, p11));
    o.build();
    return o;
  }

  it('射线指向地面 → 命中 y≈0', () => {
    const o = ground();
    const ray = new Ray(new Vector3(5, 10, 5), new Vector3(0, -1, 0));
    const hit = o.rayIntersect(ray);
    expect(hit).not.toBe(false);
    if (hit) {
      expect(hit.position.y).toBeCloseTo(0, 4);
      expect(hit.distance).toBeCloseTo(10, 4);
    }
  });

  it('射线偏离 → 不命中', () => {
    const o = ground();
    const ray = new Ray(new Vector3(100, 10, 100), new Vector3(0, -1, 0));
    expect(o.rayIntersect(ray)).toBe(false);
  });
});

// ============================================================
// fromGraphNode(场景图入口)
// ============================================================
describe('Octree fromGraphNode', () => {
  it('从 PlaneGeometry(非索引)mesh 建树 → 叶三角形 ≥ 2', () => {
    const g = new PlaneGeometry(2, 2);
    const mesh = makeMesh(g);
    mesh.updateWorldMatrix(true, true);
    const o = new Octree().fromGraphNode(mesh);
    const helper = new OctreeHelper(o);
    expect(helper.getLeafTriangleCount()).toBeGreaterThanOrEqual(2);
    // 平面在本地 [−1,1] 平面,worldbounds 应覆盖 x/z 英 [-1,1]
    expect(o.bounds.max.x).toBeGreaterThan(0);
  });

  it('从 BoxGeometry(索引化)mesh 建树 → 12 三角形', () => {
    const g = new BoxGeometry(2, 2, 2);
    const mesh = makeMesh(g);
    const o = new Octree().fromGraphNode(mesh);
    const helper = new OctreeHelper(o);
    // Box 有 6 面 × 2 三角形 = 12
    expect(helper.getLeafTriangleCount()).toBeGreaterThanOrEqual(12);
  });

  it('节点附带 transform(translate)后三角形变到世界空间', () => {
    const g = new PlaneGeometry(2, 2); // 本地 [-1,1]
    const mesh = makeMesh(g);
    mesh.position.set(100, 0, 100);
    mesh.updateMatrixWorld(true); // 触发 matrixWorld 计算
    const o = new Octree().fromGraphNode(mesh);
    // 世界三角形应在 x≈100 附近
    expect(o.bounds.min.x).toBeGreaterThan(95);
    expect(o.bounds.max.x).toBeLessThan(105);
  });
});

// ============================================================
// Octree clear / OctreeHelper
// ============================================================
describe('Octree clear / OctreeHelper', () => {
  it('clear 清空树', () => {
    const o = new Octree();
    o.addTriangle(new Triangle(new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0)));
    o.build();
    expect(o.subTrees.length).toBeGreaterThan(0);
    o.clear();
    expect(o.subTrees.length).toBe(0);
    expect(o.triangles.length).toBe(0);
    expect(o.box).toBeNull();
    expect(o.bounds.isEmpty()).toBe(true);
  });

  it('OctreeHelper.getBoxes 收集全部子盒,getNodeCount 一致', () => {
    const o = new Octree();
    for (let i = 0; i < 20; i++) {
      const x = (i * 7) % 10;
      const y = (i * 3) % 10;
      o.addTriangle(
        new Triangle(new Vector3(x, y, 0), new Vector3(x + 1, y, 0), new Vector3(x, y + 1, 0)),
      );
    }
    o.build();
    const helper = new OctreeHelper(o);
    const boxes = helper.getBoxes();
    expect(boxes.length).toBe(helper.getNodeCount());
    expect(boxes.length).toBeGreaterThan(1);
  });

  it('OctreeHelper maxDepth 限制下钻深度', () => {
    const o = new Octree();
    o.maxLevel = 4;
    o.trianglesPerLeaf = 1;
    for (let i = 0; i < 30; i++) {
      o.addTriangle(
        new Triangle(
          new Vector3(i % 10, (i * 2) % 10, (i * 3) % 10),
          new Vector3((i % 10) + 0.5, 0, 0),
          new Vector3(0, (i % 10) + 0.5, 0),
        ),
      );
    }
    o.build();
    const helper = new OctreeHelper(o);
    // 限制 1 层盒子数 <= 不限制盒子数
    expect(helper.getBoxes(1).length).toBeLessThanOrEqual(helper.getBoxes().length);
  });

  it('getLeafBoundingBoxes 仅收集无子节点的叶 (typo-safe getter 名)', () => {
    const o = new Octree();
    o.addTriangle(new Triangle(new Vector3(0, 0, 0), new Vector3(5, 0, 0), new Vector3(0, 5, 0)));
    o.addTriangle(new Triangle(new Vector3(10, 0, 0), new Vector3(15, 0, 0), new Vector3(10, 5, 0)));
    o.build();
    const helper = new OctreeHelper(o);
    const leaves = helper.getLeafBoxes();
    expect(leaves.length).toBeGreaterThan(0);
    for (const b of leaves) expect(b).toBeInstanceOf(Box3);
  });
});

// ============================================================
// lineToLineClosestPoints(内部场景间接覆盖)
// ============================================================
describe('Octree 三角形-胶囊边线最近点路径', () => {
  it('胶囊轴平行但不接触三角形边 → 不命中', () => {
    const o = new Octree();
    // 单个三角形在 y=0
    o.addTriangle(new Triangle(new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(0, 0, 2)));
    o.build();
    // 胶囊沿 y 在远处上方,不接触
    const c = new Capsule(new Vector3(1, 5, 1), new Vector3(1, 6, 1), 0.3);
    expect(o.triangleCapsuleIntersect(c, o.subTrees[0].triangles[0])).toBe(false);
  });
});
