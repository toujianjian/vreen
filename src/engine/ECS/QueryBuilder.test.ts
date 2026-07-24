// Phase 2.3.3 — QueryBuilder 缓存测试。
//
// 覆盖:
//   - 基础查询结果正确(与 world.query 等价)
//   - 缓存命中:无结构变化时 get() 返回相同结果且 cacheHits 递增
//   - 失效:createEntity/destroyEntity/setComponent/removeComponent 后自动重查
//   - 副本语义:返回的数组可修改不污染缓存
//   - invalidate() 手动失效
//   - dispose() 后 get() 抛错
//   - loadJSON 主动失效
//   - 性能特征(大量 get 但无变化时查询次数仍为 1)

import { describe, it, expect } from 'vitest';
import { World } from './World';
import {
  Transform, TransformC,
  Velocity, VelocityC,
  Health, HealthC,
} from './Components';

describe('Phase 2.3.3 — QueryBuilder 缓存', () => {
  describe('基础查询', () => {
    it('返回与 world.query 等价的结果', () => {
      const w = new World();
      const e1 = w.createEntity('a');
      w.setComponent(e1, TransformC, new Transform());
      w.setComponent(e1, VelocityC, new Velocity());
      const e2 = w.createEntity('b');
      w.setComponent(e2, TransformC, new Transform());

      const qb = w.queryBuilder(TransformC, VelocityC);
      const ids = qb.get();
      expect(ids).toEqual([e1]);
      expect(ids).toEqual(w.query(TransformC, VelocityC));
    });

    it('空类型列表匹配所有 entity', () => {
      const w = new World();
      const e1 = w.createEntity('a');
      const e2 = w.createEntity('b');

      const qb = w.queryBuilder();
      const ids = qb.get();
      expect(ids).toEqual([e1, e2]);
    });

    it('无匹配时返回空数组', () => {
      const w = new World();
      w.createEntity('a');
      const qb = w.queryBuilder(HealthC);
      expect(qb.get()).toEqual([]);
    });
  });

  describe('缓存命中', () => {
    it('无结构变化时多次 get() 触发缓存命中', () => {
      const w = new World();
      const e1 = w.createEntity('a');
      w.setComponent(e1, TransformC, new Transform());
      const qb = w.queryBuilder(TransformC);

      qb.get();
      qb.get();
      qb.get();
      qb.get();

      expect(qb.queryCount).toBe(1); // 只查过 1 次
      expect(qb.cacheHits).toBe(3);  // 后 3 次命中
    });

    it('返回的数组是副本,修改不影响下次 get()', () => {
      const w = new World();
      const e1 = w.createEntity('a');
      w.setComponent(e1, TransformC, new Transform());
      const qb = w.queryBuilder(TransformC);

      const a1 = qb.get();
      a1.push(99999);
      a1.length = 0;

      const a2 = qb.get();
      expect(a2).toEqual([e1]);
    });
  });

  describe('失效触发', () => {
    it('createEntity 后自动重查', () => {
      const w = new World();
      w.createEntity('a');
      const qb = w.queryBuilder();
      expect(qb.get()).toHaveLength(1);

      w.createEntity('b');
      expect(qb.get()).toHaveLength(2);
      expect(qb.queryCount).toBe(2);
    });

    it('destroyEntity 后自动重查', () => {
      const w = new World();
      const e1 = w.createEntity('a');
      w.createEntity('b');
      const qb = w.queryBuilder();
      expect(qb.get()).toHaveLength(2);

      w.destroyEntity(e1);
      expect(qb.get()).toHaveLength(1);
    });

    it('setComponent 后自动重查', () => {
      const w = new World();
      const e1 = w.createEntity('a');
      const qb = w.queryBuilder(HealthC);
      expect(qb.get()).toEqual([]);

      w.setComponent(e1, HealthC, new Health(100));
      expect(qb.get()).toEqual([e1]);
    });

    it('removeComponent 后自动重查', () => {
      const w = new World();
      const e1 = w.createEntity('a');
      w.setComponent(e1, HealthC, new Health(100));
      const qb = w.queryBuilder(HealthC);
      expect(qb.get()).toEqual([e1]);

      w.removeComponent(e1, HealthC);
      expect(qb.get()).toEqual([]);
    });

    it('setComponent 替换现有组件也触发失效', () => {
      const w = new World();
      const e1 = w.createEntity('a');
      const hp1 = new Health(100);
      w.setComponent(e1, HealthC, hp1);
      const qb = w.queryBuilder(HealthC);
      qb.get();

      // 替换(同一 entity 同一 type)
      w.setComponent(e1, HealthC, new Health(50));
      // 结果 entity 列表不变,但 modCount 变了,缓存应失效重查
      const ids = qb.get();
      expect(ids).toEqual([e1]);
      expect(qb.queryCount).toBe(2);
    });

    it('invalidate() 手动失效', () => {
      const w = new World();
      w.createEntity('a');
      const qb = w.queryBuilder();
      qb.get();
      expect(qb.queryCount).toBe(1);

      qb.invalidate();
      qb.get();
      expect(qb.queryCount).toBe(2);
    });

    it('loadJSON 主动调 invalidate', () => {
      const w = new World();
      w.createEntity('old');
      const qb = w.queryBuilder();
      qb.get();
      expect(qb.queryCount).toBe(1);

      w.loadJSON(
        { version: '0.2.0', name: 'new', frame: 0, entities: [
          { id: 1, name: 'new1', sceneNode: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] }, components: {} },
          { id: 2, name: 'new2', sceneNode: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] }, components: {} },
        ] },
        {},
      );
      const ids = qb.get();
      expect(ids).toHaveLength(2);
      expect(qb.queryCount).toBe(2); // loadJSON 触发失效
    });
  });

  describe('dispose', () => {
    it('dispose 后 get() 抛错', () => {
      const w = new World();
      w.createEntity('a');
      const qb = w.queryBuilder();
      qb.get();
      qb.dispose();
      expect(() => qb.get()).toThrow(/dispose/);
    });

    it('dispose 后 World 修改不再通知失效(但不影响其他 qb)', () => {
      const w = new World();
      w.createEntity('first');  // 初始 1 个 entity
      const qb1 = w.queryBuilder();
      const qb2 = w.queryBuilder();
      qb1.get();
      qb2.get();

      qb1.dispose();
      // qb1 已 dispose,不再收通知;qb2 仍正常
      w.createEntity('new');
      expect(() => qb2.get()).not.toThrow();
      expect(qb2.get()).toHaveLength(2);
    });

    it('dispose 是幂等的', () => {
      const w = new World();
      const qb = w.queryBuilder();
      qb.dispose();
      expect(() => qb.dispose()).not.toThrow();
    });
  });

  describe('多 QueryBuilder 共存', () => {
    it('不同类型的 QueryBuilder 各自独立缓存', () => {
      const w = new World();
      const e1 = w.createEntity('mover');
      w.setComponent(e1, TransformC, new Transform());
      w.setComponent(e1, VelocityC, new Velocity());
      const e2 = w.createEntity('static');
      w.setComponent(e2, TransformC, new Transform());

      const movers = w.queryBuilder(TransformC, VelocityC);
      const allT = w.queryBuilder(TransformC);
      const allE = w.queryBuilder();

      expect(movers.get()).toEqual([e1]);
      expect(allT.get()).toHaveLength(2);
      expect(allE.get()).toHaveLength(2);

      // 修改:e2 加 Velocity → 应进入 movers
      w.setComponent(e2, VelocityC, new Velocity());
      expect(movers.get()).toHaveLength(2);
      expect(allT.get()).toHaveLength(2); // 全部 Transform 没变
      expect(allE.get()).toHaveLength(2);
    });
  });

  describe('性能特征', () => {
    it('1000 次 get 但无结构变化时 queryCount 仍为 1', () => {
      const w = new World();
      for (let i = 0; i < 100; i++) {
        const e = w.createEntity(`e${i}`);
        w.setComponent(e, TransformC, new Transform());
        if (i % 3 === 0) w.setComponent(e, HealthC, new Health(100));
      }
      const qb = w.queryBuilder(HealthC);
      for (let i = 0; i < 1000; i++) qb.get();
      expect(qb.queryCount).toBe(1);
      expect(qb.cacheHits).toBe(999);
    });
  });
});
