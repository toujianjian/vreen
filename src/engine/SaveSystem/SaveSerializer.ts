// SaveSerializer — 存档序列化器。
//
// 设计目标：
//   - 把 Scene + World + metadata 三元组打包为 SaveData (POJO)；
//   - SaveData 可经 compress() 压缩为 base64 字符串 (zlib + base64)，
//     便于在 localStorage / IndexedDB 中以单字符串存储；
//   - decompress() 还原 SaveData；deserialize() 进一步重建 Scene + World
//     实例 (Scene 由 SceneSerializer 还原；World 由调用方提供 ComponentRegistry)。
//
// 与 Serialization/SceneSerializer 的关系：
//   - SceneSerializer 负责 Scene ↔ SceneJSON；
//   - SaveSerializer 在其上加了一层 WorldJSON + metadata + 压缩封装。
//
// 压缩算法：fflate zlibSync (RFC 1950) + base64 编码。
// 解压对称：base64 解码 → unzlibSync → strFromU8 → JSON.parse。

import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';
import { Scene } from '../Core/Scene';
import { SceneSerializer } from '../Serialization/SceneSerializer';
import type { SceneJSON } from '../Serialization/types';
import { World } from '../ECS/World';
import type { WorldJson, ComponentRegistry } from '../ECS/World';
import { createLogger } from '@/lib/logger';

const log = createLogger('SaveSerializer');

export const SAVE_SERIALIZER_VERSION = '1.0.0';

/** 一份存档的核心数据：场景 JSON + 世界 JSON + 元数据。 */
export interface SaveData {
  scene: SceneJSON;
  world: WorldJson;
  metadata: Record<string, unknown>;
}

/** 反序列化选项。 */
export interface SaveDeserializeOptions {
  /** World.loadJSON 需要的组件工厂注册表；不提供时 World 仍重建但无组件数据。 */
  componentRegistry?: ComponentRegistry;
  /** Scene 反序列化上下文（材质/几何体 URL 加载器）。 */
  sceneContext?: Parameters<typeof SceneSerializer.deserialize>[1];
}

/**
 * 存档序列化器 —— Scene + World + metadata ↔ SaveData，并提供压缩封装。
 *
 * 静态方法形式，与 SceneSerializer.default 风格一致；无状态、可并发使用。
 */
export class SaveSerializer {
  /** 序列化：Scene + World + metadata → SaveData (POJO)。 */
  static serialize(
    scene: Scene,
    world: World,
    metadata: Record<string, unknown> = {},
  ): SaveData {
    const sceneJSON = SceneSerializer.serialize(scene);
    const worldJSON = world.toJSON();
    const data: SaveData = {
      scene: sceneJSON,
      world: worldJSON,
      metadata: { ...metadata },
    };
    log.info(
      `serialize — scene objects=${sceneJSON.objects.length}, ` +
        `world entities=${worldJSON.entities.length}, ` +
        `metadata keys=${Object.keys(metadata).length}`,
    );
    return data;
  }

  /**
   * 反序列化：SaveData → { scene, world } 实例。
   *
   * 注意：World 组件重建需要 componentRegistry；未提供时 World 仅有 entity + sceneNode，
   * 各 POJO 组件会被跳过 (调用方需稍后 world.loadJSON(json, registry) 重新加载)。
   */
  static deserialize(
    json: SaveData,
    opts: SaveDeserializeOptions = {},
  ): { scene: Scene; world: World } {
    const scene = SceneSerializer.deserialize(json.scene, opts.sceneContext);
    const world = new World({ name: json.world.name ?? 'SavedWorld' });
    if (opts.componentRegistry) {
      world.loadJSON(json.world, opts.componentRegistry);
    } else {
      // 无 registry：仅重建 entity + sceneNode TRS，组件数据丢弃并 warn。
      log.warn(
        'deserialize — no componentRegistry provided; components will be skipped. ' +
          'Pass { componentRegistry } to fully rehydrate World.',
      );
      world.loadJSON(json.world, {});
    }
    log.info(
      `deserialize — scene objects=${scene.children.length}, ` +
        `world entities=${world.entityCount()}`,
    );
    return { scene, world };
  }

  /**
   * 压缩 SaveData → base64 字符串。
   *
   * 流程：JSON.stringify → UTF-8 bytes → zlib → base64。
   * 用于在 localStorage / IndexedDB 中以单字符串存储完整存档。
   */
  static compress(data: SaveData): string {
    const jsonStr = JSON.stringify(data);
    const u8 = strToU8(jsonStr);
    const zipped = zlibSync(u8);
    return base64FromBytes(zipped);
  }

  /**
   * 解压：base64 字符串 → SaveData。
   *
   * 流程：base64 → bytes → unzlib → UTF-8 string → JSON.parse。
   * 输入非合法 base64 / 非 zlib 数据时抛错。
   */
  static decompress(s: string): SaveData {
    const bytes = bytesFromBase64(s);
    const unzipped = unzlibSync(bytes);
    const jsonStr = strFromU8(unzipped);
    const data = JSON.parse(jsonStr) as SaveData;
    if (!data.scene || !data.world) {
      throw new Error(
        'SaveSerializer.decompress: invalid SaveData (missing scene or world)',
      );
    }
    return data;
  }
}

// ── base64 辅助 ──────────────────────────────────────────────────
// 之所以手写而非用 btoa/atob：
//   - btoa/atob 仅在浏览器/Deno 全局可用，Node 16+ 才有 Buffer；
//   - 测试环境为 node (vitest environment: 'node')，直接用 Buffer 最稳；
//   - 同时兼容浏览器：Buffer 在浏览器侧由 vite polyfill 自动注入。

function base64FromBytes(bytes: Uint8Array): string {
  // 优先 Buffer (Node/测试)，回退 btoa (浏览器)。
  const g = globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } };
  if (g.Buffer) {
    return g.Buffer.from(bytes).toString('base64');
  }
  // 浏览器路径
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function bytesFromBase64(s: string): Uint8Array {
  const g = globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (g.Buffer) {
    return g.Buffer.from(s, 'base64');
  }
  // 浏览器路径
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
