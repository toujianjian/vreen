import { describe, it, expect } from 'vitest';
import { World, System } from './World';
import { Transform, TransformC, Velocity, VelocityC, Health, HealthC, Tag, TagC } from './Components';

describe('ECS World', () => {
  describe('Entity lifecycle', () => {
    it('createEntity returns a valid EntityId', () => {
      const w = new World();
      const id = w.createEntity('test');
      expect(w.isAlive(id)).toBe(true);
      expect(w.getName(id)).toBe('test');
    });

    it('entityCount increases on create', () => {
      const w = new World();
      expect(w.entityCount()).toBe(0);
      w.createEntity('a');
      w.createEntity('b');
      expect(w.entityCount()).toBe(2);
    });

    it('destroyEntity frees the slot and decrements count', () => {
      const w = new World();
      const id = w.createEntity('test');
      expect(w.isAlive(id)).toBe(true);
      w.destroyEntity(id);
      expect(w.isAlive(id)).toBe(false);
      expect(w.entityCount()).toBe(0);
    });

    it('destroyEntity is idempotent (no throw on double destroy)', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.destroyEntity(id);
      expect(() => w.destroyEntity(id)).not.toThrow();
    });

    it('reuses index after destroy (version increments)', () => {
      const w = new World();
      const id1 = w.createEntity('a');
      const idx1 = id1 & 0xFFFFF;
      w.destroyEntity(id1);
      const id2 = w.createEntity('b');
      const idx2 = id2 & 0xFFFFF;
      expect(idx2).toBe(idx1);
      // version should differ
      const v1 = (id1 >>> 20) & 0xFFF;
      const v2 = (id2 >>> 20) & 0xFFF;
      expect(v2).toBe(v1 + 1);
    });

    it('forEachEntity iterates all live entities', () => {
      const w = new World();
      const ids = [w.createEntity('a'), w.createEntity('b'), w.createEntity('c')];
      const collected: number[] = [];
      w.forEachEntity((id) => collected.push(id));
      expect(collected).toEqual(ids);
    });
  });

  describe('Component CRUD', () => {
    it('setComponent and getComponent round-trip', () => {
      const w = new World();
      const id = w.createEntity('test');
      const vel = new Velocity();
      vel.linear = [1, 2, 3];
      w.setComponent(id, VelocityC, vel);
      const got = w.getComponent(id, VelocityC);
      expect(got).toBeDefined();
      expect(got!.linear).toEqual([1, 2, 3]);
    });

    it('hasComponent works after set', () => {
      const w = new World();
      const id = w.createEntity('test');
      expect(w.hasComponent(id, TransformC)).toBe(false);
      w.setComponent(id, TransformC, new Transform());
      expect(w.hasComponent(id, TransformC)).toBe(true);
    });

    it('getComponent returns undefined for missing component', () => {
      const w = new World();
      const id = w.createEntity('test');
      expect(w.getComponent(id, VelocityC)).toBeUndefined();
    });

    it('removeComponent removes the component', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.setComponent(id, HealthC, new Health(100));
      expect(w.hasComponent(id, HealthC)).toBe(true);
      const removed = w.removeComponent(id, HealthC);
      expect(removed).toBe(true);
      expect(w.hasComponent(id, HealthC)).toBe(false);
    });

    it('removeComponent returns false on missing component', () => {
      const w = new World();
      const id = w.createEntity('test');
      expect(w.removeComponent(id, HealthC)).toBe(false);
    });

    it('setComponent replaces existing data', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.setComponent(id, TagC, new Tag('first'));
      expect(w.getComponent(id, TagC)!.value).toBe('first');
      w.setComponent(id, TagC, new Tag('second'));
      expect(w.getComponent(id, TagC)!.value).toBe('second');
    });

    it('getComponents returns null if any component missing', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.setComponent(id, TransformC, new Transform());
      const result = w.getComponents(id, TransformC, VelocityC);
      expect(result).toBeNull();
    });

    it('getComponents returns tuple when both present', () => {
      const w = new World();
      const id = w.createEntity('test');
      const t = new Transform();
      t.position = [10, 20, 30];
      const v = new Velocity();
      v.linear = [1, 1, 1];
      w.setComponent(id, TransformC, t);
      w.setComponent(id, VelocityC, v);
      const result = w.getComponents(id, TransformC, VelocityC);
      expect(result).not.toBeNull();
      expect(result![0].position).toEqual([10, 20, 30]);
      expect(result![1].linear).toEqual([1, 1, 1]);
    });

    it('setComponent on destroyed entity throws', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.destroyEntity(id);
      expect(() => w.setComponent(id, TagC, new Tag('x'))).toThrow();
    });
  });

  describe('Query', () => {
    it('query with no types returns all entities', () => {
      const w = new World();
      const a = w.createEntity('a');
      const b = w.createEntity('b');
      const results = w.query();
      expect(results).toHaveLength(2);
      expect(results).toContain(a);
      expect(results).toContain(b);
    });

    it('query filters by component type', () => {
      const w = new World();
      const a = w.createEntity('a');
      const b = w.createEntity('b');
      w.setComponent(a, VelocityC, new Velocity());
      w.setComponent(b, TransformC, new Transform());
      const results = w.query(VelocityC);
      expect(results).toEqual([a]);
    });

    it('query with multiple types returns intersection', () => {
      const w = new World();
      const a = w.createEntity('a');
      const b = w.createEntity('b');
      w.setComponent(a, TransformC, new Transform());
      w.setComponent(a, VelocityC, new Velocity());
      w.setComponent(b, TransformC, new Transform());
      const results = w.query(TransformC, VelocityC);
      expect(results).toEqual([a]);
    });

    it('query excludes destroyed entities', () => {
      const w = new World();
      const a = w.createEntity('a');
      const b = w.createEntity('b');
      w.setComponent(a, VelocityC, new Velocity());
      w.setComponent(b, TransformC, new Transform());
      w.destroyEntity(a);
      const results = w.query(VelocityC);
      expect(results).toEqual([]);
    });

    it('queryWith calls callback per matching entity', () => {
      const w = new World();
      const a = w.createEntity('a');
      const b = w.createEntity('b');
      w.setComponent(a, VelocityC, new Velocity());
      w.setComponent(b, VelocityC, new Velocity());
      const collected: number[] = [];
      w.queryWith(VelocityC, (id) => { collected.push(id); });
      expect(collected).toHaveLength(2);
      expect(collected).toContain(a);
      expect(collected).toContain(b);
    });

    it('queryWith2 calls callback with both components', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.setComponent(id, TransformC, Transform.fromPos(5, 10, 15));
      w.setComponent(id, VelocityC, new Velocity());
      const results: Array<[number, number, number]> = [];
      w.queryWith2(TransformC, VelocityC, (eid, t, v) => {
        results.push([eid, t.position[0], v.linear[0]]);
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual([id, 5, 0]);
    });
  });

  describe('Serialization (toJSON / loadJSON)', () => {
    it('toJSON returns valid WorldJson for empty world', () => {
      const w = new World({ name: 'empty' });
      const json = w.toJSON();
      expect(json.version).toBe('0.2.0');
      expect(json.name).toBe('empty');
      expect(json.entities).toHaveLength(0);
    });

    it('toJSON serializes all POJO components', () => {
      const w = new World();
      const id = w.createEntity('hero');
      w.setComponent(id, TransformC, Transform.fromPos(1, 2, 3));
      w.setComponent(id, HealthC, new Health(100, 80));
      const json = w.toJSON();
      expect(json.entities).toHaveLength(1);
      const e = json.entities[0];
      expect(e.name).toBe('hero');
      expect(e.components['Transform']).toBeDefined();
      expect(e.components['Health']).toBeDefined();
      const h = e.components['Health'] as { hp: number; maxHp: number };
      expect(h.hp).toBe(80);
      expect(h.maxHp).toBe(100);
    });

    it('toJSON skips NON_POJO components (no MeshRef/Velocity... wait Velocity is POJO)', () => {
      // Velocity is POJO, so it should be included
      const w = new World();
      const id = w.createEntity('test');
      w.setComponent(id, VelocityC, new Velocity());
      const json = w.toJSON();
      expect(json.entities[0].components['Velocity']).toBeDefined();
    });

    it('loadJSON restores entities and components', () => {
      const w = new World();
      const id = w.createEntity('hero');
      w.setComponent(id, TransformC, Transform.fromPos(1, 2, 3));
      w.setComponent(id, HealthC, new Health(100));
      const json = w.toJSON();

      const w2 = new World();
      const registry = { Transform: () => new Transform(), Health: () => new Health(1) };
      w2.loadJSON(json, registry);

      expect(w2.entityCount()).toBe(1);
      // The entity was re-created so id will differ; check by name
      const entities = w2.query();
      expect(entities).toHaveLength(1);
      const restoredId = entities[0];
      const h = w2.getComponent(restoredId, HealthC);
      expect(h).toBeDefined();
      expect(h!.hp).toBe(100);
      expect(h!.maxHp).toBe(100);
    });

    it('loadJSON rejects unsupported version', () => {
      const w = new World();
      expect(() => w.loadJSON(
        { version: '0.1.0' as never, name: 'bad', frame: 0, entities: [] },
        {},
      )).toThrow('unsupported version');
    });

    it('loadJSON with unknown component name warns and skips', () => {
      const w = new World();
      w.loadJSON(
        { version: '0.2.0', name: 'test', frame: 0, entities: [{ id: 1, name: 'x', sceneNode: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] }, components: { Bogus: { x: 1 } } }] },
        {},
      );
      // Should not throw; should skip Bogus
      // The entity is created but with no components
      expect(w.entityCount()).toBe(1);
    });
  });

  describe('System lifecycle', () => {
    it('addSystem and removeSystem work', () => {
      const w = new World();
      let called = false;
      class TestSystem extends System {
        constructor() { super('test', 0); }
        update() { called = true; }
      }
      const sys = new TestSystem();
      w.addSystem(sys);
      expect(w.getSystems()).toHaveLength(1);
      w.update(0.016);
      expect(called).toBe(true);
      w.removeSystem(sys);
      expect(w.getSystems()).toHaveLength(0);
    });

    it('System priority ordering', () => {
      const w = new World();
      const order: number[] = [];
      class PSystem extends System {
        constructor(readonly p: number) { super(`p${p}`, p); }
        update() { order.push(this.p); }
      }
      w.addSystem(new PSystem(10));
      w.addSystem(new PSystem(1));
      w.addSystem(new PSystem(5));
      w.update(0.016);
      expect(order).toEqual([1, 5, 10]);
    });

    it('disabled system is skipped', () => {
      const w = new World();
      let called = false;
      class DSys extends System {
        constructor() { super('disabled', 0); }
        update() { called = true; }
      }
      const sys = new DSys();
      sys.enabled = false;
      w.addSystem(sys);
      w.update(0.016);
      expect(called).toBe(false);
    });
  });

  describe('Entity metadata', () => {
    it('setName and getName round-trip', () => {
      const w = new World();
      const id = w.createEntity('original');
      expect(w.getName(id)).toBe('original');
      w.setName(id, 'renamed');
      expect(w.getName(id)).toBe('renamed');
    });

    it('getName returns null for destroyed entity', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.destroyEntity(id);
      expect(w.getName(id)).toBeNull();
    });

    it('listEntities returns summaries with component names', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.setComponent(id, VelocityC, new Velocity());
      w.setComponent(id, TagC, new Tag('player'));
      const list = w.listEntities();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('test');
      expect(list[0].components).toContain('Velocity');
      expect(list[0].components).toContain('Tag');
    });
  });

  describe('getEntitySnapshot', () => {
    it('returns snapshot with TRS and components', () => {
      const w = new World();
      const id = w.createEntity('snapshot-test');
      w.setComponent(id, TransformC, Transform.fromPos(7, 8, 9));
      const snap = w.getEntitySnapshot(id);
      expect(snap).not.toBeNull();
      expect(snap!.name).toBe('snapshot-test');
      expect(snap!.sceneNode.position).toEqual([0, 0, 0]); // sceneNode TRS is separate from component
      expect(snap!.components['Transform']).toBeDefined();
    });

    it('returns null for destroyed entity', () => {
      const w = new World();
      const id = w.createEntity('test');
      w.destroyEntity(id);
      expect(w.getEntitySnapshot(id)).toBeNull();
    });
  });

  describe('frame()', () => {
    it('increments on each update', () => {
      const w = new World();
      expect(w.frame()).toBe(0);
      w.update(0.016);
      expect(w.frame()).toBe(1);
      w.update(0.016);
      expect(w.frame()).toBe(2);
    });
  });
});