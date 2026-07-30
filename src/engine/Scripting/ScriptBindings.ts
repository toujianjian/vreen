// ScriptBindings — 脚本绑定系统。
//
// 设计原则 (参考 o3de BehaviorContext / Lua Bridge / Unreal LuaMachine):
//   - 把引擎核心 API (Math / Scene / Physics / Audio / Input / Rendering)
//     以统一形式注册到脚本运行时,供脚本 (Blockly / VisualScriptComponent /
//     ScriptInstance / 嵌入式 JS) 通过名字访问。
//   - 每个 binding 含 name / description / type / value / category,
//     type ∈ 'function' | 'property' | 'class' | 'enum' 决定 value 语义。
//   - 调用方拿 ScriptBindings 实例后可手动 register*,也可调用
//     initialize() 一次性注册全套核心 API。
//
// 与 ScriptRegistry 的差异:
//   - ScriptRegistry 管"脚本类工厂" (按名创建 ScriptInstance);
//   - ScriptBindings 管"API 表面" (按名暴露函数/属性/类/枚举给脚本)。
//   两者正交: ScriptRegistry 关注行为, ScriptBindings 关注能力。
//
// 不变量:
//   - register* 同名覆盖; 返回是否覆盖了既有绑定。
//   - get / has / call 对未知名返回 undefined / false / undefined (不抛错)。
//   - call 仅对 type='function' 的绑定生效; 其他类型返回 undefined。
//   - initialize() 幂等 (isInitialized 标记防重复)。

import { createLogger } from '@/lib/logger';
import {
  Vector2,
  Vector3,
  Vector4,
  Matrix3,
  Matrix4,
  Quaternion,
  Euler,
  Color,
  Box3,
  Sphere,
  Plane,
  Ray,
  MathUtils,
} from '../Math';
import type { World, EntityId } from '../ECS/World';

const log = createLogger('ScriptBindings');

/** 绑定类型。决定 value 字段的语义。 */
export type ScriptBindingType = 'function' | 'property' | 'class' | 'enum';

/** 单个脚本绑定条目。 */
export interface ScriptBinding {
  /** 绑定名 (脚本通过此名访问,如 "Vector3" / "applyForce")。 */
  name: string;
  /** 人类可读描述 (供自动补全 / API 文档使用)。 */
  description: string;
  /** 绑定类型。 */
  type: ScriptBindingType;
  /** 绑定值:
   *   - function: (...args) => any
   *   - property: 任意值 (常量 / 对象实例)
   *   - class: 构造函数
   *   - enum: { [key: string]: number | string } */
  value: any;
  /** 分类 (用于 getBindingsByCategory 与文档分组),如 "Math" / "Scene"。 */
  category: string;
}

/** API 信息条目 (供自动补全)。 */
export interface ScriptAPIInfo {
  name: string;
  type: ScriptBindingType;
  category: string;
  description: string;
  /** function 类型时的参数名列表 (若可推断)。 */
  params?: string[];
}

/** API 文档分组 (供 exportAPIDocumentation)。 */
export interface ScriptAPIDocCategory {
  category: string;
  bindings: Array<{
    name: string;
    type: ScriptBindingType;
    description: string;
  }>;
}

/** 导出的 API 文档。 */
export interface ScriptAPIDocumentation {
  categories: ScriptAPIDocCategory[];
  totalBindings: number;
}

/** ScriptBindings 统计信息。 */
export interface ScriptBindingsStats {
  /** 总绑定数。 */
  total: number;
  /** 按类型分组的计数。 */
  byType: Record<ScriptBindingType, number>;
  /** 分类数。 */
  categoryCount: number;
  /** 每分类的绑定数。 */
  byCategory: Record<string, number>;
  /** 是否已初始化核心 API。 */
  isInitialized: boolean;
}

/**
 * 脚本绑定系统。
 *
 * 典型用法:
 * ```ts
 * const bindings = new ScriptBindings();
 * bindings.initialize(world); // 注册全套核心 API
 * bindings.registerFunction('hello', (name: string) => `Hi, ${name}`, 'Test', '打招呼');
 * const result = bindings.call('hello', ['Vreen']); // → "Hi, Vreen"
 * ```
 */
export class ScriptBindings {
  /** name → 绑定条目。 */
  bindings: Map<string, ScriptBinding> = new Map();
  /** 全局 API 表 (按 namespace 分组的便捷访问,如 globalAPI.get('Math'))。 */
  globalAPI: Map<string, Record<string, any>> = new Map();
  /** 是否已初始化 (initialize() 调用过)。 */
  isInitialized: boolean = false;

  /** 关联的 World (initialize(world) 时设置,供 Scene/Physics API 使用)。 */
  private _world: World | null = null;

  /**
   * 初始化: 注册核心 API (Math / Scene / Physics / Audio / Input / Rendering)。
   * 幂等: 已初始化则直接返回。
   * @param world 关联的 ECS World (Scene/Physics API 需要它)
   */
  initialize(world?: World): void {
    if (this.isInitialized) {
      log.debug('initialize() — already initialized, skip');
      return;
    }
    if (world) this._world = world;
    this.registerEngineAPI();
    this.registerSceneAPI();
    this.registerPhysicsAPI();
    this.registerAudioAPI();
    this.registerInputAPI();
    this.registerRenderingAPI();
    this.isInitialized = true;
    log.info(`initialize() — registered ${this.bindings.size} bindings across ${this.getCategories().length} categories`);
  }

  // ── 注册 API ────────────────────────────────────────────────

  /**
   * 注册函数。同名覆盖; 返回是否覆盖了既有绑定。
   */
  registerFunction(
    name: string,
    fn: Function,
    category: string = 'General',
    description: string = '',
  ): boolean {
    return this._register({ name, description, type: 'function', value: fn, category });
  }

  /**
   * 注册属性 (常量 / 对象实例)。同名覆盖; 返回是否覆盖。
   */
  registerProperty(
    name: string,
    value: any,
    category: string = 'General',
    description: string = '',
  ): boolean {
    return this._register({ name, description, type: 'property', value, category });
  }

  /**
   * 注册类 (构造函数)。同名覆盖; 返回是否覆盖。
   */
  registerClass(
    name: string,
    constructor: any,
    category: string = 'General',
    description: string = '',
  ): boolean {
    return this._register({ name, description, type: 'class', value: constructor, category });
  }

  /**
   * 注册枚举 (键值表)。同名覆盖; 返回是否覆盖。
   */
  registerEnum(
    name: string,
    values: Record<string, number | string>,
    category: string = 'General',
    description: string = '',
  ): boolean {
    return this._register({ name, description, type: 'enum', value: values, category });
  }

  /** 注销指定绑定。返回是否成功移除。 */
  unregister(name: string): boolean {
    const removed = this.bindings.delete(name);
    if (removed) log.debug(`unregister("${name}")`);
    return removed;
  }

  // ── 查询 API ────────────────────────────────────────────────

  /** 获取绑定条目。未知名返回 undefined。 */
  get(name: string): ScriptBinding | undefined {
    return this.bindings.get(name);
  }

  /** 是否存在该绑定。 */
  has(name: string): boolean {
    return this.bindings.has(name);
  }

  /** 获取所有绑定 (快照数组)。 */
  getBindings(): ScriptBinding[] {
    return Array.from(this.bindings.values());
  }

  /** 按分类获取绑定。 */
  getBindingsByCategory(category: string): ScriptBinding[] {
    const out: ScriptBinding[] = [];
    for (const b of this.bindings.values()) {
      if (b.category === category) out.push(b);
    }
    return out;
  }

  /** 获取所有分类名 (排序后的快照)。 */
  getCategories(): string[] {
    const set = new Set<string>();
    for (const b of this.bindings.values()) set.add(b.category);
    return Array.from(set).sort();
  }

  /**
   * 调用已注册的函数。非 function 类型或未知名返回 undefined。
   */
  call(name: string, args: any[] = []): any {
    const b = this.bindings.get(name);
    if (!b) {
      log.warn(`call("${name}") — binding not found`);
      return undefined;
    }
    if (b.type !== 'function') {
      log.warn(`call("${name}") — binding is not a function (type="${b.type}")`);
      return undefined;
    }
    try {
      return (b.value as Function)(...args);
    } catch (err) {
      log.error(`call("${name}") threw: ${(err as Error).message ?? err}`);
      return undefined;
    }
  }

  // ── 核心 API 注册 ────────────────────────────────────────────

  /**
   * 注册引擎核心 API (Math 类族 + 工具)。
   * 注册类: Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Ray
   * 注册属性: MathUtils (函数集合作为属性暴露)
   */
  registerEngineAPI(): void {
    const cat = 'Math';
    this.registerClass('Vector2', Vector2, cat, '2D 向量');
    this.registerClass('Vector3', Vector3, cat, '3D 向量');
    this.registerClass('Vector4', Vector4, cat, '4D 向量');
    this.registerClass('Matrix3', Matrix3, cat, '3x3 矩阵');
    this.registerClass('Matrix4', Matrix4, cat, '4x4 矩阵');
    this.registerClass('Quaternion', Quaternion, cat, '四元数');
    this.registerClass('Euler', Euler, cat, '欧拉角');
    this.registerClass('Color', Color, cat, '颜色');
    this.registerClass('Box3', Box3, cat, 'AABB 包围盒');
    this.registerClass('Sphere', Sphere, cat, '球体');
    this.registerClass('Plane', Plane, cat, '平面');
    this.registerClass('Ray', Ray, cat, '射线');
    this.registerProperty('MathUtils', MathUtils, cat, '数学工具函数 (lerp/clamp/radToDeg/...)');

    // 工具函数
    this.registerFunction(
      'clamp',
      (v: number, min: number, max: number) => MathUtils.clamp(v, min, max),
      cat,
      '将 v 限制到 [min, max]',
    );
    this.registerFunction(
      'lerp',
      (a: number, b: number, t: number) => MathUtils.lerp(a, b, t),
      cat,
      '线性插值 a + (b - a) * t',
    );
    this.registerFunction(
      'radToDeg',
      (rad: number) => (rad * 180) / Math.PI,
      cat,
      '弧度转角度',
    );
    this.registerFunction(
      'degToRad',
      (deg: number) => (deg * Math.PI) / 180,
      cat,
      '角度转弧度',
    );
  }

  /**
   * 注册场景 API (Entity 增删查 + 组件操作)。
   * 需要 initialize(world) 时传入 World。
   */
  registerSceneAPI(): void {
    const cat = 'Scene';
    const w = () => this._requireWorld(cat);

    this.registerFunction('createEntity', (name?: string) => w().createEntity(name), cat, '创建实体');
    this.registerFunction('destroyEntity', (id: EntityId) => w().destroyEntity(id), cat, '销毁实体');
    this.registerFunction('isAlive', (id: EntityId) => w().isAlive(id), cat, '检查实体是否存活');
    this.registerFunction('getEntityName', (id: EntityId) => w().getName(id), cat, '获取实体名');
    this.registerFunction('setEntityName', (id: EntityId, name: string) => w().setName(id, name), cat, '设置实体名');
    this.registerFunction('entityCount', () => w().entityCount(), cat, '获取存活实体总数');
    this.registerFunction('getSceneNode', (id: EntityId) => w().getSceneNode(id), cat, '获取实体的 Object3D 场景节点');
    this.registerFunction('listEntities', () => w().listEntities(), cat, '列出所有实体快照');
  }

  /**
   * 注册物理 API。
   * 当前为占位: VREEN 的物理组件 (Rigidbody/Collider) 在 ECS Components 中,
   * 脚本可通过 setComponent/getComponent 直接操作; 这里提供便捷封装。
   */
  registerPhysicsAPI(): void {
    const cat = 'Physics';
    this.registerFunction(
      'applyForce',
      (entityId: EntityId, fx: number, fy: number, fz: number) => {
        log.debug(`applyForce(entity=${entityId}, ${fx},${fy},${fz}) — placeholder`);
        // 占位实现: 由调用方通过 getComponent<Rigidbody> 自行操作;
        // 后续 PhysicsSystem 提供统一接口时改为委托。
        return undefined;
      },
      cat,
      '对实体施加力 (占位,后续接入 PhysicsSystem)',
    );
    this.registerFunction(
      'setVelocity',
      (entityId: EntityId, x: number, y: number, z: number) => {
        log.debug(`setVelocity(entity=${entityId}, ${x},${y},${z}) — placeholder`);
        return undefined;
      },
      cat,
      '设置实体速度 (占位)',
    );
    this.registerFunction(
      'getVelocity',
      (entityId: EntityId) => {
        log.debug(`getVelocity(entity=${entityId}) — placeholder`);
        return new Vector3(0, 0, 0);
      },
      cat,
      '获取实体速度 (占位,返回零向量)',
    );
  }

  /**
   * 注册音频 API。
   * 占位: 实际 Audio 模块由 AudioListener/Audio/PositionalAudio 提供,
   * 这里提供简化接口供脚本调用。
   */
  registerAudioAPI(): void {
    const cat = 'Audio';
    this.registerFunction(
      'play',
      (clipId: string, volume: number = 1.0) => {
        log.debug(`play("${clipId}", vol=${volume}) — placeholder`);
        return false;
      },
      cat,
      '播放音频 (占位,返回 false)',
    );
    this.registerFunction(
      'pause',
      (clipId: string) => {
        log.debug(`pause("${clipId}") — placeholder`);
        return false;
      },
      cat,
      '暂停音频 (占位)',
    );
    this.registerFunction(
      'stop',
      (clipId: string) => {
        log.debug(`stop("${clipId}") — placeholder`);
        return false;
      },
      cat,
      '停止音频 (占位)',
    );
    this.registerFunction(
      'setVolume',
      (clipId: string, volume: number) => {
        log.debug(`setVolume("${clipId}", ${volume}) — placeholder`);
        return false;
      },
      cat,
      '设置音量 (占位)',
    );
  }

  /**
   * 注册输入 API。
   * 占位: 实际输入由 InputManager (键盘/鼠标/触摸/手柄) 提供,
   * 这里提供简化接口供脚本调用。
   */
  registerInputAPI(): void {
    const cat = 'Input';
    this.registerFunction(
      'isKeyDown',
      (code: string) => {
        log.debug(`isKeyDown("${code}") — placeholder`);
        return false;
      },
      cat,
      '检查按键是否按下 (占位,返回 false)',
    );
    this.registerFunction(
      'isKeyPressed',
      (code: string) => {
        log.debug(`isKeyPressed("${code}") — placeholder`);
        return false;
      },
      cat,
      '检查按键是否本帧按下 (占位)',
    );
    this.registerFunction(
      'isMouseDown',
      (button: number) => {
        log.debug(`isMouseDown(${button}) — placeholder`);
        return false;
      },
      cat,
      '检查鼠标按钮是否按下 (占位)',
    );
    this.registerFunction(
      'getMousePosition',
      () => {
        log.debug('getMousePosition() — placeholder');
        return { x: 0, y: 0 };
      },
      cat,
      '获取鼠标位置 (占位,返回 {x:0,y:0})',
    );
  }

  /**
   * 注册渲染 API。
   * 占位: 实际渲染由 WebGL2Renderer / Materials 提供,
   * 这里提供简化接口供脚本调用。
   */
  registerRenderingAPI(): void {
    const cat = 'Rendering';
    this.registerFunction(
      'setMaterial',
      (entityId: EntityId, _material: any) => {
        log.debug(`setMaterial(entity=${entityId}) — placeholder`);
        return false;
      },
      cat,
      '设置实体材质 (占位)',
    );
    this.registerFunction(
      'setCamera',
      (_camera: any) => {
        log.debug('setCamera() — placeholder');
        return false;
      },
      cat,
      '设置当前相机 (占位)',
    );
    this.registerFunction(
      'setBackgroundColor',
      (r: number, g: number, b: number) => {
        log.debug(`setBackgroundColor(${r},${g},${b}) — placeholder`);
        return false;
      },
      cat,
      '设置背景色 (占位)',
    );
    this.registerFunction(
      'setFog',
      (_color: any, near: number, far: number) => {
        log.debug(`setFog(...,${near},${far}) — placeholder`);
        return false;
      },
      cat,
      '设置雾效 (占位)',
    );
  }

  // ── 元信息 / 文档 ────────────────────────────────────────────

  /**
   * 获取 API 信息列表 (用于自动补全)。
   * 返回所有绑定的精简信息。
   */
  getAPIInfo(): ScriptAPIInfo[] {
    const out: ScriptAPIInfo[] = [];
    for (const b of this.bindings.values()) {
      const info: ScriptAPIInfo = {
        name: b.name,
        type: b.type,
        category: b.category,
        description: b.description,
      };
      if (b.type === 'function' && typeof b.value === 'function') {
        // 尝试从函数签名推断参数名 (最佳努力,可能失败)。
        try {
          const src = (b.value as Function).toString();
          const match = src.match(/\(([^)]*)\)/);
          if (match && match[1].trim()) {
            info.params = match[1]
              .split(',')
              .map((p) => p.trim().split(/[=:]/)[0].trim())
              .filter((p) => p.length > 0);
          }
        } catch {
          // 推断失败忽略
        }
      }
      out.push(info);
    }
    return out;
  }

  /**
   * 导出 API 文档 (按分类分组,可序列化)。
   */
  exportAPIDocumentation(): ScriptAPIDocumentation {
    const categories: ScriptAPIDocCategory[] = [];
    for (const cat of this.getCategories()) {
      categories.push({
        category: cat,
        bindings: this.getBindingsByCategory(cat).map((b) => ({
          name: b.name,
          type: b.type,
          description: b.description,
        })),
      });
    }
    return {
      categories,
      totalBindings: this.bindings.size,
    };
  }

  /**
   * 获取统计信息。
   */
  getStats(): ScriptBindingsStats {
    const byType: Record<ScriptBindingType, number> = {
      function: 0,
      property: 0,
      class: 0,
      enum: 0,
    };
    const byCategory: Record<string, number> = {};
    for (const b of this.bindings.values()) {
      byType[b.type]++;
      byCategory[b.category] = (byCategory[b.category] ?? 0) + 1;
    }
    return {
      total: this.bindings.size,
      byType,
      categoryCount: Object.keys(byCategory).length,
      byCategory,
      isInitialized: this.isInitialized,
    };
  }

  /** 清空所有绑定 (并重置 isInitialized)。 */
  clear(): void {
    const n = this.bindings.size;
    this.bindings.clear();
    this.globalAPI.clear();
    this.isInitialized = false;
    this._world = null;
    if (n > 0) log.info(`clear() — dropped ${n} bindings`);
  }

  // ── private ─────────────────────────────────────────────────

  /** 内部注册: 同名覆盖,返回是否覆盖。 */
  private _register(binding: ScriptBinding): boolean {
    const existed = this.bindings.has(binding.name);
    this.bindings.set(binding.name, binding);
    if (existed) {
      log.debug(`register("${binding.name}", type="${binding.type}", cat="${binding.category}") — overrode existing`);
    } else {
      log.debug(`register("${binding.name}", type="${binding.type}", cat="${binding.category}")`);
    }
    return existed;
  }

  /** 取关联的 World; 未设置则抛错。 */
  private _requireWorld(cat: string): World {
    if (!this._world) {
      throw new Error(`ScriptBindings: ${cat} API requires a World — call initialize(world) first`);
    }
    return this._world;
  }
}

/** 全局默认 ScriptBindings 单例 (与 scriptRegistry / getDefaultAssetRegistry 风格一致)。 */
let _default: ScriptBindings | null = null;
export function getDefaultScriptBindings(): ScriptBindings {
  if (!_default) _default = new ScriptBindings();
  return _default;
}

/** 测试 / 重置全局单例。 */
export function resetDefaultScriptBindings(): void {
  _default?.clear();
  _default = null;
}
