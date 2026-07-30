// ShaderVariant — 着色器变体系统(关键字组合 + 变体缓存)。
//
// 设计目标:
//   - 提供 ShaderVariant "关键字 + 值" 的组合机制:每个关键字有若干可选值
//     (例如 LIGHTING: UNLIT | LAMBERT | PHONG,USE_FOG: 0 | 1),
//     变体 = 所有关键字取值的笛卡尔积中的一个具体组合;
//   - 变体缓存:同一组合只 build 一次,后续 getVariant 命中缓存并递增引用计数;
//   - 注入 #define:preprocess(source, keywords) 在 #version 行之后注入
//     `#define KEY VALUE` / `#define KEY_VALUE 1`(枚举型关键字);
//   - LRU 驱逐:超过 maxVariants 时驱逐 refCount==0 的最旧变体;
//
// 与 ShaderLibrary / ShaderCompiler 的关系:
//   - ShaderLibrary 提供完整着色器 *模板*(静态字符串),createVariant 只是
//     字符串覆盖,无关键字 / 缓存;
//   - ShaderCompiler 提供 #include 解析 + 编译缓存,但 cache key 是 hash 源码,
//     不感知"关键字"概念;
//   - ShaderVariant 在二者之上层加一层"关键字 → 变体"映射:
//       1. registerKeyword 声明可用关键字及其取值集合;
//       2. getVariant({ KEY: VALUE }) 按 key 取缓存条目,未命中时调用
//          preprocess 注入 #define,再可选地调用外部 compiler 编译并缓存;
//       3. releaseVariant 递减引用计数,evictUnused 清理空闲变体;
//   - ShaderVariant 不替代 ShaderCompiler:它产出的是 (vertexSource, fragmentSource)
//     对(已注入 #define),调用方可继续交给 ShaderCompiler 编译;
//   - 若提供 compiler 回调,ShaderVariant 会主动调用并缓存编译产物。

import { createLogger } from '@/lib/logger';

const log = createLogger('ShaderVariant');

/** 关键字声明。 */
export interface ShaderKeyword {
  /** 关键字名(如 'USE_FOG' / 'LIGHTING')。 */
  name: string;
  /** 可选值集合(枚举型)。空数组表示布尔型关键字(只有 0/1 两个取值)。 */
  values: string[];
  /** 默认取值(getVariant 未指定时使用)。 */
  default: string;
}

/** 变体缓存条目。 */
export interface ShaderVariantEntry {
  /** 变体键(由 getVariantKey 生成,如 'LIGHTING=PHONG|USE_FOG=1')。 */
  key: string;
  /** 注入 #define 后的顶点源码。 */
  vertexSource: string;
  /** 注入 #define 后的片段源码。 */
  fragmentSource: string;
  /** 编译产物(由 compiler 回调返回,可选)。 */
  compiledProgram: unknown;
  /** 引用计数(getVariant +1,releaseVariant -1)。 */
  refCount: number;
  /** 创建顺序(用于 LRU 驱逐最旧)。 */
  createdOrder: number;
}

/** 缓存统计。 */
export interface ShaderVariantCacheStats {
  variantCount: number;
  maxVariants: number;
  usedVariants: number;
  unusedVariants: number;
  totalRefCount: number;
  keywordCount: number;
  buildCount: number;
  cacheHits: number;
  cacheMisses: number;
  evictions: number;
}

/** 变体查询参数:关键字名 → 取值。 */
export type VariantQuery = Record<string, string>;

/** 编译器回调:把处理后的源码编译为 program(返回值原样存入 entry.compiledProgram)。 */
export type ShaderVariantCompiler = (
  vertexSource: string,
  fragmentSource: string,
  key: string,
) => unknown;

/** 构造选项。 */
export interface ShaderVariantOptions {
  /** 基础顶点源码(变体基于此注入 #define)。 */
  vertexSource: string;
  /** 基础片段源码。 */
  fragmentSource: string;
  /** 最大变体缓存数(默认 100)。 */
  maxVariants?: number;
  /** 编译器回调(可选,提供则 buildVariant 时调用并缓存产物)。 */
  compiler?: ShaderVariantCompiler;
}

/** 自增顺序计数器(LRU 用)。 */
let _createdCounter = 0;

/**
 * 着色器变体系统。
 *
 * 用法:
 *   const sv = new ShaderVariant({
 *     vertexSource: BASE_VERT,
 *     fragmentSource: BASE_FRAG,
 *     maxVariants: 64,
 *   });
 *   sv.registerKeyword('LIGHTING', ['UNLIT', 'LAMBERT', 'PHONG'], 'LAMBERT');
 *   sv.registerKeyword('USE_FOG', [], '0');  // 布尔型
 *
 *   const v1 = sv.getVariant({ LIGHTING: 'PHONG', USE_FOG: '1' });
 *   // v1.vertexSource 已注入 #define LIGHTING_PHONG 1 / #define USE_FOG 1
 *
 *   sv.releaseVariant({ LIGHTING: 'PHONG', USE_FOG: '1' });
 *   sv.evictUnused();
 */
export class ShaderVariant {
  /** 变体缓存(key → entry)。 */
  variants: Map<string, ShaderVariantEntry> = new Map();
  /** 关键字注册表(name → keyword)。 */
  keywords: Map<string, ShaderKeyword> = new Map();
  /** 最大变体数。 */
  maxVariants: number;

  private _baseVertexSource: string;
  private _baseFragmentSource: string;
  private _compiler?: ShaderVariantCompiler;
  private _buildCount = 0;
  private _cacheHits = 0;
  private _cacheMisses = 0;
  private _evictions = 0;

  constructor(opts: ShaderVariantOptions) {
    if (!opts.vertexSource || !opts.fragmentSource) {
      throw new Error('ShaderVariant: vertexSource / fragmentSource must be non-empty');
    }
    this._baseVertexSource = opts.vertexSource;
    this._baseFragmentSource = opts.fragmentSource;
    this.maxVariants = opts.maxVariants ?? 100;
    this._compiler = opts.compiler;
  }

  // ── 关键字管理 ────────────────────────────────────────────────────

  /**
   * 注册关键字。
   * @param name 关键字名(如 'USE_FOG')
   * @param values 可选值集合;空数组 / 省略表示布尔型关键字(取值 '0'/'1')
   * @param defaultValue 默认取值(getVariant 未指定时使用)
   */
  registerKeyword(name: string, values?: string[], defaultValue?: string): this {
    if (!name || name.length === 0) {
      throw new Error(`ShaderVariant.registerKeyword: name must be non-empty`);
    }
    const vals = values ?? [];
    let def = defaultValue;
    if (def === undefined) {
      def = vals.length > 0 ? vals[0] : '0';
    }
    // 验证 default 在 values 内(非布尔型)
    if (vals.length > 0 && !vals.includes(def)) {
      throw new Error(
        `ShaderVariant.registerKeyword: default "${def}" not in values [${vals.join(',')}]`,
      );
    }
    this.keywords.set(name, { name, values: vals.slice(), default: def });
    log.debug(`registered keyword ${name} (values=[${vals.join(',')}], default=${def})`);
    return this;
  }

  /** 获取关键字声明。不存在返回 undefined。 */
  getKeyword(name: string): ShaderKeyword | undefined {
    return this.keywords.get(name);
  }

  /** 获取所有关键字。 */
  getKeywords(): ShaderKeyword[] {
    return Array.from(this.keywords.values());
  }

  // ── 变体查询 / 缓存 ─────────────────────────────────────────────

  /**
   * 生成变体键:对 query 按 name 字典序排序,拼成 'A=v1|B=v2'。
   * 未指定的关键字补 default 值。
   */
  getVariantKey(query: VariantQuery): string {
    const filled = this._fillDefaults(query);
    const keys = Object.keys(filled).sort();
    return keys.map((k) => `${k}=${filled[k]}`).join('|');
  }

  /**
   * 获取变体:缓存命中则返回并递增 refCount;未命中则 buildVariant 创建并缓存。
   * @throws 未注册关键字值非法时抛错
   */
  getVariant(query: VariantQuery): ShaderVariantEntry {
    const key = this.getVariantKey(query);
    const cached = this.variants.get(key);
    if (cached) {
      cached.refCount++;
      this._cacheHits++;
      return cached;
    }
    // 未命中:可能需要驱逐空闲变体
    this._ensureCapacity();
    const entry = this.buildVariant(query);
    this.variants.set(key, entry);
    this._cacheMisses++;
    this._buildCount++;
    return entry;
  }

  /** 检查变体是否已缓存(不递增引用计数)。 */
  hasVariant(query: VariantQuery): boolean {
    return this.variants.has(this.getVariantKey(query));
  }

  /**
   * 释放变体:递减引用计数,不低于 0。
   * @returns 释放后的引用计数(变体不存在返回 -1)
   */
  releaseVariant(query: VariantQuery): number {
    const key = this.getVariantKey(query);
    const entry = this.variants.get(key);
    if (!entry) return -1;
    entry.refCount = Math.max(0, entry.refCount - 1);
    return entry.refCount;
  }

  /**
   * 构建变体:把 base 源码做 #define 注入。
   * 不查缓存,也不写缓存;调用方负责(本类的 getVariant 会自动写入)。
   */
  buildVariant(query: VariantQuery): ShaderVariantEntry {
    const filled = this._fillDefaults(query);
    const key = this.getVariantKey(query);
    const vertexSource = this.preprocess(this._baseVertexSource, filled);
    const fragmentSource = this.preprocess(this._baseFragmentSource, filled);
    let compiledProgram: unknown = undefined;
    if (this._compiler) {
      compiledProgram = this._compiler(vertexSource, fragmentSource, key);
    }
    return {
      key,
      vertexSource,
      fragmentSource,
      compiledProgram,
      refCount: 1,
      createdOrder: ++_createdCounter,
    };
  }

  /**
   * 预处理源码:在 #version 行之后注入 `#define NAME VALUE` / `#define NAME_VAL 1`。
   * 对布尔型关键字(values 空):若 value 是 '1'/'true' 则注入 `#define NAME 1`,
   *   '0'/'false' 不注入任何内容;
   * 对枚举型关键字:注入 `#define NAME_VAL 1`。
   *
   * @param source 原始 GLSL 源码
   * @param keywords 关键字取值(已 fillDefaults 的)
   */
  preprocess(source: string, keywords: VariantQuery): string {
    const defines: string[] = [];
    for (const [name, value] of Object.entries(keywords)) {
      const kw = this.keywords.get(name);
      if (!kw) {
        // 未注册关键字:仍按布尔处理(value 非 '0' 则注入)
        if (value !== '0' && value !== 'false') {
          defines.push(`#define ${name} ${value}`);
        }
        continue;
      }
      if (kw.values.length === 0) {
        // 布尔型关键字
        if (value === '1' || value === 'true') {
          defines.push(`#define ${name} 1`);
        }
        // '0' / 'false' 不注入
      } else {
        // 枚举型关键字
        if (!kw.values.includes(value)) {
          throw new Error(
            `ShaderVariant.preprocess: keyword ${name} value "${value}" not in [${kw.values.join(',')}]`,
          );
        }
        defines.push(`#define ${name}_${value} 1`);
      }
    }
    if (defines.length === 0) return source;
    const defineBlock = defines.join('\n') + '\n';
    const versionMatch = source.match(/^(\s*#version[^\n]*\n)/);
    if (versionMatch) {
      return versionMatch[1] + defineBlock + source.slice(versionMatch[1].length);
    }
    return defineBlock + source;
  }

  /** 清除所有缓存变体(不重置关键字)。 */
  clearCache(): void {
    this.variants.clear();
    log.debug('cache cleared');
  }

  /** 当前缓存变体数。 */
  getVariantCount(): number {
    return this.variants.size;
  }

  /** 最大变体数。 */
  getMaxVariants(): number {
    return this.maxVariants;
  }

  /** 设置最大变体数(若新值小于当前变体数,触发驱逐)。 */
  setMaxVariants(max: number): void {
    if (max <= 0) {
      throw new Error(`ShaderVariant.setMaxVariants: max must be positive, got ${max}`);
    }
    this.maxVariants = max;
    this._ensureCapacity();
  }

  /** 缓存统计。 */
  getCacheStats(): ShaderVariantCacheStats {
    let used = 0;
    let totalRef = 0;
    for (const e of this.variants.values()) {
      if (e.refCount > 0) used++;
      totalRef += e.refCount;
    }
    return {
      variantCount: this.variants.size,
      maxVariants: this.maxVariants,
      usedVariants: used,
      unusedVariants: this.variants.size - used,
      totalRefCount: totalRef,
      keywordCount: this.keywords.size,
      buildCount: this._buildCount,
      cacheHits: this._cacheHits,
      cacheMisses: this._cacheMisses,
      evictions: this._evictions,
    };
  }

  /** 别名:getCacheStats。 */
  getStats(): ShaderVariantCacheStats {
    return this.getCacheStats();
  }

  /**
   * 驱逐所有 refCount==0 的变体。
   * @returns 被驱逐的变体数
   */
  evictUnused(): number {
    let count = 0;
    for (const [key, entry] of this.variants) {
      if (entry.refCount <= 0) {
        this.variants.delete(key);
        count++;
      }
    }
    this._evictions += count;
    if (count > 0) {
      log.debug(`evicted ${count} unused variants`);
    }
    return count;
  }

  // ── 内部 ─────────────────────────────────────────────────────────

  /** 把 query 中未指定的关键字补 default 值。 */
  private _fillDefaults(query: VariantQuery): VariantQuery {
    const filled: VariantQuery = {};
    for (const [name, kw] of this.keywords) {
      filled[name] = query[name] ?? kw.default;
    }
    // 同时保留 query 中未注册的关键字(允许"动态"关键字)
    for (const [name, value] of Object.entries(query)) {
      if (filled[name] === undefined) {
        filled[name] = value;
      } else {
        filled[name] = value;
      }
    }
    return filled;
  }

  /** 保证缓存容量:超过 maxVariants 时驱逐最旧的空闲变体。 */
  private _ensureCapacity(): void {
    if (this.variants.size < this.maxVariants) return;
    // 先驱逐所有空闲
    const evicted = this.evictUnused();
    if (this.variants.size < this.maxVariants) return;
    if (evicted > 0) return;
    // 仍超容量:驱逐最旧的(refCount 最小 + createdOrder 最小)
    while (this.variants.size >= this.maxVariants) {
      let oldestKey: string | null = null;
      let oldestEntry: ShaderVariantEntry | null = null;
      for (const [k, e] of this.variants) {
        if (oldestEntry === null || e.createdOrder < oldestEntry.createdOrder) {
          oldestKey = k;
          oldestEntry = e;
        }
      }
      if (oldestKey === null) break;
      this.variants.delete(oldestKey);
      this._evictions++;
      log.debug(`LRU evicted variant ${oldestKey} (capacity=${this.maxVariants})`);
    }
  }
}
