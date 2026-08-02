// DecalSystem 单元测试 — 验证 FIFO 淘汰 / 寿命过期 / 渐隐 / 法线对齐 / 资源释放。

import { describe, it, expect } from 'vitest';
import { DecalSystem } from './DecalSystem';
import { PlaneGeometry } from '../Geometries/PlaneGeometry';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';
import type { Material } from '../Core/Material';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import { Quaternion, Vector3 } from '../Math';

/** 把 Mesh.material (可能是数组) 取出为单个 MeshBasicMaterial (测试中均为单材质)。 */
function getDecalMaterial(rec: { mesh: Mesh }): MeshBasicMaterial {
  const m = rec.mesh.material;
  return Array.isArray(m) ? (m[0] as MeshBasicMaterial) : (m as MeshBasicMaterial);
}

/** 创建占位 Mesh (供 DecalGeometry 投影)。 */
function makePlaneMesh(width = 4, height = 4, segs = 1): Mesh {
  const geom = new PlaneGeometry(width, height, segs, segs);
  return new Mesh(geom, { type: 'Basic' } as unknown as Material);
}

const ID_QUAT = new Quaternion(0, 0, 0, 1);
const ORIGIN = new Vector3(0, 0, 0);
const SIZE_2 = new Vector3(2, 2, 2);

describe('DecalSystem', () => {
  describe('构造与默认值', () => {
    it('默认参数正确', () => {
      const sys = new DecalSystem();
      expect(sys.maxDecals).toBe(64);
      expect(sys.defaultLifetime).toBe(10);
      expect(sys.defaultFadeStartRatio).toBe(0.75);
      expect(sys.defaultSize).toBe(0.5);
      expect(sys.defaultColor).toEqual({ r: 1, g: 1, b: 1 });
      expect(sys.renderOrder).toBe(1);
      expect(sys.decals).toHaveLength(0);
      expect(sys.group).toBeInstanceOf(Group);
    });

    it('应用构造选项', () => {
      const sys = new DecalSystem({
        maxDecals: 16,
        defaultLifetime: 5,
        defaultFadeStartRatio: 0.5,
        defaultSize: 0.25,
        defaultColor: { r: 0.5, g: 0.5, b: 0.5 },
        renderOrder: 3,
      });
      expect(sys.maxDecals).toBe(16);
      expect(sys.defaultLifetime).toBe(5);
      expect(sys.defaultFadeStartRatio).toBe(0.5);
      expect(sys.defaultSize).toBe(0.25);
      expect(sys.defaultColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
      expect(sys.renderOrder).toBe(3);
    });
  });

  describe('spawn', () => {
    it('成功投射贴花 → 返回 record + 加入 pool + 挂到 group', () => {
      const sys = new DecalSystem();
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT, SIZE_2);
      expect(rec).not.toBeNull();
      expect(rec!.id).toBe(1);
      expect(rec!.age).toBe(0);
      expect(rec!.maxAge).toBe(10);
      expect(rec!.mesh.parent).toBe(sys.group);
      expect(sys.decals).toHaveLength(1);
      expect(sys.group.children).toContain(rec!.mesh);
    });

    it('几何体未命中 → 返回 null (不加入 pool)', () => {
      const sys = new DecalSystem();
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      // 贴花中心远离平面 (5,0,0),size (0.5,0.5,0.5) → 完全在盒外。
      const rec = sys.spawn(target, new Vector3(5, 0, 0), ID_QUAT, new Vector3(0.5, 0.5, 0.5));
      expect(rec).toBeNull();
      expect(sys.decals).toHaveLength(0);
    });

    it('size 含 0 分量 → 返回 null (不抛错)', () => {
      const sys = new DecalSystem();
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT, new Vector3(0, 2, 2));
      expect(rec).toBeNull();
      expect(sys.decals).toHaveLength(0);
    });

    it('defaultSize 在省略 size 时生效', () => {
      const sys = new DecalSystem({ defaultSize: 0.4 });
      const target = makePlaneMesh(2, 2, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT);
      expect(rec).not.toBeNull();
      expect(rec!.size.x).toBe(0.4);
      expect(rec!.size.y).toBe(0.4);
      expect(rec!.size.z).toBe(0.4);
    });

    it('lifetime 覆盖默认值', () => {
      const sys = new DecalSystem({ defaultLifetime: 10 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT, SIZE_2, { lifetime: 3 });
      expect(rec!.maxAge).toBe(3);
    });

    it('id 自增', () => {
      const sys = new DecalSystem();
      const target = makePlaneMesh(8, 8, 1);
      target.updateMatrixWorld(true);

      const r1 = sys.spawn(target, new Vector3(-1, 0, 0), ID_QUAT, SIZE_2);
      const r2 = sys.spawn(target, new Vector3(1, 0, 0), ID_QUAT, SIZE_2);
      expect(r1!.id).toBe(1);
      expect(r2!.id).toBe(2);
    });

    it('spawn 后 getStats().spawned 递增', () => {
      const sys = new DecalSystem();
      const target = makePlaneMesh(8, 8, 1);
      target.updateMatrixWorld(true);

      sys.spawn(target, new Vector3(-1, 0, 0), ID_QUAT, SIZE_2);
      sys.spawn(target, new Vector3(1, 0, 0), ID_QUAT, SIZE_2);
      const stats = sys.getStats();
      expect(stats.spawned).toBe(2);
      expect(stats.count).toBe(2);
      expect(stats.peakCount).toBe(2);
    });
  });

  describe('FIFO 淘汰', () => {
    it('超过 maxDecals 时淘汰最旧', () => {
      const sys = new DecalSystem({ maxDecals: 2, defaultSize: 1 });
      const target = makePlaneMesh(20, 20, 1);
      target.updateMatrixWorld(true);

      // 在不同位置 spawn 3 个,前两个应被淘汰。
      const r1 = sys.spawn(target, new Vector3(-3, 0, 0), ID_QUAT);
      const r2 = sys.spawn(target, new Vector3(0, 0, 0), ID_QUAT);
      const r3 = sys.spawn(target, new Vector3(3, 0, 0), ID_QUAT);

      expect(sys.decals).toHaveLength(2);
      expect(sys.decals[0].id).toBe(r2!.id);
      expect(sys.decals[1].id).toBe(r3!.id);
      // r1 应已从 group 摘除。
      expect(r1!.mesh.parent).toBeNull();
    });

    it('FIFO 淘汰累计 evicted 计数', () => {
      const sys = new DecalSystem({ maxDecals: 1, defaultSize: 1 });
      const target = makePlaneMesh(20, 20, 1);
      target.updateMatrixWorld(true);

      sys.spawn(target, new Vector3(-3, 0, 0), ID_QUAT);
      sys.spawn(target, new Vector3(0, 0, 0), ID_QUAT);
      sys.spawn(target, new Vector3(3, 0, 0), ID_QUAT);

      const stats = sys.getStats();
      expect(stats.evicted).toBe(2);
      expect(stats.count).toBe(1);
    });

    it('peakCount 不超过 maxDecals', () => {
      const sys = new DecalSystem({ maxDecals: 3, defaultSize: 1 });
      const target = makePlaneMesh(40, 40, 1);
      target.updateMatrixWorld(true);

      for (let i = 0; i < 10; i++) {
        sys.spawn(target, new Vector3(i * 2 - 10, 0, 0), ID_QUAT);
      }
      const stats = sys.getStats();
      expect(stats.peakCount).toBe(3);
      expect(stats.count).toBe(3);
    });
  });

  describe('update — 寿命与渐隐', () => {
    it('推进 age', () => {
      const sys = new DecalSystem({ defaultLifetime: 5, defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT)!;
      sys.update(2);
      expect(rec.age).toBe(2);
      expect(sys.decals).toHaveLength(1);
    });

    it('过期后自动移除', () => {
      const sys = new DecalSystem({ defaultLifetime: 2, defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT)!;
      sys.update(2.5);
      expect(sys.decals).toHaveLength(0);
      expect(rec.mesh.parent).toBeNull();
    });

    it('过期后 expired 计数递增', () => {
      const sys = new DecalSystem({ defaultLifetime: 1, defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      sys.spawn(target, ORIGIN, ID_QUAT);
      sys.update(1.5);
      expect(sys.getStats().expired).toBe(1);
    });

    it('fadeStartRatio 之前不透明 (opacity=1)', () => {
      const sys = new DecalSystem({
        defaultLifetime: 4,
        defaultFadeStartRatio: 0.75,
        defaultSize: 1,
      });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT)!;
      sys.update(2); // t=0.5 < 0.75
      const mat = getDecalMaterial(rec);
      expect(mat.opacity).toBe(1);
    });

    it('fadeStartRatio 之后线性渐隐到 0', () => {
      const sys = new DecalSystem({
        defaultLifetime: 4,
        defaultFadeStartRatio: 0.5,
        defaultSize: 1,
      });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT)!;
      // t=0.75, 在 [0.5,1] 区间,opacity = 1 - (0.75-0.5)/0.5 = 0.5
      sys.update(3);
      const mat = getDecalMaterial(rec);
      expect(mat.opacity).toBeCloseTo(0.5, 5);
    });

    it('寿命终点 opacity=0', () => {
      const sys = new DecalSystem({
        defaultLifetime: 2,
        defaultFadeStartRatio: 0.5,
        defaultSize: 1,
      });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT)!;
      sys.update(1.9999); // t=0.99995,接近 1,opacity ≈ 0.0001
      const mat = getDecalMaterial(rec);
      expect(mat.opacity).toBeCloseTo(0, 3);
    });

    it('fadeStartRatio=1 表示不渐隐', () => {
      const sys = new DecalSystem({
        defaultLifetime: 2,
        defaultFadeStartRatio: 1,
        defaultSize: 1,
      });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT)!;
      sys.update(1.5);
      const mat = getDecalMaterial(rec);
      expect(mat.opacity).toBe(1);
    });

    it('dt 为负视为 0', () => {
      const sys = new DecalSystem({ defaultLifetime: 5, defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT)!;
      sys.update(-1);
      expect(rec.age).toBe(0);
    });

    it('空 pool 不抛错', () => {
      const sys = new DecalSystem();
      expect(() => sys.update(1)).not.toThrow();
    });
  });

  describe('spawnFromHit — 法线对齐', () => {
    it('+Z 法线 → identity 朝向', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const normal = new Vector3(0, 0, 1);
      const rec = sys.spawnFromHit(target, ORIGIN, normal);
      expect(rec).not.toBeNull();
      // +Z → +Z 应得 identity。
      expect(rec!.orientation.x).toBeCloseTo(0, 5);
      expect(rec!.orientation.y).toBeCloseTo(0, 5);
      expect(rec!.orientation.z).toBeCloseTo(0, 5);
      expect(rec!.orientation.w).toBeCloseTo(1, 5);
    });

    it('+Y 法线 → 90° 绕 X 轴旋转', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const normal = new Vector3(0, 1, 0);
      const rec = sys.spawnFromHit(target, ORIGIN, normal);
      expect(rec).not.toBeNull();
      // setFromUnitVectors((0,0,1), (0,1,0)): cross = (0,0,1)×(0,1,0) = (-1,0,0),
      // w = 1 + dot = 1, normalize → (-√2/2, 0, 0, √2/2)
      // 表示 90° 绕 -X 轴 (右手系下 +Z → +Y 的最短弧)。
      expect(rec!.orientation.x).toBeCloseTo(-Math.SQRT1_2, 5);
      expect(rec!.orientation.y).toBeCloseTo(0, 5);
      expect(rec!.orientation.z).toBeCloseTo(0, 5);
      expect(rec!.orientation.w).toBeCloseTo(Math.SQRT1_2, 5);
    });

    it('normalBias 沿法线偏移命中点 (避免 z-fighting)', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const normal = new Vector3(0, 0, 1);
      const rec = sys.spawnFromHit(
        target,
        ORIGIN,
        normal,
        undefined,
        { normalBias: 0.1 },
      );
      expect(rec).not.toBeNull();
      expect(rec!.position.z).toBeCloseTo(0.1, 5);
      expect(rec!.position.x).toBeCloseTo(0, 5);
      expect(rec!.position.y).toBeCloseTo(0, 5);
    });

    it('零长度法线 → 回退 identity', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawnFromHit(target, ORIGIN, new Vector3(0, 0, 0));
      expect(rec).not.toBeNull();
      expect(rec!.orientation.w).toBeCloseTo(1, 5);
      expect(rec!.orientation.x).toBeCloseTo(0, 5);
    });
  });

  describe('removeById / clear', () => {
    it('removeById 找到并移除', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(20, 20, 1);
      target.updateMatrixWorld(true);

      const r1 = sys.spawn(target, new Vector3(-3, 0, 0), ID_QUAT)!;
      sys.spawn(target, new Vector3(3, 0, 0), ID_QUAT);

      const removed = sys.removeById(r1.id);
      expect(removed).toBe(true);
      expect(sys.decals).toHaveLength(1);
      expect(r1.mesh.parent).toBeNull();
    });

    it('removeById 未找到返回 false', () => {
      const sys = new DecalSystem();
      expect(sys.removeById(999)).toBe(false);
    });

    it('clear 移除全部 + 释放资源', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(20, 20, 1);
      target.updateMatrixWorld(true);

      const r1 = sys.spawn(target, new Vector3(-3, 0, 0), ID_QUAT)!;
      const r2 = sys.spawn(target, new Vector3(3, 0, 0), ID_QUAT)!;

      sys.clear();
      expect(sys.decals).toHaveLength(0);
      expect(r1.mesh.parent).toBeNull();
      expect(r2.mesh.parent).toBeNull();
    });

    it('clear 不重置统计', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);
      sys.spawn(target, ORIGIN, ID_QUAT);
      sys.update(sys.defaultLifetime + 1);
      const expiredBefore = sys.getStats().expired;

      sys.clear();
      const stats = sys.getStats();
      expect(stats.expired).toBe(expiredBefore);
      expect(stats.count).toBe(0);
    });
  });

  describe('attach / detach', () => {
    it('attach 把 group 挂到父节点', () => {
      const sys = new DecalSystem();
      const parent = new Group();
      sys.attach(parent);
      expect(sys.group.parent).toBe(parent);
      expect(parent.children).toContain(sys.group);
    });

    it('detach 从父节点摘除', () => {
      const sys = new DecalSystem();
      const parent = new Group();
      sys.attach(parent);
      sys.detach();
      expect(sys.group.parent).toBeNull();
    });
  });

  describe('getMeshes / getById', () => {
    it('getMeshes 返回当前所有 Mesh', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(20, 20, 1);
      target.updateMatrixWorld(true);

      sys.spawn(target, new Vector3(-3, 0, 0), ID_QUAT);
      sys.spawn(target, new Vector3(3, 0, 0), ID_QUAT);

      const meshes = sys.getMeshes();
      expect(meshes).toHaveLength(2);
      expect(meshes[0]).toBeInstanceOf(Mesh);
    });

    it('getById 找到记录', () => {
      const sys = new DecalSystem({ defaultSize: 1 });
      const target = makePlaneMesh(4, 4, 1);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT)!;
      expect(sys.getById(rec.id)).toBe(rec);
    });

    it('getById 未找到返回 undefined', () => {
      const sys = new DecalSystem();
      expect(sys.getById(999)).toBeUndefined();
    });
  });

  describe('3D 目标 (BoxGeometry)', () => {
    it('在盒子上投射贴花', () => {
      const sys = new DecalSystem({ defaultSize: 2 });
      const box = new BoxGeometry(2, 2, 2);
      const target = new Mesh(box, { type: 'Basic' } as unknown as Material);
      target.updateMatrixWorld(true);

      const rec = sys.spawn(target, ORIGIN, ID_QUAT, new Vector3(4, 4, 4));
      expect(rec).not.toBeNull();
      // BoxGeometry 全在 size (4,4,4) 盒内 → 36 顶点。
      expect(rec!.mesh.geometry.attributes.position.count).toBe(36);
    });
  });

  describe('resetStats', () => {
    it('重置 evicted/expired/spawned/peakCount (但保留 count)', () => {
      const sys = new DecalSystem({
        maxDecals: 1,
        defaultLifetime: 1,
        defaultSize: 1,
      });
      const target = makePlaneMesh(20, 20, 1);
      target.updateMatrixWorld(true);

      // 触发淘汰与过期。
      sys.spawn(target, new Vector3(-3, 0, 0), ID_QUAT);
      sys.spawn(target, new Vector3(3, 0, 0), ID_QUAT); // FIFO 淘汰第 1 个
      sys.update(2); // 第 2 个过期

      const before = sys.getStats();
      expect(before.evicted).toBe(1);
      expect(before.expired).toBe(1);

      sys.resetStats();
      const after = sys.getStats();
      expect(after.evicted).toBe(0);
      expect(after.expired).toBe(0);
      expect(after.spawned).toBe(0);
      expect(after.peakCount).toBe(0);
      expect(after.count).toBe(0);
    });
  });
});
