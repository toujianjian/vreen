// SaveSystem — 游戏存档系统。
//
// 设计目标：
//   - 多槽位存档管理 (slotId → SaveSlot)；
//   - 与 Scene + World 解耦：save() 接收实例，load() 返回实例；
//   - 持久化委托给 StorageAdapter (默认 LocalStorageAdapter)，槽位序列化为
//     压缩字符串存入 localStorage / IndexedDB；
//   - 自动保存：每 N 秒触发一次，源由 setAutoSaveSource() 提供；
//   - import/export：以 JSON 字符串形式跨实例迁移单个槽位。
//
// 与 Serialization/SceneSerializer 的关系：
//   - SaveSystem 不直接调 SceneSerializer，而是经 SaveSerializer 间接使用，
//     保持单一职责。
//
// 线程模型：单线程 JS 主循环。所有方法同步（auto-save 触发亦同步）。

import { Scene } from '../Core/Scene';
import { World } from '../ECS/World';
import type { ComponentRegistry } from '../ECS/World';
import { createLogger } from '@/lib/logger';
import {
  SaveSerializer,
  type SaveData,
  type SaveDeserializeOptions,
} from './SaveSerializer';
import {
  LocalStorageAdapter,
  type StorageAdapter,
} from './LocalStorageAdapter';

const log = createLogger('SaveSystem');

/** 单个存档槽位。 */
export interface SaveSlot {
  /** 槽位 ID（用户指定或自动生成）。 */
  id: string;
  /** 用户可读的存档名。 */
  name: string;
  /** 创建/更新时间戳 (ms epoch)。 */
  timestamp: number;
  /** 存档数据。 */
  data: SaveData;
  /** 可选缩略图 (base64 dataURL)。 */
  thumbnail?: string;
}

/** SaveSystem 构造选项。 */
export interface SaveSystemOptions {
  /** 最大槽位数。默认 20。 */
  maxSlots?: number;
  /** 持久化适配器。默认新建 LocalStorageAdapter。 */
  storage?: StorageAdapter;
  /** 默认自动保存间隔 (秒)。默认 60。 */
  autoSaveInterval?: number;
  /** World 反序列化所需的组件工厂注册表。 */
  componentRegistry?: ComponentRegistry;
}

/** 自动保存源 —— 返回当前要保存的 scene+world，或 null 表示跳过本次。 */
export type AutoSaveSource = () => {
  scene: Scene;
  world: World;
  name?: string;
  thumbnail?: string;
} | null;

/** 自动保存默认槽位 ID。 */
export const AUTO_SAVE_SLOT_ID = '__auto__';

/**
 * 游戏存档系统 —— 多槽位 + 自动保存 + 持久化。
 */
export class SaveSystem {
  /** 所有槽位 (id → SaveSlot)。 */
  readonly slots: Map<string, SaveSlot> = new Map();
  /** 槽位上限。 */
  maxSlots: number;
  /** 是否启用自动保存。 */
  autoSave: boolean = false;
  /** 自动保存间隔 (秒)。 */
  autoSaveInterval: number;
  /** World 反序列化所需的组件工厂注册表。 */
  componentRegistry?: ComponentRegistry;

  /** 持久化适配器。 */
  private _storage: StorageAdapter;
  /** 自动保存源。 */
  private _autoSaveSource: AutoSaveSource | null = null;
  /** 自动保存累计时间 (秒)。 */
  private _autoSaveAccum: number = 0;

  constructor(opts: SaveSystemOptions = {}) {
    this.maxSlots = opts.maxSlots ?? 20;
    this.autoSaveInterval = opts.autoSaveInterval ?? 60;
    this.componentRegistry = opts.componentRegistry;
    this._storage = opts.storage ?? new LocalStorageAdapter();
  }

  /** 当前持久化适配器（调试用）。 */
  get storage(): StorageAdapter {
    return this._storage;
  }

  /**
   * 保存到指定槽位。
   *
   * - 若 slotId 已存在则覆盖；
   * - 槽位满且 slotId 不存在时抛错；
   * - 同步写入持久化层。
   */
  save(
    slotId: string,
    name: string,
    scene: Scene,
    world: World,
    thumbnail?: string,
  ): SaveSlot {
    if (!slotId) throw new Error('SaveSystem.save: slotId must be non-empty');
    const data = SaveSerializer.serialize(scene, world, {
      savedBy: 'SaveSystem',
      slotName: name,
    });
    const slot: SaveSlot = {
      id: slotId,
      name,
      timestamp: Date.now(),
      data,
      ...(thumbnail !== undefined ? { thumbnail } : {}),
    };
    if (!this.slots.has(slotId) && this.slots.size >= this.maxSlots) {
      throw new Error(
        `SaveSystem.save: slot limit reached (${this.maxSlots}); ` +
          `remove an existing slot or pass an existing slotId to overwrite`,
      );
    }
    this.slots.set(slotId, slot);
    this._persistSlot(slot);
    log.info(
      `save → slot "${slotId}" (${name}), ` +
        `scene objects=${data.scene.objects.length}, ` +
        `world entities=${data.world.entities.length}`,
    );
    return slot;
  }

  /**
   * 从槽位加载 —— 重建 Scene + World 实例。
   *
   * 返回 null 表示槽位不存在。
   */
  load(
    slotId: string,
    opts: SaveDeserializeOptions = {},
  ): { scene: Scene; world: World } | null {
    const slot = this.slots.get(slotId);
    if (!slot) {
      log.warn(`load — slot "${slotId}" not found`);
      return null;
    }
    const registry = opts.componentRegistry ?? this.componentRegistry;
    return SaveSerializer.deserialize(slot.data, { ...opts, componentRegistry: registry });
  }

  /** 删除槽位。返回是否实际删除。 */
  deleteSlot(slotId: string): boolean {
    if (!this.slots.delete(slotId)) return false;
    this._storage.remove(this._storageKey(slotId));
    log.info(`deleteSlot — slot "${slotId}" removed`);
    return true;
  }

  /** 获取槽位信息（不重建实例）。 */
  getSlot(slotId: string): SaveSlot | undefined {
    return this.slots.get(slotId);
  }

  /** 获取所有槽位，按时间倒序（最新在前）。 */
  getSlots(): SaveSlot[] {
    return Array.from(this.slots.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 导出槽位为 JSON 字符串 —— 适合跨实例迁移 / 文件下载。
   *
   * 内部为 { version, slot } 包络，便于 importSlot 校验。
   */
  exportSlot(slotId: string): string {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`SaveSystem.exportSlot: slot "${slotId}" not found`);
    const envelope = {
      version: '1.0.0',
      slot,
    };
    return JSON.stringify(envelope);
  }

  /**
   * 从 JSON 字符串导入槽位。
   *
   * - 若 newSlotId 提供则用之；否则使用 envelope.slot.id；
   * - 若目标 id 已存在则覆盖；
   * - 槽位满且 id 不存在时抛错。
   */
  importSlot(json: string, newSlotId?: string): SaveSlot {
    let envelope: { version?: string; slot?: SaveSlot };
    try {
      envelope = JSON.parse(json);
    } catch (err) {
      throw new Error(`SaveSystem.importSlot: invalid JSON (${(err as Error).message})`);
    }
    if (!envelope || !envelope.slot || !envelope.slot.data) {
      throw new Error('SaveSystem.importSlot: missing envelope.slot.data');
    }
    const id = newSlotId ?? envelope.slot.id;
    if (!id) throw new Error('SaveSystem.importSlot: slot id is empty');
    const slot: SaveSlot = {
      ...envelope.slot,
      id,
    };
    if (!this.slots.has(id) && this.slots.size >= this.maxSlots) {
      throw new Error(
        `SaveSystem.importSlot: slot limit reached (${this.maxSlots})`,
      );
    }
    this.slots.set(id, slot);
    this._persistSlot(slot);
    log.info(`importSlot → slot "${id}" (${slot.name})`);
    return slot;
  }

  /**
   * 启用自动保存。
   *
   * @param interval 间隔 (秒)；<=0 时沿用当前 autoSaveInterval。
   * @param source   可选；不提供时沿用之前 setAutoSaveSource 设置的源。
   */
  enableAutoSave(interval?: number, source?: AutoSaveSource): void {
    if (interval !== undefined && interval > 0) this.autoSaveInterval = interval;
    if (source !== undefined) this._autoSaveSource = source;
    this.autoSave = true;
    this._autoSaveAccum = 0;
    log.info(
      `enableAutoSave — interval=${this.autoSaveInterval}s, ` +
        `source=${this._autoSaveSource ? 'set' : 'missing'}`,
    );
  }

  /** 禁用自动保存。 */
  disableAutoSave(): void {
    this.autoSave = false;
    this._autoSaveAccum = 0;
    log.info('disableAutoSave');
  }

  /** 设置自动保存源。 */
  setAutoSaveSource(source: AutoSaveSource | null): void {
    this._autoSaveSource = source;
  }

  /**
   * 每帧调用 —— 累计 dt，达间隔时触发自动保存到 AUTO_SAVE_SLOT_ID 槽位。
   *
   * @param dt 自上一帧以来的秒数。
   */
  update(dt: number): void {
    if (!this.autoSave) return;
    if (dt <= 0) return;
    this._autoSaveAccum += dt;
    if (this._autoSaveAccum < this.autoSaveInterval) return;
    this._autoSaveAccum = 0;
    if (!this._autoSaveSource) {
      log.warn('update — autoSave enabled but no source set; skipping');
      return;
    }
    const target = this._autoSaveSource();
    if (!target) {
      log.debug('update — autoSave source returned null; skipping this tick');
      return;
    }
    const name = target.name ?? `AutoSave @ ${new Date().toISOString()}`;
    try {
      this.save(
        AUTO_SAVE_SLOT_ID,
        name,
        target.scene,
        target.world,
        target.thumbnail,
      );
      log.debug(`update — auto-saved to slot "${AUTO_SAVE_SLOT_ID}"`);
    } catch (err) {
      log.error(`update — auto-save failed: ${(err as Error).message ?? err}`);
    }
  }

  // ── 持久化辅助 ────────────────────────────────────────────────

  /** 单个槽位在 storage 中的 key。 */
  private _storageKey(slotId: string): string {
    return `slot:${slotId}`;
  }

  /** 把单个槽位序列化（压缩）后写入 storage。 */
  private _persistSlot(slot: SaveSlot): void {
    // 槽位元信息单独留一份明文，便于 enumerateSlots 时不必解压全部。
    const meta = {
      id: slot.id,
      name: slot.name,
      timestamp: slot.timestamp,
      hasThumbnail: !!slot.thumbnail,
    };
    const dataStr = SaveSerializer.compress(slot.data);
    const wrapper = JSON.stringify({
      meta,
      data: dataStr,
      ...(slot.thumbnail ? { thumbnail: slot.thumbnail } : {}),
    });
    this._storage.save(this._storageKey(slot.id), wrapper);
  }
}
