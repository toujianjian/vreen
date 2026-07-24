// EcsScriptAPI 单元测试 — Phase 3.1
//
// 验证:
//   • Entity 创建/销毁/命名
//   • 通用 setComponent/getComponent/removeComponent/hasComponent/query
//   • JSON 字符串数据交换
//   • Transform/Health/Tag/Velocity 专用方法
//   • Tick 回调注册与驱动 (Phase 3.2)
//   • createComponentFromJson 的边界情况

import { describe, it, expect, beforeEach } from 'vitest';
import { World, TransformC, VelocityC, HealthC, TagC, LifetimeC, PlayerInputC } from '@/engine/ECS';
import { EcsScriptAPI } from '@/lib/ecsScriptApi';

describe('EcsScriptAPI', () => {
  let world: World;
  let api: EcsScriptAPI;

  beforeEach(() => {
    world = new World({ name: 'TestWorld' });
    api = new EcsScriptAPI(world);
  });

  // ── Entity 管理 ──────────────────────────────────────────────
  describe('Entity management', () => {
    it('creates entities with sequential ids', () => {
      const a = api.createEntity('A');
      const b = api.createEntity('B');
      const c = api.createEntity();
      expect(api.entityCount()).toBe(3);
      expect(a).not.toBe(b);
      expect(b).not.toBe(c);
      expect(a).not.toBe(c);
    });

    it('returns entity name', () => {
      const id = api.createEntity('Hero');
      expect(api.getEntityName(id)).toBe('Hero');
    });

    it('returns empty string for non-existent entity name', () => {
      expect(api.getEntityName(0xffffff)).toBe('');
    });

    it('destroys entity and frees slot', () => {
      const id = api.createEntity('Temp');
      expect(api.destroyEntity(id)).toBe(true);
      expect(api.entityCount()).toBe(0);
      expect(api.destroyEntity(id)).toBe(false); // already destroyed
    });

    it('listEntities returns all alive ids', () => {
      const a = api.createEntity('A');
      const b = api.createEntity('B');
      const ids = api.listEntities();
      expect(ids).toHaveLength(2);
      expect(ids).toContain(a);
      expect(ids).toContain(b);
    });
  });

  // ── 通用组件操作 ─────────────────────────────────────────────
  describe('Generic component operations', () => {
    it('setComponent with JSON data', () => {
      const id = api.createEntity();
      const ok = api.setComponent(id, 'Health', JSON.stringify({ hp: 50, maxHp: 100 }));
      expect(ok).toBe(true);
      const json = api.getComponent(id, 'Health');
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.hp).toBe(50);
      expect(parsed.maxHp).toBe(100);
    });

    it('setComponent with empty JSON uses defaults', () => {
      const id = api.createEntity();
      const ok = api.setComponent(id, 'Health', '');
      expect(ok).toBe(true);
      const parsed = JSON.parse(api.getComponent(id, 'Health')!);
      expect(parsed.maxHp).toBe(100);
      expect(parsed.hp).toBe(100);
    });

    it('setComponent returns false for unknown component name', () => {
      const id = api.createEntity();
      expect(api.setComponent(id, 'NonExistent', '{}')).toBe(false);
    });

    it('setComponent returns false for invalid JSON', () => {
      const id = api.createEntity();
      expect(api.setComponent(id, 'Health', '{not json')).toBe(false);
    });

    it('getComponent returns null for missing component', () => {
      const id = api.createEntity();
      expect(api.getComponent(id, 'Health')).toBeNull();
    });

    it('hasComponent checks presence', () => {
      const id = api.createEntity();
      expect(api.hasComponent(id, 'Health')).toBe(false);
      api.setComponent(id, 'Health', '{"hp":10,"maxHp":10}');
      expect(api.hasComponent(id, 'Health')).toBe(true);
    });

    it('removeComponent removes and returns true', () => {
      const id = api.createEntity();
      api.setComponent(id, 'Health', '{"hp":10,"maxHp":10}');
      expect(api.removeComponent(id, 'Health')).toBe(true);
      expect(api.hasComponent(id, 'Health')).toBe(false);
      expect(api.removeComponent(id, 'Health')).toBe(false);
    });

    it('queryEntities returns ids with given component', () => {
      const a = api.createEntity('A');
      const b = api.createEntity('B');
      const c = api.createEntity('C');
      api.setComponent(a, 'Health', '{"hp":10,"maxHp":10}');
      api.setComponent(c, 'Health', '{"hp":20,"maxHp":20}');
      const ids = api.queryEntities('Health');
      expect(ids).toHaveLength(2);
      expect(ids).toContain(a);
      expect(ids).toContain(c);
      expect(ids).not.toContain(b);
    });

    it('listComponentNames includes all registered types', () => {
      const names = api.listComponentNames();
      expect(names).toContain('Transform');
      expect(names).toContain('Velocity');
      expect(names).toContain('Health');
      expect(names).toContain('Tag');
      expect(names).toContain('Lifetime');
      expect(names).toContain('PlayerInput');
    });
  });

  // ── Transform 专用 ───────────────────────────────────────────
  describe('Transform helpers', () => {
    it('setEntityPosition sets position', () => {
      const id = api.createEntity();
      api.setEntityPosition(id, 1, 2, 3);
      const [x, y, z] = api.getEntityPosition(id);
      expect(x).toBe(1);
      expect(y).toBe(2);
      expect(z).toBe(3);
    });

    it('setEntityPosition also updates sceneNode', () => {
      const id = api.createEntity();
      api.setEntityPosition(id, 5, 6, 7);
      const node = world.getSceneNode(id);
      expect(node).not.toBeNull();
      expect(node!.position.x).toBe(5);
      expect(node!.position.y).toBe(6);
      expect(node!.position.z).toBe(7);
    });

    it('getEntityPosition returns [0,0,0] for non-existent entity', () => {
      const [x, y, z] = api.getEntityPosition(0xfffffff);
      expect(x).toBe(0);
      expect(y).toBe(0);
      expect(z).toBe(0);
    });

    it('setEntityScale updates transform and sceneNode', () => {
      const id = api.createEntity();
      api.setEntityScale(id, 2, 3, 4);
      const t = world.getComponent(id, TransformC);
      expect(t?.scale).toEqual([2, 3, 4]);
      const node = world.getSceneNode(id);
      expect(node!.scale.x).toBe(2);
    });
  });

  // ── Health 专用 ──────────────────────────────────────────────
  describe('Health helpers', () => {
    it('setEntityHealth sets hp and maxHp', () => {
      const id = api.createEntity();
      api.setEntityHealth(id, 30, 100);
      const h = api.getEntityHealth(id);
      expect(h).toEqual({ hp: 30, maxHp: 100 });
    });

    it('setEntityHealth without maxHp keeps existing maxHp', () => {
      const id = api.createEntity();
      api.setEntityHealth(id, 50, 100);
      api.setEntityHealth(id, 30);
      const h = api.getEntityHealth(id);
      expect(h).toEqual({ hp: 30, maxHp: 100 });
    });

    it('getEntityHealth returns null for missing', () => {
      const id = api.createEntity();
      expect(api.getEntityHealth(id)).toBeNull();
    });

    it('damageEntity reduces hp', () => {
      const id = api.createEntity();
      api.setEntityHealth(id, 100, 100);
      expect(api.damageEntity(id, 30)).toBe(true);
      expect(api.getEntityHealth(id)?.hp).toBe(70);
    });

    it('damageEntity returns false for missing health', () => {
      const id = api.createEntity();
      expect(api.damageEntity(id, 10)).toBe(false);
    });

    it('healEntity increases hp capped at maxHp', () => {
      const id = api.createEntity();
      api.setEntityHealth(id, 90, 100);
      api.healEntity(id, 30);
      expect(api.getEntityHealth(id)?.hp).toBe(100);
    });
  });

  // ── Tag 专用 ─────────────────────────────────────────────────
  describe('Tag helpers', () => {
    it('setEntityTag sets tag value', () => {
      const id = api.createEntity();
      api.setEntityTag(id, 'Player');
      expect(api.getEntityTag(id)).toBe('Player');
    });

    it('setEntityTag overwrites existing tag', () => {
      const id = api.createEntity();
      api.setEntityTag(id, 'Player');
      api.setEntityTag(id, 'Enemy');
      expect(api.getEntityTag(id)).toBe('Enemy');
    });

    it('getEntityTag returns null for missing', () => {
      const id = api.createEntity();
      expect(api.getEntityTag(id)).toBeNull();
    });

    it('queryByTag returns matching entities', () => {
      const a = api.createEntity('A');
      const b = api.createEntity('B');
      const c = api.createEntity('C');
      api.setEntityTag(a, 'Enemy');
      api.setEntityTag(b, 'Player');
      api.setEntityTag(c, 'Enemy');
      const enemies = api.queryByTag('Enemy');
      expect(enemies).toHaveLength(2);
      expect(enemies).toContain(a);
      expect(enemies).toContain(c);
    });
  });

  // ── Velocity 专用 ────────────────────────────────────────────
  describe('Velocity helpers', () => {
    it('setEntityVelocity sets linear velocity', () => {
      const id = api.createEntity();
      api.setEntityVelocity(id, 1, 2, 3);
      const v = api.getEntityVelocity(id);
      expect(v).toEqual([1, 2, 3]);
    });

    it('getEntityVelocity returns null for missing', () => {
      const id = api.createEntity();
      expect(api.getEntityVelocity(id)).toBeNull();
    });
  });

  // ── Tick 回调 (Phase 3.2) ────────────────────────────────────
  describe('Tick callbacks', () => {
    it('onTick registers callback', () => {
      let called = 0;
      api.onTick(() => { called++; });
      expect(api.tickCallbackCount()).toBe(1);
      api.tick(0.016);
      expect(called).toBe(1);
    });

    it('onTick returns unsubscribe function', () => {
      let called = 0;
      const unsub = api.onTick(() => { called++; });
      api.tick(0.016);
      expect(called).toBe(1);
      unsub();
      expect(api.tickCallbackCount()).toBe(0);
      api.tick(0.016);
      expect(called).toBe(1); // not called again
    });

    it('multiple callbacks all fire', () => {
      let a = 0, b = 0;
      api.onTick(() => { a++; });
      api.onTick(() => { b++; });
      api.tick(0.016);
      expect(a).toBe(1);
      expect(b).toBe(1);
    });

    it('tick passes dt to callback', () => {
      let received = 0;
      api.onTick((dt) => { received = dt; });
      api.tick(0.033);
      expect(received).toBeCloseTo(0.033);
    });

    it('one callback error does not block others', () => {
      let called = false;
      api.onTick(() => { throw new Error('boom'); });
      api.onTick(() => { called = true; });
      // Suppress console.error for this test
      const origError = console.error;
      console.error = () => {};
      api.tick(0.016);
      console.error = origError;
      expect(called).toBe(true);
    });

    it('clearTickCallbacks removes all', () => {
      api.onTick(() => {});
      api.onTick(() => {});
      expect(api.tickCallbackCount()).toBe(2);
      api.clearTickCallbacks();
      expect(api.tickCallbackCount()).toBe(0);
    });
  });

  // ── createComponentFromJson 边界情况 ─────────────────────────
  describe('Component JSON parsing', () => {
    it('parses Transform with position/rotation/scale', () => {
      const id = api.createEntity();
      api.setComponent(id, 'Transform', JSON.stringify({
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
        scale: [2, 2, 2],
      }));
      const t = world.getComponent(id, TransformC);
      expect(t?.position).toEqual([1, 2, 3]);
      expect(t?.scale).toEqual([2, 2, 2]);
    });

    it('parses Velocity with linear and angularY', () => {
      const id = api.createEntity();
      api.setComponent(id, 'Velocity', JSON.stringify({
        linear: [1, 0, 0],
        angularY: 0.5,
      }));
      const v = world.getComponent(id, VelocityC);
      expect(v?.linear).toEqual([1, 0, 0]);
      expect(v?.angularY).toBe(0.5);
    });

    it('parses Tag with value', () => {
      const id = api.createEntity();
      api.setComponent(id, 'Tag', JSON.stringify({ value: 'Boss' }));
      const tag = world.getComponent(id, TagC);
      expect(tag?.value).toBe('Boss');
    });

    it('parses Lifetime with remaining', () => {
      const id = api.createEntity();
      api.setComponent(id, 'Lifetime', JSON.stringify({ remaining: 5 }));
      const lt = world.getComponent(id, LifetimeC);
      expect(lt?.remaining).toBe(5);
    });

    it('parses PlayerInput with all fields', () => {
      const id = api.createEntity();
      api.setComponent(id, 'PlayerInput', JSON.stringify({
        forward: 1,
        right: -1,
        run: true,
        jump: false,
        attack: true,
        cameraYaw: 1.57,
      }));
      const p = world.getComponent(id, PlayerInputC);
      expect(p?.forward).toBe(1);
      expect(p?.right).toBe(-1);
      expect(p?.run).toBe(true);
      expect(p?.attack).toBe(true);
      expect(p?.cameraYaw).toBeCloseTo(1.57);
    });

    it('Health defaults maxHp to 100 when missing', () => {
      const id = api.createEntity();
      api.setComponent(id, 'Health', JSON.stringify({ hp: 50 }));
      const h = world.getComponent(id, HealthC);
      expect(h?.maxHp).toBe(100);
      expect(h?.hp).toBe(50);
    });
  });
});
