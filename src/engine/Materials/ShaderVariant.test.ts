// ShaderVariant 单元测试。
//
// 覆盖:
//   1. 构造 / 必填字段校验
//   2. registerKeyword / getKeyword / getKeywords
//   3. registerKeyword 校验 default 在 values 内
//   4. getVariantKey 字典序 + 默认值填充
//   5. getVariant 命中缓存(同 query 复用)+ refCount 递增
//   6. getVariant 未命中调用 buildVariant 创建
//   7. hasVariant
//   8. releaseVariant 引用计数递减
//   9. buildVariant 直接构建(不查缓存)
//  10. preprocess:布尔型关键字注入 #define NAME 1
//  11. preprocess:枚举型关键字注入 #define NAME_VAL 1
//  12. preprocess:无 #version 时直接前置
//  13. clearCache
//  14. setMaxVariants + LRU 驱逐
//  15. evictUnused
//  16. getCacheStats / getStats
//  17. compiler 回调:buildVariant 调用并缓存产物
//  18. 容量上限驱逐最旧

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderVariant } from './ShaderVariant';

const BASE_VERT = `#version 300 es
in vec3 a_position;
void main() { gl_Position = vec4(a_position, 1.0); }
`;

const BASE_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }
`;

function makeVariant(): ShaderVariant {
  return new ShaderVariant({
    vertexSource: BASE_VERT,
    fragmentSource: BASE_FRAG,
  });
}

describe('ShaderVariant construction', () => {
  it('默认 maxVariants=100', () => {
    const sv = makeVariant();
    expect(sv.maxVariants).toBe(100);
    expect(sv.getVariantCount()).toBe(0);
    expect(sv.getKeywords()).toEqual([]);
  });

  it('自定义 maxVariants', () => {
    const sv = new ShaderVariant({
      vertexSource: BASE_VERT,
      fragmentSource: BASE_FRAG,
      maxVariants: 8,
    });
    expect(sv.maxVariants).toBe(8);
  });

  it('空源码抛错', () => {
    expect(() => new ShaderVariant({ vertexSource: '', fragmentSource: BASE_FRAG })).toThrow();
    expect(() => new ShaderVariant({ vertexSource: BASE_VERT, fragmentSource: '' })).toThrow();
  });
});

describe('ShaderVariant keyword management', () => {
  let sv: ShaderVariant;

  beforeEach(() => {
    sv = makeVariant();
  });

  it('registerKeyword 枚举型', () => {
    sv.registerKeyword('LIGHTING', ['UNLIT', 'LAMBERT', 'PHONG'], 'LAMBERT');
    const kw = sv.getKeyword('LIGHTING');
    expect(kw).toBeDefined();
    expect(kw?.name).toBe('LIGHTING');
    expect(kw?.values).toEqual(['UNLIT', 'LAMBERT', 'PHONG']);
    expect(kw?.default).toBe('LAMBERT');
  });

  it('registerKeyword 布尔型(values 空)', () => {
    sv.registerKeyword('USE_FOG');
    const kw = sv.getKeyword('USE_FOG');
    expect(kw?.values).toEqual([]);
    expect(kw?.default).toBe('0');
  });

  it('registerKeyword 默认 default=values[0]', () => {
    sv.registerKeyword('Q', ['A', 'B']);
    expect(sv.getKeyword('Q')?.default).toBe('A');
  });

  it('registerKeyword default 不在 values 内抛错', () => {
    expect(() =>
      sv.registerKeyword('LIGHTING', ['UNLIT', 'LAMBERT'], 'PHONG'),
    ).toThrow();
  });

  it('registerKeyword 空 name 抛错', () => {
    expect(() => sv.registerKeyword('', ['A'])).toThrow();
  });

  it('getKeywords 返回所有', () => {
    sv.registerKeyword('A', ['x', 'y']);
    sv.registerKeyword('B', []);
    expect(sv.getKeywords().map((k) => k.name)).toEqual(['A', 'B']);
  });

  it('registerKeyword 同名覆盖', () => {
    sv.registerKeyword('K', ['A']);
    sv.registerKeyword('K', ['B', 'C']);
    expect(sv.getKeyword('K')?.values).toEqual(['B', 'C']);
  });
});

describe('ShaderVariant.getVariantKey', () => {
  let sv: ShaderVariant;

  beforeEach(() => {
    sv = makeVariant();
    sv.registerKeyword('LIGHTING', ['UNLIT', 'LAMBERT', 'PHONG'], 'LAMBERT');
    sv.registerKeyword('USE_FOG', [], '0');
  });

  it('按 name 字典序拼接', () => {
    expect(sv.getVariantKey({ LIGHTING: 'PHONG', USE_FOG: '1' })).toBe('LIGHTING=PHONG|USE_FOG=1');
  });

  it('未指定字段补 default', () => {
    expect(sv.getVariantKey({})).toBe('LIGHTING=LAMBERT|USE_FOG=0');
  });

  it('部分指定 + 部分 default', () => {
    expect(sv.getVariantKey({ USE_FOG: '1' })).toBe('LIGHTING=LAMBERT|USE_FOG=1');
  });

  it('顺序无关(query 中字段顺序不影响 key)', () => {
    const k1 = sv.getVariantKey({ LIGHTING: 'PHONG', USE_FOG: '1' });
    const k2 = sv.getVariantKey({ USE_FOG: '1', LIGHTING: 'PHONG' });
    expect(k1).toBe(k2);
  });

  it('未注册关键字保留原值', () => {
    expect(sv.getVariantKey({ DYNAMIC: 'X' })).toBe('DYNAMIC=X|LIGHTING=LAMBERT|USE_FOG=0');
  });
});

describe('ShaderVariant.getVariant / hasVariant / releaseVariant', () => {
  let sv: ShaderVariant;

  beforeEach(() => {
    sv = makeVariant();
    sv.registerKeyword('LIGHTING', ['UNLIT', 'LAMBERT', 'PHONG'], 'LAMBERT');
    sv.registerKeyword('USE_FOG', [], '0');
  });

  it('getVariant 首次未命中 -> 创建并缓存', () => {
    const e = sv.getVariant({ LIGHTING: 'PHONG', USE_FOG: '1' });
    expect(e.key).toBe('LIGHTING=PHONG|USE_FOG=1');
    expect(e.refCount).toBe(1);
    expect(sv.getVariantCount()).toBe(1);
    expect(sv.hasVariant({ LIGHTING: 'PHONG', USE_FOG: '1' })).toBe(true);
  });

  it('getVariant 二次命中 -> 复用 + refCount++', () => {
    const e1 = sv.getVariant({ LIGHTING: 'PHONG' });
    const e2 = sv.getVariant({ LIGHTING: 'PHONG' });
    expect(e1).toBe(e2); // 同一对象引用
    expect(e2.refCount).toBe(2);
  });

  it('hasVariant 不递增 refCount', () => {
    sv.getVariant({ LIGHTING: 'PHONG' });
    expect(sv.hasVariant({ LIGHTING: 'PHONG' })).toBe(true);
    const e = sv.getVariant({ LIGHTING: 'PHONG' });
    expect(e.refCount).toBe(2); // 之前 1 次 + 本次 1 次,hasVariant 不计
  });

  it('hasVariant 未缓存返回 false', () => {
    expect(sv.hasVariant({ LIGHTING: 'PHONG' })).toBe(false);
  });

  it('releaseVariant 递减 refCount,下限为 0', () => {
    sv.getVariant({ LIGHTING: 'PHONG' }); // ref=1
    sv.getVariant({ LIGHTING: 'PHONG' }); // ref=2
    expect(sv.releaseVariant({ LIGHTING: 'PHONG' })).toBe(1);
    expect(sv.releaseVariant({ LIGHTING: 'PHONG' })).toBe(0);
    expect(sv.releaseVariant({ LIGHTING: 'PHONG' })).toBe(0); // 不低于 0
  });

  it('releaseVariant 不存在的变体返回 -1', () => {
    expect(sv.releaseVariant({ LIGHTING: 'UNLIT' })).toBe(-1);
  });

  it('不同 query 产生不同变体', () => {
    const e1 = sv.getVariant({ LIGHTING: 'UNLIT' });
    const e2 = sv.getVariant({ LIGHTING: 'LAMBERT' });
    expect(e1).not.toBe(e2);
    expect(e1.key).not.toBe(e2.key);
    expect(sv.getVariantCount()).toBe(2);
  });
});

describe('ShaderVariant.buildVariant', () => {
  it('不查缓存,每次返回新对象', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    const e1 = sv.buildVariant({ USE_FOG: '1' });
    const e2 = sv.buildVariant({ USE_FOG: '1' });
    expect(e1).not.toBe(e2);
    expect(e1.key).toBe(e2.key);
    expect(sv.getVariantCount()).toBe(0); // buildVariant 不写缓存
  });

  it('refCount 初始为 1', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    const e = sv.buildVariant({ USE_FOG: '1' });
    expect(e.refCount).toBe(1);
  });
});

describe('ShaderVariant.preprocess', () => {
  let sv: ShaderVariant;

  beforeEach(() => {
    sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    sv.registerKeyword('LIGHTING', ['UNLIT', 'LAMBERT', 'PHONG'], 'LAMBERT');
  });

  it('布尔型关键字 value=1 注入 #define NAME 1', () => {
    const out = sv.preprocess(BASE_FRAG, { USE_FOG: '1' });
    expect(out).toContain('#define USE_FOG 1');
    expect(out).toContain('#version 300 es');
    // define 在 version 之后
    expect(out.indexOf('#define USE_FOG 1')).toBeGreaterThan(out.indexOf('#version 300 es'));
  });

  it('布尔型关键字 value=0 不注入', () => {
    const out = sv.preprocess(BASE_FRAG, { USE_FOG: '0' });
    expect(out).not.toContain('#define USE_FOG');
    expect(out).toBe(BASE_FRAG);
  });

  it('布尔型关键字 true/false', () => {
    const out = sv.preprocess(BASE_FRAG, { USE_FOG: 'true' });
    expect(out).toContain('#define USE_FOG 1');
    const out2 = sv.preprocess(BASE_FRAG, { USE_FOG: 'false' });
    expect(out2).not.toContain('#define USE_FOG');
  });

  it('枚举型关键字注入 #define NAME_VAL 1', () => {
    const out = sv.preprocess(BASE_FRAG, { LIGHTING: 'PHONG' });
    expect(out).toContain('#define LIGHTING_PHONG 1');
  });

  it('枚举型关键字非法值抛错', () => {
    expect(() => sv.preprocess(BASE_FRAG, { LIGHTING: 'INVALID' })).toThrow();
  });

  it('多个 define 同时注入', () => {
    const out = sv.preprocess(BASE_FRAG, { USE_FOG: '1', LIGHTING: 'PHONG' });
    expect(out).toContain('#define USE_FOG 1');
    expect(out).toContain('#define LIGHTING_PHONG 1');
  });

  it('无 #version 时直接前置', () => {
    const src = `void main() {}`;
    const out = sv.preprocess(src, { USE_FOG: '1' });
    expect(out.startsWith('#define USE_FOG 1')).toBe(true);
    expect(out).toContain('void main() {}');
  });

  it('所有字段为默认值时不注入任何 define', () => {
    const out = sv.preprocess(BASE_FRAG, {});
    expect(out).toBe(BASE_FRAG);
  });

  it('未注册关键字按布尔处理(value 非 0 注入)', () => {
    const out = sv.preprocess(BASE_FRAG, { UNKNOWN_KW: '1' });
    expect(out).toContain('#define UNKNOWN_KW 1');
  });
});

describe('ShaderVariant compiler 回调', () => {
  it('提供 compiler 时 buildVariant 调用并缓存产物', () => {
    const compiler = vi.fn((vert: string, frag: string, key: string) => ({
      program: `prog_${key}`,
      vertLen: vert.length,
      fragLen: frag.length,
    }));
    const sv = new ShaderVariant({
      vertexSource: BASE_VERT,
      fragmentSource: BASE_FRAG,
      compiler,
    });
    sv.registerKeyword('USE_FOG', [], '0');
    const e = sv.getVariant({ USE_FOG: '1' });
    expect(compiler).toHaveBeenCalledTimes(1);
    expect(e.compiledProgram).toBeDefined();
    const prog = e.compiledProgram as { program: string; vertLen: number; fragLen: number };
    expect(prog.program).toBe('prog_USE_FOG=1');
    expect(prog.vertLen).toBeGreaterThan(0);
  });

  it('缓存命中不重复调用 compiler', () => {
    const compiler = vi.fn(() => ({}));
    const sv = new ShaderVariant({
      vertexSource: BASE_VERT,
      fragmentSource: BASE_FRAG,
      compiler,
    });
    sv.registerKeyword('USE_FOG', [], '0');
    sv.getVariant({ USE_FOG: '1' });
    sv.getVariant({ USE_FOG: '1' });
    expect(compiler).toHaveBeenCalledTimes(1);
  });

  it('未提供 compiler 时 compiledProgram 为 undefined', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    const e = sv.getVariant({ USE_FOG: '1' });
    expect(e.compiledProgram).toBeUndefined();
  });
});

describe('ShaderVariant 缓存清理 / LRU', () => {
  it('clearCache 清空变体但保留关键字', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    sv.getVariant({ USE_FOG: '1' });
    sv.getVariant({ USE_FOG: '0' });
    expect(sv.getVariantCount()).toBe(2);
    sv.clearCache();
    expect(sv.getVariantCount()).toBe(0);
    expect(sv.getKeywords().length).toBe(1);
  });

  it('evictUnused 驱逐 refCount==0 的变体', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    sv.registerKeyword('USE_SHADOW', [], '0');
    sv.getVariant({ USE_FOG: '1' });
    sv.getVariant({ USE_SHADOW: '1' });
    // 释放一个
    sv.releaseVariant({ USE_FOG: '1' });
    expect(sv.getVariantCount()).toBe(2);
    const evicted = sv.evictUnused();
    expect(evicted).toBe(1);
    expect(sv.getVariantCount()).toBe(1);
    expect(sv.hasVariant({ USE_FOG: '1' })).toBe(false);
    expect(sv.hasVariant({ USE_SHADOW: '1' })).toBe(true);
  });

  it('evictUnused 不驱逐正在使用的变体', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    sv.getVariant({ USE_FOG: '1' });
    sv.getVariant({ USE_FOG: '1' }); // refCount=2
    sv.releaseVariant({ USE_FOG: '1' }); // refCount=1
    const evicted = sv.evictUnused();
    expect(evicted).toBe(0);
    expect(sv.getVariantCount()).toBe(1);
  });

  it('setMaxVariants 触发驱逐(超容量时)', () => {
    const sv = new ShaderVariant({
      vertexSource: BASE_VERT,
      fragmentSource: BASE_FRAG,
      maxVariants: 5,
    });
    sv.registerKeyword('A', ['0', '1'], '0');
    sv.registerKeyword('B', ['0', '1'], '0');
    sv.registerKeyword('C', ['0', '1'], '0');
    // 创建 5 个变体
    sv.getVariant({ A: '1' });
    sv.getVariant({ B: '1' });
    sv.getVariant({ C: '1' });
    sv.getVariant({ A: '1', B: '1' });
    sv.getVariant({ A: '1', C: '1' });
    expect(sv.getVariantCount()).toBe(5);
    // 缩到 3
    sv.setMaxVariants(3);
    expect(sv.maxVariants).toBe(3);
    expect(sv.getVariantCount()).toBeLessThanOrEqual(3);
  });

  it('超容量时驱逐空闲变体后再驱逐最旧', () => {
    const sv = new ShaderVariant({
      vertexSource: BASE_VERT,
      fragmentSource: BASE_FRAG,
      maxVariants: 2,
    });
    sv.registerKeyword('USE_FOG', [], '0');
    sv.registerKeyword('USE_SHADOW', [], '0');
    sv.getVariant({ USE_FOG: '1' });
    sv.getVariant({ USE_SHADOW: '1' });
    expect(sv.getVariantCount()).toBe(2);
    // 第 3 个变体:容量超 -> 先 evictUnused,仍超则驱逐最旧
    sv.getVariant({ USE_FOG: '0', USE_SHADOW: '0' });
    expect(sv.getVariantCount()).toBe(2);
  });

  it('setMaxVariants 非正抛错', () => {
    const sv = makeVariant();
    expect(() => sv.setMaxVariants(0)).toThrow();
    expect(() => sv.setMaxVariants(-1)).toThrow();
  });
});

describe('ShaderVariant 统计', () => {
  it('getCacheStats 初始为 0', () => {
    const sv = makeVariant();
    const stats = sv.getCacheStats();
    expect(stats.variantCount).toBe(0);
    expect(stats.maxVariants).toBe(100);
    expect(stats.usedVariants).toBe(0);
    expect(stats.unusedVariants).toBe(0);
    expect(stats.totalRefCount).toBe(0);
    expect(stats.keywordCount).toBe(0);
    expect(stats.buildCount).toBe(0);
    expect(stats.cacheHits).toBe(0);
    expect(stats.cacheMisses).toBe(0);
    expect(stats.evictions).toBe(0);
  });

  it('getStats 与 getCacheStats 同义', () => {
    const sv = makeVariant();
    expect(sv.getStats()).toEqual(sv.getCacheStats());
  });

  it('buildCount / cacheHits / cacheMisses 正确更新', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    sv.getVariant({ USE_FOG: '1' }); // miss + build
    sv.getVariant({ USE_FOG: '1' }); // hit
    sv.getVariant({ USE_FOG: '0' }); // miss + build
    const stats = sv.getCacheStats();
    expect(stats.buildCount).toBe(2);
    expect(stats.cacheHits).toBe(1);
    expect(stats.cacheMisses).toBe(2);
    expect(stats.variantCount).toBe(2);
    expect(stats.usedVariants).toBe(2);
    expect(stats.totalRefCount).toBe(3);
  });

  it('getMaxVariants / getVariantCount', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    expect(sv.getMaxVariants()).toBe(100);
    expect(sv.getVariantCount()).toBe(0);
    sv.getVariant({ USE_FOG: '1' });
    expect(sv.getVariantCount()).toBe(1);
  });

  it('evictions 统计累积', () => {
    const sv = makeVariant();
    sv.registerKeyword('USE_FOG', [], '0');
    sv.getVariant({ USE_FOG: '1' });
    sv.releaseVariant({ USE_FOG: '1' });
    sv.evictUnused();
    expect(sv.getCacheStats().evictions).toBe(1);
  });
});

describe('ShaderVariant 集成场景', () => {
  it('完整工作流:注册关键字 → 查询变体 → 释放 → 清理', () => {
    const sv = makeVariant();
    sv.registerKeyword('LIGHTING', ['UNLIT', 'LAMBERT', 'PHONG'], 'LAMBERT');
    sv.registerKeyword('USE_FOG', [], '0');
    sv.registerKeyword('USE_SHADOW', [], '0');

    // 创建 3 个不同组合
    const a = sv.getVariant({ LIGHTING: 'PHONG', USE_FOG: '1', USE_SHADOW: '1' });
    const b = sv.getVariant({ LIGHTING: 'LAMBERT', USE_FOG: '1' });
    const c = sv.getVariant({ LIGHTING: 'UNLIT' });

    expect(sv.getVariantCount()).toBe(3);
    expect(a.vertexSource).toContain('#define LIGHTING_PHONG 1');
    expect(a.vertexSource).toContain('#define USE_FOG 1');
    expect(a.vertexSource).toContain('#define USE_SHADOW 1');
    expect(b.vertexSource).toContain('#define LIGHTING_LAMBERT 1');
    expect(b.vertexSource).toContain('#define USE_FOG 1');
    expect(c.vertexSource).not.toContain('#define USE_FOG');
    expect(c.vertexSource).not.toContain('#define USE_SHADOW');

    // 释放 a 和 c
    sv.releaseVariant({ LIGHTING: 'PHONG', USE_FOG: '1', USE_SHADOW: '1' });
    sv.releaseVariant({ LIGHTING: 'UNLIT' });
    expect(sv.getCacheStats().usedVariants).toBe(1);

    // evictUnused 清理空闲
    const evicted = sv.evictUnused();
    expect(evicted).toBe(2);
    expect(sv.getVariantCount()).toBe(1);
    expect(sv.hasVariant({ LIGHTING: 'LAMBERT', USE_FOG: '1' })).toBe(true);
  });

  it('笛卡尔积变体(枚举型组合)', () => {
    const sv = makeVariant();
    sv.registerKeyword('A', ['0', '1'], '0');
    sv.registerKeyword('B', ['0', '1'], '0');
    // 4 种组合
    sv.getVariant({ A: '0', B: '0' });
    sv.getVariant({ A: '0', B: '1' });
    sv.getVariant({ A: '1', B: '0' });
    sv.getVariant({ A: '1', B: '1' });
    expect(sv.getVariantCount()).toBe(4);
    // 同组合复用
    sv.getVariant({ A: '1', B: '1' });
    expect(sv.getVariantCount()).toBe(4);
    expect(sv.getCacheStats().cacheHits).toBe(1);
  });
});
