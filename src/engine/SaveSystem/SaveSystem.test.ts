// SaveSystem 测试 — 多槽位 + 自动保存 + 持久化。
//
// 验证:
//   • save / load 槽位往返
//   • deleteSlot / getSlot / getSlots
//   • maxSlots 槽位上限
//   • exportSlot / importSlot 跨实例迁移
//   • enableAutoSave / disableAutoSave / update 触发自动保存
//   • 持久化:StorageAdapter 中确有压缩字符串
import { describe, it, expect, beforeEach } from 'vitest';
import { Scene } from '../Core/Scene';
import { Mesh } from '../Core/Mesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { World } from '../ECS/World';
import {
  Transform,
  TransformC,
  Health,
  HealthC,
} from '../ECS/Components';
import { StandardMaterial } from '../Materials/StandardMaterial';
import {
  SaveSystem,
  AUTO_SAVE_SLOT_ID,
  LocalStorageAdapter,
  MemoryStorageBackend,
  SaveSerializer,
} from './index';

function makeTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(
    new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
    3,
  ));
  g.setIndex([0, 1, 2]);
  return g;
}

function makeScene(): Scene {
  const scene = new Scene();
  const mesh = new Mesh(makeTriangle(), new StandardMaterial());
  mesh.name = 'Tri';
  scene.add(mesh);
  return scene;
}

function makeWorld(): World {
  const w = new World({ name: 'W' });
  const id = w.createEntity('hero');
  w.setComponent(id, TransformC, Transform.fromPos(1, 2, 3));
  w.setComponent(id, HealthC, new Health(100, 50));
  return w;
}

const registry = {
  Transform: () => new Transform(),
  Health: () => new Health(1),
};

function makeSystem(): SaveSystem {
  return new SaveSystem({
    maxSlots: 3,
    storage: new LocalStorageAdapter({
      backend: new MemoryStorageBackend(),
      prefix: 'test:',
    }),
    componentRegistry: registry,
  });
}

describe('SaveSystem — 槽位 CRUD', () => {
  let sys: SaveSystem;
  beforeEach(() => {
    sys = makeSystem();
  });

  it('save 创建新槽位', () => {
    const slot = sys.save('s1', 'First', makeScene(), makeWorld());
    expect(slot.id).toBe('s1');
    expect(slot.name).toBe('First');
    expect(slot.timestamp).toBeGreaterThan(0);
    expect(sys.getSlot('s1')).toBe(slot);
    expect(sys.getSlots()).toHaveLength(1);
  });

  it('save 覆盖已有槽位', () => {
    sys.save('s1', 'First', makeScene(), makeWorld());
    const before = sys.getSlot('s1')!.timestamp;
    // 强制时间戳不同
    const slot2 = sys.save('s1', 'Renamed', makeScene(), makeWorld());
    expect(sys.getSlots()).toHaveLength(1);
    expect(slot2.name).toBe('Renamed');
    expect(slot2.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('load 还原 Scene + World', () => {
    const scene = makeScene();
    const world = makeWorld();
    sys.save('s1', 'First', scene, world);
    const loaded = sys.load('s1');
    expect(loaded).not.toBeNull();
    expect(loaded!.scene).toBeInstanceOf(Scene);
    expect(loaded!.scene.children).toHaveLength(1);
    expect(loaded!.world.entityCount()).toBe(1);
    const [eid] = loaded!.world.query();
    const h = loaded!.world.getComponent(eid, HealthC);
    expect(h).toBeDefined();
    expect(h!.hp).toBe(50);
  });

  it('load 不存在的槽位返回 null', () => {
    expect(sys.load('missing')).toBeNull();
  });

  it('deleteSlot 删除并同步持久化', () => {
    sys.save('s1', 'First', makeScene(), makeWorld());
    expect(sys.deleteSlot('s1')).toBe(true);
    expect(sys.getSlot('s1')).toBeUndefined();
    expect(sys.deleteSlot('s1')).toBe(false); // 已删除
  });

  it('getSlots 按时间倒序', async () => {
    sys.save('a', 'A', makeScene(), makeWorld());
    // 让时间戳拉开差距
    await new Promise((r) => setTimeout(r, 5));
    sys.save('b', 'B', makeScene(), makeWorld());
    await new Promise((r) => setTimeout(r, 5));
    sys.save('c', 'C', makeScene(), makeWorld());
    const slots = sys.getSlots();
    expect(slots.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('SaveSystem — maxSlots 上限', () => {
  it('超过上限抛错', () => {
    const sys = makeSystem(); // maxSlots = 3
    sys.save('s1', 'a', makeScene(), makeWorld());
    sys.save('s2', 'b', makeScene(), makeWorld());
    sys.save('s3', 'c', makeScene(), makeWorld());
    expect(() => sys.save('s4', 'd', makeScene(), makeWorld())).toThrow(/slot limit/);
  });

  it('覆盖已有槽位不触发上限', () => {
    const sys = makeSystem();
    sys.save('s1', 'a', makeScene(), makeWorld());
    sys.save('s2', 'b', makeScene(), makeWorld());
    sys.save('s3', 'c', makeScene(), makeWorld());
    // 覆盖 s1 不抛
    expect(() => sys.save('s1', 'a2', makeScene(), makeWorld())).not.toThrow();
    expect(sys.getSlots()).toHaveLength(3);
  });
});

describe('SaveSystem — export / import', () => {
  it('exportSlot 返回 JSON 字符串', () => {
    const sys = makeSystem();
    sys.save('s1', 'First', makeScene(), makeWorld());
    const s = sys.exportSlot('s1');
    expect(typeof s).toBe('string');
    const parsed = JSON.parse(s);
    expect(parsed.slot).toBeDefined();
    expect(parsed.slot.id).toBe('s1');
  });

  it('exportSlot 不存在的槽位抛错', () => {
    const sys = makeSystem();
    expect(() => sys.exportSlot('missing')).toThrow(/not found/);
  });

  it('importSlot 跨实例迁移', () => {
    const sys1 = makeSystem();
    sys1.save('s1', 'Original', makeScene(), makeWorld());
    const exported = sys1.exportSlot('s1');

    const sys2 = makeSystem();
    const slot = sys2.importSlot(exported);
    expect(slot.id).toBe('s1');
    expect(slot.name).toBe('Original');
    expect(sys2.getSlot('s1')).toBeDefined();
    // 可以 load
    const loaded = sys2.load('s1');
    expect(loaded).not.toBeNull();
    expect(loaded!.world.entityCount()).toBe(1);
  });

  it('importSlot 用 newSlotId 重命名', () => {
    const sys1 = makeSystem();
    sys1.save('s1', 'Original', makeScene(), makeWorld());
    const exported = sys1.exportSlot('s1');

    const sys2 = makeSystem();
    sys2.importSlot(exported, 'renamed');
    expect(sys2.getSlot('s1')).toBeUndefined();
    expect(sys2.getSlot('renamed')).toBeDefined();
  });

  it('importSlot 非法 JSON 抛错', () => {
    const sys = makeSystem();
    expect(() => sys.importSlot('not json')).toThrow(/invalid JSON/);
  });

  it('importSlot 缺字段抛错', () => {
    const sys = makeSystem();
    expect(() => sys.importSlot(JSON.stringify({}))).toThrow(/missing envelope.slot.data/);
  });
});

describe('SaveSystem — 自动保存', () => {
  it('enableAutoSave 设置 autoSave=true', () => {
    const sys = makeSystem();
    sys.enableAutoSave(30);
    expect(sys.autoSave).toBe(true);
    expect(sys.autoSaveInterval).toBe(30);
  });

  it('disableAutoSave 设置 autoSave=false', () => {
    const sys = makeSystem();
    sys.enableAutoSave(30);
    sys.disableAutoSave();
    expect(sys.autoSave).toBe(false);
  });

  it('update 累计 dt 达间隔时触发自动保存', () => {
    const sys = makeSystem();
    const scene = makeScene();
    const world = makeWorld();
    sys.setAutoSaveSource(() => ({ scene, world, name: 'auto' }));
    sys.enableAutoSave(10);

    // 累计 9.5s — 不触发
    sys.update(9.5);
    expect(sys.getSlot(AUTO_SAVE_SLOT_ID)).toBeUndefined();
    // 再 0.5s — 触发
    sys.update(0.5);
    const slot = sys.getSlot(AUTO_SAVE_SLOT_ID);
    expect(slot).toBeDefined();
    expect(slot!.name).toBe('auto');
  });

  it('autoSave 关闭时 update 不触发保存', () => {
    const sys = makeSystem();
    const scene = makeScene();
    const world = makeWorld();
    sys.setAutoSaveSource(() => ({ scene, world }));
    sys.enableAutoSave(1);
    sys.disableAutoSave();
    sys.update(10);
    expect(sys.getSlot(AUTO_SAVE_SLOT_ID)).toBeUndefined();
  });

  it('无 source 时 update 不抛错 (warn + skip)', () => {
    const sys = makeSystem();
    sys.enableAutoSave(1);
    expect(() => sys.update(2)).not.toThrow();
    expect(sys.getSlot(AUTO_SAVE_SLOT_ID)).toBeUndefined();
  });

  it('source 返回 null 时跳过本次保存', () => {
    const sys = makeSystem();
    sys.setAutoSaveSource(() => null);
    sys.enableAutoSave(1);
    sys.update(2);
    expect(sys.getSlot(AUTO_SAVE_SLOT_ID)).toBeUndefined();
  });

  it('自动保存的槽位也能 load', () => {
    const sys = makeSystem();
    const scene = makeScene();
    const world = makeWorld();
    sys.setAutoSaveSource(() => ({ scene, world }));
    sys.enableAutoSave(1);
    sys.update(1.5);
    const loaded = sys.load(AUTO_SAVE_SLOT_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.world.entityCount()).toBe(1);
  });
});

describe('SaveSystem — 持久化', () => {
  it('save 后 storage 中存在压缩字符串', () => {
    const backend = new MemoryStorageBackend();
    const sys = new SaveSystem({
      storage: new LocalStorageAdapter({ backend, prefix: 'persist:' }),
      componentRegistry: registry,
    });
    sys.save('s1', 'First', makeScene(), makeWorld());
    // 直接查 backend 中的 slot:s1
    const raw = backend.getItem('persist:slot:s1');
    expect(raw).not.toBeNull();
    const wrapper = JSON.parse(raw!);
    expect(wrapper.meta.id).toBe('s1');
    expect(wrapper.meta.name).toBe('First');
    expect(typeof wrapper.data).toBe('string');
    // data 字段是 base64 压缩字符串,可解压
    const data = SaveSerializer.decompress(wrapper.data);
    expect(data.world.entities).toHaveLength(1);
  });

  it('save 覆盖时 storage 中条目同步更新', () => {
    const backend = new MemoryStorageBackend();
    const sys = new SaveSystem({
      storage: new LocalStorageAdapter({ backend, prefix: 'persist:' }),
      componentRegistry: registry,
    });
    sys.save('s1', 'First', makeScene(), makeWorld());
    sys.save('s1', 'Renamed', makeScene(), makeWorld());
    const raw = backend.getItem('persist:slot:s1');
    const wrapper = JSON.parse(raw!);
    expect(wrapper.meta.name).toBe('Renamed');
  });

  it('deleteSlot 同步删除 storage 条目', () => {
    const backend = new MemoryStorageBackend();
    const sys = new SaveSystem({
      storage: new LocalStorageAdapter({ backend, prefix: 'persist:' }),
      componentRegistry: registry,
    });
    sys.save('s1', 'First', makeScene(), makeWorld());
    sys.deleteSlot('s1');
    expect(backend.getItem('persist:slot:s1')).toBeNull();
  });

  it('thumbnail 保留在 storage wrapper 中', () => {
    const backend = new MemoryStorageBackend();
    const sys = new SaveSystem({
      storage: new LocalStorageAdapter({ backend, prefix: 'persist:' }),
      componentRegistry: registry,
    });
    sys.save('s1', 'First', makeScene(), makeWorld(), 'data:image/png;base64,abc');
    const raw = backend.getItem('persist:slot:s1');
    const wrapper = JSON.parse(raw!);
    expect(wrapper.thumbnail).toBe('data:image/png;base64,abc');
    expect(wrapper.meta.hasThumbnail).toBe(true);
  });
});
