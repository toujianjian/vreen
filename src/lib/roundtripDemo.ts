// roundtripDemo — 验证 ECS World ↔ .vreen 序列化 roundtrip 的最小 demo。
//
// 流程：
//   1. 创建一个 World，加 POJO 组件 (Transform / Velocity / Health / Tag / Lifetime)
//   2. 把它打包成 .vreen zip (0.2.1)
//   3. 解包 .vreen zip
//   4. 在一个新 World 里 loadJSON() 还原
//   5. 断言关键字段一致（entity 数量 / name / position / hp 等）
//
// 运行：浏览器 dev console 里调 runRoundtripDemo() 看结果；
// 或挂到 EngineDemoPage 的「RUN」按钮上。
//
// 这只是数据层 sanity check，不验证渲染管线。

import { createLogger } from '@/lib/logger';
import {
  World,
  Transform,
  Velocity,
  Health,
  Tag,
  Lifetime,
  TransformC,
  VelocityC,
  HealthC,
  TagC,
  LifetimeC,
  entityIndex,
  type WorldJson,
} from '@/engine/ECS';
import { packVreenPackage, unpackVreenPackage } from '@/lib/vreenPack';

const log = createLogger('Demo');

export interface RoundtripReport {
  ok: boolean;
  /** 源 world entity 数 */
  sourceEntityCount: number;
  /** 还原后 world entity 数 */
  restoredEntityCount: number;
  /** name 比对失败的 entity 数 */
  nameMismatches: number;
  /** sceneNode.position 比对失败的 entity 数 */
  positionMismatches: number;
  /** Health.hp 比对失败的 entity 数 */
  healthMismatches: number;
  /** frame 是否一致 */
  frameMatch: boolean;
  /** 含 "Mesh:" 前缀的 entity 数量 (Phase 2 验证) */
  meshEntityCount: number;
  /** 错误信息（ok=false 时填） */
  error: string | null;
}

export async function runRoundtripDemo(): Promise<RoundtripReport> {
  // ── 1. 构造源 world ──────────────────────────────────────
  const src = new World({ name: 'RoundtripSrc' });
  src.update(0); // 把 _frame 推到 1

  const e1 = src.createEntity('Player');
  const t1 = new Transform();
  t1.position = [1.5, 2.0, -3.25];
  src.setComponent(e1, TransformC, t1);
  src.setComponent(e1, VelocityC, new Velocity());
  src.setComponent(e1, HealthC, new Health(100, 80));
  src.setComponent(e1, TagC, new Tag('Player'));

  const e2 = src.createEntity('Enemy');
  const t2 = new Transform();
  t2.position = [-4.0, 0.5, 7.125];
  src.setComponent(e2, TransformC, t2);
  src.setComponent(e2, HealthC, new Health(50, 25));
  src.setComponent(e2, TagC, new Tag('Enemy'));

  const e3 = src.createEntity('Particle');
  src.setComponent(e3, TransformC, new Transform());
  src.setComponent(e3, LifetimeC, new Lifetime(2.5));

  // Phase 2 验证：构造几个虚拟 mesh entity（带 MeshRef 但引用 placeholder Object3D），
  // 走完整 pack → unpack → count 一致。注意 MeshRef 是非 POJO 不会被序列化；
  // 但 entity + Transform 还在，导入后 transform 数据应当一致。
  const e4 = src.createEntity('Mesh:body');
  const t4 = new Transform();
  t4.position = [0.5, 0, 0];
  t4.scale = [1, 1, 1];
  src.setComponent(e4, TransformC, t4);
  const e5 = src.createEntity('Mesh:head');
  const t5 = new Transform();
  t5.position = [0.5, 1.7, 0];
  t5.scale = [0.5, 0.5, 0.5];
  src.setComponent(e5, TransformC, t5);

  // 再推进几帧
  src.update(0.016);
  src.update(0.016);
  const sourceFrame = src.frame();

  const sourceJson: WorldJson = src.toJSON();
  const sourceEntityCount = sourceJson.entities.length;

  // ── 2. pack → unpack ──────────────────────────────────────
  const scene = {
    version: '0.2.1' as const,
    camera: { preset: 'iso' },
    animation: { speed: 1 },
    environment: { preset: 'studio', exposure: 1.05, background: 'solid', backgroundColor: '#000000' },
    postFX: { bloom: true, bloomIntensity: 0.55, chromaticAberration: true, vignette: true, ssao: false },
    materials: {},
  };
  const { bytes, manifest } = packVreenPackage({
    name: 'roundtrip-test',
    assetName: 'roundtrip-test',
    scene,
    world: sourceJson,
  });
  const unpacked = await unpackVreenPackage(bytes);
  if (!unpacked.manifest.world) {
    return {
      ok: false, sourceEntityCount: src.entityCount(), restoredEntityCount: 0,
      nameMismatches: 0, positionMismatches: 0, healthMismatches: 0, frameMatch: false,
      meshEntityCount: 0,
      error: 'unpacked .vreen missing manifest.world',
    };
  }
  if (unpacked.manifest.version !== '0.2.1') {
    return {
      ok: false, sourceEntityCount: src.entityCount(), restoredEntityCount: 0,
      nameMismatches: 0, positionMismatches: 0, healthMismatches: 0, frameMatch: false,
      meshEntityCount: 0,
      error: `manifest version mismatch: ${unpacked.manifest.version}`,
    };
  }

  // ── 3. 在新 World loadJSON 还原 ─────────────────────────
  const dst = new World({ name: 'RoundtripDst' });
  dst.loadJSON(unpacked.manifest.world, {
    Transform: () => new Transform(),
    Velocity: () => new Velocity(),
    Health: () => new Health(0),
    Tag: () => new Tag(''),
    Lifetime: () => new Lifetime(0),
  });

  // ── 4. 比对 ──────────────────────────────────────────────
  const nameMismatches: string[] = [];
  const positionMismatches: string[] = [];
  const healthMismatches: string[] = [];

  for (const s of sourceJson.entities) {
    // s.id 是 packed EntityId，dst 重建时 version 一致 (都是 0)，
    // 所以可以直接传给 getName / getSceneNode / getComponent。
    const idx = entityIndex(s.id);
    const dn = dst.getName(s.id);
    if (dn !== s.name) {
      nameMismatches.push(`idx ${idx}: "${s.name}" vs "${dn}"`);
    }
    const dp = dst.getSceneNode(s.id);
    if (!dp) {
      positionMismatches.push(`idx ${idx} (${s.name}): dst has no sceneNode`);
      continue;
    }
    const eps = 1e-5;
    if (Math.abs(dp.position.x - s.sceneNode.position[0]) > eps ||
        Math.abs(dp.position.y - s.sceneNode.position[1]) > eps ||
        Math.abs(dp.position.z - s.sceneNode.position[2]) > eps) {
      positionMismatches.push(
        `idx ${idx} (${s.name}): pos (${s.sceneNode.position.join(',')}) ` +
        `vs (${dp.position.x},${dp.position.y},${dp.position.z})`,
      );
    }
    const sh = s.components['Health'] as { hp: number; maxHp: number } | undefined;
    const dh = dst.getComponent(s.id, HealthC) as Health | undefined;
    if (sh && dh) {
      if (sh.hp !== dh.hp || sh.maxHp !== dh.maxHp) {
        healthMismatches.push(`idx ${idx} (${s.name}): hp ${sh.hp}/${sh.maxHp} vs ${dh.hp}/${dh.maxHp}`);
      }
    }
  }

  const frameMatch = dst.frame() === sourceFrame;
  const ok = nameMismatches.length === 0 &&
             positionMismatches.length === 0 &&
             healthMismatches.length === 0 &&
             frameMatch &&
             dst.entityCount() === sourceJson.entities.length;

  // 统计 mesh entity 数量 (Phase 2 验证: 含 "Mesh:" 前缀的)
  const meshEntityCount = sourceJson.entities.filter((e) => e.name.startsWith('Mesh:')).length;

  return {
    ok,
    sourceEntityCount: sourceJson.entities.length,
    restoredEntityCount: dst.entityCount(),
    nameMismatches: nameMismatches.length,
    positionMismatches: positionMismatches.length,
    healthMismatches: healthMismatches.length,
    frameMatch,
    meshEntityCount,
    error: ok ? null : JSON.stringify({ nameMismatches, positionMismatches, healthMismatches, frameMatch }, null, 2),
  };
}

/** 在浏览器 dev console 直接调用，返回简洁的成功/失败信息。 */
export async function runRoundtripDemoAndLog(): Promise<void> {
  try {
    const r = await runRoundtripDemo();
    if (r.ok) {
      log.info(
        `roundtrip OK — ${r.sourceEntityCount} entities, frame match=${r.frameMatch}`,
      );
    } else {
      log.error(
        `roundtrip FAIL — source=${r.sourceEntityCount} restored=${r.restoredEntityCount} ` +
        `nameMismatches=${r.nameMismatches} positionMismatches=${r.positionMismatches} ` +
        `healthMismatches=${r.healthMismatches} frameMatch=${r.frameMatch}\n${r.error}`,
      );
    }
  } catch (e) {
    log.error('roundtrip THREW', e);
  }
}
