// SaveSerializer 测试 — Scene+World+metadata 序列化与压缩。
//
// 验证:
//   • serialize 产出合法 SaveData (scene + world + metadata)
//   • deserialize 还原 Scene + World 实例,组件数据往返一致
//   • compress / decompress 往返 (zlib + base64)
//   • decompress 对非法输入抛错
//   • 无 componentRegistry 时 World 仍能重建 (组件被跳过)
import { describe, it, expect } from 'vitest';
import { Scene } from '../Core/Scene';
import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Color } from '../Math/Color';
import { Fog } from '../Core/Fog';
import { World } from '../ECS/World';
import {
  Transform,
  TransformC,
  Health,
  HealthC,
  Velocity,
  VelocityC,
} from '../ECS/Components';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { SaveSerializer, type SaveData } from './SaveSerializer';

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
  scene.background = new Color(0x112233);
  scene.fog = new Fog(0x000000, 1, 100);
  const mesh = new Mesh(makeTriangle(), new StandardMaterial());
  mesh.name = 'Tri';
  mesh.position.set(1, 2, 3);
  const group = new Group();
  group.name = 'Group';
  group.add(mesh);
  scene.add(group);
  return scene;
}

function makeWorld(): World {
  const w = new World({ name: 'TestWorld' });
  const id = w.createEntity('hero');
  w.setComponent(id, TransformC, Transform.fromPos(5, 6, 7));
  w.setComponent(id, HealthC, new Health(100, 80));
  w.setComponent(id, VelocityC, new Velocity());
  return w;
}

const registry = {
  Transform: () => new Transform(),
  Health: () => new Health(1),
  Velocity: () => new Velocity(),
};

describe('SaveSerializer — serialize / deserialize', () => {
  it('serialize 产出合法 SaveData', () => {
    const scene = makeScene();
    const world = makeWorld();
    const data = SaveSerializer.serialize(scene, world, { level: 5 });
    expect(data.scene).toBeDefined();
    expect(data.scene.objects).toHaveLength(1); // Group
    expect(data.world).toBeDefined();
    expect(data.world.entities).toHaveLength(1);
    expect(data.metadata).toMatchObject({ level: 5 });
  });

  it('deserialize 还原 Scene 实例', () => {
    const scene = makeScene();
    const world = makeWorld();
    const data = SaveSerializer.serialize(scene, world);
    const restored = SaveSerializer.deserialize(data, { componentRegistry: registry });
    expect(restored.scene).toBeInstanceOf(Scene);
    expect(restored.scene.children).toHaveLength(1);
    const group = restored.scene.children[0] as Group;
    expect(group).toBeInstanceOf(Group);
    expect(group.name).toBe('Group');
    expect(group.children).toHaveLength(1);
    const mesh = group.children[0] as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.name).toBe('Tri');
    expect(mesh.position.x).toBe(1);
    expect(mesh.position.y).toBe(2);
    expect(mesh.position.z).toBe(3);
  });

  it('deserialize 还原 World 实体与组件', () => {
    const world = makeWorld();
    const scene = new Scene();
    const data = SaveSerializer.serialize(scene, world);
    const restored = SaveSerializer.deserialize(data, { componentRegistry: registry });
    expect(restored.world.entityCount()).toBe(1);
    const [eid] = restored.world.query();
    const h = restored.world.getComponent(eid, HealthC);
    expect(h).toBeDefined();
    expect(h!.hp).toBe(80);
    expect(h!.maxHp).toBe(100);
    const t = restored.world.getComponent(eid, TransformC);
    expect(t).toBeDefined();
    expect(t!.position).toEqual([5, 6, 7]);
  });

  it('background / fog 往返一致', () => {
    const scene = makeScene();
    const world = new World();
    const data = SaveSerializer.serialize(scene, world);
    const restored = SaveSerializer.deserialize(data);
    expect(restored.scene.background).toBeInstanceOf(Color);
    expect((restored.scene.background as Color).getHex()).toBe(0x112233);
    expect(restored.scene.fog).toBeInstanceOf(Fog);
    expect((restored.scene.fog as Fog).near).toBe(1);
    expect((restored.scene.fog as Fog).far).toBe(100);
  });

  it('无 componentRegistry 时 World 仍能重建实体 (组件被跳过)', () => {
    const world = makeWorld();
    const scene = new Scene();
    const data = SaveSerializer.serialize(scene, world);
    const restored = SaveSerializer.deserialize(data);
    expect(restored.world.entityCount()).toBe(1);
    const [eid] = restored.world.query();
    // 无 registry → 组件被跳过
    expect(restored.world.getComponent(eid, HealthC)).toBeUndefined();
  });
});

describe('SaveSerializer — compress / decompress', () => {
  it('compress 返回 base64 字符串', () => {
    const scene = makeScene();
    const world = makeWorld();
    const data = SaveSerializer.serialize(scene, world);
    const s = SaveSerializer.compress(data);
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
    // base64 字符集
    expect(/^[A-Za-z0-9+/=]*$/.test(s)).toBe(true);
  });

  it('decompress(compress(data)) ≡ data', () => {
    const scene = makeScene();
    const world = makeWorld();
    const data = SaveSerializer.serialize(scene, world, { tag: 'round-trip' });
    const s = SaveSerializer.compress(data);
    const back = SaveSerializer.decompress(s);
    expect(back).toEqual(data);
  });

  it('空 Scene+World 也能压缩往返', () => {
    const data = SaveSerializer.serialize(new Scene(), new World(), {});
    const s = SaveSerializer.compress(data);
    const back = SaveSerializer.decompress(s);
    expect(back.scene.objects).toEqual([]);
    expect(back.world.entities).toEqual([]);
  });

  it('decompress 对非法 base64 抛错', () => {
    expect(() => SaveSerializer.decompress('!!!not-base64!!!')).toThrow();
  });

  it('decompress 对非 zlib 数据抛错', () => {
    // 合法 base64 但内容不是 zlib
    const bad = Buffer.from('hello world not zlib').toString('base64');
    expect(() => SaveSerializer.decompress(bad)).toThrow();
  });

  it('decompress 对缺字段的 SaveData 抛错', () => {
    // 构造一个合法压缩但内容缺 world 的 SaveData
    const bad: unknown = { scene: { version: '1.0.0', metadata: {}, background: null, environment: null, fog: null, objects: [] } };
    const s = SaveSerializer.compress(bad as SaveData);
    expect(() => SaveSerializer.decompress(s)).toThrow(/missing scene or world/);
  });
});
