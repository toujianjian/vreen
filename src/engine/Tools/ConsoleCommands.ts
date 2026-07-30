// ConsoleCommands — 编辑器控制台命令系统。
//
// 设计参考: Unreal Engine Console (cvar / cmd) + Unity Console + Source 引擎控制台。
//   - 编辑器 / 运行时控制台通过文本命令与引擎交互 (场景/实体/物理/渲染/音频/调试)。
//   - 每个命令含 name / description / usage / args / handler / category,
//     支持参数类型校验 (string / number / boolean / vector3)。
//   - 支持别名 (alias)、历史 (history)、自动补全 (autoComplete)、帮助 (help)。
//   - 调用方可手动 registerCommand,也可调用 registerAllDefaultCommands()
//     一次性注册全套预置命令 (引擎/场景/物理/渲染/音频/调试)。
//
// 与 Scripting/ScriptBindings 的差异:
//   - ScriptBindings 管"脚本 API 表面" (函数/属性/类/枚举,供 Blockly / ScriptInstance 调用);
//   - ConsoleCommands 管"控制台命令" (文本输入 → 解析 → 执行,面向开发者 REPL 交互)。
//   - 两者正交: ScriptBindings 关注程序化能力暴露, ConsoleCommands 关注开发者交互。
//
// 与 Editor/EditorCommands 的差异:
//   - EditorCommands 管"撤销/重做命令工厂" (Move/Rotate/Scale/Add/Remove/Property,
//     配合 UndoRedoSystem,操作粒度为单次原子变换);
//   - ConsoleCommands 管"REPL 文本命令" (字符串解析 + 任意副作用,不进 undo 栈)。
//   - 两者正交,ConsoleCommands 的 handler 内部可调用 EditorCommands。
//
// 不变量:
//   - registerCommand 同名覆盖; 返回是否覆盖了既有命令。
//   - getCommand / execute / getHelp 对未知名返回 undefined / 错误字符串 / 空数组 (不抛错)。
//   - execute 解析失败 (参数缺失 / 类型不匹配) 返回错误字符串,不调用 handler。
//   - handler 抛错被捕获,返回 "Error: <msg>" 字符串 (不向上抛)。
//   - addToHistory 仅记录非空命令; 超过 maxHistory 时裁剪最旧。
//   - registerAllDefaultCommands 幂等 (重复调用不会重复注册同名命令)。

import { createLogger } from '@/lib/logger';
import type { World, EntityId, EntitySummary } from '../ECS/World';
import type { Scene } from '../Core/Scene';
import { SceneSerializer, type SceneJSON } from '../Serialization';
import { FrameProfiler } from './FrameProfiler';
import { SystemProfiler } from './SystemProfiler';
import { MemoryTracker } from './MemoryTracker';

const log = createLogger('ConsoleCommands');

/** 命令参数类型。决定 parseArgs 时的解析方式。 */
export type ConsoleArgType = 'string' | 'number' | 'boolean' | 'vector3';

/** 单个命令参数声明。 */
export interface ConsoleArg {
  /** 参数名 (用于 usage / help 展示)。 */
  name: string;
  /** 参数类型。 */
  type: ConsoleArgType;
  /** 是否必需 (true 表示缺少则报错; false 表示可选,排在末尾)。 */
  required: boolean;
  /** 人类可读描述。 */
  description?: string;
}

/** 命令分类 (用于 getCommandsByCategory 与帮助分组)。 */
export type ConsoleCommandCategory =
  | 'General'
  | 'Engine'
  | 'Scene'
  | 'Entity'
  | 'Physics'
  | 'Rendering'
  | 'Audio'
  | 'Debug';

/** 单个控制台命令定义。 */
export interface ConsoleCommand {
  /** 命令名 (如 "scene.load" / "entity.create")。 */
  name: string;
  /** 简短描述。 */
  description: string;
  /** 用法示例 (如 "scene.load <path>")。 */
  usage: string;
  /** 参数声明。 */
  args: ConsoleArg[];
  /** 执行 handler: 接收已解析的参数值数组,返回输出字符串 (或 throw)。 */
  handler: (args: string[]) => string;
  /** 分类。 */
  category: ConsoleCommandCategory;
}

/** 自动补全建议条目。 */
export interface AutoCompleteSuggestion {
  /** 命令名 (或别名)。 */
  name: string;
  /** 描述。 */
  description: string;
  /** 是否为别名。 */
  isAlias: boolean;
}

/** 帮助条目 (单命令或全部命令分组)。 */
export interface HelpEntry {
  name: string;
  description: string;
  usage: string;
  category: ConsoleCommandCategory;
  args: ConsoleArg[];
}

/** 分组帮助 (按 category 分组)。 */
export interface GroupedHelp {
  category: ConsoleCommandCategory;
  entries: HelpEntry[];
}

/** ConsoleCommands 统计信息。 */
export interface ConsoleCommandsStats {
  /** 总命令数。 */
  total: number;
  /** 别名数。 */
  aliasCount: number;
  /** 历史记录数。 */
  historyCount: number;
  /** 按分类分组的命令数。 */
  byCategory: Record<string, number>;
  /** 是否已注册预置命令。 */
  isInitialized: boolean;
}

/** execute 结果。 */
export interface ExecuteResult {
  /** 输出文本 (成功为结果,失败为错误信息)。 */
  output: string;
  /** 是否执行成功 (handler 调用且未抛错)。 */
  success: boolean;
}

/** 解析后的参数值 (按 ConsoleArgType 转换)。 */
export type ParsedArgValue = string | number | boolean | [number, number, number];

/**
 * 编辑器控制台命令系统。
 *
 * 典型用法:
 * ```ts
 * const cc = new ConsoleCommands();
 * cc.registerAllDefaultCommands(world);
 * const result = cc.execute('scene.list');
 * console.log(result.output);
 * ```
 */
export class ConsoleCommands {
  /** name → 命令定义。 */
  commands: Map<string, ConsoleCommand> = new Map();
  /** 命令历史 (按输入顺序,最旧在前)。 */
  history: string[] = [];
  /** 历史最大长度 (超过则裁剪最旧)。 */
  maxHistory: number = 100;
  /** 是否启用自动补全 (getAutoComplete 总会返回,此标志仅供 UI 层查询)。 */
  autoComplete: boolean = true;
  /** 别名 → 命令名 (别名解析在 execute / getAutoComplete 内部完成)。 */
  aliases: Map<string, string> = new Map();
  /** 是否已注册预置命令 (registerAllDefaultCommands 调用过)。 */
  isInitialized: boolean = false;

  /** 关联的 World (registerAllDefaultCommands(world) 时设置,供 entity/physics 命令使用)。 */
  private _world: World | null = null;
  /** 关联的 Scene (供 scene.load/save 命令使用)。 */
  private _scene: Scene | null = null;

  // ── 注册 / 注销 ────────────────────────────────────────────────

  /**
   * 注册命令。同名覆盖; 返回是否覆盖了既有命令。
   */
  registerCommand(command: ConsoleCommand): boolean {
    const existed = this.commands.has(command.name);
    this.commands.set(command.name, command);
    if (existed) {
      log.debug(`registerCommand("${command.name}") — overrode existing`);
    } else {
      log.debug(`registerCommand("${command.name}", cat="${command.category}")`);
    }
    return existed;
  }

  /**
   * 注销命令。同时移除指向它的别名。返回是否成功移除。
   */
  unregisterCommand(name: string): boolean {
    const removed = this.commands.delete(name);
    if (removed) {
      // 清理指向该命令的别名
      for (const [alias, target] of this.aliases) {
        if (target === name) this.aliases.delete(alias);
      }
      log.debug(`unregisterCommand("${name}")`);
    }
    return removed;
  }

  /** 获取命令定义。未知名返回 undefined (不解析别名)。 */
  getCommand(name: string): ConsoleCommand | undefined {
    return this.commands.get(name);
  }

  /** 获取所有命令 (快照数组,按 name 排序)。 */
  getCommands(): ConsoleCommand[] {
    return Array.from(this.commands.values()).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  /** 按分类获取命令。 */
  getCommandsByCategory(category: ConsoleCommandCategory): ConsoleCommand[] {
    const out: ConsoleCommand[] = [];
    for (const cmd of this.commands.values()) {
      if (cmd.category === category) out.push(cmd);
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** 获取所有分类名 (排序后的快照)。 */
  getCategories(): ConsoleCommandCategory[] {
    const set = new Set<ConsoleCommandCategory>();
    for (const cmd of this.commands.values()) set.add(cmd.category);
    return Array.from(set).sort();
  }

  // ── 别名 ────────────────────────────────────────────────────────

  /**
   * 注册别名。别名指向已注册的命令名; 解析时别名会映射到目标命令。
   * 若目标命令未注册,仍记录别名 (lazy 解析,允许先注册别名再注册命令)。
   * 同名别名覆盖; 返回是否覆盖。
   */
  registerAlias(alias: string, command: string): boolean {
    const existed = this.aliases.has(alias);
    this.aliases.set(alias, command);
    log.debug(`registerAlias("${alias}" → "${command}")${existed ? ' — overrode' : ''}`);
    return existed;
  }

  /** 获取别名指向的命令名。未注册返回 undefined。 */
  getAlias(alias: string): string | undefined {
    return this.aliases.get(alias);
  }

  /**
   * 解析名字: 若为别名则返回目标命令名,否则原样返回。
   * 用于 execute / getAutoComplete / getHelp 内部统一处理别名。
   */
  private _resolveName(name: string): string {
    return this.aliases.get(name) ?? name;
  }

  // ── 执行 ────────────────────────────────────────────────────────

  /**
   * 执行命令。解析参数 + 调用 handler。
   * - 空输入 → { output: '', success: false }
   * - 未知名 / 别名未指向命令 → 错误字符串
   * - 参数解析失败 → 错误字符串 (不调用 handler)
   * - handler 抛错 → "Error: <msg>" 字符串
   * - 成功 → handler 返回值
   */
  execute(input: string): ExecuteResult {
    const trimmed = input.trim();
    if (!trimmed) {
      return { output: '', success: false };
    }
    // 记录历史 (即使执行失败也记录,便于回溯输入)
    this.addToHistory(trimmed);

    const { name, rawArgs } = this._splitNameAndArgs(trimmed);
    const resolvedName = this._resolveName(name);
    const cmd = this.commands.get(resolvedName);
    if (!cmd) {
      const msg = `Unknown command: "${name}"${resolvedName !== name ? ` (alias → "${resolvedName}")` : ''}`;
      log.warn(`execute — ${msg}`);
      return { output: msg, success: false };
    }

    // 参数校验
    const validateErr = this._validateArgs(cmd, rawArgs);
    if (validateErr) {
      return { output: validateErr, success: false };
    }

    try {
      const output = cmd.handler(rawArgs);
      return { output: output ?? '', success: true };
    } catch (err) {
      const msg = `Error: ${(err as Error).message ?? err}`;
      log.error(`execute("${input}") threw: ${(err as Error).message ?? err}`);
      return { output: msg, success: false };
    }
  }

  /**
   * 解析参数。把原始字符串数组按命令的 args 声明转换类型。
   * 返回 { values, error }。error 非空表示解析失败。
   *
   * 注意: 当前 handler 接收的是原始 string[] (与 ConsoleCommand.handler 签名一致),
   * 此方法主要供调用方 (如 UI 类型化校验) 使用。
   */
  parseArgs(input: string): { values: ParsedArgValue[]; error?: string } {
    const trimmed = input.trim();
    if (!trimmed) return { values: [], error: 'Empty input' };
    const { name, rawArgs } = this._splitNameAndArgs(trimmed);
    const resolvedName = this._resolveName(name);
    const cmd = this.commands.get(resolvedName);
    if (!cmd) return { values: [], error: `Unknown command: "${name}"` };

    const values: ParsedArgValue[] = [];
    for (let i = 0; i < cmd.args.length; i++) {
      const decl = cmd.args[i];
      const raw = rawArgs[i];
      if (raw === undefined) {
        if (decl.required) {
          return { values: [], error: `Missing required argument: ${decl.name}` };
        }
        break;
      }
      const parsed = this._convertArg(raw, decl.type);
      if (parsed.error) {
        return { values: [], error: `Argument "${decl.name}": ${parsed.error}` };
      }
      values.push(parsed.value!);
    }
    return { values };
  }

  // ── 历史 ────────────────────────────────────────────────────────

  /** 添加命令到历史。空字符串忽略; 超过 maxHistory 裁剪最旧。 */
  addToHistory(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;
    this.history.push(trimmed);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
  }

  /** 获取历史快照 (最旧在前)。 */
  getHistory(): string[] {
    return [...this.history];
  }

  /** 清空历史。 */
  clearHistory(): void {
    const n = this.history.length;
    this.history.length = 0;
    if (n > 0) log.debug(`clearHistory — dropped ${n} entries`);
  }

  // ── 自动补全 ────────────────────────────────────────────────────

  /**
   * 获取自动补全建议。返回所有以 input 开头的命令名 + 别名。
   * - 空输入 → 返回全部命令 (供 UI 展示全部)
   * - 输入为完整命令名 → 仍包含 (前缀匹配包含自身)
   * - 无匹配 → 空数组
   */
  getAutoComplete(input: string): AutoCompleteSuggestion[] {
    const q = input.trim().toLowerCase();
    const out: AutoCompleteSuggestion[] = [];
    for (const cmd of this.commands.values()) {
      if (!q || cmd.name.toLowerCase().startsWith(q)) {
        out.push({ name: cmd.name, description: cmd.description, isAlias: false });
      }
    }
    for (const [alias, target] of this.aliases) {
      if (!q || alias.toLowerCase().startsWith(q)) {
        const targetCmd = this.commands.get(target);
        out.push({
          name: alias,
          description: targetCmd?.description ?? `(→ ${target})`,
          isAlias: true,
        });
      }
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // ── 帮助 ────────────────────────────────────────────────────────

  /**
   * 获取帮助。
   * - name 未提供 → 返回所有命令的分组帮助
   * - name 提供 → 返回单命令帮助 (未知名返回空数组)
   */
  getHelp(name?: string): HelpEntry[] | GroupedHelp[] {
    if (name !== undefined) {
      const resolved = this._resolveName(name);
      const cmd = this.commands.get(resolved);
      if (!cmd) return [];
      return [this._toHelpEntry(cmd)];
    }
    // 全部: 按分类分组
    const categories = this.getCategories();
    const grouped: GroupedHelp[] = [];
    for (const cat of categories) {
      const entries = this.getCommandsByCategory(cat).map((c) => this._toHelpEntry(c));
      grouped.push({ category: cat, entries });
    }
    return grouped;
  }

  /** 转换为 HelpEntry。 */
  private _toHelpEntry(cmd: ConsoleCommand): HelpEntry {
    return {
      name: cmd.name,
      description: cmd.description,
      usage: cmd.usage,
      category: cmd.category,
      args: cmd.args,
    };
  }

  // ── 预置命令注册 ────────────────────────────────────────────────

  /**
   * 一次性注册全套预置命令 (引擎/场景/实体/物理/渲染/音频/调试)。
   * 幂等: 已初始化则直接返回。
   * @param world 关联的 ECS World (entity/physics 命令需要)
   * @param scene 关联的 Scene (scene.load/save 命令需要)
   */
  registerAllDefaultCommands(world?: World, scene?: Scene | null): void {
    if (this.isInitialized) {
      log.debug('registerAllDefaultCommands — already initialized, skip');
      return;
    }
    if (world) this._world = world;
    if (scene !== undefined && scene !== null) this._scene = scene;
    this.registerGeneralCommands();
    this.registerEngineCommands();
    this.registerSceneCommands();
    this.registerEntityCommands();
    this.registerPhysicsCommands();
    this.registerRenderingCommands();
    this.registerAudioCommands();
    this.registerDebugCommands();
    this.isInitialized = true;
    log.info(
      `registerAllDefaultCommands — registered ${this.commands.size} commands across ${this.getCategories().length} categories`,
    );
  }

  /** 注册通用命令: help / clear / history。 */
  registerGeneralCommands(): void {
    this.registerCommand({
      name: 'help',
      description: '显示帮助。无参数列出全部命令,带参数显示单命令详情。',
      usage: 'help [command]',
      args: [{ name: 'command', type: 'string', required: false, description: '命令名或别名' }],
      handler: (args) => {
        if (args.length === 0) {
          const grouped = this.getHelp() as GroupedHelp[];
          const lines: string[] = ['=== Available Commands ==='];
          for (const g of grouped) {
            lines.push(`\n[${g.category}]`);
            for (const e of g.entries) {
              lines.push(`  ${e.usage.padEnd(36)} ${e.description}`);
            }
          }
          return lines.join('\n');
        }
        const entries = this.getHelp(args[0]) as HelpEntry[];
        if (entries.length === 0) return `No help for: "${args[0]}"`;
        const e = entries[0];
        const lines = [
          `=== ${e.name} ===`,
          `Category: ${e.category}`,
          `Description: ${e.description}`,
          `Usage: ${e.usage}`,
        ];
        if (e.args.length > 0) {
          lines.push('Arguments:');
          for (const a of e.args) {
            const tag = a.required ? 'required' : 'optional';
            lines.push(`  <${a.name}: ${a.type}> (${tag})${a.description ? ' — ' + a.description : ''}`);
          }
        }
        return lines.join('\n');
      },
      category: 'General',
    });

    this.registerCommand({
      name: 'clear',
      description: '清空控制台输出。',
      usage: 'clear',
      args: [],
      handler: () => '__CLEAR__',
      category: 'General',
    });

    this.registerCommand({
      name: 'history',
      description: '显示命令历史。',
      usage: 'history',
      args: [],
      handler: () => {
        const h = this.getHistory();
        if (h.length === 0) return '(empty history)';
        return h.map((c, i) => `${String(i + 1).padStart(3, ' ')}) ${c}`).join('\n');
      },
      category: 'General',
    });

    // 常用别名
    this.registerAlias('?', 'help');
    this.registerAlias('cls', 'clear');
    this.registerAlias('h', 'history');
  }

  /**
   * 注册引擎命令 (引擎信息 / 模块清单)。
   * 当前为查询类命令,不依赖 World。
   */
  registerEngineCommands(): void {
    this.registerCommand({
      name: 'engine.info',
      description: '显示引擎信息 (版本 / 模块数 / 命令数)。',
      usage: 'engine.info',
      args: [],
      handler: () => {
        const stats = this.getStats();
        const lines = [
          '=== VREEN Engine ===',
          `Commands: ${stats.total}`,
          `Aliases: ${stats.aliasCount}`,
          `Categories: ${Object.keys(stats.byCategory).length}`,
          `Initialized: ${stats.isInitialized}`,
        ];
        return lines.join('\n');
      },
      category: 'Engine',
    });

    this.registerCommand({
      name: 'engine.commands',
      description: '列出所有已注册命令。',
      usage: 'engine.commands',
      args: [],
      handler: () => {
        const cmds = this.getCommands();
        if (cmds.length === 0) return '(no commands registered)';
        return cmds.map((c) => `${c.name.padEnd(28)} [${c.category}] ${c.description}`).join('\n');
      },
      category: 'Engine',
    });

    this.registerCommand({
      name: 'engine.categories',
      description: '列出所有命令分类。',
      usage: 'engine.categories',
      args: [],
      handler: () => {
        const cats = this.getCategories();
        if (cats.length === 0) return '(no categories)';
        return cats.map((c) => {
          const count = this.getCommandsByCategory(c).length;
          return `${c.padEnd(16)} ${count} command(s)`;
        }).join('\n');
      },
      category: 'Engine',
    });
  }

  /**
   * 注册场景命令: load / save / list。
   * scene.load / scene.save 委托 SceneSerializer; 需 setScene() 设置目标 Scene。
   */
  registerSceneCommands(): void {
    this.registerCommand({
      name: 'scene.load',
      description: '加载场景 (从 JSON 字符串解析并替换当前场景内容)。',
      usage: 'scene.load <json>',
      args: [{ name: 'json', type: 'string', required: true, description: '场景 JSON 字符串' }],
      handler: (args) => {
        if (!this._scene) return 'Error: no scene bound (call setScene first)';
        try {
          const data = JSON.parse(args[0]) as SceneJSON;
          const newScene = SceneSerializer.deserialize(data);
          // 把新场景的根子节点转移到当前绑定的 scene (替换内容)
          const removed = this._scene.children.length;
          // 先 detach 旧子节点
          for (const child of [...this._scene.children]) {
            this._scene.remove(child);
          }
          // 再 attach 新子节点
          for (const child of [...newScene.children]) {
            this._scene.add(child);
          }
          return `Scene loaded: ${this._scene.children.length} root children (replaced ${removed})`;
        } catch (e) {
          throw new Error(`Failed to parse/load scene JSON: ${(e as Error).message}`);
        }
      },
      category: 'Scene',
    });

    this.registerCommand({
      name: 'scene.save',
      description: '保存场景 (序列化为 JSON 字符串输出)。',
      usage: 'scene.save',
      args: [],
      handler: () => {
        if (!this._scene) return 'Error: no scene bound (call setScene first)';
        const data = SceneSerializer.serialize(this._scene);
        return JSON.stringify(data);
      },
      category: 'Scene',
    });

    this.registerCommand({
      name: 'scene.list',
      description: '列出场景根节点的子对象。',
      usage: 'scene.list',
      args: [],
      handler: () => {
        if (!this._scene) return 'Error: no scene bound (call setScene first)';
        const children = this._scene.children;
        if (children.length === 0) return '(empty scene)';
        return children
          .map((c, i) => `${String(i).padStart(3, ' ')}) ${c.name || '(unnamed)'} [${c.type}]`)
          .join('\n');
      },
      category: 'Scene',
    });

    // 别名
    this.registerAlias('ls', 'scene.list');
  }

  /**
   * 注册实体命令: create / delete / list。
   * 依赖 World (registerAllDefaultCommands(world) 时设置)。
   */
  registerEntityCommands(): void {
    this.registerCommand({
      name: 'entity.create',
      description: '创建实体 (可选名称)。返回新实体 ID。',
      usage: 'entity.create [name]',
      args: [{ name: 'name', type: 'string', required: false, description: '实体名' }],
      handler: (args) => {
        if (!this._world) return 'Error: no world bound (call registerAllDefaultCommands(world))';
        const id = this._world.createEntity(args[0]);
        return `Entity created: id=0x${id.toString(16)}`;
      },
      category: 'Entity',
    });

    this.registerCommand({
      name: 'entity.delete',
      description: '删除实体 (按 16 进制 ID)。',
      usage: 'entity.delete <id>',
      args: [{ name: 'id', type: 'string', required: true, description: '实体 ID (16 进制,如 ff)' }],
      handler: (args) => {
        if (!this._world) return 'Error: no world bound';
        const id = parseInt(args[0], 16);
        if (!Number.isFinite(id)) throw new Error(`Invalid entity id: "${args[0]}"`);
        const alive = this._world.isAlive(id as EntityId);
        this._world.destroyEntity(id as EntityId);
        return alive ? `Entity destroyed: 0x${id.toString(16)}` : `Entity not alive: 0x${id.toString(16)}`;
      },
      category: 'Entity',
    });

    this.registerCommand({
      name: 'entity.list',
      description: '列出所有存活实体 (ID + 名称)。',
      usage: 'entity.list',
      args: [],
      handler: () => {
        if (!this._world) return 'Error: no world bound';
        const list: EntitySummary[] = this._world.listEntities();
        if (list.length === 0) return '(no entities)';
        return list
          .map((e) => `0x${(e.id as number).toString(16).padStart(8, '0')}  ${e.name || '(unnamed)'}`)
          .join('\n');
      },
      category: 'Entity',
    });

    this.registerCommand({
      name: 'entity.count',
      description: '显示存活实体总数。',
      usage: 'entity.count',
      args: [],
      handler: () => {
        if (!this._world) return 'Error: no world bound';
        return `Entity count: ${this._world.entityCount()}`;
      },
      category: 'Entity',
    });
  }

  /**
   * 注册物理命令: gravity / pause / resume。
   * 当前为占位 (VREEN 物理组件在 ECS 中,这里提供 REPL 便捷接口)。
   */
  registerPhysicsCommands(): void {
    this.registerCommand({
      name: 'physics.gravity',
      description: '设置重力向量 (x y z)。',
      usage: 'physics.gravity <x> <y> <z>',
      args: [
        { name: 'x', type: 'number', required: true, description: 'X 分量' },
        { name: 'y', type: 'number', required: true, description: 'Y 分量' },
        { name: 'z', type: 'number', required: true, description: 'Z 分量' },
      ],
      handler: (args) => {
        const [x, y, z] = args.map(Number);
        if ([x, y, z].some((v) => !Number.isFinite(v))) {
          throw new Error('All gravity components must be finite numbers');
        }
        // 占位: 实际物理系统接入后改为委托 PhysicsSystem.setGravity(x,y,z)
        log.info(`physics.gravity set to (${x}, ${y}, ${z}) — placeholder`);
        return `Gravity set: (${x}, ${y}, ${z})`;
      },
      category: 'Physics',
    });

    this.registerCommand({
      name: 'physics.pause',
      description: '暂停物理模拟。',
      usage: 'physics.pause',
      args: [],
      handler: () => {
        log.info('physics.pause — placeholder');
        return 'Physics paused';
      },
      category: 'Physics',
    });

    this.registerCommand({
      name: 'physics.resume',
      description: '恢复物理模拟。',
      usage: 'physics.resume',
      args: [],
      handler: () => {
        log.info('physics.resume — placeholder');
        return 'Physics resumed';
      },
      category: 'Physics',
    });

    this.registerAlias('pause', 'physics.pause');
    this.registerAlias('resume', 'physics.resume');
  }

  /**
   * 注册渲染命令: pipeline / quality / screenshot。
   * 当前为占位 (实际渲染由 WebGL2Renderer / Materials 提供)。
   */
  registerRenderingCommands(): void {
    this.registerCommand({
      name: 'render.pipeline',
      description: '设置渲染管线 (forward / deferred)。',
      usage: 'render.pipeline <type>',
      args: [
        {
          name: 'type',
          type: 'string',
          required: true,
          description: '管线类型: forward | deferred',
        },
      ],
      handler: (args) => {
        const t = args[0].toLowerCase();
        if (t !== 'forward' && t !== 'deferred') {
          throw new Error(`Unknown pipeline: "${args[0]}" (expected forward|deferred)`);
        }
        log.info(`render.pipeline → ${t} — placeholder`);
        return `Render pipeline: ${t}`;
      },
      category: 'Rendering',
    });

    this.registerCommand({
      name: 'render.quality',
      description: '设置渲染质量 (low / medium / high / ultra)。',
      usage: 'render.quality <level>',
      args: [
        {
          name: 'level',
          type: 'string',
          required: true,
          description: '质量等级: low | medium | high | ultra',
        },
      ],
      handler: (args) => {
        const lvl = args[0].toLowerCase();
        const valid = ['low', 'medium', 'high', 'ultra'];
        if (!valid.includes(lvl)) {
          throw new Error(`Unknown quality: "${args[0]}" (expected ${valid.join('|')})`);
        }
        log.info(`render.quality → ${lvl} — placeholder`);
        return `Render quality: ${lvl}`;
      },
      category: 'Rendering',
    });

    this.registerCommand({
      name: 'render.screenshot',
      description: '保存截图到指定路径 (占位)。',
      usage: 'render.screenshot <path>',
      args: [{ name: 'path', type: 'string', required: true, description: '输出文件路径' }],
      handler: (args) => {
        log.info(`render.screenshot("${args[0]}") — placeholder`);
        return `Screenshot saved: ${args[0]}`;
      },
      category: 'Rendering',
    });

    this.registerAlias('ss', 'render.screenshot');
  }

  /**
   * 注册音频命令: volume / play。
   * 占位: 实际音频由 AudioListener / Audio / PositionalAudio 提供。
   */
  registerAudioCommands(): void {
    this.registerCommand({
      name: 'audio.volume',
      description: '设置主音量 (0.0 - 1.0)。',
      usage: 'audio.volume <value>',
      args: [{ name: 'value', type: 'number', required: true, description: '音量 0~1' }],
      handler: (args) => {
        const v = Number(args[0]);
        if (!Number.isFinite(v) || v < 0 || v > 1) {
          throw new Error(`Volume must be in [0, 1], got: "${args[0]}"`);
        }
        log.info(`audio.volume → ${v} — placeholder`);
        return `Volume: ${v}`;
      },
      category: 'Audio',
    });

    this.registerCommand({
      name: 'audio.play',
      description: '播放指定音频剪辑 (占位)。',
      usage: 'audio.play <name>',
      args: [{ name: 'name', type: 'string', required: true, description: '音频剪辑名' }],
      handler: (args) => {
        log.info(`audio.play("${args[0]}") — placeholder`);
        return `Playing: ${args[0]}`;
      },
      category: 'Audio',
    });

    this.registerCommand({
      name: 'audio.stop',
      description: '停止指定音频剪辑 (占位)。',
      usage: 'audio.stop <name>',
      args: [{ name: 'name', type: 'string', required: true, description: '音频剪辑名' }],
      handler: (args) => {
        log.info(`audio.stop("${args[0]}") — placeholder`);
        return `Stopped: ${args[0]}`;
      },
      category: 'Audio',
    });
  }

  /**
   * 注册调试命令: stats / fps / profile。
   * 委托 FrameProfiler / SystemProfiler / MemoryTracker (若传入)。
   */
  registerDebugCommands(): void {
    this.registerCommand({
      name: 'debug.stats',
      description: '显示引擎统计 (命令 / 历史 / 分类)。',
      usage: 'debug.stats',
      args: [],
      handler: () => {
        const s = this.getStats();
        const lines = [
          '=== Console Stats ===',
          `Total commands: ${s.total}`,
          `Aliases: ${s.aliasCount}`,
          `History entries: ${s.historyCount}`,
          `Initialized: ${s.isInitialized}`,
          'By category:',
        ];
        for (const [cat, count] of Object.entries(s.byCategory).sort()) {
          lines.push(`  ${cat.padEnd(16)} ${count}`);
        }
        return lines.join('\n');
      },
      category: 'Debug',
    });

    this.registerCommand({
      name: 'debug.fps',
      description: '显示当前 FPS (需关联 FrameProfiler)。',
      usage: 'debug.fps',
      args: [],
      handler: () => {
        // 尝试从全局 FrameProfiler 实例读取 (调用方应通过 setFrameProfiler 注入)
        if (this._frameProfiler) {
          const m = this._frameProfiler.getMetrics();
          return `FPS: current=${m.currentFPS.toFixed(1)} avg=${m.avgFPS.toFixed(1)} min=${m.minFPS.toFixed(1)} max=${m.maxFPS.toFixed(1)}`;
        }
        return 'FPS: (no FrameProfiler bound)';
      },
      category: 'Debug',
    });

    this.registerCommand({
      name: 'debug.profile',
      description: '性能分析 (持续指定秒数,占位)。',
      usage: 'debug.profile <duration>',
      args: [
        { name: 'duration', type: 'number', required: true, description: '持续时间(秒)' },
      ],
      handler: (args) => {
        const dur = Number(args[0]);
        if (!Number.isFinite(dur) || dur <= 0) {
          throw new Error(`Duration must be a positive number, got: "${args[0]}"`);
        }
        log.info(`debug.profile(${dur}s) — placeholder`);
        return `Profiling for ${dur}s... (result logged on completion)`;
      },
      category: 'Debug',
    });

    this.registerCommand({
      name: 'debug.systems',
      description: '显示 ECS 系统耗时 (需关联 SystemProfiler)。',
      usage: 'debug.systems',
      args: [],
      handler: () => {
        if (this._systemProfiler) {
          const timings = this._systemProfiler.getAllTimings();
          if (timings.length === 0) return '(no system timings recorded)';
          return timings
            .map(
              (t) =>
                `${t.name.padEnd(24)} total=${t.totalTime.toFixed(2)}ms calls=${t.callCount} avg=${t.avgTime.toFixed(3)}ms max=${t.maxTime.toFixed(3)}ms`,
            )
            .join('\n');
        }
        return '(no SystemProfiler bound)';
      },
      category: 'Debug',
    });

    this.registerCommand({
      name: 'debug.memory',
      description: '显示内存分配跟踪 (需关联 MemoryTracker)。',
      usage: 'debug.memory',
      args: [],
      handler: () => {
        if (this._memoryTracker) {
          const s = this._memoryTracker.getSummary();
          const lines = [
            '=== Memory Tracker ===',
            `Active allocations: ${s.activeCount}`,
            `Total allocated: ${s.totalAllocated} bytes`,
            `Total freed: ${s.totalFreed} bytes`,
            `Active bytes: ${s.activeBytes} (${s.activeMB.toFixed(2)} MB)`,
            'By type:',
          ];
          for (const [type, info] of Object.entries(s.byType).sort()) {
            lines.push(`  ${type.padEnd(20)} count=${info.count} bytes=${info.bytes}`);
          }
          return lines.join('\n');
        }
        return '(no MemoryTracker bound)';
      },
      category: 'Debug',
    });

    this.registerAlias('stats', 'debug.stats');
    this.registerAlias('fps', 'debug.fps');
  }

  // ── 注入依赖 (供 debug.* 命令使用) ────────────────────────────

  /** 关联的 FrameProfiler (供 debug.fps 命令使用)。 */
  private _frameProfiler: FrameProfiler | null = null;
  /** 关联的 SystemProfiler (供 debug.systems 命令使用)。 */
  private _systemProfiler: SystemProfiler | null = null;
  /** 关联的 MemoryTracker (供 debug.memory 命令使用)。 */
  private _memoryTracker: MemoryTracker | null = null;

  /** 设置关联的 World。 */
  setWorld(world: World | null): void {
    this._world = world;
  }

  /** 设置关联的 Scene。 */
  setScene(scene: Scene | null): void {
    this._scene = scene;
  }

  /** 设置关联的 FrameProfiler (供 debug.fps 命令使用)。 */
  setFrameProfiler(fp: FrameProfiler | null): void {
    this._frameProfiler = fp;
  }

  /** 设置关联的 SystemProfiler (供 debug.systems 命令使用)。 */
  setSystemProfiler(sp: SystemProfiler | null): void {
    this._systemProfiler = sp;
  }

  /** 设置关联的 MemoryTracker (供 debug.memory 命令使用)。 */
  setMemoryTracker(mt: MemoryTracker | null): void {
    this._memoryTracker = mt;
  }

  // ── 统计 ────────────────────────────────────────────────────────

  /** 获取统计信息。 */
  getStats(): ConsoleCommandsStats {
    const byCategory: Record<string, number> = {};
    for (const cmd of this.commands.values()) {
      byCategory[cmd.category] = (byCategory[cmd.category] ?? 0) + 1;
    }
    return {
      total: this.commands.size,
      aliasCount: this.aliases.size,
      historyCount: this.history.length,
      byCategory,
      isInitialized: this.isInitialized,
    };
  }

  /** 清空所有命令 / 别名 / 历史 (并重置 isInitialized)。 */
  clear(): void {
    const n = this.commands.size;
    this.commands.clear();
    this.aliases.clear();
    this.history.length = 0;
    this.isInitialized = false;
    this._world = null;
    this._scene = null;
    this._frameProfiler = null;
    this._systemProfiler = null;
    this._memoryTracker = null;
    if (n > 0) log.info(`clear() — dropped ${n} commands`);
  }

  // ── private ─────────────────────────────────────────────────────

  /**
   * 拆分输入为 (命令名, 原始参数数组)。
   * 支持双引号包裹含空格的参数 (如 scene.load "{...}"),
   * 并支持引号内 `\"` 转义 (用于传递 JSON 字符串)。
   */
  private _splitNameAndArgs(input: string): { name: string; rawArgs: string[] } {
    const tokens: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      // 引号内遇 \" 转义为字面 "
      if (ch === '\\' && inQuotes && input[i + 1] === '"') {
        cur += '"';
        i++; // 跳过下一个字符 (被消费的 ")
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ' ' && !inQuotes) {
        if (cur) {
          tokens.push(cur);
          cur = '';
        }
      } else {
        cur += ch;
      }
    }
    if (cur) tokens.push(cur);
    const name = tokens[0] ?? '';
    const rawArgs = tokens.slice(1);
    return { name, rawArgs };
  }

  /** 校验参数数量与类型 (类型校验仅检查可解析性,不转换)。 */
  private _validateArgs(cmd: ConsoleCommand, rawArgs: string[]): string | null {
    const required = cmd.args.filter((a) => a.required);
    if (rawArgs.length < required.length) {
      return `Missing arguments. Usage: ${cmd.usage}`;
    }
    // 逐个校验类型可解析性
    for (let i = 0; i < cmd.args.length && i < rawArgs.length; i++) {
      const decl = cmd.args[i];
      const raw = rawArgs[i];
      const conv = this._convertArg(raw, decl.type);
      if (conv.error) {
        return `Argument "${decl.name}" (${decl.type}): ${conv.error}`;
      }
    }
    return null;
  }

  /** 转换单个参数。失败返回 { error }。 */
  private _convertArg(
    raw: string,
    type: ConsoleArgType,
  ): { value: ParsedArgValue; error?: undefined } | { value?: undefined; error: string } {
    switch (type) {
      case 'string':
        return { value: raw };
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) return { error: `"${raw}" is not a finite number` };
        return { value: n };
      }
      case 'boolean': {
        const lower = raw.toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(lower)) return { value: true };
        if (['false', '0', 'no', 'off'].includes(lower)) return { value: false };
        return { error: `"${raw}" is not a boolean (true/false/1/0/yes/no)` };
      }
      case 'vector3': {
        // 支持 "x,y,z" 或 "x y z" 形式
        const parts = raw.split(/[,\s]+/).filter((s) => s.length > 0);
        if (parts.length !== 3) return { error: `"${raw}" is not a vector3 (expected "x y z" or "x,y,z")` };
        const [x, y, z] = parts.map(Number);
        if ([x, y, z].some((v) => !Number.isFinite(v))) {
          return { error: `"${raw}" contains non-numeric component` };
        }
        return { value: [x, y, z] };
      }
      default:
        return { error: `Unknown arg type: ${type}` };
    }
  }
}

/** 全局默认 ConsoleCommands 单例 (与 getDefaultModuleRegistry 风格一致)。 */
let _default: ConsoleCommands | null = null;
export function getDefaultConsoleCommands(): ConsoleCommands {
  if (!_default) _default = new ConsoleCommands();
  return _default;
}

/** 测试 / 重置全局单例 (会先 clear 旧实例)。 */
export function resetDefaultConsoleCommands(): void {
  _default?.clear();
  _default = null;
}
