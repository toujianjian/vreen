// SceneManager — 多场景注册 / 加载 / 切换管理器。
//
// 设计目标：
//   - 与渲染循环解耦：SceneManager 只持有 Scene 实例与工厂，不直接调用
//     Renderer；调用方在每帧拿 getActive() 后自行渲染；
//   - register(name, factory) 注册场景工厂；load(name) 调用工厂创建并缓存；
//   - switch(name, transition?) 切换 active 场景，可选 SceneTransition 过渡；
//   - preload(name) 提前创建场景但不切换；
//   - unload(name) 释放场景实例（保留工厂，可再次 load）。
//
// 与 SaveSystem 的关系：
//   - SceneManager 不感知存档；如需"加载游戏存档对应场景"，调用方应：
//     1. saveSystem.load(slotId) 拿到 { scene, world }；
//     2. sceneManager.register(slotId, () => scene)；
//     3. sceneManager.switch(slotId)。
//
// 切换流程（带过渡）：
//   1. switch(name, transition) 调用；
//   2. 若 name 未加载，调工厂创建并缓存；
//   3. 若 transition 是 None 或缺省：直接切换 activeScene，触发 onEnter/onLeave；
//   4. 若 transition 非 None：
//        a. transition.begin()；
//        b. 进入 'transitioning' 状态，activeScene 暂时仍指向旧场景（用于过渡渲染）；
//        c. 每帧 update(dt) 调 transition.update(dt)，根据 phase 推进；
//        d. 当 phase === 'Swapping'：切换 activeScene，触发 onEnter/onLeave；
//        e. 当 phase === 'Complete'：transitioning 结束。
//
// 生命周期钩子（可选）：
//   - onEnter(scene, name) — 场景成为 active 时调用
//   - onLeave(scene, name) — 场景失去 active 时调用
//   - onUnload(scene, name) — 场景被 unload 时调用

import { Scene } from '../Core/Scene';
import { createLogger } from '@/lib/logger';
import {
  SceneTransition,
  instantTransition,
  type SceneTransitionOptions,
} from './SceneTransition';

const log = createLogger('SceneManager');

/** 场景工厂 —— 返回一个 Scene 实例。 */
export type SceneFactory = () => Scene;

/** 场景生命周期钩子。 */
export interface SceneLifecycleHooks {
  /** 场景成为 active 时调用。 */
  onEnter?: (scene: Scene, name: string) => void;
  /** 场景失去 active 时调用。 */
  onLeave?: (scene: Scene, name: string) => void;
  /** 场景被 unload 时调用。 */
  onUnload?: (scene: Scene, name: string) => void;
}

/** 单个场景的运行时记录。 */
interface SceneRecord {
  name: string;
  factory: SceneFactory;
  scene: Scene | null; // null = 已注册但未加载
  hooks?: SceneLifecycleHooks;
}

/** SceneManager 构造选项。 */
export interface SceneManagerOptions {
  /** 全局生命周期钩子（与单场景钩子叠加调用）。 */
  globalHooks?: SceneLifecycleHooks;
}

/**
 * 场景管理器 —— 多场景注册 / 加载 / 切换。
 */
export class SceneManager {
  /** 已注册的场景工厂与实例。 */
  readonly scenes: Map<string, SceneRecord> = new Map();
  /** 当前 active 场景名 (null = 无 active)。 */
  activeScene: string | null = null;

  /** 全局生命周期钩子。 */
  private _globalHooks?: SceneLifecycleHooks;
  /** 当前正在进行的过渡。 */
  private _activeTransition: SceneTransition | null = null;
  /** 过渡的目标场景名（过渡完成后切换到它）。 */
  private _pendingActive: string | null = null;
  /** 标记过渡期间是否已完成 activeScene 切换 (避免重复触发)。 */
  private _swapped: boolean = false;

  constructor(opts: SceneManagerOptions = {}) {
    this._globalHooks = opts.globalHooks;
  }

  /**
   * 注册场景工厂。
   *
   * @param name 场景名（唯一）
   * @param factory 工厂；每次 load/preload 调用以创建新实例
   * @param hooks 可选生命周期钩子
   */
  register(name: string, factory: SceneFactory, hooks?: SceneLifecycleHooks): void {
    if (!name) throw new Error('SceneManager.register: name must be non-empty');
    if (typeof factory !== 'function') {
      throw new Error(`SceneManager.register: factory for "${name}" is not a function`);
    }
    if (this.scenes.has(name)) {
      log.warn(`register — overwriting existing scene "${name}"`);
    }
    this.scenes.set(name, { name, factory, scene: null, hooks });
    log.info(`register — scene "${name}"`);
  }

  /** 取消注册（同时 unload 已加载的实例）。 */
  unregister(name: string): boolean {
    const rec = this.scenes.get(name);
    if (!rec) return false;
    if (rec.scene) this._doUnload(rec);
    if (this.activeScene === name) this.activeScene = null;
    this.scenes.delete(name);
    log.info(`unregister — scene "${name}"`);
    return true;
  }

  /**
   * 加载场景 —— 调用工厂创建实例并缓存。若已加载则 no-op。
   *
   * @returns 加载后的 Scene 实例
   */
  load(name: string): Scene {
    const rec = this.scenes.get(name);
    if (!rec) throw new Error(`SceneManager.load: scene "${name}" not registered`);
    if (!rec.scene) {
      rec.scene = rec.factory();
      log.info(`load — scene "${name}" created`);
    }
    return rec.scene;
  }

  /**
   * 卸载场景 —— 释放实例，保留工厂。再次 load 时会重新调用工厂。
   *
   * 若卸载的是当前 active 场景，activeScene 会被置为 null。
   */
  unload(name: string): boolean {
    const rec = this.scenes.get(name);
    if (!rec || !rec.scene) return false;
    this._doUnload(rec);
    if (this.activeScene === name) this.activeScene = null;
    return true;
  }

  /** 内部 unload 实现 —— 触发 onUnload 钩子并丢弃实例。 */
  private _doUnload(rec: SceneRecord): void {
    if (!rec.scene) return;
    rec.hooks?.onUnload?.(rec.scene, rec.name);
    this._globalHooks?.onUnload?.(rec.scene, rec.name);
    rec.scene = null;
    log.debug(`_doUnload — scene "${rec.name}" unloaded`);
  }

  /**
   * 切换 active 场景。可选过渡效果。
   *
   * - 若 name 未注册：抛错；
   * - 若 name 未加载：自动调 load(name)；
   * - 若 transition 缺省或 None 类型：立即切换，触发 onLeave/onEnter；
   * - 若 transition 非 None：进入过渡状态，由 update(dt) 推进；
   *   过渡期间 activeScene 暂不变（仍为旧场景），仅在 transition.phase === 'Swapping'
   *   时才切换 activeScene。
   */
  switch(name: string, transition?: SceneTransition | SceneTransitionOptions): void {
    const rec = this.scenes.get(name);
    if (!rec) throw new Error(`SceneManager.switch: scene "${name}" not registered`);
    if (!rec.scene) this.load(name);

    // 解析 transition 参数
    let t: SceneTransition;
    if (transition instanceof SceneTransition) {
      t = transition;
    } else if (transition && typeof transition === 'object') {
      t = new SceneTransition(transition);
    } else {
      t = instantTransition();
    }

    // 同名切换 + 无过渡：no-op
    if (this.activeScene === name && t.type === 'None') {
      log.debug(`switch — already active "${name}", no transition, noop`);
      return;
    }

    if (t.type === 'None' || t.duration <= 0) {
      // 立即切换
      this._commitSwitch(name);
      return;
    }

    // 启动过渡
    this._activeTransition = t;
    this._pendingActive = name;
    this._swapped = false;
    t.begin();
    log.info(
      `switch — begin transition type=${t.type} duration=${t.duration}s ` +
        `from="${this.activeScene}" to="${name}"`,
    );
    // 若 transition.begin() 立即 Complete (duration<=0 之类)，直接提交。
    if (t.isComplete()) {
      this._commitSwitch(name);
      this._activeTransition = null;
      this._pendingActive = null;
      this._swapped = false;
    }
  }

  /** 内部 —— 真正切换 activeScene，触发 onLeave/onEnter。 */
  private _commitSwitch(name: string): void {
    const old = this.activeScene;
    if (old === name) {
      log.debug(`_commitSwitch — "${name}" already active, skip hooks`);
      return;
    }
    if (old !== null) {
      const oldRec = this.scenes.get(old);
      if (oldRec?.scene) {
        oldRec.hooks?.onLeave?.(oldRec.scene, old);
        this._globalHooks?.onLeave?.(oldRec.scene, old);
      }
    }
    this.activeScene = name;
    const newRec = this.scenes.get(name);
    if (newRec?.scene) {
      newRec.hooks?.onEnter?.(newRec.scene, name);
      this._globalHooks?.onEnter?.(newRec.scene, name);
    }
    log.info(`_commitSwitch — activeScene: "${old}" → "${name}"`);
  }

  /** 获取当前 active 场景实例 (null = 无 active)。 */
  getActive(): Scene | null {
    if (this.activeScene === null) return null;
    return this.scenes.get(this.activeScene)?.scene ?? null;
  }

  /** 获取指定场景实例 (null = 未加载)。 */
  getScene(name: string): Scene | null {
    return this.scenes.get(name)?.scene ?? null;
  }

  /**
   * 预加载场景 —— 调工厂创建实例但不切换 active。
   *
   * 适用于在过渡开始前先把目标场景的几何体/纹理准备好。
   */
  preload(name: string): Scene {
    return this.load(name);
  }

  /** 已加载（实例非 null）的场景名列表。 */
  getLoadedScenes(): string[] {
    const out: string[] = [];
    for (const [name, rec] of this.scenes) {
      if (rec.scene) out.push(name);
    }
    return out;
  }

  /** 已注册的所有场景名列表。 */
  getRegisteredScenes(): string[] {
    return Array.from(this.scenes.keys());
  }

  /** 当前是否处于过渡中。 */
  isTransitioning(): boolean {
    return this._activeTransition !== null && !this._activeTransition.isComplete();
  }

  /** 当前过渡实例（调试用）。 */
  getActiveTransition(): SceneTransition | null {
    return this._activeTransition;
  }

  /**
   * 每帧调用 —— 推进当前过渡。
   *
   * 调用方应在主循环里：sceneManager.update(dt); 然后用 getActive() 渲染。
   *
   * 切换点判定：
   *   - Fade / Slide / Wipe: 进入 Swapping 阶段时切换 (中点)；若 dt 较大跳过
   *     Swapping 直接进入 FadingIn / Complete，则在那一帧补切换。
   *   - Crossfade: 单阶段，Complete 时切换 (无 Swapping 中间点)。
   *
   * @param dt 秒
   */
  update(dt: number): void {
    if (!this._activeTransition) return;
    const t = this._activeTransition;
    t.update(dt);

    // 检测是否到了切换点
    if (!this._swapped && this._pendingActive !== null) {
      const shouldSwap =
        t.type === 'Crossfade'
          ? t.isComplete()
          : t.phase === 'Swapping' ||
            t.phase === 'FadingIn' ||
            t.phase === 'Complete';
      if (shouldSwap) {
        this._commitSwitch(this._pendingActive);
        this._swapped = true;
      }
    }

    if (t.isComplete()) {
      log.info(
        `update — transition complete, activeScene="${this.activeScene}"`,
      );
      this._activeTransition = null;
      this._pendingActive = null;
      this._swapped = false;
    }
  }
}
