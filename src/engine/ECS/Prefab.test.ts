// Phase 2.3.2 — Prefab 基础测试:实体模板化复用。
//
// 覆盖:
//   - 单模板/多模板实例化(entity count、name、sceneNode TRS)
//   - 组件数据 deep-clone(多次实例化不共享引用污染)
//   - parentSlot 层级挂载
//   - NON_POJO 组件被跳过
//   - 实例化偏移(position/scale)
//   - nameSuffix 防撞名
//   - toJSON / fromJSON round-trip
//   - 未知组件名容错跳过

import { describe, it, expect } from 'vitest';
import { Prefab, type PrefabJson } from './Prefab';
import { World } from './World';
import { TransformC, HealthC, TagC } from './Components';

describe('Phase 2.3.2 — Prefab 基础', () => {
  describe('addEntity + instantiate', () => {
    it('单模板实例化产生一个 entity,TRS 一致', () => {
      const p = new Prefab('SingleTest');
      p.addEntity({
        name: 'Box',
        sceneNode: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [2, 2, 2] },
        components: {},
      });

      const w = new World();
      const ids = p.instantiate(w);
      expect(ids).toHaveLength(1);
      expect(w.entityCount()).toBe(1);

      const snap = w.getEntitySnapshot(ids[0])!;
      expect(snap.sceneNode.position).toEqual([1, 2, 3]);
      expect(snap.sceneNode.scale).toEqual([2, 2, 2]);
    });

    it('多模板实例化按 slot 顺序返回 ids', () => {
      const p = new Prefab('Squad');
      p.addEntity({ name: 'Captain', sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, components: {} });
      p.addEntity({ name: 'Soldier1', sceneNode: { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, components: {} });
      p.addEntity({ name: 'Soldier2', sceneNode: { position: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, components: {} });

      const w = new World();
      const ids = p.instantiate(w);
      expect(ids).toHaveLength(3);
      expect(w.getName(ids[0])).toMatch(/Captain/);
      expect(w.getName(ids[1])).toMatch(/Soldier1/);
      expect(w.getName(ids[2])).toMatch(/Soldier2/);
    });

    it('组件数据被实例化到 entity', () => {
      const p = new Prefab('CompTest');
      p.addEntity({
        name: 'Enemy',
        sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {
          Health: { hp: 50, maxHp: 50 },
          Tag: { value: 'Hostile' },
        },
      });

      const w = new World();
      const [id] = p.instantiate(w);
      const hp = w.getComponent(id, HealthC);
      expect(hp).toBeDefined();
      expect(hp!.hp).toBe(50);

      const tag = w.getComponent(id, TagC);
      expect(tag).toBeDefined();
      expect(tag!.value).toBe('Hostile');
    });

    it('多次实例化的组件数据不共享引用(deep-clone)', () => {
      const p = new Prefab('CloneTest');
      p.addEntity({
        name: 'Bot',
        sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {
          Health: { hp: 100, maxHp: 100 },
          Transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        },
      });

      const w = new World();
      const [id1] = p.instantiate(w, { nameSuffix: 'A' });
      const [id2] = p.instantiate(w, { nameSuffix: 'B' });

      const hp1 = w.getComponent(id1, HealthC)!;
      const hp2 = w.getComponent(id2, HealthC)!;
      hp1.hp = 0; // 修改第一个
      expect(hp2.hp).toBe(100); // 第二个不应被影响

      const t1 = w.getComponent(id1, TransformC)!;
      const t2 = w.getComponent(id2, TransformC)!;
      t1.position = [99, 99, 99];
      expect(t2.position).toEqual([1, 2, 3]);
    });
  });

  describe('instantiate 选项', () => {
    it('position 偏移叠加到所有模板', () => {
      const p = new Prefab('OffsetTest');
      p.addEntity({ name: 'A', sceneNode: { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, components: {} });
      p.addEntity({ name: 'B', sceneNode: { position: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, components: {} });

      const w = new World();
      const ids = p.instantiate(w, { position: [10, 20, 30] });
      const snapA = w.getEntitySnapshot(ids[0])!;
      const snapB = w.getEntitySnapshot(ids[1])!;
      expect(snapA.sceneNode.position).toEqual([11, 20, 30]);
      expect(snapB.sceneNode.position).toEqual([12, 20, 30]);
    });

    it('scale 偏移乘到 position 和 scale', () => {
      const p = new Prefab('ScaleTest');
      p.addEntity({
        name: 'Box',
        sceneNode: { position: [2, 3, 4], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {},
      });

      const w = new World();
      const [id] = p.instantiate(w, { scale: [2, 0.5, 1] });
      const snap = w.getEntitySnapshot(id)!;
      expect(snap.sceneNode.position).toEqual([4, 1.5, 4]); // 2*2, 3*0.5, 4*1
      expect(snap.sceneNode.scale).toEqual([2, 0.5, 1]);
    });

    it('nameSuffix 防撞名', () => {
      const p = new Prefab('NameTest');
      p.addEntity({ name: 'Bot', sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, components: {} });

      const w = new World();
      p.instantiate(w, { nameSuffix: 'wave1', nameStart: 0 });
      p.instantiate(w, { nameSuffix: 'wave2', nameStart: 0 });

      const names: string[] = [];
      w.forEachEntity((_id, name) => names.push(name));
      expect(names).toContain('Bot_wave1_0');
      expect(names).toContain('Bot_wave2_0');
      expect(new Set(names).size).toBe(2); // 无重复
    });
  });

  describe('parentSlot 层级', () => {
    it('parentSlot 把子 sceneNode 挂到父 entity 下', () => {
      const p = new Prefab('HierarchyTest');
      p.addEntity({ name: 'Parent', sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, components: {} });
      p.addEntity({
        name: 'Child',
        sceneNode: { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {},
        parentSlot: 0,
      });

      const w = new World();
      const [parentId, childId] = p.instantiate(w);
      const parentNode = w.getSceneNode(parentId)!;
      const childNode = w.getSceneNode(childId)!;
      expect(childNode.parent).toBe(parentNode);
      expect(parentNode.children).toContain(childNode);
    });

    it('parentSlot 越界被跳过(不抛错)', () => {
      const p = new Prefab('BadParent');
      p.addEntity({
        name: 'Orphan',
        sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {},
        parentSlot: 99,
      });

      const w = new World();
      expect(() => p.instantiate(w)).not.toThrow();
      const [id] = p.instantiate(w);
      const node = w.getSceneNode(id)!;
      expect(node.parent).toBe(w.sceneRoot);
    });
  });

  describe('NON_POJO 组件容错', () => {
    it('addEntity 时 NON_POJO 组件被跳过', () => {
      const p = new Prefab('NonPojoTest');
      p.addEntity({
        name: 'Actor',
        sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {
          MeshRef: { __ref: true } as unknown as Record<string, unknown>,
          AnimState: { clip: 'Idle' } as unknown as Record<string, unknown>,
          Health: { hp: 100, maxHp: 100 },
        },
      });
      const t = p.templates()[0];
      expect(t.components['MeshRef']).toBeUndefined();
      expect(t.components['AnimState']).toBeUndefined();
      expect(t.components['Health']).toBeDefined();
    });

    it('instantiate 时跳过未注册组件名', () => {
      const p = new Prefab('UnknownCompTest');
      // 直接构造内部状态:塞进未注册组件
      type InternalTemplate = {
        slot: number;
        name: string;
        sceneNode: { position: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number] };
        components: Record<string, Record<string, unknown>>;
        parentSlot?: number;
      };
      (p as unknown as { _templates: InternalTemplate[] })._templates.push({
        slot: 0,
        name: 'X',
        sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {
          Bogus: { x: 1 },
          Health: { hp: 50, maxHp: 50 },
        },
      });

      const w = new World();
      const [id] = p.instantiate(w);
      // Bogus 被跳过,Health 还在
      const snap = w.getEntitySnapshot(id)!;
      expect(snap.components['Bogus']).toBeUndefined();
      expect(snap.components['Health']).toBeDefined();
    });
  });

  describe('toJSON / fromJSON round-trip', () => {
    it('完整往返保留 name / templates / components', () => {
      const p = new Prefab('RoundTrip');
      p.addEntity({
        name: 'Enemy',
        sceneNode: { position: [1, 2, 3], rotation: [0, 0.5, 0, 0.866], scale: [1, 1, 1] },
        components: {
          Health: { hp: 80, maxHp: 100 },
          Tag: { value: 'Boss' },
          Transform: { position: [1, 2, 3], rotation: [0, 0.5, 0, 0.866], scale: [1, 1, 1] },
        },
      });
      p.addEntity({
        name: 'Minion',
        sceneNode: { position: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {
          Health: { hp: 10, maxHp: 10 },
          Velocity: { linear: [1, 0, 0], angularY: 0 },
        },
        parentSlot: 0,
      });

      const json = p.toJSON();
      const p2 = Prefab.fromJSON(json);

      expect(p2.name).toBe('RoundTrip');
      expect(p2.size()).toBe(2);
      const [t0, t1] = p2.templates();
      expect(t0.name).toBe('Enemy');
      expect(t0.sceneNode.position).toEqual([1, 2, 3]);
      expect(t0.components['Health']).toEqual({ hp: 80, maxHp: 100 });
      expect(t1.name).toBe('Minion');
      expect(t1.parentSlot).toBe(0);
      expect(t1.components['Velocity']).toEqual({ linear: [1, 0, 0], angularY: 0 });
    });

    it('fromJSON + instantiate 等价于原始 prefab + instantiate', () => {
      const p = new Prefab('EquivTest');
      p.addEntity({
        name: 'Bot',
        sceneNode: { position: [5, 5, 5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: {
          Health: { hp: 30, maxHp: 30 },
          Tag: { value: 'Minion' },
        },
      });

      const w1 = new World();
      const ids1 = p.instantiate(w1);

      const p2 = Prefab.fromJSON(p.toJSON());
      const w2 = new World();
      const ids2 = p2.instantiate(w2);

      expect(w2.entityCount()).toBe(w1.entityCount());

      const snap1 = w1.getEntitySnapshot(ids1[0])!;
      const snap2 = w2.getEntitySnapshot(ids2[0])!;
      expect(snap2.sceneNode.position).toEqual(snap1.sceneNode.position);
      expect(snap2.components['Health']).toEqual(snap1.components['Health']);
      expect(snap2.components['Tag']).toEqual(snap1.components['Tag']);
    });

    it('toJSON 不与 prefab 共享引用(模板修改不影响已序列化 json)', () => {
      const p = new Prefab('IsolationTest');
      p.addEntity({
        name: 'X',
        sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: { Health: { hp: 100, maxHp: 100 } },
      });
      const json = p.toJSON();

      // 修改 prefab 的模板(通过重新 addEntity 替换不了,这里直接修改内部)
      // 我们通过实例化 entity 后改 entity 的 hp 验证 json 不变
      const w = new World();
      const [id] = p.instantiate(w);
      w.getComponent(id, HealthC)!.hp = 0;

      // json 仍然是 100
      expect((json.templates[0].components['Health'] as { hp: number }).hp).toBe(100);
    });

    it('fromJSON 拒绝错误 version', () => {
      const bad = { version: '0.0.0', name: 'x', templates: [] } as unknown as PrefabJson;
      expect(() => Prefab.fromJSON(bad)).toThrow(/unsupported version/);
    });
  });

  describe('组合用法:嵌套层级 + 多组件', () => {
    it('Captain → Soldier 父子层级 + 组件持久', () => {
      const p = new Prefab('Squad');
      p.addEntity({
        name: 'Captain',
        sceneNode: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: { Health: { hp: 200, maxHp: 200 }, Tag: { value: 'Leader' } },
      });
      p.addEntity({
        name: 'Soldier',
        sceneNode: { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: { Health: { hp: 100, maxHp: 100 } },
        parentSlot: 0,
      });

      const w = new World();
      const [capId, solId] = p.instantiate(w);

      // 层级
      const capNode = w.getSceneNode(capId)!;
      const solNode = w.getSceneNode(solId)!;
      expect(solNode.parent).toBe(capNode);

      // 组件
      expect(w.getComponent(capId, TagC)!.value).toBe('Leader');
      expect(w.getComponent(capId, HealthC)!.maxHp).toBe(200);
      expect(w.getComponent(solId, HealthC)!.maxHp).toBe(100);

      // 实例化两次,组件互不污染
      const ids2 = p.instantiate(w, { nameSuffix: 'wave2' });
      const cap2 = w.getComponent(ids2[0], HealthC)!;
      cap2.hp = 0;
      expect(w.getComponent(capId, HealthC)!.hp).toBe(200);
    });
  });
});
