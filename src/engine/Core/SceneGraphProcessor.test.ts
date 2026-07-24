// SceneGraphProcessor 单元测试。
// 验证脏标记延迟更新(只更新脏对象)、统计、遍历过滤、视锥收集、按类型收集。

import { describe, it, expect } from 'vitest';
import { Scene } from './Scene';
import { Group } from './Group';
import { Object3D, DirtyFlag } from './Object3D';
import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { BasicMaterial } from './Material';
import { AmbientLight } from '../Lights/AmbientLight';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { SceneGraphProcessor } from './SceneGraphProcessor';

function makeMesh(): Mesh {
  return new Mesh(new BufferGeometry(), new BasicMaterial());
}

/** 构造测试场景:
 * scene
 *   ├── child1 (Group)
 *   │     └── grandchild1 (Group)
 *   └── child2 (Group)
 */
function makeScene(): { scene: Scene; child1: Group; grandchild1: Group; child2: Group } {
  const scene = new Scene();
  const child1 = new Group();
  const grandchild1 = new Group();
  const child2 = new Group();
  child1.add(grandchild1);
  scene.add(child1);
  scene.add(child2);
  return { scene, child1, grandchild1, child2 };
}

describe('SceneGraphProcessor', () => {
  describe('updateWorldMatrices — 脏标记延迟更新', () => {
    it('首次更新(force)清除所有脏标记', () => {
      const { scene } = makeScene();
      const processor = new SceneGraphProcessor(scene);

      processor.updateWorldMatrices(true);
      const stats = processor.getStats();
      // scene + child1 + grandchild1 + child2 = 4
      expect(stats.totalObjects).toBe(4);
      expect(stats.updatedObjects).toBe(4);
    });

    it('只更新脏对象:移动 child1 → child1 和 grandchild1 重算,child2 不变', () => {
      const { scene, child1, grandchild1, child2 } = makeScene();
      const processor = new SceneGraphProcessor(scene);

      // 首次全量更新,清除所有脏标记
      processor.updateWorldMatrices(true);

      // 记录 child2 的世界矩阵(更新后应保持不变)
      const child2WorldBefore = child2.matrixWorld.elements.slice();

      // 只移动 child1
      child1.position.set(10, 0, 0);

      // 非强制更新:只重算脏对象
      processor.updateWorldMatrices(false);

      const stats = processor.getStats();
      // child1 + grandchild1 = 2 个脏
      expect(stats.dirtyObjects).toBe(2);
      expect(stats.updatedObjects).toBe(2);
      expect(stats.totalObjects).toBe(4);

      // child1 世界矩阵反映新位置 (10,0,0)
      const c1e = child1.matrixWorld.elements;
      expect(c1e[12]).toBe(10);
      expect(c1e[13]).toBe(0);
      expect(c1e[14]).toBe(0);

      // grandchild1 世界矩阵继承 child1 的平移 (10,0,0)
      const gc1e = grandchild1.matrixWorld.elements;
      expect(gc1e[12]).toBe(10);
      expect(gc1e[13]).toBe(0);
      expect(gc1e[14]).toBe(0);

      // child2 世界矩阵未变(脏标记未触发重算)
      const child2WorldAfter = child2.matrixWorld.elements;
      for (let i = 0; i < 16; i++) {
        expect(child2WorldAfter[i]).toBe(child2WorldBefore[i]);
      }

      // 更新后所有脏标记已清除
      expect(child1.isDirty(DirtyFlag.MATRIX_WORLD)).toBe(false);
      expect(grandchild1.isDirty(DirtyFlag.MATRIX_WORLD)).toBe(false);
      expect(child2.isDirty(DirtyFlag.MATRIX_WORLD)).toBe(false);
    });

    it('静态场景二次更新:dirtyObjects=0,updatedObjects=0', () => {
      const { scene } = makeScene();
      const processor = new SceneGraphProcessor(scene);

      processor.updateWorldMatrices(true);  // 首次全量
      processor.updateWorldMatrices(false); // 二次:无脏对象

      const stats = processor.getStats();
      expect(stats.dirtyObjects).toBe(0);
      expect(stats.updatedObjects).toBe(0);
    });

    it('force=true 强制全量重算即使无脏标记', () => {
      const { scene } = makeScene();
      const processor = new SceneGraphProcessor(scene);

      processor.updateWorldMatrices(true);  // 清除脏标记
      processor.updateWorldMatrices(true);  // 再次强制

      const stats = processor.getStats();
      expect(stats.updatedObjects).toBe(4); // 全部重算
    });

    it('position.set 自动标记脏:子树级联重算', () => {
      const { scene, child1, grandchild1 } = makeScene();
      const processor = new SceneGraphProcessor(scene);
      processor.updateWorldMatrices(true);

      // 移动 child1 → markDirty 传播到 grandchild1
      child1.position.set(5, 5, 5);
      expect(child1.isDirty(DirtyFlag.MATRIX_WORLD)).toBe(true);
      expect(grandchild1.isDirty(DirtyFlag.MATRIX_WORLD)).toBe(true);

      processor.updateWorldMatrices(false);

      // grandchild1 世界位置 = child1 (5,5,5) + grandchild1 local (0,0,0)
      const e = grandchild1.matrixWorld.elements;
      expect(e[12]).toBe(5);
      expect(e[13]).toBe(5);
      expect(e[14]).toBe(5);
    });
  });

  describe('traverse — 带过滤的遍历', () => {
    it('无过滤遍历所有节点', () => {
      const { scene } = makeScene();
      const processor = new SceneGraphProcessor(scene);

      const visited: string[] = [];
      processor.traverse((o) => visited.push(o.type));

      // scene + child1 + grandchild1 + child2 = 4
      expect(visited.length).toBe(4);
    });

    it('按 type 过滤', () => {
      const { scene } = makeScene();
      scene.add(makeMesh());
      scene.add(makeMesh());
      const processor = new SceneGraphProcessor(scene);

      const meshes: Object3D[] = [];
      processor.traverse(
        (o) => meshes.push(o),
        (o) => o.type === 'Mesh',
      );

      expect(meshes.length).toBe(2);
      expect(meshes.every((m) => m.type === 'Mesh')).toBe(true);
    });
  });

  describe('collectByType', () => {
    it('收集所有 Group', () => {
      const { scene } = makeScene();
      const processor = new SceneGraphProcessor(scene);

      const groups = processor.collectByType('Group');
      // child1 + grandchild1 + child2 = 3 (不含 Scene)
      expect(groups.length).toBe(3);
    });

    it('收集所有 Mesh', () => {
      const { scene } = makeScene();
      scene.add(makeMesh());
      scene.add(makeMesh());
      const processor = new SceneGraphProcessor(scene);

      const meshes = processor.collectByType('Mesh');
      expect(meshes.length).toBe(2);
    });
  });

  describe('collectVisible', () => {
    it('无相机:收集所有 visible=true 的对象', () => {
      const { scene, child2 } = makeScene();
      child2.visible = false;
      const processor = new SceneGraphProcessor(scene);

      const visible = processor.collectVisible();
      // scene + child1 + grandchild1 = 3 (child2 hidden)
      expect(visible.length).toBe(3);
    });

    it('有相机:视锥裁剪只返回视锥内对象', () => {
      const scene = new Scene();
      const processor = new SceneGraphProcessor(scene);

      const cam = new PerspectiveCamera(90, 1, 0.1, 100);
      cam.position.set(0, 0, 0);
      cam.updateMatrixWorld(true);

      const inside = new Group();
      inside.position.set(0, 0, -5);
      const outside = new Group();
      outside.position.set(0, 0, 5); // 相机后方

      scene.add(inside);
      scene.add(outside);

      processor.updateWorldMatrices(true);
      const visible = processor.collectVisible(cam);

      // scene(原点,在 near 之前→裁掉) + inside(可见) + outside(不可见)
      // 注意:scene 根在原点(0,0,0),near=0.1 → 原点在近平面之前 → 被裁
      // 所以可见列表只有 inside
      expect(visible.length).toBe(1);
      expect(visible[0]).toBe(inside);
    });

    it('frustumCulled=false 的对象跳过视锥裁剪', () => {
      const scene = new Scene();
      const processor = new SceneGraphProcessor(scene);

      const cam = new PerspectiveCamera(90, 1, 0.1, 100);
      cam.position.set(0, 0, 0);
      cam.updateMatrixWorld(true);

      const outside = new Group();
      outside.position.set(0, 0, 5); // 相机后方
      outside.frustumCulled = false;  // 禁用裁剪 → 强制可见

      scene.add(outside);
      processor.updateWorldMatrices(true);

      const visible = processor.collectVisible(cam);
      // scene 根(0,0,0)被裁掉;outside 因 frustumCulled=false 跳过裁剪 → 可见
      expect(visible).toContain(outside);
    });

    it('更新 visibleObjects 统计', () => {
      const { scene } = makeScene();
      const processor = new SceneGraphProcessor(scene);

      processor.collectVisible();
      const stats = processor.getStats();
      expect(stats.visibleObjects).toBe(4);
    });
  });

  describe('updateBounds', () => {
    it('清除所有对象的 BOUNDS 脏标记', () => {
      const { scene, child1 } = makeScene();
      const processor = new SceneGraphProcessor(scene);

      // 标记 BOUNDS 脏
      child1.markDirty(DirtyFlag.BOUNDS);
      expect(child1.isDirty(DirtyFlag.BOUNDS)).toBe(true);

      processor.updateBounds();
      expect(child1.isDirty(DirtyFlag.BOUNDS)).toBe(false);
    });
  });

  describe('collectSceneStats', () => {
    it('返回正确的场景统计快照', () => {
      const scene = new Scene();
      scene.add(makeMesh());
      scene.add(new AmbientLight());
      scene.add(new PerspectiveCamera());

      const processor = new SceneGraphProcessor(scene);
      const stats = processor.collectSceneStats();

      // scene + mesh + light + camera = 4
      expect(stats.totalObjects).toBe(4);
      expect(stats.meshCount).toBe(1);
      expect(stats.lightCount).toBe(1);
      expect(stats.cameraCount).toBe(1);
    });
  });

  describe('getCullStats', () => {
    it('返回最近一次 collectVisible 的裁剪统计', () => {
      const scene = new Scene();
      const processor = new SceneGraphProcessor(scene);

      const cam = new PerspectiveCamera(90, 1, 0.1, 100);
      cam.position.set(0, 0, 0);
      cam.updateMatrixWorld(true);

      const inside = new Group();
      inside.position.set(0, 0, -5);
      const outside = new Group();
      outside.position.set(0, 0, 5);
      scene.add(inside);
      scene.add(outside);

      processor.updateWorldMatrices(true);
      processor.collectVisible(cam);

      const cullStats = processor.getCullStats();
      // tested: scene + inside + outside = 3
      expect(cullStats.tested).toBe(3);
      expect(cullStats.passed).toBeGreaterThanOrEqual(1);
      expect(cullStats.tested).toBe(cullStats.passed + cullStats.rejected);
    });
  });
});
