// ModuleRegistry — Gem 风格引擎模块注册系统。
//
// 设计参考: o3de 的 Gem 系统 (o3de/Gems/*/gem.json)。
//   - 每个 Gem 声明 name / version / display_name / summary / dependencies,
//     通过 gem.json 描述元数据;引擎启动时按依赖图激活 Gem。
//   - VREEN 借鉴该模型但用 TS 接口 + 回调替代 C++ 模块:
//     EngineModule 持有 onLoad / onUnload 生命周期回调,isActive 标记运行态。
//
// 与 Assets/AssetRegistry 的差异:
//   - AssetRegistry 管"资源实例"生命周期 (引用计数 + dispose 回调);
//   - ModuleRegistry 管"引擎模块"生命周期 (依赖图 + load/unload 回调)。
//   两者正交,可组合使用。
//
// 不变量:
//   - loadModule 前必须 registerModule;依赖未注册则 loadModule 失败。
//   - loadModule 递归加载未加载的依赖;若依赖加载失败则本模块也失败。
//   - unloadModule 拒绝卸载仍被其他已加载模块依赖的模块 (返回 false)。
//   - onLoad 抛错则模块不进入 loadedModules (回滚 isActive)。

import { createLogger } from '@/lib/logger';

const log = createLogger('ModuleRegistry');

/**
 * 引擎模块定义 (参考 o3de Gem)。
 * - name/version/description/dependencies 对应 gem.json 的同名字段。
 * - onLoad/onUnload 是引擎层回调 (相当于 Gem 的 Activate/Deactivate)。
 * - isActive 由 loadModule/unloadModule 维护,初值由调用方决定。
 */
export interface EngineModule {
  /** 模块名 (唯一 key,如 "Renderer" / "Physics" / "Audio")。 */
  name: string;
  /** 语义化版本 (如 "1.0.0")。 */
  version: string;
  /** 简短描述 (对应 gem.json summary)。 */
  description: string;
  /** 依赖模块名列表 (对应 gem.json dependencies)。 */
  dependencies: string[];
  /** 模块加载时调用 (对应 Gem Activate)。 */
  onLoad: () => void;
  /** 模块卸载时调用 (对应 Gem Deactivate)。 */
  onUnload: () => void;
  /** 是否当前激活 (由 registry 维护)。 */
  isActive: boolean;
}

/** 模块清单条目 (可序列化,对应 gem.json 的子集)。 */
export interface ModuleManifestEntry {
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  /** 是否处于加载(激活)态。 */
  active: boolean;
}

/** 模块清单 (类似 o3de project.json 中 active Gems 列表)。 */
export interface ModuleManifest {
  modules: ModuleManifestEntry[];
}

/** importManifest 的执行报告。 */
export interface ManifestImportReport {
  /** 成功加载的模块名。 */
  loaded: string[];
  /** 加载失败的模块名 (未注册或依赖失败)。 */
  failed: string[];
  /** 清单中标记为 inactive 而跳过的模块名。 */
  skipped: string[];
}

/**
 * 模块注册表 (Gem 风格)。
 *
 * 典型用法:
 * ```ts
 * const reg = new ModuleRegistry();
 * reg.registerModule({
 *   name: 'Physics', version: '1.0.0', description: 'Physics sim',
 *   dependencies: [], onLoad: () => { /* init *\/ }, onUnload: () => {}, isActive: false,
 * });
 * reg.loadModule('Physics'); // → true, Physics.isActive === true
 * ```
 */
export class ModuleRegistry {
  /** 已注册模块 (name → EngineModule)。 */
  modules: Map<string, EngineModule> = new Map();
  /** 已加载(激活)模块名集合。 */
  loadedModules: Set<string> = new Set();
  /** 模块依赖图 (name → 依赖名列表)。与 modules 的 dependencies 同步。 */
  moduleDependencies: Map<string, string[]> = new Map();

  /** 注册模块。同名覆盖;返回是否覆盖了既有注册。 */
  registerModule(module: EngineModule): boolean {
    const existed = this.modules.has(module.name);
    if (existed) {
      // 若已加载,先卸载以触发旧实例的 onUnload,避免回调悬挂。
      if (this.loadedModules.has(module.name)) {
        log.warn(`registerModule("${module.name}") — overriding a loaded module; unloading old instance first`);
        this.unloadModule(module.name);
      }
      log.warn(`registerModule("${module.name}") — overriding existing registration`);
    }
    this.modules.set(module.name, module);
    this.moduleDependencies.set(module.name, [...module.dependencies]);
    return existed;
  }

  /** 注销模块。若已加载先卸载。返回是否成功移除。 */
  unregisterModule(name: string): boolean {
    if (!this.modules.has(name)) return false;
    if (this.loadedModules.has(name)) {
      this.unloadModule(name);
    }
    this.modules.delete(name);
    this.moduleDependencies.delete(name);
    return true;
  }

  /**
   * 加载(激活)模块。
   * - 未注册 → false。
   * - 已加载 → no-op 返回 true。
   * - 依赖未注册 → false (checkDependencies 失败)。
   * - 递归加载未加载的依赖;依赖失败则本模块失败。
   * - onLoad 抛错 → 视为加载失败,不进入 loadedModules。
   */
  loadModule(name: string): boolean {
    const mod = this.modules.get(name);
    if (!mod) {
      log.error(`loadModule("${name}") — not registered`);
      return false;
    }
    if (this.loadedModules.has(name)) {
      // 已加载视为成功 (幂等)。
      return true;
    }
    if (!this.checkDependencies(name)) {
      log.error(`loadModule("${name}") — dependencies not satisfied`);
      return false;
    }
    // 递归加载依赖 (未加载的)。
    for (const dep of mod.dependencies) {
      if (!this.loadedModules.has(dep)) {
        if (!this.loadModule(dep)) {
          log.error(`loadModule("${name}") — failed to load dependency "${dep}"`);
          return false;
        }
      }
    }
    try {
      mod.onLoad();
    } catch (e) {
      log.error(`loadModule("${name}") — onLoad threw:`, e);
      mod.isActive = false;
      return false;
    }
    mod.isActive = true;
    this.loadedModules.add(name);
    log.info(`loadModule("${name}") v${mod.version} — activated`);
    return true;
  }

  /**
   * 卸载(停用)模块。
   * - 未加载 → 返回 false。
   * - 仍被其他已加载模块依赖 → 拒绝卸载,返回 false。
   * - onUnload 抛错仍继续卸载 (记录错误),返回 true。
   */
  unloadModule(name: string): boolean {
    if (!this.loadedModules.has(name)) {
      return false;
    }
    // 检查反向依赖:若有其他已加载模块依赖本模块,拒绝卸载。
    for (const [loadedName, deps] of this.moduleDependencies) {
      if (loadedName === name) continue;
      if (this.loadedModules.has(loadedName) && deps.includes(name)) {
        log.error(`unloadModule("${name}") — still depended on by "${loadedName}"`);
        return false;
      }
    }
    const mod = this.modules.get(name);
    try {
      mod?.onUnload();
    } catch (e) {
      log.error(`unloadModule("${name}") — onUnload threw:`, e);
    }
    if (mod) mod.isActive = false;
    this.loadedModules.delete(name);
    log.info(`unloadModule("${name}") — deactivated`);
    return true;
  }

  /** 获取模块定义。 */
  getModule(name: string): EngineModule | undefined {
    return this.modules.get(name);
  }

  /** 已加载模块名列表 (快照)。 */
  getLoadedModules(): string[] {
    return Array.from(this.loadedModules);
  }

  /** 所有已注册模块名列表 (快照)。 */
  getAvailableModules(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * 检查模块依赖是否全部已注册。
   * 注意:仅检查"依赖是否注册",不检查"依赖是否已加载"
   * (后者由 loadModule 递归处理)。
   */
  checkDependencies(name: string): boolean {
    const mod = this.modules.get(name);
    if (!mod) return false;
    for (const dep of mod.dependencies) {
      if (!this.modules.has(dep)) {
        log.error(`checkDependencies("${name}") — missing dependency "${dep}"`);
        return false;
      }
    }
    return true;
  }

  /** 获取模块清单信息 (可序列化快照)。未注册返回 undefined。 */
  getModuleInfo(name: string): ModuleManifestEntry | undefined {
    const mod = this.modules.get(name);
    if (!mod) return undefined;
    return {
      name: mod.name,
      version: mod.version,
      description: mod.description,
      dependencies: [...mod.dependencies],
      active: this.loadedModules.has(name),
    };
  }

  /** 列出所有模块清单信息 (可序列化快照)。 */
  listModules(): ModuleManifestEntry[] {
    return this.getAvailableModules().map((n) => this.getModuleInfo(n)!);
  }

  /** 导出模块清单 (JSON 可序列化)。 */
  exportManifest(): ModuleManifest {
    return { modules: this.listModules() };
  }

  /**
   * 导入模块清单:按清单中 active=true 的条目依次 loadModule。
   * - 清单条目对应的模块必须事先 registerModule (本方法不创建模块实例,
   *   因为 EngineModule 需要 onLoad/onUnload 回调,无法从 JSON 重建)。
   * - 未注册的 active 条目计入 failed。
   * - active=false 的条目计入 skipped。
   * 返回执行报告。
   */
  importManifest(data: ModuleManifest): ManifestImportReport {
    const loaded: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];
    for (const entry of data.modules ?? []) {
      if (!entry.active) {
        skipped.push(entry.name);
        continue;
      }
      if (!this.modules.has(entry.name)) {
        log.warn(`importManifest — module "${entry.name}" not registered, skipping`);
        failed.push(entry.name);
        continue;
      }
      if (this.loadModule(entry.name)) {
        loaded.push(entry.name);
      } else {
        failed.push(entry.name);
      }
    }
    log.info(`importManifest — loaded ${loaded.length}, failed ${failed.length}, skipped ${skipped.length}`);
    return { loaded, failed, skipped };
  }

  /** 清空所有注册与加载状态 (不触发 onUnload,调用方应先手动卸载)。 */
  clear(): void {
    const n = this.modules.size;
    this.modules.clear();
    this.loadedModules.clear();
    this.moduleDependencies.clear();
    if (n > 0) log.info(`clear() — dropped ${n} entries`);
  }
}

/** 全局默认注册表 (与 getDefaultAssetRegistry 单例风格一致)。 */
let _default: ModuleRegistry | null = null;
export function getDefaultModuleRegistry(): ModuleRegistry {
  if (!_default) _default = new ModuleRegistry();
  return _default;
}

/** 测试 / 重置全局单例 (会先 clear 旧实例)。 */
export function resetDefaultModuleRegistry(): void {
  _default?.clear();
  _default = null;
}
