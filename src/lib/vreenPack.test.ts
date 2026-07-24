// Phase 2.3.1 — ECS World ↔ .vreen 容器端到端往返测试。
//
// 验证链路:World.toJSON() → PackInput.world → packVreenPackage(zip bytes)
//   → unpackVreenPackage → UnpackedVreen.world → World.loadJSON()
//   → 还原后 entity/name/sceneNode TRS/POJO 组件数据一致。
//
// 同时覆盖:
//   - NON_POJO_COMPONENTS (MeshRef/SkinnedMeshRef/AnimState) 在 pack 时不持久化、
//     unpack 后缺失(由调用方重新 attach)。
//   - 多实体场景的稳定性(query 顺序、entity count)。
//   - manifest.world 的 schema 校验(validateManifest 拒绝错误 version / 非数组 entities)。

import { describe, it, expect } from 'vitest';
import {
  packVreenPackage,
  unpackVreenPackage,
  VREEN_FORMAT_VERSION,
  type PackInput,
} from './vreenPack';
import { validateManifest, VreenFormatError, type VreenManifest, type VreenScriptEntry } from './vreenManifest';
import {
  World,
  Transform,
  TransformC,
  Velocity,
  VelocityC,
  Health,
  HealthC,
  Tag,
  TagC,
  Lifetime,
  LifetimeC,
  PlayerInput,
  PlayerInputC,
  type ComponentRegistry,
  type WorldJson,
} from '@/engine/ECS';

/** Phase 2.3.1 用的标准组件注册表(仅 POJO 组件)。 */
function pojoRegistry(): ComponentRegistry {
  return {
    Transform: () => new Transform(),
    Velocity: () => new Velocity(),
    Health: () => new Health(1),
    Tag: () => new Tag(''),
    Lifetime: () => new Lifetime(0),
    PlayerInput: () => new PlayerInput(),
  };
}

/** 构造一个含多种 POJO 组件 + 一个 NON_POJO 标记(MeshRef 通过占位验证跳过) 的 World。
 *  注意:World.toJSON 序列化的是 `entity.sceneNode`(Object3D 本身)的 TRS,
 *  不是 Transform 组件的 TRS。两者在 MovementSystem 等系统中会被同步,
 *  但在序列化快照这一层是独立的。因此本测试同时设置 sceneNode TRS
 *  (作为权威渲染端 TRS)与 Transform 组件(作为权威逻辑端 TRS),
 *  验证两端 round-trip 都保留。 */
function buildSampleWorld(name: string): World {
  const w = new World({ name });

  const hero = w.createEntity('Hero');
  // sceneNode TRS — 这是会被 .vreen 序列化的字段
  const heroNode = w.getSceneNode(hero)!;
  heroNode.position.set(1.5, 2.0, 3.5);
  heroNode.rotation.set(0.1, 0.2, 0.3, 0.9);
  // Transform 组件 — 也会被序列化(POJO),独立于 sceneNode
  w.setComponent(hero, TransformC, Transform.fromPos(1.5, 2.0, 3.5));
  w.setComponent(hero, HealthC, new Health(120, 90));
  const heroVel = new Velocity();
  heroVel.linear = [0.5, 0, -1.2];
  heroVel.angularY = 0.4;
  w.setComponent(hero, VelocityC, heroVel);
  const heroInput = new PlayerInput();
  heroInput.forward = 1;
  heroInput.run = true;
  heroInput.cameraYaw = Math.PI / 2;
  w.setComponent(hero, PlayerInputC, heroInput);

  const enemy = w.createEntity('Enemy');
  const enemyNode = w.getSceneNode(enemy)!;
  enemyNode.position.set(-5, 0, 4);
  enemyNode.rotation.set(0, 0.7071, 0, 0.7071); // 绕 Y 90°
  enemyNode.scale.set(2, 2, 2);
  const enemyT = new Transform();
  enemyT.rotation = [0, 0.7071, 0, 0.7071];
  enemyT.scale = [2, 2, 2];
  w.setComponent(enemy, TransformC, enemyT);
  w.setComponent(enemy, HealthC, new Health(50, 50));
  w.setComponent(enemy, TagC, new Tag('Hostile'));

  const fx = w.createEntity('Burst');
  w.setComponent(fx, LifetimeC, new Lifetime(1.25));

  // 推进若干帧,确保 frame 计数非零
  for (let i = 0; i < 7; i++) w.update(0.016);
  return w;
}

describe('Phase 2.3.1 — ECS ↔ .vreen end-to-end serialization', () => {
  describe('packVreenPackage + unpackVreenPackage round-trip', () => {
    it('world 字段在 pack 后通过 unpack 取出保持 deep-equal', async () => {
      const w = buildSampleWorld('RoundTripWorld');
      const worldJson: WorldJson = w.toJSON();

      const input: PackInput = {
        name: 'round-trip',
        assetName: 'sample',
        world: worldJson,
        generator: 'test-runner',
      };
      const { bytes, manifest } = packVreenPackage(input);

      // sanity: manifest 已包含 world,且 schema 校验通过
      expect(manifest.world).toBeDefined();
      expect(manifest.world!.version).toBe('0.2.0');
      expect(manifest.world!.entities).toHaveLength(3);
      validateManifest(manifest); // 不抛异常

      const unpacked = await unpackVreenPackage(bytes);
      expect(unpacked.world).not.toBeNull();
      // 结构等价(顺序、字段值)
      expect(unpacked.world).toEqual(worldJson);
    });

    it('World.loadJSON 还原后 entity / name / sceneNode TRS 一致', async () => {
      const w = buildSampleWorld('RestoreWorld');
      const originalJson = w.toJSON();

      const { bytes } = packVreenPackage({
        name: 'restore',
        assetName: 'restore-asset',
        world: originalJson,
      });
      const unpacked = await unpackVreenPackage(bytes);
      const restoredJson = unpacked.world!;

      const w2 = new World({ name: 'empty' });
      w2.loadJSON(restoredJson, pojoRegistry());

      // entity count 一致
      expect(w2.entityCount()).toBe(w.entityCount());
      expect(w2.name).toBe(originalJson.name);
      expect(w2.frame()).toBe(originalJson.frame);

      // 按 name 索引还原后的实体,验证 TRS
      const byName = new Map<string, ReturnType<World['getEntitySnapshot']>>();
      w2.forEachEntity((id) => byName.set(w2.getName(id)!, w2.getEntitySnapshot(id)));

      const heroSnap = byName.get('Hero')!;
      expect(heroSnap).toBeDefined();
      expect(heroSnap.sceneNode.position).toEqual([1.5, 2.0, 3.5]);
      expect(heroSnap.sceneNode.scale).toEqual([1, 1, 1]);

      const enemySnap = byName.get('Enemy')!;
      expect(enemySnap.sceneNode.position).toEqual([-5, 0, 4]);
      expect(enemySnap.sceneNode.rotation[0]).toBeCloseTo(0, 5);
      expect(enemySnap.sceneNode.rotation[1]).toBeCloseTo(0.7071, 4);
      expect(enemySnap.sceneNode.scale).toEqual([2, 2, 2]);
    });

    it('World.loadJSON 还原后 POJO 组件数据一致', async () => {
      const w = buildSampleWorld('CompWorld');
      const { bytes } = packVreenPackage({
        name: 'comps',
        assetName: 'comps-asset',
        world: w.toJSON(),
      });
      const unpacked = await unpackVreenPackage(bytes);

      const w2 = new World();
      w2.loadJSON(unpacked.world!, pojoRegistry());

      // 找 Hero
      let heroId = -1;
      w2.forEachEntity((id, name) => {
        if (name === 'Hero') heroId = id;
      });
      expect(heroId).not.toBe(-1);

      const hp = w2.getComponent(heroId, HealthC);
      expect(hp).toBeDefined();
      expect(hp!.maxHp).toBe(120);
      expect(hp!.hp).toBe(90);

      const vel = w2.getComponent(heroId, VelocityC);
      expect(vel).toBeDefined();
      expect(vel!.linear).toEqual([0.5, 0, -1.2]);
      expect(vel!.angularY).toBeCloseTo(0.4, 5);

      const inp = w2.getComponent(heroId, PlayerInputC);
      expect(inp).toBeDefined();
      expect(inp!.forward).toBe(1);
      expect(inp!.run).toBe(true);
      expect(inp!.cameraYaw).toBeCloseTo(Math.PI / 2, 5);

      // 找 Enemy 验证 Tag
      let enemyId = -1;
      w2.forEachEntity((id, name) => {
        if (name === 'Enemy') enemyId = id;
      });
      const tag = w2.getComponent(enemyId, TagC);
      expect(tag).toBeDefined();
      expect(tag!.value).toBe('Hostile');

      // 找 Burst 验证 Lifetime
      let fxId = -1;
      w2.forEachEntity((id, name) => {
        if (name === 'Burst') fxId = id;
      });
      const lt = w2.getComponent(fxId, LifetimeC);
      expect(lt).toBeDefined();
      expect(lt!.remaining).toBeCloseTo(1.25, 5);
    });

    it('NON_POJO 组件 (MeshRef/SkinnedMeshRef/AnimState) 不进 .vreen', async () => {
      // toJSON 本身就该跳过它们,Phase 2.3.1 验证端到端:
      // 即使人为塞进 manifest.world,反序列化时 loadJSON 也会跳过。
      const w = new World({ name: 'NonPojo' });
      const id = w.createEntity('Actor');
      w.setComponent(id, TransformC, new Transform());

      // 人为构造一个含 NON_POJO key 的 world json
      const json = w.toJSON();
      // 直接 cast:模拟旧版本数据中误存的 NON_POJO 字段
      (json.entities[0].components as Record<string, unknown>).MeshRef = { __ref: true };
      (json.entities[0].components as Record<string, unknown>).AnimState = { clip: 'Idle' };

      const { bytes } = packVreenPackage({
        name: 'non-pojo',
        assetName: 'non-pojo-asset',
        world: json,
      });
      const unpacked = await unpackVreenPackage(bytes);

      const w2 = new World();
      // loadJSON 应跳过 MeshRef / AnimState 而不抛错
      expect(() => w2.loadJSON(unpacked.world!, pojoRegistry())).not.toThrow();
      expect(w2.entityCount()).toBe(1);

      // 还原后只应有 Transform,不应出现 MeshRef/AnimState
      let restoredId = -1;
      w2.forEachEntity((i) => { restoredId = i; });
      const snap = w2.getEntitySnapshot(restoredId);
      expect(snap).toBeDefined();
      expect(snap!.components['Transform']).toBeDefined();
      // snap 里 MeshRef/AnimState 会出现为 { __ref: true }(snapshot 标记),
      // 但 toJSON/loadJSON 不持久化。验证 toJSON 后没有它们:
      const reJson = w2.toJSON();
      expect(reJson.entities[0].components['MeshRef']).toBeUndefined();
      expect(reJson.entities[0].components['AnimState']).toBeUndefined();
    });

    it('空 World round-trip(entities=[])', async () => {
      const w = new World({ name: 'Empty' });
      const { bytes, manifest } = packVreenPackage({
        name: 'empty-world',
        assetName: 'empty',
        world: w.toJSON(),
      });
      expect(manifest.world!.entities).toHaveLength(0);

      const unpacked = await unpackVreenPackage(bytes);
      const w2 = new World();
      w2.loadJSON(unpacked.world!, pojoRegistry());
      expect(w2.entityCount()).toBe(0);
      expect(w2.name).toBe('Empty');
    });

    it('frame 计数在 round-trip 后保留', async () => {
      const w = new World({ name: 'FrameWorld' });
      for (let i = 0; i < 42; i++) w.update(0.016);
      const { bytes } = packVreenPackage({
        name: 'frames',
        assetName: 'frames-asset',
        world: w.toJSON(),
      });
      const unpacked = await unpackVreenPackage(bytes);
      const w2 = new World();
      w2.loadJSON(unpacked.world!, pojoRegistry());
      expect(w2.frame()).toBe(42);
    });

    it('不带 world 字段的 .vreen 包 unpack 后 world=null', async () => {
      const { bytes } = packVreenPackage({
        name: 'no-world',
        assetName: 'no-world-asset',
      });
      const unpacked = await unpackVreenPackage(bytes);
      expect(unpacked.world).toBeNull();
    });
  });

  describe('manifest.world schema validation', () => {
    it('拒绝错误的 world.version', () => {
      const manifest = {
        version: VREEN_FORMAT_VERSION,
        exportedAt: '2026-07-23T00:00:00Z',
        name: 'bad',
        assetName: 'bad',
        assets: [],
        primaryModelId: null,
        world: { version: '0.1.0', name: 'x', frame: 0, entities: [] },
        generator: 'test',
      } as unknown as VreenManifest;
      expect(() => validateManifest(manifest)).toThrow(VreenFormatError);
      expect(() => validateManifest(manifest)).toThrow(/world\.version/);
    });

    it('拒绝 world.entities 非数组', () => {
      const manifest = {
        version: VREEN_FORMAT_VERSION,
        exportedAt: '2026-07-23T00:00:00Z',
        name: 'bad',
        assetName: 'bad',
        assets: [],
        primaryModelId: null,
        world: { version: '0.2.0', name: 'x', frame: 0, entities: {} },
        generator: 'test',
      } as unknown as VreenManifest;
      expect(() => validateManifest(manifest)).toThrow(/entities must be an array/);
    });

    it('world 缺失时视为合法(向后兼容)', () => {
      const manifest = {
        version: VREEN_FORMAT_VERSION,
        exportedAt: '2026-07-23T00:00:00Z',
        name: 'ok',
        assetName: 'ok',
        assets: [],
        primaryModelId: null,
        generator: 'test',
      } as unknown as VreenManifest;
      expect(() => validateManifest(manifest)).not.toThrow();
    });
  });

  describe('round-trip 稳定性(顺序无关 ID)', () => {
    it('多次 pack/unpack 应产生等价的 world', async () => {
      const w = buildSampleWorld('StableWorld');
      const json1 = w.toJSON();

      const { bytes: bytes1 } = packVreenPackage({
        name: 'stable',
        assetName: 'stable-asset',
        world: json1,
      });
      const unpacked1 = await unpackVreenPackage(bytes1);
      const json2 = unpacked1.world!;

      // 再 pack/unpack 一次
      const { bytes: bytes2 } = packVreenPackage({
        name: 'stable',
        assetName: 'stable-asset',
        world: json2,
      });
      const unpacked2 = await unpackVreenPackage(bytes2);

      expect(unpacked2.world).toEqual(json2);
      expect(unpacked2.world).toEqual(json1);
    });
  });
});

describe('Phase 3.5 — Blockly scripts round-trip', () => {
  function makeScript(id: string, name: string): VreenScriptEntry {
    return {
      id,
      name,
      workspace: { blocks: { blocks: [{ type: 'vreen_entity_create', id: `${id}_b1` }] } },
      generatedCode: `// ${id}\nVREEN.entityCreate();`,
      updatedAt: '2026-07-23T10:00:00.000Z',
    };
  }

  it('pack 时未传 scripts,unpack 后 scripts 为 []', async () => {
    const { bytes } = packVreenPackage({
      name: 'no-scripts',
      assetName: 'asset',
    });
    const u = await unpackVreenPackage(bytes);
    expect(u.scripts).toEqual([]);
    expect(u.scene.scripts).toBeUndefined();
  });

  it('input.scripts 写入 scene.scripts 并能被 unpack 读出', async () => {
    const scripts = [makeScript('id1', 'a'), makeScript('id2', 'b')];
    const { bytes } = packVreenPackage({
      name: 'with-scripts',
      assetName: 'asset',
      scripts,
    });
    const u = await unpackVreenPackage(bytes);
    expect(u.scripts).toHaveLength(2);
    expect(u.scripts[0].id).toBe('id1');
    expect(u.scripts[1].name).toBe('b');
    expect(u.scene.scripts).toEqual(scripts);
  });

  it('input.scripts 覆盖 scene.scripts(同时传时)', async () => {
    const scene: import('./vreenManifest').VreenScene = {
      version: VREEN_FORMAT_VERSION,
      camera: {},
      animation: { speed: 1 },
      environment: {},
      postFX: {},
      materials: {},
      scripts: [makeScript('scene_only', 'from_scene')],
    };
    const override = [makeScript('override', 'from_input')];
    const { bytes } = packVreenPackage({
      name: 'override',
      assetName: 'asset',
      scene,
      scripts: override,
    });
    const u = await unpackVreenPackage(bytes);
    expect(u.scripts).toHaveLength(1);
    expect(u.scripts[0].id).toBe('override');
    expect(u.scene.scripts).toEqual(override);
  });

  it('只传 scene.scripts(无 input.scripts)时保留 scene.scripts', async () => {
    const scene: import('./vreenManifest').VreenScene = {
      version: VREEN_FORMAT_VERSION,
      camera: {},
      animation: { speed: 1 },
      environment: {},
      postFX: {},
      materials: {},
      scripts: [makeScript('keep', 'from_scene')],
    };
    const { bytes } = packVreenPackage({
      name: 'keep-scene',
      assetName: 'asset',
      scene,
    });
    const u = await unpackVreenPackage(bytes);
    expect(u.scripts).toHaveLength(1);
    expect(u.scripts[0].id).toBe('keep');
  });

  it('generatedCode 可选字段保持 undefined', async () => {
    const scripts: VreenScriptEntry[] = [{
      id: 'nocode',
      name: 'no_code',
      workspace: {},
      updatedAt: '2026-07-23T10:00:00.000Z',
    }];
    const { bytes } = packVreenPackage({
      name: 'no-code',
      assetName: 'asset',
      scripts,
    });
    const u = await unpackVreenPackage(bytes);
    expect(u.scripts[0].generatedCode).toBeUndefined();
  });

  it('往返后 workspace 内容完整保留', async () => {
    const original: VreenScriptEntry = {
      id: 'rt',
      name: 'roundtrip',
      workspace: {
        blocks: {
          blocks: [
            { type: 'vreen_entity_create', id: 'b1', x: 10, y: 20 },
            { type: 'vreen_tick_on', id: 'b2', inputs: { dt: { block: { type: 'math_number' } } } },
          ],
        },
      },
      generatedCode: 'VREEN.entityCreate();',
      updatedAt: '2026-07-23T10:00:00.000Z',
    };
    const { bytes } = packVreenPackage({
      name: 'rt',
      assetName: 'asset',
      scripts: [original],
    });
    const u = await unpackVreenPackage(bytes);
    expect(u.scripts[0]).toEqual(original);
    expect(u.scripts[0].workspace).toEqual(original.workspace);
  });

  it('空 scripts 数组也能往返', async () => {
    const { bytes } = packVreenPackage({
      name: 'empty',
      assetName: 'asset',
      scripts: [],
    });
    const u = await unpackVreenPackage(bytes);
    expect(u.scripts).toEqual([]);
    expect(u.scene.scripts).toEqual([]);
  });

  it('validateScene 拒绝损坏的 scripts', () => {
    // 直接调用 packVreenPackage 时,scene 中的 scripts 已经校验
    const badScene: import('./vreenManifest').VreenScene = {
      version: VREEN_FORMAT_VERSION,
      camera: {},
      animation: { speed: 1 },
      environment: {},
      postFX: {},
      materials: {},
      scripts: [{ id: 'x', name: 'bad' /* missing workspace+updatedAt */ } as unknown as VreenScriptEntry],
    };
    expect(() =>
      packVreenPackage({ name: 'bad', assetName: 'asset', scene: badScene }),
    ).toThrow(/scene\.scripts|VreenFormatError/);
  });
});
