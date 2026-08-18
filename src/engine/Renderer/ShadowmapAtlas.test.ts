// ShadowmapAtlas 单元测试 — o3de 阴影图集四叉树打包算法的 VREEN 适配。
//
// 覆盖维度:
//   1. 生命周期:initialize / setShadowmapSize / finalize / 查询前校验
//   2. 打包正确性(用 o3de ShadowmapAtlas.h 头部注释权威示例对齐)
//   3. 原点解码(Location → arraySlice + originInSlice)
//   4. 索引表结构(根子表=切片数,非根子表=4,缺失跳转 offsets)
//   5. 边界(未登记 index / 尺寸过小 disabled / 空图集 / 非法切片溢出)

import { describe, it, expect } from 'vitest';
import {
  ShadowmapAtlas,
  INVALID_SHADOWMAP_INDEX as INVALID,
} from './ShadowmapAtlas';

describe('ShadowmapAtlas — 生命周期', () => {
  it('未 finalize 前查询抛错', () => {
    const at = new ShadowmapAtlas();
    at.setShadowmapSize(0, 256);
    expect(() => at.getArraySliceCount()).toThrow(/finalize/);
    expect(() => at.getOrigin(0)).toThrow(/finalize/);
    expect(() => at.getShadowmapIndexTable()).toThrow(/finalize/);
  });

  it('空图集 finalize 后切片数为 1 且索引表为空/最少根', () => {
    const at = new ShadowmapAtlas();
    at.finalize();
    expect(at.getArraySliceCount()).toBe(1);
    expect(at.getBaseShadowmapSize()).toBe(2048);
    const table = at.getShadowmapIndexTable();
    expect(table.length).toBe(1);
    expect(table[0]).toEqual({ nextTableOffset: 0, shadowmapIndex: INVALID });
  });

  it('initialize 后回到可重新设置状态', () => {
    const at = new ShadowmapAtlas();
    at.setShadowmapSize(0, 1024);
    at.finalize();
    // o3de 语义:base 恒为 Max(2048, 设置最大值) → 1024<2048 故 2048
    expect(at.getBaseShadowmapSize()).toBe(2048);
    // 复用同一实例重新打包
    at.initialize();
    expect(() => at.getBaseShadowmapSize()).toThrow(/finalize/);
    at.setShadowmapSize(5, 512);
    at.finalize();
    expect(at.getBaseShadowmapSize()).toBe(2048);
    const o = at.getOrigin(5);
    expect(o).toEqual({ arraySlice: 0, originInSlice: [0, 0] });
  });
});

describe('ShadowmapAtlas — o3de 权威示例打包', () => {
  // 对齐 o3de ShadowmapAtlas.h 的注释示例:
  //   base=2048, light#0 → Location [0] (1/1 整切片铺满,大于…),
  //   #1 → [1,0], #2 → [1,1]。生成 size 6 的索引表 [0, off→2, 1, 2, unused, unused]。
  it('按"大的优先 + 同尺寸字典序"打包并正确解码原点', () => {
    const at = new ShadowmapAtlas();
    at.setShadowmapSize(0, 2048);
    at.setShadowmapSize(1, 1024);
    at.setShadowmapSize(2, 1024);
    at.finalize();

    expect(at.getArraySliceCount()).toBe(2);
    expect(at.getBaseShadowmapSize()).toBe(2048);

    // #0 → [0] 一整片
    expect(at.getOrigin(0)).toEqual({ arraySlice: 0, originInSlice: [0, 0] });
    // #1 → [1,0] slice1 左下 1/4
    expect(at.getOrigin(1)).toEqual({ arraySlice: 1, originInSlice: [0, 0] });
    // #2 → [1,1] slice1 右下 1/4(即 x 偏移 base/2=1024)
    expect(at.getOrigin(2)).toEqual({ arraySlice: 1, originInSlice: [1024, 0] });

    // 索引表:根子表2项 + [1]子表4项 = 6
    const table = at.getShadowmapIndexTable();
    expect(table.length).toBe(6);
    expect(table[0]).toEqual({ nextTableOffset: 0, shadowmapIndex: 0 });
    expect(table[1]).toEqual({ nextTableOffset: 2, shadowmapIndex: INVALID }); // 跳转到子表
    expect(table[2]).toEqual({ nextTableOffset: 0, shadowmapIndex: 1 });
    expect(table[3]).toEqual({ nextTableOffset: 0, shadowmapIndex: 2 });
    expect(table[4]).toEqual({ nextTableOffset: 0, shadowmapIndex: INVALID });
    expect(table[5]).toEqual({ nextTableOffset: 0, shadowmapIndex: INVALID });
  });
});

describe('ShadowmapAtlas — 原点解码与层级', () => {
  it('基准 512:1 张 512 + 2 张 256 → 256 细分到切片1 左右半', () => {
    const at = new ShadowmapAtlas({ baseShadowmapSize: 512, minShadowmapSize: 256 });
    at.setShadowmapSize(0, 512);
    at.setShadowmapSize(1, 256);
    at.setShadowmapSize(2, 256);
    at.finalize();
    expect(at.getBaseShadowmapSize()).toBe(512);
    expect(at.getArraySliceCount()).toBe(2);
    expect(at.getOrigin(0)).toEqual({ arraySlice: 0, originInSlice: [0, 0] });
    expect(at.getOrigin(1)).toEqual({ arraySlice: 1, originInSlice: [0, 0] });
    // [1,1]:digit1 为 1 → x 偏移 512/2=256
    expect(at.getOrigin(2)).toEqual({ arraySlice: 1, originInSlice: [256, 0] });
  });

  it('基准 512:4 张 256 在同一切片内做 2×2 四叉细分', () => {
    const at = new ShadowmapAtlas({ baseShadowmapSize: 512, minShadowmapSize: 256 });
    for (let i = 0; i < 4; ++i) at.setShadowmapSize(i, 256);
    at.finalize();
    expect(at.getArraySliceCount()).toBe(1);
    expect(at.getOrigin(0)).toEqual({ arraySlice: 0, originInSlice: [0, 0] });
    expect(at.getOrigin(1)).toEqual({ arraySlice: 0, originInSlice: [256, 0] });
    expect(at.getOrigin(2)).toEqual({ arraySlice: 0, originInSlice: [0, 256] });
    expect(at.getOrigin(3)).toEqual({ arraySlice: 0, originInSlice: [256, 256] });
    // 根子表 1 + [0] 子表 4 = 5;根槽指向子表(offset 1)
    const table = at.getShadowmapIndexTable();
    expect(table.length).toBe(5);
    expect(table[0]).toEqual({ nextTableOffset: 1, shadowmapIndex: INVALID });
    expect(table[1]).toEqual({ nextTableOffset: 0, shadowmapIndex: 0 });
    expect(table[2]).toEqual({ nextTableOffset: 0, shadowmapIndex: 1 });
    expect(table[3]).toEqual({ nextTableOffset: 0, shadowmapIndex: 2 });
    expect(table[4]).toEqual({ nextTableOffset: 0, shadowmapIndex: 3 });
  });

  it('默认 base 恒为 2048,即使只设置更小的阴影', () => {
    const at = new ShadowmapAtlas();
    at.setShadowmapSize(0, 512);
    at.finalize();
    expect(at.getBaseShadowmapSize()).toBe(2048);
    expect(at.getOrigin(0)).toEqual({ arraySlice: 0, originInSlice: [0, 0] });
  });
});

describe('ShadowmapAtlas — 边界', () => {
  it('未登记的 index 返回空原点(disabled)', () => {
    const at = new ShadowmapAtlas();
    at.setShadowmapSize(0, 512);
    at.finalize();
    expect(at.getOrigin(42)).toEqual({ arraySlice: 0, originInSlice: [0, 0] });
  });

  it('尺寸小于 minShadowmapSize 的索引不被打包', () => {
    const at = new ShadowmapAtlas({ minShadowmapSize: 512 });
    at.setShadowmapSize(0, 512);
    at.setShadowmapSize(1, 256); // < min → disabled
    at.finalize();
    expect(at.getArraySliceCount()).toBe(1);
    expect(at.getOrigin(1)).toEqual({ arraySlice: 0, originInSlice: [0, 0] });
  });

  it('自定义 baseShadowmapSize 生效', () => {
    const at = new ShadowmapAtlas({ baseShadowmapSize: 1024, minShadowmapSize: 256 });
    at.setShadowmapSize(0, 1024);
    at.setShadowmapSize(1, 512);
    at.finalize();
    expect(at.getBaseShadowmapSize()).toBe(1024);
    expect(at.getOrigin(1)).toEqual({ arraySlice: 1, originInSlice: [0, 0] });
  });

  it('可重复 finalize(幂等,不抛错)', () => {
    const at = new ShadowmapAtlas();
    at.setShadowmapSize(0, 512);
    at.finalize();
    const table = at.getShadowmapIndexTable();
    at.finalize();
    expect(at.getShadowmapIndexTable()).toEqual(table);
  });
});